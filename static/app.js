const CORES = ["#00a884", "#d3396d", "#1f7aec", "#a5527f", "#e26b1b", "#7f66ff", "#25a2c3", "#c7802b", "#5e9e3c", "#b84f4f"];

const $ = (id) => document.getElementById(id);
let conversas = [];
let ativa = null;
// Conversa aberta: {conversa, mensagens, participantes}
let atual = null;

function corDe(texto) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

function iniciais(nome) {
  const partes = nome.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "#";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

function avatar(nome, grupo, alvo = el("div", "avatar")) {
  alvo.textContent = grupo ? "👥" : iniciais(nome);
  alvo.style.background = corDe(nome);
  return alvo;
}

const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const data = (s) => new Date(s * 1000);
const dataCurta = (m) => (m.data ? (m.data_aproximada ? "~" : "") + fmtCurta.format(data(m.data)) : "");
const duracao = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
const urlMidia = (caminho) => "/midia/" + caminho.split("/").map(encodeURIComponent).join("/");

function depois(ms, fn) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* Texto da busca: sem acentos nem maiúsculas, como o índice do servidor */

const semAcento = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const palavrasDe = (termo) => (termo.match(/[\p{L}\p{N}_]+/gu) || []).map(semAcento);

// O servidor marca as palavras encontradas com [[ ]] no trecho
function trechoMarcado(trecho) {
  const frag = document.createDocumentFragment();
  trecho.split(/\[\[(.*?)\]\]/).forEach((parte, i) => {
    if (parte) frag.append(i % 2 ? el("mark", null, parte) : document.createTextNode(parte));
  });
  return frag;
}

/* Lista de conversas e busca geral */

function itemConversa(c) {
  const item = el("li", "item");
  item.dataset.id = c.id;
  if (ativa === c.id) item.classList.add("ativo");
  const corpo = el("div", "item-corpo");
  const linha1 = el("div", "item-linha");
  linha1.append(el("span", "item-nome", c.nome), el("span", "item-data", c.ultima_data ? fmtCurta.format(data(c.ultima_data)) : ""));
  corpo.append(linha1, el("div", "item-previa", c.ultima_previa || ""));
  item.append(avatar(c.nome, c.grupo), corpo);
  item.addEventListener("click", () => abrir(c.id));
  return item;
}

function desenharLista(filtro = "") {
  const termo = semAcento(filtro.trim());
  const lista = $("lista");
  lista.replaceChildren();
  const achadas = conversas.filter((c) => !termo || semAcento(c.nome).includes(termo));
  if (termo && achadas.length) lista.append(el("li", "secao", "Conversas"));
  for (const c of achadas) lista.append(itemConversa(c));
}

let buscaGeralSeq = 0;

async function buscarEmTudo(termo) {
  const seq = ++buscaGeralSeq;
  if (palavrasDe(termo).length === 0 || termo.length < 2) return;
  const resultados = await (await fetch(`/api/busca?q=${encodeURIComponent(termo)}`)).json();
  if (seq !== buscaGeralSeq) return;

  const lista = $("lista");
  lista.querySelectorAll(".secao-mensagens, .resultado").forEach((e) => e.remove());
  const titulo = resultados.length
    ? `Mensagens${resultados.length >= 200 ? " (as 200 mais recentes)" : ` (${resultados.length})`}`
    : "Nenhuma mensagem encontrada";
  lista.append(el("li", "secao secao-mensagens", titulo));

  for (const r of resultados) {
    const item = el("li", "item resultado");
    const corpo = el("div", "item-corpo");
    const linha1 = el("div", "item-linha");
    linha1.append(el("span", "item-nome", r.conversa_nome), el("span", "item-data", dataCurta(r)));
    const previa = el("div", "item-previa");
    if (r.grupo || r.remetente === "Você") previa.append(el("strong", null, `${r.remetente}: `));
    previa.append(trechoMarcado(r.trecho || ""));
    corpo.append(linha1, previa);
    item.append(avatar(r.conversa_nome, r.grupo), corpo);
    item.addEventListener("click", () => abrir(r.conversa_id, { mensagem: r.id, termo }));
    lista.append(item);
  }
}

const buscarEmTudoDepois = depois(300, buscarEmTudo);

$("busca").addEventListener("input", (e) => {
  buscaGeralSeq++; // descarta respostas de buscas anteriores
  desenharLista(e.target.value);
  buscarEmTudoDepois(e.target.value.trim());
});

/* Mensagens */

function conteudoMidia(m) {
  const frag = document.createDocumentFragment();
  const url = m.midia ? urlMidia(m.midia) : null;

  if (m.tipo === "imagem" && url) {
    const img = el("img", "foto");
    img.src = url;
    img.loading = "lazy";
    img.alt = m.legenda || "Foto";
    img.addEventListener("click", () => ampliar(url));
    img.addEventListener("load", manterPosicao);
    frag.append(img);
  } else if (m.tipo === "audio" && url) {
    const audio = el("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = url;
    frag.append(audio);
  } else {
    const rotulos = { imagem: "📷 Foto", video: "🎥 Vídeo", audio: "🎤 Áudio" };
    const dur = duracao(m.duracao);
    frag.append(el("div", "indisponivel", `${rotulos[m.tipo]}${dur ? ` (${dur})` : ""} não disponível neste backup`));
  }
  if (m.legenda) frag.append(el("div", "legenda", m.legenda));
  if (m.texto) frag.append(el("div", "legenda", m.texto));
  return frag;
}

function conteudo(m) {
  switch (m.tipo) {
    case "imagem":
    case "video":
    case "audio":
      return conteudoMidia(m);
    case "link": {
      const frag = document.createDocumentFragment();
      if (m.legenda) frag.append(el("div", "link-titulo", m.legenda));
      if (m.url) {
        const a = el("a", null, m.url);
        a.href = m.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        frag.append(a);
      }
      if (m.texto && m.texto !== m.url) frag.append(el("div", "legenda", m.texto));
      return frag;
    }
    case "localizacao": {
      if (m.latitude == null || m.longitude == null) return el("span", null, "📍 Localização");
      const a = el("a", null, `📍 Localização (${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)})`);
      a.href = `https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=16/${m.latitude}/${m.longitude}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    }
    case "contato":
      return el("span", null, `👤 Contato: ${m.texto || "sem nome"}`);
    default:
      return document.createTextNode(m.texto || "");
  }
}

function desenharMensagens(conversa, mensagens) {
  const area = $("mensagens");
  area.replaceChildren();
  const frag = document.createDocumentFragment();
  let diaAnterior = null;
  let autorAnterior = null;

  for (const m of mensagens) {
    if ((m.tipo === "evento" || m.tipo === "sistema") && !m.texto) continue;
    const quando = m.data ? data(m.data) : null;
    const dia = quando ? fmtDia.format(quando) : "Data desconhecida";
    if (dia !== diaAnterior) {
      frag.append(el("div", "separador", m.data_aproximada ? `${dia} (aprox.)` : dia));
      diaAnterior = dia;
      autorAnterior = null;
    }

    if (m.tipo === "evento" || m.tipo === "sistema") {
      frag.append(el("div", "evento", m.texto));
      autorAnterior = null;
      continue;
    }

    const autor = m.de_mim ? "__eu__" : m.remetente;
    const balao = el("div", "balao" + (m.de_mim ? " enviado" : ""));
    balao.dataset.id = m.id;
    if (autor !== autorAnterior) {
      balao.classList.add("inicio");
      if (conversa.grupo && !m.de_mim) {
        const nome = el("div", "remetente", m.remetente);
        nome.style.color = corDe(m.remetente || "");
        balao.append(nome);
      }
    }
    autorAnterior = autor;

    const hora = el("span", "hora" + (m.data_aproximada ? " aprox" : ""));
    if (quando) hora.textContent = (m.data_aproximada ? "~" : "") + fmtHora.format(quando);
    if (m.data_aproximada) hora.title = "Horário aproximado: a data desta mensagem estava truncada no backup";
    balao.append(conteudo(m), hora);
    frag.append(balao);
  }
  area.append(frag);
  presoNoFim = true;
  fixada = null;
  area.scrollTop = area.scrollHeight;
}

// Fotos carregam depois do desenho e empurram o conteúdo. Até a pessoa rolar por conta
// própria, a tela segue presa ao fim da conversa ou à mensagem para onde ela pulou.
let presoNoFim = true;
let fixada = null;

function manterPosicao() {
  if (fixada) fixada.scrollIntoView({ block: "center" });
  else if (presoNoFim) $("mensagens").scrollTop = $("mensagens").scrollHeight;
}

for (const evento of ["wheel", "touchmove", "keydown", "mousedown"]) {
  $("mensagens").addEventListener(evento, () => {
    presoNoFim = false;
    fixada = null;
  }, { passive: true });
}

/* Ir até uma mensagem e destacar as palavras buscadas */

function limparDestaques() {
  for (const mark of $("mensagens").querySelectorAll("mark.achado")) {
    const pai = mark.parentNode;
    mark.replaceWith(mark.textContent);
    pai.normalize();
  }
  $("mensagens").querySelectorAll(".balao.foco").forEach((b) => b.classList.remove("foco"));
}

function destacar(raiz, palavras) {
  if (!palavras.length) return;
  const caminhante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (no) => (no.parentElement.closest(".hora, .remetente") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nos = [];
  while (caminhante.nextNode()) nos.push(caminhante.currentNode);

  for (const no of nos) {
    // Versão sem acentos do texto, com a posição de cada letra no texto original
    const original = no.data;
    let normal = "";
    const posicao = [];
    for (let i = 0; i < original.length; ) {
      const letra = String.fromCodePoint(original.codePointAt(i));
      for (const c of semAcento(letra)) {
        normal += c;
        posicao.push(i);
      }
      i += letra.length;
    }
    posicao.push(original.length);

    // Como no índice: cada palavra buscada casa com o começo de uma palavra do texto
    const trechos = [];
    for (const p of palavras) {
      for (let k = normal.indexOf(p); k !== -1; k = normal.indexOf(p, k + p.length)) {
        if (k === 0 || !/[\p{L}\p{N}_]/u.test(normal[k - 1])) trechos.push([posicao[k], posicao[k + p.length]]);
      }
    }
    if (!trechos.length) continue;
    trechos.sort((a, b) => a[0] - b[0]);

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const [ini, fim] of trechos) {
      if (ini < cursor) continue;
      frag.append(original.slice(cursor, ini), el("mark", "achado", original.slice(ini, fim)));
      cursor = fim;
    }
    frag.append(original.slice(cursor));
    no.replaceWith(frag);
  }
}

function irPara(mensagemId, termo = "") {
  const alvo = $("mensagens").querySelector(`.balao[data-id="${mensagemId}"]`);
  if (!alvo) return;
  limparDestaques();
  destacar(alvo, palavrasDe(termo));
  alvo.classList.add("foco");
  presoNoFim = false;
  fixada = alvo;
  alvo.scrollIntoView({ block: "center" });
  setTimeout(() => {
    if (fixada === alvo) fixada = null;
  }, 4000);
}

/* Busca dentro da conversa aberta */

const buscaChat = { ids: [], pos: -1, termo: "", seq: 0 };

function abrirBuscaChat(termo = "") {
  $("barra-busca").hidden = false;
  $("busca-chat").value = termo;
  $("busca-chat").focus();
}

function fecharBuscaChat() {
  $("barra-busca").hidden = true;
  $("busca-chat").value = "";
  $("busca-contador").textContent = "";
  Object.assign(buscaChat, { ids: [], pos: -1, termo: "" });
  buscaChat.seq++;
  limparDestaques();
}

async function buscarNaConversa(termo, preferida = null) {
  const id = ativa;
  const seq = ++buscaChat.seq;
  termo = termo.trim();
  if (!palavrasDe(termo).length) {
    Object.assign(buscaChat, { ids: [], pos: -1, termo: "" });
    $("busca-contador").textContent = "";
    limparDestaques();
    return;
  }
  $("busca-contador").textContent = "…";
  const resultados = await (await fetch(`/api/busca?q=${encodeURIComponent(termo)}&conversa=${id}`)).json();
  if (seq !== buscaChat.seq || ativa !== id) return;

  buscaChat.ids = resultados.map((r) => r.id);
  buscaChat.termo = termo;
  if (!buscaChat.ids.length) {
    buscaChat.pos = -1;
    $("busca-contador").textContent = "Nenhum resultado";
    limparDestaques();
    return;
  }
  // Começa pela mais recente, como no WhatsApp, a não ser que venha de um resultado clicado
  const i = buscaChat.ids.indexOf(preferida);
  buscaChat.pos = i >= 0 ? i : buscaChat.ids.length - 1;
  mostrarResultado();
}

function mostrarResultado() {
  const { ids, pos, termo } = buscaChat;
  $("busca-contador").textContent = `${pos + 1} de ${ids.length}${ids.length >= 2000 ? "+" : ""}`;
  irPara(ids[pos], termo);
}

function andarResultado(passo) {
  const n = buscaChat.ids.length;
  if (!n) return;
  buscaChat.pos = (buscaChat.pos + passo + n) % n;
  mostrarResultado();
}

const buscarNaConversaDepois = depois(300, buscarNaConversa);
$("abrir-busca").addEventListener("click", () => ($("barra-busca").hidden ? abrirBuscaChat() : fecharBuscaChat()));
$("busca-chat").addEventListener("input", (e) => buscarNaConversaDepois(e.target.value));
$("busca-chat").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    andarResultado(e.shiftKey ? 1 : -1);
  } else if (e.key === "Escape") {
    e.stopPropagation();
    fecharBuscaChat();
  }
});
$("busca-anterior").addEventListener("click", () => andarResultado(-1));
$("busca-proxima").addEventListener("click", () => andarResultado(1));
$("fechar-busca").addEventListener("click", fecharBuscaChat);

/* Painel "Dados da conversa" */

function secao(titulo, n) {
  const s = el("section", "dados-secao");
  s.append(el("h3", null, n == null ? titulo : `${titulo} (${n})`));
  return s;
}

function linhaIrPara(m, principal, extra) {
  const b = el("button", "dados-linha");
  b.title = "Ir para a mensagem";
  const textos = el("span", "dados-linha-textos");
  textos.append(el("span", "dados-linha-principal", principal), el("span", "dados-linha-extra", extra));
  b.append(textos, el("span", "dados-ir", "›"));
  b.addEventListener("click", () => irDoPainel(m.id));
  return b;
}

function irDoPainel(id) {
  if (matchMedia("(max-width: 1100px)").matches) fecharDados();
  irPara(id);
}

function desenharDados() {
  const { conversa, mensagens, participantes } = atual;
  const corpo = $("dados-corpo");
  corpo.replaceChildren();

  const capa = el("div", "dados-capa");
  const grande = avatar(conversa.nome, conversa.grupo);
  grande.classList.add("avatar-grande");
  const estat = el("a", "botao-topo", "📊 Estatísticas desta conversa");
  estat.href = `/estatisticas?conversa=${conversa.id}`;
  estat.target = "_blank";
  estat.rel = "noopener";
  capa.append(
    grande,
    el("div", "dados-nome", conversa.nome),
    el("div", "chat-info", `${conversa.grupo ? `Grupo · ${participantes.length} participantes · ` : ""}${conversa.total} mensagens`),
    estat,
  );
  corpo.append(capa);

  const fotos = mensagens.filter((m) => m.tipo === "imagem");
  const comArquivo = fotos.filter((m) => m.midia);
  const sFotos = secao("Fotos", fotos.length);
  if (comArquivo.length) {
    const grade = el("div", "dados-fotos");
    for (const m of comArquivo) {
      const b = el("button", "dados-foto");
      b.title = `${m.remetente} · ${dataCurta(m)} — ir para a mensagem`;
      const img = el("img");
      img.src = urlMidia(m.midia);
      img.loading = "lazy";
      img.alt = m.legenda || "Foto";
      b.append(img);
      b.addEventListener("click", () => irDoPainel(m.id));
      grade.append(b);
    }
    sFotos.append(grade);
  }
  if (fotos.length > comArquivo.length) {
    sFotos.append(el("p", "dados-nota", `${fotos.length - comArquivo.length} foto(s) não estão na pasta do backup.`));
  }
  if (fotos.length) corpo.append(sFotos);

  const listas = [
    ["Áudios", "audio", (m) => [`🎤 ${m.remetente}`, [dataCurta(m), duracao(m.duracao), m.midia ? "" : "indisponível"].filter(Boolean).join(" · ")]],
    ["Vídeos", "video", (m) => [`🎥 ${m.remetente}`, [dataCurta(m), duracao(m.duracao)].filter(Boolean).join(" · ")]],
    ["Links", "link", (m) => [m.legenda || m.url || m.texto || "Link", [m.legenda ? m.url : "", dataCurta(m)].filter(Boolean).join(" · ")]],
  ];
  for (const [titulo, tipo, textos] of listas) {
    const itens = mensagens.filter((m) => m.tipo === tipo);
    if (!itens.length) continue;
    const s = secao(titulo, itens.length);
    for (const m of itens) s.append(linhaIrPara(m, ...textos(m)));
    corpo.append(s);
  }

  if (conversa.grupo && participantes.length) {
    const s = secao("Participantes", participantes.length);
    for (const p of participantes) {
      const linha = el("div", "dados-participante" + (p.ativo ? "" : " saiu"));
      linha.append(avatar(p.nome, false), el("span", "dados-linha-principal", p.nome));
      if (p.admin) linha.append(el("span", "etiqueta", "admin"));
      if (!p.ativo) linha.append(el("span", "etiqueta", "saiu"));
      s.append(linha);
    }
    corpo.append(s);
  }

  if (corpo.children.length === 1) corpo.append(el("p", "dados-nota", "Esta conversa não tem fotos, áudios, vídeos nem links."));
}

function abrirDados() {
  if (!atual) return;
  desenharDados();
  $("dados").hidden = false;
  $("app").classList.add("com-dados");
}

function fecharDados() {
  $("dados").hidden = true;
  $("app").classList.remove("com-dados");
}

$("chat-titulo").addEventListener("click", () => ($("dados").hidden ? abrirDados() : fecharDados()));
$("fechar-dados").addEventListener("click", fecharDados);

/* Abrir conversa */

async function abrir(id, alvo = null) {
  const mesma = ativa === id && atual;
  ativa = id;
  history.replaceState(null, "", `#conversa=${id}`);
  document.querySelectorAll(".item:not(.resultado)").forEach((i) => i.classList.toggle("ativo", Number(i.dataset.id) === id));
  $("vazio").hidden = true;
  $("chat").hidden = false;
  $("app").classList.add("com-chat");
  $("exportar").href = `/conversas/${id}/pdf`;

  if (!mesma) {
    fecharBuscaChat();
    atual = null;
    $("mensagens").replaceChildren(el("div", "carregando", "Carregando…"));
    const resp = await fetch(`/api/conversas/${id}/mensagens`);
    const dados = await resp.json();
    if (ativa !== id) return;
    atual = dados;
    avatar(dados.conversa.nome, dados.conversa.grupo, $("chat-avatar"));
    $("chat-nome").textContent = dados.conversa.nome;
    $("chat-info").textContent = `${dados.conversa.grupo ? "Grupo · " : ""}${dados.conversa.total} mensagens`;
    desenharMensagens(dados.conversa, dados.mensagens);
    if (!$("dados").hidden) desenharDados();
  }

  // Veio de um resultado da busca geral: abre a busca da conversa já naquela mensagem
  if (alvo) {
    abrirBuscaChat(alvo.termo);
    buscarNaConversa(alvo.termo, alvo.mensagem);
  }
}

function ampliar(url) {
  $("ampliacao-img").src = url;
  $("ampliacao").hidden = false;
}

$("ampliacao").addEventListener("click", () => ($("ampliacao").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("ampliacao").hidden) $("ampliacao").hidden = true;
  else if (!$("dados").hidden) fecharDados();
});
$("voltar").addEventListener("click", () => {
  $("app").classList.remove("com-chat");
  fecharDados();
  history.replaceState(null, "", location.pathname);
});

(async () => {
  conversas = await (await fetch("/api/conversas")).json();
  $("contador").textContent = `${conversas.length} conversas`;
  desenharLista();
  const pedida = Number(new URLSearchParams(location.hash.slice(1)).get("conversa"));
  if (pedida) abrir(pedida);
})();
