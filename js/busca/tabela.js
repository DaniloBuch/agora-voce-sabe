/* Tabela de resultados: executa a busca, desenha a página (linhas, tags em uma linha,
   paginação), ordenação pelo título da coluna e o "Explorar catálogo completo". */
import { btnExportar } from "./exportar.js";
import { tbody, paginacao, resultsContainer, input } from "./dom.js";
import { motor, E, temFiltro, rotuloFiltro } from "./estado.js";
import { casaAlternativa, destacar } from "./motor.js";
import { normalizarEspacos, escaparHtml, ordemTexto } from "../comum/texto.js";
import { celulasLista } from "./lista-diaria-busca.js";
import { celulaCotacao } from "./cotacao-busca.js";
import { htmlAreasDoItem, renderizarAreas, renderizarCategorias } from "./gaveta.js";
import { celulaSite, carregarLinksDaPagina } from "./site.js";
import { fmtNum } from "../comum/numeros.js";
import { atualizarEndereco } from "./endereco.js";
import { fecharHistorico } from "./historico.js";
import { atualizarBotaoLimpar } from "./campo.js";
import { mostrarBusca } from "./vista.js";

const resultsInfo = document.getElementById("resultsInfo");

const ITENS_POR_PAGINA = 50;

const MAX_LINHAS_APELIDOS_PC = 1; // "Também conhecido por": 1 linha no computador

const MAX_LINHAS_APELIDOS_CELULAR = 2; // e até 2 no celular; o resto fica no "+N" (clique mostra todos)

/* ---------- Execução da busca ---------- */

function mensagemNaTabela(classe, html) {
  btnExportar.hidden = true;
  tbody.innerHTML = `<tr><td colspan="${numColunas()}" class="${classe}">${html}</td></tr>`;
  resultsInfo.innerText = "";
  paginacao.hidden = true;
}

export function executarBusca(termoOriginal, pagina = 1) {
  if (E.erroCarga) {
    E.estadoLista = null;
    mensagemNaTabela("msg-erro", "Não conseguimos carregar a base de produtos. Tente novamente em instantes.");
    return;
  }
  if (!E.carregado) {
    E.estadoLista = null;
    mensagemNaTabela("msg-vazio", "Carregando a base de produtos...");
    return;
  }

  // com categoria/área escolhida, a busca acontece só dentro dela
  let base = E.categoriaAtual ? E.database.filter((item) => item.categoria === E.categoriaAtual) : E.database;
  if (E.areaAtual) base = base.filter((item) => item.areas.includes(E.areaAtual));

  const r = motor.buscar(base, termoOriginal);
  const estado = {
    original: termoOriginal.trim(),
    consulta: r.consulta,
    itens: r.itens,
    nExatos: r.nExatos,
    destaque: r.destaque,
    destaqueParecidos: r.destaqueParecidos,
    correcao: r.correcao,
    modo: "busca",
  };

  if (r.vazia) {
    // sem termos: navega pela categoria (ou pelo catálogo inteiro) em ordem alfabética ("-palavra" tira produtos)
    estado.modo = temFiltro() ? "categoria" : E.modoExplorar && !r.consulta.excluidos.length ? "explorar" : "navegar";
    estado.itens = [...r.itens].sort((a, b) => a._alfa - b._alfa);
    estado.nExatos = estado.itens.length;
  }

  E.estadoLista = estado;
  E.paginaAtual = pagina;
  E.animarProximaTabela = true;
  renderizarPagina();
}

// 6 colunas normais; 8 quando há Lista Diária (Saldo e Preço campanha)
function numColunas() {
  return window.ListaDiaria && window.ListaDiaria.ativa() ? 8 : 6; // cotação, SKU, descrição, UM (+ saldo e preço), Ref., Site
}

function linhaProduto(item, termos) {
  // "Também conhecido por": as tags ficam visíveis sob a descrição, para ensinar os outros nomes do
  // produto (apelidos comerciais, marcas, termos técnicos). As que casaram com a busca vêm primeiro.
  let apelidosHtml = "";
  if (item.tags.length) {
    const casou = (tag) => termos.some((alt) => casaAlternativa(normalizarEspacos(tag), alt));
    const ordenadas = [...item.tags.filter(casou), ...item.tags.filter((tag) => !casou(tag))];
    const pills = ordenadas
      .map((tag) => `<span class="tag-pill${casou(tag) ? " tag-pill--casou" : ""}">${destacar(tag, termos)}</span>`)
      .join("");
    apelidosHtml =
      `<div class="apelidos"><span class="apelidos__rotulo">Também conhecido por</span>${pills}` +
      `<button type="button" class="apelidos__mais" aria-expanded="false" hidden></button></div>`;
  }

  const lista = celulasLista(item.sku);
  return `
        <tr>
          ${celulaCotacao(item)}
          <td class="col-sku"><button type="button" class="sku-copiar" data-sku="${escaparHtml(item.sku)}" title="Clique para copiar o código" aria-label="Copiar código ${escaparHtml(item.sku)}">${destacar(item.sku, termos)}</button></td>
          <td class="col-desc"><span class="desc-texto">${destacar(item.descricao, termos)}</span>${htmlAreasDoItem(item)}${apelidosHtml}${item.unidade ? `<span class="desc-um">UM: ${escaparHtml(item.unidade)}</span>` : ""}${lista.resumoMobile}</td>
          <td class="col-um">${item.unidade ? escaparHtml(item.unidade) : '<span class="lista-nd" title="Unidade não informada">—</span>'}</td>
          ${lista.colunas}
          <td class="col-ref">${destacar(item.referenciaOriginal, termos, item.referenciaOriginal.length - item.referencia.length)}</td>
          ${celulaSite(item)}
        </tr>
      `;
}

// Texto "Mostrando 51–100 de 312" (só quando há mais de uma página)
function faixaDaPagina(total, inicio, fim) {
  return total > ITENS_POR_PAGINA ? ` Mostrando <strong>${fmtNum.format(inicio + 1)}–${fmtNum.format(fim)}</strong>.` : "";
}

function textoExcluidos(consulta) {
  if (!consulta.excluidos.length) return "";
  return ` Sem: ${consulta.excluidos.map((e) => `<strong>${escaparHtml(e)}</strong>`).join(", ")}.`;
}

/* ---------- Ordenar pela coluna (clique no título) ---------- */

const ROTULO_ORDEM = { sku: "SKU", descricao: "Descrição", um: "UM", saldo: "Saldo", preco: "Preço camp.", ref: "Ref." };

const colunaDaLista = (col) => col === "saldo" || col === "preco";

function valorParaOrdem(item, col) {
  if (col === "sku") return item.sku;
  if (col === "descricao") return item.descricao;
  if (col === "ref") return item.referenciaOriginal;
  if (col === "um") return item.unidade || null;
  const v = window.ListaDiaria && window.ListaDiaria.ativa() ? window.ListaDiaria.obter(item.sku) : null;
  if (!v) return null;
  const n = col === "saldo" ? v.saldo : v.preco;
  return n === null || n === undefined || (col === "preco" && !n) ? null : n;
}

// Ordena os exatos e os "parecidos" separadamente (os parecidos continuam no fim, com o aviso).
// Quem não tem valor (sem saldo/preço, sem referência) vai sempre para o fim.
export function itensNaOrdem(estado) {
  if (!E.ordemColuna) return estado.itens;
  const { col, dir } = E.ordemColuna;
  const chave = `${col}.${dir}.${window.ListaDiaria && window.ListaDiaria.ativa() ? "L" : ""}`;
  if (estado._ordem === chave) return estado._ordenados;
  const cmp = (a, b) => {
    const va = valorParaOrdem(a, col), vb = valorParaOrdem(b, col);
    const vazioA = va === null || va === "", vazioB = vb === null || vb === "";
    if (vazioA || vazioB) return vazioA === vazioB ? a._alfa - b._alfa : vazioA ? 1 : -1;
    const r = typeof va === "number" ? va - vb : ordemTexto.compare(va, vb);
    return r * dir || a._alfa - b._alfa;
  };
  const exatos = estado.itens.slice(0, estado.nExatos).sort(cmp);
  const parecidos = estado.itens.slice(estado.nExatos).sort(cmp);
  estado._ordem = chave;
  estado._ordenados = exatos.concat(parecidos);
  return estado._ordenados;
}

function desenharCabecalhoOrdem() {
  document.querySelectorAll("th[data-ordem-col]").forEach((th) => {
    const ativo = E.ordemColuna && E.ordemColuna.col === th.dataset.ordemCol;
    th.setAttribute("aria-sort", ativo ? (E.ordemColuna.dir === 1 ? "ascending" : "descending") : "none");
    const b = th.querySelector("button");
    b.classList.toggle("is-ativo", Boolean(ativo));
    b.querySelector(".ordenar__seta").textContent = ativo ? (E.ordemColuna.dir === 1 ? "↑" : "↓") : "↕";
    const rot = ROTULO_ORDEM[th.dataset.ordemCol];
    b.setAttribute("aria-label", ativo
      ? `Ordenado por ${rot} (${E.ordemColuna.dir === 1 ? "crescente" : "decrescente"}). Clique para ${E.ordemColuna.dir === 1 ? "inverter" : "voltar à relevância"}`
      : `Ordenar por ${rot}`);
  });
}

function textoOrdem() {
  if (!E.ordemColuna) return "";
  const { col, dir } = E.ordemColuna;
  const sentido = col === "saldo" || col === "preco" ? (dir === 1 ? "menor primeiro" : "maior primeiro") : dir === 1 ? "A→Z" : "Z→A";
  return ` <span class="ordem-info">Ordenado por <strong>${ROTULO_ORDEM[col]}</strong> (${sentido}). <button type="button" class="btn-link" data-ordem-limpar>Voltar à relevância</button></span>`;
}

// 1º clique: crescente; 2º: decrescente; 3º: volta à relevância (a ordem da busca)
function clicarOrdem(col) {
  if (!E.ordemColuna || E.ordemColuna.col !== col) E.ordemColuna = { col, dir: 1 };
  else if (E.ordemColuna.dir === 1) E.ordemColuna = { col, dir: -1 };
  else E.ordemColuna = null;
  E.paginaAtual = 1;
  E.animarProximaTabela = true;
  renderizarPagina();
  atualizarEndereco();
  const b = document.querySelector(`th[data-ordem-col="${col}"] button`);
  if (b) b.focus();
}

export function renderizarPagina() {
  const estado = E.estadoLista;
  if (!estado) return;
  // sem Lista Diária não há como ordenar por saldo/preço: volta à relevância
  if (E.ordemColuna && colunaDaLista(E.ordemColuna.col) && !(window.ListaDiaria && window.ListaDiaria.ativa())) E.ordemColuna = null;
  desenharCabecalhoOrdem();
  const itens = itensNaOrdem(estado);
  const total = itens.length;
  const emCategoria = temFiltro() ? ` em <strong>${escaparHtml(rotuloFiltro())}</strong>` : "";

  if (total === 0) {
    let msg;
    if (temFiltro()) {
      msg = `Não encontramos nenhum produto em <strong>${escaparHtml(rotuloFiltro())}</strong> com esse termo. <button type="button" class="btn-link" data-limpar-categoria>${E.areaAtual && !E.categoriaAtual ? "Buscar em todas as áreas" : E.areaAtual ? "Tirar os filtros" : "Buscar em todas as categorias"}</button>`;
    } else if (estado.consulta.exatos.length || estado.consulta.excluidos.length) {
      msg = "Não encontramos nenhum produto com esse termo. Confira o trecho entre aspas e as palavras com hífen (-), que tiram produtos da lista.";
    } else {
      msg = "Não encontramos nenhum produto com esse termo. Tente o código, o nome técnico ou um apelido.";
    }
    mensagemNaTabela("msg-erro", msg);
    return;
  }

  const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
  E.paginaAtual = Math.min(Math.max(1, E.paginaAtual), totalPaginas);
  const inicio = (E.paginaAtual - 1) * ITENS_POR_PAGINA;
  const fim = Math.min(inicio + ITENS_POR_PAGINA, total);
  const nParecidos = total - estado.nExatos;
  const faixa = faixaDaPagina(total, inicio, fim);
  const excl = textoExcluidos(estado.consulta);
  let classeInfo = "results-info";

  if (estado.correcao) {
    resultsInfo.innerHTML =
      `Nenhum resultado exato para <strong>${escaparHtml(estado.correcao.original)}</strong>. ` +
      `Mostrando ${fmtNum.format(total)} resultado(s)${emCategoria} para ` +
      `<strong>${escaparHtml(estado.correcao.sugeridos.join(" "))}</strong>.${faixa}`;
    classeInfo += " results-info--alerta";
  } else if (estado.modo === "explorar") {
    resultsInfo.innerHTML = `<strong>Catálogo completo:</strong> ${fmtNum.format(total)} produtos em ordem alfabética.${faixa}`;
  } else if (estado.modo === "categoria" || estado.modo === "navegar") {
    resultsInfo.innerHTML = `<strong>${fmtNum.format(total)}</strong> produtos${emCategoria}, em ordem alfabética.${excl}${faixa}` +
      (estado.modo === "categoria" && total > ITENS_POR_PAGINA ? " Digite no campo de busca para refinar." : "");
  } else {
    const parecidos = nParecidos ? ` + <strong>${fmtNum.format(nParecidos)}</strong> parecido(s)` : "";
    resultsInfo.innerHTML = `<strong>${fmtNum.format(estado.nExatos)}</strong> resultado(s) encontrado(s)${emCategoria}${parecidos}.${excl}${faixa}`;
  }
  resultsInfo.insertAdjacentHTML("beforeend", textoOrdem());
  resultsInfo.className = classeInfo;

  const destaqueParecidos = estado.destaque.concat(estado.destaqueParecidos);
  let html = "";
  for (let i = inicio; i < fim; i++) {
    if (i >= estado.nExatos && (i === estado.nExatos || i === inicio)) {
      html += `<tr class="linha-divisoria"><td colspan="${numColunas()}">` +
        `<strong>Parecidos com a sua busca${i > estado.nExatos ? " (continuação)" : ""}</strong>` +
        `<span> · palavras com grafia próxima, caso algo tenha sido digitado diferente</span></td></tr>`;
    }
    html += linhaProduto(itens[i], i >= estado.nExatos ? destaqueParecidos : estado.destaque);
  }
  tbody.innerHTML = html;
  // linhas entram em cascata só numa busca, página ou ordem nova (redesenhos internos não piscam)
  tbody.classList.remove("entrando");
  if (E.animarProximaTabela) {
    void tbody.offsetWidth;
    tbody.classList.add("entrando");
    E.animarProximaTabela = false;
  }
  btnExportar.hidden = false;
  ajustarTags();
  carregarLinksDaPagina(estado.itens.slice(inicio, fim));
  renderizarPaginacao(totalPaginas);
}

/* ---------- Tags em uma linha (computador) ---------- */

// Mostra quantos nomes couberem (1 linha no computador, 2 no celular), sem cortar palavra.
// Se sobrar algum, aparece "+N"; o clique abre todos ali mesmo (e "mostrar menos" fecha).
const mqCelular = window.matchMedia("(max-width: 768px)");

// Linhas ocupadas: itens com o topo a menos de 8px um do outro estão na mesma linha
// (o rótulo e as tags têm alturas diferentes e ficam centralizados)
function contarLinhas(el) {
  // no celular o rótulo "Também conhecido por" fica numa linha própria, que não conta
  const topos = [...el.children]
    .filter((f) => !f.hidden && !(mqCelular.matches && f.classList.contains("apelidos__rotulo")))
    .map((f) => f.offsetTop)
    .sort((a, b) => a - b);
  let linhas = 0, ultimo = -Infinity;
  for (const t of topos) {
    if (t - ultimo > 8) { linhas++; ultimo = t; }
  }
  return linhas;
}

function ajustarApelidos(linha) {
  const pills = [...linha.querySelectorAll(":scope > .tag-pill")];
  const mais = linha.querySelector(":scope > .apelidos__mais");
  if (linha.classList.contains("is-aberto")) {
    pills.forEach((p) => (p.hidden = false));
    mais.hidden = false;
    mais.textContent = "mostrar menos";
    mais.setAttribute("aria-label", "Mostrar menos nomes");
    return;
  }
  const maxLinhas = mqCelular.matches ? MAX_LINHAS_APELIDOS_CELULAR : MAX_LINHAS_APELIDOS_PC;
  let n = pills.length;
  const aplicar = () => {
    pills.forEach((p, i) => (p.hidden = i >= n));
    const ocultos = pills.length - n;
    mais.hidden = ocultos === 0;
    mais.textContent = `+${ocultos} ${ocultos === 1 ? "nome" : "nomes"}`;
    mais.setAttribute("aria-label", `Ver mais ${ocultos} nome(s) deste produto`);
  };
  aplicar();
  while (n > 1 && contarLinhas(linha) > maxLinhas) {
    n--;
    aplicar();
  }
}

function ajustarTags() {
  tbody.querySelectorAll(".apelidos").forEach(ajustarApelidos);
}

let timeoutAjusteTags = null;

/* ---------- Paginação ---------- */

// Números visíveis: 1 … 4 5 6 … 20
function paginasVisiveis(atual, total) {
  const set = new Set([1, total, atual - 1, atual, atual + 1]);
  if (atual <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (atual >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => set.add(n));
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const saida = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) saida.push(null);
    saida.push(n);
  });
  return saida;
}

function renderizarPaginacao(totalPaginas) {
  if (totalPaginas <= 1) {
    paginacao.hidden = true;
    paginacao.innerHTML = "";
    return;
  }
  const botao = (rotulo, pagina, extra = "") =>
    `<button type="button" class="pag-btn${extra}" data-pagina="${pagina}"${pagina === E.paginaAtual && !extra ? ' aria-current="page"' : ""}` +
    `${extra && (pagina < 1 || pagina > totalPaginas) ? " disabled" : ""}>${rotulo}</button>`;
  paginacao.innerHTML =
    botao(`<span aria-hidden="true">‹</span> Anterior`, E.paginaAtual - 1, " pag-btn--seta") +
    `<span class="pag-numeros">` +
    paginasVisiveis(E.paginaAtual, totalPaginas)
      .map((n) => (n === null ? `<span class="pag-reticencias" aria-hidden="true">…</span>` : botao(String(n), n)))
      .join("") +
    `</span>` +
    `<span class="pag-resumo">Página ${E.paginaAtual} de ${totalPaginas}</span>` +
    botao(`Próxima <span aria-hidden="true">›</span>`, E.paginaAtual + 1, " pag-btn--seta");
  paginacao.hidden = false;
}

function irParaPagina(pagina) {
  if (!E.estadoLista) return;
  E.paginaAtual = pagina;
  E.animarProximaTabela = true;
  renderizarPagina();
  atualizarEndereco();
  // volta ao topo da lista (logo abaixo do cabeçalho fixo)
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topo-h")) || 77;
  const y = resultsContainer.getBoundingClientRect().top + window.scrollY - topo - 16;
  const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, y), behavior: suave ? "smooth" : "auto" });
}

/* ---------- Explorar o catálogo completo ---------- */

export function abrirCatalogo() {
  clearTimeout(E.timeoutBusca);
  fecharHistorico();
  input.value = "";
  atualizarBotaoLimpar();
  E.categoriaAtual = "";
  E.areaAtual = "";
  E.modoExplorar = true;
  renderizarAreas();
  renderizarCategorias();
  mostrarBusca();
  executarBusca("");
  atualizarEndereco();
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  resultsInfo.addEventListener("click", (e) => {
    if (!e.target.closest("[data-ordem-limpar]")) return;
    E.ordemColuna = null;
    E.paginaAtual = 1;
    renderizarPagina();
    atualizarEndereco();
  });

  document.querySelector("thead").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ordem]");
    if (b && E.estadoLista) clicarOrdem(b.dataset.ordem);
  });

  tbody.addEventListener("click", (e) => {
    const mais = e.target.closest(".apelidos__mais");
    if (!mais) return;
    const linha = mais.closest(".apelidos");
    const abrir = !linha.classList.contains("is-aberto");
    linha.classList.toggle("is-aberto", abrir);
    mais.setAttribute("aria-expanded", String(abrir));
    ajustarApelidos(linha);
  });

  window.addEventListener("resize", () => {
    clearTimeout(timeoutAjusteTags);
    timeoutAjusteTags = setTimeout(ajustarTags, 120);
  });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarTags);

  paginacao.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-pagina]");
    if (!btn || btn.disabled) return;
    irParaPagina(Number(btn.dataset.pagina));
  });

  document.getElementById("btnExplorar").addEventListener("click", () => {
    if (!E.carregado && !E.erroCarga) {
      // ainda carregando: abre já com o aviso e completa quando a base chegar
      E.modoExplorar = true;
      input.value = "";
      mostrarBusca();
      executarBusca("");
      return;
    }
    abrirCatalogo();
  });
}
