# Visualizador de WhatsApp

Aplicação web local, em Python, que remonta as conversas de um **backup do WhatsApp para iPhone** e as
mostra no navegador com a aparência do WhatsApp Web: lista de conversas à esquerda e, à direita, as
mensagens em ordem cronológica, com fotos e áudios.

Os dados ficam em **SQLite** (já incluso no macOS e no Python); não é preciso instalar servidor de banco.

## Funcionalidades

- Lista das conversas (individuais e grupos), ordenadas pela mais recente, com prévia da última mensagem.
- **Busca em todas as conversas**, pelo campo da lateral: mostra as conversas pelo nome e as mensagens
  que contêm as palavras digitadas (sem diferenciar maiúsculas nem acentos). Clicar num resultado abre a
  conversa já na mensagem.
- **Busca dentro da conversa aberta** (🔍 no topo): destaca as palavras e navega entre as ocorrências
  com ▲ ▼ (ou `Enter` / `Shift+Enter`).
- **Dados da conversa** (clique no nome, no topo): fotos, áudios, vídeos e links reunidos, cada um com
  atalho para a mensagem, e a lista de participantes do grupo (com administradores e quem saiu).
- **Estatísticas** numa aba própria (📊 na lateral, ou no painel de dados de uma conversa): números
  gerais, mensagens por mês, quem mais fala ou as conversas mais ativas, e os dias e horários de maior
  movimento.
- **Buscador da página de estatísticas**, no backup inteiro ou na conversa escolhida no topo, com
  exportação para CSV e um botão para abrir cada mensagem no visualizador:
  - **Busca textual**: lista todas as ocorrências (até 5.000) com o trecho de cada uma.
  - **CPF, CNPJ e contas bancárias**: CPF e CNPJ no formato oficial (indicando se os dígitos verificadores
    conferem) ou só com números (apenas os válidos, para não confundir com telefones), e dados bancários
    (agência, conta, c/c, poupança e o banco, quando citado).
- Conversa em balões, como no WhatsApp: enviadas à direita (verde), recebidas à esquerda.
- Separadores por dia e horário em cada mensagem.
- Em grupos, nome de quem enviou, com uma cor por pessoa.
- Fotos embutidas e player para áudios.
- **Metadados de fotos e áudios**: ao abrir uma foto, um painel ao lado mostra os dados do WhatsApp (quem
  enviou, quando, em que conversa) e os do arquivo: formato real, tamanho, dimensões, EXIF (câmera, data da
  foto, GPS, quando existem), datas do arquivo e os hashes SHA-256 e MD5. Ao lado de cada áudio aparece um
  resumo (formato, canais, duração, tamanho), e o botão ⓘ abre o painel completo. Dá para copiar os
  metadados e baixar o arquivo.
- Links, localizações (abrem no OpenStreetMap), contatos compartilhados e eventos de grupo.
- Aviso de "não disponível neste backup" quando a mídia citada não está na pasta.
- Exportação da conversa em PDF: o botão **PDF** no topo da conversa abre uma versão para impressão
  em nova aba; escolha **"Salvar como PDF"** como destino no diálogo de impressão.
- Endereço próprio para cada conversa (`/#conversa=<id>`).
- Tema claro e escuro, acompanhando o sistema; layout adaptado a telas estreitas.

## Requisitos

- Python 3.10 ou mais novo (testado com 3.13)
- Flask (instalado pelo `requirements.txt`)
- Um navegador moderno (Chrome ou Firefox recomendados — veja [Áudios](#áudios-opus-no-safari))

## Instalação

```bash
cd ~/Documents/Projetos_GIT_HUB/visualizador-whatsapp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Uso

**1. Importar o backup** (só na primeira vez ou quando o backup mudar):

```bash
.venv/bin/python importar.py
```

Saída esperada:

```
163 conversas, 29266 mensagens, 229 arquivos de mídia → .../data/whatsapp.db
```

**2. Subir o site:**

```bash
.venv/bin/python app.py
```

Abra **http://127.0.0.1:5050** no navegador. Para encerrar, `Ctrl+C` no terminal.

## Configuração

| Variável de ambiente | Padrão | Para que serve |
|---|---|---|
| `WHATSAPP_RECURSOS` | `~/Downloads/resources` | Pasta do backup |
| `WHATSAPP_BANCO` | `data/whatsapp.db` | Banco SQLite gerado pelo importador |

Exemplo com o backup em outra pasta (use a mesma variável nos dois comandos, porque o site lê a mídia
direto do backup):

```bash
WHATSAPP_RECURSOS=/caminho/do/backup .venv/bin/python importar.py
WHATSAPP_RECURSOS=/caminho/do/backup .venv/bin/python app.py
```

A pasta do backup precisa ter esta estrutura:

```
resources/
├── ChatStorage_anon.sqlite     # conversas e mensagens
├── Contacts_anon.sqlite        # agenda de contatos
└── Media/
    └── files/
        ├── Image/              # fotos (.jpg)
        └── Audio/              # áudios (.opus, .aac, ...)
```

O site escuta só em `127.0.0.1` (acessível apenas deste computador), na porta `5050`.

## Estrutura do projeto

```
visualizador-whatsapp/
├── config.py           # caminhos (backup, banco gerado)
├── importar.py         # backup do WhatsApp → data/whatsapp.db
├── app.py              # servidor Flask: página, API e mídia
├── metadados.py        # lê formato, dimensões, EXIF, áudio e hashes dos arquivos de mídia
├── localizar.py        # encontra CPF, CNPJ e dados bancários no texto
├── templates/
│   ├── index.html      # esqueleto da página
│   ├── estatisticas.html  # página de estatísticas
│   └── pdf.html        # versão da conversa para imprimir / salvar em PDF
├── static/
│   ├── estilo.css      # visual no estilo do WhatsApp Web
│   ├── app.js          # lista, conversa, buscas, painel de dados
│   ├── estatisticas.css
│   └── estatisticas.js # cartões e gráficos (SVG feito à mão, sem bibliotecas)
├── requirements.txt
└── data/               # banco gerado (fora do git)
```

## Como funciona

```
ChatStorage_anon.sqlite ─┐
Contacts_anon.sqlite ────┼─► importar.py ─► data/whatsapp.db ─► app.py (Flask) ─► navegador
Media/files/ ────────────┘                                        │
                         └──────────── fotos e áudios ────────────┘
```

1. **Importação** — `importar.py` abre os bancos do WhatsApp em modo somente leitura
   (`mode=ro&immutable=1`; os originais nunca são alterados) e, para cada conversa:
   - resolve o nome (da conversa, da agenda ou do membro do grupo);
   - ordena as mensagens pelo campo `ZSORT` do WhatsApp, que segue a ordem real de envio;
   - reconstrói as datas truncadas (veja [Datas aproximadas](#datas-aproximadas));
   - localiza o arquivo de cada foto ou áudio na pasta `Media/files`.
2. **Servidor** — `app.py` lê `data/whatsapp.db` em modo somente leitura e entrega a página, a API JSON e
   os arquivos de mídia.
3. **Interface** — `static/app.js` busca as conversas e desenha as mensagens; `static/estatisticas.js`
   monta a página de estatísticas.

### Banco gerado (`data/whatsapp.db`)

**`conversas`**

| Coluna | Descrição |
|---|---|
| `id` | Mesmo identificador da conversa no WhatsApp |
| `nome` | Nome do contato ou do grupo |
| `jid` | Identificador do WhatsApp (`numero@s.whatsapp.net` ou `...@g.us` para grupos) |
| `grupo` | `1` para grupo, `0` para conversa individual |
| `total` | Quantidade de mensagens |
| `ultima_data` | Data da última mensagem (Unix) |
| `ultima_previa` | Texto exibido na lista |

**`mensagens`**

| Coluna | Descrição |
|---|---|
| `conversa_id` | Conversa a que pertence |
| `ordem` | Posição cronológica dentro da conversa |
| `data` | Data/hora (Unix) |
| `data_aproximada` | `1` se a data foi reconstruída |
| `de_mim` | `1` se foi enviada pelo dono do backup |
| `remetente` | Nome de quem enviou (`Você` para as próprias) |
| `tipo` | `texto`, `imagem`, `video`, `audio`, `contato`, `localizacao`, `link`, `evento` ou `sistema` |
| `texto` | Texto da mensagem ou descrição do evento |
| `midia` | Caminho do arquivo dentro de `Media/files` (vazio se não veio no backup) |
| `legenda` | Legenda da foto/vídeo ou título do link |
| `url` | Endereço, para mensagens do tipo link |
| `latitude`, `longitude` | Para mensagens de localização |
| `duracao` | Duração em segundos de áudios e vídeos |

**`participantes`**: membros de cada grupo (`conversa_id`, `nome`, `admin`, `ativo`).

**`busca`**: índice de texto (FTS5) sobre `texto` e `legenda` das mensagens, que ignora maiúsculas e acentos.

Como é SQLite comum, dá para consultar direto:

```bash
sqlite3 data/whatsapp.db "SELECT nome, total FROM conversas ORDER BY total DESC LIMIT 10"
```

### API

| Rota | Retorno |
|---|---|
| `GET /` | Página do visualizador |
| `GET /api/conversas` | Lista de conversas com mensagens, da mais recente para a mais antiga |
| `GET /api/conversas/<id>/mensagens` | `{conversa, mensagens, participantes}` em ordem cronológica (404 se não existir) |
| `GET /api/busca?q=<texto>[&conversa=<id>][&limite=<n>]` | Mensagens com todas as palavras (cada uma como começo de palavra) e um trecho com elas marcadas. Sem `conversa`: as 200 mais recentes do backup; com `conversa`: até 2000, em ordem cronológica. `limite` (até 5000) pede a lista completa, com trechos maiores |
| `GET /api/localizar[?conversa=<id>]` | CPF, CNPJ e dados bancários encontrados nas mensagens, com o trecho de cada um |
| `GET /api/mensagens/<id>/metadados` | `{whatsapp, arquivo, exif}` de uma foto ou áudio (404 se a mensagem não tiver arquivo) |
| `GET /api/estatisticas[?conversa=<id>]` | `{resumo, por_mes, ranking, grade}` do backup inteiro ou de uma conversa |
| `GET /estatisticas[?conversa=<id>]` | Página de estatísticas |
| `GET /conversas/<id>/pdf` | Página da conversa pronta para imprimir / salvar em PDF (404 se não existir) |
| `GET /midia/<caminho>` | Arquivo de foto ou áudio da pasta do backup |

### De onde vêm os dados no backup do WhatsApp

| Tabela original | Uso |
|---|---|
| `ZWACHATSESSION` | Conversas (`ZSESSIONTYPE` 0 = individual, 1 = grupo) |
| `ZWAMESSAGE` | Mensagens (`ZISFROMME`, `ZTEXT`, `ZMESSAGEDATE`, `ZSORT`, `ZMESSAGETYPE`) |
| `ZWAMEDIAITEM` | Mídia, legendas, links, localização e contatos compartilhados |
| `ZWAGROUPMEMBER` | Nome de quem enviou em grupos |
| `ZWAPHONE` + `ZWACONTACT` (Contacts) | Nomes da agenda para conversas que só têm o número |

Tipos de mensagem (`ZMESSAGETYPE`): 0 texto, 1 foto, 2 vídeo, 3 áudio, 4 contato, 5 localização,
6 evento de grupo, 7 link, 10 mensagem de sistema. As datas do iOS contam segundos a partir de
1º/01/2001; o importador soma `978307200` para converter em data Unix.

## Particularidades deste backup

### Datas aproximadas

A anonimização cortou cerca de 61% dos timestamps, deixando só os 5 primeiros dígitos
(`380556381` virou `38055`). O importador reconstrói a data assim:

1. multiplica o valor truncado por 10.000, o que dá um intervalo de ~2h47 em que a mensagem ocorreu;
2. estreita esse intervalo usando a mensagem anterior e a próxima que têm data exata;
3. usa o meio do intervalo resultante.

Na tela, esses horários aparecem com `~` (por exemplo, `~13:52`; passe o mouse para ver a explicação) e
o dia com "(aprox.)". A **ordem** das mensagens não é afetada, porque vem do campo `ZSORT`.

### Mídia incompleta

O banco cita cerca de 3.000 arquivos, mas só 229 vieram na pasta (61 fotos e 168 áudios; nenhum
vídeo). As mídias ausentes aparecem como "não disponível neste backup". Na pasta, os arquivos estão em
`Image/` e `Audio/`, e não no caminho original gravado no banco; por isso são localizados pelo nome.

### Extensão diferente do formato real

Os 39 áudios `.aac` do backup são, na verdade, Ogg Opus, e 3 fotos `.jpg` são PNG. O painel de metadados
mostra o formato real (lido da assinatura do arquivo) e avisa quando a extensão não corresponde.

### Áudios `.opus` no Safari

Os áudios `.opus` tocam no Chrome e no Firefox; o Safari pode não tocá-los. Os `.aac` tocam em todos.

## Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| `Banco não encontrado. Rode antes: python importar.py` | Rode o importador antes do servidor. |
| `Não encontrei .../ChatStorage_anon.sqlite` | A pasta do backup está em outro lugar: defina `WHATSAPP_RECURSOS`. |
| `Address already in use` | A porta 5050 está ocupada (talvez o site já esteja rodando). Feche o outro processo. |
| Fotos aparecem como "não disponível" | O arquivo não veio no backup, ou `WHATSAPP_RECURSOS` do `app.py` aponta para outra pasta. |
| Áudio não toca | Use Chrome ou Firefox (veja acima). |
| Mudou o backup e nada mudou na tela | Rode `importar.py` de novo; ele recria `data/whatsapp.db` do zero. |
| Erro `no such column: duracao` ou `no such table: busca` | O banco foi gerado por uma versão anterior. Rode `importar.py` de novo. |
| Página nova quebrada ou sem os botões novos depois de atualizar o código | Reinicie o `app.py` (ele guarda os modelos HTML na memória) e recarregue com `Cmd+Shift+R`. |
| Botões novos não aparecem | O navegador guardou a versão antiga dos arquivos: recarregue com `Cmd+Shift+R`. |

## Privacidade

- Tudo roda localmente; nada é enviado para a internet.
- O backup e o banco gerado (`data/`) **não entram no git** (`.gitignore`), para que conversas
  pessoais não subam para nenhum repositório.
- Os bancos originais do WhatsApp são abertos apenas para leitura.
