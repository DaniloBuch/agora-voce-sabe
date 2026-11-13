/* Edição em massa: tags (acrescentar/tirar), categoria, áreas e "Unir tags e categoria". */
import { criarEditorTags } from "./produto-dialogo.js";
import { $, estado, api } from "./estado.js";
import { separarTags, aviso } from "./util.js";
import { chaveCat } from "./categorias.js";
import { escaparHtml as esc, normalizar } from "../comum/texto.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { areasMassa, mudaAreas, desenharMassaAreas } from "./areas.js";
import { carregarProdutos } from "./carga.js";
import { renderizarLista } from "./produtos.js";

/* ---------------- diálogo: tags em massa ---------------- */

const editorAdd = criarEditorTags($("#chipsAdd"), $("#fAddInput"), () => atualizarMassa());

const editorRem = criarEditorTags($("#chipsRem"), $("#fRemInput"), () => atualizarMassa());

function produtosSelecionados() {
  return estado.produtos.filter((p) => estado.selecionados.has(p.sku));
}

// Espelha a função SQL editar_tags_em_massa: remove, depois acrescenta (sem repetir)
// mesma comparação do SQL (upper): ESFIGMOMANOMETRO e ESFIGMOMANÔMETRO são tags diferentes
export const chaveTag = (t) => String(t).trim().toLocaleUpperCase("pt-BR");

function simularTags(tagsAtuais, adicionar, remover) {
  const rem = new Set(remover.map(chaveTag));
  const resultado = [];
  const vistos = new Set();
  for (const t of [...separarTags(tagsAtuais), ...adicionar]) {
    const chave = chaveTag(t);
    if (rem.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(t);
  }
  return resultado.join(", ");
}

// categoria escolhida na edição em massa: "" = não alterar, "-" = tirar a categoria
const categoriaMassa = () => (api.categoriasDisponiveis() ? $("#fMassaCategoria").value : "");

const mudaCategoria = (p, cat) => cat !== "" && chaveCat(p.categoria) !== chaveCat(cat);

export function atualizarMassa() {
  const sel = produtosSelecionados();
  const add = editorAdd.obter();
  const rem = editorRem.obter();
  const cat = categoriaMassa();
  const btn = $("#btnAplicarMassa");

  const contagem = new Map();
  for (const p of sel) for (const t of separarTags(p.tags)) contagem.set(t, (contagem.get(t) || 0) + 1);
  const presentes = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  $("#massaPresentes").innerHTML = presentes.length
    ? `<span class="dica">Tags já presentes na seleção (clique para remover):</span> ` +
      presentes
        .slice(0, 40)
        .map(([t, n]) => `<button type="button" class="tag-pill tag-pill--acao" data-rem="${esc(t)}">${esc(t)} · ${fmt.format(n)}</button>`)
        .join("")
    : "";

  const ar = areasMassa();
  if (add.length === 0 && rem.length === 0 && cat === "" && !ar.add.length && !ar.rem.length) {
    $("#massaPreview").innerHTML = `<span class="dica">Escolha tags para adicionar ou remover, uma categoria ou áreas de atuação.</span>`;
    btn.disabled = true;
    return;
  }
  const mudou = (p) => simularTags(p.tags, add, rem) !== separarTags(p.tags).join(", ") || mudaCategoria(p, cat) || mudaAreas(p, ar);
  let alterados = 0;
  for (const p of sel) if (mudou(p)) alterados++;
  const partes = [];
  if (add.length) partes.push(`adicionar <strong>${esc(add.join(", "))}</strong>`);
  if (rem.length) partes.push(`remover <strong>${esc(rem.join(", "))}</strong>`);
  if (cat === "-") partes.push(`<strong>tirar a categoria</strong>`);
  else if (cat) partes.push(`definir a categoria <strong>${esc(cat)}</strong>`);
  if (ar.add.length) partes.push(`incluir a área <strong>${esc(ar.add.join(", "))}</strong>`);
  if (ar.rem.length) partes.push(`tirar a área <strong>${esc(ar.rem.join(", "))}</strong>`);
  const ex = sel.find(mudou);
  $("#massaPreview").innerHTML =
    `Vai ${partes.join(" e ")}: <strong>${fmt.format(alterados)}</strong> de ${fmt.format(sel.length)} produto(s) serão alterados.` +
    (ex
      ? `<div class="massa-exemplo">Ex.: <strong>${esc(ex.sku)}</strong> → ${esc(simularTags(ex.tags, add, rem) || "(sem tags)")}` +
        (cat ? ` · categoria: ${esc(cat === "-" ? "(nenhuma)" : cat)}` : "") +
        `</div>`
      : "");
  btn.disabled = alterados === 0;
}

function abrirMassa() {
  const sel = produtosSelecionados();
  if (sel.length === 0) return;
  const exemplos = sel
    .slice(0, 3)
    .map((p) => `<li><strong>${esc(p.sku)}</strong> ${esc(p.descricao_tecnica)}</li>`)
    .join("");
  $("#massaResumo").innerHTML =
    `<p><strong>${fmt.format(sel.length)}</strong> ${sel.length === 1 ? "produto selecionado" : "produtos selecionados"}</p>` +
    `<ul>${exemplos}</ul>` +
    (sel.length > 3 ? `<p class="dica">… e mais ${fmt.format(sel.length - 3)}</p>` : "");
  $("#massaErro").textContent = "";
  desenharUnir(sel);
  editorAdd.definir([]);
  editorRem.definir([]);
  $("#fMassaCategoria").value = "";
  desenharMassaAreas();
  atualizarMassa();
  $("#dlgMassa").showModal();
  $("#fAddInput").focus();
}

/* "Unir tags da seleção": produtos parecidos ficam todos com o mesmo conjunto de tags
   (e de áreas). Grafias que só mudam no acento (ACIDOS x ÁCIDOS) viram uma só: fica a
   mais usada, e as outras entram em "remover" para não sobrar duplicada. */
function planoUnir(sel) {
  const grupos = new Map(); // tag normalizada -> Map(grafia -> quantos produtos usam)
  for (const p of sel)
    for (const t of separarTags(p.tags)) {
      const k = normalizar(t);
      if (!grupos.has(k)) grupos.set(k, new Map());
      grupos.get(k).set(t, (grupos.get(k).get(t) || 0) + 1);
    }
  const adicionar = [];
  const remover = [];
  let faltam = 0; // quantas tags algum produto ainda não tem
  for (const grafias of grupos.values()) {
    const [escolhida] = [...grafias.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0];
    adicionar.push(escolhida);
    for (const g of grafias.keys()) if (g !== escolhida) remover.push(g);
    faltam += sel.filter((p) => !separarTags(p.tags).some((t) => normalizar(t) === normalizar(escolhida))).length;
  }
  const areas = new Map();
  for (const p of sel) for (const a of p.areas || []) areas.set(chaveCat(a), a);
  // categoria: a mais usada na seleção (sem contar "sem categoria")
  const cats = new Map();
  for (const p of sel) if (p.categoria && p.categoria !== "-") cats.set(p.categoria, (cats.get(p.categoria) || 0) + 1);
  const categoria = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0] || null;
  const mudaCat = Boolean(categoria) && sel.some((p) => chaveCat(p.categoria) !== chaveCat(categoria));
  return { adicionar, remover, areas: [...areas.values()], faltam, categoria, mudaCat, outrasCats: [...cats.keys()].filter((c) => c !== categoria) };
}

function desenharUnir(sel) {
  const caixa = $("#massaUnir");
  const plano = sel.length > 1 ? planoUnir(sel) : null;
  const util = plano && (plano.mudaCat || plano.faltam > 0 || plano.remover.length > 0 || plano.areas.some((a) => sel.some((p) => !(p.areas || []).some((x) => chaveCat(x) === chaveCat(a)))));
  caixa.hidden = !util;
  if (!util) return;
  const partes = [];
  if (plano.adicionar.length) partes.push(`<strong>${fmt.format(plano.adicionar.length)}</strong> tag(s)`);
  if (plano.areas.length) partes.push(`<strong>${fmt.format(plano.areas.length)}</strong> área(s)`);
  caixa.innerHTML =
    `<div><strong>Produtos parecidos?</strong> ` +
    (partes.length ? `Juntos eles têm ${partes.join(" e ")}. ` : "") +
    `Una para que todos fiquem com o mesmo conjunto, sem repetir` +
    (plano.mudaCat ? `, e na mesma categoria: <strong>${esc(plano.categoria)}</strong>${plano.outrasCats.length ? ` (a mais usada; hoje também há ${plano.outrasCats.map(esc).join(", ")})` : ""}` : "") +
    `.` +
    (plano.remover.length ? ` <span class="dica">Grafias que só mudam no acento viram uma só: ${plano.remover.map((t) => `<s>${esc(t)}</s>`).join(", ")}.</span>` : "") +
    `</div><button type="button" class="btn btn--primario btn--sm" id="btnUnirTags">${window.CBSIcon("plus", 14)}${plano.mudaCat ? "Unir tags e categoria" : "Unir tags da seleção"}</button>`;
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#fMassaCategoria").addEventListener("change", atualizarMassa);

  $("#btnTagsMassa").addEventListener("click", abrirMassa);

  $("#btnCancelarMassa").addEventListener("click", () => $("#dlgMassa").close());

  $("#btnFecharMassa").addEventListener("click", () => $("#dlgMassa").close());

  $("#massaUnir").addEventListener("click", (e) => {
    if (!e.target.closest("#btnUnirTags")) return;
    const plano = planoUnir(produtosSelecionados());
    if (plano.mudaCat && api.categoriasDisponiveis()) $("#fMassaCategoria").value = plano.categoria;
    editorAdd.definir([]);
    editorAdd.adicionar(plano.adicionar.join(","));
    if (plano.remover.length) editorRem.adicionar(plano.remover.join(","));
    // áreas: marca "+ adicionar" nas que algum produto da seleção já tem
    const chaves = new Set(plano.areas.map(chaveCat));
    $("#fMassaAreas").querySelectorAll("button[data-area]").forEach((b) => {
      if (chaves.has(chaveCat(b.dataset.area))) {
        b.dataset.estado = "add";
        b.setAttribute("aria-label", `${b.dataset.area}: vai adicionar`);
      }
    });
    atualizarMassa();
    $("#massaUnir").hidden = true;
    $("#massaPreview").scrollIntoView({ block: "nearest" });
    aviso("Tags unidas na prévia. Confira e clique em Aplicar.");
  });

  $("#massaPresentes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-rem]");
    if (b) editorRem.adicionar(b.dataset.rem);
  });

  $("#formMassa").addEventListener("submit", async (e) => {
    e.preventDefault();
    editorAdd.pendente();
    editorRem.pendente();
    const add = editorAdd.obter();
    const rem = editorRem.obter();
    const cat = categoriaMassa();
    const ar = areasMassa();
    const mexeTags = add.length > 0 || rem.length > 0 || cat !== "";
    if (!mexeTags && !ar.add.length && !ar.rem.length) return;
    const skus = [...estado.selecionados];
    const erro = $("#massaErro");
    erro.textContent = "";
    const btn = $("#btnAplicarMassa");
    btn.disabled = true;
    btn.textContent = "Aplicando...";
    try {
      const antes = new Map(produtosSelecionados().map((p) => [p.sku, JSON.stringify([p.tags, p.categoria, p.areas])]));
      if (mexeTags) await api.editarTagsEmMassa(skus, add, rem, cat === "" ? undefined : cat);
      if (ar.add.length || ar.rem.length) await api.editarAreasEmMassa(skus, ar.add, ar.rem);
      await carregarProdutos();
      const r = { alterados: estado.produtos.filter((p) => antes.has(p.sku) && antes.get(p.sku) !== JSON.stringify([p.tags, p.categoria, p.areas])).length };
      estado.selecionados.clear();
      renderizarLista();
      $("#dlgMassa").close();
      aviso(`${fmt.format(r.alterados)} produto(s) atualizado(s). Dá para desfazer no Histórico.`);
    } catch (err) {
      erro.textContent =
        err.status === 404
          ? "A função de edição em massa ainda não existe (ou está desatualizada) no Supabase. Rode os arquivos supabase/migracoes/002 e 005_categorias.sql no SQL Editor (veja o SETUP-SUPABASE.md)."
          : err.message;
    } finally {
      btn.textContent = "Aplicar";
      atualizarMassa();
    }
  });
}
