/* Funções puras dos utilitários (js/comum), testadas direto no Node, sem navegador. */
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("texto: normalizar, espaços, referência, HTML e RegExp", async () => {
  const t = await import("../js/comum/texto.js");
  assert.equal(t.normalizar("Esfigmomanômetro ÁGUA"), "esfigmomanometro agua");
  assert.equal(t.normalizar(null), "");
  assert.equal(t.normalizarEspacos("  Luva   de  LÁTEX "), "luva de latex");
  assert.equal(t.formatarRef("000000000038833014"), "38833014");
  assert.equal(t.formatarRef("0000"), "0");
  assert.equal(t.formatarRef(" AR420 "), "AR420");
  assert.equal(t.escaparHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(t.escaparRegex("c/100 (x)*"), "c/100 \\(x\\)\\*");
  assert.deepEqual(["item 10", "Item 2", "álcool"].sort(t.ordemTexto.compare), ["álcool", "Item 2", "item 10"]);
});

test("números: leitura no padrão brasileiro", async () => {
  const { lerNumeroBR } = await import("../js/comum/numeros.js");
  const casos = [
    ["1.234,50", 1234.5], ["R$ 4,79", 4.79], ["10", 10], ["2,5", 2.5], ["1.500", 1500], ["1.234.567", 1234567],
    ["1,234.50", 1234.5], ["4.7983", 4.7983], ["", null], [null, null], ["abc", null], [12.5, 12.5], [NaN, null], ["-3", -3], ["R$ 1,00", 1],
  ];
  for (const [entrada, esperado] of casos) assert.equal(lerNumeroBR(entrada), esperado, `lerNumeroBR(${JSON.stringify(entrada)})`);
  assert.equal(lerNumeroBR("4.798", true), 4.798, "CSV no padrão americano: ponto é decimal");
});

test("números: formatação", async () => {
  const n = await import("../js/comum/numeros.js");
  const esp = (s) => s.replace(/ /g, " ");
  assert.equal(n.fmtNum.format(1234), "1.234");
  assert.equal(n.fmt4.format(4.79), "4,7900");
  assert.equal(esp(n.fmtPreco.format(4.79)), "R$ 4,7900");
  assert.equal(n.formatarDifReais(-0.1), "−R$ 0,10");
  assert.equal(n.formatarDifReais(0.0025), "+R$ 0,0025");
  assert.equal(n.fmtData.format(new Date(2026, 10, 12)), "12/11/2026");
});

test("motor de busca: aspas, exclusão, sinônimos, conectivos, relevância e erro de digitação", async () => {
  const { criarMotor, prepararItem, destacar } = await import("../js/busca/motor.js");
  const dados = [
    { sku: "000437", descricao: "SONDA URETRAL N 12", referencia: "SU12", tags: ["Sonda de alívio"] },
    { sku: "000438", descricao: "SONDA FOLEY 2 VIAS N 14", referencia: "SF14" },
    { sku: "100001", descricao: "LUVA PROCEDIMENTO LATEX CX C/100", referencia: "LV1" },
    { sku: "100004", descricao: "LUVA PROCEDIMENTO NITRILICA CAIXA C/100", referencia: "LV4" },
    { sku: "002000", descricao: "CATETER INTRAVENOSO 20G", referencia: "000000000038833014", tags: ["Jelco"] },
    { sku: "005000", descricao: "CABO PARA BISTURI N 4", referencia: "CB4" },
  ];
  const itens = dados.map((d) => ({ sku: d.sku, ...prepararItem(d) }));
  const motor = criarMotor();
  motor.definirSinonimos([{ palavras: ["cx", "caixa"] }]);
  motor.definirBase(itens);
  const skus = (texto, op) => motor.buscar(itens, texto, op).itens.map((i) => i.sku);

  assert.deepEqual(skus("000437"), ["000437"]);
  assert.deepEqual(skus('"sonda uretral"'), ["000437"]);
  assert.deepEqual(skus("sonda -foley"), ["000437"]);
  assert.deepEqual(skus('sonda -"2 vias"'), ["000437"]);
  assert.deepEqual(skus("luva cx").sort(), ["100001", "100004"], "cx = caixa");
  assert.deepEqual(skus("cabo de bisturi"), ["005000"], "ignora o 'de'");
  assert.deepEqual(skus("38833014"), ["002000"], "referência sem zeros");
  assert.deepEqual(skus("jelco"), ["002000"], "apelido");
  assert.deepEqual(skus("sodna"), ["000437", "000438"], "corrige erro de digitação");
  assert.deepEqual(skus("sodna", { tolerancia: false }), [], "sem tolerância (painel)");
  assert.equal(motor.buscar(itens, "sodna").correcao.sugeridos[0], "sonda");
  assert.ok(motor.buscar(itens, "-luva").vazia, "só exclusão: quem chama decide a ordem");
  assert.equal(destacar("Sonda Uretral", ["sonda"]), "<mark>Sonda</mark> Uretral");
  assert.equal(destacar("000000000038833014", ["388"], 10), "<mark>388</mark>33014");
});

test("CSV e código do produto", async () => {
  const { normalizarSku, detectarSeparador, lerCsv } = await import("../js/comum/csv.js");
  assert.equal(normalizarSku(462), "000462");
  assert.equal(normalizarSku("462.0"), "000462");
  assert.equal(normalizarSku("AB12"), "AB12");
  assert.equal(detectarSeparador("Codigo;UM\n1;CX"), ";");
  assert.equal(detectarSeparador("a,b\n1,2"), ",");
  assert.deepEqual(lerCsv('Codigo;Descricao\n000437;"SONDA ""12"";X"\n\n;\n', ";"), [["Codigo", "Descricao"], ["000437", 'SONDA "12";X']]);
});

test("Lista Diária: data pelo nome do arquivo e variação de preço", async () => {
  const { dataDoNome, calcularVariacoes } = await import("../js/lista-diaria/armazenamento.js");
  assert.equal(dataDoNome("LISTA DIÁRIA 10-11-2026.xlsx"), new Date(2026, 10, 10).getTime());
  assert.equal(dataDoNome("lista_31_02_26.xlsx"), null, "data impossível");
  assert.equal(dataDoNome("lista.xlsx"), null);
  const itens = [["000437", 10, 4.79], ["000438", 5, 2], ["000439", 1, 0]];
  assert.deepEqual(calcularVariacoes(itens, { precos: [["000437", 5], ["000438", 2], ["000439", 3]] }), [["000437", 5]]);
  assert.deepEqual(calcularVariacoes(itens, null), []);
});
