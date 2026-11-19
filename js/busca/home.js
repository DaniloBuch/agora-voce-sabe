/* Home: contador animado, exemplos "digitados" no campo, "Você sabia?" e "Nesta semana". */
import { fmtNum } from "../comum/numeros.js";
import { input, PLACEHOLDER_PADRAO } from "./dom.js";
import { escaparHtml } from "../comum/texto.js";
import { atualizarBotaoLimpar } from "./campo.js";
import { E, temFiltro } from "./estado.js";

/* ==========================================================================
   Home: números que contam, exemplos no campo de busca, "Você sabia?" e
   "Nesta semana". Tudo some/fica parado com "reduzir movimento".
   ========================================================================== */
const semMovimento = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

// conta de 0 até o valor (desacelerando no fim)
export function contarAte(el, alvo, ms = 700) {
  if (!el) return;
  if (semMovimento() || !alvo) {
    el.textContent = fmtNum.format(alvo);
    return;
  }
  const ini = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - ini) / ms);
    el.textContent = fmtNum.format(Math.round(alvo * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/* --- "Você sabia?": um produto e os outros nomes dele --- */
let sabiaAtual = null;

function sortearSabia() {
  const comNomes = E.database.filter((p) => p.tags.length >= 2);
  if (!comNomes.length) return null;
  let p;
  for (let t = 0; t < 5; t++) {
    p = comNomes[Math.floor(Math.random() * comNomes.length)];
    if (!sabiaAtual || p.sku !== sabiaAtual.sku) break;
  }
  return p;
}

function desenharSabia(animar) {
  const caixa = document.getElementById("sabia");
  const texto = document.getElementById("sabiaTexto");
  sabiaAtual = sortearSabia();
  if (!sabiaAtual) {
    caixa.hidden = true;
    return;
  }
  const nomes = sabiaAtual.tags.slice(0, 4).map((t) => `<strong>${escaparHtml(t)}</strong>`);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
  const html = `O produto <span class="sabia__produto">${escaparHtml(sabiaAtual.descricao)}</span> <span class="sabia__sku">(${escaparHtml(sabiaAtual.sku)})</span> também é conhecido como ${lista}.`;
  caixa.hidden = false;
  if (!animar || semMovimento()) {
    texto.innerHTML = html;
    return;
  }
  texto.classList.add("sabia__texto--saindo");
  setTimeout(() => {
    texto.innerHTML = html;
    texto.classList.remove("sabia__texto--saindo");
  }, 180);
}

/* --- "Nesta semana": novos, preços que mudaram (Lista Diária deste navegador) e removidos --- */
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

function desenharSemanaPrecos() {
  const el = document.getElementById("semPrecos");
  const rot = document.getElementById("semPrecosRotulo");
  const l = window.ListaDiaria;
  if (l && l.ativa() && l.comparadaCom && l.comparadaCom()) {
    contarAte(el, l.variacoes().length);
    rot.textContent = "preços mudaram";
  } else {
    el.textContent = "–";
    rot.textContent = l && l.ativa() ? "preços (sem lista anterior)" : "preços (carregue a lista)";
  }
}

export async function montarDestaques() {
  document.getElementById("destaques").hidden = false;
  desenharSabia(false);
  const desde = Date.now() - SEMANA_MS;
  contarAte(document.getElementById("semNovos"), E.database.filter((p) => p.criadoEm && p.criadoEm >= desde).length);
  desenharSemanaPrecos();
  const rem = window.CBS_API && CBS_API.configurado && CBS_API.produtosRemovidos ? await CBS_API.produtosRemovidos(7) : null;
  const elRem = document.getElementById("semRemovidos");
  if (rem === null) elRem.textContent = "–";
  else contarAte(elRem, rem.length);
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  // Campo de busca vazio: "digita" exemplos de busca no placeholder, bem rápido, e apaga.
  // O foco automático ao abrir a página não conta: os exemplos continuam até a pessoa digitar, clicar
  // no campo ou voltar a ele depois de sair (foco proposital). Não roda com filtro nem com "reduzir movimento".
  (function exemplosNoCampo() {
    const EXEMPLOS = [
      "Jelco 22", "sonda uretral 12", "luva procedimento -latex", "Transofix", "000437",
      "esfigmomanômetro", "scalp 21", "seringa 10ml", "cabo bisturi n4", "Polifix",
      "gaze estéril", "equipo macrogotas", "\"luva cirúrgica\" 7,5", "Aeropuff", "atadura crepe",
      "abaixador de língua", "Zobec", "aparelho de pressão", "cateter 24", "fio nylon 3-0",
    ];
    const PREFIXO = "Ex.: ";
    const DIGITA_MS = 38; // por letra
    const APAGA_MS = 16;
    const PAUSA_MS = 1600; // exemplo pronto na tela
    const DESCANSO_MS = 2600; // texto normal entre um exemplo e outro
    let timer = null;
    let ordem = [];
    let interagiu = false; // a pessoa já clicou ou usou o teclado na página?
    let focoAutomatico = false; // o campo está com o foco que o navegador deu ao abrir (autofocus)
    const marcarInteracao = () => { interagiu = true; };
    document.addEventListener("pointerdown", marcarInteracao, { capture: true, once: true });
    document.addEventListener("keydown", marcarInteracao, { capture: true, once: true });
    if (document.activeElement === input) focoAutomatico = true;

    const podeAnimar = () =>
      !semMovimento() && !document.hidden && !input.value && !temFiltro() && (document.activeElement !== input || focoAutomatico);
    function proximo() {
      if (!ordem.length) ordem = [...EXEMPLOS].sort(() => Math.random() - 0.5); // embaralha a cada rodada
      return PREFIXO + ordem.pop();
    }
    function parar() {
      clearTimeout(timer);
      timer = null;
      if (!temFiltro() && input.placeholder !== PLACEHOLDER_PADRAO) input.placeholder = PLACEHOLDER_PADRAO;
    }
    function agendar(fn, ms) {
      timer = setTimeout(() => (podeAnimar() ? fn() : (parar(), agendar(comecar, DESCANSO_MS))), ms);
    }
    function digitar(texto, n) {
      input.placeholder = texto.slice(0, n) + (n < texto.length ? "▏" : "");
      if (n < texto.length) agendar(() => digitar(texto, n + 1), DIGITA_MS);
      else agendar(() => apagar(texto, texto.length), PAUSA_MS);
    }
    function apagar(texto, n) {
      if (n <= PREFIXO.length) {
        input.placeholder = PLACEHOLDER_PADRAO;
        agendar(comecar, DESCANSO_MS);
        return;
      }
      input.placeholder = texto.slice(0, n - 1) + "▏";
      agendar(() => apagar(texto, n - 1), APAGA_MS);
    }
    function comecar() {
      digitar(proximo(), PREFIXO.length);
    }
    input.addEventListener("focus", () => {
      if (!interagiu) { focoAutomatico = true; return; } // foco do autofocus: segue digitando
      focoAutomatico = false;
      parar();
    });
    input.addEventListener("pointerdown", () => { focoAutomatico = false; parar(); }); // clicou no campo: para
    input.addEventListener("input", () => { focoAutomatico = false; parar(); });
    input.addEventListener("blur", () => {
      focoAutomatico = false; // daqui em diante, voltar ao campo é proposital
      if (!timer) agendar(comecar, DESCANSO_MS); // fora do campo: volta a mostrar exemplos
    });
    agendar(comecar, DESCANSO_MS);
  })();

  document.getElementById("sabiaOutro").addEventListener("click", () => desenharSabia(true));

  document.getElementById("sabiaVer").addEventListener("click", () => {
    if (!sabiaAtual) return;
    input.value = sabiaAtual.sku;
    atualizarBotaoLimpar();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });

  window.addEventListener("listadiaria:mudou", () => {
    if (E.carregado) desenharSemanaPrecos();
  });
}
