/* Layout: compara as telas com as imagens de referência em 1366×768 (tela da maioria da equipe)
   e no celular (390×844), nos temas claro e escuro. Qualquer mudança visual reprova o teste. */
const { test, before, after } = require("node:test");
const { ambiente, esperarBase, buscar } = require("./ajuda");
const { conferirTela } = require("./referencia");

const amb = ambiente();
before(amb.subir);
after(amb.descer);

const comCotacao = (pagina) =>
  pagina.addInitScript(() => {
    if (!localStorage.getItem("cbs_teste_cot")) {
      localStorage.setItem("cbs_teste_cot", "1");
      localStorage.setItem("cbs_cotacao_v1", JSON.stringify({ v: 1, atualizadoEm: 0, itens: [{ sku: "000437", descricao: "SONDA URETRAL N 12", referencia: "SU12", um: "UN", qtd: 2, preco: 4.79, adicionadoEm: 0 }, { sku: "002000", descricao: "CATETER INTRAVENOSO PERIFERICO 20G", referencia: "38833014", um: "CX", qtd: 1, preco: null, adicionadoEm: 0 }] }));
    }
  });

const CENAS = {
  home: { caminho: "", pronto: async (p) => { await esperarBase(p); await p.waitForTimeout(1000); } },
  busca: { caminho: "", pronto: async (p) => { await esperarBase(p); await buscar(p, "sonda"); await p.waitForTimeout(500); } },
  "busca-luva": { caminho: "?q=luva", pronto: async (p) => { await esperarBase(p); await p.waitForTimeout(700); } },
  gaveta: { caminho: "", pronto: async (p) => { await esperarBase(p); await p.click("#categoriasToggle"); await p.waitForTimeout(600); }, inteira: false },
  cotacao: { caminho: "cotacao/", antes: comCotacao, pronto: async (p) => { await p.waitForTimeout(900); } },
  novidades: { caminho: "novidades/", pronto: async (p) => { await p.waitForSelector("#novCorpo tr"); await p.waitForTimeout(500); } },
  painel: {
    caminho: "admin/",
    pronto: async (p) => {
      await p.fill("#loginEmail", "teste@cbsmed.com.br");
      await p.fill("#loginSenha", "x");
      await p.click("#btnEntrar");
      await p.waitForSelector("#corpoTabela tr");
      await p.waitForTimeout(500);
    },
    inteira: false,
  },
};

for (const tela of ["pc", "celular"]) {
  for (const tema of ["light", "dark"]) {
    for (const [nome, cena] of Object.entries(CENAS)) {
      if (tema === "dark" && !["home", "busca", "cotacao"].includes(nome)) continue;
      test(`tela ${nome} · ${tela} · ${tema}`, async () => {
        const antes = async (p, c) => {
          if (tema === "dark") await p.addInitScript(() => localStorage.setItem("cbs_tema", "escuro"));
          if (cena.antes) await cena.antes(p, c);
        };
        const { pagina } = await amb.abrir(cena.caminho, { tela, tema, antes });
        await cena.pronto(pagina);
        await pagina.mouse.move(0, 0);
        await conferirTela(pagina, `${nome}-${tela}-${tema}`, { paginaInteira: cena.inteira !== false });
        await pagina.context().close();
      });
    }
  }
}
