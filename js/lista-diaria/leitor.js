/* ==========================================================================
   Leitura do arquivo da Lista Diária (Excel ou CSV), no próprio navegador:
   acha a tabela com "Saldo disponível" e "Preço campanha", a coluna do código
   e devolve { mapa: sku -> { saldo, preco }, linhasLidas, foraDoCatalogo, aba }.
   O catálogo vem de window.CBS_skusCatalogo (cada página informa os seus códigos).
   ========================================================================== */
import { normalizar } from "../comum/texto.js";
import { lerNumeroBR } from "../comum/numeros.js";
import { carregarSheetJs } from "../comum/excel.js";
import { normalizarSku, decodificarTexto, detectarSeparador, lerCsv } from "../comum/csv.js";

const limpar = (t) => normalizar(t).replace(/[^a-z0-9]+/g, " ").trim();

const ehSaldo = (n) => n === "saldo disponivel" || n.startsWith("saldo disp");
const ehPreco = (n) => n === "preco campanha" || n.startsWith("preco camp") || n === "preco de campanha";
const ALIASES_SKU = ["codigo", "cod", "sku", "produto", "cod produto", "codigo produto", "codigo do produto", "cod prod", "item", "b1 cod"];

const ehCsv = (arquivo) => /\.(csv|txt)$/i.test(arquivo.name) || /csv|text\/plain/i.test(arquivo.type || "");

// Abas como [nome, linhas]: do Excel (pelo SheetJS) ou do CSV (leitor próprio)
async function lerAbas(arquivo) {
  const buffer = await arquivo.arrayBuffer();
  if (ehCsv(arquivo)) {
    const texto = decodificarTexto(buffer);
    const sep = detectarSeparador(texto);
    return { abas: [["CSV", lerCsv(texto, sep)]], pontoDecimal: sep === "," };
  }
  await carregarSheetJs("Não conseguimos carregar o leitor de Excel. Verifique a conexão e tente de novo.");
  const wb = window.XLSX.read(buffer, { type: "array" });
  return {
    abas: wb.SheetNames.map((nome) => [nome, window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false })]),
    pontoDecimal: false,
  };
}

/** Procura, em cada aba, a linha de cabeçalho que tem "Saldo disponível" e "Preço campanha". */
function localizarTabela(abas) {
  const vistos = [];
  for (const [nomeAba, linhas] of abas) {
    for (let i = 0; i < Math.min(linhas.length, 60); i++) {
      const nomes = linhas[i].map(limpar);
      const iSaldo = nomes.findIndex(ehSaldo);
      const iPreco = nomes.findIndex(ehPreco);
      if (iSaldo !== -1 && iPreco !== -1) return { linhas, cabecalho: nomes, linhaCab: i, iSaldo, iPreco, aba: nomeAba };
      if (iSaldo !== -1 || iPreco !== -1) vistos.push(`${nomeAba}: ${linhas[i].filter(Boolean).join(" | ")}`);
    }
  }
  const erro = new Error(
    'Não encontramos as colunas "Saldo disponível" e "Preço campanha" no arquivo. ' +
      (vistos.length ? `Cabeçalho parecido encontrado: ${vistos[0].slice(0, 160)}` : "Confira se é a Lista Diária correta."),
  );
  throw erro;
}

/** Escolhe a coluna do código do produto: pelo nome e, se preciso, pelo que bate com o catálogo. */
function escolherColunaSku(t, catalogo) {
  const dados = t.linhas.slice(t.linhaCab + 1, t.linhaCab + 1 + 800);
  const nCols = Math.max(t.cabecalho.length, ...dados.map((l) => l.length));
  const taxa = (c) => {
    let tem = 0, ok = 0;
    for (const l of dados) {
      const v = l[c];
      if (v === null || v === undefined || v === "") continue;
      tem++;
      if (catalogo.has(normalizarSku(v))) ok++;
    }
    return tem ? ok / tem : 0;
  };
  const porNome = t.cabecalho.findIndex((n) => ALIASES_SKU.includes(n));
  if (porNome !== -1 && taxa(porNome) >= 0.2) return porNome;
  let melhor = -1, melhorTaxa = 0.2;
  for (let c = 0; c < nCols; c++) {
    if (c === t.iSaldo || c === t.iPreco) continue;
    const x = taxa(c);
    if (x > melhorTaxa) { melhor = c; melhorTaxa = x; }
  }
  if (melhor !== -1) return melhor;
  throw new Error("Não encontramos a coluna com o código do produto (o código precisa ser o mesmo do catálogo, ex.: 000462).");
}

export async function lerLista(arquivo) {
  const catalogo = new Set((window.CBS_skusCatalogo ? window.CBS_skusCatalogo() : []).map(String));
  if (catalogo.size === 0) throw new Error("O catálogo ainda está carregando. Tente de novo em alguns segundos.");
  const leitura = await lerAbas(arquivo);
  const t = localizarTabela(leitura.abas);
  // CSV separado por vírgula: vale o padrão americano ("4.79"), a não ser que os números
  // venham entre aspas no padrão brasileiro ("4,79" / "1.234,5")
  const pontoDecimal =
    leitura.pontoDecimal &&
    !t.linhas.slice(t.linhaCab + 1).some((l) => [l[t.iSaldo], l[t.iPreco]].some((v) => typeof v === "string" && /^[^.]*\d,\d{1,4}$|\d\.\d{3},\d/.test(v.replace(/R\$|\s/g, ""))));
  const iSku = escolherColunaSku(t, catalogo);

  const mapa = new Map();
  let linhasLidas = 0;
  const foraDoCatalogo = new Set();
  for (const l of t.linhas.slice(t.linhaCab + 1)) {
    const bruto = l[iSku];
    if (bruto === null || bruto === undefined || bruto === "") continue;
    const sku = normalizarSku(bruto);
    const saldo = lerNumeroBR(l[t.iSaldo], pontoDecimal);
    const preco = lerNumeroBR(l[t.iPreco], pontoDecimal);
    if (saldo === null && preco === null) continue;
    linhasLidas++;
    if (!catalogo.has(sku)) { foraDoCatalogo.add(sku); continue; }
    const atual = mapa.get(sku);
    if (!atual) mapa.set(sku, { saldo, preco });
    else {
      // mesmo código em mais de uma linha (ex.: vários armazéns): soma o saldo; preço: o primeiro que existir
      if (saldo !== null) atual.saldo = (atual.saldo ?? 0) + saldo;
      if (!atual.preco && preco) atual.preco = preco;
    }
  }
  if (mapa.size === 0) throw new Error("Nenhum código da Lista Diária existe no catálogo. Confira se é o arquivo certo.");
  return { mapa, linhasLidas, foraDoCatalogo: foraDoCatalogo.size, aba: t.aba };
}
