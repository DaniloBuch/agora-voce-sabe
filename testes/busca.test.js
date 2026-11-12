/* Página de busca: motor (aspas, -palavra, sinônimos, conectivos, erro de digitação, referência
   sem zeros), tabela, paginação, link da busca, filtros, histórico, atalhos, Lista Diária e cotação (+). */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ambiente, esperarBase, buscar, linhas } = require("./ajuda");
const { conferir } = require("./referencia");

const amb = ambiente();
before(amb.subir);
after(amb.descer);

const foto = async (pagina) => ({
  info: (await pagina.innerText("#resultsInfo")).replace(/\s+/g, " ").trim(),
  linhas: (await linhas(pagina)).slice(0, 12),
  total: (await linhas(pagina)).length,
  paginacao: (await pagina.isHidden("#paginacao")) ? null : (await pagina.innerText("#paginacao")).replace(/\s+/g, " ").trim(),
  marcados: await pagina.$$eval("#tableBody mark", (m) => [...new Set(m.map((x) => x.textContent.toLowerCase()))].sort()),
});

test("home carrega a base, sem erros no console", async () => {
  const { pagina, erros } = await amb.abrir();
  await esperarBase(pagina);
  await pagina.waitForTimeout(900); // contador animado
  assert.equal(await pagina.innerText("#infoBaseNumero"), "71");
  assert.match(await pagina.innerText("#infoBaseTexto"), /produtos carregados/);
  conferir("home-textos", {
    sabia: await pagina.innerText("#sabiaTexto").catch(() => null),
    semana: await pagina.$$eval(".semana__item", (a) => a.map((x) => x.innerText.replace(/\s+/g, " "))),
  });
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

const CONSULTAS = {
  sonda: "sonda",
  sku: "000437",
  skuParcial: "0004",
  aspas: '"sonda uretral"',
  excluir: "luva -latex",
  excluirAspas: 'sonda -"2 vias"',
  sinonimoCurto: "luva cx",
  sinonimoFrase: "soro fisiologico",
  conectivo: "aparelho de pressao",
  conectivoSo: "de",
  erroDigitacao: "sodna",
  parecidos: "cateterr",
  refSemZeros: "38833014",
  refComZeros: "000000000038833014",
  tag: "jelco",
  tagAcento: "LÁTEX",
  nada: "xyzxyz",
  comBarra: "c/100",
};

for (const [nome, texto] of Object.entries(CONSULTAS)) {
  test(`busca: ${nome} (${texto})`, async () => {
    const { pagina, erros } = await amb.abrir();
    await esperarBase(pagina);
    await buscar(pagina, texto);
    conferir(`busca-${nome}`, await foto(pagina));
    assert.deepEqual(erros, []);
    await pagina.context().close();
  });
}

test("busca: regras principais", async () => {
  const { pagina } = await amb.abrir();
  await esperarBase(pagina);
  await buscar(pagina, "000437");
  assert.match((await linhas(pagina))[0], /000437/, "código exato vem primeiro");
  await buscar(pagina, "luva -latex");
  const ls = await linhas(pagina);
  assert.ok(ls.length > 0 && ls.every((l) => !/LATEX/.test(l)), "-latex tira quem tem látex");
  await buscar(pagina, "38833014");
  assert.match((await linhas(pagina))[0], /002000/, "referência sem zeros");
  await buscar(pagina, "soro fisiologico");
  assert.ok((await linhas(pagina)).some((l) => /CLORETO DE SODIO/.test(l)), "sinônimo de mais de uma palavra");
  await pagina.context().close();
});

test("paginação, endereço da busca e ordenação pela coluna", async () => {
  const { pagina } = await amb.abrir();
  await esperarBase(pagina);
  await buscar(pagina, "luva");
  assert.equal((await linhas(pagina)).length, 50);
  assert.ok(await pagina.isVisible("#paginacao"));
  assert.match(pagina.url(), /\?q=luva/);
  await pagina.click("#paginacao >> text=2");
  await pagina.waitForTimeout(200);
  const p2 = await foto(pagina);
  assert.match(pagina.url(), /p=2/);
  await pagina.click('button.ordenar[data-ordem="sku"]');
  await pagina.waitForTimeout(200);
  const ord1 = await foto(pagina);
  await pagina.click('button.ordenar[data-ordem="sku"]');
  await pagina.waitForTimeout(200);
  conferir("paginacao-ordem", { p2, ord1, ord2: await foto(pagina), url: pagina.url().replace(/^.*\?/, "?") });
  await pagina.context().close();
});

test("abrir pelo link: ?q=, ?cat=, ?area=, ?ver=todos, ?ord=", async () => {
  const r = {};
  for (const q of ["?q=sonda", "?cat=Sondas", "?area=Hospitais", "?ver=todos", "?q=luva&ord=sku.desc&p=2", "?cat=Luvas&q=nitrilica"]) {
    const { pagina } = await amb.abrir(q);
    await esperarBase(pagina);
    await pagina.waitForTimeout(400);
    r[q] = { ...(await foto(pagina)), filtro: (await pagina.isHidden("#filtroAtivo")) ? null : await pagina.innerText("#filtroAtivo") };
    await pagina.context().close();
  }
  conferir("links", r);
});

test("gaveta de categorias e áreas", async () => {
  const { pagina } = await amb.abrir();
  await esperarBase(pagina);
  await pagina.click("#categoriasToggle");
  await pagina.waitForTimeout(300);
  const antes = {
    categorias: await pagina.$$eval("#categoriasLista button", (b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim())),
    areas: await pagina.$$eval("#areasLista button", (b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim())),
  };
  await pagina.fill("#filtroCategoria", "son");
  await pagina.waitForTimeout(200);
  antes.filtradas = await pagina.$$eval("#categoriasLista button:not([hidden])", (b) => b.filter((x) => x.offsetParent).map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  await pagina.click("#categoriasLista button:has-text('Sondas')");
  await pagina.waitForTimeout(400);
  antes.resultado = await foto(pagina);
  antes.url = pagina.url().replace(/^.*\?/, "?");
  conferir("gaveta", antes);
  await pagina.context().close();
});

test("histórico de buscas, Esc e atalho /", async () => {
  const { pagina } = await amb.abrir();
  await esperarBase(pagina);
  await pagina.fill("#searchInput", "sonda");
  await pagina.press("#searchInput", "Enter");
  await pagina.waitForTimeout(200);
  await pagina.press("#searchInput", "Escape");
  assert.equal(await pagina.inputValue("#searchInput"), "");
  await pagina.waitForTimeout(200);
  assert.ok(await pagina.isVisible("#historico"), "campo vazio mostra as buscas recentes");
  assert.match(await pagina.innerText("#historicoLista"), /sonda/);
  await pagina.click("h1");
  await pagina.keyboard.press("/");
  assert.equal(await pagina.evaluate(() => document.activeElement.id), "searchInput");
  await pagina.context().close();
});

test("Lista Diária: saldo, preço e variação", async () => {
  const { pagina, erros } = await amb.abrir();
  await esperarBase(pagina);
  await pagina.setInputFiles("#listaArquivo", path.join(__dirname, "dados", "Lista-Diaria-12-11-2026.csv"));
  await pagina.waitForFunction(() => !document.querySelector("#listaLimpar").hidden);
  await buscar(pagina, "000437");
  const r = { status: await pagina.innerText("#listaStatus"), msg: await pagina.innerText("#listaMsg").catch(() => ""), sonda: await foto(pagina) };
  await buscar(pagina, "cateter");
  r.cateter = await foto(pagina);
  r.cabecalho = await pagina.$$eval("thead th", (t) => t.filter((x) => x.offsetParent).map((x) => x.innerText.trim()));
  conferir("lista-diaria", r);
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

test("cotação: + adiciona, contador e página da cotação", async () => {
  const { pagina, erros } = await amb.abrir();
  await esperarBase(pagina);
  await buscar(pagina, "sonda");
  const botoes = pagina.locator("#tableBody td.col-cot button");
  await botoes.nth(0).click();
  await botoes.nth(1).click();
  await pagina.waitForTimeout(200);
  assert.equal(await pagina.innerText("#contadorCotacao"), "2");
  const copiado = await pagina.evaluate(() => navigator.clipboard.readText());
  await pagina.click("#linkCotacao");
  await pagina.waitForSelector("#cotCorpo tr");
  await pagina.waitForTimeout(400);
  const r = {
    copiado,
    linhas: await pagina.$$eval("#cotCorpo tr", (t) => t.map((x) => x.innerText.replace(/\s+/g, " ").trim())),
    total: await pagina.innerText("#cotRodape"),
  };
  // edita quantidade e preço (número brasileiro)
  const qtd = pagina.locator("#cotCorpo tr").first().locator("input").first();
  await qtd.fill("1.500");
  await qtd.press("Tab");
  const inputs = await pagina.locator("#cotCorpo tr").first().locator("input").count();
  const preco = pagina.locator("#cotCorpo tr").first().locator("input").nth(inputs - 1);
  await preco.fill("2,5");
  await preco.press("Tab");
  await pagina.waitForTimeout(200);
  r.editado = { campos: await pagina.locator("#cotCorpo tr").first().locator("input").evaluateAll((i) => i.map((x) => x.value)), linha: (await pagina.locator("#cotCorpo tr").first().innerText()).replace(/\s+/g, " "), total: await pagina.innerText("#cotRodape") };
  // mini-busca
  await pagina.fill("#cotBuscaInput", "jelco");
  await pagina.waitForTimeout(300);
  r.miniJelco = await pagina.$$eval("#cotBuscaResultados li", (l) => l.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  r.miniInfo = await pagina.innerText("#cotBuscaInfo");
  await pagina.fill("#cotBuscaInput", "luva");
  await pagina.waitForTimeout(300);
  r.miniLuva = { n: await pagina.locator("#cotBuscaResultados li").count(), info: await pagina.innerText("#cotBuscaInfo") };
  await pagina.locator("#cotBuscaResultados [data-add]").first().click();
  await pagina.waitForTimeout(200);
  r.depois = await pagina.$$eval("#cotCorpo tr", (t) => t.length);
  const { miniJelco, miniInfo, miniLuva, ...resto } = r;
  conferir("cotacao", resto);
  conferir("cotacao-minibusca", { miniJelco, miniInfo, miniLuva }); // muda de propósito na etapa do motor único
  assert.deepEqual(erros, []);
  await pagina.context().close();
});
