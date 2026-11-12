/* Buscas recentes (só neste navegador) e o teclado do campo de busca
   (setas, Enter confirma, Esc fecha o histórico ou limpa). */
import { normalizar, escaparHtml } from "../comum/texto.js";
import { input } from "./dom.js";
import { atualizarBotaoLimpar, botaoLimparBusca } from "./campo.js";
import { renderizarCategorias } from "./gaveta.js";
import { mostrarBusca } from "./vista.js";
import { executarBusca } from "./tabela.js";
import { atualizarEndereco } from "./endereco.js";
import { E } from "./estado.js";

const historicoCaixa = document.getElementById("historico");

const historicoLista = document.getElementById("historicoLista");

/* ---------- Histórico de buscas (só neste navegador) ---------- */

const CHAVE_HISTORICO = "cbs_historico_busca_v1";

const MAX_HISTORICO = 8;

const ESPERA_HISTORICO_MS = 2500; // parou de digitar por 2,5 s com resultados: conta como busca feita

const JANELA_DIGITACAO_MS = 2 * 60 * 1000;

let timeoutHistorico = null;

let historicoAtivo = -1; // item destacado com as setas

function obterHistorico() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_HISTORICO));
    return Array.isArray(lista) ? lista.filter((h) => h && typeof h.q === "string" && h.q.trim()) : [];
  } catch (_) {
    return [];
  }
}

function gravarHistorico(lista) {
  try {
    if (lista.length) localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(lista));
    else localStorage.removeItem(CHAVE_HISTORICO);
  } catch (_) {}
}

function salvarNoHistorico(termo, categoria = "") {
  const q = String(termo ?? "").replace(/\s+/g, " ").trim();
  if (!q) return;
  const chave = normalizar(q);
  const agora = Date.now();
  const lista = obterHistorico().filter((h) => {
    if ((h.cat || "") !== categoria) return true;
    const hq = normalizar(h.q);
    if (hq === chave) return false; // repetida: sobe para o topo
    // "sond" salvo há pouco e agora "sonda 12": era a mesma busca ainda sendo digitada
    return !(chave.startsWith(hq) && agora - (h.em || 0) < JANELA_DIGITACAO_MS);
  });
  lista.unshift({ q, cat: categoria, em: agora });
  gravarHistorico(lista.slice(0, MAX_HISTORICO));
}

const buscaTemResultado = () => Boolean(E.estadoLista && E.estadoLista.itens.length > 0 && E.estadoLista.modo === "busca");

export function registrarBuscaAtual() {
  cancelarRegistroHistorico();
  const termo = input.value.trim();
  if (termo && buscaTemResultado()) salvarNoHistorico(termo, E.categoriaAtual);
}

export function agendarRegistroHistorico() {
  cancelarRegistroHistorico();
  const termo = input.value.trim();
  if (!termo || !buscaTemResultado()) return;
  timeoutHistorico = setTimeout(() => {
    if (input.value.trim() === termo) registrarBuscaAtual();
  }, ESPERA_HISTORICO_MS);
}

export function cancelarRegistroHistorico() {
  clearTimeout(timeoutHistorico);
}

const ICONE_RELOGIO =
  '<svg class="historico__icone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>';

export function abrirHistorico() {
  const lista = obterHistorico();
  if (!lista.length || input.value.trim() || document.activeElement !== input) {
    fecharHistorico();
    return;
  }
  historicoAtivo = -1;
  historicoLista.innerHTML = lista
    .map(
      (h, i) =>
        `<li class="historico__item" role="option" id="hist-${i}" data-i="${i}" aria-selected="false">` +
        `${ICONE_RELOGIO}<span class="historico__texto">${escaparHtml(h.q)}</span>` +
        (h.cat ? `<span class="historico__cat">em ${escaparHtml(h.cat)}</span>` : "") +
        `<button type="button" class="historico__remover" data-remover="${i}" tabindex="-1" aria-label="Remover ${escaparHtml(h.q)} do histórico" title="Remover do histórico">` +
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></li>`,
    )
    .join("");
  historicoCaixa.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

export function fecharHistorico() {
  historicoCaixa.hidden = true;
  historicoAtivo = -1;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function destacarHistorico(indice) {
  const itens = [...historicoLista.querySelectorAll(".historico__item")];
  if (!itens.length) return;
  historicoAtivo = (indice + itens.length) % itens.length;
  itens.forEach((li, i) => li.setAttribute("aria-selected", String(i === historicoAtivo)));
  input.setAttribute("aria-activedescendant", itens[historicoAtivo].id);
  itens[historicoAtivo].scrollIntoView({ block: "nearest" });
}

function usarHistorico(indice) {
  const h = obterHistorico()[indice];
  if (!h) return;
  fecharHistorico();
  input.value = h.q;
  atualizarBotaoLimpar();
  E.modoExplorar = false;
  // a categoria só volta se ainda existir
  E.categoriaAtual = h.cat && E.categoriasLista.some(([nome]) => nome === h.cat) ? h.cat : "";
  renderizarCategorias();
  clearTimeout(E.timeoutBusca);
  mostrarBusca();
  executarBusca(h.q);
  atualizarEndereco();
  if (buscaTemResultado()) salvarNoHistorico(h.q, E.categoriaAtual); // sobe para o topo
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  // Como no Google: o campo já abre com foco, mas o histórico só aparece quando a pessoa clica nele vazio ou aperta ↓
  input.addEventListener("click", () => {
    if (!input.value.trim() && historicoCaixa.hidden) abrirHistorico();
  });

  input.addEventListener("blur", fecharHistorico);

  input.addEventListener("keydown", (e) => {
    const aberto = !historicoCaixa.hidden;
    if (e.key === "ArrowDown") {
      if (!aberto && !input.value.trim()) abrirHistorico();
      if (!historicoCaixa.hidden) {
        e.preventDefault();
        destacarHistorico(historicoAtivo + 1);
      }
    } else if (e.key === "ArrowUp" && aberto) {
      e.preventDefault();
      destacarHistorico(historicoAtivo - 1);
    } else if (e.key === "Enter") {
      if (aberto && historicoAtivo >= 0) {
        e.preventDefault();
        usarHistorico(historicoAtivo);
      } else if (input.value.trim()) {
        // Enter confirma a busca na hora (sem esperar o debounce) e a guarda no histórico
        clearTimeout(E.timeoutBusca);
        mostrarBusca();
        executarBusca(input.value.trim());
        atualizarEndereco();
        registrarBuscaAtual();
      }
    } else if (e.key === "Escape" && aberto) {
      e.preventDefault();
      e.stopPropagation();
      fecharHistorico();
    } else if (e.key === "Escape" && input.value) {
      e.preventDefault();
      botaoLimparBusca.click(); // Esc limpa a busca (igual ao X vermelho)
    }
  });

  // clicar dentro da lista não tira o foco do campo
  historicoCaixa.addEventListener("mousedown", (e) => e.preventDefault());

  historicoLista.addEventListener("click", (e) => {
    const remover = e.target.closest("[data-remover]");
    if (remover) {
      const lista = obterHistorico();
      lista.splice(Number(remover.dataset.remover), 1);
      gravarHistorico(lista);
      abrirHistorico();
      return;
    }
    const item = e.target.closest(".historico__item");
    if (item) usarHistorico(Number(item.dataset.i));
  });

  document.getElementById("historicoLimpar").addEventListener("click", () => {
    gravarHistorico([]);
    fecharHistorico();
  });
}
