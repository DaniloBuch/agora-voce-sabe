/* ==========================================================================
   Lista Diária (saldo e preço campanha) — consulta LOCAL
   - O Excel é lido no próprio navegador (SheetJS, carregado só quando alguém envia um arquivo).
   - Nada é enviado ao banco nem a qualquer servidor.
   - Os valores ficam no localStorage deste navegador por no máximo 24 horas e depois são apagados.
   - Qualquer pessoa pode carregar a lista (não precisa de login).
   - Variação de preço: só os PREÇOS da lista de um dia anterior ficam guardados (até 5 dias, sem
     saldo) para comparar com a lista nova; o × apaga tudo na hora.
   ========================================================================== */
(function () {
  "use strict";

  const CHAVE = "cbs_lista_diaria_v1";
  const VALIDADE_MS = 24 * 60 * 60 * 1000; // 24 horas
  const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
  // Preços da lista anterior (para mostrar a variação). Só preço, nunca saldo, e por no máximo 5 dias
  // (cobre fim de semana e feriado prolongado: a lista de quinta ainda compara com a de terça).
  const CHAVE_ANTERIOR = "cbs_lista_diaria_anterior_v1";
  const ANTERIOR_MS = 5 * 24 * 60 * 60 * 1000;
  // relativo a este arquivo (funciona na busca e na página /cotacao/)
  const SHEETJS_URL = new URL("vendor/xlsx.full.min.js", (document.currentScript && document.currentScript.src) || location.href).href;

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

  let dados = null; // { nome, atualizadoEm, expiraEm, mapa: Map(sku -> {saldo, preco}), variacoes: Map(sku -> preço anterior), comparadaCom }
  let memoriaApenas = null; // se o localStorage não estiver disponível, vale só nesta aba
  let timer = null;

  const fmtSaldo = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
  const fmtPreco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 });
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

  /* ---------- preços da lista anterior (variação) ---------- */

  // Data da lista: a do nome do arquivo ("LISTA DIÁRIA 10-11-2026.xlsx"); sem data no nome, o dia
  // em que foi carregada. É ela que decide qual lista é "anterior" (não a hora do upload).
  const inicioDoDia = (ms) => new Date(ms).setHours(0, 0, 0, 0);
  function dataDoNome(nome) {
    const m = String(nome || "").match(/(?:^|\D)(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{4}|\d{2})(?!\d)/);
    if (!m) return null;
    const dia = +m[1], mes = +m[2], ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(ano, mes - 1, dia);
    return d.getDate() === dia && d.getMonth() === mes - 1 ? d.getTime() : null;
  }
  const dataDe = (o) => (Number.isFinite(o.dataLista) ? o.dataLista : inicioDoDia(o.atualizadoEm));

  function lerAnterior() {
    try {
      const o = JSON.parse(localStorage.getItem(CHAVE_ANTERIOR) || "null");
      if (!o || !Array.isArray(o.precos) || !Number.isFinite(o.atualizadoEm)) return null;
      if (Date.now() > o.atualizadoEm + ANTERIOR_MS || Date.now() < o.atualizadoEm - TOLERANCIA_RELOGIO_MS) {
        localStorage.removeItem(CHAVE_ANTERIOR); // passou de 5 dias: apaga
        return null;
      }
      return o;
    } catch (_) {
      return null;
    }
  }

  // Guarda os preços de uma lista mais antiga que "limite" (data da lista nova); a de data mais recente vence
  function guardarAnterior(lista, limite = Infinity) {
    if (!lista || dataDe(lista) >= limite) return;
    if (Date.now() > lista.atualizadoEm + ANTERIOR_MS) return;
    const atual = lerAnterior();
    if (atual && atual.precos.length && (dataDe(atual) > dataDe(lista) || (dataDe(atual) === dataDe(lista) && atual.atualizadoEm >= lista.atualizadoEm))) return;
    try {
      localStorage.setItem(CHAVE_ANTERIOR, JSON.stringify({
        atualizadoEm: lista.atualizadoEm,
        dataLista: dataDe(lista),
        precos: lista.itens.filter((i) => i[2] > 0).map((i) => [i[0], i[2]]),
      }));
    } catch (_) {
      /* sem armazenamento: fica sem comparação */
    }
  }

  function apagarAnterior() {
    try { localStorage.removeItem(CHAVE_ANTERIOR); } catch (_) { /* nada a apagar */ }
  }

  // [sku, preço anterior] dos produtos cujo preço mudou em relação à lista anterior
  function calcularVariacoes(itens, anterior) {
    if (!anterior) return [];
    const antes = new Map(anterior.precos.map(([sku, p]) => [String(sku), p]));
    const out = [];
    for (const [sku, , preco] of itens) {
      const a = antes.get(String(sku));
      if (a > 0 && preco > 0 && Math.abs(preco - a) >= 0.00005) out.push([sku, a]);
    }
    return out;
  }

  function expirada(o, agora = Date.now()) {
    // também descarta se o relógio do computador voltou para antes do envio
    return agora >= o.expiraEm || agora < o.atualizadoEm - TOLERANCIA_RELOGIO_MS;
  }

  /** Lê o que está salvo, apaga se passou de 24 h e atualiza a tela. Devolve true se houve expiração. */
  // "assinatura" da lista: só avisa a página (que redesenha a tabela) quando ela muda de verdade
  let ultimaAssinatura;
  const assinatura = () => (dados ? `${dados.atualizadoEm}|${dados.expiraEm}|${dados.mapa.size}|${dados.variacoes.size}` : "");

  function sincronizar() {
    const o = lerArmazenado();
    let expirou = false;
    if (o && expirada(o)) {
      guardarAnterior(o); // os preços servem de base para a variação da próxima lista
      apagarArmazenado();
      expirou = true;
      dados = null;
    } else if (o) {
      const mapa = new Map();
      for (const [sku, saldo, preco] of o.itens) mapa.set(String(sku), { saldo, preco });
      const variacoes = new Map((o.variacoes || []).map(([sku, a]) => [String(sku), a]));
      dados = { nome: o.nome, atualizadoEm: o.atualizadoEm, expiraEm: o.expiraEm, dataLista: o.dataLista || null, mapa, variacoes, comparadaCom: o.comparadaCom || null };
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
      // lista de um dia anterior (pelo nome do arquivo ou pelo dia do upload): lembra de carregar a de hoje
      const diaDaLista = new Date(dados.dataLista || dados.atualizadoEm).setHours(0, 0, 0, 0);
      const velha = diaDaLista < new Date().setHours(0, 0, 0, 0);
      el.status.className = "lista-status lista-status--ativa" + (resta < 2 * 60 * 60 * 1000 || velha ? " lista-status--acabando" : "");
      el.status.innerHTML =
        `<span class="lista-status__ponto" aria-hidden="true"></span>` +
        `<span>Lista Diária atualizada em <strong>${textoData(dados.atualizadoEm)}</strong>` +
        `<span class="lista-status__resta"> · apaga sozinha em ${tempoRestante(resta)}</span>` +
        (velha ? `<span class="lista-status__lembrete"> · é a lista de ${fmtData.format(new Date(diaDaLista))}: carregue a de hoje</span>` : "") +
        (dados.comparadaCom
          ? `<span class="lista-status__comp"> · preços comparados com a lista de ${fmtData.format(new Date(dados.comparadaCom))}</span>`
          : `<span class="lista-status__comp"> · sem lista anterior para comparar preços</span>`) +
        `</span>`;
      el.nota.hidden = false;
      el.nota.textContent =
        `Saldo e preço campanha da Lista Diária de ${textoData(dados.atualizadoEm)}. Valores meramente consultivos: ` +
        `para maior exatidão, consulte o Protheus (TOTVS).`;
    } else {
      el.status.className = "lista-status lista-status--lembrete";
      el.status.innerHTML = `<span class="lista-status__ponto" aria-hidden="true"></span><span>Sem Lista Diária: <strong>carregue a de hoje</strong> para ver saldo e preço campanha</span>`;
      el.nota.hidden = true;
    }
    // a conferência de validade (a cada 30 s) só atualiza o texto "apaga sozinha em...";
    // a tabela só é redesenhada quando a lista entra, muda, sai ou vence
    const a = assinatura();
    if (a !== ultimaAssinatura) {
      ultimaAssinatura = a;
      window.dispatchEvent(new CustomEvent("listadiaria:mudou"));
    }
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

  /** "1.234,50" / "R$ 12,3" / 12.5 -> número; vazio ou inválido -> null.
      pontoDecimal = CSV separado por vírgula (padrão americano): "4.798" é 4,798 e não 4798. */
  function paraNumero(v, pontoDecimal = false) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let t = String(v).replace(/R\$|\s|\u00a0/g, "");
    if (!t) return null;
    const virgula = t.includes(","), ponto = t.includes(".");
    if (virgula && ponto) {
      // o último separador é o decimal: "1.234,50" (Brasil) ou "1,234.50" (EUA)
      t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    } else if (virgula) t = t.replace(",", ".");
    else if (ponto && !pontoDecimal && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function normalizarSku(valor) {
    let s = String(valor ?? "").trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ""); // 462.0 vindo de célula numérica
    return /^\d+$/.test(s) && s.length < 6 ? s.padStart(6, "0") : s;
  }

  /* ---------- CSV: lido aqui mesmo, célula por célula como TEXTO ----------
     (o leitor de Excel interpreta "4,7983" no padrão americano e vira 47983) */

  // UTF-8; se não for (CSV salvo pelo Excel no Windows), Windows-1252
  function decodificarTexto(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    } catch (_) {
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  // Separador mais frequente nas primeiras linhas (fora de aspas): ";" (Excel Brasil), "," ou tab
  function detectarSeparador(texto) {
    const amostra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30).join("\n").replace(/"[^"]*"/g, "");
    const contagem = [";", ",", "\t"].map((sep) => [sep, amostra.split(sep).length - 1]);
    contagem.sort((a, b) => b[1] - a[1]);
    return contagem[0][1] > 0 ? contagem[0][0] : ";";
  }

  function lerCsv(texto, sep) {
    const linhas = [];
    let linha = [], campo = "", aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
        } else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        linha.push(campo); campo = "";
        if (linha.some((x) => x.trim() !== "")) linhas.push(linha.map((x) => (x.trim() === "" ? null : x.trim())));
        linha = [];
      } else campo += c;
    }
    linha.push(campo);
    if (linha.some((x) => x.trim() !== "")) linhas.push(linha.map((x) => (x.trim() === "" ? null : x.trim())));
    return linhas;
  }

  const ehCsv = (arquivo) => /\.(csv|txt)$/i.test(arquivo.name) || /csv|text\/plain/i.test(arquivo.type || "");

  // Abas como [nome, linhas]: do Excel (pelo SheetJS) ou do CSV (leitor próprio)
  async function lerAbas(arquivo) {
    const buffer = await arquivo.arrayBuffer();
    if (ehCsv(arquivo)) {
      const texto = decodificarTexto(buffer);
      const sep = detectarSeparador(texto);
      return { abas: [["CSV", lerCsv(texto, sep)]], pontoDecimal: sep === "," };
    }
    await carregarSheetJs();
    const wb = window.XLSX.read(buffer, { type: "array" });
    return {
      abas: wb.SheetNames.map((nome) => [nome, window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false })]),
      pontoDecimal: false,
    };
  }

  /** Procura, em cada aba, a linha de cabeçalho que tem "Saldo disponível" e "Preço campanha". */
  function localizarTabela(abas) {
    const vistos = [];
    for (const [nomeAba, linhas] of abas) {
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
    const leitura = await lerAbas(arquivo);
    const t = localizarTabela(leitura.abas);
    // CSV separado por vírgula: vale o padrão americano ("4.79"), a não ser que os números
    // venham entre aspas no padrão brasileiro ("4,79" / "1.234,5")
    const pontoDecimal =
      leitura.pontoDecimal &&
      !t.linhas.slice(t.linhaCab + 1).some((l) => [l[t.iSaldo], l[t.iPreco]].some((v) => typeof v === "string" && /^[^.]*\d,\d{1,4}$|\d\.\d{3},\d/.test(v.replace(/R\$|\s/g, ""))));
    const iSku = escolherColunaSku(t, catalogo);

    const mapa = new Map();
    let linhasLidas = 0;
    const foraDoCatalogo = new Set();
    for (const l of t.linhas.slice(t.linhaCab + 1)) {
      const bruto = l[iSku];
      if (bruto === null || bruto === undefined || bruto === "") continue;
      const sku = normalizarSku(bruto);
      const saldo = paraNumero(l[t.iSaldo], pontoDecimal);
      const preco = paraNumero(l[t.iPreco], pontoDecimal);
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
      // a lista que está saindo vira base de comparação (se for de uma data anterior à da nova)
      const dataLista = dataDoNome(arquivo.name) ?? inicioDoDia(agora);
      guardarAnterior(lerArmazenado(), dataLista);
      let anterior = lerAnterior();
      if (anterior && dataDe(anterior) >= dataLista) anterior = null; // só compara com lista de data anterior
      const itens = [...r.mapa].map(([sku, v]) => [sku, v.saldo, v.preco]);
      const variacoes = calcularVariacoes(itens, anterior);
      const obj = {
        v: 1,
        nome: arquivo.name,
        atualizadoEm: agora,
        expiraEm: agora + VALIDADE_MS,
        dataLista,
        itens,
        variacoes,
        comparadaCom: anterior ? dataDe(anterior) : null,
      };
      salvarArmazenado(obj);
      sincronizar();
      const fora = r.foraDoCatalogo ? ` ${r.foraDoCatalogo.toLocaleString("pt-BR")} código(s) da lista não estão no catálogo e foram ignorados.` : "";
      const mudou = anterior
        ? ` <strong>${variacoes.length.toLocaleString("pt-BR")}</strong> preço(s) mudaram desde a lista de ${fmtData.format(new Date(dataDe(anterior)))}.`
        : " Sem lista de data anterior neste navegador para comparar os preços: a variação aparece quando você carregar uma lista mais nova que esta.";
      mostrarMsg("ok", `Lista Diária carregada: saldo e preço de <strong>${r.mapa.size.toLocaleString("pt-BR")}</strong> produtos.${mudou}${fora}`);
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
    apagarAnterior(); // o × apaga tudo, inclusive os preços guardados para comparar
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
    // { anterior, atual, dif, pct } se o preço mudou desde a lista anterior; senão null
    variacao(sku) {
      if (!dados) return null;
      const anterior = dados.variacoes.get(String(sku));
      const v = dados.mapa.get(String(sku));
      if (anterior === undefined || !v || !v.preco) return null;
      return { anterior, atual: v.preco, dif: v.preco - anterior, pct: ((v.preco - anterior) / anterior) * 100 };
    },
    // todas as mudanças (para o painel de novidades) e a data da lista usada na comparação
    variacoes: () => (dados ? [...dados.variacoes.keys()].map((sku) => ({ sku, ...window.ListaDiaria.variacao(sku) })) : []),
    comparadaCom: () => (dados ? dados.comparadaCom : null),
    // só para testes
    _validadeMs: VALIDADE_MS,
  };

  // Ao abrir a página: restaura o que ainda está válido e apaga o que passou de 24 h
  if (sincronizar()) mostrarMsg("alerta", "A Lista Diária anterior passou de 24 horas e foi apagada. Carregue a de hoje.");
})();
