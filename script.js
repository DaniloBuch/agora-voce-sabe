let database = [];
let timeoutBusca = null;

const input = document.getElementById("searchInput");
const heroCards = document.getElementById("heroCards");
const resultsContainer = document.getElementById("resultsContainer");
const resultsInfo = document.getElementById("resultsInfo");
const tbody = document.getElementById("tableBody");

// URL do seu JSON
const DATA_URL = "./db.json";

async function carregarDados() {
  try {
    const resposta = await fetch(DATA_URL);
    const dadosBrutos = await resposta.json();

    database = dadosBrutos.map((item) => {
      let tagsArray = [];
      if (item.tags && typeof item.tags === "string") {
        tagsArray = item.tags.split(",").map((tag) => tag.trim());
      } else if (Array.isArray(item.tags)) {
        tagsArray = item.tags;
      }

      return {
        sku: item.sku,
        descricao: item.descricao_tecnica || item.descricao,
        tags: tagsArray,
        _buscaFull: (
          (item.sku || "") +
          " " +
          (item.descricao_tecnica || item.descricao || "") +
          " " +
          tagsArray.join(" ")
        ).toLowerCase(),
      };
    });
    console.log("Sistema CBS Online. Itens:", database.length);

    // Atualiza o card com o numero real
    document.querySelector(".hero-cards .card:first-child p").innerText =
      `${database.length} produtos carregados`;
  } catch (erro) {
    console.error("Erro Fatal:", erro);
    alert("Erro de conexão com o banco de dados.");
  }
}

carregarDados();

input.addEventListener("input", function (e) {
  const termo = e.target.value.toLowerCase().trim();

  clearTimeout(timeoutBusca);

  // LOGICA DE ESTADO VISUAL
  if (termo === "") {
    // Estado: Home
    heroCards.style.display = "flex";
    setTimeout(() => (heroCards.style.opacity = "1"), 10); // Fade in
    resultsContainer.style.display = "none";
    return;
  } else {
    // Estado: Buscando
    heroCards.style.opacity = "0";
    setTimeout(() => (heroCards.style.display = "none"), 300); // Wait fade out
    resultsContainer.style.display = "block";
  }

  // Debounce
  timeoutBusca = setTimeout(() => {
    executarBusca(termo);
  }, 300);
});

function executarBusca(termo) {
  const termosBusca = termo.split(" ").filter((t) => t !== "");

  const resultados = database.filter((item) => {
    return termosBusca.every((t) => item._buscaFull.includes(t));
  });

  // Limita a 100 itens
  renderizarTabela(resultados.slice(0, 100), resultados.length);
}

function renderizarTabela(lista, total) {
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px; color: rgb(255, 1, 1);">Nenhum produto encontrado. Tente outro termo.</td></tr>`;
    resultsInfo.innerText = "";
    return;
  }

  if (lista.length * 1 > 99) {
    resultsInfo.innerHTML = `Mostrando <strong>100</strong> de <strong>${total}</strong> resultados encontrados. Refine sua busca para ver mais resultados.`;
    resultsInfo.style.color = "rgb(255, 1, 1)";
    resultsInfo.style.fontWeight = "bold";
    resultsInfo.style.fontSize = "14px";
  } else {
    resultsInfo.innerHTML = `Mostrando ${lista.length} de ${total} resultados encontrados.`;
    resultsInfo.style.color = "rgb(0, 0, 0)";
    resultsInfo.style.fontWeight = "normal";
    resultsInfo.style.fontSize = "12px";
  }

  const html = lista
    .map((item) => {
      let tagsHtml = "";

      // LÓGICA DO EMPTY STATE
      if (item.tags.length === 0) {
        tagsHtml = `<span class="tag-empty"></span>`;
      } else {
        // Se tiver, mostra até 6 tags, testando pra achar a quantidade ideal
        tagsHtml = item.tags
          .slice(0, 6)
          .map((tag) => `<span class="tag-pill">${tag}</span>`)
          .join("");
      }

      return `
                    <tr>
                        <td class="col-sku">${item.sku}</td>
                        <td class="col-desc">${item.descricao}</td>
                        <td class="col-tags">${tagsHtml}</td>
                    </tr>
                `;
    })
    .join("");

  tbody.innerHTML = html;
}
