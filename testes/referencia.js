/* "Foto" do comportamento: na primeira vez (ou com ATUALIZAR=1) grava o resultado em
   testes/referencias/; nas próximas, compara. Assim a reorganização do código prova que
   nada mudou para quem usa. Para aceitar uma mudança de propósito: ATUALIZAR=1 npm test */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const PASTA = path.join(__dirname, "referencias");
const atualizar = process.env.ATUALIZAR === "1";

function conferir(nome, valor) {
  fs.mkdirSync(PASTA, { recursive: true });
  const arquivo = path.join(PASTA, `${nome}.json`);
  if (atualizar || !fs.existsSync(arquivo)) {
    fs.writeFileSync(arquivo, JSON.stringify(valor, null, 2) + "\n");
    return;
  }
  assert.deepStrictEqual(valor, JSON.parse(fs.readFileSync(arquivo, "utf8")), `mudou em relação à referência "${nome}"`);
}

/** Compara a tela com a imagem de referência (pixel a pixel, com pequena tolerância de antialiasing). */
async function conferirTela(pagina, nome, { limite = 0.002, paginaInteira = true } = {}) {
  const pasta = path.join(PASTA, "telas");
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${nome}.png`);
  const atual = await pagina.screenshot({ fullPage: paginaInteira, animations: "disabled", caret: "hide" });
  if (atualizar || !fs.existsSync(arquivo)) {
    fs.writeFileSync(arquivo, atual);
    return;
  }
  const antes = fs.readFileSync(arquivo);
  const r = await compararImagens(pagina, antes, atual);
  if (r.diferenca > limite) {
    fs.writeFileSync(path.join(pasta, `${nome}.ATUAL.png`), atual);
    assert.fail(`tela "${nome}" mudou: ${(r.diferenca * 100).toFixed(2)}% dos pixels (${r.motivo || "conteúdo"}). Veja ${nome}.ATUAL.png`);
  }
}

async function compararImagens(pagina, a, b) {
  const ctx = await pagina.context().browser().newContext();
  const p = await ctx.newPage();
  try {
    return await p.evaluate(async ([x, y]) => {
      const carregar = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
      const [ia, ib] = await Promise.all([carregar(x), carregar(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { diferenca: 1, motivo: `tamanho ${ia.width}x${ia.height} → ${ib.width}x${ib.height}` };
      const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const da = px(ia), db = px(ib);
      let dif = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) dif++;
      }
      return { diferenca: dif / (da.length / 4) };
    }, [a.toString("base64"), b.toString("base64")]);
  } finally {
    await ctx.close();
  }
}

module.exports = { conferir, conferirTela };
