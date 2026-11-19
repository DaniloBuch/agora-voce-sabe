/* Abertura do painel: avisa se o Supabase não está configurado; senão mostra login ou painel. */
import { api, $ } from "./estado.js";
import { mostrarAdmin, mostrarLogin } from "./login.js";

/* ---------------- início ---------------- */

async function abrirPainel() {
  if (!api || !api.configurado) {
    $("#avisoConfig").hidden = false;
    $("#areaAdmin").hidden = false;
    document.body.classList.add("logado");
    document.querySelectorAll("#btnNovo, #arquivoCsv, #btnExportar, #btnExportarLeve").forEach((el) => (el.disabled = true));
    $("#infoLista").textContent = "Supabase não configurado.";
    return;
  }
  if (api.logado()) await mostrarAdmin();
  else mostrarLogin();
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  abrirPainel();
}
