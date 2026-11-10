import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent

# Pasta com ChatStorage_anon.sqlite, Contacts_anon.sqlite e Media/files
PASTA_RECURSOS = Path(os.environ.get("WHATSAPP_RECURSOS", Path.home() / "Downloads" / "resources"))
PASTA_MIDIA = PASTA_RECURSOS / "Media" / "files"

# Banco SQLite gerado pelo importador
BANCO = Path(os.environ.get("WHATSAPP_BANCO", RAIZ / "data" / "whatsapp.db"))
