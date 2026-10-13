let database = [];
let carregado = false;
let erroCarga = false;
let timeoutBusca = null;
let timeoutFade = null;

const input = document.getElementById("searchInput");
const heroCards = document.getElementById("heroCards");
const resultsContainer = document.getElementById("resultsContainer");
const resultsInfo = document.getElementById("resultsInfo");
const tbody = document.getElementById("tableBody");

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

// Evita que <, >, & ou aspas nos dados quebrem (ou injetem) HTML
function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapa o texto e destaca os termos buscados (ignorando acentos/maiúsculas)
function destacar(texto, termos) {
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
  if (faixas.length === 0) return escaparHtml(original);

  // Une faixas sobrepostas
  faixas.sort((a, b) => a[0] - b[0]);
  const unidas = [faixas[0]];
  for (const [ini, fim] of faixas.slice(1)) {
    const ultima = unidas[unidas.length - 1];
    if (ini <= ultima[1]) ultima[1] = Math.max(ultima[1], fim);
    else unidas.push([ini, fim]);
  }

  let html = "";
  let cursor = 0;
  for (const [ini, fim] of unidas) {
    html += escaparHtml(original.slice(cursor, ini));
    html += `<mark>${escaparHtml(original.slice(ini, fim))}</mark>`;
    cursor = fim;
  }
  return html + escaparHtml(original.slice(cursor));
}

/* ---------- Carga dos dados ---------- */

async function carregarDados() {
  const cardInfo = document.querySelector(".hero-cards .card:first-child p");
  try {
    const resposta = await fetch(DATA_URL);
    if (!resposta.ok) {
      throw new Error(`HTTP ${resposta.status} ao carregar ${DATA_URL}`);
    }
    const dadosBrutos = await resposta.json();
    if (!Array.isArray(dadosBrutos)) {
      throw new Error("Formato inesperado: o JSON deveria ser uma lista.");
    }

    database = dadosBrutos.map((item) => {
      let tagsArray = [];
      if (typeof item.tags === "string") {
        tagsArray = item.tags.split(",");
      } else if (Array.isArray(item.tags)) {
        tagsArray = item.tags;
      }
      tagsArray = tagsArray.map((t) => String(t).trim()).filter(Boolean);

      const sku = String(item.sku ?? "");
      const descricao = item.descricao_tecnica || item.descricao || "";
      const referencia = String(item.referencia ?? "");

      return {
        sku,
        descricao,
        referencia,
        tags: tagsArray,
        _sku: normalizar(sku),
        _desc: normalizar(descricao),
        _ref: normalizar(referencia),
        _tags: tagsArray.map(normalizar),
        _buscaFull: normalizar(
          [sku, descricao, referencia, tagsArray.join(" ")].join(" "),
        ),
      };
    });
    carregado = true;
    console.log("Sistema CBS Online. Itens:", database.length);

    // Atualiza o card com o numero real
    if (cardInfo) cardInfo.innerText = `${database.length} produtos carregados`;

    // Se o usuário já digitou algo enquanto carregava, busca agora
    const termo = input.value.trim();
    if (termo) executarBusca(termo);
  } catch (erro) {
    console.error("Erro Fatal:", erro);
    erroCarga = true;
    if (cardInfo) cardInfo.innerText = "Erro ao carregar a base de produtos";
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

  if (termo === "") {
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

    if (item._ref === t) pontos += 80;
    else if (item._ref.includes(t)) pontos += 15;

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

function executarBusca(termoOriginal) {
  if (erroCarga) {
    tbody.innerHTML = `<tr><td colspan="4" class="msg-erro">Não foi possível carregar a base de produtos. Recarregue a página ou avise o time responsável.</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }
  if (!carregado) {
    tbody.innerHTML = `<tr><td colspan="4" class="msg-vazio">Carregando base de produtos...</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }

  const termosBusca = normalizar(termoOriginal)
    .split(/\s+/)
    .filter((t) => t !== "");

  const resultados = database
    .filter((item) => termosBusca.every((t) => item._buscaFull.includes(t)))
    .map((item, indice) => ({
      item,
      indice,
      pontos: pontuar(item, termosBusca),
    }))
    // Mais relevante primeiro; empate mantém a ordem original da base
    .sort((a, b) => b.pontos - a.pontos || a.indice - b.indice)
    .map((r) => r.item);

  // Limita a 100 itens
  renderizarTabela(
    resultados.slice(0, MAX_RESULTADOS),
    resultados.length,
    termosBusca,
  );
}

function renderizarTabela(lista, total, termos) {
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="msg-erro">Nenhum produto encontrado. Tente outro termo.</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }

  if (total > lista.length) {
    resultsInfo.innerHTML = `Mostrando <strong>${lista.length}</strong> de <strong>${total}</strong> resultados encontrados. Refine sua busca para ver mais resultados.`;
    resultsInfo.className = "results-info results-info--alerta";
  } else {
    resultsInfo.innerText = `Mostrando ${lista.length} de ${total} resultados encontrados.`;
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
          <td class="col-sku">${destacar(item.sku, termos)}</td>
          <td class="col-ref">${destacar(item.referencia, termos)}</td>
          <td class="col-desc">${destacar(item.descricao, termos)}</td>
          <td class="col-tags">${tagsHtml}</td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}