/* Aba Produtos: lista com o filtro (mesmo motor da busca), filtros de categoria/área/data,
   paginação e seleção para edição em massa. */
import { criarMotor } from "../busca/motor.js";
import { estado, $, E } from "./estado.js";
import { chaveCat } from "./categorias.js";
import { fmtNum as fmt, fmtDataHora as fmtData, fmtDia } from "../comum/numeros.js";
import { separarTags } from "./util.js";
import { escaparHtml as esc } from "../comum/texto.js";
import { iconeArea } from "./areas.js";
import { abrirEdicao, abrirExclusao } from "./produto-dialogo.js";

const TAMANHO_PAGINA = 50;

/* ---------------- lista de produtos ---------------- */

// "Adicionados recentemente": produtos com data de inclusão dentro do período (os antigos não têm data)
const DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoPeriodo(dias) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return hoje.getTime() - (dias - 1) * DIA_MS;
}

const ehRecente = (p, dias = 30) => Boolean(p.criado_em) && Date.parse(p.criado_em) >= inicioDoPeriodo(dias);

/* ---- Filtro da lista: o MESMO motor da busca do site (js/busca/motor.js) ----
   "trecho exato" entre aspas, -palavra (ou -"trecho") para tirar, sinônimos do dicionário,
   palavras de ligação ignoradas (de, para...), referência com ou sem zeros à esquerda e
   resultado em ordem de relevância (código exato primeiro). Sem os "parecidos" por erro de
   digitação: aqui a lista serve para editar em massa, então só entra o que casa de verdade. */
export const motor = criarMotor();

let sinonimosNoMotor = null;

function filtrados() {
  if (sinonimosNoMotor !== E.sinonimos) {
    motor.definirSinonimos(E.sinonimos);
    sinonimosNoMotor = E.sinonimos;
  }
  const desde = estado.recentes ? inicioDoPeriodo(estado.recentes) : 0;
  const r = motor.buscar(estado.produtos, estado.filtro, { tolerancia: false });
  const lista = r.itens.filter(
    (p) =>
      (!estado.semTags || p.tags.trim() === "") &&
      (!estado.categoria || chaveCat(p.categoria) === chaveCat(estado.categoria)) &&
      (!estado.area || (estado.area === "-" ? p.areas.length === 0 : p.areas.some((a) => chaveCat(a) === chaveCat(estado.area)))) &&
      (!desde || (p.criado_em && Date.parse(p.criado_em) >= desde)),
  );
  // filtrando por data: do mais novo para o mais antigo; com texto: por relevância (já vem do motor)
  if (desde) lista.sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));
  return lista;
}

export function renderizarLista() {
  const lista = filtrados();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / TAMANHO_PAGINA));
  if (estado.pagina > totalPaginas) estado.pagina = totalPaginas;
  const ini = (estado.pagina - 1) * TAMANHO_PAGINA;
  const pagina = lista.slice(ini, ini + TAMANHO_PAGINA);

  const semTags = estado.produtos.filter((p) => p.tags.trim() === "").length;
  $("#infoLista").textContent =
    `${fmt.format(lista.length)} de ${fmt.format(estado.produtos.length)} produtos` +
    ` · ${fmt.format(semTags)} sem tags`;

  $("#corpoTabela").innerHTML =
    pagina.length === 0
      ? `<tr><td colspan="8" class="vazio">Nenhum produto encontrado com esse filtro.</td></tr>`
      : pagina
          .map((p) => {
            const tags = separarTags(p.tags);
            const tagsHtml =
              tags.length === 0
                ? `<span class="sem-tags">sem tags</span>`
                : tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("");
            const marcado = estado.selecionados.has(p.sku);
            return `<tr${marcado ? ' class="selecionada"' : ""}>
                <td class="c-sel"><input type="checkbox" data-sel="${esc(p.sku)}" aria-label="Selecionar ${esc(p.sku)}"${marcado ? " checked" : ""} /></td>
                <td class="c-sku">${esc(p.sku)}${p.fixo ? '<span class="selo" title="Fixo: nunca excluído pela importação">fixo</span>' : ""}${ehRecente(p) ? `<span class="selo selo--novo" title="Incluído em ${esc(fmtData.format(new Date(p.criado_em)))}">novo · ${esc(fmtDia.format(new Date(p.criado_em)))}</span>` : ""}</td>
                <td class="c-ref">${esc(p.referencia)}${p.unidade ? `<span class="c-ref__um" title="Unidade de medida">UM ${esc(p.unidade)}</span>` : ""}</td>
                <td class="c-desc">${esc(p.descricao_tecnica)}</td>
                <td class="c-cat so-categorias">${p.categoria === "-" ? '<span class="sem-categoria">–</span>' : esc(p.categoria)}</td>
                <td class="c-areas so-areas">${p.areas.length ? p.areas.map((a) => `<span class="area-ico-admin" title="${esc(a)}">${iconeArea(a, 16)}<span class="sr-only">${esc(a)}</span></span>`).join("") : '<span class="sem-categoria">–</span>'}</td>
                <td class="c-tags">${tagsHtml}</td>
                <td class="c-acoes">
                  <button class="btn btn--secundario btn--sm" data-acao="editar" data-sku="${esc(p.sku)}">${window.CBSIcon("pencil", 14)}Editar</button>
                  <button class="btn btn--secundario btn--sm btn--excluir" data-acao="excluir" data-sku="${esc(p.sku)}">${window.CBSIcon("trash-2", 14)}Excluir</button>
                </td>
              </tr>`;
          })
          .join("");

  atualizarSelecao(lista, pagina);
  $("#infoPagina").textContent = `Página ${estado.pagina} de ${totalPaginas}`;
  $("#btnAnterior").disabled = estado.pagina <= 1;
  $("#btnProxima").disabled = estado.pagina >= totalPaginas;
}

/* ---------------- seleção (edição em massa) ---------------- */

function atualizarSelecao(lista = filtrados(), pagina = null) {
  if (!pagina) {
    const ini = (estado.pagina - 1) * TAMANHO_PAGINA;
    pagina = lista.slice(ini, ini + TAMANHO_PAGINA);
  }
  const n = estado.selecionados.size;
  const marcadosPagina = pagina.filter((p) => estado.selecionados.has(p.sku)).length;
  const cab = $("#selPagina");
  cab.checked = pagina.length > 0 && marcadosPagina === pagina.length;
  cab.indeterminate = marcadosPagina > 0 && marcadosPagina < pagina.length;
  cab.disabled = pagina.length === 0;

  $("#barraSelecao").classList.toggle("tem-selecao", n > 0);
  const txt = $("#txtSelecao");
  txt.hidden = n === 0;
  txt.textContent = `${fmt.format(n)} ${n === 1 ? "selecionado" : "selecionados"}`;
  $("#btnLimparSel").hidden = n === 0;
  $("#btnTagsMassa").hidden = n === 0;

  // oferece selecionar todos os resultados do filtro (várias páginas)
  const btn = $("#btnSelFiltro");
  const faltam = lista.filter((p) => !estado.selecionados.has(p.sku)).length;
  const filtrando = lista.length < estado.produtos.length;
  btn.hidden = !(filtrando && faltam > 0 && lista.length > pagina.length);
  btn.textContent = `Selecionar os ${fmt.format(lista.length)} resultados do filtro`;
}

export function podarSelecao() {
  const existentes = new Set(estado.produtos.map((p) => p.sku));
  for (const sku of [...estado.selecionados]) if (!existentes.has(sku)) estado.selecionados.delete(sku);
}

let timerFiltro = null;

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#selPagina").addEventListener("change", (e) => {
    const lista = filtrados();
    const ini = (estado.pagina - 1) * TAMANHO_PAGINA;
    for (const p of lista.slice(ini, ini + TAMANHO_PAGINA)) {
      if (e.target.checked) estado.selecionados.add(p.sku);
      else estado.selecionados.delete(p.sku);
    }
    renderizarLista();
  });

  $("#btnSelFiltro").addEventListener("click", () => {
    filtrados().forEach((p) => estado.selecionados.add(p.sku));
    renderizarLista();
  });

  $("#btnLimparSel").addEventListener("click", () => {
    estado.selecionados.clear();
    renderizarLista();
  });

  $("#corpoTabela").addEventListener("change", (e) => {
    const cx = e.target.closest("input[data-sel]");
    if (!cx) return;
    if (cx.checked) estado.selecionados.add(cx.dataset.sel);
    else estado.selecionados.delete(cx.dataset.sel);
    cx.closest("tr").classList.toggle("selecionada", cx.checked);
    atualizarSelecao();
  });

  $("#filtro").addEventListener("input", (e) => {
    clearTimeout(timerFiltro);
    timerFiltro = setTimeout(() => {
      estado.filtro = e.target.value;
      estado.pagina = 1;
      renderizarLista();
    }, 200);
  });

  $("#filtroCategoria").addEventListener("change", (e) => {
    estado.categoria = e.target.value;
    estado.pagina = 1;
    renderizarLista();
  });

  $("#filtroArea").addEventListener("change", (e) => {
    estado.area = e.target.value;
    estado.pagina = 1;
    renderizarLista();
  });

  $("#filtroRecentes").addEventListener("change", (e) => {
    estado.recentes = Number(e.target.value) || 0;
    estado.pagina = 1;
    renderizarLista();
  });

  $("#filtroSemTags").addEventListener("change", (e) => {
    estado.semTags = e.target.checked;
    estado.pagina = 1;
    renderizarLista();
  });

  $("#btnAnterior").addEventListener("click", () => {
    estado.pagina--;
    renderizarLista();
  });

  $("#btnProxima").addEventListener("click", () => {
    estado.pagina++;
    renderizarLista();
  });

  $("#corpoTabela").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    const produto = estado.produtos.find((p) => p.sku === btn.dataset.sku);
    if (!produto) return;
    if (btn.dataset.acao === "editar") abrirEdicao(produto);
    else abrirExclusao(produto);
  });
}
