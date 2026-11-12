/* Cabeçalho, tema, sino e página de novidades (busca, cotação e novidades). */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ambiente, esperarBase } = require("./ajuda");
const { conferir } = require("./referencia");

const amb = ambiente();
before(amb.subir);
after(amb.descer);

const PAGINAS = { busca: "", cotacao: "cotacao/", novidades: "novidades/" };

const fotoCabecalho = (pagina) =>
  pagina.$eval("header", (h) => ({
    links: [...h.querySelectorAll("a")].map((a) => ({ texto: a.innerText.replace(/\s+/g, " ").trim(), href: a.getAttribute("href"), visivel: Boolean(a.offsetParent) })),
    botoes: [...h.querySelectorAll("button")].map((b) => ({ id: b.id || b.className, rotulo: b.getAttribute("aria-label") || b.innerText.trim(), visivel: Boolean(b.offsetParent) })),
    logo: h.querySelector("img[data-logo]")?.getAttribute("src"),
    classes: h.className,
  }));

for (const [nome, caminho] of Object.entries(PAGINAS)) {
  test(`cabeçalho e tema: ${nome}`, async () => {
    const { pagina, erros } = await amb.abrir(caminho);
    await pagina.waitForTimeout(800);
    const r = { claro: await fotoCabecalho(pagina) };
    await pagina.click(".btn-tema");
    await pagina.waitForTimeout(150);
    r.escuro = { tema: await pagina.evaluate(() => document.documentElement.dataset.tema || document.documentElement.getAttribute("data-theme")), logo: await pagina.$eval("header img[data-logo]", (i) => i.getAttribute("src")) };
    // sino: abre e lista as mensagens publicadas
    await pagina.click("#sinoBotao");
    await pagina.waitForTimeout(200);
    r.sino = { aberto: await pagina.isVisible("#sinoPainel"), itens: await pagina.$$eval("#sinoLista li", (l) => l.map((x) => x.innerText.replace(/\s+/g, " ").trim())) };
    await pagina.keyboard.press("Escape");
    await pagina.waitForTimeout(100);
    r.sino.fechouComEsc = await pagina.isHidden("#sinoPainel");
    conferir(`cabecalho-${nome}`, r);
    assert.deepEqual(erros, []);
    await pagina.context().close();
  });
}

test("o tema escolhido vale nas outras páginas", async () => {
  const { pagina } = await amb.abrir();
  await pagina.click(".btn-tema");
  await pagina.goto(amb.base + "novidades/");
  const tema = await pagina.evaluate(() => document.documentElement.outerHTML.slice(0, 200));
  conferir("tema-persistente", { tema: /dark|escuro/.test(tema) });
  await pagina.context().close();
});

test("novidades: abas, filtros e removidos", async () => {
  const { pagina, erros } = await amb.abrir("novidades/");
  await pagina.waitForSelector("#novCorpo tr");
  await pagina.waitForTimeout(300);
  const foto = async () => ({
    info: (await pagina.innerText("#novInfo")).replace(/\s+/g, " ").trim(),
    cab: (await pagina.innerText("#novCabecalho")).replace(/\s+/g, " ").trim(),
    linhas: await pagina.$$eval("#novCorpo tr", (t) => t.map((x) => x.innerText.replace(/\s+/g, " ").trim())),
  });
  const r = { cartoes: await pagina.$$eval("[id^=aba-]", (a) => a.map((x) => x.innerText.replace(/\s+/g, " ").trim())), adicionados: await foto() };
  await pagina.click("#aba-removidos");
  await pagina.waitForTimeout(200);
  r.removidos = await foto();
  await pagina.click("#aba-precos");
  await pagina.waitForTimeout(200);
  r.precos = await foto();
  await pagina.click("#aba-adicionados");
  await pagina.fill("#fTexto", "22g");
  await pagina.waitForTimeout(300);
  r.filtroTexto = await foto();
  r.hash = new URL(pagina.url()).hash;
  conferir("novidades", r);
  assert.deepEqual(erros, []);
  await pagina.context().close();
});

test("busca sem internet usa a base guardada no aparelho", async () => {
  const { pagina, contexto } = await amb.abrir();
  await esperarBase(pagina);
  await pagina.waitForTimeout(300);
  await contexto.unroute(/supabase/).catch(() => {});
  await contexto.route(/supabase\.co/, (r) => r.abort("failed"));
  await pagina.reload();
  await esperarBase(pagina);
  conferir("offline", { texto: (await pagina.innerText("#infoBaseTexto")).replace(/\d{2}\/\d{2}\/\d{4}.*\)/, "DATA)"), numero: await pagina.innerText("#infoBaseNumero") });
  await pagina.context().close();
});
