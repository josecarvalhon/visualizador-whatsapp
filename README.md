# Visualizador de WhatsApp

Mostra no navegador, no estilo do WhatsApp Web, as conversas de um backup do WhatsApp para iPhone
(`ChatStorage.sqlite` + `Contacts.sqlite` + pasta `Media`), com mensagens em ordem cronológica, fotos e áudios.

## Como usar

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 1. Gera data/whatsapp.db a partir do backup (só leitura na origem)
.venv/bin/python importar.py

# 2. Sobe o site em http://127.0.0.1:5050
.venv/bin/python app.py
```

Por padrão o backup é lido de `~/Downloads/resources`. Para outra pasta:

```bash
WHATSAPP_RECURSOS=/caminho/do/backup .venv/bin/python importar.py
WHATSAPP_RECURSOS=/caminho/do/backup .venv/bin/python app.py
```

A pasta precisa conter `ChatStorage_anon.sqlite`, `Contacts_anon.sqlite` e `Media/files/`.

## Como funciona

- `importar.py` lê os bancos do WhatsApp (abertos com `mode=ro&immutable=1`, nunca alterados) e grava um
  banco SQLite simples em `data/whatsapp.db`, com as tabelas `conversas` e `mensagens`.
- `app.py` (Flask) serve a página, a API (`/api/conversas`, `/api/conversas/<id>/mensagens`) e os
  arquivos de mídia direto da pasta do backup (`/midia/...`).
- `templates/` e `static/` têm a interface. Cada conversa tem endereço próprio: `/#conversa=<id>`.

Nem o banco gerado nem o backup entram no git: conversas pessoais ficam só na máquina.

## Particularidades deste backup

- **Datas truncadas:** a anonimização cortou parte dos timestamps para os 5 primeiros dígitos
  (`380556381` → `38055`). O importador reconstrói a data multiplicando por 10.000 e ajustando entre as
  mensagens vizinhas com data exata. Esses horários aparecem com `~` e o dia com "(aprox.)".
- **Mídia incompleta:** o banco cita ~3.000 arquivos, mas só 229 (fotos e áudios) vieram na pasta.
  As demais aparecem como "não disponível neste backup". Os arquivos são localizados pelo nome,
  porque na pasta estão em `Image/` e `Audio/`, e não no caminho original gravado no banco.
- **Áudios `.opus`** tocam no Chrome e no Firefox; o Safari pode não tocar.
