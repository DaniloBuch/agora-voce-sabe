/* Carga dos produtos, categorias, áreas e sinônimos; KPIs do topo. */
import { api, estado, $, E } from "./estado.js";
import { prepararProduto } from "./util.js";
import { carregarCategorias, atualizarSugestoesTags, renderizarCategorias } from "./categorias.js";
import { carregarAreas, renderizarAreas } from "./areas.js";
import { carregarNovidades } from "./novidades.js";
import { podarSelecao, renderizarLista } from "./produtos.js";
import { renderizarTags, indiceTags } from "./tags.js";
import { fmtNum as fmt } from "../comum/numeros.js";

/* ---------------- carga inicial ---------------- */

export async function carregarProdutos() {
  const dados = await api.listarProdutos();
  estado.produtos = dados.map(prepararProduto);
  await carregarCategorias();
  await carregarAreas();
  if (!E.sinonimos.length) {
    try { E.sinonimos = await api.listarSinonimos(); } catch (_) { /* sem a tabela: filtro sem sinônimos */ }
  }
  if (!estado._novidadesConferidas) {
    estado._novidadesConferidas = true;
    carregarNovidades(); // mostra no rótulo da aba quantas sugestões estão esperando
  }
  podarSelecao();
  atualizarSugestoesTags();
  atualizarKpis();
  renderizarLista();
  if (!$("#aba-tags").hidden) renderizarTags();
  if (!$("#aba-categorias").hidden) renderizarCategorias();
  if (!$("#aba-areas").hidden) renderizarAreas();
}

export function atualizarKpis() {
  $("#kpiProdutos").textContent = fmt.format(estado.produtos.length);
  $("#kpiSemTags").textContent = fmt.format(estado.produtos.filter((p) => p.tags.trim() === "").length);
  $("#kpiTags").textContent = fmt.format(indiceTags().size);
  $("#kpiCategorias").textContent = fmt.format(estado.categorias.length);
  $("#kpiSemCategoria").textContent = fmt.format(estado.produtos.filter((p) => p.categoria === "-").length);
}
