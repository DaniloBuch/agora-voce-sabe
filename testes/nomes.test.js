/* Checagem estática dos módulos (js/**): nome usado sem import ("x is not defined" só
   apareceria no navegador) e import que sobrou. Usa o TypeScript só para ler o JavaScript. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("módulos: nenhum nome indefinido nem import sobrando", (t) => {
  let ts;
  try { ts = require("typescript"); } catch (_) { return t.skip("typescript não instalado (npm install)"); }
  const raiz = path.resolve(__dirname, "..", "js");
  const arquivos = [];
  (function andar(d) {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) andar(p);
      else if (n.name.endsWith(".js") && n.name !== "cabecalho.js") arquivos.push(p); // cabecalho.js é script comum
    }
  })(raiz);
  // páginas que também são módulos
  for (const p of ["cotacao/cotacao.js", "novidades/novidades.js"]) arquivos.push(path.resolve(__dirname, "..", p));
  const prog = ts.createProgram(arquivos, {
    allowJs: true, checkJs: true, noEmit: true, noUnusedLocals: true,
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const GLOBAIS = /CBS_API|ListaDiaria|CBSCotacao|XLSX|CBS_AREAS_ICONES|CBSTema/; // vêm dos scripts comuns (window)
  const problemas = ts.getPreEmitDiagnostics(prog)
    .filter((d) => [2300, 2304, 2305, 2307, 2393, 2451, 2552, 2724, 6133].includes(d.code))
    .map((d) => `${path.relative(path.dirname(raiz), d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    .filter((m) => !GLOBAIS.test(m));
  assert.deepEqual(problemas, []);
});
