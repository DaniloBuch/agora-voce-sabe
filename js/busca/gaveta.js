/* Gaveta de categorias e áreas de atuação: filtros, faixa do filtro ativo e selos "Indicado para". */
import { parametrosIniciais, E, temFiltro, rotuloFiltro } from "./estado.js";
import { normalizar, escaparHtml, normalizarEspacos } from "../comum/texto.js";
import { input, PLACEHOLDER_PADRAO, caixaCategorias } from "./dom.js";
import { fmtNum } from "../comum/numeros.js";
import { mostrarHome, mostrarBusca } from "./vista.js";
import { atualizarEndereco } from "./endereco.js";
import { executarBusca, abrirCatalogo } from "./tabela.js";
import { fecharHistorico } from "./historico.js";

let areasLista = []; // [{nome, icone, n}] só as que têm produtos, na ordem do painel

const iconesArea = new Map(); // nome da área -> chave do ícone

let areaDoLink = parametrosIniciais.get("area") || "";

const listaCategorias = document.getElementById("categoriasLista");

const filtroCategoria = document.getElementById("filtroCategoria");

const categoriasVazio = document.getElementById("categoriasVazio");

const botaoCategorias = document.getElementById("categoriasToggle");

const gavetaFundo = document.getElementById("gavetaFundo");

const botaoFecharGaveta = document.getElementById("gavetaFechar");

const filtroAtivo = document.getElementById("filtroAtivo");

const filtroAtivoNome = document.getElementById("filtroAtivoNome");

/* ---------- Categorias (gaveta) ---------- */

export function montarCategorias() {
  const contagem = new Map();
  for (const item of E.database) {
    if (item.categoria !== "-") contagem.set(item.categoria, (contagem.get(item.categoria) || 0) + 1);
  }
  E.categoriasLista = [...contagem.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
  );

  // categoria vinda do link (?cat=): aceita sem diferenciar maiúsculas/acentos
  if (E.categoriaDoLink) {
    const achada = E.categoriasLista.find(([nome]) => normalizar(nome) === normalizar(E.categoriaDoLink));
    if (achada) {
      E.categoriaAtual = achada[0];
    }
    E.categoriaDoLink = "";
  }
  renderizarCategorias();
}

// O botão de categorias já nasce visível; se a base não tiver categorias (ou falhar ao carregar), some
export function esconderCategorias() {
  botaoCategorias.hidden = true;
  filtroAtivo.hidden = true;
  E.categoriaAtual = "";
  definirGavetaAberta(false, false);
}

export function renderizarCategorias() {
  if (E.categoriasLista.length === 0 && areasLista.length === 0) {
    esconderCategorias(); // banco sem categorias nem áreas: o botão do cabeçalho some
    return;
  }
  botaoCategorias.hidden = false;
  listaCategorias.removeAttribute("aria-busy");
  filtroCategoria.disabled = false;

  const item = (nome, n, rotulo) =>
    `<button type="button" class="cat-item${nome ? "" : " cat-item--todas"}" data-categoria="${escaparHtml(nome)}" aria-pressed="${nome === E.categoriaAtual}">` +
    `<span>${escaparHtml(rotulo)}</span><span class="cat-item__n">${n}</span></button>`;
  listaCategorias.innerHTML =
    item("", E.database.length, "Todos os produtos") +
    E.categoriasLista.map(([nome, n]) => item(nome, n, nome)).join("");
  filtrarCategorias();

  atualizarFiltroAtivo();
}

// Faixa "Categoria: Luvas · Área: Hospitais  ×" sob o campo de busca
function atualizarFiltroAtivo() {
  botaoCategorias.classList.toggle("tem-selecao", temFiltro());
  botaoCategorias.setAttribute("aria-label", temFiltro() ? `Abrir categorias (selecionado: ${rotuloFiltro()})` : "Abrir categorias");
  filtroAtivo.hidden = !temFiltro();
  const partes = [];
  if (E.categoriaAtual) partes.push(`Categoria: <strong>${escaparHtml(E.categoriaAtual)}</strong>`);
  if (E.areaAtual) partes.push(`Área: ${htmlIconeArea(E.areaAtual, 14)}<strong>${escaparHtml(E.areaAtual)}</strong>`);
  filtroAtivoNome.innerHTML = partes.join('<span class="filtro-ativo__sep">·</span>');
  input.placeholder = temFiltro()
    ? `Refine em ${rotuloFiltro()}: tamanho, marca, código...`
    : PLACEHOLDER_PADRAO;
}

/* ---------- Áreas de atuação (gaveta + selos na busca) ---------- */

const caixaAreas = document.getElementById("areasFiltro");

const listaAreas = document.getElementById("areasLista");

function htmlIconeArea(nome, tam = 16) {
  return window.CBS_AREAS_ICONES ? window.CBS_AREAS_ICONES.svg(iconesArea.get(nome), tam) : "";
}

// cadastradas: [{nome, icone, ordem}] do banco. Só aparecem as que têm produtos.
export function montarAreas(cadastradas) {
  iconesArea.clear();
  const ordem = new Map();
  (cadastradas || []).forEach((a, i) => {
    iconesArea.set(a.nome, a.icone);
    ordem.set(a.nome, i);
  });
  const contagem = new Map();
  for (const item of E.database) for (const a of item.areas) contagem.set(a, (contagem.get(a) || 0) + 1);
  areasLista = [...contagem.entries()]
    .map(([nome, n]) => ({ nome, n }))
    .sort((a, b) => (ordem.get(a.nome) ?? 999) - (ordem.get(b.nome) ?? 999) || a.nome.localeCompare(b.nome, "pt-BR"));
  if (areaDoLink) {
    const achada = areasLista.find((a) => normalizar(a.nome) === normalizar(areaDoLink));
    if (achada) E.areaAtual = achada.nome;
    areaDoLink = "";
  }
  if (E.areaAtual && !contagem.has(E.areaAtual)) E.areaAtual = "";
  renderizarAreas();
}

export function renderizarAreas() {
  if (!caixaAreas) return;
  caixaAreas.hidden = areasLista.length === 0;
  document.getElementById("gavetaTitulo").textContent = areasLista.length ? "Filtros" : "Categorias";
  listaAreas.innerHTML = areasLista
    .map(
      (a) =>
        `<button type="button" class="area-chip" data-area="${escaparHtml(a.nome)}" aria-pressed="${a.nome === E.areaAtual}">` +
        `${htmlIconeArea(a.nome)}<span>${escaparHtml(a.nome)}</span><span class="area-chip__n">${fmtNum.format(a.n)}</span></button>`,
    )
    .join("");
  if (botaoCategorias) atualizarFiltroAtivo();
}

// Selos "Indicado para" na linha do produto (ícone + nome da área)
export function htmlAreasDoItem(item) {
  if (!item.areas.length) return "";
  const selos = item.areas
    .map((a) => `<span class="area-selo${a === E.areaAtual ? " area-selo--ativa" : ""}" title="Área de atuação: ${escaparHtml(a)}">${htmlIconeArea(a, 14)}${escaparHtml(a)}</span>`)
    .join("");
  return `<div class="areas-item"><span class="apelidos__rotulo">Indicado para</span>${selos}</div>`;
}

export function escolherCategoria(nome) {
  E.categoriaAtual = nome;
  E.modoExplorar = false;
  renderizarCategorias();
  clearTimeout(E.timeoutBusca);
  const termo = input.value.trim();
  if (!termo && !temFiltro()) {
    mostrarHome();
    atualizarEndereco();
    return;
  }
  mostrarBusca();
  executarBusca(termo);
  atualizarEndereco();
}

// Campo "Buscar categoria..." da gaveta: filtra a lista enquanto digita
function filtrarCategorias() {
  const termo = normalizarEspacos(filtroCategoria.value);
  let visiveis = 0;
  listaCategorias.querySelectorAll(".cat-item").forEach((btn) => {
    const nome = btn.dataset.categoria;
    const mostra = termo ? nome !== "" && normalizar(nome).includes(termo) : true;
    btn.hidden = !mostra;
    if (mostra) visiveis++;
  });
  categoriasVazio.hidden = visiveis > 0;
  categoriasVazio.textContent = visiveis ? "" : `Nenhuma categoria encontrada para "${filtroCategoria.value.trim()}".`;
}

// Gaveta de categorias (off-canvas): abre pelo botão do cabeçalho, fecha com Esc, fundo, « ou ao escolher
export function definirGavetaAberta(aberta, devolverFoco = true) {
  if (caixaCategorias.classList.contains("is-aberta") === aberta) return;
  caixaCategorias.classList.toggle("is-aberta", aberta);
  caixaCategorias.inert = !aberta;
  botaoCategorias.setAttribute("aria-expanded", String(aberta));
  gavetaFundo.hidden = false;
  requestAnimationFrame(() => gavetaFundo.classList.toggle("is-visivel", aberta));
  if (!aberta) {
    setTimeout(() => { if (!caixaCategorias.classList.contains("is-aberta")) gavetaFundo.hidden = true; }, 250);
    // ao fechar, o filtro da gaveta é limpo para a próxima vez
    if (filtroCategoria.value) {
      filtroCategoria.value = "";
      filtrarCategorias();
    }
  }
  if (aberta) {
    fecharHistorico();
    // com mouse/teclado, o foco vai para o campo de busca da gaveta; no celular, não (o teclado cobriria a lista)
    const pontoFino = window.matchMedia("(pointer: fine)").matches;
    const alvo =
      listaCategorias.querySelector('.cat-item[aria-pressed="true"]:not(.cat-item--todas)') ||
      (pontoFino && !filtroCategoria.disabled ? filtroCategoria : null) ||
      botaoFecharGaveta;
    setTimeout(() => alvo.focus({ preventScroll: true }), 50);
  } else if (devolverFoco) {
    botaoCategorias.focus({ preventScroll: true });
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  if (listaAreas) {
    listaAreas.addEventListener("click", (e) => {
      const botao = e.target.closest("button[data-area]");
      if (!botao) return;
      E.areaAtual = botao.dataset.area === E.areaAtual ? "" : botao.dataset.area; // clicar de novo desmarca
      renderizarAreas();
      escolherCategoria(E.categoriaAtual); // refaz a busca com o filtro novo
      definirGavetaAberta(false);
    });
  }

  listaCategorias.addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-categoria]");
    if (!botao) return;
    const nome = botao.dataset.categoria;
    const novo = nome === E.categoriaAtual ? "" : nome; // clicar de novo desmarca
    // "Todos os produtos" (ou desmarcar) sem nada digitado: abre o catálogo completo
    if (!novo && !input.value.trim() && nome === "") abrirCatalogo();
    else escolherCategoria(novo);
    definirGavetaAberta(false); // depois de escolher, a gaveta fecha e os resultados aparecem
  });

  filtroCategoria.addEventListener("input", filtrarCategorias);

  filtroCategoria.addEventListener("keydown", (e) => {
    const primeira = listaCategorias.querySelector(".cat-item:not([hidden])");
    if (e.key === "Enter" && primeira && filtroCategoria.value.trim()) {
      e.preventDefault();
      primeira.click(); // Enter escolhe a primeira categoria da lista filtrada
    } else if (e.key === "ArrowDown" && primeira) {
      e.preventDefault();
      primeira.focus();
    }
  });

  // setas para andar pela lista (e voltar ao campo de busca do topo)
  listaCategorias.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const itens = [...listaCategorias.querySelectorAll(".cat-item:not([hidden])")];
    const i = itens.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === "ArrowDown") (itens[i + 1] || itens[i]).focus();
    else if (i === 0 && !filtroCategoria.disabled) filtroCategoria.focus();
    else itens[i - 1].focus();
  });

  botaoCategorias.addEventListener("click", () => definirGavetaAberta(!caixaCategorias.classList.contains("is-aberta")));

  botaoFecharGaveta.addEventListener("click", () => definirGavetaAberta(false));

  gavetaFundo.addEventListener("click", () => definirGavetaAberta(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && caixaCategorias.classList.contains("is-aberta")) definirGavetaAberta(false);
  });

  document.getElementById("filtroAtivoLimpar").addEventListener("click", () => {
    E.areaAtual = "";
    renderizarAreas();
    escolherCategoria("");
    input.focus();
  });
}
