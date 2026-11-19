/* Atalho "/": vai para a busca de qualquer lugar da página. */
import { caixaCategorias, input } from "./dom.js";
import { definirGavetaAberta } from "./gaveta.js";



/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
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
}
