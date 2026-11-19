/* Exportar CSV (backup completo e versão para categorizar). */
import { api, $ } from "./estado.js";
import { prepararProduto, aviso } from "./util.js";
import { fmtNum as fmt } from "../comum/numeros.js";

/* ---------------- exportar CSV (backup) ---------------- */

function campoCsv(valor) {
  const t = String(valor ?? "");
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

async function exportarCsv(botao, cabecalho, extrair, prefixoArquivo) {
  botao.disabled = true;
  try {
    // lê de novo do banco: o backup tem que refletir o que está lá agora
    const dados = (await api.listarProdutos()).map(prepararProduto);
    const linhas = [cabecalho];
    for (const p of dados) linhas.push(extrair(p).map(campoCsv).join(";"));
    // BOM para o Excel abrir os acentos corretamente
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${prefixoArquivo}-${hoje}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    aviso(`${fmt.format(dados.length)} produtos exportados.`);
  } catch (err) {
    aviso(err.message, true);
  } finally {
    botao.disabled = false;
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#btnExportar").addEventListener("click", () =>
    exportarCsv(
      $("#btnExportar"),
      "Codigo;Descricao;Cod prd forn;Categoria;Tags;Fixo;Areas;UM",
      (p) => [p.sku, p.descricao_tecnica, p.referencia, p.categoria, p.tags, p.fixo ? "sim" : "", p.areas.join(" | "), p.unidade],
      "cbs-produtos",
    ),
  );

  // Versão sem a referência: dá para editar no Excel sem risco de ele estragar o Cod prd forn
  $("#btnExportarLeve").addEventListener("click", () =>
    exportarCsv(
      $("#btnExportarLeve"),
      "Codigo;Descricao;Categoria;Tags;UM",
      (p) => [p.sku, p.descricao_tecnica, p.categoria, p.tags, p.unidade],
      "cbs-categorizar",
    ),
  );
}
