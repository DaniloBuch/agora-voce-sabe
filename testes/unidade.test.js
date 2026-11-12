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
