/* Campo de busca: digitar (com espera de 300 ms) e o X vermelho para limpar. */
import { input } from "./dom.js";
import { cancelarRegistroHistorico, fecharHistorico, abrirHistorico, agendarRegistroHistorico } from "./historico.js";
import { mostrarHome, mostrarBusca } from "./vista.js";
import { atualizarEndereco } from "./endereco.js";
import { executarBusca } from "./tabela.js";
import { E, temFiltro } from "./estado.js";

/* ---------- X vermelho: limpar a busca ---------- */

export const botaoLimparBusca = document.getElementById("limparBusca");

export function atualizarBotaoLimpar() {
  botaoLimparBusca.hidden = input.value === "";
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  input.addEventListener("input", function (e) {
    const termo = e.target.value.trim();

    clearTimeout(E.timeoutBusca);
    cancelarRegistroHistorico();
    if (termo) {
      E.modoExplorar = false; // digitou: volta para a busca normal
      fecharHistorico();
    }

    if (termo === "" && !temFiltro()) {
      mostrarHome();
      atualizarEndereco();
      abrirHistorico(); // campo limpo: mostra as buscas recentes (como no Google)
      return;
    }
    mostrarBusca();

    // Debounce
    E.timeoutBusca = setTimeout(() => {
      executarBusca(termo);
      atualizarEndereco();
      agendarRegistroHistorico();
    }, 300);
  });

  input.addEventListener("input", atualizarBotaoLimpar);

  botaoLimparBusca.addEventListener("mousedown", (e) => e.preventDefault()); // o campo não perde o foco

  botaoLimparBusca.addEventListener("click", () => {
    input.value = "";
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true })); // volta ao início (ou à categoria) e mostra as buscas recentes
  });
}
