/* Links do site oficial (aba Importar CSV): resumo e sincronização com o cbsmed.com.br. */
import { api, $, estado } from "./estado.js";
import { fmtNum as fmt, fmtDataHora as fmtData } from "../comum/numeros.js";
import { alerta, aviso } from "./util.js";
import { escaparHtml as esc } from "../comum/texto.js";

/* ---------------- Links do site oficial (aba Importar CSV) ---------------- */

// O navegador não pode ler a lista de produtos do site (o site não libera CORS), então quem lê
// é o Supabase, de servidor para servidor (migração 010). O painel só pede uma página por vez
// e mostra o progresso.
const MSG_FALTA_010 =
  "A sincronização ainda não está instalada no Supabase. Rode o arquivo supabase/migracoes/010_sincronizar_site.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

export async function mostrarResumoLinks() {
  try {
    const r = await api.resumoLinksSite();
    $("#infoLinksSite").textContent = r.total
      ? `${fmt.format(r.total)} produtos com endereço exato · última mudança em ${fmtData.format(new Date(r.ultima))} · sincroniza sozinho toda segunda-feira`
      : "Ainda não sincronizado: o endereço é montado pela descrição.";
  } catch (err) {
    $("#infoLinksSite").textContent = err.status === 404 ? "Falta rodar a migração 010 no Supabase." : "";
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#btnSincronizarSite").addEventListener("click", async () => {
    const btn = $("#btnSincronizarSite");
    const saida = $("#resultadoLinksSite");
    btn.disabled = true;
    saida.innerHTML = alerta("info", "O Supabase está lendo a lista de produtos do site... página 1");
    try {
      const primeira = await api.sincronizarPaginaSite(1);
      const total = Math.max(1, Number(primeira.total_paginas) || 1);
      let lidos = primeira.lidos;
      for (let p = 2; p <= total; p++) {
        saida.innerHTML = alerta("info", `O Supabase está lendo a lista de produtos do site... página ${fmt.format(p)} de ${fmt.format(total)}`);
        lidos += (await api.sincronizarPaginaSite(p)).lidos;
      }
      const r = await api.finalizarSincronizacaoSite(primeira.inicio);
      const fora = estado.produtos.length - r.total;
      saida.innerHTML = alerta(
        "ok",
        `<strong>${fmt.format(r.total)}</strong> produtos do catálogo têm página no site (o site listou ${fmt.format(lidos)}): ` +
          `<strong>${fmt.format(r.com_ficha)}</strong> com ficha técnica e <strong>${fmt.format(r.com_imagem)}</strong> com foto. ` +
          `${fmt.format(Math.max(fora, 0))} produto(s) do catálogo não estão no site: o botão Site deles abre a busca do site.` +
          (r.removidos ? ` ${fmt.format(r.removidos)} saíram do site desde a última sincronização.` : ""),
      );
      aviso("Links do site sincronizados. Valem para quem abrir ou recarregar a busca.");
      mostrarResumoLinks();
    } catch (err) {
      const semFuncao = err.status === 404 || /sincronizar_links_site_pagina|finalizar_links_site/.test(err.message || "");
      saida.innerHTML = alerta("erro", esc(semFuncao ? MSG_FALTA_010 : err.message) + " Nada foi apagado: os links da última sincronização continuam valendo.");
    } finally {
      btn.disabled = false;
    }
  });
}
