/* Estado do painel: api (window.CBS_API), atalho $ e o objeto estado (produtos, filtros,
   seleção, edição em curso). E guarda o que mais de um módulo reatribui (sinônimos). */
export const api = window.CBS_API;

export const $ = (sel) => document.querySelector(sel);

export const estado = {
  produtos: [], // {sku, descricao_tecnica, referencia, tags, fixo, categoria, areas, criado_em, + campos do motor de busca}
  filtro: "",
  semTags: false,
  categoria: "", // filtro: "" = todas, "-" = sem categoria, ou o nome da categoria
  categorias: [], // nomes cadastrados (inclui as que ainda não têm produtos)
  areas: [], // [{nome, icone}] cadastradas, na ordem do painel
  area: "", // filtro: "" = todas, "-" = sem área, ou o nome da área
  recentes: 0, // filtro: produtos incluídos nos últimos N dias (0 = qualquer data)
  pagina: 1,
  selecionados: new Set(), // SKUs marcados para edição em massa
  skuEmEdicao: null, // null = criando
  skuParaExcluir: null,
  importacao: null,
};

/** Estado que mais de um módulo do painel reatribui (o dicionário de sinônimos). */
export const E = {
  sinonimos: [], // [{ id, palavras }]
};
