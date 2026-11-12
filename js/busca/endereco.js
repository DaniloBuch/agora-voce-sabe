/* Endereço da busca: copiar SKU/preço, copiar o link da busca, manter ?q=&cat=&p= atualizado
   e abrir a página já com a busca do link. */
import { tbody, input } from "./dom.js";
import { renderizarAreas, escolherCategoria } from "./gaveta.js";
import { copiarTexto } from "../comum/copiar.js";
import { registrarBuscaAtual } from "./historico.js";
import { parametrosIniciais, E, temFiltro } from "./estado.js";
import { atualizarBotaoLimpar } from "./campo.js";
import { mostrarBusca } from "./vista.js";
import { executarBusca } from "./tabela.js";

const btnLink = document.getElementById("btnLink");

/* ---------- Copiar SKU e link da busca ---------- */

function sinalizarCopiado(el, textoOriginal) {
  el.classList.add("copiado");
  if (textoOriginal) el.textContent = "Link copiado!";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove("copiado");
    if (textoOriginal) el.textContent = textoOriginal;
  }, 1500);
}

// Endereço da busca atual: ?cat=...&q=...&p=2 (ou ?ver=todos para o catálogo completo)
export function parametrosDaBusca() {
  const params = new URLSearchParams();
  if (E.categoriaAtual) params.set("cat", E.categoriaAtual);
  if (E.areaAtual) params.set("area", E.areaAtual);
  const termo = input.value.trim();
  if (termo) params.set("q", termo);
  if (E.modoExplorar && !termo && !temFiltro()) params.set("ver", "todos");
  if (E.ordemColuna && params.toString()) params.set("ord", `${E.ordemColuna.col}.${E.ordemColuna.dir === 1 ? "asc" : "desc"}`);
  if (E.estadoLista && E.paginaAtual > 1 && params.toString()) params.set("p", String(E.paginaAtual));
  return params.toString();
}

function linkDaBusca() {
  const params = parametrosDaBusca();
  return params ? `${location.origin}${location.pathname}?${params}` : "";
}

// Mantém o endereço da página igual à busca (dá para compartilhar ou recarregar)
export function atualizarEndereco() {
  const params = parametrosDaBusca();
  btnLink.hidden = params === "";
  try {
    history.replaceState(null, "", params ? `?${params}` : location.pathname);
  } catch (_) {}
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  tbody.addEventListener("click", async (e) => {
    if (e.target.closest("[data-limpar-categoria]")) {
      E.areaAtual = "";
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

  btnLink.addEventListener("click", async () => {
    const link = linkDaBusca();
    if (link && (await copiarTexto(link))) {
      sinalizarCopiado(btnLink, "Copiar link desta busca");
      registrarBuscaAtual();
    }
  });

  // Abre já com a busca do link (?q=..., ?cat=..., ?p=... ou ?ver=todos)
  (function buscaDoLink() {
    const q = parametrosIniciais.get("q");
    if (q && q.trim()) {
      input.value = q.trim();
      atualizarBotaoLimpar();
      E.modoExplorar = false;
      mostrarBusca();
      btnLink.hidden = false;
      executarBusca(q.trim(), E.paginaDoLink);
    } else if (E.categoriaDoLink || E.modoExplorar) {
      mostrarBusca();
      btnLink.hidden = false;
      executarBusca("");
    }
  })();
}
