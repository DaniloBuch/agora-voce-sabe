/* Botão + da cotação na tabela, contador no cabeçalho e aviso rápido (cotacao-store.js guarda a lista). */
import { escaparHtml } from "../comum/texto.js";
import { tbody } from "./dom.js";
import { copiarTexto } from "../comum/copiar.js";
import { registrarBuscaAtual } from "./historico.js";
import { E } from "./estado.js";

/* ---------- Lista de cotação (cotacao-store.js + página /cotacao/) ---------- */

const ICONE_ADD_COTACAO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';

const ICONE_NA_COTACAO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

const cotacao = window.CBSCotacao;

function htmlBotaoCotacao(item, marcado) {
  const acao = marcado ? "Tirar da cotação" : "Adicionar à cotação (e copiar o código)";
  return `<button type="button" class="cot-btn${marcado ? " is-marcado" : ""}" data-cot="${escaparHtml(item.sku)}" aria-pressed="${marcado}" ` +
    `title="${acao}" aria-label="${acao}: ${escaparHtml(item.sku)} ${escaparHtml(item.descricao)}">${marcado ? ICONE_NA_COTACAO : ICONE_ADD_COTACAO}</button>`;
}

export function celulaCotacao(item) {
  return `<td class="col-cot">${cotacao ? htmlBotaoCotacao(item, cotacao.tem(item.sku)) : ""}</td>`;
}

const contadorCotacao = document.getElementById("contadorCotacao");

const avisoCotacao = document.getElementById("avisoCotacao");

let timeoutAvisoCotacao = null;

let ultimoContadorCotacao = null;

function animar(el, classe = "pulou") {
  if (!el) return;
  el.classList.remove(classe);
  void el.offsetWidth; // reinicia a animação
  el.classList.add(classe);
  el.addEventListener("animationend", () => el.classList.remove(classe), { once: true });
}

function atualizarContadorCotacao() {
  const n = cotacao ? cotacao.quantidade() : 0;
  if (ultimoContadorCotacao !== null && n > ultimoContadorCotacao) requestAnimationFrame(() => animar(contadorCotacao));
  ultimoContadorCotacao = n;
  contadorCotacao.textContent = String(n);
  contadorCotacao.hidden = n === 0;
  document.getElementById("linkCotacao").setAttribute("aria-label", n ? `Ver a cotação (${n} ${n === 1 ? "item" : "itens"})` : "Ver a cotação (vazia)");
}

function mostrarAvisoCotacao(texto) {
  avisoCotacao.innerHTML = `<span>${texto}</span><a href="cotacao/">Ver cotação</a>`;
  avisoCotacao.hidden = false;
  clearTimeout(timeoutAvisoCotacao);
  timeoutAvisoCotacao = setTimeout(() => (avisoCotacao.hidden = true), 3500);
}

// redesenha só os botões da cotação (ex.: a cotação mudou em outra aba ou foi limpa)
function sincronizarBotoesCotacao() {
  tbody.querySelectorAll("button.cot-btn").forEach((btn) => {
    const item = E.database.find((i) => i.sku === btn.dataset.cot);
    if (item) btn.outerHTML = htmlBotaoCotacao(item, cotacao.tem(item.sku));
  });
  atualizarContadorCotacao();
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  if (cotacao) {
    cotacao.aoMudar(sincronizarBotoesCotacao);
    atualizarContadorCotacao();
    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button.cot-btn");
      if (!btn) return;
      const sku = btn.dataset.cot;
      const item = E.database.find((i) => i.sku === sku);
      if (!item) return;
      if (cotacao.tem(sku)) {
        cotacao.remover(sku);
        mostrarAvisoCotacao(`<strong>${escaparHtml(sku)}</strong> saiu da cotação.`);
      } else {
        // o preço campanha da Lista Diária (se carregada) entra como sugestão de valor unitário
        const v = window.ListaDiaria && window.ListaDiaria.ativa() ? window.ListaDiaria.obter(sku) : null;
        const copia = copiarTexto(sku); // adicionar também copia o código (para colar no Protheus, e-mail...)
        cotacao.adicionar({ sku, descricao: item.descricao, referencia: item.referencia, um: item.unidade, preco: v ? v.preco : null });
        registrarBuscaAtual();
        const n = cotacao.quantidade();
        const copiou = await copia;
        mostrarAvisoCotacao(`<strong>${escaparHtml(sku)}</strong> adicionado à cotação${copiou ? " e código copiado" : ""} (${n} ${n === 1 ? "item" : "itens"}).`);
      }
      const novo = tbody.querySelector(`button.cot-btn[data-cot="${CSS.escape(sku)}"]`);
      if (novo) {
        novo.focus();
        if (cotacao.tem(sku)) animar(novo);
      }
    });
  }
}
