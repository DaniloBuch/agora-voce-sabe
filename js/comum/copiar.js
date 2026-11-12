/* ==========================================================================
   Área de transferência: copiar texto (código, link, valor) ou uma tabela
   (HTML + texto, para colar formatado no Word/e-mail/Excel). Com plano B para
   navegadores sem a API moderna. Devolvem true/false (copiou ou não).
   ========================================================================== */

export async function copiarTexto(texto) {
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

export async function copiarHtml(html, texto) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([texto], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch (_) {}
  // plano B: copia a tabela selecionando-a numa área escondida
  const area = document.createElement("div");
  area.innerHTML = html;
  area.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(area);
  const faixa = document.createRange();
  faixa.selectNodeContents(area);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(faixa);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) {}
  sel.removeAllRanges();
  area.remove();
  return ok;
}
