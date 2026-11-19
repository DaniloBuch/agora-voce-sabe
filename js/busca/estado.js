/* Estado compartilhado da busca: o objeto E (o que vários módulos leem e alteram),
   os parâmetros do endereço (?q=, ?cat=, ?ord=...) e o motor de busca da página. */
import { criarMotor } from "./motor.js";

export const motor = criarMotor();

// Aberto pelo botão "Abrir o app" (protocolo web+agoravocesabe:): o endereço vem em ?abrir=...
(function abertoPeloAtalho() {
  const abrir = new URLSearchParams(location.search).get("abrir");
  if (abrir === null) return;
  let resto = abrir.replace(/^web\+agoravocesabe:\/*/i, "");
  try { resto = decodeURIComponent(resto); } catch (_) {}
  try { history.replaceState(null, "", resto ? `?${resto.replace(/^\?/, "")}` : location.pathname); } catch (_) {}
})();

export const parametrosIniciais = new URLSearchParams(location.search);

/** Estado compartilhado da busca (o que mais de um módulo altera). */
export const E = {
  database: [],
  carregado: false,
  modoExplorar: parametrosIniciais.get("ver") === "todos", // catálogo completo, em ordem alfabética
  paginaDoLink: Math.max(1, parseInt(parametrosIniciais.get("p"), 10) || 1),
  erroCarga: false,
  estadoLista: null, // resultado completo da última busca (trocar de página não refaz a busca)
  timeoutBusca: null,
  paginaAtual: 1,
  animarProximaTabela: true,
  ordemColuna: (() => {
    const m = String(parametrosIniciais.get("ord") || "").match(/^(sku|descricao|um|saldo|preco|ref)\.(asc|desc)$/);
    return m ? { col: m[1], dir: m[2] === "asc" ? 1 : -1 } : null;
  })(),
  categoriaAtual: "", // categoria escolhida na gaveta ("" = todas)
  areaAtual: "", // área de atuação escolhida na gaveta ("" = todas)
  categoriasLista: [], // [[nome, quantidade]], da mais usada para a menos usada
  categoriaDoLink: parametrosIniciais.get("cat") || "",
};

// Há categoria ou área escolhida na gaveta?
export const temFiltro = () => Boolean(E.categoriaAtual || E.areaAtual);

// "Luvas · Hospitais" (para mensagens e nome do arquivo)
export const rotuloFiltro = () => [E.categoriaAtual, E.areaAtual].filter(Boolean).join(" · ");
