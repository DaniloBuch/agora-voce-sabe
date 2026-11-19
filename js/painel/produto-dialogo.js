/* Diálogos de produto: novo/editar (com tags, UM, categoria, áreas e "Copiar tags de outro
   produto") e excluir. */
import { separarTags, aviso, prepararProduto } from "./util.js";
import { normalizar, escaparHtml as esc } from "../comum/texto.js";
import { $, estado, api } from "./estado.js";
import { desenharEscolhaAreas } from "./areas.js";
import { motor, renderizarLista } from "./produtos.js";
import { chaveCat, atualizarSugestoesTags, carregarCategorias, destacarLinha } from "./categorias.js";
import { atualizarKpis } from "./carga.js";

/* ---------------- diálogo novo / editar ---------------- */

// Editor de chips reutilizável (produto, "adicionar" e "remover" da edição em massa)
export function criarEditorTags(chipsEl, campo, aoMudar = () => {}) {
  let tags = [];
  function renderizar() {
    chipsEl.querySelectorAll(".chip").forEach((c) => c.remove());
    tags.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      const x = document.createElement("button");
      x.type = "button";
      x.innerHTML = window.CBSIcon("x", 12);
      x.setAttribute("aria-label", `Remover ${tag}`);
      x.addEventListener("click", () => {
        tags.splice(i, 1);
        renderizar();
        campo.focus();
      });
      chip.appendChild(x);
      chipsEl.insertBefore(chip, campo);
    });
    aoMudar();
  }
  function adicionar(texto) {
    for (const bruta of separarTags(texto)) {
      const tag = bruta.toLocaleUpperCase("pt-BR");
      if (!tags.some((t) => normalizar(t) === normalizar(tag))) tags.push(tag);
    }
    renderizar();
  }
  function pendente() {
    if (campo.value.trim()) {
      adicionar(campo.value);
      campo.value = "";
    }
  }
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      pendente();
    } else if (e.key === "Backspace" && campo.value === "" && tags.length) {
      tags.pop();
      renderizar();
    }
  });
  campo.addEventListener("change", pendente); // escolha de sugestão do datalist
  campo.addEventListener("blur", pendente);
  chipsEl.addEventListener("click", (e) => {
    if (e.target === chipsEl) campo.focus();
  });
  return {
    obter: () => [...tags],
    definir(novas) {
      tags = [...novas];
      campo.value = "";
      renderizar();
    },
    adicionar,
    pendente,
  };
}

const editorProduto = criarEditorTags($("#chips"), $("#fTagInput"), () => {
  if ($("#dlgProduto").open) desenharCopiarDe(); // "Copiar N tags" acompanha as tags já escolhidas
});

const campoTag = $("#fTagInput");

export function abrirEdicao(produto) {
  estado.skuEmEdicao = produto ? produto.sku : null;
  $("#dlgTitulo").textContent = produto ? `Editar produto ${produto.sku}` : "Novo produto";
  $("#fSku").value = produto ? produto.sku : "";
  $("#fSku").readOnly = Boolean(produto);
  $("#fDesc").value = produto ? produto.descricao_tecnica : "";
  $("#fRef").value = produto ? produto.referencia : "";
  $("#campoUnidade").hidden = !api.unidadeDisponivel();
  $("#fUnidade").value = produto ? produto.unidade : "";
  // sugestões: as unidades que já existem na base, das mais usadas para as menos usadas
  const usos = new Map();
  for (const p of estado.produtos) if (p.unidade) usos.set(p.unidade, (usos.get(p.unidade) || 0) + 1);
  $("#listaUnidades").innerHTML = [...usos].sort((a, b) => b[1] - a[1]).map(([u]) => `<option value="${esc(u)}"></option>`).join("");
  $("#fFixo").checked = produto ? produto.fixo : false;
  $("#fCategoria").value = produto ? produto.categoria : "-";
  if ($("#fCategoria").value !== (produto ? produto.categoria : "-")) $("#fCategoria").value = "-";
  editorProduto.definir(produto ? separarTags(produto.tags) : []);
  desenharEscolhaAreas(produto ? produto.areas : []);
  $("#fCopiarBusca").value = "";
  desenharCopiarDe();
  $("#fErro").textContent = "";
  $("#dlgProduto").showModal();
  (produto ? campoTag : $("#fSku")).focus();
}

/* ---- "Copiar tags de outro produto": sugere os parecidos pela descrição ---- */

const PALAVRAS_FRACAS = new Set(["com", "para", "sem", "por", "uni", "und", "unid", "cx", "pct", "pc", "ml", "mm", "cm", "un", "kit", "tipo", "tam"]);

// palavras que identificam o produto: 3+ letras, sem números puros e sem medidas ("100ml", "14mm")
function palavrasChave(texto) {
  return new Set(
    normalizar(texto)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d/.test(w) && !PALAVRAS_FRACAS.has(w)),
  );
}

function candidatosCopiar() {
  const sku = estado.skuEmEdicao || $("#fSku").value.trim();
  const comTags = estado.produtos.filter((p) => p.sku !== sku && p.tags.trim());
  const busca = $("#fCopiarBusca").value.trim();
  if (busca) {
    return { modo: "busca", lista: motor.buscar(comTags, busca, { tolerancia: false }).itens.slice(0, 6) };
  }
  const minhas = palavrasChave($("#fDesc").value);
  if (minhas.size === 0) return { modo: "vazio", lista: [] };
  const pontuados = [];
  for (const p of comTags) {
    let n = 0;
    for (const w of palavrasChave(p.descricao_tecnica)) if (minhas.has(w)) n++;
    if (n >= Math.min(2, minhas.size)) pontuados.push([n, p]);
  }
  pontuados.sort((a, b) => b[0] - a[0] || separarTags(b[1].tags).length - separarTags(a[1].tags).length);
  return { modo: "parecidos", lista: pontuados.slice(0, 4).map((x) => x[1]) };
}

function desenharCopiarDe() {
  const { modo, lista } = candidatosCopiar();
  const jaTem = new Set(editorProduto.obter().map(normalizar));
  $("#copiarInfo").textContent =
    modo === "busca"
      ? lista.length ? "" : "Nenhum produto com tags encontrado."
      : modo === "parecidos"
        ? lista.length ? "Parecidos já cadastrados (pela descrição):" : "Nenhum produto parecido com tags. Procure pelo código ou descrição."
        : "Digite a descrição acima para ver os parecidos, ou procure pelo código.";
  $("#copiarLista").innerHTML = lista
    .map((p) => {
      const tags = separarTags(p.tags);
      const novas = tags.filter((t) => !jaTem.has(normalizar(t))).length;
      return `<li class="copiar-item">
          <div class="copiar-item__texto"><strong>${esc(p.sku)}</strong> ${esc(p.descricao_tecnica)}
            <span class="copiar-item__tags">${tags.slice(0, 5).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}${tags.length > 5 ? `<span class="dica">+${tags.length - 5}</span>` : ""}</span></div>
          <button type="button" class="btn btn--secundario btn--sm" data-copiar="${esc(p.sku)}" ${novas ? "" : "disabled"}>${novas ? `Copiar ${novas} tag${novas > 1 ? "s" : ""}` : "Já copiadas"}</button>
        </li>`;
    })
    .join("");
}

let timerCopiar = null;

const agendarCopiar = () => { clearTimeout(timerCopiar); timerCopiar = setTimeout(desenharCopiarDe, 200); };

/* ---------------- diálogo excluir ---------------- */

export function abrirExclusao(produto) {
  estado.skuParaExcluir = produto.sku;
  $("#txtExcluir").textContent = `${produto.sku} — ${produto.descricao_tecnica}`;
  $("#dlgExcluir").showModal();
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#fCopiarBusca").addEventListener("input", agendarCopiar);

  $("#fDesc").addEventListener("input", agendarCopiar);

  $("#copiarLista").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-copiar]");
    if (!b) return;
    const modelo = estado.produtos.find((p) => p.sku === b.dataset.copiar);
    if (!modelo) return;
    const antes = editorProduto.obter().length;
    editorProduto.adicionar(modelo.tags);
    // áreas e categoria do modelo também vêm (sem tirar as que já estão marcadas)
    const chaves = new Set((modelo.areas || []).map(chaveCat));
    $("#fAreas").querySelectorAll("input[type=checkbox]").forEach((c) => { if (chaves.has(chaveCat(c.value))) c.checked = true; });
    if (($("#fCategoria").value || "-") === "-" && modelo.categoria !== "-") $("#fCategoria").value = modelo.categoria;
    const n = editorProduto.obter().length - antes;
    desenharCopiarDe();
    $("#chips").classList.remove("chips--piscou");
    void $("#chips").offsetWidth; // reinicia a animação
    $("#chips").classList.add("chips--piscou");
    aviso(`${n} tag(s) copiada(s) de ${modelo.sku}. Confira e clique em Salvar.`);
  });

  $("#btnNovo").addEventListener("click", () => abrirEdicao(null));

  $("#btnCancelar").addEventListener("click", () => $("#dlgProduto").close());

  $("#btnFecharProduto").addEventListener("click", () => $("#dlgProduto").close());

  $("#formProduto").addEventListener("submit", async (e) => {
    e.preventDefault();
    editorProduto.pendente();
    const sku = $("#fSku").value.trim();
    const erro = $("#fErro");
    erro.textContent = "";
    if (!sku) {
      erro.textContent = "Informe o SKU.";
      return;
    }
    const criando = estado.skuEmEdicao === null;
    if (criando && estado.produtos.some((p) => p.sku === sku)) {
      erro.textContent = `Já existe um produto com o SKU ${sku}.`;
      return;
    }

    const campos = {
      descricao_tecnica: $("#fDesc").value.trim(),
      referencia: $("#fRef").value.trim(),
      tags: editorProduto.obter().join(", "),
      fixo: $("#fFixo").checked,
    };
    if (api.categoriasDisponiveis()) campos.categoria = $("#fCategoria").value || "-";
    if (api.areasDisponiveis()) campos.areas = [...$("#fAreas").querySelectorAll("input:checked")].map((c) => c.value);
    if (api.unidadeDisponivel()) campos.unidade = $("#fUnidade").value.trim().toUpperCase();

    const btn = $("#btnSalvar");
    btn.disabled = true;
    try {
      if (criando) await api.criar({ sku, ...campos });
      else await api.atualizar(sku, campos);

      const anterior = estado.produtos.find((p) => p.sku === sku);
      const novo = prepararProduto({ sku, ...campos, criado_em: anterior ? anterior.criado_em : new Date().toISOString() });
      const i = estado.produtos.findIndex((p) => p.sku === sku);
      if (i >= 0) estado.produtos[i] = novo;
      else estado.produtos.unshift(novo);
      atualizarSugestoesTags();
      await carregarCategorias(); // o produto pode ter ativado uma categoria nova
      atualizarKpis();
      renderizarLista();
      $("#dlgProduto").close();
      aviso(criando ? "Produto criado." : "Produto salvo.");
      destacarLinha(sku);
    } catch (err) {
      erro.textContent = err.status === 409 ? `Já existe um produto com o SKU ${sku}.` : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#btnNaoExcluir").addEventListener("click", () => $("#dlgExcluir").close());

  $("#btnFecharExcluir").addEventListener("click", () => $("#dlgExcluir").close());

  $("#formExcluir").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sku = estado.skuParaExcluir;
    const btn = $("#btnSimExcluir");
    btn.disabled = true;
    try {
      await api.excluir(sku);
      estado.produtos = estado.produtos.filter((p) => p.sku !== sku);
      renderizarLista();
      $("#dlgExcluir").close();
      aviso(`Produto ${sku} excluído (dá para restaurar no Histórico).`);
    } catch (err) {
      aviso(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
