(() => {
  const api = window.CBS_API;
  const $ = (sel) => document.querySelector(sel);

  const TAMANHO_PAGINA = 50;
  const LIMITE_ALERTA_EXCLUSAO = 0.2; // pede confirmação extra se >20% da base sumir

  const estado = {
    produtos: [], // {sku, descricao_tecnica, referencia, tags, fixo, categoria, _busca}
    filtro: "",
    semTags: false,
    categoria: "", // filtro: "" = todas, "-" = sem categoria, ou o nome da categoria
    categorias: [], // nomes cadastrados (inclui as que ainda não têm produtos)
    pagina: 1,
    selecionados: new Set(), // SKUs marcados para edição em massa
    skuEmEdicao: null, // null = criando
    skuParaExcluir: null,
    importacao: null,
  };

  /* ---------------- utilitários ---------------- */

  function normalizar(texto) {
    return String(texto ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  }

  function esc(texto) {
    return String(texto ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const fmt = new Intl.NumberFormat("pt-BR");
  const fmtData = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  let toastTimer = null;
  function aviso(msg, erro = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("erro-toast", erro);
    el.classList.add("visivel");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visivel"), erro ? 6000 : 3000);
  }

  const ICONE_ALERTA = { info: "info", ok: "circle-check", alerta: "triangle-alert", erro: "circle-alert" };
  // Alert do design system: régua de 3px na borda de ataque + ícone
  function alerta(tom, html, id = "") {
    return `<div class="alerta alerta--${tom}" role="${tom === "erro" ? "alert" : "status"}"${id ? ` id="${id}"` : ""}>${window.CBSIcon(ICONE_ALERTA[tom], 20)}<div>${html}</div></div>`;
  }

  function separarTags(texto) {
    return String(texto ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function prepararProduto(p) {
    const tags = String(p.tags ?? "");
    const categoria = String(p.categoria ?? "").trim() || "-"; // "-" = sem categoria
    return {
      sku: String(p.sku),
      descricao_tecnica: String(p.descricao_tecnica ?? ""),
      referencia: String(p.referencia ?? ""),
      tags,
      fixo: Boolean(p.fixo),
      categoria,
      _busca: normalizar(`${p.sku} ${p.descricao_tecnica} ${p.referencia} ${tags} ${categoria === "-" ? "" : categoria}`),
    };
  }

  /* ---------------- carga inicial ---------------- */

  async function carregarProdutos() {
    const dados = await api.listarProdutos();
    estado.produtos = dados.map(prepararProduto);
    await carregarCategorias();
    podarSelecao();
    atualizarSugestoesTags();
    atualizarKpis();
    renderizarLista();
    if (!$("#aba-tags").hidden) renderizarTags();
    if (!$("#aba-categorias").hidden) renderizarCategorias();
  }

  function atualizarKpis() {
    $("#kpiProdutos").textContent = fmt.format(estado.produtos.length);
    $("#kpiSemTags").textContent = fmt.format(estado.produtos.filter((p) => p.tags.trim() === "").length);
    $("#kpiTags").textContent = fmt.format(indiceTags().size);
    $("#kpiCategorias").textContent = fmt.format(estado.categorias.length);
    $("#kpiSemCategoria").textContent = fmt.format(estado.produtos.filter((p) => p.categoria === "-").length);
  }

  /* ---------------- categorias: lista e seletores ---------------- */

  const chaveCat = (t) => String(t).trim().toLocaleUpperCase("pt-BR");

  // Lista de categorias = as cadastradas + as que algum produto usa (sem repetir)
  async function carregarCategorias() {
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

  function atualizarSugestoesTags() {
    const todas = new Set();
    for (const p of estado.produtos) separarTags(p.tags).forEach((t) => todas.add(t));
    $("#listaTags").innerHTML = [...todas]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((t) => `<option value="${esc(t)}"></option>`)
      .join("");
  }

  /* ---------------- abas ---------------- */

  function mostrarAba(nome) {
    document.querySelectorAll(".aba").forEach((b) => {
      const ativa = b.dataset.aba === nome;
      b.classList.toggle("ativa", ativa);
      b.setAttribute("aria-selected", String(ativa));
    });
    ["produtos", "categorias", "tags", "importar", "historico"].forEach((n) => {
      $(`#aba-${n}`).hidden = n !== nome;
    });
    if (nome === "historico") carregarHistorico();
    if (nome === "tags") renderizarTags();
    if (nome === "categorias") renderizarCategorias();
  }

  document.querySelectorAll(".aba").forEach((b) =>
    b.addEventListener("click", () => mostrarAba(b.dataset.aba)),
  );

  /* ---------------- lista de produtos ---------------- */

  function filtrados() {
    const termos = normalizar(estado.filtro).split(/\s+/).filter(Boolean);
    return estado.produtos.filter(
      (p) =>
        termos.every((t) => p._busca.includes(t)) &&
        (!estado.semTags || p.tags.trim() === "") &&
        (!estado.categoria || chaveCat(p.categoria) === chaveCat(estado.categoria)),
    );
  }

  function renderizarLista() {
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
        ? `<tr><td colspan="7" class="vazio">Nenhum produto encontrado com esse filtro.</td></tr>`
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
                <td class="c-sku">${esc(p.sku)}${p.fixo ? '<span class="selo" title="Fixo: nunca excluído pela importação">fixo</span>' : ""}</td>
                <td class="c-ref">${esc(p.referencia)}</td>
                <td>${esc(p.descricao_tecnica)}</td>
                <td class="c-cat so-categorias">${p.categoria === "-" ? '<span class="sem-categoria">–</span>' : esc(p.categoria)}</td>
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

  function podarSelecao() {
    const existentes = new Set(estado.produtos.map((p) => p.sku));
    for (const sku of [...estado.selecionados]) if (!existentes.has(sku)) estado.selecionados.delete(sku);
  }

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

  let timerFiltro = null;
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

  /* ---------------- diálogo novo / editar ---------------- */

  // Editor de chips reutilizável (produto, "adicionar" e "remover" da edição em massa)
  function criarEditorTags(chipsEl, campo, aoMudar = () => {}) {
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

  const editorProduto = criarEditorTags($("#chips"), $("#fTagInput"));
  const campoTag = $("#fTagInput");

  function abrirEdicao(produto) {
    estado.skuEmEdicao = produto ? produto.sku : null;
    $("#dlgTitulo").textContent = produto ? `Editar produto ${produto.sku}` : "Novo produto";
    $("#fSku").value = produto ? produto.sku : "";
    $("#fSku").readOnly = Boolean(produto);
    $("#fDesc").value = produto ? produto.descricao_tecnica : "";
    $("#fRef").value = produto ? produto.referencia : "";
    $("#fFixo").checked = produto ? produto.fixo : false;
    $("#fCategoria").value = produto ? produto.categoria : "-";
    if ($("#fCategoria").value !== (produto ? produto.categoria : "-")) $("#fCategoria").value = "-";
    editorProduto.definir(produto ? separarTags(produto.tags) : []);
    $("#fErro").textContent = "";
    $("#dlgProduto").showModal();
    (produto ? campoTag : $("#fSku")).focus();
  }

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

    const btn = $("#btnSalvar");
    btn.disabled = true;
    try {
      if (criando) await api.criar({ sku, ...campos });
      else await api.atualizar(sku, campos);

      const novo = prepararProduto({ sku, ...campos });
      const i = estado.produtos.findIndex((p) => p.sku === sku);
      if (i >= 0) estado.produtos[i] = novo;
      else estado.produtos.unshift(novo);
      atualizarSugestoesTags();
      await carregarCategorias(); // o produto pode ter ativado uma categoria nova
      atualizarKpis();
      renderizarLista();
      $("#dlgProduto").close();
      aviso(criando ? "Produto criado." : "Produto salvo.");
    } catch (err) {
      erro.textContent = err.status === 409 ? `Já existe um produto com o SKU ${sku}.` : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- diálogo: tags em massa ---------------- */

  const editorAdd = criarEditorTags($("#chipsAdd"), $("#fAddInput"), () => atualizarMassa());
  const editorRem = criarEditorTags($("#chipsRem"), $("#fRemInput"), () => atualizarMassa());

  function produtosSelecionados() {
    return estado.produtos.filter((p) => estado.selecionados.has(p.sku));
  }

  // Espelha a função SQL editar_tags_em_massa: remove, depois acrescenta (sem repetir)
  // mesma comparação do SQL (upper): ESFIGMOMANOMETRO e ESFIGMOMANÔMETRO são tags diferentes
  const chaveTag = (t) => String(t).trim().toLocaleUpperCase("pt-BR");

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

  function atualizarMassa() {
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

    if (add.length === 0 && rem.length === 0 && cat === "") {
      $("#massaPreview").innerHTML = `<span class="dica">Escolha tags para adicionar ou remover, ou uma categoria.</span>`;
      btn.disabled = true;
      return;
    }
    const mudou = (p) => simularTags(p.tags, add, rem) !== separarTags(p.tags).join(", ") || mudaCategoria(p, cat);
    let alterados = 0;
    for (const p of sel) if (mudou(p)) alterados++;
    const partes = [];
    if (add.length) partes.push(`adicionar <strong>${esc(add.join(", "))}</strong>`);
    if (rem.length) partes.push(`remover <strong>${esc(rem.join(", "))}</strong>`);
    if (cat === "-") partes.push(`<strong>tirar a categoria</strong>`);
    else if (cat) partes.push(`definir a categoria <strong>${esc(cat)}</strong>`);
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
    editorAdd.definir([]);
    editorRem.definir([]);
    $("#fMassaCategoria").value = "";
    atualizarMassa();
    $("#dlgMassa").showModal();
    $("#fAddInput").focus();
  }

  $("#fMassaCategoria").addEventListener("change", atualizarMassa);
  $("#btnTagsMassa").addEventListener("click", abrirMassa);
  $("#btnCancelarMassa").addEventListener("click", () => $("#dlgMassa").close());
  $("#btnFecharMassa").addEventListener("click", () => $("#dlgMassa").close());
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
    if (add.length === 0 && rem.length === 0 && cat === "") return;
    const skus = [...estado.selecionados];
    const erro = $("#massaErro");
    erro.textContent = "";
    const btn = $("#btnAplicarMassa");
    btn.disabled = true;
    btn.textContent = "Aplicando...";
    try {
      const r = await api.editarTagsEmMassa(skus, add, rem, cat === "" ? undefined : cat);
      await carregarProdutos();
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

  /* ---------------- diálogo excluir ---------------- */

  function abrirExclusao(produto) {
    estado.skuParaExcluir = produto.sku;
    $("#txtExcluir").textContent = `${produto.sku} — ${produto.descricao_tecnica}`;
    $("#dlgExcluir").showModal();
  }
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

  /* ---------------- importação de CSV ---------------- */

  function decodificar(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (_) {
      // CSV exportado do Excel/ERP costuma vir em Windows-1252 (acentos)
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  function parseCsv(texto) {
    texto = texto.replace(/^﻿/, "");
    const primeira = texto.split(/\r?\n/, 1)[0] || "";
    const conta = (c) => primeira.split(c).length - 1;
    const delim = [";", "\t", ","]
      .map((c) => [c, conta(c)])
      .sort((a, b) => b[1] - a[1])[0][0];

    const linhas = [];
    let linha = [];
    let campo = "";
    let aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else if (c === '"') aspas = false;
        else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === delim) {
        linha.push(campo);
        campo = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        linha.push(campo);
        campo = "";
        linhas.push(linha);
        linha = [];
      } else campo += c;
    }
    if (campo !== "" || linha.length) {
      linha.push(campo);
      linhas.push(linha);
    }
    return linhas.filter((l) => l.some((c) => c.trim() !== ""));
  }

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
    const soCategoriaTags = mapa.categoria !== undefined || mapa.tags !== undefined;
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

  function normalizarSku(valor) {
    const sku = String(valor ?? "").trim();
    // O Excel costuma comer os zeros à esquerda: 462 -> 000462
    return /^\d+$/.test(sku) && sku.length < 6 ? sku.padStart(6, "0") : sku;
  }

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
    const linhas = parseCsv(texto);
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
        continue;
      }
      const mudaCat = cat !== null && chaveCat(atual.categoria) !== chaveCat(cat);
      const jaTem = new Set(separarTags(atual.tags).map(chaveTag));
      const tagsAdd = separarTags(item.tags || "").filter((t) => !jaTem.has(chaveTag(t)));
      const mudaTexto =
        atual.descricao_tecnica !== item.descricao_tecnica || atual.referencia !== item.referencia;
      if (mudaTexto || mudaCat || tagsAdd.length) {
        alterados.push({ item, atual, mudaTexto, categoria: mudaCat ? cat : null, tagsAdd });
        if (mudaCat) comCategoria++;
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
        <div class="item removidos"><div class="num">${fmt.format(a.removidos.length)}</div><div class="rot">descontinuados (não estão no CSV)</div></div>
        <div class="item"><div class="num">${fmt.format(a.iguais)}</div><div class="rot">sem mudança</div></div>
      </div>
      ${a.semSku || a.duplicados ? alerta("alerta", `Ignorados no CSV: ${fmt.format(a.semSku)} linha(s) sem código e ${fmt.format(a.duplicados)} código(s) repetido(s).`) : ""}
      ${!a.catalogoCompleto ? alerta("info", "Este CSV não traz as colunas <strong>Descricao</strong> e <strong>Cod prd forn</strong>: só <strong>categoria e tags</strong> serão atualizadas, as referências e descrições ficam como estão e <strong>nada será excluído</strong>.") : ""}
      ${a.semCadastro ? alerta("alerta", `${fmt.format(a.semCadastro)} código(s) do CSV não existem no banco e foram ignorados (para cadastrar produto novo, o CSV precisa da coluna Descricao).`) : ""}
      ${a.refsPreservadas.length ? alerta("alerta", `<strong>${fmt.format(a.refsPreservadas.length)} referência(s) vieram alteradas pelo Excel</strong> (notação científica, pontos de milhar ou zeros perdidos) e <strong>não serão importadas</strong>: produtos que já existem mantêm a referência atual; produtos novos ficam sem referência.
        <details><summary>Ver quais</summary><div class="conteudo">${listaLimitada(a.refsPreservadas, (r) => `<div><strong>${esc(r.sku)}</strong> no CSV: <span class="de">${esc(r.csv)}</span> (${ROTULO_DANO[r.dano]}) → ${r.mantida ? `fica <span class="para">${esc(r.mantida)}</span>` : "fica sem referência"}</div>`)}</div></details>
        <span class="dica">Dica: ao editar no Excel, não salve de volta as colunas que você não mudou, ou abra o arquivo por Dados → De Texto/CSV e marque "Cod prd forn" como Texto.</span>`) : ""}
      ${a.lerTags ? alerta("info", "As tags do CSV serão <strong>somente acrescentadas</strong> às que cada produto já tem. Nenhuma tag existente é removida.") : ""}
      ${a.lerCat && a.categoriasNovas.length ? alerta("info", `Categorias novas que serão criadas: <strong>${a.categoriasNovas.map(esc).join(", ")}</strong>.`) : ""}
      ${a.fixosFora ? alerta("info", `${fmt.format(a.fixosFora)} produto(s) marcado(s) como "fixo" não está(ão) no CSV e será(ão) mantido(s).`) : ""}
      ${a.novos.length ? `<details><summary>Novos (${fmt.format(a.novos.length)})</summary><div class="conteudo">${listaLimitada(a.novos, (n) => `<div><strong>${esc(n.sku)}</strong> ${esc(n.descricao_tecnica)}${n.categoria && n.categoria !== "-" ? ` <span class="dica">· ${esc(n.categoria)}</span>` : ""}</div>`)}</div></details>` : ""}
      ${a.alterados.length ? `<details><summary>Alterados (${fmt.format(a.alterados.length)})</summary><div class="conteudo">${listaLimitada(a.alterados, ({ item, atual, categoria, tagsAdd }) => {
        const partes = [];
        if (atual.descricao_tecnica !== item.descricao_tecnica)
          partes.push(`<span class="de">${esc(atual.descricao_tecnica)}</span> → <span class="para">${esc(item.descricao_tecnica)}</span>`);
        if (atual.referencia !== item.referencia)
          partes.push(`ref: <span class="de">${esc(atual.referencia || "(vazio)")}</span> → <span class="para">${esc(item.referencia || "(vazio)")}</span>`);
        if (categoria)
          partes.push(`categoria: <span class="de">${esc(atual.categoria === "-" ? "(nenhuma)" : atual.categoria)}</span> → <span class="para">${esc(categoria)}</span>`);
        if (tagsAdd.length) partes.push(`tags: <span class="para">+ ${esc(tagsAdd.join(", + "))}</span>`);
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
        $("#resultadoImport").innerHTML = alerta("ok", `Importação concluída: ${fmt.format(r.inseridos)} incluído(s), ${fmt.format(r.atualizados)} atualizado(s), ${fmt.format(r.excluidos)} excluído(s)` + (a.lerTags ? `; tags novas em ${fmt.format(a.comTagsNovas)} produto(s)` : "") + (a.lerCat ? `; categoria definida em ${fmt.format(a.comCategoria)}` : "") + `. Os excluídos e alterados ficam no Histórico.`);
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
      const texto = decodificar(await arquivo.arrayBuffer());
      estado.csvTexto = texto;
      estado.importacao = analisarCsv(texto);
      renderizarImportacao();
    } catch (err) {
      estado.importacao = null;
      $("#resultadoImport").innerHTML = alerta("erro", esc(err.message));
    }
  }

  $("#arquivoCsv").addEventListener("change", (e) => lerArquivo(e.target.files[0]));
  const area = $("#areaUpload");
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

  /* ---------------- exportar CSV (backup) ---------------- */

  function campoCsv(valor) {
    const t = String(valor ?? "");
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  async function exportarCsv(botao, cabecalho, extrair, prefixoArquivo) {
    botao.disabled = true;
    try {
      // lê de novo do banco: o backup tem que refletir o que está lá agora
      const dados = (await api.listarProdutos()).map(prepararProduto);
      const linhas = [cabecalho];
      for (const p of dados) linhas.push(extrair(p).map(campoCsv).join(";"));
      // BOM para o Excel abrir os acentos corretamente
      const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${prefixoArquivo}-${hoje}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      aviso(`${fmt.format(dados.length)} produtos exportados.`);
    } catch (err) {
      aviso(err.message, true);
    } finally {
      botao.disabled = false;
    }
  }

  $("#btnExportar").addEventListener("click", () =>
    exportarCsv(
      $("#btnExportar"),
      "Codigo;Descricao;Cod prd forn;Categoria;Tags;Fixo",
      (p) => [p.sku, p.descricao_tecnica, p.referencia, p.categoria, p.tags, p.fixo ? "sim" : ""],
      "cbs-produtos",
    ),
  );
  // Versão sem a referência: dá para editar no Excel sem risco de ele estragar o Cod prd forn
  $("#btnExportarLeve").addEventListener("click", () =>
    exportarCsv(
      $("#btnExportarLeve"),
      "Codigo;Descricao;Categoria;Tags",
      (p) => [p.sku, p.descricao_tecnica, p.categoria, p.tags],
      "cbs-categorizar",
    ),
  );

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

  function renderizarCategorias() {
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

  function nomeCategoriaValido(texto) {
    return String(texto ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  }

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

  $("#categoriaNovoNome").addEventListener("input", atualizarPreviaCategoria);
  $("#btnCancelarCategoria").addEventListener("click", () => $("#dlgCategoria").close());
  $("#btnFecharCategoria").addEventListener("click", () => $("#dlgCategoria").close());
  $("#btnNaoExcluirCategoria").addEventListener("click", () => $("#dlgCategoriaExcluir").close());
  $("#btnFecharCategoriaExcluir").addEventListener("click", () => $("#dlgCategoriaExcluir").close());

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

  /* ---------------- aba Tags (renomear / mesclar / excluir) ---------------- */

  // (chaveTag, definida acima, compara como o banco: "curativo" e "CURATIVO" são a mesma tag)
  // chave "frouxa" para achar possíveis duplicadas: sem acento, sem pontuação, sem plural simples
  function chaveSimilar(t) {
    return normalizar(t)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
      .join(" ");
  }

  function indiceTags() {
    const mapa = new Map(); // chaveTag -> {nome, n, grafias:Map(grafia->n), similares:[]}
    for (const p of estado.produtos) {
      const vistas = new Set();
      for (const t of separarTags(p.tags)) {
        const k = chaveTag(t);
        let e = mapa.get(k);
        if (!e) mapa.set(k, (e = { nome: t, n: 0, grafias: new Map(), similares: [] }));
        e.grafias.set(t, (e.grafias.get(t) || 0) + 1);
        if (!vistas.has(k)) {
          vistas.add(k);
          e.n++;
        }
      }
    }
    for (const e of mapa.values()) {
      // grafia exibida = a mais usada
      e.nome = [...e.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const grupos = new Map();
    for (const e of mapa.values()) {
      const k = chaveSimilar(e.nome);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    }
    for (const g of grupos.values()) {
      if (g.length > 1) for (const e of g) e.similares = g.filter((o) => o !== e).map((o) => o.nome);
    }
    return mapa;
  }

  function renderizarTags() {
    const mapa = indiceTags();
    const termos = normalizar($("#filtroTags").value).split(/\s+/).filter(Boolean);
    const soDup = $("#soDuplicadas").checked;
    const todas = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const lista = todas.filter(
      (e) =>
        termos.every((t) => normalizar(e.nome).includes(t)) &&
        (!soDup || e.similares.length > 0 || e.grafias.size > 1),
    );
    const MAX = 300;
    const duplicadas = todas.filter((e) => e.similares.length > 0 || e.grafias.size > 1).length;
    $("#infoTags").textContent =
      `${fmt.format(todas.length)} tags · ${fmt.format(duplicadas)} com possível duplicata` +
      (lista.length > MAX ? ` · mostrando ${MAX} de ${fmt.format(lista.length)}, use o filtro` : "");

    $("#corpoTags").innerHTML =
      lista.length === 0
        ? `<tr><td colspan="4" class="vazio">Nenhuma tag encontrada.</td></tr>`
        : lista
            .slice(0, MAX)
            .map((e) => {
              const obs = [];
              if (e.grafias.size > 1) obs.push(`grafias diferentes: ${[...e.grafias.keys()].map(esc).join(", ")}`);
              if (e.similares.length) obs.push(`parecida com: ${e.similares.map(esc).join(", ")}`);
              return `<tr>
                <td><span class="tag-pill">${esc(e.nome)}</span></td>
                <td class="c-num">${fmt.format(e.n)}</td>
                <td class="obs">${obs.length ? `<span class="aviso-tag">${obs.join(" · ")}</span>` : ""}</td>
                <td class="c-acoes">
                  <button class="btn btn--secundario btn--sm" data-tag-acao="renomear" data-tag="${esc(e.nome)}">${window.CBSIcon("pencil", 14)}Renomear</button>
                  <button class="btn btn--secundario btn--sm btn--excluir" data-tag-acao="excluir" data-tag="${esc(e.nome)}">${window.CBSIcon("trash-2", 14)}Excluir</button>
                </td>
              </tr>`;
            })
            .join("");
  }

  let timerTags = null;
  $("#filtroTags").addEventListener("input", () => {
    clearTimeout(timerTags);
    timerTags = setTimeout(renderizarTags, 200);
  });
  $("#soDuplicadas").addEventListener("change", renderizarTags);

  const MSG_FALTA_004 =
    "A função de gerenciar tags ainda não existe no Supabase. Rode o arquivo supabase/migracoes/004_gerenciar_tags.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

  let tagEmEdicao = null; // {nome, n}

  function produtosComTag(nome) {
    const k = chaveTag(nome);
    return estado.produtos.filter((p) => separarTags(p.tags).some((t) => chaveTag(t) === k));
  }

  function atualizarPreviaTag() {
    const novo = chaveTag($("#tagNovoNome").value);
    const origem = produtosComTag(tagEmEdicao);
    const btn = $("#btnSalvarTag");
    const alvo = $("#tagPreview");
    if (!novo) {
      alvo.innerHTML = `<span class="dica">Digite o novo nome. Para remover a tag, use o botão Excluir.</span>`;
      btn.disabled = true;
      return;
    }
    const mesmaChave = novo === chaveTag(tagEmEdicao);
    const textoAtual = new Set(origem.flatMap((p) => separarTags(p.tags).filter((t) => chaveTag(t) === novo)));
    const precisaMudar = !mesmaChave || [...textoAtual].some((t) => t !== novo);
    if (mesmaChave) {
      alvo.innerHTML = precisaMudar
        ? `Vai padronizar a grafia para <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`
        : `<span class="dica">O nome é igual ao atual; nada a mudar.</span>`;
      btn.disabled = !precisaMudar;
      return;
    }
    const destino = produtosComTag(novo);
    if (destino.length) {
      const ambos = origem.filter((p) => destino.includes(p)).length;
      alvo.innerHTML =
        `<strong>Mesclar:</strong> a tag <strong>${esc(novo)}</strong> já existe (${fmt.format(destino.length)} produtos). ` +
        `${fmt.format(origem.length)} produto(s) passam a usá-la` +
        (ambos ? `; ${fmt.format(ambos)} já tinham as duas e ficarão com uma só` : "") +
        ".";
    } else {
      alvo.innerHTML = `Vai trocar por <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`;
    }
    btn.disabled = false;
  }

  function abrirRenomearTag(nome) {
    tagEmEdicao = nome;
    $("#tagOrigem").textContent = `Tag atual: ${nome} (${fmt.format(produtosComTag(nome).length)} produtos)`;
    $("#tagNovoNome").value = nome.toLocaleUpperCase("pt-BR");
    $("#tagErro").textContent = "";
    atualizarPreviaTag();
    $("#dlgTag").showModal();
    $("#tagNovoNome").focus();
    $("#tagNovoNome").select();
  }

  $("#corpoTags").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tag-acao]");
    if (!btn) return;
    const nome = btn.dataset.tag;
    if (btn.dataset.tagAcao === "renomear") abrirRenomearTag(nome);
    else {
      tagEmEdicao = nome;
      $("#txtTagExcluir").textContent = `${nome} (${fmt.format(produtosComTag(nome).length)} produtos)`;
      $("#tagExcluirErro").textContent = "";
      $("#dlgTagExcluir").showModal();
    }
  });
  $("#tagNovoNome").addEventListener("input", atualizarPreviaTag);
  $("#btnCancelarTag").addEventListener("click", () => $("#dlgTag").close());
  $("#btnFecharTag").addEventListener("click", () => $("#dlgTag").close());
  $("#btnNaoExcluirTag").addEventListener("click", () => $("#dlgTagExcluir").close());
  $("#btnFecharTagExcluir").addEventListener("click", () => $("#dlgTagExcluir").close());

  async function aplicarRenomeio(novo, dialogo, botao, erroEl, textoBotao, mensagem) {
    erroEl.textContent = "";
    botao.disabled = true;
    botao.textContent = "Aplicando...";
    try {
      const r = await api.renomearTag(tagEmEdicao, novo);
      await carregarProdutos();
      renderizarTags();
      dialogo.close();
      aviso(mensagem(r.alterados));
    } catch (err) {
      erroEl.textContent = err.status === 404 ? MSG_FALTA_004 : err.message;
    } finally {
      botao.textContent = textoBotao;
      botao.disabled = false;
    }
  }

  $("#formTag").addEventListener("submit", (e) => {
    e.preventDefault();
    const novo = $("#tagNovoNome").value.trim().toLocaleUpperCase("pt-BR").replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!novo) return;
    aplicarRenomeio(novo, $("#dlgTag"), $("#btnSalvarTag"), $("#tagErro"), "Aplicar", (n) =>
      `Tag atualizada em ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.`,
    );
  });
  $("#formTagExcluir").addEventListener("submit", (e) => {
    e.preventDefault();
    aplicarRenomeio("", $("#dlgTagExcluir"), $("#btnSimExcluirTag"), $("#tagExcluirErro"), "Excluir tag", (n) =>
      `Tag removida de ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.`,
    );
  });

  /* ---------------- histórico ---------------- */

  let historicoCache = [];
  let historicoGrupos = [];

  // Alterações feitas na mesma transação (mesmo registrado_em) formam um grupo:
  // é o que permite desfazer uma edição/exclusão em massa de uma vez.
  function agruparHistorico(linhas) {
    const grupos = [];
    const porTempo = new Map();
    for (const h of linhas) {
      let g = porTempo.get(h.registrado_em);
      if (!g) {
        g = { quando: h.registrado_em, itens: [] };
        porTempo.set(h.registrado_em, g);
        grupos.push(g);
      }
      g.itens.push(h);
    }
    return grupos;
  }

  function linhaHistorico(h) {
    return `<tr>
      <td>${esc(fmtData.format(new Date(h.registrado_em)))}</td>
      <td>${h.acao === "DELETE" ? "Excluído" : "Editado"}</td>
      <td class="c-sku">${esc(h.sku)}</td>
      <td>${esc(h.dados.descricao_tecnica)}${h.dados.categoria && h.dados.categoria !== "-" ? ` <span class="dica">· categoria: ${esc(h.dados.categoria)}</span>` : ""}</td>
      <td class="c-tags">${separarTags(h.dados.tags).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</td>
      <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-hid="${h.id}">${window.CBSIcon("rotate-ccw", 14)}Restaurar</button></td>
    </tr>`;
  }

  function linhaGrupo(g, i) {
    const exclusao = g.itens.every((h) => h.acao === "DELETE");
    const primeiro = g.itens[0];
    return `<tr class="grupo">
      <td>${esc(fmtData.format(new Date(g.quando)))}</td>
      <td>${exclusao ? "Exclusão em massa" : "Edição em massa"}</td>
      <td class="c-sku">${fmt.format(g.itens.length)} produtos</td>
      <td>${esc(primeiro.dados.descricao_tecnica)} <span class="dica">e mais ${fmt.format(g.itens.length - 1)}</span></td>
      <td class="c-tags"><span class="dica">versões anteriores</span></td>
      <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-grupo="${i}">${window.CBSIcon("rotate-ccw", 14)}Restaurar todos</button></td>
    </tr>`;
  }

  async function carregarHistorico() {
    const corpo = $("#corpoHistorico");
    corpo.innerHTML = `<tr><td colspan="6" class="vazio">Carregando...</td></tr>`;
    try {
      const de = $("#histDe").value;
      const ate = $("#histAte").value;
      $("#btnHistLimpar").hidden = !(de || ate);
      if (de && ate && de > ate) {
        corpo.innerHTML = `<tr><td colspan="6" class="vazio">A data inicial é depois da final.</td></tr>`;
        $("#infoHistorico").textContent = "";
        return;
      }
      historicoCache = await api.historico(2000, { de, ate });
      historicoGrupos = agruparHistorico(historicoCache);
      corpo.innerHTML =
        historicoCache.length === 0
          ? `<tr><td colspan="6" class="vazio">${de || ate ? "Nenhuma alteração neste período." : "Nenhuma alteração registrada ainda."}</td></tr>`
          : historicoGrupos
              .slice(0, 100)
              .map((g, i) => (g.itens.length > 1 ? linhaGrupo(g, i) : linhaHistorico(g.itens[0])))
              .join("");
      $("#infoHistorico").textContent =
        historicoCache.length === 0
          ? ""
          : `${fmt.format(historicoCache.length)} registro(s)` +
            (historicoGrupos.length > 100 ? " · mostrando as 100 alterações mais recentes; use as datas para ver as anteriores" : "");
    } catch (err) {
      corpo.innerHTML = `<tr><td colspan="6" class="vazio">${esc(err.message)}</td></tr>`;
    }
  }

  ["#histDe", "#histAte"].forEach((id) => $(id).addEventListener("change", carregarHistorico));
  $("#btnHistLimpar").addEventListener("click", () => {
    $("#histDe").value = "";
    $("#histAte").value = "";
    carregarHistorico();
  });

  $("#corpoHistorico").addEventListener("click", async (e) => {
    const btnGrupo = e.target.closest("button[data-grupo]");
    if (btnGrupo) {
      const g = historicoGrupos[Number(btnGrupo.dataset.grupo)];
      if (!g) return;
      btnGrupo.disabled = true;
      try {
        // se o mesmo SKU aparece mais de uma vez no grupo, vale a versão mais antiga guardada
        const porSku = new Map();
        for (const h of g.itens) porSku.set(h.sku, h.dados);
        await api.restaurarVarios([...porSku.values()]);
        await carregarProdutos();
        await carregarHistorico();
        aviso(`${fmt.format(porSku.size)} produtos restaurados.`);
      } catch (err) {
        aviso(err.message, true);
        btnGrupo.disabled = false;
      }
      return;
    }
    const btn = e.target.closest("button[data-hid]");
    if (!btn) return;
    const entrada = historicoCache.find((h) => String(h.id) === btn.dataset.hid);
    if (!entrada) return;
    btn.disabled = true;
    try {
      await api.restaurar(entrada.dados);
      await carregarProdutos();
      await carregarHistorico();
      aviso(`Produto ${entrada.sku} restaurado.`);
    } catch (err) {
      aviso(err.message, true);
      btn.disabled = false;
    }
  });

  /* ---------------- login ---------------- */

  function mostrarLogin(mensagem = "") {
    document.body.classList.remove("logado");
    $("#areaAdmin").hidden = true;
    $("#telaLogin").hidden = false;
    $("#btnSair").hidden = true;
    $("#topoUsuario").hidden = true;
    $("#loginErro").textContent = mensagem;
    $("#loginSenha").value = "";
    for (const dlg of document.querySelectorAll("dialog[open]")) dlg.close();
    estado.produtos = [];
    estado.selecionados.clear();
    ($("#loginEmail").value ? $("#loginSenha") : $("#loginEmail")).focus();
  }

  async function mostrarAdmin() {
    document.body.classList.add("logado");
    $("#telaLogin").hidden = true;
    $("#areaAdmin").hidden = false;
    $("#btnSair").hidden = false;
    $("#topoUsuario").hidden = false;
    $("#topoUsuario").textContent = api.emailLogado();
    mostrarAba("produtos");
    $("#infoLista").textContent = "Carregando produtos...";
    try {
      await carregarProdutos();
    } catch (err) {
      $("#infoLista").textContent = "";
      aviso(`Não foi possível carregar os produtos: ${err.message}`, true);
    }
  }

  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    const senha = $("#loginSenha").value;
    const erro = $("#loginErro");
    erro.textContent = "";
    if (!email || !senha) {
      erro.textContent = "Informe e-mail e senha.";
      return;
    }
    const btn = $("#btnEntrar");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    try {
      await api.entrar(email, senha);
      $("#loginSenha").value = "";
      await mostrarAdmin();
    } catch (err) {
      erro.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  $("#btnSair").addEventListener("click", async () => {
    await api.sair();
    mostrarLogin();
  });
  window.addEventListener("cbs:sessao-expirada", () => mostrarLogin("Sua sessão expirou. Entre novamente."));

  /* ---------------- início ---------------- */

  async function iniciar() {
    if (!api || !api.configurado) {
      $("#avisoConfig").hidden = false;
      $("#areaAdmin").hidden = false;
      document.body.classList.add("logado");
      document.querySelectorAll("#btnNovo, #arquivoCsv, #btnExportar, #btnExportarLeve").forEach((el) => (el.disabled = true));
      $("#infoLista").textContent = "Supabase não configurado.";
      return;
    }
    if (api.logado()) await mostrarAdmin();
    else mostrarLogin();
  }

  iniciar();
})();
