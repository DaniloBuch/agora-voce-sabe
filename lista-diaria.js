/* ==========================================================================
   Lista Diária (saldo e preço campanha) — consulta LOCAL
   - O Excel é lido no próprio navegador (SheetJS, carregado só quando alguém envia um arquivo).
   - Nada é enviado ao banco nem a qualquer servidor.
   - Os valores ficam no localStorage deste navegador por no máximo 24 horas e depois são apagados.
   - Qualquer pessoa pode carregar a lista (não precisa de login).
   ========================================================================== */
(function () {
  "use strict";

  const CHAVE = "cbs_lista_diaria_v1";
  const VALIDADE_MS = 24 * 60 * 60 * 1000; // 24 horas
  const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
  const SHEETJS_URL = "vendor/xlsx.full.min.js";

  const $ = (id) => document.getElementById(id);
  const el = {
    botao: $("listaBotao"),
    arquivo: $("listaArquivo"),
    status: $("listaStatus"),
    limpar: $("listaLimpar"),
    ajuda: $("listaAjuda"),
    ajudaTexto: $("listaAjudaTexto"),
    msg: $("listaMsg"),
    nota: $("listaNota"),
  };
  if (!el.botao) return; // página sem o recurso

  let dados = null; // { nome, atualizadoEm, expiraEm, mapa: Map(sku -> {saldo, preco}) }
  let memoriaApenas = null; // se o localStorage não estiver disponível, vale só nesta aba
  let timer = null;

  const fmtSaldo = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
  const fmtPreco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

  /* ---------- armazenamento (com validade) ---------- */

  function lerArmazenado() {
    let bruto = null;
    try {
      bruto = localStorage.getItem(CHAVE);
    } catch (_) {
      return memoriaApenas;
    }
    if (!bruto) return null;
    try {
      const o = JSON.parse(bruto);
      if (!o || o.v !== 1 || !Array.isArray(o.itens) || !Number.isFinite(o.atualizadoEm) || !Number.isFinite(o.expiraEm)) return null;
      return o;
    } catch (_) {
      return null;
    }
  }

  function apagarArmazenado() {
    memoriaApenas = null;
    try {
      localStorage.removeItem(CHAVE);
    } catch (_) {
      /* sem acesso ao armazenamento: nada a apagar */
    }
  }

  function salvarArmazenado(obj) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(obj));
      memoriaApenas = null;
    } catch (_) {
      memoriaApenas = obj; // navegador bloqueou o armazenamento: vale só enquanto a aba estiver aberta
    }
  }

  function expirada(o, agora = Date.now()) {
    // também descarta se o relógio do computador voltou para antes do envio
    return agora >= o.expiraEm || agora < o.atualizadoEm - TOLERANCIA_RELOGIO_MS;
  }

  /** Lê o que está salvo, apaga se passou de 24 h e atualiza a tela. Devolve true se houve expiração. */
  function sincronizar() {
    const o = lerArmazenado();
    let expirou = false;
    if (o && expirada(o)) {
      apagarArmazenado();
      expirou = true;
      dados = null;
    } else if (o) {
      const mapa = new Map();
      for (const [sku, saldo, preco] of o.itens) mapa.set(String(sku), { saldo, preco });
      dados = { nome: o.nome, atualizadoEm: o.atualizadoEm, expiraEm: o.expiraEm, mapa };
    } else {
      dados = null;
    }
    desenhar();
    return expirou;
  }

  /* ---------- interface ---------- */

  function tempoRestante(ms) {
    const min = Math.max(1, Math.floor(ms / 60000));
    if (min >= 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
    return `${min} min`;
  }

  function textoData(ms) {
    const d = new Date(ms);
    return `${fmtData.format(d)} às ${fmtHora.format(d)}`;
  }

  function desenhar() {
    const ativa = Boolean(dados);
    document.body.classList.toggle("com-lista", ativa);
    el.limpar.hidden = !ativa;
    el.botao.querySelector(".btn-lista__rotulo").textContent = ativa ? "Atualizar Lista Diária" : "Carregar Lista Diária";
    if (ativa) {
      const resta = dados.expiraEm - Date.now();
      el.status.className = "lista-status lista-status--ativa" + (resta < 2 * 60 * 60 * 1000 ? " lista-status--acabando" : "");
      el.status.innerHTML =
        `<span class="lista-status__ponto" aria-hidden="true"></span>` +
        `<span>Lista Diária atualizada em <strong>${textoData(dados.atualizadoEm)}</strong>` +
        `<span class="lista-status__resta"> · apaga sozinha em ${tempoRestante(resta)}</span></span>`;
      el.nota.hidden = false;
      el.nota.textContent =
        `Saldo e preço campanha da Lista Diária de ${textoData(dados.atualizadoEm)}. Valores meramente consultivos: ` +
        `para maior exatidão, consulte o Protheus (TOTVS).`;
    } else {
      el.status.className = "lista-status";
      el.status.innerHTML = `<span class="lista-status__ponto" aria-hidden="true"></span><span>Sem Lista Diária carregada</span>`;
      el.nota.hidden = true;
    }
    window.dispatchEvent(new CustomEvent("listadiaria:mudou"));
  }

  let timerMsg = null;
  function mostrarMsg(tipo, html) {
    clearTimeout(timerMsg);
    if (tipo === "ok") timerMsg = setTimeout(() => { el.msg.hidden = true; }, 12000); // confirmação some sozinha
    el.msg.hidden = !html;
    el.msg.className = "lista-msg lista-msg--" + tipo;
    el.msg.innerHTML = html;
  }

  /* ---------- leitura do Excel ---------- */

  function carregarSheetJs() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SHEETJS_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Não conseguimos carregar o leitor de Excel. Verifique a conexão e tente de novo."));
      document.head.appendChild(s);
    });
  }

  const limpar = (t) =>
    String(t ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const ehSaldo = (n) => n === "saldo disponivel" || n.startsWith("saldo disp");
  const ehPreco = (n) => n === "preco campanha" || n.startsWith("preco camp") || n === "preco de campanha";
  const ALIASES_SKU = ["codigo", "cod", "sku", "produto", "cod produto", "codigo produto", "codigo do produto", "cod prod", "item", "b1 cod"];

  /** "1.234,50" / "R$ 12,3" / 12.5 -> número; vazio ou inválido -> null */
  function paraNumero(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let t = String(v).replace(/R\$|\s/g, "");
    if (!t) return null;
    const virgula = t.includes(","), ponto = t.includes(".");
    if (virgula && ponto) t = t.replace(/\./g, "").replace(",", ".");
    else if (virgula) t = t.replace(",", ".");
    else if (ponto && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function normalizarSku(valor) {
    let s = String(valor ?? "").trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ""); // 462.0 vindo de célula numérica
    return /^\d+$/.test(s) && s.length < 6 ? s.padStart(6, "0") : s;
  }

  /** Procura, em cada aba, a linha de cabeçalho que tem "Saldo disponível" e "Preço campanha". */
  function localizarTabela(wb) {
    const vistos = [];
    for (const nomeAba of wb.SheetNames) {
      const linhas = window.XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null, blankrows: false });
      for (let i = 0; i < Math.min(linhas.length, 60); i++) {
        const nomes = linhas[i].map(limpar);
        const iSaldo = nomes.findIndex(ehSaldo);
        const iPreco = nomes.findIndex(ehPreco);
        if (iSaldo !== -1 && iPreco !== -1) return { linhas, cabecalho: nomes, linhaCab: i, iSaldo, iPreco, aba: nomeAba };
        if (iSaldo !== -1 || iPreco !== -1) vistos.push(`${nomeAba}: ${linhas[i].filter(Boolean).join(" | ")}`);
      }
    }
    const erro = new Error(
      'Não encontramos as colunas "Saldo disponível" e "Preço campanha" no arquivo. ' +
        (vistos.length ? `Cabeçalho parecido encontrado: ${vistos[0].slice(0, 160)}` : "Confira se é a Lista Diária correta."),
    );
    throw erro;
  }

  /** Escolhe a coluna do código do produto: pelo nome e, se preciso, pelo que bate com o catálogo. */
  function escolherColunaSku(t, catalogo) {
    const dados = t.linhas.slice(t.linhaCab + 1, t.linhaCab + 1 + 800);
    const nCols = Math.max(t.cabecalho.length, ...dados.map((l) => l.length));
    const taxa = (c) => {
      let tem = 0, ok = 0;
      for (const l of dados) {
        const v = l[c];
        if (v === null || v === undefined || v === "") continue;
        tem++;
        if (catalogo.has(normalizarSku(v))) ok++;
      }
      return tem ? ok / tem : 0;
    };
    const porNome = t.cabecalho.findIndex((n) => ALIASES_SKU.includes(n));
    if (porNome !== -1 && taxa(porNome) >= 0.2) return porNome;
    let melhor = -1, melhorTaxa = 0.2;
    for (let c = 0; c < nCols; c++) {
      if (c === t.iSaldo || c === t.iPreco) continue;
      const x = taxa(c);
      if (x > melhorTaxa) { melhor = c; melhorTaxa = x; }
    }
    if (melhor !== -1) return melhor;
    throw new Error("Não encontramos a coluna com o código do produto (o código precisa ser o mesmo do catálogo, ex.: 000462).");
  }

  async function lerLista(arquivo) {
    const catalogo = new Set((window.CBS_skusCatalogo ? window.CBS_skusCatalogo() : []).map(String));
    if (catalogo.size === 0) throw new Error("O catálogo ainda está carregando. Tente de novo em alguns segundos.");
    await carregarSheetJs();
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
    const t = localizarTabela(wb);
    const iSku = escolherColunaSku(t, catalogo);

    const mapa = new Map();
    let linhasLidas = 0;
    const foraDoCatalogo = new Set();
    for (const l of t.linhas.slice(t.linhaCab + 1)) {
      const bruto = l[iSku];
      if (bruto === null || bruto === undefined || bruto === "") continue;
      const sku = normalizarSku(bruto);
      const saldo = paraNumero(l[t.iSaldo]);
      const preco = paraNumero(l[t.iPreco]);
      if (saldo === null && preco === null) continue;
      linhasLidas++;
      if (!catalogo.has(sku)) { foraDoCatalogo.add(sku); continue; }
      const atual = mapa.get(sku);
      if (!atual) mapa.set(sku, { saldo, preco });
      else {
        // mesmo código em mais de uma linha (ex.: vários armazéns): soma o saldo; preço: o primeiro que existir
        if (saldo !== null) atual.saldo = (atual.saldo ?? 0) + saldo;
        if (!atual.preco && preco) atual.preco = preco;
      }
    }
    if (mapa.size === 0) throw new Error("Nenhum código da Lista Diária existe no catálogo. Confira se é o arquivo certo.");
    return { mapa, linhasLidas, foraDoCatalogo: foraDoCatalogo.size, aba: t.aba };
  }

  async function aoEscolherArquivo(arquivo) {
    if (!arquivo) return;
    el.botao.disabled = true;
    mostrarMsg("info", "Lendo a Lista Diária...");
    try {
      const r = await lerLista(arquivo);
      const agora = Date.now();
      const obj = {
        v: 1,
        nome: arquivo.name,
        atualizadoEm: agora,
        expiraEm: agora + VALIDADE_MS,
        itens: [...r.mapa].map(([sku, v]) => [sku, v.saldo, v.preco]),
      };
      salvarArmazenado(obj);
      sincronizar();
      const fora = r.foraDoCatalogo ? ` ${r.foraDoCatalogo.toLocaleString("pt-BR")} código(s) da lista não estão no catálogo e foram ignorados.` : "";
      mostrarMsg("ok", `Lista Diária carregada: saldo e preço de <strong>${r.mapa.size.toLocaleString("pt-BR")}</strong> produtos.${fora}`);
    } catch (err) {
      console.error(err);
      mostrarMsg("erro", String(err.message || err).replace(/</g, "&lt;"));
    } finally {
      el.botao.disabled = false;
      el.arquivo.value = "";
    }
  }

  /* ---------- eventos ---------- */

  el.botao.addEventListener("click", () => el.arquivo.click());
  el.arquivo.addEventListener("change", () => aoEscolherArquivo(el.arquivo.files[0]));
  el.limpar.addEventListener("click", () => {
    apagarArmazenado();
    sincronizar();
    mostrarMsg("info", "Lista Diária removida deste navegador.");
  });

  // (?) informativo: aparece com mouse/foco; o clique fixa aberto; Esc ou clique fora fecham
  let ajudaFixada = false;
  function ajudaAberta(aberta) {
    el.ajudaTexto.hidden = !aberta;
    el.ajuda.setAttribute("aria-expanded", String(aberta));
    if (!aberta) ajudaFixada = false;
  }
  el.ajuda.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ajudaFixada) ajudaAberta(false);
    else { ajudaAberta(true); ajudaFixada = true; }
  });
  el.ajuda.addEventListener("mouseenter", () => ajudaAberta(true));
  el.ajuda.addEventListener("mouseleave", () => { if (!ajudaFixada && document.activeElement !== el.ajuda) ajudaAberta(false); });
  el.ajuda.addEventListener("focus", () => ajudaAberta(true));
  el.ajuda.addEventListener("blur", () => { if (!ajudaFixada) ajudaAberta(false); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".lista-ajuda-wrap")) ajudaAberta(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ajudaAberta(false); });

  // Validade: confere a cada 30 s, ao voltar para a aba e quando outra aba mexe no armazenamento
  function conferirValidade() {
    if (sincronizar()) mostrarMsg("alerta", "A Lista Diária passou de 24 horas e foi apagada deste navegador. Carregue a de hoje.");
  }
  timer = setInterval(() => { if (dados) conferirValidade(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) conferirValidade(); });
  window.addEventListener("storage", (e) => { if (e.key === CHAVE || e.key === null) sincronizar(); });

  /* ---------- API usada pela tabela de resultados ---------- */
  window.ListaDiaria = {
    ativa: () => Boolean(dados),
    obter: (sku) => (dados ? dados.mapa.get(String(sku)) || null : null),
    formatarSaldo: (n) => (n === null || n === undefined ? null : fmtSaldo.format(n)),
    formatarPreco: (n) => (!n ? null : fmtPreco.format(n)),
    // só para testes
    _validadeMs: VALIDADE_MS,
  };

  // Ao abrir a página: restaura o que ainda está válido e apaga o que passou de 24 h
  if (sincronizar()) mostrarMsg("alerta", "A Lista Diária anterior passou de 24 horas e foi apagada. Carregue a de hoje.");
})();
