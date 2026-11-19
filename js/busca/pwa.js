/* App instalável (PWA): registra o service worker e cuida do botão Instalar/Abrir o app. */
import { parametrosDaBusca } from "./endereco.js";



/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  /* ---------- App instalável (PWA) ---------- */

  // Guarda o site para abrir rápido e funcionar sem internet (sw.js)
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // Botão do app no cabeçalho:
  //   Chrome/Edge, app ainda não instalado -> "Instalar app" (janela de instalação do navegador)
  //   Chrome/Edge, app já instalado        -> "Abrir o app" (abre o app pelo protocolo web+agoravocesabe:,
  //                                           já com a busca que está na tela)
  //   Firefox no computador                -> "Instalar app" abre uma ajuda: abrir no Edge e instalar por lá
  //   Dentro do próprio app                -> some
  (function botaoApp() {
    const botao = document.getElementById("btnInstalar");
    const rotulo = botao && botao.querySelector(".site-header__instalar-rotulo");
    const ajuda = document.getElementById("instalarAjuda");
    if (!botao) return;
    const CHAVE = "cbs_app_instalado";
    const marcar = (sim) => { try { sim ? localStorage.setItem(CHAVE, "1") : localStorage.removeItem(CHAVE); } catch (_) {} };
    const marcado = () => { try { return localStorage.getItem(CHAVE) === "1"; } catch (_) { return false; } };
    const dentroDoApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const firefoxPC = /firefox/i.test(navigator.userAgent) && !/android|mobi/i.test(navigator.userAgent);
    let pedido = null;
    let modo = ""; // "instalar" | "abrir" | "ajuda"

    function mostrar(novo) {
      modo = novo;
      botao.hidden = !novo;
      if (!novo) return;
      const abrir = novo === "abrir";
      rotulo.textContent = abrir ? "Abrir o app" : "Instalar app";
      botao.title = abrir
        ? "Abrir o Agora Você Sabe no app instalado neste computador"
        : "Instalar o Agora Você Sabe como app neste computador";
      botao.classList.toggle("site-header__instalar--abrir", abrir);
      botao.setAttribute("aria-haspopup", novo === "ajuda" ? "dialog" : "false");
    }

    if (dentroDoApp) {
      marcar(true); // usado como app: este navegador tem o app instalado
      return;
    }
    if (firefoxPC) {
      mostrar("ajuda");
    } else if (marcado()) {
      mostrar("abrir");
    }

    // O navegador só oferece instalar quando o app NÃO está instalado (inclusive se a pessoa desinstalou)
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      pedido = e;
      marcar(false);
      mostrar("instalar");
    });
    window.addEventListener("appinstalled", () => {
      pedido = null;
      marcar(true);
      mostrar("abrir");
    });
    // Chrome/Edge que sabem dizer se o app está instalado (mesmo sem o aviso acima)
    if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps()
        .then((apps) => { if (apps.length && !pedido) { marcar(true); mostrar("abrir"); } })
        .catch(() => {});
    }

    function linkDoApp() {
      const params = typeof parametrosDaBusca === "function" ? parametrosDaBusca() : "";
      return `web+agoravocesabe:${encodeURIComponent(params)}`;
    }
    document.getElementById("abrirAppFirefox").addEventListener("click", (e) => {
      e.currentTarget.href = linkDoApp();
    });

    function fecharAjuda() {
      ajuda.hidden = true;
      botao.setAttribute("aria-expanded", "false");
    }
    document.addEventListener("click", (e) => { if (!ajuda.hidden && !e.target.closest(".instalar-wrap")) fecharAjuda(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ajuda.hidden) { fecharAjuda(); botao.focus(); } });

    botao.addEventListener("click", async () => {
      if (modo === "instalar" && pedido) {
        pedido.prompt();
        try {
          const escolha = await pedido.userChoice;
          if (escolha && escolha.outcome === "accepted") { pedido = null; marcar(true); mostrar("abrir"); }
        } catch (_) {}
      } else if (modo === "abrir") {
        window.location.href = linkDoApp(); // o Windows abre o app instalado (Edge/Chrome)
      } else if (modo === "ajuda") {
        const abrir = ajuda.hidden;
        ajuda.hidden = !abrir;
        botao.setAttribute("aria-expanded", String(abrir));
        if (abrir) document.getElementById("abrirNoEdge").focus();
      }
    });
  })();
}
