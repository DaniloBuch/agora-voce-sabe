/* Categorias: lista e seletores e a aba Categorias (criar, renomear, mesclar, excluir). */
import { api, $, estado } from "./estado.js";
import { escaparHtml as esc } from "../comum/texto.js";
import { separarTags, aviso } from "./util.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { mostrarAba } from "./abas.js";
import { renderizarLista } from "./produtos.js";
import { atualizarKpis, carregarProdutos } from "./carga.js";

/* ---------------- categorias: lista e seletores ---------------- */

export const chaveCat = (t) => String(t).trim().toLocaleUpperCase("pt-BR");

// Lista de categorias = as cadastradas + as que algum produto usa (sem repetir)
export async function carregarCategorias() {
  const temColuna = api.categoriasDisponiveis();
  document.body.classList.toggle("sem-categorias", !temColuna);
  $("#avisoCategorias").hidden = temColuna;
  if (!temColuna) {
    $("#avisoCategorias").innerHTML =
      window.CBSIcon("triangle-alert", 20) +
      `<div>Categorias ainda não ativadas no banco. Rode os arquivos <code>supabase/migracoes/005_categorias.sql</code> e <code>006_categorias_iniciais.sql</code> no SQL Editor do Supabase (veja o SETUP-SUPABASE.md).</div>`;
    estado.categorias = [];
    return;
  }
  const nomes = new Map();
  for (const nome of await api.listarCategorias()) nomes.set(chaveCat(nome), nome);
  for (const p of estado.produtos) if (p.categoria !== "-" && !nomes.has(chaveCat(p.categoria))) nomes.set(chaveCat(p.categoria), p.categoria);
  estado.categorias = [...nomes.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  preencherSeletoresCategoria();
}

function opcoesCategoria(extra) {
  return (
    extra +
    estado.categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")
  );
}

function preencherSeletoresCategoria() {
  const filtro = $("#filtroCategoria");
  filtro.innerHTML = opcoesCategoria(`<option value="">Todas as categorias</option><option value="-">Sem categoria</option>`);
  if (![...filtro.options].some((o) => o.value === estado.categoria)) estado.categoria = "";
  filtro.value = estado.categoria;
  $("#fCategoria").innerHTML = opcoesCategoria(`<option value="-">Sem categoria</option>`);
  $("#fMassaCategoria").innerHTML = opcoesCategoria(
    `<option value="">(não alterar)</option><option value="-">Sem categoria</option>`,
  );
}

// linha recém-salva brilha por um instante (mostra onde a mudança foi parar)
export function destacarLinha(sku) {
  const cx = document.querySelector(`#corpoTabela input[data-sel="${CSS.escape(sku)}"]`);
  const tr = cx && cx.closest("tr");
  if (!tr) return;
  tr.classList.remove("linha-salva");
  void tr.offsetWidth;
  tr.classList.add("linha-salva");
  tr.addEventListener("animationend", () => tr.classList.remove("linha-salva"), { once: true });
}

export function atualizarSugestoesTags() {
  const todas = new Set();
  for (const p of estado.produtos) separarTags(p.tags).forEach((t) => todas.add(t));
  $("#listaTags").innerHTML = [...todas]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((t) => `<option value="${esc(t)}"></option>`)
    .join("");
}

/* ---------------- aba Categorias (criar / renomear / mesclar / excluir) ---------------- */

const MSG_FALTA_005 =
  "As categorias ainda não existem no Supabase. Rode o arquivo supabase/migracoes/005_categorias.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

function contagemCategorias() {
  const mapa = new Map(); // chaveCat -> quantidade
  let sem = 0;
  for (const p of estado.produtos) {
    if (p.categoria === "-") sem++;
    else mapa.set(chaveCat(p.categoria), (mapa.get(chaveCat(p.categoria)) || 0) + 1);
  }
  return { mapa, sem };
}

export function renderizarCategorias() {
  const { mapa, sem } = contagemCategorias();
  $("#infoCategorias").textContent =
    `${fmt.format(estado.categorias.length)} categorias · ${fmt.format(sem)} produtos sem categoria`;
  const linhas = [
    `<tr class="linha-sem-categoria">
        <td><span class="sem-categoria">Sem categoria (–)</span></td>
        <td class="c-num">${fmt.format(sem)}</td>
        <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-cat-acao="ver" data-cat="-">${window.CBSIcon("search", 14)}Ver produtos</button></td>
      </tr>`,
  ];
  for (const nome of estado.categorias) {
    linhas.push(`<tr>
        <td><strong>${esc(nome)}</strong></td>
        <td class="c-num">${fmt.format(mapa.get(chaveCat(nome)) || 0)}</td>
        <td class="c-acoes">
          <button class="btn btn--secundario btn--sm" data-cat-acao="ver" data-cat="${esc(nome)}">${window.CBSIcon("search", 14)}Ver produtos</button>
          <button class="btn btn--secundario btn--sm" data-cat-acao="renomear" data-cat="${esc(nome)}">${window.CBSIcon("pencil", 14)}Renomear</button>
          <button class="btn btn--secundario btn--sm btn--excluir" data-cat-acao="excluir" data-cat="${esc(nome)}">${window.CBSIcon("trash-2", 14)}Excluir</button>
        </td>
      </tr>`);
  }
  $("#corpoCategorias").innerHTML = linhas.join("");
}

let categoriaEmEdicao = null;

const produtosDaCategoria = (nome) => estado.produtos.filter((p) => chaveCat(p.categoria) === chaveCat(nome));

export function nomeCategoriaValido(texto) {
  return String(texto ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function atualizarPreviaCategoria() {
  const novo = nomeCategoriaValido($("#categoriaNovoNome").value);
  const origem = produtosDaCategoria(categoriaEmEdicao);
  const btn = $("#btnSalvarCategoria");
  const alvo = $("#categoriaPreview");
  if (!novo || novo === "-") {
    alvo.innerHTML = `<span class="dica">Digite o novo nome. Para remover a categoria, use o botão Excluir.</span>`;
    btn.disabled = true;
    return;
  }
  if (chaveCat(novo) === chaveCat(categoriaEmEdicao)) {
    const mudaGrafia = novo !== categoriaEmEdicao;
    alvo.innerHTML = mudaGrafia
      ? `Vai padronizar a grafia para <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`
      : `<span class="dica">O nome é igual ao atual; nada a mudar.</span>`;
    btn.disabled = !mudaGrafia;
    return;
  }
  const destino = estado.categorias.find((c) => chaveCat(c) === chaveCat(novo));
  alvo.innerHTML = destino
    ? `<strong>Mesclar:</strong> a categoria <strong>${esc(destino)}</strong> já existe (${fmt.format(produtosDaCategoria(destino).length)} produtos). ` +
      `${fmt.format(origem.length)} produto(s) passam a usá-la.`
    : `Vai trocar por <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`;
  btn.disabled = false;
}

function abrirRenomearCategoria(nome) {
  categoriaEmEdicao = nome;
  $("#categoriaOrigem").textContent = `Categoria atual: ${nome} (${fmt.format(produtosDaCategoria(nome).length)} produtos)`;
  $("#categoriaNovoNome").value = nome;
  $("#categoriaErro").textContent = "";
  atualizarPreviaCategoria();
  $("#dlgCategoria").showModal();
  $("#categoriaNovoNome").focus();
  $("#categoriaNovoNome").select();
}

async function aplicarCategoria(novo, dialogo, botao, erroEl, textoBotao, mensagem) {
  erroEl.textContent = "";
  botao.disabled = true;
  botao.textContent = "Aplicando...";
  try {
    const r = await api.renomearCategoria(categoriaEmEdicao, novo);
    await carregarProdutos();
    renderizarCategorias();
    dialogo.close();
    aviso(mensagem(r.alterados));
  } catch (err) {
    erroEl.textContent = err.status === 404 ? MSG_FALTA_005 : err.message;
  } finally {
    botao.textContent = textoBotao;
    botao.disabled = false;
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#corpoCategorias").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat-acao]");
    if (!btn) return;
    const nome = btn.dataset.cat;
    const acao = btn.dataset.catAcao;
    if (acao === "ver") {
      estado.categoria = nome;
      estado.pagina = 1;
      $("#filtroCategoria").value = nome;
      mostrarAba("produtos");
      renderizarLista();
    } else if (acao === "renomear") {
      abrirRenomearCategoria(nome);
    } else {
      categoriaEmEdicao = nome;
      $("#txtCategoriaExcluir").textContent = `${nome} (${fmt.format(produtosDaCategoria(nome).length)} produtos)`;
      $("#categoriaExcluirErro").textContent = "";
      $("#dlgCategoriaExcluir").showModal();
    }
  });

  $("#formNovaCategoria").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#novaCategoriaErro");
    erro.textContent = "";
    const nome = nomeCategoriaValido($("#novaCategoria").value);
    if (!nome || nome === "-") {
      erro.textContent = "Digite o nome da categoria.";
      return;
    }
    const existente = estado.categorias.find((c) => chaveCat(c) === chaveCat(nome));
    if (existente) {
      erro.textContent = `A categoria "${existente}" já existe.`;
      return;
    }
    const btn = $("#btnNovaCategoria");
    btn.disabled = true;
    try {
      await api.criarCategoria(nome);
      await carregarCategorias();
      atualizarKpis();
      renderizarCategorias();
      $("#novaCategoria").value = "";
      aviso(`Categoria "${nome}" criada.`);
    } catch (err) {
      erro.textContent = err.status === 404 ? MSG_FALTA_005 : err.status === 409 ? "Essa categoria já existe." : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#categoriaNovoNome").addEventListener("input", atualizarPreviaCategoria);

  $("#btnCancelarCategoria").addEventListener("click", () => $("#dlgCategoria").close());

  $("#btnFecharCategoria").addEventListener("click", () => $("#dlgCategoria").close());

  $("#btnNaoExcluirCategoria").addEventListener("click", () => $("#dlgCategoriaExcluir").close());

  $("#btnFecharCategoriaExcluir").addEventListener("click", () => $("#dlgCategoriaExcluir").close());

  $("#formCategoria").addEventListener("submit", (e) => {
    e.preventDefault();
    const novo = nomeCategoriaValido($("#categoriaNovoNome").value);
    if (!novo || novo === "-") return;
    aplicarCategoria(novo, $("#dlgCategoria"), $("#btnSalvarCategoria"), $("#categoriaErro"), "Aplicar", (n) =>
      `Categoria atualizada em ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.`,
    );
  });

  $("#formCategoriaExcluir").addEventListener("submit", (e) => {
    e.preventDefault();
    aplicarCategoria("", $("#dlgCategoriaExcluir"), $("#btnSimExcluirCategoria"), $("#categoriaExcluirErro"), "Excluir categoria", (n) =>
      `Categoria excluída; ${fmt.format(n)} produto(s) ficaram sem categoria. Dá para desfazer no Histórico.`,
    );
  });
}
