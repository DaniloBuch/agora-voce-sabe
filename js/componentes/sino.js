import { escaparHtml as esc } from "../comum/texto.js";
import { fmtData } from "../comum/numeros.js";

/* ==========================================================================
   Sino de novidades (cabeçalho da busca, da cotação e da página de novidades).
   As mensagens são publicadas na aba "Novidades" do painel (tabela novidades).
   "Não lidas" = publicadas depois da última vez que a pessoa abriu o sino
   neste navegador (localStorage), como num aplicativo de mensagens.
   ========================================================================== */
(function () {
  const CHAVE_VISTO = "cbs_novidades_vistas"; // data (ms) da novidade mais nova já vista
  const raiz = document.getElementById("sino");
  if (!raiz) return;
  const botao = document.getElementById("sinoBotao");
  const painel = document.getElementById("sinoPainel");
  const lista = document.getElementById("sinoLista");
  const contador = document.getElementById("sinoContador");
  const fechar = document.getElementById("sinoFechar");

  let mensagens = [];
  let vistoAte = 0;
  try { vistoAte = Number(localStorage.getItem(CHAVE_VISTO)) || 0; } catch (_) {}

  const quando = (m) => Date.parse(m.publicado_em) || 0;
  const naoLidas = () => mensagens.filter((m) => quando(m) > vistoAte).length;

  function desenhar() {
    const n = naoLidas();
    contador.hidden = n === 0;
    contador.textContent = n > 9 ? "9+" : String(n);
    botao.classList.toggle("tem-novidade", n > 0);
    botao.setAttribute("aria-label", n ? `Novidades: ${n} não lida${n > 1 ? "s" : ""}` : "Novidades");
    lista.innerHTML = mensagens.length
      ? mensagens
          .map(
            (m) => `<li class="sino-item${quando(m) > vistoAte ? " sino-item--nova" : ""}">
              <p class="sino-item__data">${fmtData.format(new Date(quando(m)))}${quando(m) > vistoAte ? '<span class="sino-item__selo">nova</span>' : ""}</p>
              <p class="sino-item__titulo">${esc(m.titulo)}</p>
              ${m.texto ? `<p class="sino-item__texto">${esc(m.texto).replace(/\n/g, "<br>")}</p>` : ""}
            </li>`,
          )
          .join("")
      : `<li class="sino-vazio">Nenhuma novidade por enquanto.</li>`;
  }

  function abrir(aberto) {
    painel.hidden = !aberto;
    botao.setAttribute("aria-expanded", String(aberto));
    if (aberto) {
      desenhar(); // mostra o destaque "nova" desta vez...
      const maisNova = mensagens.reduce((mx, m) => Math.max(mx, quando(m)), 0);
      if (maisNova > vistoAte) {
        vistoAte = maisNova; // ...e já conta como lida para as próximas
        try { localStorage.setItem(CHAVE_VISTO, String(vistoAte)); } catch (_) {}
        contador.hidden = true;
        botao.classList.remove("tem-novidade");
        botao.setAttribute("aria-label", "Novidades");
      }
      painel.focus();
    } else {
      desenhar();
    }
  }

  botao.addEventListener("click", (e) => {
    e.stopPropagation();
    abrir(painel.hidden);
  });
  fechar.addEventListener("click", () => { abrir(false); botao.focus(); });
  document.addEventListener("click", (e) => { if (!painel.hidden && !raiz.contains(e.target)) abrir(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !painel.hidden) { abrir(false); botao.focus(); }
  });
  // outra aba abriu o sino: zera aqui também
  window.addEventListener("storage", (e) => {
    if (e.key === CHAVE_VISTO) { vistoAte = Number(e.newValue) || 0; desenhar(); }
  });

  async function carregar() {
    if (!window.CBS_API || !window.CBS_API.configurado || !window.CBS_API.listarNovidades) return;
    mensagens = await window.CBS_API.listarNovidades(20);
    desenhar();
  }
  desenhar();
  carregar();
})();
