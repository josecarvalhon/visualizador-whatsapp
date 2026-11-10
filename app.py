"""Servidor web do visualizador. Rode `python importar.py` antes da primeira vez."""
import sqlite3
import sys

from flask import Flask, abort, g, jsonify, render_template, send_from_directory

from config import BANCO, PASTA_MIDIA

app = Flask(__name__)


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
    conversa = banco().execute("SELECT id, nome, grupo, total FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
    if conversa is None:
        abort(404)
    linhas = banco().execute(
        """SELECT id, data, data_aproximada, de_mim, remetente, tipo, texto, midia, legenda, url, latitude, longitude
           FROM mensagens WHERE conversa_id = ? ORDER BY ordem""",
        (conversa_id,),
    ).fetchall()
    return jsonify({"conversa": dict(conversa), "mensagens": [dict(l) for l in linhas]})


@app.get("/midia/<path:caminho>")
def midia(caminho):
    return send_from_directory(PASTA_MIDIA, caminho)


if __name__ == "__main__":
    if not BANCO.exists():
        sys.exit("Banco não encontrado. Rode antes: python importar.py")
    app.run(host="127.0.0.1", port=5050, debug=False)
