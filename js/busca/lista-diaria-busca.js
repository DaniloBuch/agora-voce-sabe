/* Lista Diária na tabela da busca: células de saldo e preço campanha e a variação de preço.
   (O leitor da planilha fica em js/lista-diaria/.) */
import { fmtPct, formatarDifReais } from "../comum/numeros.js";
import { escaparHtml } from "../comum/texto.js";

// Células de saldo e preço vindas da Lista Diária (consulta local, nunca vão ao banco)
// Variação do preço campanha desde a lista anterior: "▼ 10,0% · −R$ 0,10" (verde caiu, vermelho subiu)
function htmlVariacao(sku) {
  const v = window.ListaDiaria && window.ListaDiaria.variacao ? window.ListaDiaria.variacao(sku) : null;
  if (!v) return "";
  const caiu = v.dif < 0;
  const quando = window.ListaDiaria.comparadaCom() ? new Date(window.ListaDiaria.comparadaCom()).toLocaleDateString("pt-BR") : "";
  const pct = `${caiu ? "−" : "+"}${fmtPct.format(Math.abs(v.pct))}%`;
  // na tela só a seta e o %; o resto aparece ao passar o mouse (e é lido pelo leitor de tela)
  const detalhe = `${caiu ? "Caiu" : "Subiu"} ${pct} (${formatarDifReais(v.dif)}). Antes: ${window.ListaDiaria.formatarPreco(v.anterior)}${quando ? `, na lista de ${quando}` : ""}`;
  return (
    `<span class="preco-var preco-var--${caiu ? "baixa" : "alta"}" title="${escaparHtml(detalhe)}">` +
    `<span aria-hidden="true">${caiu ? "▼" : "▲"} ${pct}</span><span class="sr-only">${escaparHtml(detalhe)}</span></span>`
  );
}

export function celulasLista(sku) {
  if (!window.ListaDiaria || !window.ListaDiaria.ativa()) return { colunas: "", resumoMobile: "" };
  const v = window.ListaDiaria.obter(sku);
  const saldo = v ? window.ListaDiaria.formatarSaldo(v.saldo) : null;
  const preco = v ? window.ListaDiaria.formatarPreco(v.preco) : null;
  const zero = v && v.saldo === 0;
  const saldoHtml = saldo === null ? `<span class="lista-nd" title="Não consta na Lista Diária">—</span>` : `<span class="${zero ? "saldo-zero" : "saldo-ok"}">${saldo}</span>`;
  // valor unitário clicável: copia só o número (ex.: 4,7983), igual ao SKU
  const valorCopia = v && v.preco ? v.preco.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "";
  const precoHtml = preco === null
    ? `<span class="lista-nd" title="Sem preço campanha na Lista Diária">—</span>`
    : `<button type="button" class="preco-camp preco-copiar" data-valor="${valorCopia}" title="Clique para copiar o valor unitário" aria-label="Copiar valor unitário ${valorCopia}">${preco}</button>`;
  const varHtml = htmlVariacao(sku);
  return {
    colunas: `<td class="col-lista col-saldo">${saldoHtml}</td><td class="col-lista col-preco">${precoHtml}${varHtml}</td>`,
    // no celular as colunas somem e o resumo aparece sob a descrição
    resumoMobile: `<span class="desc-extra">Saldo: ${saldoHtml} · Preço camp.: ${precoHtml}${varHtml}</span>`,
  };
}
