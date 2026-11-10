const CORES = ["#00a884", "#d3396d", "#1f7aec", "#a5527f", "#e26b1b", "#7f66ff", "#25a2c3", "#c7802b", "#5e9e3c", "#b84f4f"];

const $ = (id) => document.getElementById(id);
let conversas = [];
let ativa = null;

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

/* Lista de conversas */

function desenharLista(filtro = "") {
  const termo = filtro.trim().toLowerCase();
  const lista = $("lista");
  lista.replaceChildren();
  for (const c of conversas) {
    if (termo && !c.nome.toLowerCase().includes(termo)) continue;
    const item = el("li", "item");
    item.dataset.id = c.id;
    if (ativa === c.id) item.classList.add("ativo");
    const corpo = el("div", "item-corpo");
    const linha1 = el("div", "item-linha");
    linha1.append(el("span", "item-nome", c.nome), el("span", "item-data", c.ultima_data ? fmtCurta.format(data(c.ultima_data)) : ""));
    corpo.append(linha1, el("div", "item-previa", c.ultima_previa || ""));
    item.append(avatar(c.nome, c.grupo), corpo);
    item.addEventListener("click", () => abrir(c.id));
    lista.append(item);
  }
}

/* Mensagens */

function conteudoMidia(m) {
  const frag = document.createDocumentFragment();
  const url = m.midia ? "/midia/" + m.midia.split("/").map(encodeURIComponent).join("/") : null;

  if (m.tipo === "imagem" && url) {
    const img = el("img", "foto");
    img.src = url;
    img.loading = "lazy";
    img.alt = m.legenda || "Foto";
    img.addEventListener("click", () => ampliar(url));
    img.addEventListener("load", manterNoFim);
    frag.append(img);
  } else if (m.tipo === "audio" && url) {
    const audio = el("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = url;
    frag.append(audio);
  } else {
    const rotulos = { imagem: "📷 Foto", video: "🎥 Vídeo", audio: "🎤 Áudio" };
    frag.append(el("div", "indisponivel", `${rotulos[m.tipo]} não disponível neste backup`));
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
  area.scrollTop = area.scrollHeight;
}

// Fotos carregam depois do desenho e empurram o fim da conversa para baixo;
// segue acompanhando o fim até a pessoa rolar por conta própria.
let presoNoFim = true;

function manterNoFim() {
  if (presoNoFim) $("mensagens").scrollTop = $("mensagens").scrollHeight;
}

for (const evento of ["wheel", "touchmove", "keydown", "mousedown"]) {
  $("mensagens").addEventListener(evento, () => (presoNoFim = false), { passive: true });
}

async function abrir(id) {
  ativa = id;
  history.replaceState(null, "", `#conversa=${id}`);
  document.querySelectorAll(".item").forEach((i) => i.classList.toggle("ativo", Number(i.dataset.id) === id));
  $("vazio").hidden = true;
  $("chat").hidden = false;
  $("app").classList.add("com-chat");
  $("mensagens").replaceChildren(el("div", "carregando", "Carregando…"));

  const resp = await fetch(`/api/conversas/${id}/mensagens`);
  const { conversa, mensagens } = await resp.json();
  if (ativa !== id) return;

  avatar(conversa.nome, conversa.grupo, $("chat-avatar"));
  $("chat-nome").textContent = conversa.nome;
  $("chat-info").textContent = `${conversa.grupo ? "Grupo · " : ""}${conversa.total} mensagens`;
  desenharMensagens(conversa, mensagens);
}

function ampliar(url) {
  $("ampliacao-img").src = url;
  $("ampliacao").hidden = false;
}

$("ampliacao").addEventListener("click", () => ($("ampliacao").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("ampliacao").hidden = true;
});
$("voltar").addEventListener("click", () => {
  $("app").classList.remove("com-chat");
  history.replaceState(null, "", location.pathname);
});
$("busca").addEventListener("input", (e) => desenharLista(e.target.value));

(async () => {
  conversas = await (await fetch("/api/conversas")).json();
  $("contador").textContent = `${conversas.length} conversas`;
  desenharLista();
  const pedida = Number(new URLSearchParams(location.hash.slice(1)).get("conversa"));
  if (pedida) abrir(pedida);
})();
