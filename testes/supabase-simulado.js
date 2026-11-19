/* ==========================================================================
   Supabase simulado para os testes: responde às mesmas URLs que o api.js chama
   (REST/PostgREST e login), guardando tudo em memória. Cada página de teste
   recebe uma cópia nova dos dados, então um teste não interfere no outro.
   ========================================================================== */
const SUPABASE = "https://kgnxvqubeuxtavwlonfp.supabase.co";

// Data fixa dos testes (o relógio do navegador também é congelado nela)
const AGORA = new Date("2026-11-12T12:00:00-03:00");
const diasAtras = (n) => new Date(AGORA.getTime() - n * 86400000).toISOString();

function produtosIniciais() {
  const p = [];
  const add = (sku, descricao_tecnica, referencia = "", tags = "", categoria = null, areas = [], criado = 200) =>
    p.push({ sku, descricao_tecnica, referencia, tags, fixo: false, categoria, areas, criado_em: diasAtras(criado), unidade: "" });

  add("000437", "SONDA URETRAL N 12", "SU12", "Sonda de alívio", "Sondas", ["Hospitais"]);
  add("000438", "SONDA FOLEY 2 VIAS N 14", "SF14", "", "Sondas", ["Hospitais"]);
  add("000439", "SONDA NASOGASTRICA LONGA N 12", "SNG12", "", "Sondas");
  add("001200", "ESFIGMOMANOMETRO ANEROIDE ADULTO", "ESF-AD", "Aparelho de pressão", "Diagnóstico", ["Laboratórios"]);
  add("001201", "APARELHO DE PRESSAO DIGITAL DE PULSO", "APD", "", "Diagnóstico");
  add("002000", "CATETER INTRAVENOSO PERIFERICO 20G", "000000000038833014", "Jelco, Abocath", "Cateter", ["Hospitais"], 3);
  add("002001", "CATETER INTRAVENOSO PERIFERICO 22G", "000000000038833015", "Jelco", "Cateter", [], 2);
  add("003000", "FIXADOR DE CATETER TRANSPARENTE", "TFX", "Transofix", "Cateter");
  add("004000", "CLORETO DE SODIO 0,9% 500ML", "CS500", "Soro fisiológico", null);
  add("004001", "COMPRESSA DE GAZE CX C/500", "GZ500", "", null);
  add("005000", "CABO PARA BISTURI N 4", "CB4", "", null);
  for (let i = 1; i <= 60; i++) {
    const tam = ["P", "M", "G"][i % 3];
    const material = i % 4 === 0 ? "NITRILICA" : "LATEX";
    const sku = String(100000 + i);
    add(sku, `LUVA PROCEDIMENTO ${material} TAM ${tam} CX C/100 LOTE ${String(i).padStart(2, "0")}`, `LV${i}`, i === 1 ? "Luva de látex" : "", "Luvas");
  }
  // unidade de medida (migração 013): alguns com, outros ainda sem
  const um = { "000437": "UN", "000438": "UN", "002000": "UN", "002001": "UN", "004000": "FR", "004001": "PC", "001200": "UN" };
  for (const x of p) x.unidade = um[x.sku] || (x.descricao_tecnica.startsWith("LUVA") ? "CX" : "");
  return p;
}

function bancoInicial() {
  return {
    produtos: produtosIniciais(),
    categorias: ["Cateter", "Diagnóstico", "Luvas", "Sondas", "Vazia"].map((nome) => ({ nome })),
    areas: [
      { nome: "Hospitais", icone: "hospital", ordem: 1 },
      { nome: "Laboratórios", icone: "microscope", ordem: 2 },
    ],
    sinonimos: [
      { id: 1, palavras: ["cx", "caixa"] },
      { id: 2, palavras: ["soro fisiologico", "cloreto de sodio"] },
    ],
    novidades: [
      { id: 1, chave: null, titulo: "Lista de cotação", texto: "Monte a cotação pelo +.", status: "publicada", publicado_em: diasAtras(1) },
    ],
    links_site: [{ sku: "000437", caminho: "produto/sonda-uretral-n-12", ficha: null, imagem: null, atualizado_em: diasAtras(2) }],
    produtos_historico: [],
    removidos: [{ sku: "009999", descricao_tecnica: "PRODUTO QUE SAIU", referencia: "X1", categoria: "Sondas", removido_em: diasAtras(1) }],
  };
}

function valorFiltro(v) {
  return String(v).replace(/^"|"$/g, "");
}

function aplicarFiltros(linhas, params) {
  let r = linhas;
  for (const [col, cond] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(col)) continue;
    const m = String(cond).match(/^(eq|neq|gte|lt|gt|lte|in)\.(.*)$/s);
    if (!m) continue;
    const [, op, bruto] = m;
    if (op === "in") {
      const lista = bruto.replace(/^\(|\)$/g, "").split(",").map(valorFiltro);
      r = r.filter((l) => lista.includes(String(l[col])));
    } else if (op === "eq") r = r.filter((l) => String(l[col]) === valorFiltro(bruto));
    else if (op === "neq") r = r.filter((l) => String(l[col]) !== valorFiltro(bruto));
    else if (op === "gte") r = r.filter((l) => String(l[col]) >= bruto);
    else if (op === "lt") r = r.filter((l) => String(l[col]) < bruto);
  }
  return r;
}

function ordenar(linhas, order) {
  if (!order) return linhas;
  const regras = order.split(",").map((o) => {
    const [col, dir] = o.split(".");
    return { col, dir: dir === "desc" ? -1 : 1 };
  });
  return [...linhas].sort((a, b) => {
    for (const { col, dir } of regras) {
      const x = a[col] ?? "", y = b[col] ?? "";
      if (x < y) return -dir;
      if (x > y) return dir;
    }
    return 0;
  });
}

function selecionar(linhas, select) {
  if (!select || select === "*") return linhas;
  const cols = select.split(",");
  return linhas.map((l) => Object.fromEntries(cols.map((c) => [c, l[c] ?? null])));
}

const json = (status, corpo, headers = {}) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers },
  body: corpo === undefined ? "" : JSON.stringify(corpo),
});

function rpc(db, nome, corpo) {
  switch (nome) {
    case "produtos_removidos":
      return db.removidos;
    case "editar_tags_em_massa":
    case "editar_areas_em_massa":
      return { alterados: (corpo.p_skus || []).length };
    default:
      return {};
  }
}

/** Liga o Supabase simulado numa página (ou contexto) do Playwright. Devolve o "banco" para os testes conferirem. */
async function ligarSupabase(alvo, { banco = bancoInicial(), foraDoAr = false } = {}) {
  const db = banco;
  db.chamadas = [];
  await alvo.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    db.chamadas.push(`${metodo} ${url.pathname}${url.search}`);
    if (metodo === "OPTIONS") return route.fulfill(json(204));
    if (foraDoAr) return route.abort("failed");

    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill(json(204));
      const corpo = req.postDataJSON() || {};
      if (corpo.password === "errada") return route.fulfill(json(400, { error_description: "Invalid login credentials" }));
      return route.fulfill(
        json(200, { access_token: "token-teste", refresh_token: "renova-teste", expires_in: 3600, user: { email: corpo.email || "teste@cbsmed.com.br" } }),
      );
    }

    const caminho = url.pathname.replace(/^\/rest\/v1\//, "");
    const corpo = req.postData() ? req.postDataJSON() : null;
    if (caminho.startsWith("rpc/")) return route.fulfill(json(200, rpc(db, caminho.slice(4), corpo || {})));

    const tabela = caminho;
    if (!(tabela in db)) return route.fulfill(json(404, { message: `relation "${tabela}" does not exist` }));
    const params = [...url.searchParams.entries()];
    const q = Object.fromEntries(params);

    if (metodo === "GET" || metodo === "HEAD") {
      let linhas = ordenar(aplicarFiltros(db[tabela], params), q.order);
      const total = linhas.length;
      const off = Number(q.offset || 0);
      const lim = q.limit ? Number(q.limit) : linhas.length;
      linhas = selecionar(linhas.slice(off, off + lim), q.select);
      const fim = off + linhas.length - 1;
      return route.fulfill(json(200, linhas, { "content-range": `${off}-${Math.max(fim, off)}/${total}` }));
    }
    if (metodo === "POST") {
      const novos = Array.isArray(corpo) ? corpo : [corpo];
      for (const n of novos) {
        const chave = q.on_conflict;
        const i = chave ? db[tabela].findIndex((l) => l[chave] === n[chave]) : -1;
        if (i >= 0) db[tabela][i] = { ...db[tabela][i], ...n };
        else db[tabela].push({ id: db[tabela].length + 100, ...n });
      }
      return route.fulfill(json(201, novos));
    }
    if (metodo === "PATCH") {
      for (const l of aplicarFiltros(db[tabela], params)) Object.assign(l, corpo);
      return route.fulfill(json(204));
    }
    if (metodo === "DELETE") {
      const sair = new Set(aplicarFiltros(db[tabela], params));
      db[tabela] = db[tabela].filter((l) => !sair.has(l));
      return route.fulfill(json(204));
    }
    return route.fulfill(json(405, {}));
  });
  return db;
}

module.exports = { ligarSupabase, bancoInicial, AGORA, SUPABASE };
