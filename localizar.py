"""Localiza CPF, CNPJ e dados de conta bancária no texto das mensagens.

CPF e CNPJ:
- no formato oficial (000.000.000-00 / 00.000.000/0000-00) entram sempre, com a indicação
  se os dígitos verificadores conferem;
- só com números (ou com outra pontuação) entram apenas se os dígitos verificadores
  conferirem, para não confundir com telefones e outros números longos.

Contas bancárias: "agência", "conta", "c/c", "poupança" etc. seguidos de números, mais o
nome do banco quando ele aparece na mesma mensagem.
"""
import re

# ---------- CPF / CNPJ ----------

CPF_FORMATADO = re.compile(r"(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d-])")
CNPJ_FORMATADO = re.compile(r"(?<![\d.])\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}(?![\d-])")
# Sequências de dígitos com separadores opcionais (espaço, ponto, hífen, barra)
NUMERO_LONGO = re.compile(r"(?<![\d.\-/])\d(?:[ .\-/]?\d){10,13}(?![\d])")


def _digitos(texto):
    return re.sub(r"\D", "", texto)


def cpf_valido(numero):
    if len(numero) != 11 or numero == numero[0] * 11:
        return False
    for tamanho in (9, 10):
        soma = sum(int(numero[i]) * (tamanho + 1 - i) for i in range(tamanho))
        digito = (soma * 10) % 11 % 10
        if digito != int(numero[tamanho]):
            return False
    return True


def cnpj_valido(numero):
    if len(numero) != 14 or numero == numero[0] * 14:
        return False
    pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    for tamanho in (12, 13):
        soma = sum(int(numero[i]) * pesos[i + 13 - tamanho] for i in range(tamanho))
        digito = 0 if soma % 11 < 2 else 11 - soma % 11
        if digito != int(numero[tamanho]):
            return False
    return True


def formatar_cpf(n):
    return f"{n[:3]}.{n[3:6]}.{n[6:9]}-{n[9:]}"


def formatar_cnpj(n):
    return f"{n[:2]}.{n[2:5]}.{n[5:8]}/{n[8:12]}-{n[12:]}"


def documentos(texto):
    achados, ocupados = [], []

    def livre(ini, fim):
        return all(fim <= a or ini >= b for a, b in ocupados)

    for regex, tipo, validar in ((CNPJ_FORMATADO, "CNPJ", cnpj_valido), (CPF_FORMATADO, "CPF", cpf_valido)):
        for m in regex.finditer(texto):
            numero = _digitos(m.group())
            achados.append({"tipo": tipo, "valor": m.group(), "valido": validar(numero), "inicio": m.start(), "fim": m.end()})
            ocupados.append(m.span())

    for m in NUMERO_LONGO.finditer(texto):
        if not livre(*m.span()):
            continue
        numero = _digitos(m.group())
        if len(numero) == 14 and cnpj_valido(numero):
            achados.append({"tipo": "CNPJ", "valor": formatar_cnpj(numero), "valido": True, "inicio": m.start(), "fim": m.end()})
        elif len(numero) == 11 and cpf_valido(numero):
            achados.append({"tipo": "CPF", "valor": formatar_cpf(numero), "valido": True, "inicio": m.start(), "fim": m.end()})
    return achados


# ---------- Contas bancárias ----------

BANCOS = [
    (r"banco do brasil|\bbb\b", "Banco do Brasil"),
    (r"caixa econ[oô]mica|\bcaixa\b|\bcef\b", "Caixa Econômica Federal"),
    (r"ita[uú]", "Itaú"),
    (r"bradesco", "Bradesco"),
    (r"santander", "Santander"),
    (r"nubank|\bnu\s*pagamentos", "Nubank"),
    (r"banco inter\b|\binter\b(?=.{0,30}\b(ag|conta|c/c))", "Inter"),
    (r"sicoob", "Sicoob"),
    (r"sicredi", "Sicredi"),
    (r"banrisul", "Banrisul"),
    (r"\bhsbc\b", "HSBC"),
    (r"\bc6\b", "C6 Bank"),
    (r"mercado\s*pago", "Mercado Pago"),
    (r"picpay", "PicPay"),
    (r"pagbank|pagseguro", "PagBank"),
    (r"\bbtg\b", "BTG Pactual"),
    (r"safra", "Safra"),
    (r"citibank|\bciti\b", "Citibank"),
]
BANCOS = [(re.compile(p, re.IGNORECASE), nome) for p, nome in BANCOS]

NUM_CONTA = r"(\d[\d.]{1,14}(?:\s?-\s?[\dxX])?)"
AGENCIA = re.compile(r"\b(?:ag[eê]ncia|agencia|ag\.?|agc\.?)\s*(?:n[º°o.]*\s*)?[:\-]?\s*" + NUM_CONTA, re.IGNORECASE)
CONTA = re.compile(
    r"\b(?:conta[\s-]*(?:corrente|poupan[cç]a|sal[aá]rio)?|cta\.?|ct\.|c\s?/\s?c|c\.c\.?|cc|c/p|poupan[cç]a|op\.?\s*\d{3})"
    r"\s*(?:n[º°o.]*\s*)?[:\-]?\s*" + NUM_CONTA,
    re.IGNORECASE,
)
# Conta escrita logo depois da agência, sem a palavra "conta": "Ag 1234 56789-0"
CONTA_APOS_AGENCIA = re.compile(r"\s*[,;/]?\s*(\d[\d.]{2,14}\s?-\s?[\dxX])(?![\d])")
CODIGO_BANCO = re.compile(r"\bbanco\s*(?:n[º°o.]*\s*)?[:\-]?\s*(\d{3})\b", re.IGNORECASE)


def contas(texto):
    agencias = [m for m in AGENCIA.finditer(texto) if len(_digitos(m.group(1))) >= 3]
    numeros = [m for m in CONTA.finditer(texto) if len(_digitos(m.group(1))) >= 4]
    for ag in agencias:
        seguinte = CONTA_APOS_AGENCIA.match(texto, ag.end())
        if seguinte and not any(n.start(1) == seguinte.start(1) for n in numeros):
            numeros.append(seguinte)
    if not agencias and not numeros:
        return []
    bancos = sorted({nome for regex, nome in BANCOS if regex.search(texto)})
    codigos = [m.group(1) for m in CODIGO_BANCO.finditer(texto)]
    partes = []
    if bancos or codigos:
        partes.append(" / ".join(bancos + [f"cód. {c}" for c in codigos]))
    partes += [f"Ag. {m.group(1).strip()}" for m in agencias]
    partes += [f"Conta {m.group(1).strip()}" for m in numeros]
    trechos = [m.span() for m in agencias + numeros]
    return [{
        "tipo": "Conta bancária",
        "valor": " · ".join(partes),
        "valido": None,
        "inicio": min(a for a, _ in trechos),
        "fim": max(b for _, b in trechos),
    }]


def localizar(texto):
    if not texto:
        return []
    return documentos(texto) + contas(texto)


def trecho(texto, inicio, fim, margem=60):
    """Pedaço do texto em volta da ocorrência, com ela marcada por [[ ]] (como a busca)."""
    a = max(0, inicio - margem)
    b = min(len(texto), fim + margem)
    return ("…" if a else "") + texto[a:inicio] + "[[" + texto[inicio:fim] + "]]" + texto[fim:b] + ("…" if b < len(texto) else "")
