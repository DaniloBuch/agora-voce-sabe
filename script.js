let database = [];
let carregado = false;
let erroCarga = false;
let timeoutBusca = null;
let timeoutFade = null;
let vocabulario = null; // palavras da base, para sugerir correções de digitação
let categoriaAtual = ""; // categoria escolhida na gaveta ("" = todas)
let categoriasLista = []; // [[nome, quantidade]], da mais usada para a menos usada
const parametrosIniciais = new URLSearchParams(location.search);
let categoriaDoLink = parametrosIniciais.get("cat") || "";
let paginaDoLink = Math.max(1, parseInt(parametrosIniciais.get("p"), 10) || 1);
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

async function lerDb() {
  // 1) Banco (Supabase), se configurado; 2) db.json como plano B.
  if (window.CBS_API && CBS_API.configurado) {
    try {
      return { dados: await CBS_API.listarProdutos(), contingencia: false };
    } catch (erro) {
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
    return await CBS_API.listarSinonimos();
  } catch (_) {
    return [];
  }
}

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
    const [{ dados: dadosBrutos, contingencia }, grupos] = await Promise.all([lerDb(), lerSinonimos()]);
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
    montarCategorias();

    // Atualiza o painel com o número real
    infoNumero.textContent = fmtNum.format(database.length);
    infoTexto.textContent = contingencia
      ? "produtos do arquivo local (modo contingência: pode estar desatualizado)."
      : "produtos carregados";
    infoTexto.classList.toggle("is-erro", contingencia);
    heroCards.classList.add("is-carregado");

    // Se o usuário já digitou algo (ou abriu um link com categoria/catálogo) enquanto carregava, busca agora
    const termo = input.value.trim();
    if (termo || categoriaAtual || modoExplorar) {
      if (!termo && !categoriaAtual) modoExplorar = true;
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

  if (termo === "" && !categoriaAtual) {
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
  return { termos, exatos, excluidos };
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
    estado.modo = categoriaAtual ? "categoria" : modoExplorar && !consulta.excluidos.length ? "explorar" : "navegar";
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
  renderizarPagina();
}

// 4 colunas normais; 6 quando há Lista Diária (Saldo e Preço campanha)
function numColunas() {
  return window.ListaDiaria && window.ListaDiaria.ativa() ? 6 : 4; // SKU, descrição (+ saldo e preço), Ref., Site
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
    return { url, exato: true, ficha: info.ficha || "", imagem: info.imagem || "" };
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

function htmlSite(item) {
  const { url, exato, ficha, imagem } = linkDoProduto(item);
  const dica = exato ? "Ver no site: imagem e ficha técnica" : "Procurar no site oficial";
  const nome = escaparHtml(item.descricao);
  const site =
    `<a class="link-site${imagem ? " tem-imagem" : ""}" href="${escaparHtml(url)}" target="_blank" rel="noopener" data-dica="${dica}"` +
    `${imagem ? ` data-imagem="${escaparHtml(imagem)}"` : ""} aria-label="${dica}: ${nome} (abre em nova aba)">${ICONE_SITE}</a>`;
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
  return {
    colunas: `<td class="col-lista col-saldo">${saldoHtml}</td><td class="col-lista col-preco">${precoHtml}</td>`,
    // no celular as colunas somem e o resumo aparece sob a descrição
    resumoMobile: `<span class="desc-extra">Saldo: ${saldoHtml} · Preço camp.: ${precoHtml}</span>`,
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
          <td class="col-sku"><button type="button" class="sku-copiar" data-sku="${escaparHtml(item.sku)}" title="Clique para copiar o código" aria-label="Copiar código ${escaparHtml(item.sku)}">${destacar(item.sku, termos)}</button></td>
          <td class="col-desc"><span class="desc-texto">${destacar(item.descricao, termos)}</span>${apelidosHtml}${lista.resumoMobile}</td>
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

function renderizarPagina() {
  const estado = estadoLista;
  if (!estado) return;
  const total = estado.itens.length;
  const emCategoria = categoriaAtual ? ` em <strong>${escaparHtml(categoriaAtual)}</strong>` : "";

  if (total === 0) {
    let msg;
    if (categoriaAtual) {
      msg = `Não encontramos nenhum produto em <strong>${escaparHtml(categoriaAtual)}</strong> com esse termo. <button type="button" class="btn-link" data-limpar-categoria>Buscar em todas as categorias</button>`;
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
  resultsInfo.className = classeInfo;

  const destaqueParecidos = estado.destaque.concat(estado.destaqueParecidos);
  let html = "";
  for (let i = inicio; i < fim; i++) {
    if (i >= estado.nExatos && (i === estado.nExatos || i === inicio)) {
      html += `<tr class="linha-divisoria"><td colspan="${numColunas()}">` +
        `<strong>Parecidos com a sua busca${i > estado.nExatos ? " (continuação)" : ""}</strong>` +
        `<span> · palavras com grafia próxima, caso algo tenha sido digitado diferente</span></td></tr>`;
    }
    html += linhaProduto(estado.itens[i], i >= estado.nExatos ? destaqueParecidos : estado.destaque);
  }
  tbody.innerHTML = html;
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
  modoExplorar = true;
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
  const termo = input.value.trim();
  if (termo) params.set("q", termo);
  if (modoExplorar && !termo && !categoriaAtual) params.set("ver", "todos");
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
  }
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
  if (categoriasLista.length === 0) {
    esconderCategorias(); // banco sem categorias: o botão do cabeçalho some
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

  botaoCategorias.classList.toggle("tem-selecao", Boolean(categoriaAtual));
  botaoCategorias.setAttribute("aria-label", categoriaAtual ? `Abrir categorias (selecionada: ${categoriaAtual})` : "Abrir categorias");
  filtroAtivo.hidden = !categoriaAtual;
  filtroAtivoNome.textContent = categoriaAtual;
  input.placeholder = categoriaAtual
    ? `Refine em ${categoriaAtual}: tamanho, marca, código...`
    : PLACEHOLDER_PADRAO;
}

function escolherCategoria(nome) {
  categoriaAtual = nome;
  modoExplorar = false;
  renderizarCategorias();
  clearTimeout(timeoutBusca);
  const termo = input.value.trim();
  if (!termo && !categoriaAtual) {
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
