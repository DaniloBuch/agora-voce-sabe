let database = [];
let carregado = false;
let erroCarga = false;
let timeoutBusca = null;
let timeoutFade = null;
let vocabulario = null; // palavras da base, para sugerir correções de digitação
let categoriaAtual = ""; // categoria escolhida na gaveta ("" = todas)
let areaAtual = ""; // área de atuação escolhida na gaveta ("" = todas)
let areasLista = []; // [{nome, icone, n}] só as que têm produtos, na ordem do painel
const iconesArea = new Map(); // nome da área -> chave do ícone
let categoriasLista = []; // [[nome, quantidade]], da mais usada para a menos usada
// Aberto pelo botão "Abrir o app" (protocolo web+agoravocesabe:): o endereço vem em ?abrir=...
(function abertoPeloAtalho() {
  const abrir = new URLSearchParams(location.search).get("abrir");
  if (abrir === null) return;
  let resto = abrir.replace(/^web\+agoravocesabe:\/*/i, "");
  try { resto = decodeURIComponent(resto); } catch (_) {}
  try { history.replaceState(null, "", resto ? `?${resto.replace(/^\?/, "")}` : location.pathname); } catch (_) {}
})();
const parametrosIniciais = new URLSearchParams(location.search);
let categoriaDoLink = parametrosIniciais.get("cat") || "";
let areaDoLink = parametrosIniciais.get("area") || "";
let paginaDoLink = Math.max(1, parseInt(parametrosIniciais.get("p"), 10) || 1);
// Ordenação escolhida clicando no título da coluna (null = relevância, a ordem da busca). Link: ?ord=preco.asc
let ordemColuna = (() => {
  const m = String(parametrosIniciais.get("ord") || "").match(/^(sku|descricao|saldo|preco|ref)\.(asc|desc)$/);
  return m ? { col: m[1], dir: m[2] === "asc" ? 1 : -1 } : null;
})();
let modoExplorar = parametrosIniciais.get("ver") === "todos"; // catálogo completo, em ordem alfabética
let paginaAtual = 1;
let estadoLista = null; // resultado completo da última busca (trocar de página não refaz a busca)
let indiceSinonimos = new Map(); // palavra -> palavras equivalentes (dicionário do painel)
let frasesSinonimo = []; // sinônimos com mais de uma palavra ("soro fisiologico"), da maior para a menor
const cacheParecidas = new Map();

const input = document.getElementById("searchInput");
const heroCards = document.getElementById("heroCards");
const resultsContainer = document.getElementById("resultsContainer");
const resultsInfo = document.getElementById("resultsInfo");
const tbody = document.getElementById("tableBody");
const btnLink = document.getElementById("btnLink");
const paginacao = document.getElementById("paginacao");
const caixaCategorias = document.getElementById("categorias");
const listaCategorias = document.getElementById("categoriasLista");
const filtroCategoria = document.getElementById("filtroCategoria");
const categoriasVazio = document.getElementById("categoriasVazio");
const botaoCategorias = document.getElementById("categoriasToggle");
const gavetaFundo = document.getElementById("gavetaFundo");
const botaoFecharGaveta = document.getElementById("gavetaFechar");
const filtroAtivo = document.getElementById("filtroAtivo");
const filtroAtivoNome = document.getElementById("filtroAtivoNome");
const historicoCaixa = document.getElementById("historico");
const historicoLista = document.getElementById("historicoLista");
const PLACEHOLDER_PADRAO = input.placeholder;

// URL do seu JSON
const DATA_URL = "./db.json";
const ITENS_POR_PAGINA = 50;
const MAX_PARECIDOS = 50; // resultados "parecidos" (possível erro de digitação) mostrados depois dos exatos
const MAX_LINHAS_APELIDOS_PC = 1; // "Também conhecido por": 1 linha no computador
const MAX_LINHAS_APELIDOS_CELULAR = 2; // e até 2 no celular; o resto fica no "+N" (clique mostra todos)
const fmtNum = new Intl.NumberFormat("pt-BR");
const ordemAlfabetica = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/* ---------- Utilitários ---------- */

// Minúsculas e sem acentos: "Esfigmomanômetro" -> "esfigmomanometro"
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// Igual ao normalizar, mas com os espaços repetidos reduzidos a um só
function normalizarEspacos(texto) {
  return normalizar(texto).replace(/\s+/g, " ").trim();
}

// Referência: se for só número, mostra o valor sem zeros à esquerda
// ("000000000038833014" -> "38833014"); se tiver letras, mantém o texto ("AR420").
function formatarRef(ref) {
  const texto = String(ref ?? "").trim();
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, "") : texto;
}

// Evita que <, >, & ou aspas nos dados quebrem (ou injetem) HTML
function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ehLetraOuNumero = (c) => c !== undefined && /[a-z0-9]/.test(c);

/* ---------- Alternativas de um termo ----------
   Cada termo da busca vira um grupo de "alternativas"; o produto precisa casar com
   pelo menos uma alternativa de cada grupo. Modos:
     trecho  -> aparece em qualquer lugar (o que a pessoa digitou: "sond" acha "sonda")
     palavra -> palavra inteira (sinônimos curtos: "cx" não acha "cxa")
     inicio  -> começo de palavra (sinônimos longos: "caixa" acha "caixas")          */

function alternativa(texto, modo = "trecho") {
  const alt = { texto, modo };
  if (modo !== "trecho") {
    alt.re = new RegExp(`(^|[^a-z0-9])${escaparRegex(texto)}${modo === "palavra" ? "(?![a-z0-9])" : ""}`);
  }
  return alt;
}

function casaAlternativa(textoNormalizado, alt) {
  return alt.modo === "trecho" ? textoNormalizado.includes(alt.texto) : alt.re.test(textoNormalizado);
}

// Escapa o texto e destaca os termos buscados (ignorando acentos/maiúsculas e espaços repetidos).
// "deslocamento" = quantos caracteres do começo NÃO são exibidos (os zeros à esquerda
// da Ref.): a busca é feita no texto completo, mas só a parte visível é mostrada.
function destacar(texto, termos, deslocamento = 0) {
  const original = String(texto ?? "");
  if (!original) return "";

  // Mapeia cada caractere normalizado de volta ao índice no texto original
  let norm = "";
  const mapa = [];
  for (let i = 0; i < original.length; i++) {
    let n = normalizar(original[i]);
    if (/\s/.test(n)) {
      if (norm.endsWith(" ")) continue; // espaços repetidos contam como um só
      n = " ";
    }
    for (let k = 0; k < n.length; k++) mapa.push(i);
    norm += n;
  }

  const faixas = [];
  for (const termo of termos) {
    const alt = typeof termo === "string" ? { texto: termo, modo: "trecho" } : termo;
    const t = alt.texto;
    if (!t) continue;
    let pos = norm.indexOf(t);
    while (pos !== -1) {
      const inicioOk = alt.modo === "trecho" || !ehLetraOuNumero(norm[pos - 1]);
      const fimOk = alt.modo !== "palavra" || !ehLetraOuNumero(norm[pos + t.length]);
      if (inicioOk && fimOk) faixas.push([mapa[pos], mapa[pos + t.length - 1] + 1]);
      pos = norm.indexOf(t, pos + 1);
    }
  }
  if (faixas.length === 0) return escaparHtml(original.slice(deslocamento));

  // Une faixas sobrepostas
  faixas.sort((a, b) => a[0] - b[0]);
  const unidas = [faixas[0]];
  for (const [ini, fim] of faixas.slice(1)) {
    const ultima = unidas[unidas.length - 1];
    if (ini <= ultima[1]) ultima[1] = Math.max(ultima[1], fim);
    else unidas.push([ini, fim]);
  }

  let html = "";
  let cursor = deslocamento;
  for (const [iniBruto, fim] of unidas) {
    const ini = Math.max(iniBruto, deslocamento); // corta o que ficou nos zeros ocultos
    if (fim <= ini) continue;
    html += escaparHtml(original.slice(cursor, ini));
    html += `<mark>${escaparHtml(original.slice(ini, fim))}</mark>`;
    cursor = fim;
  }
  return html + escaparHtml(original.slice(cursor));
}

/* ---------- Carga dos dados ---------- */

/* Cópia da base guardada neste aparelho (IndexedDB), para o app funcionar sem internet.
   Guarda só o que já é público (a mesma lista que o site lê do Supabase). */
const BaseOffline = (() => {
  const NOME = "cbs_agora_voce_sabe", LOJA = "dados";
  function abrir() {
    return new Promise((resolver, rejeitar) => {
      if (!window.indexedDB) return rejeitar(new Error("sem IndexedDB"));
      const pedido = indexedDB.open(NOME, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
  }
  async function salvar(chave, valor) {
    try {
      const db = await abrir();
      await new Promise((resolver, rejeitar) => {
        const tx = db.transaction(LOJA, "readwrite");
        tx.objectStore(LOJA).put(valor, chave);
        tx.oncomplete = resolver;
        tx.onerror = () => rejeitar(tx.error);
      });
      db.close();
    } catch (_) {} // sem espaço ou navegação privada: só não fica disponível offline
  }
  async function ler(chave) {
    try {
      const db = await abrir();
      const valor = await new Promise((resolver, rejeitar) => {
        const pedido = db.transaction(LOJA, "readonly").objectStore(LOJA).get(chave);
        pedido.onsuccess = () => resolver(pedido.result || null);
        pedido.onerror = () => rejeitar(pedido.error);
      });
      db.close();
      return valor;
    } catch (_) {
      return null;
    }
  }
  return { salvar, ler };
})();

async function lerDb() {
  // 1) Banco (Supabase), se configurado; 2) cópia guardada neste aparelho; 3) db.json como plano B.
  if (window.CBS_API && CBS_API.configurado) {
    try {
      const dados = await CBS_API.listarProdutos();
      BaseOffline.salvar("produtos", { em: Date.now(), dados }); // sem esperar: não atrasa a busca
      return { dados, contingencia: false };
    } catch (erro) {
      const salvo = await BaseOffline.ler("produtos");
      if (salvo && Array.isArray(salvo.dados) && salvo.dados.length) {
        console.warn("Sem conexão com o banco; usando a base guardada neste aparelho:", erro);
        return { dados: salvo.dados, contingencia: "offline", salvoEm: salvo.em };
      }
      console.warn("Supabase indisponível, usando db.json:", erro);
      const dados = await lerDbJson();
      return { dados, contingencia: true };
    }
  }
  return { dados: await lerDbJson(), contingencia: false };
}

async function lerDbJson() {
  const resposta = await fetch(DATA_URL);
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status} ao carregar ${DATA_URL}`);
  }
  const dadosBrutos = await resposta.json();
  if (!Array.isArray(dadosBrutos)) {
    throw new Error("Formato inesperado: o JSON deveria ser uma lista.");
  }
  return dadosBrutos;
}

// Dicionário de sinônimos (aba "Sinônimos" do painel). Sem ele (banco antigo ou fora do ar), a busca segue normal.
async function lerSinonimos() {
  if (!window.CBS_API || !CBS_API.configurado || !CBS_API.listarSinonimos) return [];
  try {
    const grupos = await CBS_API.listarSinonimos();
    BaseOffline.salvar("sinonimos", grupos);
    return grupos;
  } catch (_) {
    return (await BaseOffline.ler("sinonimos")) || []; // offline: os sinônimos da última vez
  }
}

// Áreas de atuação cadastradas no painel (nome + ícone). Offline: as da última vez.
async function lerAreas() {
  if (!window.CBS_API || !CBS_API.configurado || !CBS_API.listarAreas) return [];
  try {
    const areas = await CBS_API.listarAreas();
    if (areas.length) BaseOffline.salvar("areas", areas);
    return areas;
  } catch (_) {
    return (await BaseOffline.ler("areas")) || [];
  }
}

const temFiltro = () => Boolean(categoriaAtual || areaAtual);
// "Luvas · Hospitais" (para mensagens e nome do arquivo)
const rotuloFiltro = () => [categoriaAtual, areaAtual].filter(Boolean).join(" · ");

function montarSinonimos(grupos) {
  indiceSinonimos = new Map();
  for (const g of grupos || []) {
    const palavras = [...new Set((g.palavras || []).map(normalizarEspacos).filter(Boolean))];
    if (palavras.length < 2) continue;
    for (const p of palavras) {
      const equivalentes = indiceSinonimos.get(p) || new Set();
      palavras.forEach((outra) => outra !== p && equivalentes.add(outra));
      indiceSinonimos.set(p, equivalentes);
    }
  }
  frasesSinonimo = [...indiceSinonimos.keys()].filter((p) => p.includes(" ")).sort((a, b) => b.length - a.length);
}

async function carregarDados() {
  const infoNumero = document.getElementById("infoBaseNumero");
  const infoTexto = document.getElementById("infoBaseTexto");
  try {
    const [{ dados: dadosBrutos, contingencia, salvoEm }, grupos, areasCadastradas] = await Promise.all([lerDb(), lerSinonimos(), lerAreas()]);
    montarSinonimos(grupos);

    database = dadosBrutos
      .filter((item) => String(item.sku ?? "").trim() !== "")
      .map((item) => {
        let tagsArray = [];
        if (typeof item.tags === "string") {
          tagsArray = item.tags.split(",");
        } else if (Array.isArray(item.tags)) {
          tagsArray = item.tags;
        }
        tagsArray = tagsArray.map((t) => String(t).trim()).filter(Boolean);

        const sku = String(item.sku ?? "");
        const descricao = item.descricao_tecnica || item.descricao || "";
        const referenciaOriginal = String(item.referencia ?? "").trim();
        const referencia = formatarRef(referenciaOriginal);

        return {
          sku,
          descricao,
          referencia,
          referenciaOriginal,
          categoria: String(item.categoria ?? "").trim() || "-", // "-" = sem categoria
          areas: Array.isArray(item.areas) ? item.areas.map((a) => String(a).trim()).filter(Boolean) : [],
          criadoEm: item.criado_em ? Date.parse(item.criado_em) : null,
          tags: tagsArray,
          _sku: normalizar(sku),
          _desc: normalizarEspacos(descricao),
          _ref: normalizar(referencia),
          _refOriginal: normalizar(referenciaOriginal), // a busca aceita as duas formas
          _tags: tagsArray.map(normalizarEspacos),
          _buscaFull: normalizarEspacos(
            [sku, descricao, referencia, referenciaOriginal, tagsArray.join(" ")].join(" "),
          ),
        };
      });
    // posição de cada produto em ordem alfabética (navegar pelo catálogo / por categoria)
    [...database]
      .sort((a, b) => ordemAlfabetica.compare(a.descricao, b.descricao) || ordemAlfabetica.compare(a.sku, b.sku))
      .forEach((item, i) => (item._alfa = i));
    vocabulario = null;
    cacheParecidas.clear();
    carregado = true;
    console.log("Sistema CBS Online. Itens:", database.length);
    montarAreas(areasCadastradas);
    montarCategorias();

    // Atualiza o painel com o número real
    contarAte(infoNumero, database.length);
    montarDestaques();
    infoTexto.textContent =
      contingencia === "offline"
        ? `produtos (sem internet: usando a base guardada neste aparelho em ${new Date(salvoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}).`
        : contingencia
          ? "produtos do arquivo local (modo contingência: pode estar desatualizado)."
          : "produtos carregados";
    infoTexto.classList.toggle("is-erro", contingencia === true);
    infoTexto.classList.toggle("is-alerta", contingencia === "offline");
    heroCards.classList.add("is-carregado");

    // Se o usuário já digitou algo (ou abriu um link com categoria/catálogo) enquanto carregava, busca agora
    const termo = input.value.trim();
    if (termo || temFiltro() || modoExplorar) {
      if (!termo && !temFiltro()) modoExplorar = true;
      mostrarBusca();
      executarBusca(termo, paginaDoLink);
      atualizarEndereco();
    } else {
      mostrarHome(); // link com categoria que não existe mais: volta para o início
    }
    paginaDoLink = 1;
  } catch (erro) {
    console.error("Erro Fatal:", erro);
    erroCarga = true;
    esconderCategorias();
    infoNumero.textContent = "";
    infoTexto.textContent = "Não conseguimos carregar a base de produtos. Tente novamente em instantes.";
    infoTexto.classList.add("is-erro");
    document.getElementById("btnExplorar").hidden = true;
    if (input.value.trim()) executarBusca(input.value.trim());
  }
}

carregarDados().then(() => carregado && verificarLinksSite());

// A Lista Diária (lista-diaria.js) precisa saber quais códigos existem no catálogo
window.CBS_skusCatalogo = () => database.map((item) => item.sku);

// Quando a Lista Diária é carregada, atualizada, removida ou expira, redesenha a página atual
window.addEventListener("listadiaria:mudou", () => {
  if (carregado && estadoLista && resultsContainer.style.display === "block") renderizarPagina();
});

/* ---------- Estado visual (Home <-> Busca) ---------- */

function mostrarHome() {
  clearTimeout(timeoutFade);
  modoExplorar = false;
  estadoLista = null;
  paginacao.hidden = true;
  resultsContainer.style.display = "none";
  heroCards.style.display = "";
  // pequeno atraso para a transição de opacidade acontecer
  timeoutFade = setTimeout(() => (heroCards.style.opacity = "1"), 10);
}

function mostrarBusca() {
  clearTimeout(timeoutFade);
  heroCards.style.opacity = "0";
  timeoutFade = setTimeout(() => (heroCards.style.display = "none"), 300);
  resultsContainer.style.display = "block";
}

input.addEventListener("input", function (e) {
  const termo = e.target.value.trim();

  clearTimeout(timeoutBusca);
  cancelarRegistroHistorico();
  if (termo) {
    modoExplorar = false; // digitou: volta para a busca normal
    fecharHistorico();
  }

  if (termo === "" && !temFiltro()) {
    mostrarHome();
    atualizarEndereco();
    abrirHistorico(); // campo limpo: mostra as buscas recentes (como no Google)
    return;
  }
  mostrarBusca();

  // Debounce
  timeoutBusca = setTimeout(() => {
    executarBusca(termo);
    atualizarEndereco();
    agendarRegistroHistorico();
  }, 300);
});

/* ---------- X vermelho: limpar a busca ---------- */

const botaoLimparBusca = document.getElementById("limparBusca");
function atualizarBotaoLimpar() {
  botaoLimparBusca.hidden = input.value === "";
}
input.addEventListener("input", atualizarBotaoLimpar);
botaoLimparBusca.addEventListener("mousedown", (e) => e.preventDefault()); // o campo não perde o foco
botaoLimparBusca.addEventListener("click", () => {
  input.value = "";
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true })); // volta ao início (ou à categoria) e mostra as buscas recentes
});

/* ---------- Interpretação da busca ---------- */

// Separa o texto digitado em: termos soltos, trechos exatos ("entre aspas") e excluídos (-palavra ou -"trecho").
// Palavras de ligação ("cabo PARA bisturi", "aparelho DE pressão"): a busca ignora quando há
// outras palavras, porque o cliente às vezes fala com e às vezes sem. Entre aspas continuam valendo.
// "com"/"sem" e "c/" não entram: mudam o produto (luva com/sem pó, C/100).
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "para", "pra", "p/", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "ao"]);

let animarProximaTabela = true;

function interpretarConsulta(texto) {
  let resto = ` ${normalizar(texto).replace(/[“”„″«»]/g, '"').replace(/\s+/g, " ")} `;
  const exatos = [];
  const excluidos = [];

  // trechos entre aspas; a aspa final pode faltar enquanto a pessoa ainda digita
  resto = resto.replace(/(?:(\s)-)?"([^"]*)("|$)/g, (_, menos, frase) => {
    const f = frase.replace(/\s+/g, " ").trim();
    if (f) (menos !== undefined ? excluidos : exatos).push(f);
    return " ";
  });

  // sinônimos de mais de uma palavra ("soro fisiologico") ficam juntos, como um termo só
  const termos = [];
  for (const frase of frasesSinonimo) {
    const marca = ` ${frase} `;
    while (resto.includes(marca)) {
      termos.push(frase);
      resto = resto.replace(marca, " ");
    }
  }

  for (const t of resto.split(" ")) {
    if (!t) continue;
    if (t.startsWith("-")) {
      if (t.length > 1) excluidos.push(t.slice(1)); // "-" sozinho é ignorado
      continue;
    }
    termos.push(t);
  }
  // tira as palavras de ligação, desde que sobre alguma outra para buscar
  const fortes = termos.filter((t) => !CONECTIVOS.has(t));
  const ignorados = fortes.length && fortes.length < termos.length ? termos.filter((t) => CONECTIVOS.has(t)) : [];
  return { termos: ignorados.length ? fortes : termos, exatos, excluidos, ignorados };
}

// Termo que pode ter erro de digitação: só letras, 4+ caracteres
const podeTerErro = (t) => t.length >= 4 && /^[a-z]+$/.test(t);

function montarGrupos(consulta) {
  const grupos = consulta.termos.map((t) => {
    const alternativas = [alternativa(t)];
    for (const s of indiceSinonimos.get(t) || []) {
      alternativas.push(alternativa(s, s.length <= 4 ? "palavra" : "inicio"));
    }
    return { termo: t, alternativas, tolerante: podeTerErro(t) };
  });
  for (const f of consulta.exatos) grupos.push({ termo: f, alternativas: [alternativa(f)], tolerante: false });
  return grupos;
}

const casaGrupo = (item, g) => g.alternativas.some((alt) => casaAlternativa(item._buscaFull, alt));

/* ---------- Relevância ---------- */

// Quanto maior a pontuação, mais relevante o resultado
function pontuarTermo(item, t) {
  let pontos = 0;
  if (item._sku === t) pontos += 100;
  else if (item._sku.startsWith(t)) pontos += 60;
  else if (item._sku.includes(t)) pontos += 5;

  if (item._ref === t || item._refOriginal === t) pontos += 80;
  else if (item._ref.includes(t) || item._refOriginal.includes(t)) pontos += 15;

  if (item._tags.some((tag) => tag === t)) pontos += 50;
  else if (item._tags.some((tag) => tag.includes(t))) pontos += 30;

  if (new RegExp(`(^|[^a-z0-9])${escaparRegex(t)}`).test(item._desc)) {
    pontos += 20; // começo de palavra na descrição
  } else if (item._desc.includes(t)) {
    pontos += 10;
  }
  return pontos;
}

// Cada grupo vale a melhor das suas alternativas (o termo digitado ou um sinônimo)
function pontuar(item, grupos) {
  let pontos = 0;
  for (const g of grupos) {
    let melhor = 0;
    for (const alt of g.alternativas) {
      if (casaAlternativa(item._buscaFull, alt)) melhor = Math.max(melhor, pontuarTermo(item, alt.texto));
    }
    pontos += melhor;
  }
  return pontos;
}

// Mais relevante primeiro; empate mantém a ordem original da base
function ordenar(lista, grupos) {
  return lista
    .map((item, indice) => ({ item, indice, pontos: pontuar(item, grupos) }))
    .sort((a, b) => b.pontos - a.pontos || a.indice - b.indice)
    .map((r) => r.item);
}

/* ---------- Tolerância a erro de digitação ---------- */

// Distância de edição (inclui troca de letras vizinhas: "sodna" -> "sonda" = 1).
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, atual[j - 1] + 1, prev[j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      atual[j] = v;
      if (v < minimo) minimo = v;
    }
    if (minimo > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = atual;
  }
  return prev[b.length];
}

function obterVocabulario() {
  if (vocabulario) return vocabulario;
  const contagem = new Map();
  for (const item of database) {
    const texto = `${item._desc} ${item._tags.join(" ")}`;
    for (const palavra of texto.split(/[^a-z0-9]+/)) {
      if (palavra.length >= 3 && /[a-z]/.test(palavra) && !/\d/.test(palavra)) {
        contagem.set(palavra, (contagem.get(palavra) || 0) + 1);
      }
    }
  }
  vocabulario = [...contagem.entries()];
  return vocabulario;
}

// Palavras da base parecidas com o termo digitado (as mais próximas e mais usadas primeiro).
// estrito = usado com resultados exatos na tela: só 1 erro até 8 letras, 2 a partir de 9.
function sugerirPalavras(termo, { estrito = false, limite = 3 } = {}) {
  if (!podeTerErro(termo) || (estrito && termo.length < 5)) return [];
  const chave = `${estrito ? 1 : 0}:${limite}:${termo}`;
  if (cacheParecidas.has(chave)) return cacheParecidas.get(chave);
  const max = estrito ? (termo.length <= 8 ? 1 : 2) : termo.length <= 5 ? 1 : 2;
  const achadas = [];
  for (const [palavra, usos] of obterVocabulario()) {
    if (estrito && palavra.includes(termo)) continue; // essa já aparece nos resultados exatos
    let d = distancia(termo, palavra, max);
    // quem digita só o começo da palavra ("esfigmmo"): compara com o início dela
    if (d > max && termo.length >= 5 && palavra.length > termo.length) {
      d = distancia(termo, palavra.slice(0, termo.length), max);
    }
    if (d <= max) achadas.push({ palavra, d, usos });
  }
  achadas.sort((a, b) => a.d - b.d || b.usos - a.usos);
  const resultado = achadas.slice(0, limite).map((x) => x.palavra);
  cacheParecidas.set(chave, resultado);
  return resultado;
}

/* ---------- Execução da busca ---------- */

function mensagemNaTabela(classe, html) {
  btnExportar.hidden = true;
  tbody.innerHTML = `<tr><td colspan="${numColunas()}" class="${classe}">${html}</td></tr>`;
  resultsInfo.innerText = "";
  paginacao.hidden = true;
}

function executarBusca(termoOriginal, pagina = 1) {
  if (erroCarga) {
    estadoLista = null;
    mensagemNaTabela("msg-erro", "Não conseguimos carregar a base de produtos. Tente novamente em instantes.");
    return;
  }
  if (!carregado) {
    estadoLista = null;
    mensagemNaTabela("msg-vazio", "Carregando a base de produtos...");
    return;
  }

  const consulta = interpretarConsulta(termoOriginal);
  const grupos = montarGrupos(consulta);

  // com categoria escolhida, a busca acontece só dentro dela; "-palavra" tira produtos da base
  let base = categoriaAtual ? database.filter((item) => item.categoria === categoriaAtual) : database;
  if (areaAtual) base = base.filter((item) => item.areas.includes(areaAtual));
  if (consulta.excluidos.length) {
    base = base.filter((item) => !consulta.excluidos.some((e) => item._buscaFull.includes(e)));
  }

  const estado = {
    original: termoOriginal.trim(),
    consulta,
    itens: [],
    nExatos: 0,
    destaque: grupos.flatMap((g) => g.alternativas),
    destaqueParecidos: [],
    correcao: null,
    modo: "busca",
  };

  if (grupos.length === 0) {
    // sem termos: navega pela categoria (ou pelo catálogo inteiro) em ordem alfabética
    estado.modo = temFiltro() ? "categoria" : modoExplorar && !consulta.excluidos.length ? "explorar" : "navegar";
    estado.itens = [...base].sort((a, b) => a._alfa - b._alfa);
    estado.nExatos = estado.itens.length;
  } else {
    const exatos = ordenar(base.filter((item) => grupos.every((g) => casaGrupo(item, g))), grupos);
    estado.itens = exatos;
    estado.nExatos = exatos.length;

    if (exatos.length === 0) {
      // Nada encontrado: tenta corrigir erros de digitação nos termos que não existem na base
      const corrigidos = grupos.map((g) => {
        if (base.some((item) => casaGrupo(item, g))) return g;
        if (!g.tolerante) return null;
        const sugestoes = sugerirPalavras(g.termo);
        return sugestoes.length ? { ...g, alternativas: sugestoes.map((s) => alternativa(s)), sugestoes } : null;
      });
      if (corrigidos.every(Boolean) && corrigidos.some((g) => g.sugestoes)) {
        const filtrados = base.filter((item) => corrigidos.every((g) => casaGrupo(item, g)));
        if (filtrados.length > 0) {
          const principais = corrigidos.map((g) => ({ ...g, alternativas: [g.alternativas[0]] }));
          estado.itens = ordenar(filtrados, principais);
          estado.nExatos = estado.itens.length;
          estado.destaque = corrigidos.flatMap((g) => g.alternativas);
          estado.correcao = { original: estado.original, sugeridos: principais.map((g) => g.alternativas[0].texto) };
        }
      }
    } else if (exatos.length < ITENS_POR_PAGINA) {
      // Poucos resultados exatos: acrescenta, depois deles, os produtos com palavras PARECIDAS
      // (o termo pode ter sido digitado errado). Ficam numa seção separada e com menos relevância.
      const extras = grupos.map((g) => (g.tolerante ? sugerirPalavras(g.termo, { estrito: true, limite: 5 }) : []));
      if (extras.some((e) => e.length)) {
        const ampliados = grupos.map((g, i) =>
          extras[i].length ? { ...g, alternativas: g.alternativas.concat(extras[i].map((p) => alternativa(p))) } : g,
        );
        const jaListados = new Set(exatos);
        const parecidos = ordenar(
          base.filter((item) => !jaListados.has(item) && ampliados.every((g) => casaGrupo(item, g))),
          ampliados,
        ).slice(0, MAX_PARECIDOS);
        if (parecidos.length) {
          estado.itens = exatos.concat(parecidos);
          estado.destaqueParecidos = extras.flat().map((p) => alternativa(p));
        }
      }
    }
  }

  estadoLista = estado;
  paginaAtual = pagina;
  animarProximaTabela = true;
  renderizarPagina();
}

// 4 colunas normais; 6 quando há Lista Diária (Saldo e Preço campanha)
function numColunas() {
  return window.ListaDiaria && window.ListaDiaria.ativa() ? 7 : 5; // cotação, SKU, descrição (+ saldo e preço), Ref., Site
}

/* ---------- Link para o site oficial (cbsmed.com.br) ---------- */

const URL_SITE_PRODUTO = "https://cbsmed.com.br/produto/";
// Endereços exatos sincronizados com o site (tabela links_site). Para gastar pouco tráfego, a busca
// só pede os códigos da página que está na tela, e guarda o que já pediu.
let linksSincronizados = false; // true quando a tabela existe e tem dados
const cacheLinks = new Map(); // sku -> { caminho, ficha, imagem } | null (não está no site)
const linksPedidos = new Set();

// Descrição técnica -> endereço do produto, do mesmo jeito que o WordPress monta:
// sem acento (ç -> c), minúsculas, "/" e "." viram traço, o resto que não é letra,
// número, espaço, "_" ou "-" sai (vírgula, %, +, parênteses...), espaços viram traço.
//   "FILME TRANSP TEGADERM CHG 8,5X11,5 C/CLOREX 2% 3M 1657R(25)"
//   -> "filme-transp-tegaderm-chg-85x115-c-clorex-2-3m-1657r25"
function slugProduto(descricao) {
  return String(descricao ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\/.\u2013\u2014]/g, "-")
    .replace(/\u00d7/g, "x")
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Endereço do produto no site. Com a sincronização, usa o endereço exato (resolve o "-2" do WordPress);
// produto que não estava no site na última sincronização vai para a busca do site, que abre direto
// o produto quando o nome bate. Sem sincronização (ou enquanto carrega), monta pela descrição.
function linkDoProduto(item) {
  const info = linksSincronizados ? cacheLinks.get(item.sku) : undefined;
  if (info) {
    const url = info.caminho.startsWith("http") ? info.caminho : `${URL_SITE_PRODUTO}${info.caminho}/`;
    return { url, exato: true, ficha: info.ficha || "", imagem: info.imagem || "", sincronizado: true };
  }
  if (info === null) {
    return { url: `https://cbsmed.com.br/?s=${encodeURIComponent(item.descricao.replace(/\s+/g, " ").trim())}&post_type=product`, exato: false, ficha: "", imagem: "" };
  }
  return { url: `${URL_SITE_PRODUTO}${slugProduto(item.descricao)}/`, exato: true, ficha: "", imagem: "" };
}

const ICONE_SITE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';

const ICONE_FICHA =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 18v-6"></path><path d="m9 15 3 3 3-3"></path></svg>';

// Ícone de foto: o produto tem imagem cadastrada no site (passar o mouse mostra a miniatura)
const ICONE_FOTO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';

// Botão do site:
//   com foto -> ícone de foto, em roxo; passar o mouse mostra a miniatura
//   qualquer outro caso (sem foto, fora do site, ainda sem sincronizar) -> ícone de link, em cinza,
//   para o roxo significar sempre "tem foto no site"
function htmlSite(item) {
  const { url, exato, ficha, imagem, sincronizado } = linkDoProduto(item);
  const semFoto = sincronizado && !imagem;
  const dica = !exato
    ? "Procurar no site oficial"
    : imagem
      ? "Ver no site: foto e ficha técnica"
      : semFoto
        ? "Ver no site (ainda sem foto cadastrada)"
        : "Ver no site: imagem e ficha técnica";
  const nome = escaparHtml(item.descricao);
  const classe = imagem ? " tem-imagem" : " sem-imagem";
  const site =
    `<a class="link-site${classe}" href="${escaparHtml(url)}" target="_blank" rel="noopener" data-dica="${dica}"` +
    `${imagem ? ` data-imagem="${escaparHtml(imagem)}"` : ""} aria-label="${dica}: ${nome} (abre em nova aba)">${imagem ? ICONE_FOTO : ICONE_SITE}</a>`;
  const pdf = ficha
    ? `<a class="link-site link-ficha" href="${escaparHtml(ficha)}" target="_blank" rel="noopener" download data-dica="Baixar ficha técnica (PDF)" aria-label="Baixar ficha técnica (PDF): ${nome}">${ICONE_FICHA}</a>`
    : `<span class="link-vazio" aria-hidden="true"></span>`;
  return site + pdf;
}

function celulaSite(item) {
  return `<td class="col-site" data-sku-site="${escaparHtml(item.sku)}">${htmlSite(item)}</td>`;
}

// Pede ao banco os links dos códigos da página atual que ainda não foram pedidos e atualiza só essas células
async function carregarLinksDaPagina(itens) {
  if (!linksSincronizados || !CBS_API.linksSitePorSkus) return;
  const faltam = itens.map((i) => i.sku).filter((sku) => !linksPedidos.has(sku));
  if (!faltam.length) return;
  faltam.forEach((sku) => linksPedidos.add(sku));
  try {
    const linhas = await CBS_API.linksSitePorSkus(faltam);
    const achados = new Map(linhas.map((l) => [l.sku, l]));
    faltam.forEach((sku) => cacheLinks.set(sku, achados.get(sku) || null));
  } catch (_) {
    faltam.forEach((sku) => linksPedidos.delete(sku)); // tenta de novo na próxima página
    return;
  }
  const porSku = new Map(itens.map((i) => [i.sku, i]));
  tbody.querySelectorAll("td.col-site[data-sku-site]").forEach((td) => {
    const item = porSku.get(td.dataset.skuSite);
    if (item && faltam.includes(item.sku)) td.innerHTML = htmlSite(item);
  });
}

// Uma consulta leve na abertura: a sincronização com o site já foi feita? (sem ela vale o slugProduto)
async function verificarLinksSite() {
  if (!window.CBS_API || !CBS_API.configurado || !CBS_API.resumoLinksSite) return;
  try {
    linksSincronizados = (await CBS_API.resumoLinksSite()).total > 0;
    if (linksSincronizados && estadoLista && resultsContainer.style.display === "block") renderizarPagina();
  } catch (_) {
    linksSincronizados = false; // migração 009/010 ainda não rodou: link pela descrição
  }
}

/* Miniatura da foto ao passar o mouse no ícone do site (carrega só a imagem que a pessoa pediu) */
const previaSite = document.createElement("div");
previaSite.className = "previa-site";
previaSite.hidden = true;
previaSite.setAttribute("aria-hidden", "true");
document.body.appendChild(previaSite);
function mostrarPrevia(link) {
  const src = link.dataset.imagem;
  if (!src) return;
  previaSite.innerHTML = `<img src="${escaparHtml(src)}" alt="" width="180" height="180" /><span>Ver no site: imagem e ficha técnica</span>`;
  previaSite.querySelector("img").addEventListener("error", esconderPrevia, { once: true });
  previaSite.hidden = false;
  const r = link.getBoundingClientRect();
  const largura = previaSite.offsetWidth, altura = previaSite.offsetHeight;
  let top = r.top + r.height / 2 - altura / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - altura - 8));
  previaSite.style.top = `${top + window.scrollY}px`;
  previaSite.style.left = `${Math.max(8, r.left - largura - 10) + window.scrollX}px`;
}
function esconderPrevia() {
  previaSite.hidden = true;
  previaSite.innerHTML = "";
}
tbody.addEventListener("mouseover", (e) => {
  const link = e.target.closest("a.link-site.tem-imagem");
  if (link && !link.contains(e.relatedTarget)) mostrarPrevia(link);
});
tbody.addEventListener("mouseout", (e) => {
  const link = e.target.closest("a.link-site.tem-imagem");
  if (link && !link.contains(e.relatedTarget)) esconderPrevia();
});
tbody.addEventListener("focusin", (e) => {
  const link = e.target.closest("a.link-site.tem-imagem");
  if (link && link.matches(":focus-visible")) mostrarPrevia(link);
});
tbody.addEventListener("focusout", esconderPrevia);
window.addEventListener("scroll", esconderPrevia, { passive: true });

// Células de saldo e preço vindas da Lista Diária (consulta local, nunca vão ao banco)
// Variação do preço campanha desde a lista anterior: "▼ 10,0% · −R$ 0,10" (verde caiu, vermelho subiu)
const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function textoDifReais(dif) {
  const abs = Math.abs(dif);
  const casas = abs >= 0.01 ? 2 : 4;
  return `${dif < 0 ? "−" : "+"}R$ ${abs.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}
function htmlVariacao(sku) {
  const v = window.ListaDiaria && window.ListaDiaria.variacao ? window.ListaDiaria.variacao(sku) : null;
  if (!v) return "";
  const caiu = v.dif < 0;
  const quando = window.ListaDiaria.comparadaCom() ? new Date(window.ListaDiaria.comparadaCom()).toLocaleDateString("pt-BR") : "";
  const pct = `${caiu ? "−" : "+"}${fmtPct.format(Math.abs(v.pct))}%`;
  // na tela só a seta e o %; o resto aparece ao passar o mouse (e é lido pelo leitor de tela)
  const detalhe = `${caiu ? "Caiu" : "Subiu"} ${pct} (${textoDifReais(v.dif)}). Antes: ${window.ListaDiaria.formatarPreco(v.anterior)}${quando ? `, na lista de ${quando}` : ""}`;
  return (
    `<span class="preco-var preco-var--${caiu ? "baixa" : "alta"}" title="${escaparHtml(detalhe)}">` +
    `<span aria-hidden="true">${caiu ? "▼" : "▲"} ${pct}</span><span class="sr-only">${escaparHtml(detalhe)}</span></span>`
  );
}

function celulasLista(sku) {
  if (!window.ListaDiaria || !window.ListaDiaria.ativa()) return { colunas: "", resumoMobile: "" };
  const v = window.ListaDiaria.obter(sku);
  const saldo = v ? window.ListaDiaria.formatarSaldo(v.saldo) : null;
  const preco = v ? window.ListaDiaria.formatarPreco(v.preco) : null;
  const zero = v && v.saldo === 0;
  const saldoHtml = saldo === null ? `<span class="lista-nd" title="Não consta na Lista Diária">—</span>` : `<span class="${zero ? "saldo-zero" : "saldo-ok"}">${saldo}</span>`;
  // valor unitário clicável: copia só o número (ex.: 4,7983), igual ao SKU
  const valorCopia = v && v.preco ? v.preco.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "";
  const precoHtml = preco === null
    ? `<span class="lista-nd" title="Sem preço campanha na Lista Diária">—</span>`
    : `<button type="button" class="preco-camp preco-copiar" data-valor="${valorCopia}" title="Clique para copiar o valor unitário" aria-label="Copiar valor unitário ${valorCopia}">${preco}</button>`;
  const varHtml = htmlVariacao(sku);
  return {
    colunas: `<td class="col-lista col-saldo">${saldoHtml}</td><td class="col-lista col-preco">${precoHtml}${varHtml}</td>`,
    // no celular as colunas somem e o resumo aparece sob a descrição
    resumoMobile: `<span class="desc-extra">Saldo: ${saldoHtml} · Preço camp.: ${precoHtml}${varHtml}</span>`,
  };
}

function linhaProduto(item, termos) {
  // "Também conhecido por": as tags ficam visíveis sob a descrição, para ensinar os outros nomes do
  // produto (apelidos comerciais, marcas, termos técnicos). As que casaram com a busca vêm primeiro.
  let apelidosHtml = "";
  if (item.tags.length) {
    const casou = (tag) => termos.some((alt) => casaAlternativa(normalizarEspacos(tag), alt));
    const ordenadas = [...item.tags.filter(casou), ...item.tags.filter((tag) => !casou(tag))];
    const pills = ordenadas
      .map((tag) => `<span class="tag-pill${casou(tag) ? " tag-pill--casou" : ""}">${destacar(tag, termos)}</span>`)
      .join("");
    apelidosHtml =
      `<div class="apelidos"><span class="apelidos__rotulo">Também conhecido por</span>${pills}` +
      `<button type="button" class="apelidos__mais" aria-expanded="false" hidden></button></div>`;
  }

  const lista = celulasLista(item.sku);
  return `
        <tr>
          ${celulaCotacao(item)}
          <td class="col-sku"><button type="button" class="sku-copiar" data-sku="${escaparHtml(item.sku)}" title="Clique para copiar o código" aria-label="Copiar código ${escaparHtml(item.sku)}">${destacar(item.sku, termos)}</button></td>
          <td class="col-desc"><span class="desc-texto">${destacar(item.descricao, termos)}</span>${htmlAreasDoItem(item)}${apelidosHtml}${lista.resumoMobile}</td>
          ${lista.colunas}
          <td class="col-ref">${destacar(item.referenciaOriginal, termos, item.referenciaOriginal.length - item.referencia.length)}</td>
          ${celulaSite(item)}
        </tr>
      `;
}

// Texto "Mostrando 51–100 de 312" (só quando há mais de uma página)
function faixaDaPagina(total, inicio, fim) {
  return total > ITENS_POR_PAGINA ? ` Mostrando <strong>${fmtNum.format(inicio + 1)}–${fmtNum.format(fim)}</strong>.` : "";
}

function textoExcluidos(consulta) {
  if (!consulta.excluidos.length) return "";
  return ` Sem: ${consulta.excluidos.map((e) => `<strong>${escaparHtml(e)}</strong>`).join(", ")}.`;
}

/* ---------- Ordenar pela coluna (clique no título) ---------- */

const ROTULO_ORDEM = { sku: "SKU", descricao: "Descrição", saldo: "Saldo", preco: "Preço camp.", ref: "Ref." };
const ordemTexto = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const colunaDaLista = (col) => col === "saldo" || col === "preco";

function valorParaOrdem(item, col) {
  if (col === "sku") return item.sku;
  if (col === "descricao") return item.descricao;
  if (col === "ref") return item.referenciaOriginal;
  const v = window.ListaDiaria && window.ListaDiaria.ativa() ? window.ListaDiaria.obter(item.sku) : null;
  if (!v) return null;
  const n = col === "saldo" ? v.saldo : v.preco;
  return n === null || n === undefined || (col === "preco" && !n) ? null : n;
}

// Ordena os exatos e os "parecidos" separadamente (os parecidos continuam no fim, com o aviso).
// Quem não tem valor (sem saldo/preço, sem referência) vai sempre para o fim.
function itensNaOrdem(estado) {
  if (!ordemColuna) return estado.itens;
  const { col, dir } = ordemColuna;
  const chave = `${col}.${dir}.${window.ListaDiaria && window.ListaDiaria.ativa() ? "L" : ""}`;
  if (estado._ordem === chave) return estado._ordenados;
  const cmp = (a, b) => {
    const va = valorParaOrdem(a, col), vb = valorParaOrdem(b, col);
    const vazioA = va === null || va === "", vazioB = vb === null || vb === "";
    if (vazioA || vazioB) return vazioA === vazioB ? a._alfa - b._alfa : vazioA ? 1 : -1;
    const r = typeof va === "number" ? va - vb : ordemTexto.compare(va, vb);
    return r * dir || a._alfa - b._alfa;
  };
  const exatos = estado.itens.slice(0, estado.nExatos).sort(cmp);
  const parecidos = estado.itens.slice(estado.nExatos).sort(cmp);
  estado._ordem = chave;
  estado._ordenados = exatos.concat(parecidos);
  return estado._ordenados;
}

function desenharCabecalhoOrdem() {
  document.querySelectorAll("th[data-ordem-col]").forEach((th) => {
    const ativo = ordemColuna && ordemColuna.col === th.dataset.ordemCol;
    th.setAttribute("aria-sort", ativo ? (ordemColuna.dir === 1 ? "ascending" : "descending") : "none");
    const b = th.querySelector("button");
    b.classList.toggle("is-ativo", Boolean(ativo));
    b.querySelector(".ordenar__seta").textContent = ativo ? (ordemColuna.dir === 1 ? "↑" : "↓") : "↕";
    const rot = ROTULO_ORDEM[th.dataset.ordemCol];
    b.setAttribute("aria-label", ativo
      ? `Ordenado por ${rot} (${ordemColuna.dir === 1 ? "crescente" : "decrescente"}). Clique para ${ordemColuna.dir === 1 ? "inverter" : "voltar à relevância"}`
      : `Ordenar por ${rot}`);
  });
}

function textoOrdem() {
  if (!ordemColuna) return "";
  const { col, dir } = ordemColuna;
  const sentido = col === "saldo" || col === "preco" ? (dir === 1 ? "menor primeiro" : "maior primeiro") : dir === 1 ? "A→Z" : "Z→A";
  return ` <span class="ordem-info">Ordenado por <strong>${ROTULO_ORDEM[col]}</strong> (${sentido}). <button type="button" class="btn-link" data-ordem-limpar>Voltar à relevância</button></span>`;
}

// 1º clique: crescente; 2º: decrescente; 3º: volta à relevância (a ordem da busca)
function clicarOrdem(col) {
  if (!ordemColuna || ordemColuna.col !== col) ordemColuna = { col, dir: 1 };
  else if (ordemColuna.dir === 1) ordemColuna = { col, dir: -1 };
  else ordemColuna = null;
  paginaAtual = 1;
  animarProximaTabela = true;
  renderizarPagina();
  atualizarEndereco();
  const b = document.querySelector(`th[data-ordem-col="${col}"] button`);
  if (b) b.focus();
}

resultsInfo.addEventListener("click", (e) => {
  if (!e.target.closest("[data-ordem-limpar]")) return;
  ordemColuna = null;
  paginaAtual = 1;
  renderizarPagina();
  atualizarEndereco();
});

document.querySelector("thead").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ordem]");
  if (b && estadoLista) clicarOrdem(b.dataset.ordem);
});

function renderizarPagina() {
  const estado = estadoLista;
  if (!estado) return;
  // sem Lista Diária não há como ordenar por saldo/preço: volta à relevância
  if (ordemColuna && colunaDaLista(ordemColuna.col) && !(window.ListaDiaria && window.ListaDiaria.ativa())) ordemColuna = null;
  desenharCabecalhoOrdem();
  const itens = itensNaOrdem(estado);
  const total = itens.length;
  const emCategoria = temFiltro() ? ` em <strong>${escaparHtml(rotuloFiltro())}</strong>` : "";

  if (total === 0) {
    let msg;
    if (temFiltro()) {
      msg = `Não encontramos nenhum produto em <strong>${escaparHtml(rotuloFiltro())}</strong> com esse termo. <button type="button" class="btn-link" data-limpar-categoria>${areaAtual && !categoriaAtual ? "Buscar em todas as áreas" : areaAtual ? "Tirar os filtros" : "Buscar em todas as categorias"}</button>`;
    } else if (estado.consulta.exatos.length || estado.consulta.excluidos.length) {
      msg = "Não encontramos nenhum produto com esse termo. Confira o trecho entre aspas e as palavras com hífen (-), que tiram produtos da lista.";
    } else {
      msg = "Não encontramos nenhum produto com esse termo. Tente o código, o nome técnico ou um apelido.";
    }
    mensagemNaTabela("msg-erro", msg);
    return;
  }

  const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
  paginaAtual = Math.min(Math.max(1, paginaAtual), totalPaginas);
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const fim = Math.min(inicio + ITENS_POR_PAGINA, total);
  const nParecidos = total - estado.nExatos;
  const faixa = faixaDaPagina(total, inicio, fim);
  const excl = textoExcluidos(estado.consulta);
  let classeInfo = "results-info";

  if (estado.correcao) {
    resultsInfo.innerHTML =
      `Nenhum resultado exato para <strong>${escaparHtml(estado.correcao.original)}</strong>. ` +
      `Mostrando ${fmtNum.format(total)} resultado(s)${emCategoria} para ` +
      `<strong>${escaparHtml(estado.correcao.sugeridos.join(" "))}</strong>.${faixa}`;
    classeInfo += " results-info--alerta";
  } else if (estado.modo === "explorar") {
    resultsInfo.innerHTML = `<strong>Catálogo completo:</strong> ${fmtNum.format(total)} produtos em ordem alfabética.${faixa}`;
  } else if (estado.modo === "categoria" || estado.modo === "navegar") {
    resultsInfo.innerHTML = `<strong>${fmtNum.format(total)}</strong> produtos${emCategoria}, em ordem alfabética.${excl}${faixa}` +
      (estado.modo === "categoria" && total > ITENS_POR_PAGINA ? " Digite no campo de busca para refinar." : "");
  } else {
    const parecidos = nParecidos ? ` + <strong>${fmtNum.format(nParecidos)}</strong> parecido(s)` : "";
    resultsInfo.innerHTML = `<strong>${fmtNum.format(estado.nExatos)}</strong> resultado(s) encontrado(s)${emCategoria}${parecidos}.${excl}${faixa}`;
  }
  resultsInfo.insertAdjacentHTML("beforeend", textoOrdem());
  resultsInfo.className = classeInfo;

  const destaqueParecidos = estado.destaque.concat(estado.destaqueParecidos);
  let html = "";
  for (let i = inicio; i < fim; i++) {
    if (i >= estado.nExatos && (i === estado.nExatos || i === inicio)) {
      html += `<tr class="linha-divisoria"><td colspan="${numColunas()}">` +
        `<strong>Parecidos com a sua busca${i > estado.nExatos ? " (continuação)" : ""}</strong>` +
        `<span> · palavras com grafia próxima, caso algo tenha sido digitado diferente</span></td></tr>`;
    }
    html += linhaProduto(itens[i], i >= estado.nExatos ? destaqueParecidos : estado.destaque);
  }
  tbody.innerHTML = html;
  // linhas entram em cascata só numa busca, página ou ordem nova (redesenhos internos não piscam)
  tbody.classList.remove("entrando");
  if (animarProximaTabela) {
    void tbody.offsetWidth;
    tbody.classList.add("entrando");
    animarProximaTabela = false;
  }
  btnExportar.hidden = false;
  ajustarTags();
  carregarLinksDaPagina(estado.itens.slice(inicio, fim));
  renderizarPaginacao(totalPaginas);
}

/* ---------- Tags em uma linha (computador) ---------- */

// Mostra quantos nomes couberem (1 linha no computador, 2 no celular), sem cortar palavra.
// Se sobrar algum, aparece "+N"; o clique abre todos ali mesmo (e "mostrar menos" fecha).
const mqCelular = window.matchMedia("(max-width: 768px)");
// Linhas ocupadas: itens com o topo a menos de 8px um do outro estão na mesma linha
// (o rótulo e as tags têm alturas diferentes e ficam centralizados)
function contarLinhas(el) {
  // no celular o rótulo "Também conhecido por" fica numa linha própria, que não conta
  const topos = [...el.children]
    .filter((f) => !f.hidden && !(mqCelular.matches && f.classList.contains("apelidos__rotulo")))
    .map((f) => f.offsetTop)
    .sort((a, b) => a - b);
  let linhas = 0, ultimo = -Infinity;
  for (const t of topos) {
    if (t - ultimo > 8) { linhas++; ultimo = t; }
  }
  return linhas;
}
function ajustarApelidos(linha) {
  const pills = [...linha.querySelectorAll(":scope > .tag-pill")];
  const mais = linha.querySelector(":scope > .apelidos__mais");
  if (linha.classList.contains("is-aberto")) {
    pills.forEach((p) => (p.hidden = false));
    mais.hidden = false;
    mais.textContent = "mostrar menos";
    mais.setAttribute("aria-label", "Mostrar menos nomes");
    return;
  }
  const maxLinhas = mqCelular.matches ? MAX_LINHAS_APELIDOS_CELULAR : MAX_LINHAS_APELIDOS_PC;
  let n = pills.length;
  const aplicar = () => {
    pills.forEach((p, i) => (p.hidden = i >= n));
    const ocultos = pills.length - n;
    mais.hidden = ocultos === 0;
    mais.textContent = `+${ocultos} ${ocultos === 1 ? "nome" : "nomes"}`;
    mais.setAttribute("aria-label", `Ver mais ${ocultos} nome(s) deste produto`);
  };
  aplicar();
  while (n > 1 && contarLinhas(linha) > maxLinhas) {
    n--;
    aplicar();
  }
}
function ajustarTags() {
  tbody.querySelectorAll(".apelidos").forEach(ajustarApelidos);
}
tbody.addEventListener("click", (e) => {
  const mais = e.target.closest(".apelidos__mais");
  if (!mais) return;
  const linha = mais.closest(".apelidos");
  const abrir = !linha.classList.contains("is-aberto");
  linha.classList.toggle("is-aberto", abrir);
  mais.setAttribute("aria-expanded", String(abrir));
  ajustarApelidos(linha);
});
let timeoutAjusteTags = null;
window.addEventListener("resize", () => {
  clearTimeout(timeoutAjusteTags);
  timeoutAjusteTags = setTimeout(ajustarTags, 120);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarTags);

/* ---------- Paginação ---------- */

// Números visíveis: 1 … 4 5 6 … 20
function paginasVisiveis(atual, total) {
  const set = new Set([1, total, atual - 1, atual, atual + 1]);
  if (atual <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (atual >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => set.add(n));
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const saida = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) saida.push(null);
    saida.push(n);
  });
  return saida;
}

function renderizarPaginacao(totalPaginas) {
  if (totalPaginas <= 1) {
    paginacao.hidden = true;
    paginacao.innerHTML = "";
    return;
  }
  const botao = (rotulo, pagina, extra = "") =>
    `<button type="button" class="pag-btn${extra}" data-pagina="${pagina}"${pagina === paginaAtual && !extra ? ' aria-current="page"' : ""}` +
    `${extra && (pagina < 1 || pagina > totalPaginas) ? " disabled" : ""}>${rotulo}</button>`;
  paginacao.innerHTML =
    botao(`<span aria-hidden="true">‹</span> Anterior`, paginaAtual - 1, " pag-btn--seta") +
    `<span class="pag-numeros">` +
    paginasVisiveis(paginaAtual, totalPaginas)
      .map((n) => (n === null ? `<span class="pag-reticencias" aria-hidden="true">…</span>` : botao(String(n), n)))
      .join("") +
    `</span>` +
    `<span class="pag-resumo">Página ${paginaAtual} de ${totalPaginas}</span>` +
    botao(`Próxima <span aria-hidden="true">›</span>`, paginaAtual + 1, " pag-btn--seta");
  paginacao.hidden = false;
}

function irParaPagina(pagina) {
  if (!estadoLista) return;
  paginaAtual = pagina;
  animarProximaTabela = true;
  renderizarPagina();
  atualizarEndereco();
  // volta ao topo da lista (logo abaixo do cabeçalho fixo)
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topo-h")) || 77;
  const y = resultsContainer.getBoundingClientRect().top + window.scrollY - topo - 16;
  const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, y), behavior: suave ? "smooth" : "auto" });
}

paginacao.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pagina]");
  if (!btn || btn.disabled) return;
  irParaPagina(Number(btn.dataset.pagina));
});

/* ---------- Explorar o catálogo completo ---------- */

function abrirCatalogo() {
  clearTimeout(timeoutBusca);
  fecharHistorico();
  input.value = "";
  atualizarBotaoLimpar();
  categoriaAtual = "";
  areaAtual = "";
  modoExplorar = true;
  renderizarAreas();
  renderizarCategorias();
  mostrarBusca();
  executarBusca("");
  atualizarEndereco();
}

document.getElementById("btnExplorar").addEventListener("click", () => {
  if (!carregado && !erroCarga) {
    // ainda carregando: abre já com o aviso e completa quando a base chegar
    modoExplorar = true;
    input.value = "";
    mostrarBusca();
    executarBusca("");
    return;
  }
  abrirCatalogo();
});

/* ---------- Lista de cotação (cotacao-store.js + página /cotacao/) ---------- */

const ICONE_ADD_COTACAO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';
const ICONE_NA_COTACAO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
const cotacao = window.CBSCotacao;

function htmlBotaoCotacao(item, marcado) {
  const acao = marcado ? "Tirar da cotação" : "Adicionar à cotação (e copiar o código)";
  return `<button type="button" class="cot-btn${marcado ? " is-marcado" : ""}" data-cot="${escaparHtml(item.sku)}" aria-pressed="${marcado}" ` +
    `title="${acao}" aria-label="${acao}: ${escaparHtml(item.sku)} ${escaparHtml(item.descricao)}">${marcado ? ICONE_NA_COTACAO : ICONE_ADD_COTACAO}</button>`;
}
function celulaCotacao(item) {
  return `<td class="col-cot">${cotacao ? htmlBotaoCotacao(item, cotacao.tem(item.sku)) : ""}</td>`;
}

const contadorCotacao = document.getElementById("contadorCotacao");
const avisoCotacao = document.getElementById("avisoCotacao");
let timeoutAvisoCotacao = null;
let ultimoContadorCotacao = null;
function animar(el, classe = "pulou") {
  if (!el) return;
  el.classList.remove(classe);
  void el.offsetWidth; // reinicia a animação
  el.classList.add(classe);
  el.addEventListener("animationend", () => el.classList.remove(classe), { once: true });
}
function atualizarContadorCotacao() {
  const n = cotacao ? cotacao.quantidade() : 0;
  if (ultimoContadorCotacao !== null && n > ultimoContadorCotacao) requestAnimationFrame(() => animar(contadorCotacao));
  ultimoContadorCotacao = n;
  contadorCotacao.textContent = String(n);
  contadorCotacao.hidden = n === 0;
  document.getElementById("linkCotacao").setAttribute("aria-label", n ? `Ver a cotação (${n} ${n === 1 ? "item" : "itens"})` : "Ver a cotação (vazia)");
}
function mostrarAvisoCotacao(texto) {
  avisoCotacao.innerHTML = `<span>${texto}</span><a href="cotacao/">Ver cotação</a>`;
  avisoCotacao.hidden = false;
  clearTimeout(timeoutAvisoCotacao);
  timeoutAvisoCotacao = setTimeout(() => (avisoCotacao.hidden = true), 3500);
}
// redesenha só os botões da cotação (ex.: a cotação mudou em outra aba ou foi limpa)
function sincronizarBotoesCotacao() {
  tbody.querySelectorAll("button.cot-btn").forEach((btn) => {
    const item = database.find((i) => i.sku === btn.dataset.cot);
    if (item) btn.outerHTML = htmlBotaoCotacao(item, cotacao.tem(item.sku));
  });
  atualizarContadorCotacao();
}
if (cotacao) {
  cotacao.aoMudar(sincronizarBotoesCotacao);
  atualizarContadorCotacao();
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button.cot-btn");
    if (!btn) return;
    const sku = btn.dataset.cot;
    const item = database.find((i) => i.sku === sku);
    if (!item) return;
    if (cotacao.tem(sku)) {
      cotacao.remover(sku);
      mostrarAvisoCotacao(`<strong>${escaparHtml(sku)}</strong> saiu da cotação.`);
    } else {
      // o preço campanha da Lista Diária (se carregada) entra como sugestão de valor unitário
      const v = window.ListaDiaria && window.ListaDiaria.ativa() ? window.ListaDiaria.obter(sku) : null;
      const copia = copiarTexto(sku); // adicionar também copia o código (para colar no Protheus, e-mail...)
      cotacao.adicionar({ sku, descricao: item.descricao, referencia: item.referencia, preco: v ? v.preco : null });
      registrarBuscaAtual();
      const n = cotacao.quantidade();
      const copiou = await copia;
      mostrarAvisoCotacao(`<strong>${escaparHtml(sku)}</strong> adicionado à cotação${copiou ? " e código copiado" : ""} (${n} ${n === 1 ? "item" : "itens"}).`);
    }
    const novo = tbody.querySelector(`button.cot-btn[data-cot="${CSS.escape(sku)}"]`);
    if (novo) {
      novo.focus();
      if (cotacao.tem(sku)) animar(novo);
    }
  });
}

/* ---------- Exportar o resultado da busca para Excel ---------- */

const btnExportar = document.getElementById("btnExportar");

function carregarLeitorExcel() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const s = document.createElement("script");
    s.src = "vendor/xlsx.full.min.js";
    s.onload = () => resolver();
    s.onerror = () => rejeitar(new Error("Não conseguimos carregar o gerador de Excel. Verifique a conexão."));
    document.head.appendChild(s);
  });
}

function nomeArquivoExportacao() {
  const partes = [input.value.trim(), categoriaAtual, areaAtual, estadoLista && estadoLista.modo === "explorar" ? "catalogo-completo" : ""]
    .filter(Boolean)
    .join(" ");
  const base = slugProduto(partes).slice(0, 50) || "busca";
  const d = new Date();
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `agora-voce-sabe_${base}_${data}.xlsx`;
}

async function exportarParaExcel() {
  if (!estadoLista || !estadoLista.itens.length) return;
  const rotulo = btnExportar.lastChild;
  const textoOriginal = rotulo.textContent;
  btnExportar.disabled = true;
  rotulo.textContent = "Gerando...";
  try {
    await carregarLeitorExcel();
    const comLista = window.ListaDiaria && window.ListaDiaria.ativa();
    const temParecidos = estadoLista.itens.length > estadoLista.nExatos;
    const cab = ["SKU", "Descrição", "Referência", "Categoria", "Áreas de atuação", "Também conhecido por"];
    if (comLista) cab.push("Saldo (Lista Diária)", "Preço campanha (Lista Diária)");
    cab.push("Página no site");
    if (temParecidos) cab.push("Observação");
    const linhas = itensNaOrdem(estadoLista).map((item, i) => {
      const l = [item.sku, item.descricao, item.referencia, item.categoria === "-" ? "" : item.categoria, item.areas.join(", "), item.tags.join(", ")];
      if (comLista) {
        const v = window.ListaDiaria.obter(item.sku);
        l.push(v && v.saldo !== null && v.saldo !== undefined ? v.saldo : "", v && v.preco ? v.preco : "");
      }
      l.push(linkDoProduto(item).url);
      if (temParecidos) l.push(i >= estadoLista.nExatos ? "Parecido com a busca" : "");
      return l;
    });
    const ws = window.XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    // SKU e Referência como texto (o Excel não pode comer os zeros à esquerda); preço com 4 casas
    const ref = window.XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 1; r <= ref.e.r; r++) {
      for (const c of [0, 2]) {
        const cel = ws[window.XLSX.utils.encode_cell({ r, c })];
        if (cel) { cel.t = "s"; cel.v = String(cel.v); cel.z = "@"; }
      }
      if (comLista) {
        const saldo = ws[window.XLSX.utils.encode_cell({ r, c: cab.indexOf("Saldo (Lista Diária)") })];
        if (saldo && saldo.t === "n") saldo.z = "#,##0.##";
        const preco = ws[window.XLSX.utils.encode_cell({ r, c: cab.indexOf("Preço campanha (Lista Diária)") })];
        if (preco && preco.t === "n") preco.z = '"R$" #,##0.0000';
      }
    }
    ws["!cols"] = cab.map((c) => ({ wch: { SKU: 9, "Descrição": 62, "Referência": 20, Categoria: 24, "Áreas de atuação": 28, "Também conhecido por": 40, "Página no site": 60 }[c] || 18 }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    window.XLSX.writeFile(wb, nomeArquivoExportacao());
    registrarBuscaAtual();
  } catch (erro) {
    console.error(erro);
    rotulo.textContent = "Não deu para exportar";
    setTimeout(() => (rotulo.textContent = textoOriginal), 2500);
    return;
  } finally {
    btnExportar.disabled = false;
  }
  rotulo.textContent = textoOriginal;
}
btnExportar.addEventListener("click", exportarParaExcel);

/* ---------- Copiar SKU e link da busca ---------- */

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (_) {
    // plano B para navegadores/ambientes sem a API de área de transferência
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.setAttribute("readonly", "");
    campo.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(campo);
    campo.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {}
    campo.remove();
    return ok;
  }
}

function sinalizarCopiado(el, textoOriginal) {
  el.classList.add("copiado");
  if (textoOriginal) el.textContent = "Link copiado!";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove("copiado");
    if (textoOriginal) el.textContent = textoOriginal;
  }, 1500);
}

tbody.addEventListener("click", async (e) => {
  if (e.target.closest("[data-limpar-categoria]")) {
    areaAtual = "";
    renderizarAreas();
    escolherCategoria("");
    return;
  }
  const btn = e.target.closest("button.sku-copiar");
  if (btn && (await copiarTexto(btn.dataset.sku))) {
    sinalizarCopiado(btn);
    registrarBuscaAtual(); // copiou um código: a busca foi útil, entra no histórico
    return;
  }
  const preco = e.target.closest("button.preco-copiar");
  if (preco && (await copiarTexto(preco.dataset.valor))) {
    sinalizarCopiado(preco);
    registrarBuscaAtual();
  }
});

// Endereço da busca atual: ?cat=...&q=...&p=2 (ou ?ver=todos para o catálogo completo)
function parametrosDaBusca() {
  const params = new URLSearchParams();
  if (categoriaAtual) params.set("cat", categoriaAtual);
  if (areaAtual) params.set("area", areaAtual);
  const termo = input.value.trim();
  if (termo) params.set("q", termo);
  if (modoExplorar && !termo && !temFiltro()) params.set("ver", "todos");
  if (ordemColuna && params.toString()) params.set("ord", `${ordemColuna.col}.${ordemColuna.dir === 1 ? "asc" : "desc"}`);
  if (estadoLista && paginaAtual > 1 && params.toString()) params.set("p", String(paginaAtual));
  return params.toString();
}

function linkDaBusca() {
  const params = parametrosDaBusca();
  return params ? `${location.origin}${location.pathname}?${params}` : "";
}

btnLink.addEventListener("click", async () => {
  const link = linkDaBusca();
  if (link && (await copiarTexto(link))) {
    sinalizarCopiado(btnLink, "Copiar link desta busca");
    registrarBuscaAtual();
  }
});

// Mantém o endereço da página igual à busca (dá para compartilhar ou recarregar)
function atualizarEndereco() {
  const params = parametrosDaBusca();
  btnLink.hidden = params === "";
  try {
    history.replaceState(null, "", params ? `?${params}` : location.pathname);
  } catch (_) {}
}

/* ---------- Histórico de buscas (só neste navegador) ---------- */

const CHAVE_HISTORICO = "cbs_historico_busca_v1";
const MAX_HISTORICO = 8;
const ESPERA_HISTORICO_MS = 2500; // parou de digitar por 2,5 s com resultados: conta como busca feita
const JANELA_DIGITACAO_MS = 2 * 60 * 1000;
let timeoutHistorico = null;
let historicoAtivo = -1; // item destacado com as setas

function obterHistorico() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_HISTORICO));
    return Array.isArray(lista) ? lista.filter((h) => h && typeof h.q === "string" && h.q.trim()) : [];
  } catch (_) {
    return [];
  }
}

function gravarHistorico(lista) {
  try {
    if (lista.length) localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(lista));
    else localStorage.removeItem(CHAVE_HISTORICO);
  } catch (_) {}
}

function salvarNoHistorico(termo, categoria = "") {
  const q = String(termo ?? "").replace(/\s+/g, " ").trim();
  if (!q) return;
  const chave = normalizar(q);
  const agora = Date.now();
  const lista = obterHistorico().filter((h) => {
    if ((h.cat || "") !== categoria) return true;
    const hq = normalizar(h.q);
    if (hq === chave) return false; // repetida: sobe para o topo
    // "sond" salvo há pouco e agora "sonda 12": era a mesma busca ainda sendo digitada
    return !(chave.startsWith(hq) && agora - (h.em || 0) < JANELA_DIGITACAO_MS);
  });
  lista.unshift({ q, cat: categoria, em: agora });
  gravarHistorico(lista.slice(0, MAX_HISTORICO));
}

const buscaTemResultado = () => Boolean(estadoLista && estadoLista.itens.length > 0 && estadoLista.modo === "busca");

function registrarBuscaAtual() {
  cancelarRegistroHistorico();
  const termo = input.value.trim();
  if (termo && buscaTemResultado()) salvarNoHistorico(termo, categoriaAtual);
}

function agendarRegistroHistorico() {
  cancelarRegistroHistorico();
  const termo = input.value.trim();
  if (!termo || !buscaTemResultado()) return;
  timeoutHistorico = setTimeout(() => {
    if (input.value.trim() === termo) registrarBuscaAtual();
  }, ESPERA_HISTORICO_MS);
}

function cancelarRegistroHistorico() {
  clearTimeout(timeoutHistorico);
}

const ICONE_RELOGIO =
  '<svg class="historico__icone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>';

function abrirHistorico() {
  const lista = obterHistorico();
  if (!lista.length || input.value.trim() || document.activeElement !== input) {
    fecharHistorico();
    return;
  }
  historicoAtivo = -1;
  historicoLista.innerHTML = lista
    .map(
      (h, i) =>
        `<li class="historico__item" role="option" id="hist-${i}" data-i="${i}" aria-selected="false">` +
        `${ICONE_RELOGIO}<span class="historico__texto">${escaparHtml(h.q)}</span>` +
        (h.cat ? `<span class="historico__cat">em ${escaparHtml(h.cat)}</span>` : "") +
        `<button type="button" class="historico__remover" data-remover="${i}" tabindex="-1" aria-label="Remover ${escaparHtml(h.q)} do histórico" title="Remover do histórico">` +
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></li>`,
    )
    .join("");
  historicoCaixa.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

function fecharHistorico() {
  historicoCaixa.hidden = true;
  historicoAtivo = -1;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function destacarHistorico(indice) {
  const itens = [...historicoLista.querySelectorAll(".historico__item")];
  if (!itens.length) return;
  historicoAtivo = (indice + itens.length) % itens.length;
  itens.forEach((li, i) => li.setAttribute("aria-selected", String(i === historicoAtivo)));
  input.setAttribute("aria-activedescendant", itens[historicoAtivo].id);
  itens[historicoAtivo].scrollIntoView({ block: "nearest" });
}

function usarHistorico(indice) {
  const h = obterHistorico()[indice];
  if (!h) return;
  fecharHistorico();
  input.value = h.q;
  atualizarBotaoLimpar();
  modoExplorar = false;
  // a categoria só volta se ainda existir
  categoriaAtual = h.cat && categoriasLista.some(([nome]) => nome === h.cat) ? h.cat : "";
  renderizarCategorias();
  clearTimeout(timeoutBusca);
  mostrarBusca();
  executarBusca(h.q);
  atualizarEndereco();
  if (buscaTemResultado()) salvarNoHistorico(h.q, categoriaAtual); // sobe para o topo
}

// Como no Google: o campo já abre com foco, mas o histórico só aparece quando a pessoa clica nele vazio ou aperta ↓
input.addEventListener("click", () => {
  if (!input.value.trim() && historicoCaixa.hidden) abrirHistorico();
});
input.addEventListener("blur", fecharHistorico);
input.addEventListener("keydown", (e) => {
  const aberto = !historicoCaixa.hidden;
  if (e.key === "ArrowDown") {
    if (!aberto && !input.value.trim()) abrirHistorico();
    if (!historicoCaixa.hidden) {
      e.preventDefault();
      destacarHistorico(historicoAtivo + 1);
    }
  } else if (e.key === "ArrowUp" && aberto) {
    e.preventDefault();
    destacarHistorico(historicoAtivo - 1);
  } else if (e.key === "Enter") {
    if (aberto && historicoAtivo >= 0) {
      e.preventDefault();
      usarHistorico(historicoAtivo);
    } else if (input.value.trim()) {
      // Enter confirma a busca na hora (sem esperar o debounce) e a guarda no histórico
      clearTimeout(timeoutBusca);
      mostrarBusca();
      executarBusca(input.value.trim());
      atualizarEndereco();
      registrarBuscaAtual();
    }
  } else if (e.key === "Escape" && aberto) {
    e.preventDefault();
    e.stopPropagation();
    fecharHistorico();
  } else if (e.key === "Escape" && input.value) {
    e.preventDefault();
    botaoLimparBusca.click(); // Esc limpa a busca (igual ao X vermelho)
  }
});

// Atalho "/": vai para a busca de qualquer lugar da página (menos quando já se está digitando)
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  const alvo = e.target;
  if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
  e.preventDefault();
  if (caixaCategorias.classList.contains("is-aberta")) definirGavetaAberta(false, false);
  window.scrollTo({ top: 0, behavior: "auto" });
  input.focus();
  input.select();
});
// clicar dentro da lista não tira o foco do campo
historicoCaixa.addEventListener("mousedown", (e) => e.preventDefault());
historicoLista.addEventListener("click", (e) => {
  const remover = e.target.closest("[data-remover]");
  if (remover) {
    const lista = obterHistorico();
    lista.splice(Number(remover.dataset.remover), 1);
    gravarHistorico(lista);
    abrirHistorico();
    return;
  }
  const item = e.target.closest(".historico__item");
  if (item) usarHistorico(Number(item.dataset.i));
});
document.getElementById("historicoLimpar").addEventListener("click", () => {
  gravarHistorico([]);
  fecharHistorico();
});

/* ---------- Categorias (gaveta) ---------- */

function montarCategorias() {
  const contagem = new Map();
  for (const item of database) {
    if (item.categoria !== "-") contagem.set(item.categoria, (contagem.get(item.categoria) || 0) + 1);
  }
  categoriasLista = [...contagem.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
  );

  // categoria vinda do link (?cat=): aceita sem diferenciar maiúsculas/acentos
  if (categoriaDoLink) {
    const achada = categoriasLista.find(([nome]) => normalizar(nome) === normalizar(categoriaDoLink));
    if (achada) {
      categoriaAtual = achada[0];
    }
    categoriaDoLink = "";
  }
  renderizarCategorias();
}

// O botão de categorias já nasce visível; se a base não tiver categorias (ou falhar ao carregar), some
function esconderCategorias() {
  botaoCategorias.hidden = true;
  filtroAtivo.hidden = true;
  categoriaAtual = "";
  definirGavetaAberta(false, false);
}

function renderizarCategorias() {
  if (categoriasLista.length === 0 && areasLista.length === 0) {
    esconderCategorias(); // banco sem categorias nem áreas: o botão do cabeçalho some
    return;
  }
  botaoCategorias.hidden = false;
  listaCategorias.removeAttribute("aria-busy");
  filtroCategoria.disabled = false;

  const item = (nome, n, rotulo) =>
    `<button type="button" class="cat-item${nome ? "" : " cat-item--todas"}" data-categoria="${escaparHtml(nome)}" aria-pressed="${nome === categoriaAtual}">` +
    `<span>${escaparHtml(rotulo)}</span><span class="cat-item__n">${n}</span></button>`;
  listaCategorias.innerHTML =
    item("", database.length, "Todos os produtos") +
    categoriasLista.map(([nome, n]) => item(nome, n, nome)).join("");
  filtrarCategorias();

  atualizarFiltroAtivo();
}

// Faixa "Categoria: Luvas · Área: Hospitais  ×" sob o campo de busca
function atualizarFiltroAtivo() {
  botaoCategorias.classList.toggle("tem-selecao", temFiltro());
  botaoCategorias.setAttribute("aria-label", temFiltro() ? `Abrir categorias (selecionado: ${rotuloFiltro()})` : "Abrir categorias");
  filtroAtivo.hidden = !temFiltro();
  const partes = [];
  if (categoriaAtual) partes.push(`Categoria: <strong>${escaparHtml(categoriaAtual)}</strong>`);
  if (areaAtual) partes.push(`Área: ${htmlIconeArea(areaAtual, 14)}<strong>${escaparHtml(areaAtual)}</strong>`);
  filtroAtivoNome.innerHTML = partes.join('<span class="filtro-ativo__sep">·</span>');
  input.placeholder = temFiltro()
    ? `Refine em ${rotuloFiltro()}: tamanho, marca, código...`
    : PLACEHOLDER_PADRAO;
}

/* ---------- Áreas de atuação (gaveta + selos na busca) ---------- */

const caixaAreas = document.getElementById("areasFiltro");
const listaAreas = document.getElementById("areasLista");

function htmlIconeArea(nome, tam = 16) {
  return window.CBS_AREAS_ICONES ? window.CBS_AREAS_ICONES.svg(iconesArea.get(nome), tam) : "";
}

// cadastradas: [{nome, icone, ordem}] do banco. Só aparecem as que têm produtos.
function montarAreas(cadastradas) {
  iconesArea.clear();
  const ordem = new Map();
  (cadastradas || []).forEach((a, i) => {
    iconesArea.set(a.nome, a.icone);
    ordem.set(a.nome, i);
  });
  const contagem = new Map();
  for (const item of database) for (const a of item.areas) contagem.set(a, (contagem.get(a) || 0) + 1);
  areasLista = [...contagem.entries()]
    .map(([nome, n]) => ({ nome, n }))
    .sort((a, b) => (ordem.get(a.nome) ?? 999) - (ordem.get(b.nome) ?? 999) || a.nome.localeCompare(b.nome, "pt-BR"));
  if (areaDoLink) {
    const achada = areasLista.find((a) => normalizar(a.nome) === normalizar(areaDoLink));
    if (achada) areaAtual = achada.nome;
    areaDoLink = "";
  }
  if (areaAtual && !contagem.has(areaAtual)) areaAtual = "";
  renderizarAreas();
}

function renderizarAreas() {
  if (!caixaAreas) return;
  caixaAreas.hidden = areasLista.length === 0;
  document.getElementById("gavetaTitulo").textContent = areasLista.length ? "Filtros" : "Categorias";
  listaAreas.innerHTML = areasLista
    .map(
      (a) =>
        `<button type="button" class="area-chip" data-area="${escaparHtml(a.nome)}" aria-pressed="${a.nome === areaAtual}">` +
        `${htmlIconeArea(a.nome)}<span>${escaparHtml(a.nome)}</span><span class="area-chip__n">${fmtNum.format(a.n)}</span></button>`,
    )
    .join("");
  if (botaoCategorias) atualizarFiltroAtivo();
}

if (listaAreas) {
  listaAreas.addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-area]");
    if (!botao) return;
    areaAtual = botao.dataset.area === areaAtual ? "" : botao.dataset.area; // clicar de novo desmarca
    renderizarAreas();
    escolherCategoria(categoriaAtual); // refaz a busca com o filtro novo
    definirGavetaAberta(false);
  });
}

// Selos "Indicado para" na linha do produto (ícone + nome da área)
function htmlAreasDoItem(item) {
  if (!item.areas.length) return "";
  const selos = item.areas
    .map((a) => `<span class="area-selo${a === areaAtual ? " area-selo--ativa" : ""}" title="Área de atuação: ${escaparHtml(a)}">${htmlIconeArea(a, 14)}${escaparHtml(a)}</span>`)
    .join("");
  return `<div class="areas-item"><span class="apelidos__rotulo">Indicado para</span>${selos}</div>`;
}

function escolherCategoria(nome) {
  categoriaAtual = nome;
  modoExplorar = false;
  renderizarCategorias();
  clearTimeout(timeoutBusca);
  const termo = input.value.trim();
  if (!termo && !temFiltro()) {
    mostrarHome();
    atualizarEndereco();
    return;
  }
  mostrarBusca();
  executarBusca(termo);
  atualizarEndereco();
}

listaCategorias.addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-categoria]");
  if (!botao) return;
  const nome = botao.dataset.categoria;
  const novo = nome === categoriaAtual ? "" : nome; // clicar de novo desmarca
  // "Todos os produtos" (ou desmarcar) sem nada digitado: abre o catálogo completo
  if (!novo && !input.value.trim() && nome === "") abrirCatalogo();
  else escolherCategoria(novo);
  definirGavetaAberta(false); // depois de escolher, a gaveta fecha e os resultados aparecem
});

// Campo "Buscar categoria..." da gaveta: filtra a lista enquanto digita
function filtrarCategorias() {
  const termo = normalizarEspacos(filtroCategoria.value);
  let visiveis = 0;
  listaCategorias.querySelectorAll(".cat-item").forEach((btn) => {
    const nome = btn.dataset.categoria;
    const mostra = termo ? nome !== "" && normalizar(nome).includes(termo) : true;
    btn.hidden = !mostra;
    if (mostra) visiveis++;
  });
  categoriasVazio.hidden = visiveis > 0;
  categoriasVazio.textContent = visiveis ? "" : `Nenhuma categoria encontrada para "${filtroCategoria.value.trim()}".`;
}

filtroCategoria.addEventListener("input", filtrarCategorias);
filtroCategoria.addEventListener("keydown", (e) => {
  const primeira = listaCategorias.querySelector(".cat-item:not([hidden])");
  if (e.key === "Enter" && primeira && filtroCategoria.value.trim()) {
    e.preventDefault();
    primeira.click(); // Enter escolhe a primeira categoria da lista filtrada
  } else if (e.key === "ArrowDown" && primeira) {
    e.preventDefault();
    primeira.focus();
  }
});
// setas para andar pela lista (e voltar ao campo de busca do topo)
listaCategorias.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const itens = [...listaCategorias.querySelectorAll(".cat-item:not([hidden])")];
  const i = itens.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  if (e.key === "ArrowDown") (itens[i + 1] || itens[i]).focus();
  else if (i === 0 && !filtroCategoria.disabled) filtroCategoria.focus();
  else itens[i - 1].focus();
});

// Gaveta de categorias (off-canvas): abre pelo botão do cabeçalho, fecha com Esc, fundo, « ou ao escolher
function definirGavetaAberta(aberta, devolverFoco = true) {
  if (caixaCategorias.classList.contains("is-aberta") === aberta) return;
  caixaCategorias.classList.toggle("is-aberta", aberta);
  caixaCategorias.inert = !aberta;
  botaoCategorias.setAttribute("aria-expanded", String(aberta));
  gavetaFundo.hidden = false;
  requestAnimationFrame(() => gavetaFundo.classList.toggle("is-visivel", aberta));
  if (!aberta) {
    setTimeout(() => { if (!caixaCategorias.classList.contains("is-aberta")) gavetaFundo.hidden = true; }, 250);
    // ao fechar, o filtro da gaveta é limpo para a próxima vez
    if (filtroCategoria.value) {
      filtroCategoria.value = "";
      filtrarCategorias();
    }
  }
  if (aberta) {
    fecharHistorico();
    // com mouse/teclado, o foco vai para o campo de busca da gaveta; no celular, não (o teclado cobriria a lista)
    const pontoFino = window.matchMedia("(pointer: fine)").matches;
    const alvo =
      listaCategorias.querySelector('.cat-item[aria-pressed="true"]:not(.cat-item--todas)') ||
      (pontoFino && !filtroCategoria.disabled ? filtroCategoria : null) ||
      botaoFecharGaveta;
    setTimeout(() => alvo.focus({ preventScroll: true }), 50);
  } else if (devolverFoco) {
    botaoCategorias.focus({ preventScroll: true });
  }
}

botaoCategorias.addEventListener("click", () => definirGavetaAberta(!caixaCategorias.classList.contains("is-aberta")));
botaoFecharGaveta.addEventListener("click", () => definirGavetaAberta(false));
gavetaFundo.addEventListener("click", () => definirGavetaAberta(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && caixaCategorias.classList.contains("is-aberta")) definirGavetaAberta(false);
});
document.getElementById("filtroAtivoLimpar").addEventListener("click", () => {
  areaAtual = "";
  renderizarAreas();
  escolherCategoria("");
  input.focus();
});

// Abre já com a busca do link (?q=..., ?cat=..., ?p=... ou ?ver=todos)
(function buscaDoLink() {
  const q = parametrosIniciais.get("q");
  if (q && q.trim()) {
    input.value = q.trim();
    atualizarBotaoLimpar();
    modoExplorar = false;
    mostrarBusca();
    btnLink.hidden = false;
    executarBusca(q.trim(), paginaDoLink);
  } else if (categoriaDoLink || modoExplorar) {
    mostrarBusca();
    btnLink.hidden = false;
    executarBusca("");
  }
})();

/* ---------- App instalável (PWA) ---------- */

// Guarda o site para abrir rápido e funcionar sem internet (sw.js)
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// Botão do app no cabeçalho:
//   Chrome/Edge, app ainda não instalado -> "Instalar app" (janela de instalação do navegador)
//   Chrome/Edge, app já instalado        -> "Abrir o app" (abre o app pelo protocolo web+agoravocesabe:,
//                                           já com a busca que está na tela)
//   Firefox no computador                -> "Instalar app" abre uma ajuda: abrir no Edge e instalar por lá
//   Dentro do próprio app                -> some
(function botaoApp() {
  const botao = document.getElementById("btnInstalar");
  const rotulo = botao && botao.querySelector(".site-header__instalar-rotulo");
  const ajuda = document.getElementById("instalarAjuda");
  if (!botao) return;
  const CHAVE = "cbs_app_instalado";
  const marcar = (sim) => { try { sim ? localStorage.setItem(CHAVE, "1") : localStorage.removeItem(CHAVE); } catch (_) {} };
  const marcado = () => { try { return localStorage.getItem(CHAVE) === "1"; } catch (_) { return false; } };
  const dentroDoApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const firefoxPC = /firefox/i.test(navigator.userAgent) && !/android|mobi/i.test(navigator.userAgent);
  let pedido = null;
  let modo = ""; // "instalar" | "abrir" | "ajuda"

  function mostrar(novo) {
    modo = novo;
    botao.hidden = !novo;
    if (!novo) return;
    const abrir = novo === "abrir";
    rotulo.textContent = abrir ? "Abrir o app" : "Instalar app";
    botao.title = abrir
      ? "Abrir o Agora Você Sabe no app instalado neste computador"
      : "Instalar o Agora Você Sabe como app neste computador";
    botao.classList.toggle("site-header__instalar--abrir", abrir);
    botao.setAttribute("aria-haspopup", novo === "ajuda" ? "dialog" : "false");
  }

  if (dentroDoApp) {
    marcar(true); // usado como app: este navegador tem o app instalado
    return;
  }
  if (firefoxPC) {
    mostrar("ajuda");
  } else if (marcado()) {
    mostrar("abrir");
  }

  // O navegador só oferece instalar quando o app NÃO está instalado (inclusive se a pessoa desinstalou)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e;
    marcar(false);
    mostrar("instalar");
  });
  window.addEventListener("appinstalled", () => {
    pedido = null;
    marcar(true);
    mostrar("abrir");
  });
  // Chrome/Edge que sabem dizer se o app está instalado (mesmo sem o aviso acima)
  if (navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps()
      .then((apps) => { if (apps.length && !pedido) { marcar(true); mostrar("abrir"); } })
      .catch(() => {});
  }

  function linkDoApp() {
    const params = typeof parametrosDaBusca === "function" ? parametrosDaBusca() : "";
    return `web+agoravocesabe:${encodeURIComponent(params)}`;
  }
  document.getElementById("abrirAppFirefox").addEventListener("click", (e) => {
    e.currentTarget.href = linkDoApp();
  });

  function fecharAjuda() {
    ajuda.hidden = true;
    botao.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => { if (!ajuda.hidden && !e.target.closest(".instalar-wrap")) fecharAjuda(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ajuda.hidden) { fecharAjuda(); botao.focus(); } });

  botao.addEventListener("click", async () => {
    if (modo === "instalar" && pedido) {
      pedido.prompt();
      try {
        const escolha = await pedido.userChoice;
        if (escolha && escolha.outcome === "accepted") { pedido = null; marcar(true); mostrar("abrir"); }
      } catch (_) {}
    } else if (modo === "abrir") {
      window.location.href = linkDoApp(); // o Windows abre o app instalado (Edge/Chrome)
    } else if (modo === "ajuda") {
      const abrir = ajuda.hidden;
      ajuda.hidden = !abrir;
      botao.setAttribute("aria-expanded", String(abrir));
      if (abrir) document.getElementById("abrirNoEdge").focus();
    }
  });
})();


/* ==========================================================================
   Home: números que contam, exemplos no campo de busca, "Você sabia?" e
   "Nesta semana". Tudo some/fica parado com "reduzir movimento".
   ========================================================================== */
const semMovimento = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

// conta de 0 até o valor (desacelerando no fim)
function contarAte(el, alvo, ms = 700) {
  if (!el) return;
  if (semMovimento() || !alvo) {
    el.textContent = fmtNum.format(alvo);
    return;
  }
  const ini = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - ini) / ms);
    el.textContent = fmtNum.format(Math.round(alvo * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

// Campo de busca vazio: alterna exemplos de busca no placeholder (para quando a pessoa digita ou há filtro)
(function exemplosNoCampo() {
  const EXEMPLOS = ["Ex.: Jelco", "Ex.: sonda 12", "Ex.: luva procedimento -latex", "Ex.: Transofix", "Ex.: 000437", "Ex.: esfigmomanômetro"];
  let i = 0;
  setInterval(() => {
    if (semMovimento() || document.hidden || input.value || temFiltro() || document.activeElement === input) {
      if (!temFiltro() && input.placeholder !== PLACEHOLDER_PADRAO && (input.value || document.activeElement === input)) input.placeholder = PLACEHOLDER_PADRAO;
      return;
    }
    input.placeholder = i % 2 === 0 ? EXEMPLOS[(i / 2) % EXEMPLOS.length] : PLACEHOLDER_PADRAO;
    i++;
  }, 3200);
})();

/* --- "Você sabia?": um produto e os outros nomes dele --- */
let sabiaAtual = null;
function sortearSabia() {
  const comNomes = database.filter((p) => p.tags.length >= 2);
  if (!comNomes.length) return null;
  let p;
  for (let t = 0; t < 5; t++) {
    p = comNomes[Math.floor(Math.random() * comNomes.length)];
    if (!sabiaAtual || p.sku !== sabiaAtual.sku) break;
  }
  return p;
}
function desenharSabia(animar) {
  const caixa = document.getElementById("sabia");
  const texto = document.getElementById("sabiaTexto");
  sabiaAtual = sortearSabia();
  if (!sabiaAtual) {
    caixa.hidden = true;
    return;
  }
  const nomes = sabiaAtual.tags.slice(0, 4).map((t) => `<strong>${escaparHtml(t)}</strong>`);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
  const html = `O produto <span class="sabia__produto">${escaparHtml(sabiaAtual.descricao)}</span> <span class="sabia__sku">(${escaparHtml(sabiaAtual.sku)})</span> também é conhecido como ${lista}.`;
  caixa.hidden = false;
  if (!animar || semMovimento()) {
    texto.innerHTML = html;
    return;
  }
  texto.classList.add("sabia__texto--saindo");
  setTimeout(() => {
    texto.innerHTML = html;
    texto.classList.remove("sabia__texto--saindo");
  }, 180);
}
document.getElementById("sabiaOutro").addEventListener("click", () => desenharSabia(true));
document.getElementById("sabiaVer").addEventListener("click", () => {
  if (!sabiaAtual) return;
  input.value = sabiaAtual.sku;
  atualizarBotaoLimpar();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
});

/* --- "Nesta semana": novos, preços que mudaram (Lista Diária deste navegador) e removidos --- */
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
function desenharSemanaPrecos() {
  const el = document.getElementById("semPrecos");
  const rot = document.getElementById("semPrecosRotulo");
  const l = window.ListaDiaria;
  if (l && l.ativa() && l.comparadaCom && l.comparadaCom()) {
    contarAte(el, l.variacoes().length);
    rot.textContent = "preços mudaram";
  } else {
    el.textContent = "–";
    rot.textContent = l && l.ativa() ? "preços (sem lista anterior)" : "preços (carregue a lista)";
  }
}
async function montarDestaques() {
  document.getElementById("destaques").hidden = false;
  desenharSabia(false);
  const desde = Date.now() - SEMANA_MS;
  contarAte(document.getElementById("semNovos"), database.filter((p) => p.criadoEm && p.criadoEm >= desde).length);
  desenharSemanaPrecos();
  const rem = window.CBS_API && CBS_API.configurado && CBS_API.produtosRemovidos ? await CBS_API.produtosRemovidos(7) : null;
  const elRem = document.getElementById("semRemovidos");
  if (rem === null) elRem.textContent = "–";
  else contarAte(elRem, rem.length);
}
window.addEventListener("listadiaria:mudou", () => {
  if (carregado) desenharSemanaPrecos();
});
