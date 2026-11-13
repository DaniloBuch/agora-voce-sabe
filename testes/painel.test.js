/* Painel (/admin): login, lista com filtro (mesma lógica da busca), abas e diálogos principais. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ambiente } = require("./ajuda");
const { conferir } = require("./referencia");

const amb = ambiente();
before(amb.subir);
after(amb.descer);

async function entrar(opcoes) {
  const r = await amb.abrir("admin/", opcoes);
  const { pagina } = r;
  await pagina.fill("#loginEmail", "teste@cbsmed.com.br");
  await pagina.fill("#loginSenha", "certa");
  await pagina.click("#btnEntrar");
  await pagina.waitForSelector("#corpoTabela tr");
  await pagina.waitForTimeout(300);
  return r;
}

const texto = (pagina, sel) => pagina.innerText(sel).then((t) => t.replace(/\s+/g, " ").trim());
const linhasDe = (pagina, sel) => pagina.$$eval(`${sel} tr`, (t) => t.map((x) => x.innerText.replace(/\s+/g, " ").trim()));

test("login errado mostra a mensagem", async () => {
  const { pagina } = await amb.abrir("admin/");
  await pagina.fill("#loginEmail", "x@y.com");
  await pagina.fill("#loginSenha", "errada");
  await pagina.click("#btnEntrar");
  await pagina.waitForTimeout(300);
  assert.match(await pagina.innerText("#loginErro"), /incorretos/);
  await pagina.context().close();
});

test("painel: KPIs, lista e paginação", async () => {
  const { pagina, erros } = await entrar();
  conferir("painel-lista", {
    kpis: await texto(pagina, "#kpis"),
    info: await texto(pagina, "#infoLista"),
    pagina: await texto(pagina, "#infoPagina"),
    linhas: (await linhasDe(pagina, "#corpoTabela")).slice(0, 8),
    usuario: await texto(pagina, "#topoUsuario"),
  });
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

// O filtro do painel passa a usar o MESMO motor da busca (etapa 2): estas referências mudam de propósito ali.
test("painel: filtro da lista", async () => {
  const { pagina } = await entrar();
  const r = {};
  for (const f of ["sonda", "000437", "luva -latex", '"sonda uretral"', "cx luva", "soro fisiologico", "38833014", "aparelho de pressao", "jelco"]) {
    await pagina.fill("#filtro", f);
    await pagina.waitForTimeout(350);
    r[f] = { info: await texto(pagina, "#infoLista"), linhas: (await linhasDe(pagina, "#corpoTabela")).slice(0, 6).map((l) => l.slice(0, 60)) };
  }
  conferir("painel-filtro", r);
  await pagina.context().close();
});

test("painel: abas", async () => {
  const { pagina, erros } = await entrar();
  const r = {};
  for (const aba of ["categorias", "areas", "tags", "sinonimos", "novidades", "importar", "historico", "produtos"]) {
    await pagina.click(`.aba[data-aba="${aba}"]`);
    await pagina.waitForTimeout(400);
    const painel = pagina.locator(`#aba-${aba}`);
    r[aba] = {
      visivel: await painel.isVisible(),
      linhas: (await painel.locator("tbody tr").evaluateAll((t) => t.map((x) => x.innerText.replace(/\s+/g, " ").trim()))).slice(0, 8),
    };
  }
  conferir("painel-abas", r);
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

test("painel: novo produto, editar e edição em massa (prévia)", async () => {
  const { pagina, banco, erros } = await entrar();
  await pagina.click("#btnNovo");
  await pagina.fill("#fSku", "777777");
  await pagina.fill("#fDesc", "PRODUTO DE TESTE");
  await pagina.fill("#fTagInput", "apelido teste");
  await pagina.press("#fTagInput", "Enter");
  await pagina.click("#btnSalvar");
  await pagina.waitForTimeout(500);
  const criado = banco.produtos.find((p) => p.sku === "777777");
  assert.ok(criado, "produto criado no banco");
  await pagina.fill("#filtro", "sonda");
  await pagina.waitForTimeout(350);
  await pagina.locator("#corpoTabela input[type=checkbox]").nth(0).check();
  await pagina.locator("#corpoTabela input[type=checkbox]").nth(1).check();
  await pagina.click("#btnTagsMassa");
  await pagina.waitForTimeout(200);
  await pagina.fill("#fAddInput", "nova");
  await pagina.press("#fAddInput", "Enter");
  await pagina.waitForTimeout(200);
  conferir("painel-edicao", {
    criado: { sku: criado.sku, descricao_tecnica: criado.descricao_tecnica, tags: criado.tags },
    massa: await texto(pagina, "#massaPreview"),
    resumo: await texto(pagina, "#massaResumo"),
  });
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

test("painel: CSV com a coluna UM e campo UM no cadastro", async () => {
  const { pagina, banco, erros } = await entrar();
  await pagina.click('.aba[data-aba="importar"]');
  await pagina.setInputFiles("#arquivoCsv", { name: "um.csv", mimeType: "text/csv", buffer: Buffer.from("Codigo;UM\n000439;pc\n000437;\n") });
  await pagina.waitForSelector("#btnAplicar");
  const previa = await texto(pagina, "#resultadoImport");
  assert.match(previa, /1 com unidade \(UM\) definida/i);
  await pagina.click("#btnAplicar");
  await pagina.waitForTimeout(400);
  const chamada = banco.chamadas.find((c) => c.includes("importar_catalogo"));
  assert.ok(chamada, "chamou a importação");
  await pagina.click('.aba[data-aba="produtos"]');
  await pagina.fill("#filtro", "000437");
  await pagina.waitForTimeout(350);
  await pagina.locator("#corpoTabela button:has-text('Editar')").first().click();
  assert.equal(await pagina.inputValue("#fUnidade"), "UN");
  await pagina.fill("#fUnidade", "cx");
  await pagina.click("#btnSalvar");
  await pagina.waitForTimeout(400);
  assert.equal(banco.produtos.find((p) => p.sku === "000437").unidade, "CX");
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

// Percorre as abas e abre os diálogos de cada uma (Renomear/Editar/Excluir/Ver produtos), guardando o
// que aparece: garante que cada aba continua ligada depois da divisão do painel em módulos.
test("painel: diálogos de todas as abas", async () => {
  const { pagina, erros } = await entrar();
  const textoDialogo = () => pagina.evaluate(() => (document.querySelector("dialog[open]")?.innerText || "").replace(/\s+/g, " ").trim());
  const r = {};
  for (const aba of ["categorias", "areas", "tags", "sinonimos", "novidades", "historico", "produtos"]) {
    await pagina.click(`.aba[data-aba="${aba}"]`);
    await pagina.waitForTimeout(400);
    const linha = pagina.locator(`#aba-${aba} tbody tr`).nth(1);
    const botoes = await linha.locator("button").allInnerTexts().catch(() => []);
    r[aba] = { botoes: botoes.map((b) => b.trim()) };
    for (const rotulo of ["Renomear", "Editar", "Excluir"]) {
      const b = linha.locator(`button:has-text("${rotulo}")`).first();
      if (!(await b.count())) continue;
      await b.click();
      await pagina.waitForTimeout(250);
      const abriu = await textoDialogo();
      let previa = null;
      const campo = pagina.locator("dialog[open] input[type=text], dialog[open] input:not([type]), dialog[open] textarea").first();
      if (rotulo !== "Excluir" && (await campo.count())) {
        await campo.fill("NOVO NOME");
        await pagina.waitForTimeout(250);
        previa = await textoDialogo();
      }
      r[aba][rotulo] = { abriu, previa };
      await pagina.keyboard.press("Escape");
      await pagina.waitForTimeout(150);
    }
    const ver = linha.locator('button:has-text("Ver produtos")').first();
    if (await ver.count()) {
      await ver.click();
      await pagina.waitForTimeout(400);
      r[aba].ver = (await pagina.innerText("#infoLista")).replace(/\s+/g, " ").trim();
    }
  }
  conferir("painel-dialogos", r);
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

// Importação completa (descrição, referência, categoria e tags), com referência estragada pelo Excel,
// produto novo, produto que some e aspas no meio do texto: a prévia tem que continuar igual.
test("painel: prévia da importação de CSV completo", async () => {
  const { pagina, erros } = await entrar();
  await pagina.click('.aba[data-aba="importar"]');
  const csv = [
    "Codigo;Descricao;Cod prd forn;Categoria;Tags",
    '437;"SONDA URETRAL N 12 ""ADULTO""";SU12;Sondas;sonda de alivio|nelaton',
    "000438;SONDA FOLEY 2 VIAS N 14;SF14;;",
    "002000;CATETER INTRAVENOSO PERIFERICO 20G;3,8833E+07;Cateter;",
    "888888;PRODUTO NOVO DO CSV;NV1;Nova Categoria;NOVO",
    ...Array.from({ length: 60 }, (_, i) => `${100001 + i};LUVA ${i + 1};LV${i + 1};Luvas;`),
  ].join("\r\n");
  await pagina.setInputFiles("#arquivoCsv", { name: "catalogo.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "latin1") });
  await pagina.waitForSelector("#resultadoImport .resumo");
  await pagina.evaluate(() => document.querySelectorAll("#resultadoImport details").forEach((d) => (d.open = true)));
  conferir("painel-importacao", (await pagina.innerText("#resultadoImport")).replace(/\s+/g, " ").trim());
  assert.deepEqual(erros, []);
  await pagina.context().close();
});
