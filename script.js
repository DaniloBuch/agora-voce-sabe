let database = [];
let carregado = false;
let erroCarga = false;
let timeoutBusca = null;
let timeoutFade = null;
let vocabulario = null; // palavras da base, para sugerir correções de digitação
let categoriaAtual = ""; // categoria escolhida nos botões ("" = todas)
let categoriasLista = []; // [[nome, quantidade]], da mais usada para a menos usada
let categoriaDoLink = new URLSearchParams(location.search).get("cat") || "";

const input = document.getElementById("searchInput");
const heroCards = document.getElementById("heroCards");
const resultsContainer = document.getElementById("resultsContainer");
const resultsInfo = document.getElementById("resultsInfo");
const tbody = document.getElementById("tableBody");
const btnLink = document.getElementById("btnLink");
const caixaCategorias = document.getElementById("categorias");
const listaCategorias = document.getElementById("categoriasLista");
const botaoCategorias = document.getElementById("categoriasToggle");
const gavetaFundo = document.getElementById("gavetaFundo");
const botaoFecharGaveta = document.getElementById("gavetaFechar");
const filtroAtivo = document.getElementById("filtroAtivo");
const filtroAtivoNome = document.getElementById("filtroAtivoNome");
const PLACEHOLDER_PADRAO = input.placeholder;

// URL do seu JSON
const DATA_URL = "./db.json";
const MAX_RESULTADOS = 100;
const MAX_TAGS_VISIVEIS = 6;

/* ---------- Utilitários ---------- */

// Minúsculas e sem acentos: "Esfigmomanômetro" -> "esfigmomanometro"
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
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

// Escapa o texto e destaca os termos buscados (ignorando acentos/maiúsculas).
// "deslocamento" = quantos caracteres do começo NÃO são exibidos (os zeros à esquerda
// da Ref.): a busca é feita no texto completo, mas só a parte visível é mostrada.
function destacar(texto, termos, deslocamento = 0) {
  const original = String(texto ?? "");
  if (!original) return "";

  // Mapeia cada caractere normalizado de volta ao índice no texto original
  let norm = "";
  const mapa = [];
  for (let i = 0; i < original.length; i++) {
    const n = normalizar(original[i]);
    for (let k = 0; k < n.length; k++) mapa.push(i);
    norm += n;
  }

  const faixas = [];
  for (const t of termos) {
    if (!t) continue;
    let pos = norm.indexOf(t);
    while (pos !== -1) {
      faixas.push([mapa[pos], mapa[pos + t.length - 1] + 1]);
      pos = norm.indexOf(t, pos + t.length);
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

async function carregarDados() {
  const cardInfo = document.querySelector(".hero-cards .card:first-child p");
  try {
    const { dados: dadosBrutos, contingencia } = await lerDb();

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
          _desc: normalizar(descricao),
          _ref: normalizar(referencia),
          _refOriginal: normalizar(referenciaOriginal), // a busca aceita as duas formas
          _tags: tagsArray.map(normalizar),
          _buscaFull: normalizar(
            [sku, descricao, referencia, referenciaOriginal, tagsArray.join(" ")].join(" "),
          ),
        };
      });
    vocabulario = null;
    carregado = true;
    console.log("Sistema CBS Online. Itens:", database.length);
    montarCategorias();

    // Atualiza o card com o numero real
    if (cardInfo) {
      cardInfo.innerText = contingencia
        ? `Modo contingência: ${database.length} produtos do arquivo local, que pode estar desatualizado.`
        : `${database.length} produtos carregados`;
      cardInfo.classList.toggle("is-erro", contingencia);
    }

    // Se o usuário já digitou algo (ou abriu um link com categoria) enquanto carregava, busca agora
    const termo = input.value.trim();
    if (termo || categoriaAtual) {
      mostrarBusca();
      atualizarEndereco();
      executarBusca(termo);
    } else {
      mostrarHome(); // link com categoria que não existe mais: volta para o início
    }
  } catch (erro) {
    console.error("Erro Fatal:", erro);
    erroCarga = true;
    if (cardInfo) {
      cardInfo.innerText = "Não conseguimos carregar a base de produtos. Tente novamente em instantes.";
      cardInfo.classList.add("is-erro");
    }
    if (input.value.trim()) executarBusca(input.value.trim());
  }
}

carregarDados();

/* ---------- Estado visual (Home <-> Busca) ---------- */

function mostrarHome() {
  clearTimeout(timeoutFade);
  resultsContainer.style.display = "none";
  heroCards.style.display = "flex";
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

  if (termo === "" && !categoriaAtual) {
    mostrarHome();
    return;
  }
  mostrarBusca();

  // Debounce
  timeoutBusca = setTimeout(() => {
    executarBusca(termo);
  }, 300);
});

/* ---------- Busca ---------- */

// Quanto maior a pontuação, mais relevante o resultado
function pontuar(item, termos) {
  let pontos = 0;
  for (const t of termos) {
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
  }
  return pontos;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
function sugerirPalavras(termo) {
  if (termo.length < 4 || !/[a-z]/.test(termo) || /\d/.test(termo)) return [];
  const max = termo.length <= 5 ? 1 : 2;
  const achadas = [];
  for (const [palavra, usos] of obterVocabulario()) {
    let d = distancia(termo, palavra, max);
    // quem digita só o começo da palavra ("esfigmmo"): compara com o início dela
    if (d > max && termo.length >= 5 && palavra.length > termo.length) {
      d = distancia(termo, palavra.slice(0, termo.length), max);
    }
    if (d <= max) achadas.push({ palavra, d, usos });
  }
  achadas.sort((a, b) => a.d - b.d || b.usos - a.usos);
  return achadas.slice(0, 3).map((x) => x.palavra);
}

/* ---------- Execução da busca ---------- */

function executarBusca(termoOriginal) {
  if (erroCarga) {
    tbody.innerHTML = `<tr><td colspan="4" class="msg-erro">Não conseguimos carregar a base de produtos. Tente novamente em instantes.</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }
  if (!carregado) {
    tbody.innerHTML = `<tr><td colspan="4" class="msg-vazio">Carregando a base de produtos...</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }

  const termosBusca = normalizar(termoOriginal)
    .split(/\s+/)
    .filter((t) => t !== "");

  // com categoria escolhida, a busca acontece só dentro dela
  const base = categoriaAtual ? database.filter((item) => item.categoria === categoriaAtual) : database;

  let resultados = ordenar(
    base.filter((item) => termosBusca.every((t) => item._buscaFull.includes(t))),
    termosBusca,
  );
  let correcao = null;

  // Sem nada encontrado: tenta corrigir erros de digitação nos termos que não existem na base
  if (resultados.length === 0 && termosBusca.length > 0) {
    const grupos = termosBusca.map((t) =>
      base.some((item) => item._buscaFull.includes(t)) ? [t] : sugerirPalavras(t),
    );
    if (grupos.every((g) => g.length > 0) && grupos.some((g, i) => g[0] !== termosBusca[i])) {
      const filtrados = base.filter((item) =>
        grupos.every((g) => g.some((alt) => item._buscaFull.includes(alt))),
      );
      if (filtrados.length > 0) {
        const principais = grupos.map((g) => g[0]);
        resultados = ordenar(filtrados, principais);
        correcao = { original: termoOriginal.trim(), sugeridos: principais, termos: grupos.flat() };
      }
    }
  }

  // Limita a 100 itens
  renderizarTabela(
    resultados.slice(0, MAX_RESULTADOS),
    resultados.length,
    correcao ? correcao.termos : termosBusca,
    correcao,
  );
}

// Mais relevante primeiro; empate mantém a ordem original da base
function ordenar(lista, termos) {
  return lista
    .map((item, indice) => ({ item, indice, pontos: pontuar(item, termos) }))
    .sort((a, b) => b.pontos - a.pontos || a.indice - b.indice)
    .map((r) => r.item);
}

function renderizarTabela(lista, total, termos, correcao = null) {
  const emCategoria = categoriaAtual ? ` em <strong>${escaparHtml(categoriaAtual)}</strong>` : "";

  if (lista.length === 0) {
    tbody.innerHTML = categoriaAtual
      ? `<tr><td colspan="4" class="msg-erro">Não encontramos nenhum produto em <strong>${escaparHtml(categoriaAtual)}</strong> com esse termo. <button type="button" class="btn-link" data-limpar-categoria>Buscar em todas as categorias</button></td></tr>`
      : `<tr><td colspan="4" class="msg-erro">Não encontramos nenhum produto com esse termo. Tente o código, o nome técnico ou um apelido.</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }

  if (correcao) {
    resultsInfo.innerHTML =
      `Nenhum resultado exato para <strong>${escaparHtml(correcao.original)}</strong>. ` +
      `Mostrando ${total > lista.length ? `${lista.length} de ${total}` : total} resultado(s)${emCategoria} para ` +
      `<strong>${escaparHtml(correcao.sugeridos.join(" "))}</strong>.`;
    resultsInfo.className = "results-info results-info--alerta";
  } else if (termos.length === 0) {
    // só a categoria escolhida, ainda sem texto na busca
    resultsInfo.innerHTML =
      `Mostrando <strong>${lista.length}</strong> de <strong>${total}</strong> produtos${emCategoria}.` +
      (total > lista.length ? " Digite no campo de busca para refinar." : "");
    resultsInfo.className = total > lista.length ? "results-info results-info--alerta" : "results-info";
  } else if (total > lista.length) {
    resultsInfo.innerHTML = `Mostrando <strong>${lista.length}</strong> de <strong>${total}</strong> resultados${emCategoria}. Refine sua busca para ver os demais.`;
    resultsInfo.className = "results-info results-info--alerta";
  } else {
    resultsInfo.innerHTML = `Mostrando ${lista.length} de ${total} resultados encontrados${emCategoria}.`;
    resultsInfo.className = "results-info";
  }

  const html = lista
    .map((item) => {
      let tagsHtml = "";

      // LÓGICA DO EMPTY STATE
      if (item.tags.length === 0) {
        tagsHtml = `<span class="tag-empty"></span>`;
      } else {
        // Tags que casaram com a busca vêm primeiro, para nunca ficarem escondidas
        const casou = (tag) => termos.some((t) => normalizar(tag).includes(t));
        const ordenadas = [
          ...item.tags.filter(casou),
          ...item.tags.filter((tag) => !casou(tag)),
        ];
        const visiveis = ordenadas.slice(0, MAX_TAGS_VISIVEIS);
        const ocultas = ordenadas.slice(MAX_TAGS_VISIVEIS);

        tagsHtml = visiveis
          .map((tag) => `<span class="tag-pill">${destacar(tag, termos)}</span>`)
          .join("");
        if (ocultas.length > 0) {
          tagsHtml += `<span class="tag-pill tag-more" title="${escaparHtml(ocultas.join(", "))}">+${ocultas.length}</span>`;
        }
      }

      return `
        <tr>
          <td class="col-sku"><button type="button" class="sku-copiar" data-sku="${escaparHtml(item.sku)}" title="Clique para copiar o código" aria-label="Copiar código ${escaparHtml(item.sku)}">${destacar(item.sku, termos)}</button></td>
          <td class="col-desc">${destacar(item.descricao, termos)}</td>
          <td class="col-tags">${tagsHtml}</td>
          <td class="col-ref">${destacar(item.referenciaOriginal, termos, item.referenciaOriginal.length - item.referencia.length)}</td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

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
  if (btn && (await copiarTexto(btn.dataset.sku))) sinalizarCopiado(btn);
});

// Endereço da busca atual: ?cat=...&q=...
function parametrosDaBusca() {
  const params = new URLSearchParams();
  if (categoriaAtual) params.set("cat", categoriaAtual);
  const termo = input.value.trim();
  if (termo) params.set("q", termo);
  return params.toString();
}

function linkDaBusca() {
  const params = parametrosDaBusca();
  return params ? `${location.origin}${location.pathname}?${params}` : "";
}

btnLink.addEventListener("click", async () => {
  const link = linkDaBusca();
  if (link && (await copiarTexto(link))) sinalizarCopiado(btnLink, "Copiar link desta busca");
});

// Mantém o endereço da página igual à busca (dá para compartilhar ou recarregar)
function atualizarEndereco() {
  const params = parametrosDaBusca();
  btnLink.hidden = params === "";
  try {
    history.replaceState(null, "", params ? `?${params}` : location.pathname);
  } catch (_) {}
}
input.addEventListener("input", atualizarEndereco);

/* ---------- Categorias (botões de filtro) ---------- */

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

function renderizarCategorias() {
  if (categoriasLista.length === 0) {
    botaoCategorias.hidden = true; // banco sem categorias: o botão do cabeçalho some
    filtroAtivo.hidden = true;
    categoriaAtual = "";
    return;
  }
  botaoCategorias.hidden = false;

  const item = (nome, n, rotulo) =>
    `<button type="button" class="cat-item${nome ? "" : " cat-item--todas"}" data-categoria="${escaparHtml(nome)}" aria-pressed="${nome === categoriaAtual}">` +
    `<span>${escaparHtml(rotulo)}</span><span class="cat-item__n">${n}</span></button>`;
  listaCategorias.innerHTML =
    item("", database.length, "Todos os produtos") +
    categoriasLista.map(([nome, n]) => item(nome, n, nome)).join("");

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
  renderizarCategorias();
  clearTimeout(timeoutBusca);
  const termo = input.value.trim();
  atualizarEndereco();
  if (!termo && !categoriaAtual) {
    mostrarHome();
    return;
  }
  mostrarBusca();
  executarBusca(termo);
}

listaCategorias.addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-categoria]");
  if (!botao) return;
  const nome = botao.dataset.categoria;
  escolherCategoria(nome === categoriaAtual ? "" : nome); // clicar de novo desmarca; "Todos" limpa o filtro
  definirGavetaAberta(false); // depois de escolher, a gaveta fecha e os resultados aparecem
});

// Gaveta de categorias (off-canvas): abre pelo botão do cabeçalho, fecha com Esc, fundo, « ou ao escolher
function definirGavetaAberta(aberta, devolverFoco = true) {
  if (caixaCategorias.classList.contains("is-aberta") === aberta) return;
  caixaCategorias.classList.toggle("is-aberta", aberta);
  caixaCategorias.inert = !aberta;
  botaoCategorias.setAttribute("aria-expanded", String(aberta));
  gavetaFundo.hidden = false;
  requestAnimationFrame(() => gavetaFundo.classList.toggle("is-visivel", aberta));
  if (!aberta) setTimeout(() => { if (!caixaCategorias.classList.contains("is-aberta")) gavetaFundo.hidden = true; }, 250);
  if (aberta) {
    const alvo = listaCategorias.querySelector('[aria-pressed="true"]') || botaoFecharGaveta;
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

// Abre já com a busca do link (?q=... e/ou ?cat=...)
(function buscaDoLink() {
  const q = new URLSearchParams(location.search).get("q");
  if (q && q.trim()) {
    input.value = q.trim();
    mostrarBusca();
    btnLink.hidden = false;
    executarBusca(q.trim());
  } else if (categoriaDoLink) {
    mostrarBusca();
    btnLink.hidden = false;
  }
})();
