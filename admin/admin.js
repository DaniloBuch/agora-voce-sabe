(() => {
  const api = window.CBS_API;
  const $ = (sel) => document.querySelector(sel);

  const TAMANHO_PAGINA = 50;
  const LIMITE_ALERTA_EXCLUSAO = 0.2; // pede confirmação extra se >20% da base sumir

  const estado = {
    produtos: [], // {sku, descricao_tecnica, referencia, tags, fixo, _busca}
    filtro: "",
    semTags: false,
    pagina: 1,
    tagsEdicao: [],
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
    return {
      sku: String(p.sku),
      descricao_tecnica: String(p.descricao_tecnica ?? ""),
      referencia: String(p.referencia ?? ""),
      tags,
      fixo: Boolean(p.fixo),
      _busca: normalizar(`${p.sku} ${p.descricao_tecnica} ${p.referencia} ${tags}`),
    };
  }

  /* ---------------- carga inicial ---------------- */

  async function carregarProdutos() {
    const dados = await api.listarProdutos();
    estado.produtos = dados.map(prepararProduto);
    atualizarSugestoesTags();
    renderizarLista();
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
    ["produtos", "importar", "historico"].forEach((n) => {
      $(`#aba-${n}`).hidden = n !== nome;
    });
    if (nome === "historico") carregarHistorico();
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
        (!estado.semTags || p.tags.trim() === ""),
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
        ? `<tr><td colspan="5" class="vazio">Nenhum produto encontrado com esse filtro.</td></tr>`
        : pagina
            .map((p) => {
              const tags = separarTags(p.tags);
              const tagsHtml =
                tags.length === 0
                  ? `<span class="sem-tags">sem tags</span>`
                  : tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("");
              return `<tr>
                <td class="c-sku">${esc(p.sku)}${p.fixo ? '<span class="selo" title="Fixo: nunca excluído pela importação">fixo</span>' : ""}</td>
                <td class="c-ref">${esc(p.referencia)}</td>
                <td>${esc(p.descricao_tecnica)}</td>
                <td class="c-tags">${tagsHtml}</td>
                <td class="c-acoes">
                  <button class="btn btn--secundario btn--sm" data-acao="editar" data-sku="${esc(p.sku)}">${window.CBSIcon("pencil", 14)}Editar</button>
                  <button class="btn btn--secundario btn--sm btn--excluir" data-acao="excluir" data-sku="${esc(p.sku)}">${window.CBSIcon("trash-2", 14)}Excluir</button>
                </td>
              </tr>`;
            })
            .join("");

    $("#infoPagina").textContent = `Página ${estado.pagina} de ${totalPaginas}`;
    $("#btnAnterior").disabled = estado.pagina <= 1;
    $("#btnProxima").disabled = estado.pagina >= totalPaginas;
  }

  let timerFiltro = null;
  $("#filtro").addEventListener("input", (e) => {
    clearTimeout(timerFiltro);
    timerFiltro = setTimeout(() => {
      estado.filtro = e.target.value;
      estado.pagina = 1;
      renderizarLista();
    }, 200);
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

  function renderizarChips() {
    const campo = $("#fTagInput");
    $("#chips")
      .querySelectorAll(".chip")
      .forEach((c) => c.remove());
    estado.tagsEdicao.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      const x = document.createElement("button");
      x.type = "button";
      x.innerHTML = window.CBSIcon("x", 12);
      x.setAttribute("aria-label", `Remover ${tag}`);
      x.addEventListener("click", () => {
        estado.tagsEdicao.splice(i, 1);
        renderizarChips();
        campo.focus();
      });
      chip.appendChild(x);
      $("#chips").insertBefore(chip, campo);
    });
  }

  function adicionarTags(texto) {
    for (const bruta of separarTags(texto)) {
      const tag = bruta.toLocaleUpperCase("pt-BR");
      if (!estado.tagsEdicao.some((t) => normalizar(t) === normalizar(tag))) {
        estado.tagsEdicao.push(tag);
      }
    }
    renderizarChips();
  }

  const campoTag = $("#fTagInput");
  campoTag.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      adicionarTags(campoTag.value);
      campoTag.value = "";
    } else if (e.key === "Backspace" && campoTag.value === "" && estado.tagsEdicao.length) {
      estado.tagsEdicao.pop();
      renderizarChips();
    }
  });
  campoTag.addEventListener("change", () => {
    // escolha de uma sugestão do datalist
    if (campoTag.value.trim()) {
      adicionarTags(campoTag.value);
      campoTag.value = "";
    }
  });
  campoTag.addEventListener("blur", () => {
    if (campoTag.value.trim()) {
      adicionarTags(campoTag.value);
      campoTag.value = "";
    }
  });
  $("#chips").addEventListener("click", (e) => {
    if (e.target === $("#chips")) campoTag.focus();
  });

  function abrirEdicao(produto) {
    estado.skuEmEdicao = produto ? produto.sku : null;
    $("#dlgTitulo").textContent = produto ? `Editar produto ${produto.sku}` : "Novo produto";
    $("#fSku").value = produto ? produto.sku : "";
    $("#fSku").readOnly = Boolean(produto);
    $("#fDesc").value = produto ? produto.descricao_tecnica : "";
    $("#fRef").value = produto ? produto.referencia : "";
    $("#fFixo").checked = produto ? produto.fixo : false;
    estado.tagsEdicao = produto ? separarTags(produto.tags) : [];
    campoTag.value = "";
    $("#fErro").textContent = "";
    renderizarChips();
    $("#dlgProduto").showModal();
    (produto ? campoTag : $("#fSku")).focus();
  }

  $("#btnNovo").addEventListener("click", () => abrirEdicao(null));
  $("#btnCancelar").addEventListener("click", () => $("#dlgProduto").close());
  $("#btnFecharProduto").addEventListener("click", () => $("#dlgProduto").close());

  $("#formProduto").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (campoTag.value.trim()) {
      adicionarTags(campoTag.value);
      campoTag.value = "";
    }
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
      tags: estado.tagsEdicao.join(", "),
      fixo: $("#fFixo").checked,
    };

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
      renderizarLista();
      $("#dlgProduto").close();
      aviso(criando ? "Produto criado." : "Produto salvo.");
    } catch (err) {
      erro.textContent = err.status === 409 ? `Já existe um produto com o SKU ${sku}.` : err.message;
    } finally {
      btn.disabled = false;
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

  function limparCabecalho(t) {
    return normalizar(t).replace(/[^a-z0-9]+/g, " ").trim();
  }

  function mapearColunas(cabecalho) {
    const nomes = cabecalho.map(limparCabecalho);
    const mapa = {};
    for (const [campo, aliases] of Object.entries(ALIASES)) {
      const idx = nomes.findIndex((n) => aliases.includes(n));
      if (idx === -1) return { erro: campo, encontrados: cabecalho };
      mapa[campo] = idx;
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

  function analisarCsv(texto) {
    const linhas = parseCsv(texto);
    if (linhas.length < 2) throw new Error("O arquivo está vazio ou só tem o cabeçalho.");
    const { mapa, erro, encontrados } = mapearColunas(linhas[0]);
    if (erro) {
      throw new Error(
        `Coluna "${ROTULO_COLUNA[erro]}" não encontrada. Colunas no arquivo: ${encontrados.join(" | ")}`,
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
      itens.set(sku, {
        sku,
        descricao_tecnica: String(l[mapa.descricao_tecnica] ?? "").trim(),
        referencia: String(l[mapa.referencia] ?? "").trim(),
      });
    }
    if (itens.size === 0) throw new Error("Nenhum SKU válido encontrado no arquivo.");

    const atuais = new Map(estado.produtos.map((p) => [p.sku, p]));
    const novos = [];
    const alterados = [];
    let iguais = 0;
    for (const item of itens.values()) {
      const atual = atuais.get(item.sku);
      if (!atual) novos.push(item);
      else if (
        atual.descricao_tecnica !== item.descricao_tecnica ||
        atual.referencia !== item.referencia
      ) {
        alterados.push({ item, atual });
      } else iguais++;
    }
    const removidos = estado.produtos.filter((p) => !p.fixo && !itens.has(p.sku));
    const fixosFora = estado.produtos.filter((p) => p.fixo && !itens.has(p.sku)).length;

    return {
      itens: [...itens.values()],
      novos,
      alterados,
      iguais,
      removidos,
      fixosFora,
      semSku,
      duplicados,
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
        <div class="item"><div class="num">${fmt.format(a.alterados.length)}</div><div class="rot">com descrição/ref. alterada</div></div>
        <div class="item removidos"><div class="num">${fmt.format(a.removidos.length)}</div><div class="rot">descontinuados (não estão no CSV)</div></div>
        <div class="item"><div class="num">${fmt.format(a.iguais)}</div><div class="rot">sem mudança</div></div>
      </div>
      ${a.semSku || a.duplicados ? alerta("alerta", `Ignorados no CSV: ${fmt.format(a.semSku)} linha(s) sem código e ${fmt.format(a.duplicados)} código(s) repetido(s).`) : ""}
      ${a.fixosFora ? alerta("info", `${fmt.format(a.fixosFora)} produto(s) marcado(s) como "fixo" não está(ão) no CSV e será(ão) mantido(s).`) : ""}
      ${a.novos.length ? `<details><summary>Novos (${fmt.format(a.novos.length)})</summary><div class="conteudo">${listaLimitada(a.novos, (n) => `<div><strong>${esc(n.sku)}</strong> ${esc(n.descricao_tecnica)}</div>`)}</div></details>` : ""}
      ${a.alterados.length ? `<details><summary>Alterados (${fmt.format(a.alterados.length)})</summary><div class="conteudo">${listaLimitada(a.alterados, ({ item, atual }) => {
        const partes = [];
        if (atual.descricao_tecnica !== item.descricao_tecnica)
          partes.push(`<span class="de">${esc(atual.descricao_tecnica)}</span> → <span class="para">${esc(item.descricao_tecnica)}</span>`);
        if (atual.referencia !== item.referencia)
          partes.push(`ref: <span class="de">${esc(atual.referencia || "(vazio)")}</span> → <span class="para">${esc(item.referencia || "(vazio)")}</span>`);
        return `<div><strong>${esc(item.sku)}</strong> ${partes.join(" · ")}</div>`;
      })}</div></details>` : ""}
      ${a.removidos.length ? `<details><summary>Descontinuados a excluir (${fmt.format(a.removidos.length)})</summary><div class="conteudo">${listaLimitada(a.removidos, (r) => `<div><strong>${esc(r.sku)}</strong> ${esc(r.descricao_tecnica)}</div>`)}</div></details>` : ""}

      <div class="opcoes">
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
        $("#resultadoImport").innerHTML = alerta("ok", `Importação concluída: ${fmt.format(r.inseridos)} incluído(s), ${fmt.format(r.atualizados)} atualizado(s), ${fmt.format(r.excluidos)} excluído(s). Os excluídos e alterados ficam no Histórico.`);
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

  /* ---------------- histórico ---------------- */

  let historicoCache = [];

  async function carregarHistorico() {
    const corpo = $("#corpoHistorico");
    corpo.innerHTML = `<tr><td colspan="6" class="vazio">Carregando...</td></tr>`;
    try {
      historicoCache = await api.historico(100);
      corpo.innerHTML =
        historicoCache.length === 0
          ? `<tr><td colspan="6" class="vazio">Nenhuma alteração registrada ainda.</td></tr>`
          : historicoCache
              .map(
                (h) => `<tr>
              <td>${esc(fmtData.format(new Date(h.registrado_em)))}</td>
              <td>${h.acao === "DELETE" ? "Excluído" : "Editado"}</td>
              <td class="c-sku">${esc(h.sku)}</td>
              <td>${esc(h.dados.descricao_tecnica)}</td>
              <td class="c-tags">${separarTags(h.dados.tags).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</td>
              <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-hid="${h.id}">${window.CBSIcon("rotate-ccw", 14)}Restaurar</button></td>
            </tr>`,
              )
              .join("");
    } catch (err) {
      corpo.innerHTML = `<tr><td colspan="6" class="vazio">${esc(err.message)}</td></tr>`;
    }
  }

  $("#corpoHistorico").addEventListener("click", async (e) => {
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

  /* ---------------- início ---------------- */

  async function iniciar() {
    if (!api || !api.configurado) {
      $("#avisoConfig").hidden = false;
      document.querySelectorAll("#btnNovo, #arquivoCsv").forEach((el) => (el.disabled = true));
      $("#infoLista").textContent = "Supabase não configurado.";
      return;
    }
    $("#infoLista").textContent = "Carregando produtos...";
    try {
      await carregarProdutos();
    } catch (err) {
      $("#infoLista").textContent = "";
      aviso(`Não foi possível carregar os produtos: ${err.message}`, true);
    }
  }

  iniciar();
})();
