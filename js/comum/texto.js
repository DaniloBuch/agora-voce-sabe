/* ==========================================================================
   Texto: normalizar para comparar, escapar para HTML/RegExp e formatar a referência.
   Usado pela busca, cotação, novidades, sino, Lista Diária e painel.
   ========================================================================== */

// Minúsculas e sem acentos: "Esfigmomanômetro" -> "esfigmomanometro"
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// Igual ao normalizar, mas com os espaços repetidos reduzidos a um só (e sem espaço nas pontas)
export function normalizarEspacos(texto) {
  return normalizar(texto).replace(/\s+/g, " ").trim();
}

// Referência: se for só número, mostra o valor sem zeros à esquerda
// ("000000000038833014" -> "38833014"); se tiver letras, mantém o texto ("AR420").
export function formatarRef(ref) {
  const texto = String(ref ?? "").trim();
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, "") : texto;
}

// Evita que <, >, & ou aspas nos dados quebrem (ou injetem) HTML
export function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Ordem alfabética em português, sem diferenciar maiúsculas/acentos e com números em ordem natural ("2" antes de "10")
export const ordemTexto = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
