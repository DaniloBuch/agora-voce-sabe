/* ==========================================================================
   Motor de busca único: usado pela busca do site, pelo filtro do painel e pela
   mini-busca da cotação.

   - Palavras em qualquer ordem: o produto precisa ter TODAS.
   - "trecho exato" entre aspas; -palavra ou -"trecho" tira quem tem.
   - Sinônimos do dicionário do painel (cx = caixa; "soro fisiologico" = "cloreto de sodio").
   - Palavras de ligação (de, para, e...) são ignoradas quando há outras palavras.
   - Referência com ou sem zeros à esquerda.
   - Relevância: código exato, referência, apelido, começo de palavra na descrição...
   - Erro de digitação: sem resultado, tenta a palavra parecida ("sodna" -> "sonda");
     com poucos resultados, acrescenta os "parecidos" depois dos exatos.

   Uso:
     const motor = criarMotor();
     motor.definirSinonimos(grupos);            // [{ palavras: ["cx", "caixa"] }]
     const itens = dados.map((p) => prepararItem({ sku, descricao, referencia, tags }));
     motor.definirBase(itens);                  // vocabulário para os parecidos
     const r = motor.buscar(itens, "luva -latex");
   ========================================================================== */
import { normalizar, normalizarEspacos, formatarRef, escaparHtml, escaparRegex } from "../comum/texto.js";

// "com"/"sem" e "c/" não entram: mudam o produto (luva com/sem pó, C/100).
export const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "para", "pra", "p/", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "ao"]);
export const MAX_PARECIDOS = 50; // resultados "parecidos" mostrados depois dos exatos
const LIMITE_POUCOS = 50; // com menos exatos que isso, procura também os parecidos

const ehLetraOuNumero = (c) => c !== undefined && /[a-z0-9]/.test(c);
// Termo que pode ter erro de digitação: só letras, 4+ caracteres
const podeTerErro = (t) => t.length >= 4 && /^[a-z]+$/.test(t);

/* ---------- Produto preparado para a busca ----------
   Guarda os textos já normalizados (a busca roda a cada tecla, sem refazer isso).
   "extra" = texto a mais que também deve ser encontrado (o painel acha pela categoria). */
export function prepararItem({ sku, descricao, referencia, tags = [], extra = "" }) {
  const skuTxt = String(sku ?? "");
  const refOriginal = String(referencia ?? "").trim();
  const ref = formatarRef(refOriginal);
  const listaTags = (Array.isArray(tags) ? tags : String(tags ?? "").split(",")).map((t) => String(t).trim()).filter(Boolean);
  return {
    _sku: normalizar(skuTxt),
    _desc: normalizarEspacos(descricao),
    _ref: normalizar(ref),
    _refOriginal: normalizar(refOriginal), // a busca aceita as duas formas
    _tags: listaTags.map(normalizarEspacos),
    _buscaFull: normalizarEspacos([skuTxt, descricao, ref, refOriginal, listaTags.join(" "), extra].join(" ")),
  };
}

/* ---------- Alternativas de um termo ----------
   Cada termo da busca vira um grupo de "alternativas"; o produto precisa casar com
   pelo menos uma alternativa de cada grupo. Modos:
     trecho  -> aparece em qualquer lugar (o que a pessoa digitou: "sond" acha "sonda")
     palavra -> palavra inteira (sinônimos curtos: "cx" não acha "cxa")
     inicio  -> começo de palavra (sinônimos longos: "caixa" acha "caixas")          */
export function alternativa(texto, modo = "trecho") {
  const alt = { texto, modo };
  if (modo !== "trecho") {
    alt.re = new RegExp(`(^|[^a-z0-9])${escaparRegex(texto)}${modo === "palavra" ? "(?![a-z0-9])" : ""}`);
  }
  return alt;
}

export function casaAlternativa(textoNormalizado, alt) {
  return alt.modo === "trecho" ? textoNormalizado.includes(alt.texto) : alt.re.test(textoNormalizado);
}

// Escapa o texto e destaca os termos buscados (ignorando acentos/maiúsculas e espaços repetidos).
// "deslocamento" = quantos caracteres do começo NÃO são exibidos (os zeros à esquerda
// da Ref.): a busca é feita no texto completo, mas só a parte visível é mostrada.
export function destacar(texto, termos, deslocamento = 0) {
  const original = String(texto ?? "");
  if (!original) return "";

  // Mapeia cada caractere normalizado de volta ao índice no texto original
  let norm = "";
  const mapa = [];
  for (let i = 0; i < original.length; i++) {
    let n = normalizar(original[i]);
    if (/\s/.test(n)) {
      if (norm.endsWith(" ")) continue; // espaços repetidos contam como um só
      n = " ";
    }
    for (let k = 0; k < n.length; k++) mapa.push(i);
    norm += n;
  }

  const faixas = [];
  for (const termo of termos) {
    const alt = typeof termo === "string" ? { texto: termo, modo: "trecho" } : termo;
    const t = alt.texto;
    if (!t) continue;
    let pos = norm.indexOf(t);
    while (pos !== -1) {
      const inicioOk = alt.modo === "trecho" || !ehLetraOuNumero(norm[pos - 1]);
      const fimOk = alt.modo !== "palavra" || !ehLetraOuNumero(norm[pos + t.length]);
      if (inicioOk && fimOk) faixas.push([mapa[pos], mapa[pos + t.length - 1] + 1]);
      pos = norm.indexOf(t, pos + 1);
    }
  }
  if (faixas.length === 0) return escaparHtml(original.slice(deslocamento));

  // Une faixas sobrepostas
  faixas.sort((a, b) => a[0] - b[0]);
  const unidas = [faixas[0]];
  for (const [ini, fim] of faixas.slice(1)) {
    const ultima = unidas[unidas.length - 1];
    if (ini <= ultima[1]) ultima[1] = Math.max(ultima[1], fim);
    else unidas.push([ini, fim]);
  }

  let html = "";
  let cursor = deslocamento;
  for (const [iniBruto, fim] of unidas) {
    const ini = Math.max(iniBruto, deslocamento); // corta o que ficou nos zeros ocultos
    if (fim <= ini) continue;
    html += escaparHtml(original.slice(cursor, ini));
    html += `<mark>${escaparHtml(original.slice(ini, fim))}</mark>`;
    cursor = fim;
  }
  return html + escaparHtml(original.slice(cursor));
}

/* ---------- Relevância ---------- */

// Quanto maior a pontuação, mais relevante o resultado
function pontuarTermo(item, t) {
  let pontos = 0;
  if (item._sku === t) pontos += 100;
  else if (item._sku.startsWith(t)) pontos += 60;
  else if (item._sku.includes(t)) pontos += 5;

  if (item._ref === t || item._refOriginal === t) pontos += 80;
  else if (item._ref.includes(t) || item._refOriginal.includes(t)) pontos += 15;

  if (item._tags.some((tag) => tag === t)) pontos += 50;
  else if (item._tags.some((tag) => tag.includes(t))) pontos += 30;

  if (new RegExp(`(^|[^a-z0-9])${escaparRegex(t)}`).test(item._desc)) {
    pontos += 20; // começo de palavra na descrição
  } else if (item._desc.includes(t)) {
    pontos += 10;
  }
  return pontos;
}

const casaGrupo = (item, g) => g.alternativas.some((alt) => casaAlternativa(item._buscaFull, alt));

// Cada grupo vale a melhor das suas alternativas (o termo digitado ou um sinônimo)
function pontuar(item, grupos) {
  let pontos = 0;
  for (const g of grupos) {
    let melhor = 0;
    for (const alt of g.alternativas) {
      if (casaAlternativa(item._buscaFull, alt)) melhor = Math.max(melhor, pontuarTermo(item, alt.texto));
    }
    pontos += melhor;
  }
  return pontos;
}

// Mais relevante primeiro; empate mantém a ordem original da lista
function ordenar(lista, grupos) {
  return lista
    .map((item, indice) => ({ item, indice, pontos: pontuar(item, grupos) }))
    .sort((a, b) => b.pontos - a.pontos || a.indice - b.indice)
    .map((r) => r.item);
}

/* ---------- Tolerância a erro de digitação ---------- */

// Distância de edição (inclui troca de letras vizinhas: "sodna" -> "sonda" = 1).
export function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, atual[j - 1] + 1, prev[j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      atual[j] = v;
      if (v < minimo) minimo = v;
    }
    if (minimo > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = atual;
  }
  return prev[b.length];
}

/* ---------- O motor (guarda sinônimos e vocabulário da base) ---------- */

export function criarMotor() {
  let indiceSinonimos = new Map(); // palavra -> palavras equivalentes
  let frasesSinonimo = []; // sinônimos com mais de uma palavra, da maior para a menor
  let base = [];
  let vocabulario = null;
  const cacheParecidas = new Map();

  function definirSinonimos(grupos) {
    indiceSinonimos = new Map();
    for (const g of grupos || []) {
      const palavras = [...new Set((g.palavras || []).map(normalizarEspacos).filter(Boolean))];
      if (palavras.length < 2) continue;
      for (const p of palavras) {
        const equivalentes = indiceSinonimos.get(p) || new Set();
        palavras.forEach((outra) => outra !== p && equivalentes.add(outra));
        indiceSinonimos.set(p, equivalentes);
      }
    }
    frasesSinonimo = [...indiceSinonimos.keys()].filter((p) => p.includes(" ")).sort((a, b) => b.length - a.length);
  }

  // Lista completa de produtos (já com prepararItem): de onde saem as palavras para os "parecidos"
  function definirBase(itens) {
    base = itens || [];
    vocabulario = null;
    cacheParecidas.clear();
  }

  // Separa o texto digitado em: termos soltos, trechos exatos ("entre aspas") e excluídos (-palavra ou -"trecho").
  // Palavras de ligação ("cabo PARA bisturi"): ignoradas quando há outras palavras. Entre aspas continuam valendo.
  function interpretar(texto) {
    let resto = ` ${normalizar(texto).replace(/[“”„″«»]/g, '"').replace(/\s+/g, " ")} `;
    const exatos = [];
    const excluidos = [];

    // trechos entre aspas; a aspa final pode faltar enquanto a pessoa ainda digita
    resto = resto.replace(/(?:(\s)-)?"([^"]*)("|$)/g, (_, menos, frase) => {
      const f = frase.replace(/\s+/g, " ").trim();
      if (f) (menos !== undefined ? excluidos : exatos).push(f);
      return " ";
    });

    // sinônimos de mais de uma palavra ("soro fisiologico") ficam juntos, como um termo só
    const termos = [];
    for (const frase of frasesSinonimo) {
      const marca = ` ${frase} `;
      while (resto.includes(marca)) {
        termos.push(frase);
        resto = resto.replace(marca, " ");
      }
    }

    for (const t of resto.split(" ")) {
      if (!t) continue;
      if (t.startsWith("-")) {
        if (t.length > 1) excluidos.push(t.slice(1)); // "-" sozinho é ignorado
        continue;
      }
      termos.push(t);
    }
    // tira as palavras de ligação, desde que sobre alguma outra para buscar
    const fortes = termos.filter((t) => !CONECTIVOS.has(t));
    const ignorados = fortes.length && fortes.length < termos.length ? termos.filter((t) => CONECTIVOS.has(t)) : [];
    return { termos: ignorados.length ? fortes : termos, exatos, excluidos, ignorados };
  }

  function montarGrupos(consulta) {
    const grupos = consulta.termos.map((t) => {
      const alternativas = [alternativa(t)];
      for (const s of indiceSinonimos.get(t) || []) {
        alternativas.push(alternativa(s, s.length <= 4 ? "palavra" : "inicio"));
      }
      return { termo: t, alternativas, tolerante: podeTerErro(t) };
    });
    for (const f of consulta.exatos) grupos.push({ termo: f, alternativas: [alternativa(f)], tolerante: false });
    return grupos;
  }

  function obterVocabulario() {
    if (vocabulario) return vocabulario;
    const contagem = new Map();
    for (const item of base) {
      const texto = `${item._desc} ${item._tags.join(" ")}`;
      for (const palavra of texto.split(/[^a-z0-9]+/)) {
        if (palavra.length >= 3 && /[a-z]/.test(palavra) && !/\d/.test(palavra)) {
          contagem.set(palavra, (contagem.get(palavra) || 0) + 1);
        }
      }
    }
    vocabulario = [...contagem.entries()];
    return vocabulario;
  }

  // Palavras da base parecidas com o termo digitado (as mais próximas e mais usadas primeiro).
  // estrito = usado com resultados exatos na tela: só 1 erro até 8 letras, 2 a partir de 9.
  function sugerirPalavras(termo, { estrito = false, limite = 3 } = {}) {
    if (!podeTerErro(termo) || (estrito && termo.length < 5)) return [];
    const chave = `${estrito ? 1 : 0}:${limite}:${termo}`;
    if (cacheParecidas.has(chave)) return cacheParecidas.get(chave);
    const max = estrito ? (termo.length <= 8 ? 1 : 2) : termo.length <= 5 ? 1 : 2;
    const achadas = [];
    for (const [palavra, usos] of obterVocabulario()) {
      if (estrito && palavra.includes(termo)) continue; // essa já aparece nos resultados exatos
      let d = distancia(termo, palavra, max);
      // quem digita só o começo da palavra ("esfigmmo"): compara com o início dela
      if (d > max && termo.length >= 5 && palavra.length > termo.length) {
        d = distancia(termo, palavra.slice(0, termo.length), max);
      }
      if (d <= max) achadas.push({ palavra, d, usos });
    }
    achadas.sort((a, b) => a.d - b.d || b.usos - a.usos);
    const resultado = achadas.slice(0, limite).map((x) => x.palavra);
    cacheParecidas.set(chave, resultado);
    return resultado;
  }

  /** Busca em "lista" (itens preparados). tolerancia = corrige erro de digitação e acrescenta parecidos.
      Devolve { consulta, grupos, itens, nExatos, destaque, destaqueParecidos, correcao, vazia }. */
  function buscar(lista, texto, { tolerancia = true } = {}) {
    const consulta = interpretar(texto);
    const grupos = montarGrupos(consulta);
    let candidatos = lista;
    if (consulta.excluidos.length) {
      candidatos = candidatos.filter((item) => !consulta.excluidos.some((e) => item._buscaFull.includes(e)));
    }
    const r = {
      consulta,
      grupos,
      itens: candidatos,
      nExatos: candidatos.length,
      destaque: grupos.flatMap((g) => g.alternativas),
      destaqueParecidos: [],
      correcao: null,
      vazia: grupos.length === 0, // só exclusões (ou nada): quem chama decide a ordem
    };
    if (r.vazia) return r;

    const exatos = ordenar(candidatos.filter((item) => grupos.every((g) => casaGrupo(item, g))), grupos);
    r.itens = exatos;
    r.nExatos = exatos.length;
    if (!tolerancia) return r;

    if (exatos.length === 0) {
      // Nada encontrado: tenta corrigir erros de digitação nos termos que não existem na lista
      const corrigidos = grupos.map((g) => {
        if (candidatos.some((item) => casaGrupo(item, g))) return g;
        if (!g.tolerante) return null;
        const sugestoes = sugerirPalavras(g.termo);
        return sugestoes.length ? { ...g, alternativas: sugestoes.map((s) => alternativa(s)), sugestoes } : null;
      });
      if (corrigidos.every(Boolean) && corrigidos.some((g) => g.sugestoes)) {
        const filtrados = candidatos.filter((item) => corrigidos.every((g) => casaGrupo(item, g)));
        if (filtrados.length > 0) {
          const principais = corrigidos.map((g) => ({ ...g, alternativas: [g.alternativas[0]] }));
          r.itens = ordenar(filtrados, principais);
          r.nExatos = r.itens.length;
          r.destaque = corrigidos.flatMap((g) => g.alternativas);
          r.correcao = { original: String(texto).trim(), sugeridos: principais.map((g) => g.alternativas[0].texto) };
        }
      }
    } else if (exatos.length < LIMITE_POUCOS) {
      // Poucos resultados exatos: acrescenta, depois deles, os produtos com palavras PARECIDAS
      // (o termo pode ter sido digitado errado). Ficam numa seção separada e com menos relevância.
      const extras = grupos.map((g) => (g.tolerante ? sugerirPalavras(g.termo, { estrito: true, limite: 5 }) : []));
      if (extras.some((e) => e.length)) {
        const ampliados = grupos.map((g, i) =>
          extras[i].length ? { ...g, alternativas: g.alternativas.concat(extras[i].map((p) => alternativa(p))) } : g,
        );
        const jaListados = new Set(exatos);
        const parecidos = ordenar(
          candidatos.filter((item) => !jaListados.has(item) && ampliados.every((g) => casaGrupo(item, g))),
          ampliados,
        ).slice(0, MAX_PARECIDOS);
        if (parecidos.length) {
          r.itens = exatos.concat(parecidos);
          r.destaqueParecidos = extras.flat().map((p) => alternativa(p));
        }
      }
    }
    return r;
  }

  return { definirSinonimos, definirBase, interpretar, buscar, sugerirPalavras };
}
