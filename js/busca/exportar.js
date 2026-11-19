/* Exportar o resultado da busca para Excel (SheetJS carregado só quando alguém pede). */
import { carregarSheetJs } from "../comum/excel.js";
import { input } from "./dom.js";
import { slugProduto, linkDoProduto } from "./site.js";
import { itensNaOrdem } from "./tabela.js";
import { registrarBuscaAtual } from "./historico.js";
import { E } from "./estado.js";

/* ---------- Exportar o resultado da busca para Excel ---------- */

export const btnExportar = document.getElementById("btnExportar");

function nomeArquivoExportacao() {
  const partes = [input.value.trim(), E.categoriaAtual, E.areaAtual, E.estadoLista && E.estadoLista.modo === "explorar" ? "catalogo-completo" : ""]
    .filter(Boolean)
    .join(" ");
  const base = slugProduto(partes).slice(0, 50) || "busca";
  const d = new Date();
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `agora-voce-sabe_${base}_${data}.xlsx`;
}

async function exportarParaExcel() {
  if (!E.estadoLista || !E.estadoLista.itens.length) return;
  const rotulo = btnExportar.lastChild;
  const textoOriginal = rotulo.textContent;
  btnExportar.disabled = true;
  rotulo.textContent = "Gerando...";
  try {
    await carregarSheetJs();
    const comLista = window.ListaDiaria && window.ListaDiaria.ativa();
    const temParecidos = E.estadoLista.itens.length > E.estadoLista.nExatos;
    const cab = ["SKU", "Descrição", "UM", "Referência", "Categoria", "Áreas de atuação", "Também conhecido por"];
    if (comLista) cab.push("Saldo (Lista Diária)", "Preço campanha (Lista Diária)");
    cab.push("Página no site");
    if (temParecidos) cab.push("Observação");
    const linhas = itensNaOrdem(E.estadoLista).map((item, i) => {
      const l = [item.sku, item.descricao, item.unidade, item.referencia, item.categoria === "-" ? "" : item.categoria, item.areas.join(", "), item.tags.join(", ")];
      if (comLista) {
        const v = window.ListaDiaria.obter(item.sku);
        l.push(v && v.saldo !== null && v.saldo !== undefined ? v.saldo : "", v && v.preco ? v.preco : "");
      }
      l.push(linkDoProduto(item).url);
      if (temParecidos) l.push(i >= E.estadoLista.nExatos ? "Parecido com a busca" : "");
      return l;
    });
    const ws = window.XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    // SKU e Referência como texto (o Excel não pode comer os zeros à esquerda); preço com 4 casas
    const ref = window.XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 1; r <= ref.e.r; r++) {
      for (const c of [0, cab.indexOf("Referência")]) {
        const cel = ws[window.XLSX.utils.encode_cell({ r, c })];
        if (cel) { cel.t = "s"; cel.v = String(cel.v); cel.z = "@"; }
      }
      if (comLista) {
        const saldo = ws[window.XLSX.utils.encode_cell({ r, c: cab.indexOf("Saldo (Lista Diária)") })];
        if (saldo && saldo.t === "n") saldo.z = "#,##0.##";
        const preco = ws[window.XLSX.utils.encode_cell({ r, c: cab.indexOf("Preço campanha (Lista Diária)") })];
        if (preco && preco.t === "n") preco.z = '"R$" #,##0.0000';
      }
    }
    ws["!cols"] = cab.map((c) => ({ wch: { SKU: 9, "Descrição": 62, "Referência": 20, Categoria: 24, "Áreas de atuação": 28, "Também conhecido por": 40, "Página no site": 60 }[c] || 18 }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    window.XLSX.writeFile(wb, nomeArquivoExportacao());
    registrarBuscaAtual();
  } catch (erro) {
    console.error(erro);
    rotulo.textContent = "Não deu para exportar";
    setTimeout(() => (rotulo.textContent = textoOriginal), 2500);
    return;
  } finally {
    btnExportar.disabled = false;
  }
  rotulo.textContent = textoOriginal;
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  btnExportar.addEventListener("click", exportarParaExcel);
}
