/* Aba Importar CSV: lê o arquivo (js/comum/csv.js), compara com o banco, mostra a prévia e aplica. */
import { normalizar, escaparHtml as esc } from "../comum/texto.js";
import { api, estado, $ } from "./estado.js";
import { separarTags, alerta } from "./util.js";
import { chaveCat } from "./categorias.js";
import { chaveTag } from "./massa.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { carregarProdutos } from "./carga.js";
import { decodificarTexto, detectarSeparador, lerCsv, normalizarSku } from "../comum/csv.js";

const LIMITE_ALERTA_EXCLUSAO = 0.2; // pede confirmação extra se >20% da base sumir

/* ---------------- importação de CSV ---------------- */

const ALIASES = {
  sku: ["codigo", "cod", "sku", "codigo produto", "cod produto"],
  descricao_tecnica: ["descricao", "descricao tecnica", "descricao produto", "descricao do produto"],
  referencia: [
    "cod prd forn",
    "cod prod forn",
    "codigo prd forn",
    "cod fornecedor",
    "codigo fornecedor",
    "referencia",
    "ref",
  ],
};

// Colunas opcionais: se existirem no CSV, a importação também trata categoria e tags
const ALIASES_OPCIONAIS = {
  categoria: ["categoria", "categorias"],
  tags: ["tags", "tag"],
  unidade: ["um", "u m", "unidade", "unidade medida", "unidade de medida", "und", "un"],
};

function limparCabecalho(t) {
  return normalizar(t).replace(/[^a-z0-9]+/g, " ").trim();
}

function mapearColunas(cabecalho) {
  const nomes = cabecalho.map(limparCabecalho);
  const mapa = {};
  for (const [campo, aliases] of Object.entries({ ...ALIASES, ...ALIASES_OPCIONAIS })) {
    const idx = nomes.findIndex((n) => aliases.includes(n));
    if (idx !== -1) mapa[campo] = idx;
  }
  if (mapa.sku === undefined) return { erro: "sku", encontrados: cabecalho };
  // Descricao e Cod prd forn só são obrigatórias num CSV completo. Se o arquivo traz Categoria
  // e/ou Tags, dá para importar só isso (útil porque o Excel estraga a coluna de referência).
  const soCategoriaTags = mapa.categoria !== undefined || mapa.tags !== undefined || mapa.unidade !== undefined;
  if (!soCategoriaTags) {
    for (const campo of ["descricao_tecnica", "referencia"]) {
      if (mapa[campo] === undefined) return { erro: campo, encontrados: cabecalho };
    }
  }
  return { mapa };
}

const ROTULO_COLUNA = {
  sku: "Codigo",
  descricao_tecnica: "Descricao",
  referencia: "Cod prd forn",
};

/* Referências que o Excel costuma estragar ao abrir/salvar o CSV:
   - notação científica: 693879921078 vira "6,9388E+11" (os dígitos se perdem, não tem volta);
   - pontuação de milhar: 10.1112 vira "101.112" e 51.002.00026 vira "5.100.200.026";
   - zeros à esquerda: 000000000038833014 vira "38833014".
   Se o produto já existe, mantemos a referência que está no banco; se é novo e veio em
   notação científica, a referência fica vazia (melhor vazio do que errado). */
const RE_CIENTIFICA = /^\d+(?:[.,]\d+)?E\+?\d+$/i;

const RE_MILHAR = /^\d{1,3}(?:\.\d{3})+$/;

function diagnosticarReferencia(csv, atual) {
  const c = String(csv ?? "").trim();
  if (!c) return null;
  if (RE_CIENTIFICA.test(c)) return "cientifica";
  if (atual === undefined || atual === c) return null;
  const digitos = (t) => t.replace(/\D/g, "");
  const soNumero = /^[\d.,]+$/.test(atual);
  if (RE_MILHAR.test(c) && soNumero && !RE_MILHAR.test(atual) && digitos(c) === digitos(atual)) return "pontuacao";
  if (soNumero && /^[\d.,]+$/.test(c) && /^0/.test(atual) && !/^0/.test(c) && digitos(c) === digitos(atual).replace(/^0+/, ""))
    return "zeros";
  return null;
}

const ROTULO_DANO = {
  cientifica: "notação científica",
  pontuacao: "pontos de milhar",
  zeros: "zeros à esquerda perdidos",
};

function analisarCsv(texto, opcoes = {}) {
  const linhas = lerCsv(texto, detectarSeparador(texto));
  if (linhas.length < 2) throw new Error("O arquivo está vazio ou só tem o cabeçalho.");
  const { mapa, erro, encontrados } = mapearColunas(linhas[0]);
  if (erro) {
    throw new Error(
      `Coluna "${ROTULO_COLUNA[erro]}" não encontrada. Colunas no arquivo: ${encontrados.join(" | ")}`,
    );
  }

  const temDescricao = mapa.descricao_tecnica !== undefined;
  const temRef = mapa.referencia !== undefined;
  const catalogoCompleto = temDescricao && temRef; // só nesse caso faz sentido "descontinuados"
  const ignorarRef = Boolean(opcoes.ignorarRef) && temRef;
  const lerCat = mapa.categoria !== undefined;
  const lerTags = mapa.tags !== undefined;
  const lerUm = mapa.unidade !== undefined;
  if (lerUm && !api.unidadeDisponivel()) {
    throw new Error(
      "O CSV tem a coluna UM, mas o banco ainda não foi atualizado. Rode supabase/migracoes/013_unidade_medida.sql no SQL Editor (veja o SETUP-SUPABASE.md) e tente de novo.",
    );
  }
  if ((lerCat || lerTags) && !api.categoriasDisponiveis()) {
    throw new Error(
      "O CSV tem colunas de categoria/tags, mas o banco ainda não foi atualizado. Rode supabase/migracoes/005_categorias.sql no SQL Editor (veja o SETUP-SUPABASE.md) e tente de novo.",
    );
  }
  const itens = new Map();
  let semSku = 0;
  let duplicados = 0;
  for (const l of linhas.slice(1)) {
    const sku = normalizarSku(l[mapa.sku]);
    if (!sku) {
      semSku++;
      continue;
    }
    if (itens.has(sku)) {
      duplicados++;
      continue; // mantém a primeira ocorrência
    }
    const item = {
      sku,
      descricao_tecnica: temDescricao ? String(l[mapa.descricao_tecnica] ?? "").trim() : undefined,
      referencia: temRef ? String(l[mapa.referencia] ?? "").trim() : undefined,
    };
    // só envia categoria/tags se o CSV tiver essas colunas (senão ficam como estão)
    if (lerCat) item.categoria = String(l[mapa.categoria] ?? "").trim().replace(/\s+/g, " ");
    if (lerTags) {
      item.tags = separarTags(String(l[mapa.tags] ?? "").replace(/\|/g, ","))
        .map((t) => t.toLocaleUpperCase("pt-BR"))
        .join(", ");
    }
    // UM: célula vazia não apaga a unidade atual
    if (lerUm) item.unidade = String(l[mapa.unidade] ?? "").trim().toUpperCase();
    itens.set(sku, item);
  }
  if (itens.size === 0) throw new Error("Nenhum SKU válido encontrado no arquivo.");

  const atuais = new Map(estado.produtos.map((p) => [p.sku, p]));
  // completa o que o CSV não trouxe com o que já está no banco e protege as referências
  // que o Excel estragou (veja diagnosticarReferencia)
  const refsPreservadas = [];
  let semCadastro = 0;
  for (const item of [...itens.values()]) {
    const atual = atuais.get(item.sku);
    if (!atual && !temDescricao) {
      semCadastro++; // sem Descricao não dá para cadastrar um produto novo
      itens.delete(item.sku);
      continue;
    }
    if (!temDescricao) item.descricao_tecnica = atual.descricao_tecnica;
    if (!temRef || (ignorarRef && atual)) {
      item.referencia = atual ? atual.referencia : "";
      continue;
    }
    const dano = diagnosticarReferencia(item.referencia, atual ? atual.referencia : undefined);
    if (!dano) continue;
    refsPreservadas.push({ sku: item.sku, csv: item.referencia, dano, mantida: atual ? atual.referencia : "" });
    item.referencia = atual ? atual.referencia : "";
  }
  if (itens.size === 0) throw new Error("Nenhum dos códigos do CSV existe no banco (e sem a coluna Descricao não dá para cadastrar produtos novos).");
  const novos = [];
  const alterados = [];
  let iguais = 0;
  let comCategoria = 0; // produtos que terão categoria definida/alterada
  let comTagsNovas = 0; // produtos que receberão tags novas
  let comUnidade = 0; // produtos que terão a UM definida/alterada
  const categoriasNovas = new Map();
  const canonica = (nome) => estado.categorias.find((c) => chaveCat(c) === chaveCat(nome)) || nome;
  const catDoCsv = (item) => (item.categoria && item.categoria !== "-" ? canonica(item.categoria) : null);

  for (const item of itens.values()) {
    const cat = catDoCsv(item);
    if (cat && !estado.categorias.some((c) => chaveCat(c) === chaveCat(cat))) categoriasNovas.set(chaveCat(cat), cat);
    const atual = atuais.get(item.sku);
    if (!atual) {
      novos.push(item);
      if (cat) comCategoria++;
      if (item.tags) comTagsNovas++;
      if (item.unidade) comUnidade++;
      continue;
    }
    const mudaCat = cat !== null && chaveCat(atual.categoria) !== chaveCat(cat);
    const jaTem = new Set(separarTags(atual.tags).map(chaveTag));
    const tagsAdd = separarTags(item.tags || "").filter((t) => !jaTem.has(chaveTag(t)));
    const mudaTexto =
      atual.descricao_tecnica !== item.descricao_tecnica || atual.referencia !== item.referencia;
    const unidade = item.unidade && item.unidade !== atual.unidade ? item.unidade : null;
    if (mudaTexto || mudaCat || tagsAdd.length || unidade) {
      alterados.push({ item, atual, mudaTexto, categoria: mudaCat ? cat : null, tagsAdd, unidade });
      if (mudaCat) comCategoria++;
      if (unidade) comUnidade++;
      if (tagsAdd.length) comTagsNovas++;
    } else iguais++;
  }
  const removidos = catalogoCompleto ? estado.produtos.filter((p) => !p.fixo && !itens.has(p.sku)) : [];
  const fixosFora = catalogoCompleto ? estado.produtos.filter((p) => p.fixo && !itens.has(p.sku)).length : 0;

  return {
    itens: [...itens.values()],
    novos,
    alterados,
    iguais,
    removidos,
    fixosFora,
    semSku,
    duplicados,
    lerCat,
    lerTags,
    lerUm,
    comUnidade,
    comCategoria,
    comTagsNovas,
    categoriasNovas: [...categoriasNovas.values()],
    refsPreservadas,
    catalogoCompleto,
    semCadastro,
    temRef,
    ignorarRef,
  };
}

function listaLimitada(arr, render, max = 200) {
  const html = arr.slice(0, max).map(render).join("");
  const resto = arr.length > max ? `<div>… e mais ${fmt.format(arr.length - max)}</div>` : "";
  return html + resto;
}

function renderizarImportacao() {
  const a = estado.importacao;
  const alvo = $("#resultadoImport");
  if (!a) {
    alvo.innerHTML = "";
    return;
  }
  const base = estado.produtos.length;
  const pctRemovidos = base ? a.removidos.length / base : 0;
  const perigoso = a.removidos.length > 0 && (pctRemovidos > LIMITE_ALERTA_EXCLUSAO || a.removidos.length > 200);
  const nada = a.novos.length + a.alterados.length + a.removidos.length === 0;

  alvo.innerHTML = `
      <div class="resumo">
        <div class="item novos"><div class="num">${fmt.format(a.novos.length)}</div><div class="rot">novos produtos</div></div>
        <div class="item"><div class="num">${fmt.format(a.alterados.length)}</div><div class="rot">com alguma alteração</div></div>
        ${a.lerCat ? `<div class="item"><div class="num">${fmt.format(a.comCategoria)}</div><div class="rot">com categoria definida</div></div>` : ""}
        ${a.lerTags ? `<div class="item"><div class="num">${fmt.format(a.comTagsNovas)}</div><div class="rot">recebendo tags novas</div></div>` : ""}
        ${a.lerUm ? `<div class="item"><div class="num">${fmt.format(a.comUnidade)}</div><div class="rot">com unidade (UM) definida</div></div>` : ""}
        <div class="item removidos"><div class="num">${fmt.format(a.removidos.length)}</div><div class="rot">descontinuados (não estão no CSV)</div></div>
        <div class="item"><div class="num">${fmt.format(a.iguais)}</div><div class="rot">sem mudança</div></div>
      </div>
      ${a.semSku || a.duplicados ? alerta("alerta", `Ignorados no CSV: ${fmt.format(a.semSku)} linha(s) sem código e ${fmt.format(a.duplicados)} código(s) repetido(s).`) : ""}
      ${!a.catalogoCompleto ? alerta("info", "Este CSV não traz as colunas <strong>Descricao</strong> e <strong>Cod prd forn</strong>: só <strong>categoria, tags e UM</strong> serão atualizadas, as referências e descrições ficam como estão e <strong>nada será excluído</strong>.") : ""}
      ${a.semCadastro ? alerta("alerta", `${fmt.format(a.semCadastro)} código(s) do CSV não existem no banco e foram ignorados (para cadastrar produto novo, o CSV precisa da coluna Descricao).`) : ""}
      ${a.refsPreservadas.length ? alerta("alerta", `<strong>${fmt.format(a.refsPreservadas.length)} referência(s) vieram alteradas pelo Excel</strong> (notação científica, pontos de milhar ou zeros perdidos) e <strong>não serão importadas</strong>: produtos que já existem mantêm a referência atual; produtos novos ficam sem referência.
        <details><summary>Ver quais</summary><div class="conteudo">${listaLimitada(a.refsPreservadas, (r) => `<div><strong>${esc(r.sku)}</strong> no CSV: <span class="de">${esc(r.csv)}</span> (${ROTULO_DANO[r.dano]}) → ${r.mantida ? `fica <span class="para">${esc(r.mantida)}</span>` : "fica sem referência"}</div>`)}</div></details>
        <span class="dica">Dica: ao editar no Excel, não salve de volta as colunas que você não mudou, ou abra o arquivo por Dados → De Texto/CSV e marque "Cod prd forn" como Texto.</span>`) : ""}
      ${a.lerTags ? alerta("info", "As tags do CSV serão <strong>somente acrescentadas</strong> às que cada produto já tem. Nenhuma tag existente é removida.") : ""}
      ${a.lerCat && a.categoriasNovas.length ? alerta("info", `Categorias novas que serão criadas: <strong>${a.categoriasNovas.map(esc).join(", ")}</strong>.`) : ""}
      ${a.fixosFora ? alerta("info", `${fmt.format(a.fixosFora)} produto(s) marcado(s) como "fixo" não está(ão) no CSV e será(ão) mantido(s).`) : ""}
      ${a.novos.length ? `<details><summary>Novos (${fmt.format(a.novos.length)})</summary><div class="conteudo">${listaLimitada(a.novos, (n) => `<div><strong>${esc(n.sku)}</strong> ${esc(n.descricao_tecnica)}${n.categoria && n.categoria !== "-" ? ` <span class="dica">· ${esc(n.categoria)}</span>` : ""}</div>`)}</div></details>` : ""}
      ${a.alterados.length ? `<details><summary>Alterados (${fmt.format(a.alterados.length)})</summary><div class="conteudo">${listaLimitada(a.alterados, ({ item, atual, categoria, tagsAdd, unidade }) => {
        const partes = [];
        if (atual.descricao_tecnica !== item.descricao_tecnica)
          partes.push(`<span class="de">${esc(atual.descricao_tecnica)}</span> → <span class="para">${esc(item.descricao_tecnica)}</span>`);
        if (atual.referencia !== item.referencia)
          partes.push(`ref: <span class="de">${esc(atual.referencia || "(vazio)")}</span> → <span class="para">${esc(item.referencia || "(vazio)")}</span>`);
        if (categoria)
          partes.push(`categoria: <span class="de">${esc(atual.categoria === "-" ? "(nenhuma)" : atual.categoria)}</span> → <span class="para">${esc(categoria)}</span>`);
        if (tagsAdd.length) partes.push(`tags: <span class="para">+ ${esc(tagsAdd.join(", + "))}</span>`);
        if (unidade) partes.push(`UM: <span class="de">${esc(atual.unidade || "(vazio)")}</span> → <span class="para">${esc(unidade)}</span>`);
        return `<div><strong>${esc(item.sku)}</strong> ${partes.join(" · ")}</div>`;
      })}</div></details>` : ""}
      ${a.removidos.length ? `<details><summary>Descontinuados a excluir (${fmt.format(a.removidos.length)})</summary><div class="conteudo">${listaLimitada(a.removidos, (r) => `<div><strong>${esc(r.sku)}</strong> ${esc(r.descricao_tecnica)}</div>`)}</div></details>` : ""}

      <div class="opcoes">
        ${a.temRef ? `<label class="check"><input type="checkbox" id="optIgnorarRef" ${a.ignorarRef ? "checked" : ""} /> Não alterar as referências (Cod prd forn) dos produtos que já existem</label>` : ""}
        ${a.removidos.length ? `<label class="check"><input type="checkbox" id="optExcluir" checked /> Excluir os ${fmt.format(a.removidos.length)} produtos que não estão no CSV</label>` : ""}
        ${perigoso ? alerta("erro", `Atenção: a importação removeria ${fmt.format(a.removidos.length)} produtos (${Math.round(pctRemovidos * 100)}% da base). Confira se o CSV está completo.
          <br /><label class="check"><input type="checkbox" id="optConfirmaPerigo" /> Confirmo que o CSV está completo e quero excluir esses produtos</label>`, "avisoPerigo") : ""}
      </div>
      <div class="acoes-import">
        <button class="btn btn--primario" id="btnAplicar" ${nada ? "disabled" : ""}>${nada ? "Nada a aplicar" : "Aplicar importação"}</button>
        <button class="btn btn--secundario" id="btnDescartar">Descartar</button>
      </div>`;

  const optExcluir = $("#optExcluir");
  const optPerigo = $("#optConfirmaPerigo");
  const btnAplicar = $("#btnAplicar");
  const atualizarBotao = () => {
    if (nada) return;
    const excluindo = optExcluir ? optExcluir.checked : false;
    const bloqueado = perigoso && excluindo && !(optPerigo && optPerigo.checked);
    btnAplicar.disabled = bloqueado;
    const aviso = $("#avisoPerigo");
    if (aviso) aviso.hidden = !excluindo;
  };
  $("#optIgnorarRef")?.addEventListener("change", (e) => {
    try {
      estado.importacao = analisarCsv(estado.csvTexto, { ignorarRef: e.target.checked });
      renderizarImportacao();
    } catch (err) {
      $("#resultadoImport").innerHTML = alerta("erro", esc(err.message));
    }
  });
  optExcluir?.addEventListener("change", atualizarBotao);
  optPerigo?.addEventListener("change", atualizarBotao);
  atualizarBotao();

  $("#btnDescartar").addEventListener("click", () => {
    estado.importacao = null;
    $("#arquivoCsv").value = "";
    renderizarImportacao();
  });

  btnAplicar.addEventListener("click", async () => {
    const excluir = optExcluir ? optExcluir.checked : false;
    btnAplicar.disabled = true;
    btnAplicar.textContent = "Aplicando...";
    try {
      const r = await api.importar(a.itens, excluir);
      await carregarProdutos();
      estado.importacao = null;
      $("#arquivoCsv").value = "";
      $("#resultadoImport").innerHTML = alerta("ok", `Importação concluída: ${fmt.format(r.inseridos)} incluído(s), ${fmt.format(r.atualizados)} atualizado(s), ${fmt.format(r.excluidos)} excluído(s)` + (a.lerTags ? `; tags novas em ${fmt.format(a.comTagsNovas)} produto(s)` : "") + (a.lerCat ? `; categoria definida em ${fmt.format(a.comCategoria)}` : "") + (a.lerUm ? `; UM definida em ${fmt.format(a.comUnidade)}` : "") + `. Os excluídos e alterados ficam no Histórico.`);
    } catch (err) {
      renderizarImportacao();
      $("#resultadoImport").insertAdjacentHTML(
        "afterbegin",
        alerta("erro", `Não conseguimos importar; nada foi alterado. ${esc(err.message)}`),
      );
    }
  });
}

async function lerArquivo(arquivo) {
  if (!arquivo) return;
  try {
    const texto = decodificarTexto(await arquivo.arrayBuffer());
    estado.csvTexto = texto;
    estado.importacao = analisarCsv(texto);
    renderizarImportacao();
  } catch (err) {
    estado.importacao = null;
    $("#resultadoImport").innerHTML = alerta("erro", esc(err.message));
  }
}

const area = $("#areaUpload");

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#arquivoCsv").addEventListener("change", (e) => lerArquivo(e.target.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    area.addEventListener(ev, (e) => {
      e.preventDefault();
      area.classList.add("arrastando");
    }),
  );

  ["dragleave", "drop"].forEach((ev) =>
    area.addEventListener(ev, (e) => {
      e.preventDefault();
      area.classList.remove("arrastando");
    }),
  );

  area.addEventListener("drop", (e) => lerArquivo(e.dataTransfer.files[0]));
}
