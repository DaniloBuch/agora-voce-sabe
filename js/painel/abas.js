/* Troca de abas do painel. */
import { $ } from "./estado.js";
import { carregarHistorico } from "./historico.js";
import { renderizarTags } from "./tags.js";
import { renderizarCategorias } from "./categorias.js";
import { renderizarAreas } from "./areas.js";
import { carregarNovidades } from "./novidades.js";
import { carregarSinonimos } from "./sinonimos.js";
import { mostrarResumoLinks } from "./links-site.js";

/* ---------------- abas ---------------- */

export function mostrarAba(nome) {
  document.querySelectorAll(".aba").forEach((b) => {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle("ativa", ativa);
    b.setAttribute("aria-selected", String(ativa));
  });
  ["produtos", "categorias", "areas", "tags", "sinonimos", "novidades", "importar", "historico"].forEach((n) => {
    $(`#aba-${n}`).hidden = n !== nome;
  });
  if (nome === "historico") carregarHistorico();
  if (nome === "tags") renderizarTags();
  if (nome === "categorias") renderizarCategorias();
  if (nome === "areas") renderizarAreas();
  if (nome === "novidades") carregarNovidades();
  if (nome === "sinonimos") carregarSinonimos();
  if (nome === "importar") mostrarResumoLinks();
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  document.querySelectorAll(".aba").forEach((b) =>
    b.addEventListener("click", () => mostrarAba(b.dataset.aba)),
  );
}
