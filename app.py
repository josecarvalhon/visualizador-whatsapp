"""Servidor web do visualizador. Rode `python importar.py` antes da primeira vez."""
import re
import sqlite3
import sys
from datetime import datetime

from flask import Flask, abort, g, jsonify, render_template, request, send_from_directory

from config import BANCO, PASTA_MIDIA

app = Flask(__name__)

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
         "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

# Eventos de grupo e avisos do sistema não contam como mensagens nas buscas e estatísticas
SO_MENSAGENS = "tipo NOT IN ('evento', 'sistema')"


def banco():
    if "banco" not in g:
        g.banco = sqlite3.connect(f"file:{BANCO}?mode=ro", uri=True)
        g.banco.row_factory = sqlite3.Row
    return g.banco


@app.teardown_appcontext
def fechar_banco(_erro):
    con = g.pop("banco", None)
    if con is not None:
        con.close()


@app.get("/")
def inicio():
    return render_template("index.html")


@app.get("/api/conversas")
def conversas():
    linhas = banco().execute(
        """SELECT id, nome, grupo, total, ultima_data, ultima_previa
           FROM conversas WHERE total > 0
           ORDER BY ultima_data DESC"""
    ).fetchall()
    return jsonify([dict(l) for l in linhas])


@app.get("/api/conversas/<int:conversa_id>/mensagens")
def mensagens(conversa_id):
    conversa = carregar_conversa(conversa_id)
    participantes = banco().execute(
        "SELECT nome, admin, ativo FROM participantes WHERE conversa_id = ? ORDER BY ativo DESC, admin DESC, nome",
        (conversa_id,),
    ).fetchall()
    return jsonify({
        "conversa": dict(conversa),
        "mensagens": [dict(l) for l in carregar_mensagens(conversa_id)],
        "participantes": [dict(p) for p in participantes],
    })


def carregar_conversa(conversa_id):
    conversa = banco().execute("SELECT id, nome, grupo, total FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
    if conversa is None:
        abort(404)
    return conversa


def carregar_mensagens(conversa_id):
    return banco().execute(
        """SELECT id, data, data_aproximada, de_mim, remetente, tipo, texto, midia, legenda, url,
                  latitude, longitude, duracao
           FROM mensagens WHERE conversa_id = ? ORDER BY ordem""",
        (conversa_id,),
    ).fetchall()


def consulta_fts(termo):
    """Converte o texto digitado numa consulta FTS5: todas as palavras, cada uma como prefixo."""
    palavras = re.findall(r"\w+", termo)
    return " AND ".join(f'"{p}"*' for p in palavras)


@app.get("/api/busca")
def busca():
    consulta = consulta_fts(request.args.get("q", ""))
    if not consulta:
        return jsonify([])
    conversa_id = request.args.get("conversa", type=int)
    filtro, parametros = "", [consulta]
    if conversa_id:
        filtro, parametros = "AND m.conversa_id = ?", [consulta, conversa_id]
    linhas = banco().execute(
        f"""SELECT m.id, m.conversa_id, c.nome AS conversa_nome, c.grupo, m.remetente, m.data, m.data_aproximada,
                   snippet(busca, -1, '[[', ']]', '…', 14) AS trecho
            FROM busca JOIN mensagens m ON m.id = busca.rowid JOIN conversas c ON c.id = m.conversa_id
            WHERE busca MATCH ? AND m.{SO_MENSAGENS} {filtro}
            ORDER BY {"m.ordem" if conversa_id else "m.data DESC"}
            LIMIT {2000 if conversa_id else 200}""",
        parametros,
    ).fetchall()
    return jsonify([dict(l) for l in linhas])


@app.get("/api/estatisticas")
def estatisticas():
    conversa_id = request.args.get("conversa", type=int)
    filtro, parametros = SO_MENSAGENS, []
    if conversa_id:
        carregar_conversa(conversa_id)
        filtro, parametros = f"{SO_MENSAGENS} AND conversa_id = ?", [conversa_id]
    con = banco()

    resumo = con.execute(
        f"""SELECT count(*) AS mensagens, sum(de_mim) AS enviadas,
                   sum(tipo = 'imagem') AS fotos, sum(tipo = 'audio') AS audios, sum(tipo = 'video') AS videos,
                   sum(tipo = 'link') AS links, count(DISTINCT conversa_id) AS conversas,
                   sum(data_aproximada) AS aproximadas, min(data) AS primeira, max(data) AS ultima
            FROM mensagens WHERE {filtro}""",
        parametros,
    ).fetchone()

    por_mes = con.execute(
        f"""SELECT strftime('%Y-%m', data, 'unixepoch', 'localtime') AS mes, count(*) AS n
            FROM mensagens WHERE {filtro} AND data IS NOT NULL GROUP BY mes ORDER BY mes""",
        parametros,
    ).fetchall()

    # Numa conversa: quem mais fala. No geral: as conversas mais ativas.
    if conversa_id:
        ranking = con.execute(
            f"""SELECT remetente AS nome, count(*) AS n FROM mensagens WHERE {filtro}
                GROUP BY remetente ORDER BY n DESC LIMIT 15""",
            parametros,
        ).fetchall()
    else:
        ranking = con.execute(
            f"""SELECT c.id, c.nome, count(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
                WHERE m.{filtro} GROUP BY c.id ORDER BY n DESC LIMIT 15"""
        ).fetchall()

    # Horários só com datas exatas: as reconstruídas podem errar em algumas horas
    grade = con.execute(
        f"""SELECT cast(strftime('%w', data, 'unixepoch', 'localtime') AS int) AS dia,
                   cast(strftime('%H', data, 'unixepoch', 'localtime') AS int) AS hora, count(*) AS n
            FROM mensagens WHERE {filtro} AND data_aproximada = 0 GROUP BY dia, hora""",
        parametros,
    ).fetchall()

    return jsonify({
        "resumo": dict(resumo),
        "por_mes": [dict(l) for l in por_mes],
        "ranking": [dict(l) for l in ranking],
        "grade": [dict(l) for l in grade],
    })


@app.get("/estatisticas")
def pagina_estatisticas():
    return render_template("estatisticas.html")


def formatar_dia(momento):
    return f"{momento.day} de {MESES[momento.month - 1]} de {momento.year}"


def formatar_duracao(segundos):
    return f"{segundos // 60}:{segundos % 60:02d}" if segundos else ""


@app.get("/conversas/<int:conversa_id>/pdf")
def exportar_pdf(conversa_id):
    """Página preparada para impressão; o navegador salva em PDF."""
    conversa = carregar_conversa(conversa_id)
    itens, dia_anterior = [], None
    datas = []
    for m in carregar_mensagens(conversa_id):
        if m["tipo"] in ("evento", "sistema") and not m["texto"]:
            continue
        momento = datetime.fromtimestamp(m["data"]) if m["data"] else None
        if momento:
            datas.append(momento)
        dia = formatar_dia(momento) if momento else "Data desconhecida"
        if dia != dia_anterior:
            itens.append({"separador": dia + (" (aprox.)" if m["data_aproximada"] else "")})
            dia_anterior = dia
        itens.append({
            **dict(m),
            "hora": ("~" if m["data_aproximada"] else "") + momento.strftime("%H:%M") if momento else "",
            "duracao_texto": formatar_duracao(m["duracao"]),
        })
    periodo = f"{formatar_dia(min(datas))} a {formatar_dia(max(datas))}" if datas else ""
    return render_template(
        "pdf.html", conversa=conversa, itens=itens, periodo=periodo,
        exportado_em=datetime.now().strftime("%d/%m/%Y %H:%M"),
    )


@app.get("/midia/<path:caminho>")
def midia(caminho):
    return send_from_directory(PASTA_MIDIA, caminho)


if __name__ == "__main__":
    if not BANCO.exists():
        sys.exit("Banco não encontrado. Rode antes: python importar.py")
    app.run(host="127.0.0.1", port=5050, debug=False)
