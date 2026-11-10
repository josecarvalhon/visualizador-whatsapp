const $ = (id) => document.getElementById(id);
const fmtNum = new Intl.NumberFormat("pt-BR");
const fmtCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const SVG = "http://www.w3.org/2000/svg";

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

function svg(tag, atributos = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  return e;
}

const plural = (n, um, varios) => `${fmtNum.format(n)} ${n === 1 ? um : varios}`;
const nomeMes = (chave) => {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
};

/* Dica que acompanha o mouse */

function mostrarDica(evento, titulo, valor) {
  const dica = $("dica");
  dica.replaceChildren(el("div", "dica-titulo", titulo), el("div", "dica-valor", valor));
  dica.hidden = false;
  const { innerWidth: w } = window;
  const x = Math.min(evento.clientX + 14, w - dica.offsetWidth - 8);
  dica.style.left = `${Math.max(8, x)}px`;
  dica.style.top = `${evento.clientY + 16}px`;
}

const esconderDica = () => ($("dica").hidden = true);

/* Números rápidos */

function cartao(rotulo, valor, detalhe, classe = "") {
  const c = el("div", `cartao ${classe}`);
  c.append(el("div", "cartao-rotulo", rotulo), el("div", "cartao-valor", valor));
  if (detalhe) c.append(el("div", "cartao-detalhe", detalhe));
  return c;
}

function desenharCartoes(r, geral) {
  const area = $("cartoes");
  const pct = (n) => (r.mensagens ? `${Math.round((100 * n) / r.mensagens)}% do total` : "");
  area.append(
    cartao("Mensagens", fmtNum.format(r.mensagens)),
    cartao("Enviadas por você", fmtNum.format(r.enviadas || 0), pct(r.enviadas || 0)),
    cartao("Recebidas", fmtNum.format(r.mensagens - (r.enviadas || 0)), pct(r.mensagens - (r.enviadas || 0))),
  );
  if (geral) area.append(cartao("Conversas", fmtNum.format(r.conversas)));
  area.append(
    cartao("Fotos", fmtNum.format(r.fotos || 0)),
    cartao("Áudios", fmtNum.format(r.audios || 0)),
    cartao("Vídeos", fmtNum.format(r.videos || 0)),
    cartao("Links", fmtNum.format(r.links || 0)),
  );
  if (r.primeira) {
    area.append(cartao("Período", `${fmtCurta.format(new Date(r.primeira * 1000))} – ${fmtCurta.format(new Date(r.ultima * 1000))}`, null, "cartao-periodo"));
  }
}

/* Mensagens por mês: colunas */

function mesesCompletos(porMes) {
  if (!porMes.length) return [];
  const contagem = new Map(porMes.map((l) => [l.mes, l.n]));
  let [ano, mes] = porMes[0].mes.split("-").map(Number);
  const [anoFim, mesFim] = porMes[porMes.length - 1].mes.split("-").map(Number);
  const meses = [];
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    meses.push({ mes: chave, n: contagem.get(chave) || 0 });
    if (++mes > 12) [ano, mes] = [ano + 1, 1];
  }
  return meses;
}

function passoRedondo(bruto) {
  const base = 10 ** Math.floor(Math.log10(bruto));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= bruto) return m * base;
  return 10 * base;
}

// Coluna com os cantos de cima arredondados e a base reta, presa ao eixo
function coluna(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function desenharMeses(meses) {
  const area = $("grafico-mes");
  area.replaceChildren();
  if (!meses.length) {
    area.append(el("p", "nota", "Sem mensagens com data."));
    return;
  }
  const W = Math.max(area.clientWidth, 300);
  const H = 260;
  const m = { esq: 48, dir: 8, topo: 22, base: 28 };
  const largura = W - m.esq - m.dir;
  const altura = H - m.topo - m.base;
  const maximo = Math.max(...meses.map((l) => l.n));
  const passo = passoRedondo(maximo / 4 || 1);
  const teto = Math.ceil(maximo / passo) * passo || passo;
  const y = (n) => m.topo + altura - (n / teto) * altura;
  const faixa = largura / meses.length;
  const w = Math.max(1, Math.min(faixa - 2, 56));

  const raiz = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Mensagens por mês" });

  for (let v = 0; v <= teto; v += passo) {
    raiz.append(svg("line", { x1: m.esq, x2: W - m.dir, y1: y(v), y2: y(v), class: v ? "grade-linha" : "eixo" }));
    const t = svg("text", { x: m.esq - 8, y: y(v) + 4, "text-anchor": "end", class: "rotulo-eixo" });
    t.textContent = fmtNum.format(v);
    raiz.append(t);
  }

  // Poucos meses: nome de cada mês no eixo. Muitos: só os anos, pulando quando não cabem.
  if (meses.length <= 18) {
    meses.forEach((l, i) => {
      const [ano, mes] = l.mes.split("-");
      const t = svg("text", { x: m.esq + i * faixa + faixa / 2, y: H - 8, "text-anchor": "middle", class: "rotulo-eixo" });
      t.textContent = i === 0 || mes === "01" ? `${MESES[mes - 1].slice(0, 3)} ${ano}` : MESES[mes - 1].slice(0, 3);
      raiz.append(t);
    });
  }
  const anos = meses.map((l, i) => ({ ano: l.mes.slice(0, 4), i })).filter((a, i, todos) => i === 0 || a.ano !== todos[i - 1].ano);
  // Um primeiro ano com poucos meses colaria no rótulo do ano seguinte
  if (anos.length > 1 && (anos[1].i - anos[0].i) * faixa < 36) anos.shift();
  const cadaQuantos = Math.ceil(36 / (faixa * 12));
  anos.forEach((a, k) => {
    if (k % cadaQuantos || meses.length <= 18) return;
    const t = svg("text", { x: m.esq + a.i * faixa + 2, y: H - 8, class: "rotulo-eixo" });
    t.textContent = a.ano;
    raiz.append(t);
    if (a.i) raiz.append(svg("line", { x1: m.esq + a.i * faixa, x2: m.esq + a.i * faixa, y1: H - m.base, y2: H - m.base + 5, class: "eixo" }));
  });

  const colunas = svg("g", { class: "colunas" });
  const alvos = svg("g");
  meses.forEach((l, i) => {
    const x = m.esq + i * faixa + (faixa - w) / 2;
    const barra = l.n ? svg("path", { d: coluna(x, y(l.n), w, y(0) - y(l.n)), class: "coluna" }) : null;
    if (barra) colunas.append(barra);
    // Área de toque maior que a coluna: a faixa inteira, do topo ao eixo
    const alvo = svg("rect", { x: m.esq + i * faixa, y: m.topo, width: faixa, height: altura, class: "alvo" });
    alvo.addEventListener("mousemove", (e) => {
      barra?.classList.add("ativa");
      mostrarDica(e, nomeMes(l.mes), plural(l.n, "mensagem", "mensagens"));
    });
    alvo.addEventListener("mouseleave", () => {
      barra?.classList.remove("ativa");
      esconderDica();
    });
    alvos.append(alvo);
  });
  raiz.append(colunas);

  // Rótulo só no pico
  const pico = meses.findIndex((l) => l.n === maximo);
  const rotulo = svg("text", {
    x: Math.min(Math.max(m.esq + pico * faixa + faixa / 2, m.esq + 30), W - m.dir - 30),
    y: y(maximo) - 6,
    "text-anchor": "middle",
    class: "rotulo-valor",
  });
  rotulo.textContent = `${fmtNum.format(maximo)} · ${nomeMes(meses[pico].mes)}`;
  raiz.append(rotulo, alvos);
  area.append(raiz);
}

function tabelaMeses(meses) {
  const t = $("tabela-mes");
  const cab = el("tr");
  cab.append(el("th", null, "Mês"), el("th", null, "Mensagens"));
  t.append(cab);
  for (const l of meses.filter((l) => l.n)) {
    const tr = el("tr");
    tr.append(el("td", null, nomeMes(l.mes)), el("td", "num", fmtNum.format(l.n)));
    t.append(tr);
  }
}

/* Ranking: barras horizontais */

function desenharRanking(ranking, geral) {
  $("titulo-ranking").textContent = geral ? "Conversas mais ativas" : "Quem mais fala";
  const lista = $("ranking");
  const maximo = Math.max(1, ...ranking.map((r) => r.n));
  for (const r of ranking) {
    const li = el("li", "ranking-linha");
    const nome = el(geral ? "button" : "span", "ranking-nome", r.nome);
    if (geral) {
      nome.title = "Ver as estatísticas desta conversa";
      nome.addEventListener("click", () => escolher(r.id));
    }
    const trilho = el("div", "ranking-trilho");
    const barra = el("div", "ranking-barra");
    barra.style.width = `${(100 * r.n) / maximo}%`;
    trilho.append(barra);
    li.append(nome, trilho, el("span", "ranking-valor", fmtNum.format(r.n)));
    lista.append(li);
  }
  if (!ranking.length) lista.append(el("li", "nota", "Sem mensagens."));
}

/* Grade dia da semana × hora: uma cor, do claro ao escuro */

const NIVEIS = 6; // n0 (sem mensagens) a n5; as cores ficam em estatisticas.css

function nivel(n, maximo) {
  if (!n) return 0;
  return Math.max(1, Math.ceil(Math.sqrt(n / maximo) * 5));
}

function desenharGrade(grade, total) {
  const area = $("grade");
  const contagem = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of grade) contagem[c.dia][c.hora] = c.n;
  const maximo = Math.max(1, ...grade.map((c) => c.n));
  const exatas = grade.reduce((s, c) => s + c.n, 0);

  area.append(el("span"));
  for (let h = 0; h < 24; h++) area.append(el("span", "grade-hora", h % 3 ? "" : `${h}h`));
  // Começa na segunda, como uma semana de trabalho
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    area.append(el("span", "grade-dia", DIAS[d].slice(0, 3)));
    for (let h = 0; h < 24; h++) {
      const n = contagem[d][h];
      const celula = el("span", `celula n${nivel(n, maximo)}`);
      celula.addEventListener("mousemove", (e) => mostrarDica(e, `${DIAS[d]}, ${h}h–${h + 1}h`, plural(n, "mensagem", "mensagens")));
      celula.addEventListener("mouseleave", esconderDica);
      area.append(celula);
    }
  }

  const legenda = $("legenda-grade");
  legenda.append(el("span", null, "Menos"));
  for (let i = 0; i < NIVEIS; i++) legenda.append(el("span", `celula n${i}`));
  legenda.append(el("span", null, "Mais"));

  $("nota-grade").textContent = total
    ? `Considera só as ${fmtNum.format(exatas)} mensagens com horário exato (${Math.round((100 * exatas) / total)}% do total): ` +
      "nas datas reconstruídas o horário pode errar em algumas horas."
    : "";

  const t = $("tabela-grade");
  const cab = el("tr");
  cab.append(el("th", null, "Hora"));
  for (const d of [1, 2, 3, 4, 5, 6, 0]) cab.append(el("th", null, DIAS[d].slice(0, 3)));
  t.append(cab);
  for (let h = 0; h < 24; h++) {
    const tr = el("tr");
    tr.append(el("td", null, `${h}h`));
    for (const d of [1, 2, 3, 4, 5, 6, 0]) tr.append(el("td", "num", fmtNum.format(contagem[d][h])));
    t.append(tr);
  }
}

/* Buscador: texto livre ou CPF, CNPJ e contas bancárias */

const busca = { modo: "texto", resultados: null, termo: "", seq: 0 };
const AJUDA = {
  texto: "Encontra mensagens com todas as palavras digitadas, sem diferenciar maiúsculas nem acentos. " +
    "Cada palavra vale como começo de palavra: \"mono\" encontra \"monografia\". Lista até 5.000 ocorrências, das mais recentes para as mais antigas.",
  documentos: "Procura CPF e CNPJ (no formato oficial ou só com números; só com números, entram apenas os que têm " +
    "dígitos verificadores válidos, para não confundir com telefones) e dados bancários: agência, conta, c/c, poupança " +
    "e o nome do banco, quando aparece na mesma mensagem.",
};

function trechoMarcado(trecho) {
  const frag = document.createDocumentFragment();
  (trecho || "").split(/\[\[([\s\S]*?)\]\]/).forEach((parte, i) => {
    if (parte) frag.append(i % 2 ? el("mark", null, parte) : document.createTextNode(parte));
  });
  return frag;
}

const dataResultado = (r) => (r.data ? (r.data_aproximada ? "~" : "") + fmtCurta.format(new Date(r.data * 1000)) : "");

function linkMensagem(r) {
  const p = new URLSearchParams({ conversa: r.conversa_id, mensagem: r.id });
  if (busca.modo === "texto") p.set("termo", busca.termo);
  return `/#${p}`;
}

function trocarModo(modo) {
  busca.modo = modo;
  busca.resultados = null;
  document.querySelectorAll(".aba").forEach((a) => {
    a.classList.toggle("ativa", a.dataset.modo === modo);
    a.setAttribute("aria-selected", a.dataset.modo === modo);
  });
  $("termo").hidden = modo !== "texto";
  $("filtro-tipos").hidden = modo === "texto";
  $("botao-buscar").textContent = modo === "texto" ? "Buscar" : "Localizar";
  $("ajuda-busca").textContent = AJUDA[modo];
  $("resultado-busca").replaceChildren();
  if (modo === "texto") $("termo").focus();
}

async function buscar() {
  const conversa = $("filtro-conversa").value;
  const termo = $("termo").value.trim();
  if (busca.modo === "texto" && !termo) return $("termo").focus();
  const seq = ++busca.seq;
  const area = $("resultado-busca");
  area.replaceChildren(el("p", "est-carregando", "Procurando…"));
  const p = new URLSearchParams();
  if (conversa) p.set("conversa", conversa);
  let url;
  if (busca.modo === "texto") {
    p.set("q", termo);
    p.set("limite", "5000");
    url = `/api/busca?${p}`;
  } else {
    url = `/api/localizar?${p}`;
  }
  const resultados = await (await fetch(url)).json();
  if (seq !== busca.seq) return;
  busca.resultados = resultados;
  busca.termo = termo;
  desenharResultados();
}

function filtrados() {
  if (busca.modo === "texto") return busca.resultados;
  const tipos = new Set([...document.querySelectorAll("#filtro-tipos input[value]:checked")].map((c) => c.value));
  const soValidos = $("so-validos").checked;
  return busca.resultados.filter((r) => tipos.has(r.tipo) && !(soValidos && r.valido === false));
}

function desenharResultados() {
  const area = $("resultado-busca");
  area.replaceChildren();
  if (!busca.resultados) return;
  const lista = filtrados();
  const docs = busca.modo === "documentos";
  const conversas = new Set(lista.map((r) => r.conversa_id)).size;

  const topo = el("div", "resultado-topo");
  topo.append(el("strong", null, lista.length
    ? `${plural(lista.length, "ocorrência", "ocorrências")} em ${plural(conversas, "conversa", "conversas")}` +
      (busca.modo === "texto" && lista.length >= 5000 ? " (limite de 5.000 atingido)" : "")
    : "Nada encontrado."));
  if (lista.length) {
    const csv = el("button", "botao-secundario", "Baixar CSV");
    csv.addEventListener("click", () => baixarCsv(lista));
    topo.append(csv);
  }
  area.append(topo);
  if (!lista.length) return;

  if (docs) {
    // Resumo por valor: o mesmo CPF ou conta pode aparecer em várias mensagens
    const porValor = new Map();
    for (const r of lista) {
      const k = `${r.tipo}|${r.valor}`;
      porValor.set(k, (porValor.get(k) || 0) + 1);
    }
    area.append(el("p", "nota", `${plural(porValor.size, "valor diferente", "valores diferentes")}.`));
  }

  const tabela = el("table", "tabela-resultados");
  const cab = el("tr");
  const colunas = ["Data", "Conversa", "Remetente", ...(docs ? ["Tipo", "Valor"] : []), "Trecho", ""];
  for (const c of colunas) cab.append(el("th", null, c));
  tabela.append(cab);
  for (const r of lista) {
    const tr = el("tr");
    tr.append(el("td", "nowrap", dataResultado(r)), el("td", null, r.conversa_nome), el("td", null, r.remetente || ""));
    if (docs) {
      tr.append(el("td", "nowrap", r.tipo));
      const valor = el("td", "valor", r.valor);
      if (r.valido === false) {
        const aviso = el("span", "invalido", " ⚠ dígitos não conferem");
        valor.append(aviso);
      }
      tr.append(valor);
    }
    const trecho = el("td", "trecho");
    trecho.append(trechoMarcado(r.trecho));
    const abrir = el("a", "botao-secundario", "Abrir");
    abrir.href = linkMensagem(r);
    abrir.target = "visualizador";
    abrir.title = "Abrir a conversa nesta mensagem";
    const acao = el("td");
    acao.append(abrir);
    tr.append(trecho, acao);
    tabela.append(tr);
  }
  const rolavel = el("div", "tabela-rolavel tabela-grande");
  rolavel.append(tabela);
  area.append(rolavel);
}

function baixarCsv(lista) {
  const docs = busca.modo === "documentos";
  const cab = ["data", "data_aproximada", "conversa", "remetente", ...(docs ? ["tipo", "valor", "digitos_validos"] : []), "trecho", "mensagem_id"];
  const celula = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const linhas = lista.map((r) => [
    r.data ? new Date(r.data * 1000).toLocaleString("pt-BR") : "", r.data_aproximada ? "sim" : "não", r.conversa_nome, r.remetente,
    ...(docs ? [r.tipo, r.valor, r.valido == null ? "" : r.valido ? "sim" : "não"] : []),
    (r.trecho || "").replace(/\[\[|\]\]/g, ""), r.id,
  ].map(celula).join(";"));
  // BOM para o Excel reconhecer os acentos; ";" é o separador do Excel em português
  const blob = new Blob(["\ufeff" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  const nome = docs ? "documentos-e-contas" : `busca-${busca.termo.replace(/[^\p{L}\p{N}]+/gu, "-")}`;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".aba").forEach((a) => a.addEventListener("click", () => trocarModo(a.dataset.modo)));
$("form-busca").addEventListener("submit", (e) => {
  e.preventDefault();
  buscar();
});
$("filtro-tipos").addEventListener("change", desenharResultados);
trocarModo("texto");

/* Carregamento e filtro */

let mesesAtuais = [];
let pedido = 0;

async function carregar() {
  const id = $("filtro-conversa").value;
  const seq = ++pedido;
  const conteudo = $("conteudo");
  conteudo.replaceChildren(el("p", "est-carregando", "Carregando…"));
  const dados = await (await fetch(`/api/estatisticas${id ? `?conversa=${id}` : ""}`)).json();
  if (seq !== pedido) return;

  conteudo.replaceChildren($("modelo").content.cloneNode(true));
  const geral = !id;
  const nome = geral ? "Todas as conversas" : $("filtro-conversa").selectedOptions[0].dataset.nome;
  document.title = `Estatísticas — ${nome}`;

  const r = dados.resumo;
  desenharCartoes(r, geral);
  mesesAtuais = mesesCompletos(dados.por_mes);
  desenharMeses(mesesAtuais);
  tabelaMeses(mesesAtuais);
  desenharRanking(dados.ranking, geral);
  desenharGrade(dados.grade, r.mensagens);
  $("nota-geral").textContent = r.aproximadas
    ? `${fmtNum.format(r.aproximadas)} mensagens (${Math.round((100 * r.aproximadas) / r.mensagens)}%) têm data aproximada, ` +
      "reconstruída a partir das mensagens vizinhas. Isso não muda o mês na grande maioria dos casos. " +
      "Eventos de grupo e avisos do sistema não entram nas contagens."
    : "Eventos de grupo e avisos do sistema não entram nas contagens.";
}

function escolher(id) {
  $("filtro-conversa").value = id ? String(id) : "";
  const url = new URL(location.href);
  if (id) url.searchParams.set("conversa", id);
  else url.searchParams.delete("conversa");
  history.replaceState(null, "", url);
  window.scrollTo(0, 0);
  carregar();
  if (busca.resultados) buscar(); // refaz a busca no novo escopo
}

$("filtro-conversa").addEventListener("change", (e) => escolher(e.target.value));

let largura = 0;
new ResizeObserver(() => {
  const area = $("grafico-mes");
  if (area && area.clientWidth !== largura) {
    largura = area.clientWidth;
    desenharMeses(mesesAtuais);
  }
}).observe(document.body);

(async () => {
  const conversas = await (await fetch("/api/conversas")).json();
  const filtro = $("filtro-conversa");
  for (const c of [...conversas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))) {
    const op = el("option", null, `${c.nome} (${fmtNum.format(c.total)})`);
    op.value = c.id;
    op.dataset.nome = c.nome;
    filtro.append(op);
  }
  const pedida = new URLSearchParams(location.search).get("conversa");
  if (pedida && [...filtro.options].some((o) => o.value === pedida)) filtro.value = pedida;
  carregar();
})();
