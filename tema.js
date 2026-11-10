/* Tema claro/escuro. Carregado no <head> (antes de pintar a página) para não
   piscar branco. O claro é o padrão; a escolha fica guardada neste navegador. */
(function () {
  const CHAVE = "cbs_tema";
  const raiz = document.documentElement;
  let tema = "claro";
  try { tema = localStorage.getItem(CHAVE) === "escuro" ? "escuro" : "claro"; } catch (_) {}

  // logotipo roxo vira a versão branca no escuro (marcado com data-logo no HTML)
  function trocarLogos() {
    document.querySelectorAll("img[data-logo]").forEach((img) => {
      if (!img.dataset.logoClaro) img.dataset.logoClaro = img.getAttribute("src");
      const alvo = tema === "escuro" ? img.dataset.logoClaro.replace(/-roxo-quadrado-laranja\.svg$/, "-branco.svg") : img.dataset.logoClaro;
      if (img.getAttribute("src") !== alvo) img.setAttribute("src", alvo);
    });
    document.querySelectorAll(".btn-tema").forEach((b) => {
      const escuro = tema === "escuro";
      b.setAttribute("aria-pressed", String(escuro));
      b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
      b.title = escuro ? "Tema claro" : "Tema escuro";
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.claro) meta.dataset.claro = meta.content;
      meta.content = tema === "escuro" ? "#10131b" : meta.dataset.claro;
    }
  }

  function aplicar(novo, salvar) {
    tema = novo === "escuro" ? "escuro" : "claro";
    if (tema === "escuro") raiz.setAttribute("data-tema", "escuro");
    else raiz.removeAttribute("data-tema");
    if (salvar) { try { localStorage.setItem(CHAVE, tema); } catch (_) {} }
    if (document.readyState !== "loading") trocarLogos();
  }

  aplicar(tema, false);
  document.addEventListener("DOMContentLoaded", () => {
    trocarLogos();
    document.addEventListener("click", (e) => {
      if (e.target.closest(".btn-tema")) aplicar(tema === "escuro" ? "claro" : "escuro", true);
    });
  });
  // outra aba trocou o tema
  window.addEventListener("storage", (e) => { if (e.key === CHAVE) aplicar(e.newValue === "escuro" ? "escuro" : "claro", false); });

  window.CBSTema = { atual: () => tema, definir: (t) => aplicar(t, true) };
})();
