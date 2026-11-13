// Uso: node testes/ferramentas/comparar-estilos.js <pasta-antes> <pasta-depois>   (SO=nome-da-cena para rodar só uma)
// Compara o estilo calculado (getComputedStyle) de TODOS os elementos, em vários estados das páginas,
// entre duas cópias do site (antes e depois). Usa o Supabase simulado dos testes.
const path = require("path");
const [,, velho, novo] = process.argv;
const AJUDA = (raiz) => require(path.join(raiz, "testes", "ajuda.js"));
const SO = process.env.SO;
const CENAS0 = [
  ["home", "", async () => {}],
  ["busca", "?q=sonda", async () => {}],
  ["busca-luva", "?q=luva&ord=um.asc", async () => {}],
  ["gaveta", "", async (p) => { await p.click("#categoriasToggle"); await p.waitForTimeout(500); }],
  ["historico", "", async (p) => { await p.fill("#searchInput", "sonda"); await p.press("#searchInput", "Enter"); await p.fill("#searchInput", ""); await p.click("#searchInput"); await p.waitForTimeout(300); }],
  ["sino", "", async (p) => { await p.click("#sinoBotao"); await p.waitForTimeout(300); }],
  ["lista", "?q=cateter", async (p) => { await p.setInputFiles("#listaArquivo", path.join(novo, "testes/dados/Lista-Diaria-11-11-2026.csv")); await p.waitForTimeout(300); await p.setInputFiles("#listaArquivo", path.join(novo, "testes/dados/Lista-Diaria-12-11-2026.csv")); await p.waitForTimeout(500); await p.click("#listaAjuda"); }],
  ["cotacao", "cotacao/", async (p) => { await p.fill("#cotBuscaInput", "sonda"); await p.waitForTimeout(300); }],
  ["novidades", "novidades/", async () => {}],
  ["novidades-precos", "novidades/#removidos", async () => {}],
  ...["produtos", "categorias", "areas", "tags", "sinonimos", "novidades", "importar", "historico"].map((aba) => [`admin-${aba}`, "admin/", async (p) => {
    await p.fill("#loginEmail", "t@c.br"); await p.fill("#loginSenha", "x"); await p.click("#btnEntrar");
    await p.waitForSelector("#corpoTabela tr"); await p.click(`.aba[data-aba="${aba}"]`); await p.waitForTimeout(400);
    const pc = (await p.evaluate(() => innerWidth)) > 800;
    if (pc && aba === "produtos") { await p.locator("#corpoTabela input[type=checkbox]").nth(0).check(); await p.locator("#corpoTabela button:has-text('Editar')").first().click(); await p.waitForTimeout(300); }
    if (pc && aba === "categorias") { await p.locator("#aba-categorias tbody tr").nth(1).locator("button:has-text('Renomear')").click(); await p.waitForTimeout(300); }
  }]),
];
const CENAS = SO ? CENAS0.filter((c) => c[0] === SO) : CENAS0;
async function coletar(raiz, cena, tela, tema) {
  const { ambiente, esperarBase } = AJUDA(raiz);
  const amb = ambiente(); await amb.subir();
  try {
    const antes = async (p) => {
      if (tema === "dark") await p.addInitScript(() => localStorage.setItem("cbs_tema", "escuro"));
      await p.addInitScript(() => { if (!localStorage.getItem("cbs_cotacao_v1")) localStorage.setItem("cbs_cotacao_v1", JSON.stringify({ v: 1, atualizadoEm: 0, itens: [{ sku: "000437", descricao: "SONDA URETRAL N 12", referencia: "SU12", um: "UN", qtd: 2, preco: 4.79, adicionadoEm: 0 }] })); });
    };
    const { pagina } = await amb.abrir(cena[1], { tela, tema, antes });
    if (!/^(cotacao|novidades|admin)/.test(cena[1])) await esperarBase(pagina);
    await pagina.waitForTimeout(900);
    await cena[2](pagina);
    await pagina.waitForTimeout(300);
    return await pagina.evaluate(() => {
      const out = {};
      const caminho = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; p.unshift(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}:${i}`); } return p.join(">"); };
      for (const el of document.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
          const o = {};
          for (let i = 0; i < cs.length; i++) { const k = cs[i]; o[k] = cs.getPropertyValue(k); }
          out[caminho(el) + (pseudo || "")] = o;
        }
      }
      return out;
    });
  } finally { await amb.descer(); }
}
(async () => {
  let difs = 0;
  for (const cena of CENAS) for (const tela of ["pc", "celular"]) for (const tema of ["light", "dark"]) {
    if (tema === "dark" && !["home", "busca", "cotacao", "sino"].includes(cena[0])) continue;
    const [a, b] = [await coletar(velho, cena, tela, tema), await coletar(novo, cena, tela, tema)];
    const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
    let n = 0;
    for (const k of chaves) {
      if (!a[k] || !b[k]) { if (n++ < 5) console.log(`  [${cena[0]} ${tela} ${tema}] só em um: ${k}`); continue; }
      for (const p in a[k]) if (a[k][p] !== b[k][p] && !/^(transform|perspective-origin|transform-origin|box-shadow)$/.test(p)) { if (n++ < 40) console.log(`  [${cena[0]} ${tela} ${tema}] ${k.slice(-90)} ${p}: ${a[k][p]} -> ${b[k][p]}`); }
    }
    console.log(`${cena[0]} ${tela} ${tema}: ${chaves.size} elementos, ${n} diferenças`);
    difs += n;
  }
  console.log("TOTAL de diferenças:", difs);
})();
