/* ==========================================================================
   Leitor/gerador de Excel (SheetJS, em vendor/): carregado só quando alguém precisa
   (exportar a busca, baixar a cotação, ler a Lista Diária).
   ========================================================================== */
const URL_SHEETJS = new URL("../../vendor/xlsx.full.min.js", import.meta.url).href;
let carregando = null;

/** Garante window.XLSX. mensagemErro = texto mostrado se o arquivo não carregar (sem internet). */
export function carregarSheetJs(mensagemErro = "Não conseguimos carregar o gerador de Excel. Verifique a conexão.") {
  if (window.XLSX) return Promise.resolve();
  if (!carregando) {
    carregando = new Promise((resolver, rejeitar) => {
      const s = document.createElement("script");
      s.src = URL_SHEETJS;
      s.onload = () => resolver();
      s.onerror = () => {
        carregando = null;
        s.remove();
        rejeitar(new Error(mensagemErro));
      };
      document.head.appendChild(s);
    });
  }
  return carregando;
}
