/* Troca entre a home (painel de boas-vindas) e a área de resultados. */
import { paginacao, resultsContainer, heroCards } from "./dom.js";
import { E } from "./estado.js";

let timeoutFade = null;

/* ---------- Estado visual (Home <-> Busca) ---------- */

export function mostrarHome() {
  clearTimeout(timeoutFade);
  E.modoExplorar = false;
  E.estadoLista = null;
  paginacao.hidden = true;
  resultsContainer.style.display = "none";
  heroCards.style.display = "";
  // pequeno atraso para a transição de opacidade acontecer
  timeoutFade = setTimeout(() => (heroCards.style.opacity = "1"), 10);
}

export function mostrarBusca() {
  clearTimeout(timeoutFade);
  heroCards.style.opacity = "0";
  timeoutFade = setTimeout(() => (heroCards.style.display = "none"), 300);
  resultsContainer.style.display = "block";
}
