/* ==========================================================================
   Números e datas no padrão brasileiro: formatadores prontos e leitura de
   números digitados ou vindos de planilhas ("1.234,50", "R$ 4,79").
   ========================================================================== */

export const fmtNum = new Intl.NumberFormat("pt-BR"); // 1.234
export const fmt2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // 1.234,50
export const fmt4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); // 4,7900
export const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // 10,0
export const fmtQtd = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }); // 1,50 / 1,125
export const fmtSaldo = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }); // 3.500
export const fmtPreco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 }); // R$ 4,7900

export const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }); // 12/11/2026
export const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }); // 14:05
// Painel: sempre no horário de Brasília
export const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }); // 12/11
export const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }); // 12/11/2026, 14:05

// Diferença em reais com sinal: "−R$ 0,10" / "+R$ 0,0025" (4 casas quando é menos de 1 centavo)
export function formatarDifReais(dif) {
  const abs = Math.abs(dif);
  const casas = abs >= 0.01 ? 2 : 4;
  return `${dif < 0 ? "−" : "+"}R$ ${abs.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

/** "1.234,50" / "R$ 12,3" / "10" / 12.5 -> número; vazio ou inválido -> null.
    pontoDecimal = texto no padrão americano (CSV separado por vírgula): "4.798" é 4,798 e não 4798. */
export function lerNumeroBR(v, pontoDecimal = false) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/R\$|\s| /g, "");
  if (!t) return null;
  const virgula = t.includes(","), ponto = t.includes(".");
  if (virgula && ponto) {
    // o último separador é o decimal: "1.234,50" (Brasil) ou "1,234.50" (EUA)
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (virgula) t = t.replace(",", ".");
  else if (ponto && !pontoDecimal && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
