import { escaparHtml as esc, normalizar, formatarRef, ordemTexto } from "../js/comum/texto.js";
import { fmtData, fmt4, fmtPct, fmtNum, formatarDifReais } from "../js/comum/numeros.js";
import { copiarTexto } from "../js/comum/copiar.js";
import * as baseOffline from "../js/comum/base-offline.js";

/* ==========================================================================
   Novidades do catálogo: produtos adicionados (data de inclusão), mudanças de
   preço (Lista Diária deste navegador, comparada com a anterior) e produtos
   removidos (histórico do banco). Filtros, ordenação por coluna e + cotação.
   ========================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const api = window.CBS_API;
  const cot = window.CBSCotacao;
  const CHAVE_LISTA = "cbs_lista_diaria_v1";
  const POR_VEZ = 200; // linhas desenhadas por vez ("Mostrar mais")
  const DIA_MS = 24 * 60 * 60 * 1000;


  const estado = {
    aba: ["adicionados", "precos", "removidos"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "adicionados",
    catalogo: null, // Map sku -> produto
    removidos: undefined, // array | null (indisponível)
    lista: null, // { dataLista, comparadaCom, itens: [{sku, anterior, atual, dif, pct}] }
    ordem: {
      adicionados: { col: "data", dir: -1 },
      precos: { col: "pct", dir: -1 },
      removidos: { col: "data", dir: -1 },
    },
    mostrar: POR_VEZ,
  };

  /* ---------- dados ---------- */

  async function carregarCatalogo() {
    let dados = null;
    try {
      if (api && api.configurado) dados = await api.listarProdutos(); // o mais novo (com a data de inclusão)
    } catch (_) {}
    if (!dados) dados = await baseOffline.lerProdutos(); // sem internet: a base guardada pela busca
    if (!dados) {
      try { dados = await (await fetch("../db.json")).json(); } catch (_) { dados = []; }
    }
    estado.catalogo = new Map(
      dados.map((p) => [String(p.sku), {
        sku: String(p.sku),
        descricao: p.descricao_tecnica || p.descricao || "",
        referencia: formatarRef(p.referencia),
        categoria: String(p.categoria ?? "").trim() || "-",
        unidade: String(p.unidade ?? "").trim().toUpperCase(),
        criado_em: p.criado_em ? Date.parse(p.criado_em) : null,
      }]),
    );
  }

  // Lista Diária deste navegador (só leitura; a variação já vem calculada ao carregar a lista)
  function lerLista() {
    try {
      const o = JSON.parse(localStorage.getItem(CHAVE_LISTA) || "null");
      if (!o || !Array.isArray(o.itens) || Date.now() > o.expiraEm) return null;
      const atual = new Map(o.itens.map(([sku, , preco]) => [String(sku), preco]));
      const itens = (o.variacoes || [])
        .map(([sku, anterior]) => {
          const a = atual.get(String(sku));
          return a ? { sku: String(sku), anterior, atual: a, dif: a - anterior, pct: ((a - anterior) / anterior) * 100 } : null;
        })
        .filter(Boolean);
      return { dataLista: o.dataLista || o.atualizadoEm, comparadaCom: o.comparadaCom || null, itens };
    } catch (_) {
      return null;
    }
  }

  /* ---------- filtros e linhas ---------- */

  const periodoDias = () => Number($("#fPeriodo").value) || 30;
  const desde = () => new Date(Date.now() - (periodoDias() - 1) * DIA_MS).setHours(0, 0, 0, 0);

  function passaFiltros(p) {
    const cat = $("#fCategoria").value;
    if (cat && p.categoria !== cat) return false;
    const termos = normalizar($("#fTexto").value).split(/\s+/).filter(Boolean);
    if (!termos.length) return true;
    const alvo = normalizar(`${p.sku} ${p.descricao} ${p.referencia}`);
    return termos.every((t) => alvo.includes(t));
  }

  function linhasAdicionados() {
    if (!estado.catalogo) return [];
    const ini = desde();
    return [...estado.catalogo.values()].filter((p) => p.criado_em && p.criado_em >= ini).map((p) => ({ ...p, data: p.criado_em }));
  }

  function linhasPrecos() {
    if (!estado.lista) return [];
    const dir = $("#fDirecao").value;
    return estado.lista.itens
      .filter((v) => !dir || (dir === "baixa" ? v.dif < 0 : v.dif > 0))
      .map((v) => {
        const p = (estado.catalogo && estado.catalogo.get(v.sku)) || { sku: v.sku, descricao: "(fora do catálogo)", referencia: "", categoria: "-" };
        return { ...p, ...v };
      });
  }

  function linhasRemovidos() {
    if (!estado.removidos) return [];
    const ini = desde();
    return estado.removidos
      .map((r) => ({
        sku: String(r.sku),
        descricao: r.descricao_tecnica || "",
        referencia: formatarRef(r.referencia),
        categoria: String(r.categoria ?? "").trim() || "-",
        data: Date.parse(r.removido_em),
      }))
      .filter((r) => r.data >= ini);
  }

  const LINHAS = { adicionados: linhasAdicionados, precos: linhasPrecos, removidos: linhasRemovidos };

  /* ---------- colunas (título, chave de ordenação e célula) ---------- */

  const celCod = (p) => `<td class="n-cod">${esc(p.sku)}</td>`;
  const celDesc = (p) => `<td class="n-desc">${esc(p.descricao)}${p.referencia ? `<span class="n-ref">Ref. ${esc(p.referencia)}</span>` : ""}</td>`;
  const celCat = (p) => `<td class="n-cat">${p.categoria === "-" ? '<span class="n-vazio">–</span>' : esc(p.categoria)}</td>`;
  const celData = (p) => `<td class="n-data">${fmtData.format(new Date(p.data))}</td>`;
  function celCot(p) {
    if (!cot || !estado.catalogo || !estado.catalogo.has(p.sku)) return `<td class="n-cot"></td>`;
    const na = cot.tem(p.sku);
    return `<td class="n-cot"><button type="button" class="cot-btn${na ? " is-marcado" : ""}" data-cot="${esc(p.sku)}" aria-pressed="${na}" title="${na ? "Tirar da cotação" : "Adicionar à cotação (e copiar o código)"}" aria-label="${na ? "Tirar da cotação" : "Adicionar à cotação"}: ${esc(p.sku)}">${na ? "✓" : "+"}</button></td>`;
  }
  function celVar(p) {
    const caiu = p.dif < 0;
    return `<td class="n-num n-var n-var--${caiu ? "baixa" : "alta"}">${caiu ? "▼ −" : "▲ +"}${fmtPct.format(Math.abs(p.pct))}%</td>` +
      `<td class="n-num n-var n-var--${caiu ? "baixa" : "alta"}">${formatarDifReais(p.dif)}</td>`;
  }

  const COLUNAS = {
    adicionados: [
      { id: "data", titulo: "Incluído em", chave: (p) => p.data },
      { id: "sku", titulo: "Código", chave: (p) => p.sku },
      { id: "descricao", titulo: "Descrição do produto", chave: (p) => p.descricao },
      { id: "categoria", titulo: "Categoria", chave: (p) => (p.categoria === "-" ? "" : p.categoria) },
      { id: "cot", titulo: '<span class="sr-only">Cotação</span>' },
    ],
    precos: [
      { id: "sku", titulo: "Código", chave: (p) => p.sku },
      { id: "descricao", titulo: "Descrição do produto", chave: (p) => p.descricao },
      { id: "anterior", titulo: "Antes", chave: (p) => p.anterior, num: true },
      { id: "atual", titulo: "Agora", chave: (p) => p.atual, num: true },
      { id: "pct", titulo: "Variação", chave: (p) => Math.abs(p.pct), num: true },
      { id: "dif", titulo: "Diferença", chave: (p) => p.dif, num: true },
      { id: "cot", titulo: '<span class="sr-only">Cotação</span>' },
    ],
    removidos: [
      { id: "data", titulo: "Removido em", chave: (p) => p.data },
      { id: "sku", titulo: "Código", chave: (p) => p.sku },
      { id: "descricao", titulo: "Descrição do produto", chave: (p) => p.descricao },
      { id: "categoria", titulo: "Categoria", chave: (p) => (p.categoria === "-" ? "" : p.categoria) },
    ],
  };

  function linhaHtml(aba, p) {
    if (aba === "adicionados") return `<tr>${celData(p)}${celCod(p)}${celDesc(p)}${celCat(p)}${celCot(p)}</tr>`;
    if (aba === "removidos") return `<tr>${celData(p)}${celCod(p)}${celDesc(p)}${celCat(p)}</tr>`;
    return `<tr>${celCod(p)}${celDesc(p)}<td class="n-num">R$ ${fmt4.format(p.anterior)}</td><td class="n-num n-agora">R$ ${fmt4.format(p.atual)}</td>${celVar(p)}${celCot(p)}</tr>`;
  }

  function ordenar(aba, linhas) {
    const { col, dir } = estado.ordem[aba];
    const c = COLUNAS[aba].find((x) => x.id === col);
    if (!c || !c.chave) return linhas;
    return linhas.sort((a, b) => {
      const va = c.chave(a), vb = c.chave(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : ordemTexto.compare(String(va), String(vb));
      return r * dir || ordemTexto.compare(a.sku, b.sku);
    });
  }

  /* ---------- tela ---------- */

  function desenharCabecalho(aba) {
    const { col, dir } = estado.ordem[aba];
    $("#novCabecalho").innerHTML =
      "<tr>" +
      COLUNAS[aba]
        .map((c) => {
          const cls = `${c.num ? "n-num " : ""}n-th-${c.id}`;
          if (!c.chave) return `<th class="${cls}">${c.titulo}</th>`;
          const ativo = c.id === col;
          const sort = ativo ? (dir === 1 ? "ascending" : "descending") : "none";
          return `<th class="${cls}" aria-sort="${sort}"><button type="button" class="n-ordenar${ativo ? " is-ativo" : ""}" data-col="${c.id}">${c.titulo}<span class="n-seta" aria-hidden="true">${ativo ? (dir === 1 ? "↑" : "↓") : "↕"}</span></button></th>`;
        })
        .join("") +
      "</tr>";
  }

  function textoInfo(aba, total) {
    const per = { 7: "nos últimos 7 dias", 30: "nos últimos 30 dias", 90: "nos últimos 90 dias", 365: "no último ano" }[periodoDias()];
    if (aba === "adicionados") {
      if (!estado.catalogo) return "Carregando o catálogo...";
      return total
        ? `<strong>${fmtNum.format(total)}</strong> produto(s) incluído(s) ${per}.`
        : `Nenhum produto incluído ${per}${filtrando() ? " com esses filtros" : ""}. A data de inclusão é registrada para os produtos que entram a partir desta versão do site.`;
    }
    if (aba === "removidos") {
      if (estado.removidos === undefined) return "Carregando...";
      if (estado.removidos === null) return "A lista de removidos ainda não está disponível.";
      return total ? `<strong>${fmtNum.format(total)}</strong> produto(s) removido(s) do catálogo ${per}.` : `Nenhum produto removido ${per}${filtrando() ? " com esses filtros" : ""}.`;
    }
    if (!estado.lista) return 'Carregue a Lista Diária na <a href="../">busca</a> para ver as mudanças de preço (a comparação é feita neste navegador).';
    if (!estado.lista.comparadaCom) return "A Lista Diária carregada não tem uma lista de data anterior para comparar. Carregue uma lista mais nova para ver as mudanças.";
    const de = fmtData.format(new Date(estado.lista.comparadaCom)), ate = fmtData.format(new Date(estado.lista.dataLista));
    return `<strong>${fmtNum.format(total)}</strong> preço(s) campanha mudaram da lista de <strong>${de}</strong> para a de <strong>${ate}</strong>. Valores consultivos: confirme no Protheus (TOTVS).`;
  }
  const filtrando = () => Boolean($("#fCategoria").value || $("#fTexto").value.trim() || (estado.aba === "precos" && $("#fDirecao").value));

  function desenhar() {
    const aba = estado.aba;
    document.querySelectorAll(".nov-card").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
    $("#novPainel").setAttribute("aria-labelledby", `aba-${aba}`);
    $("#campoPeriodo").hidden = aba === "precos";
    $("#campoDirecao").hidden = aba !== "precos";

    const todas = LINHAS[aba]();
    const linhas = ordenar(aba, todas.filter(passaFiltros));
    $("#novInfo").innerHTML = textoInfo(aba, linhas.length);
    $("#novTabelaWrap").hidden = linhas.length === 0;
    desenharCabecalho(aba);
    $("#novCorpo").innerHTML = linhas.slice(0, estado.mostrar).map((p) => linhaHtml(aba, p)).join("");
    const resta = linhas.length - estado.mostrar;
    $("#novMais").hidden = resta <= 0;
    $("#novMais").textContent = `Mostrar mais (${fmtNum.format(Math.min(resta, POR_VEZ))} de ${fmtNum.format(resta)})`;
    desenharCartoes();
  }

  function desenharCartoes() {
    const sem = (f) => f().length; // números do período, sem os filtros de texto/categoria
    $("#nAdicionados").textContent = estado.catalogo ? fmtNum.format(sem(linhasAdicionados)) : "–";
    $("#nRemovidos").textContent = estado.removidos === undefined ? "–" : estado.removidos === null ? "—" : fmtNum.format(sem(linhasRemovidos));
    $("#nPrecos").textContent = estado.lista ? fmtNum.format(estado.lista.itens.length) : "—";
    const per = { 7: "últimos 7 dias", 30: "últimos 30 dias", 90: "últimos 90 dias", 365: "último ano" }[periodoDias()];
    $("#subAdicionados").textContent = per;
    $("#subRemovidos").textContent = per;
    $("#subPrecos").textContent = estado.lista && estado.lista.comparadaCom
      ? `${fmtData.format(new Date(estado.lista.comparadaCom)).slice(0, 5)} → ${fmtData.format(new Date(estado.lista.dataLista)).slice(0, 5)}`
      : "carregue a Lista Diária";
  }

  function preencherCategorias() {
    const sel = $("#fCategoria");
    const cats = new Set();
    if (estado.catalogo) for (const p of estado.catalogo.values()) if (p.categoria !== "-") cats.add(p.categoria);
    if (estado.removidos) for (const r of estado.removidos) if (r.categoria && r.categoria !== "-") cats.add(r.categoria);
    const atual = sel.value;
    sel.innerHTML = `<option value="">Todas</option>` + [...cats].sort(ordemTexto.compare).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === atual) ? atual : "";
  }

  /* ---------- eventos ---------- */

  function trocarAba(aba) {
    estado.aba = aba;
    estado.mostrar = POR_VEZ;
    try { history.replaceState(null, "", `#${aba}`); } catch (_) {}
    desenhar();
  }
  document.querySelector(".nov-cards").addEventListener("click", (e) => {
    const b = e.target.closest(".nov-card");
    if (b) trocarAba(b.dataset.aba);
  });
  // setas esquerda/direita entre as abas (padrão de tablist)
  document.querySelector(".nov-cards").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const abas = [...document.querySelectorAll(".nov-card")];
    const i = abas.indexOf(document.activeElement);
    if (i === -1) return;
    const prox = abas[(i + (e.key === "ArrowRight" ? 1 : abas.length - 1)) % abas.length];
    prox.focus();
    trocarAba(prox.dataset.aba);
  });
  $("#novCabecalho").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-col]");
    if (!b) return;
    const o = estado.ordem[estado.aba];
    if (o.col === b.dataset.col) o.dir *= -1;
    else {
      o.col = b.dataset.col;
      o.dir = ["sku", "descricao", "categoria"].includes(o.col) ? 1 : -1; // texto: A→Z; números e datas: maior primeiro
    }
    desenhar();
    const novo = $(`#novCabecalho button[data-col="${o.col}"]`);
    if (novo) novo.focus();
  });
  let timer = null;
  $("#fTexto").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { estado.mostrar = POR_VEZ; desenhar(); }, 150); });
  ["#fPeriodo", "#fCategoria", "#fDirecao"].forEach((s) => $(s).addEventListener("change", () => { estado.mostrar = POR_VEZ; desenhar(); }));
  $("#novMais").addEventListener("click", () => { estado.mostrar += POR_VEZ; desenhar(); });

  // + cotação (igual à busca: também copia o código)
  const aviso = $("#avisoCotacao");
  let timerAviso = null;
  function avisar(html) {
    aviso.innerHTML = `<span>${html}</span><a href="../cotacao/">Ver cotação</a>`;
    aviso.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => (aviso.hidden = true), 3500);
  }
  function atualizarContador() {
    const n = cot ? cot.quantidade() : 0;
    const c = $("#contadorCotacao");
    c.hidden = n === 0;
    c.textContent = String(n);
  }
  $("#novCorpo").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-cot]");
    if (!b || !cot) return;
    const sku = b.dataset.cot;
    if (cot.tem(sku)) {
      cot.remover(sku);
      avisar(`<strong>${esc(sku)}</strong> saiu da cotação.`);
    } else {
      const copia = copiarTexto(sku);
      const p = estado.catalogo.get(sku);
      const v = estado.lista ? estado.lista.itens.find((x) => x.sku === sku) : null;
      cot.adicionar({ sku, descricao: p.descricao, referencia: p.referencia, um: p.unidade, preco: v ? v.atual : null });
      const copiou = await copia;
      avisar(`<strong>${esc(sku)}</strong> adicionado à cotação${copiou ? " e código copiado" : ""} (${cot.quantidade()} ${cot.quantidade() === 1 ? "item" : "itens"}).`);
    }
    desenhar();
    const novo = $(`#novCorpo button[data-cot="${CSS.escape(sku)}"]`);
    if (novo) novo.focus();
  });
  if (cot) cot.aoMudar(() => { atualizarContador(); desenhar(); });
  window.addEventListener("storage", (e) => {
    if (e.key === CHAVE_LISTA) { estado.lista = lerLista(); desenhar(); }
  });

  /* ---------- início ---------- */
  estado.lista = lerLista();
  atualizarContador();
  desenhar();
  carregarCatalogo().then(() => { preencherCategorias(); desenhar(); });
  (api && api.configurado && api.produtosRemovidos ? api.produtosRemovidos(366) : Promise.resolve(null)).then((r) => {
    estado.removidos = r;
    preencherCategorias();
    desenhar();
  });
})();
