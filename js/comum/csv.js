/* ==========================================================================
   Planilhas em texto (CSV) e códigos de produto: usados pela Lista Diária
   (e, depois, pela importação do painel).
   ========================================================================== */

// Código do produto como no catálogo: 462 / "462.0" (célula numérica do Excel) -> "000462"
export function normalizarSku(valor) {
  let s = String(valor ?? "").trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ""); // 462.0 vindo de célula numérica
  return /^\d+$/.test(s) && s.length < 6 ? s.padStart(6, "0") : s;
}

/* ---------- CSV: lido aqui mesmo, célula por célula como TEXTO ----------
   (o leitor de Excel interpreta "4,7983" no padrão americano e vira 47983) */

// UTF-8; se não for (CSV salvo pelo Excel no Windows), Windows-1252
export function decodificarTexto(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch (_) {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// Separador mais frequente nas primeiras linhas (fora de aspas): ";" (Excel Brasil), "," ou tab
export function detectarSeparador(texto) {
  const amostra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30).join("\n").replace(/"[^"]*"/g, "");
  const contagem = [";", ",", "\t"].map((sep) => [sep, amostra.split(sep).length - 1]);
  contagem.sort((a, b) => b[1] - a[1]);
  return contagem[0][1] > 0 ? contagem[0][0] : ";";
}

export function lerCsv(texto, sep) {
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((x) => x.trim() !== "")) linhas.push(linha.map((x) => (x.trim() === "" ? null : x.trim())));
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha.map((x) => (x.trim() === "" ? null : x.trim())));
  return linhas;
}
