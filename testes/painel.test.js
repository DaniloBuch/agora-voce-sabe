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
