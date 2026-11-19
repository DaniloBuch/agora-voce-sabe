/* Ferramentas comuns dos testes: servidor local da pasta do site, navegador e páginas
   já ligadas ao Supabase simulado, com relógio e sorteios fixos (telas comparáveis). */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ligarSupabase, AGORA } = require("./supabase-simulado");

const RAIZ = path.resolve(__dirname, "..");
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json", ".csv": "text/csv",
};

function iniciarServidor() {
  const servidor = http.createServer((req, res) => {
    let caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (caminho.endsWith("/")) caminho += "index.html";
    const arquivo = path.join(RAIZ, caminho);
    if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      res.writeHead(404); return res.end("404");
    }
    res.writeHead(200, { "content-type": TIPOS[path.extname(arquivo)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(arquivo).pipe(res);
  });
  return new Promise((ok) => servidor.listen(0, "127.0.0.1", () => ok(servidor)));
}

const TELAS = { pc: { width: 1366, height: 768 }, celular: { width: 390, height: 844 } };

/** Prepara servidor + navegador para um arquivo de testes. Use: const amb = ambiente(); before(amb.subir); after(amb.descer) */
function ambiente() {
  const amb = { servidor: null, navegador: null, base: "" };
  amb.subir = async () => {
    amb.servidor = await iniciarServidor();
    amb.base = `http://127.0.0.1:${amb.servidor.address().port}/`;
    amb.navegador = await chromium.launch();
  };
  amb.descer = async () => {
    await amb.navegador?.close();
    amb.servidor?.close();
  };
  /** Abre uma página nova (contexto limpo). Devolve { pagina, banco, erros }. */
  amb.abrir = async (caminho = "", { tela = "pc", supabase = {}, antes, tema = "light" } = {}) => {
    const contexto = await amb.navegador.newContext({
      viewport: TELAS[tela], serviceWorkers: "block", reducedMotion: "reduce", colorScheme: tema,
      permissions: ["clipboard-read", "clipboard-write"], locale: "pt-BR", timezoneId: "America/Sao_Paulo",
      isMobile: tela === "celular", hasTouch: tela === "celular",
    });
    const pagina = await contexto.newPage();
    const erros = [];
    pagina.on("pageerror", (e) => erros.push(String(e)));
    pagina.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && erros.push(m.text()));
    await pagina.clock.setFixedTime(AGORA);
    // sorteios ("Você sabia?") sempre iguais
    await pagina.addInitScript(() => { let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); });
    // tudo que não é o site nem o Supabase (cbsmed.com.br, fontes externas) fica bloqueado
    await contexto.route((url) => !url.href.startsWith(amb.base) && !url.href.includes("supabase.co"), (r) => r.abort());
    const banco = await ligarSupabase(contexto, supabase);
    if (antes) await antes(pagina, contexto);
    await pagina.goto(amb.base + caminho);
    return { pagina, banco, erros, contexto };
  };
  return amb;
}

/** Espera a base terminar de carregar na página de busca */
async function esperarBase(pagina) {
  await pagina.waitForFunction(() => document.querySelector("#heroCards")?.classList.contains("is-carregado"));
}

/** Digita na busca e espera a tabela atualizar */
async function buscar(pagina, texto) {
  await pagina.fill("#searchInput", texto);
  await pagina.waitForTimeout(450);
}

const linhas = (pagina) => pagina.$$eval("#tableBody tr", (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ").trim()));
const skus = (pagina) => pagina.$$eval("#tableBody tr td.col-sku, #tableBody tr [data-sku-celula]", (tds) => tds.map((t) => t.innerText.trim()));

module.exports = { ambiente, esperarBase, buscar, linhas, skus, RAIZ, TELAS };
