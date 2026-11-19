/* ==========================================================================
   Lista Diária guardada neste navegador (localStorage), com validade de 24 h,
   e os preços da lista anterior (até 5 dias) para calcular a variação.
   O painel da Lista Diária (painel.js) grava; a cotação e as novidades só leem.
   ========================================================================== */

export const CHAVE = "cbs_lista_diaria_v1";
export const VALIDADE_MS = 24 * 60 * 60 * 1000; // 24 horas
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
// Preços da lista anterior (para mostrar a variação). Só preço, nunca saldo, e por no máximo 5 dias
// (cobre fim de semana e feriado prolongado: a lista de quinta ainda compara com a de terça).
const CHAVE_ANTERIOR = "cbs_lista_diaria_anterior_v1";
const ANTERIOR_MS = 5 * 24 * 60 * 60 * 1000;

let memoriaApenas = null; // se o localStorage não estiver disponível, vale só nesta aba

/* ---------- armazenamento (com validade) ---------- */

export function lerArmazenado() {
  let bruto = null;
  try {
    bruto = localStorage.getItem(CHAVE);
  } catch (_) {
    return memoriaApenas;
  }
  if (!bruto) return null;
  try {
    const o = JSON.parse(bruto);
    if (!o || o.v !== 1 || !Array.isArray(o.itens) || !Number.isFinite(o.atualizadoEm) || !Number.isFinite(o.expiraEm)) return null;
    return o;
  } catch (_) {
    return null;
  }
}

export function apagarArmazenado() {
  memoriaApenas = null;
  try {
    localStorage.removeItem(CHAVE);
  } catch (_) {
    /* sem acesso ao armazenamento: nada a apagar */
  }
}

export function salvarArmazenado(obj) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(obj));
    memoriaApenas = null;
  } catch (_) {
    memoriaApenas = obj; // navegador bloqueou o armazenamento: vale só enquanto a aba estiver aberta
  }
}

/* ---------- preços da lista anterior (variação) ---------- */

// Data da lista: a do nome do arquivo ("LISTA DIÁRIA 10-11-2026.xlsx"); sem data no nome, o dia
// em que foi carregada. É ela que decide qual lista é "anterior" (não a hora do upload).
export const inicioDoDia = (ms) => new Date(ms).setHours(0, 0, 0, 0);
export function dataDoNome(nome) {
  const m = String(nome || "").match(/(?:^|\D)(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  const dia = +m[1], mes = +m[2], ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const d = new Date(ano, mes - 1, dia);
  return d.getDate() === dia && d.getMonth() === mes - 1 ? d.getTime() : null;
}
export const dataDe = (o) => (Number.isFinite(o.dataLista) ? o.dataLista : inicioDoDia(o.atualizadoEm));

export function lerAnterior() {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE_ANTERIOR) || "null");
    if (!o || !Array.isArray(o.precos) || !Number.isFinite(o.atualizadoEm)) return null;
    if (Date.now() > o.atualizadoEm + ANTERIOR_MS || Date.now() < o.atualizadoEm - TOLERANCIA_RELOGIO_MS) {
      localStorage.removeItem(CHAVE_ANTERIOR); // passou de 5 dias: apaga
      return null;
    }
    return o;
  } catch (_) {
    return null;
  }
}

// Guarda os preços de uma lista mais antiga que "limite" (data da lista nova); a de data mais recente vence
export function guardarAnterior(lista, limite = Infinity) {
  if (!lista || dataDe(lista) >= limite) return;
  if (Date.now() > lista.atualizadoEm + ANTERIOR_MS) return;
  const atual = lerAnterior();
  if (atual && atual.precos.length && (dataDe(atual) > dataDe(lista) || (dataDe(atual) === dataDe(lista) && atual.atualizadoEm >= lista.atualizadoEm))) return;
  try {
    localStorage.setItem(CHAVE_ANTERIOR, JSON.stringify({
      atualizadoEm: lista.atualizadoEm,
      dataLista: dataDe(lista),
      precos: lista.itens.filter((i) => i[2] > 0).map((i) => [i[0], i[2]]),
    }));
  } catch (_) {
    /* sem armazenamento: fica sem comparação */
  }
}

export function apagarAnterior() {
  try { localStorage.removeItem(CHAVE_ANTERIOR); } catch (_) { /* nada a apagar */ }
}

// [sku, preço anterior] dos produtos cujo preço mudou em relação à lista anterior
export function calcularVariacoes(itens, anterior) {
  if (!anterior) return [];
  const antes = new Map(anterior.precos.map(([sku, p]) => [String(sku), p]));
  const out = [];
  for (const [sku, , preco] of itens) {
    const a = antes.get(String(sku));
    if (a > 0 && preco > 0 && Math.abs(preco - a) >= 0.00005) out.push([sku, a]);
  }
  return out;
}

export function expirada(o, agora = Date.now()) {
  // também descarta se o relógio do computador voltou para antes do envio
  return agora >= o.expiraEm || agora < o.atualizadoEm - TOLERANCIA_RELOGIO_MS;
}

/* ---------- leitura para as outras páginas (só leitura) ---------- */

// Saldo e preço por código (Map sku -> { saldo, preco }); null sem lista válida
export function lerPrecosESaldos() {
  const o = lerArmazenado();
  if (!o || Date.now() > o.expiraEm) return null;
  return new Map(o.itens.map(([sku, saldo, preco]) => [String(sku), { saldo, preco }]));
}

// Preços que mudaram desde a lista anterior (a variação já vem calculada ao carregar a lista)
export function lerVariacoes() {
  const o = lerArmazenado();
  if (!o || Date.now() > o.expiraEm) return null;
  const atual = new Map(o.itens.map(([sku, , preco]) => [String(sku), preco]));
  const itens = (o.variacoes || [])
    .map(([sku, anterior]) => {
      const a = atual.get(String(sku));
      return a ? { sku: String(sku), anterior, atual: a, dif: a - anterior, pct: ((a - anterior) / anterior) * 100 } : null;
    })
    .filter(Boolean);
  return { dataLista: o.dataLista || o.atualizadoEm, comparadaCom: o.comparadaCom || null, itens };
}
