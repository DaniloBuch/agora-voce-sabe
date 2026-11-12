/* Carga da base: Supabase -> cópia do aparelho (offline) -> db.json; sinônimos e áreas.
   Prepara os produtos para o motor e mostra a busca do link (ou a home) quando termina. */
import * as baseOffline from "../comum/base-offline.js";
import { motor, E, temFiltro } from "./estado.js";
import { formatarRef, ordemTexto } from "../comum/texto.js";
import { prepararItem } from "./motor.js";
import { montarAreas, montarCategorias, esconderCategorias } from "./gaveta.js";
import { contarAte, montarDestaques } from "./home.js";
import { heroCards, input, resultsContainer } from "./dom.js";
import { mostrarBusca, mostrarHome } from "./vista.js";
import { executarBusca, renderizarPagina } from "./tabela.js";
import { atualizarEndereco } from "./endereco.js";
import { verificarLinksSite } from "./site.js";

// URL do seu JSON
const DATA_URL = "./db.json";

/* ---------- Carga dos dados ---------- */

async function lerDb() {
  // 1) Banco (Supabase), se configurado; 2) cópia guardada neste aparelho; 3) db.json como plano B.
  if (window.CBS_API && CBS_API.configurado) {
    try {
      const dados = await CBS_API.listarProdutos();
      baseOffline.salvar("produtos", { em: Date.now(), dados }); // sem esperar: não atrasa a busca
      return { dados, contingencia: false };
    } catch (erro) {
      const salvo = await baseOffline.ler("produtos");
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
    baseOffline.salvar("sinonimos", grupos);
    return grupos;
  } catch (_) {
    return (await baseOffline.ler("sinonimos")) || []; // offline: os sinônimos da última vez
  }
}

// Áreas de atuação cadastradas no painel (nome + ícone). Offline: as da última vez.
async function lerAreas() {
  if (!window.CBS_API || !CBS_API.configurado || !CBS_API.listarAreas) return [];
  try {
    const areas = await CBS_API.listarAreas();
    if (areas.length) baseOffline.salvar("areas", areas);
    return areas;
  } catch (_) {
    return (await baseOffline.ler("areas")) || [];
  }
}

async function carregarDados() {
  const infoNumero = document.getElementById("infoBaseNumero");
  const infoTexto = document.getElementById("infoBaseTexto");
  try {
    const [{ dados: dadosBrutos, contingencia, salvoEm }, grupos, areasCadastradas] = await Promise.all([lerDb(), lerSinonimos(), lerAreas()]);
    motor.definirSinonimos(grupos);

    E.database = dadosBrutos
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
          unidade: String(item.unidade ?? "").trim().toUpperCase(), // UM; "" = não informada
          areas: Array.isArray(item.areas) ? item.areas.map((a) => String(a).trim()).filter(Boolean) : [],
          criadoEm: item.criado_em ? Date.parse(item.criado_em) : null,
          tags: tagsArray,
          ...prepararItem({ sku, descricao, referencia: referenciaOriginal, tags: tagsArray }),
        };
      });
    // posição de cada produto em ordem alfabética (navegar pelo catálogo / por categoria)
    [...E.database]
      .sort((a, b) => ordemTexto.compare(a.descricao, b.descricao) || ordemTexto.compare(a.sku, b.sku))
      .forEach((item, i) => (item._alfa = i));
    motor.definirBase(E.database);
    E.carregado = true;
    console.log("Sistema CBS Online. Itens:", E.database.length);
    montarAreas(areasCadastradas);
    montarCategorias();

    // Atualiza o painel com o número real
    contarAte(infoNumero, E.database.length);
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
    if (termo || temFiltro() || E.modoExplorar) {
      if (!termo && !temFiltro()) E.modoExplorar = true;
      mostrarBusca();
      executarBusca(termo, E.paginaDoLink);
      atualizarEndereco();
    } else {
      mostrarHome(); // link com categoria que não existe mais: volta para o início
    }
    E.paginaDoLink = 1;
  } catch (erro) {
    console.error("Erro Fatal:", erro);
    E.erroCarga = true;
    esconderCategorias();
    infoNumero.textContent = "";
    infoTexto.textContent = "Não conseguimos carregar a base de produtos. Tente novamente em instantes.";
    infoTexto.classList.add("is-erro");
    document.getElementById("btnExplorar").hidden = true;
    if (input.value.trim()) executarBusca(input.value.trim());
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  carregarDados().then(() => E.carregado && verificarLinksSite());

  // A Lista Diária (lista-diaria.js) precisa saber quais códigos existem no catálogo
  window.CBS_skusCatalogo = () => E.database.map((item) => item.sku);

  // Quando a Lista Diária é carregada, atualizada, removida ou expira, redesenha a página atual
  window.addEventListener("listadiaria:mudou", () => {
    if (E.carregado && E.estadoLista && resultsContainer.style.display === "block") renderizarPagina();
  });
}
