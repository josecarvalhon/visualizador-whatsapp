"""Lê o backup do WhatsApp para iOS e gera o banco SQLite do visualizador.

Os bancos de origem são abertos em modo somente leitura e nunca são alterados.

Uso: python importar.py
"""
import sqlite3
import sys

from config import BANCO, PASTA_MIDIA, PASTA_RECURSOS

# Datas do iOS contam segundos a partir de 2001-01-01
EPOCA_APPLE = 978307200

# A anonimização cortou parte das datas para os 5 primeiros dígitos
# (380556381 virou 38055). Abaixo deste limite a data está truncada.
LIMITE_DATA_TRUNCADA = 1e8
FATOR_TRUNCAMENTO = 10_000

TIPOS = {
    0: "texto",
    1: "imagem",
    2: "video",
    3: "audio",
    4: "contato",
    5: "localizacao",
    6: "evento",
    7: "link",
    10: "sistema",
}

ESQUEMA = """
CREATE TABLE conversas (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    jid TEXT,
    grupo INTEGER NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    ultima_data REAL,
    ultima_previa TEXT
);
CREATE TABLE mensagens (
    id INTEGER PRIMARY KEY,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id),
    ordem INTEGER NOT NULL,
    data REAL,
    data_aproximada INTEGER NOT NULL,
    de_mim INTEGER NOT NULL,
    remetente TEXT,
    tipo TEXT NOT NULL,
    texto TEXT,
    midia TEXT,
    legenda TEXT,
    url TEXT,
    latitude REAL,
    longitude REAL
);
CREATE INDEX idx_mensagens_conversa ON mensagens (conversa_id, ordem);
"""


def abrir_somente_leitura(caminho):
    # immutable=1 dispensa os arquivos -wal/-shm e garante que nada é gravado
    con = sqlite3.connect(f"file:{caminho}?mode=ro&immutable=1", uri=True)
    con.row_factory = sqlite3.Row
    return con


def chave_jid(jid):
    return jid.split("@")[0] if jid else None


def carregar_contatos():
    con = abrir_somente_leitura(PASTA_RECURSOS / "Contacts_anon.sqlite")
    nomes = {}
    for linha in con.execute(
        """SELECT p.ZWHATSAPPID, c.ZFULLNAME
           FROM ZWAPHONE p JOIN ZWACONTACT c ON c.Z_PK = p.ZCONTACT
           WHERE p.ZWHATSAPPID IS NOT NULL AND c.ZFULLNAME <> ''"""
    ):
        nomes[linha["ZWHATSAPPID"]] = linha["ZFULLNAME"]
    con.close()
    return nomes


def indexar_midia():
    """Mapeia o nome do arquivo para o caminho relativo dentro de Media/files."""
    if not PASTA_MIDIA.is_dir():
        return {}
    return {p.name: p.relative_to(PASTA_MIDIA).as_posix() for p in PASTA_MIDIA.rglob("*") if p.is_file()}


def reconstruir_datas(mensagens):
    """Estima as datas truncadas usando o intervalo do truncamento e as vizinhas exatas.

    `mensagens` já está em ordem cronológica (ZSORT). Devolve (data_unix, aproximada).
    """
    n = len(mensagens)
    brutas = [m["ZMESSAGEDATE"] for m in mensagens]
    exata = [d is not None and d >= LIMITE_DATA_TRUNCADA for d in brutas]

    proxima_exata = [None] * n
    seguinte = None
    for i in range(n - 1, -1, -1):
        proxima_exata[i] = seguinte
        if exata[i]:
            seguinte = brutas[i]

    resultado = []
    anterior = None
    for i, bruta in enumerate(brutas):
        if bruta is None:
            resultado.append((None, True))
            continue
        if exata[i]:
            data = bruta
        else:
            minimo = bruta * FATOR_TRUNCAMENTO
            maximo = minimo + FATOR_TRUNCAMENTO
            if anterior is not None:
                minimo = max(minimo, anterior)
            if proxima_exata[i] is not None:
                maximo = min(maximo, proxima_exata[i])
            data = minimo if minimo >= maximo else (minimo + maximo) / 2
        anterior = data
        resultado.append((data + EPOCA_APPLE, not exata[i]))
    return resultado


def nome_por_jid(jid, contatos):
    chave = chave_jid(jid)
    if not chave:
        return None
    return contatos.get(chave) or contatos.get(chave.split("~")[0])


def descrever_evento(msg, contatos):
    tipo_evento = msg["ZGROUPEVENTTYPE"]
    texto = msg["ZTEXT"] or ""
    if tipo_evento in (1, 12) and texto:
        return f"Nome do grupo alterado para “{texto}”"
    if "@" in texto:
        return f"Alteração de participantes: {nome_por_jid(texto, contatos) or '+' + chave_jid(texto)}"
    return "Evento do grupo"


def remetente_de(msg, conversa_nome, grupo, membros, contatos):
    if msg["ZISFROMME"]:
        return "Você"
    if not grupo:
        return conversa_nome
    membro = membros.get(msg["ZGROUPMEMBER"])
    if membro:
        nome = membro["ZCONTACTNAME"] or membro["ZFIRSTNAME"] or nome_por_jid(membro["ZMEMBERJID"], contatos)
        if nome:
            return nome
        return "+" + chave_jid(membro["ZMEMBERJID"])
    return msg["ZPUSHNAME"] or "Desconhecido"


def importar():
    origem_chat = PASTA_RECURSOS / "ChatStorage_anon.sqlite"
    if not origem_chat.exists():
        sys.exit(f"Não encontrei {origem_chat}. Ajuste WHATSAPP_RECURSOS.")

    contatos = carregar_contatos()
    arquivos = indexar_midia()
    origem = abrir_somente_leitura(origem_chat)
    membros = {m["Z_PK"]: m for m in origem.execute("SELECT * FROM ZWAGROUPMEMBER")}

    BANCO.parent.mkdir(parents=True, exist_ok=True)
    BANCO.unlink(missing_ok=True)
    destino = sqlite3.connect(BANCO)
    destino.executescript(ESQUEMA)

    total_msgs = 0
    sessoes = origem.execute(
        "SELECT Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE FROM ZWACHATSESSION WHERE ZSESSIONTYPE IN (0, 1)"
    ).fetchall()
    for sessao in sessoes:
        grupo = sessao["ZSESSIONTYPE"] == 1
        nome = sessao["ZPARTNERNAME"] or chave_jid(sessao["ZCONTACTJID"]) or "Sem nome"
        if not grupo and nome.startswith("+"):
            nome = nome_por_jid(sessao["ZCONTACTJID"], contatos) or nome
        destino.execute(
            "INSERT INTO conversas (id, nome, jid, grupo) VALUES (?, ?, ?, ?)",
            (sessao["Z_PK"], nome, sessao["ZCONTACTJID"], int(grupo)),
        )

        mensagens = origem.execute(
            """SELECT m.*, i.ZMEDIALOCALPATH, i.ZTITLE, i.ZMEDIAURL, i.ZLATITUDE, i.ZLONGITUDE, i.ZVCARDNAME
               FROM ZWAMESSAGE m LEFT JOIN ZWAMEDIAITEM i ON i.Z_PK = m.ZMEDIAITEM
               WHERE m.ZCHATSESSION = ?
               ORDER BY m.ZSORT, m.Z_PK""",
            (sessao["Z_PK"],),
        ).fetchall()
        datas = reconstruir_datas(mensagens)

        linhas = []
        for ordem, (msg, (data, aproximada)) in enumerate(zip(mensagens, datas)):
            tipo = TIPOS.get(msg["ZMESSAGETYPE"], "sistema")
            texto = msg["ZTEXT"]
            midia = legenda = url = lat = lon = None
            if tipo in ("imagem", "video", "audio"):
                caminho = msg["ZMEDIALOCALPATH"]
                if caminho:
                    midia = arquivos.get(caminho.rsplit("/", 1)[-1])
                legenda = msg["ZTITLE"] or None
                texto = texto or None
            elif tipo == "link":
                url = msg["ZMEDIAURL"] or texto
                legenda = msg["ZTITLE"] or None
            elif tipo == "contato":
                texto = msg["ZVCARDNAME"] or texto
            elif tipo == "localizacao":
                lat, lon = msg["ZLATITUDE"], msg["ZLONGITUDE"]
            elif tipo == "evento":
                texto = descrever_evento(msg, contatos)

            linhas.append((
                sessao["Z_PK"], ordem, data, int(aproximada), int(bool(msg["ZISFROMME"])),
                remetente_de(msg, nome, grupo, membros, contatos),
                tipo, texto, midia, legenda, url, lat, lon,
            ))
        destino.executemany(
            """INSERT INTO mensagens (conversa_id, ordem, data, data_aproximada, de_mim, remetente,
                                      tipo, texto, midia, legenda, url, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            linhas,
        )
        total_msgs += len(linhas)

    destino.execute(
        """UPDATE conversas SET
             total = (SELECT count(*) FROM mensagens m WHERE m.conversa_id = conversas.id),
             ultima_data = (SELECT max(data) FROM mensagens m WHERE m.conversa_id = conversas.id),
             ultima_previa = (SELECT CASE m.tipo
                                       WHEN 'imagem' THEN '📷 Foto'
                                       WHEN 'video' THEN '🎥 Vídeo'
                                       WHEN 'audio' THEN '🎤 Áudio'
                                       WHEN 'contato' THEN '👤 Contato'
                                       WHEN 'localizacao' THEN '📍 Localização'
                                       ELSE coalesce(m.texto, '') END
                              FROM mensagens m WHERE m.conversa_id = conversas.id
                              ORDER BY m.ordem DESC LIMIT 1)"""
    )
    destino.commit()
    destino.close()
    origem.close()

    print(f"{len(sessoes)} conversas, {total_msgs} mensagens, {len(arquivos)} arquivos de mídia → {BANCO}")


if __name__ == "__main__":
    importar()
