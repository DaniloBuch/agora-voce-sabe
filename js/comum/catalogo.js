/* ==========================================================================
   Lista de produtos para as páginas que não são a busca (cotação e novidades).
   Fontes, na ordem pedida: "aparelho" (cópia guardada pela busca, abre na hora e
   funciona sem internet) ou "rede" (Supabase, o mais novo); depois a outra; por
   fim o db.json (plano B). Devolve os produtos como vêm do banco ([] se nada der certo).
   ========================================================================== */
import * as baseOffline from "./base-offline.js";

const URL_DB_JSON = new URL("../../db.json", import.meta.url).href;

async function daRede() {
  try {
    if (window.CBS_API && window.CBS_API.configurado) return await window.CBS_API.listarProdutos();
  } catch (_) {}
  return null;
}

export async function carregarProdutos({ primeiro = "rede" } = {}) {
  const fontes = primeiro === "aparelho" ? [baseOffline.lerProdutos, daRede] : [daRede, baseOffline.lerProdutos];
  for (const fonte of fontes) {
    const dados = await fonte();
    if (Array.isArray(dados) && dados.length) return dados;
  }
  try {
    const dados = await (await fetch(URL_DB_JSON)).json();
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

// Sinônimos do dicionário (os mesmos da busca); sem internet, os guardados pela busca neste aparelho
export async function carregarSinonimos() {
  try {
    if (window.CBS_API && window.CBS_API.configurado && window.CBS_API.listarSinonimos) return await window.CBS_API.listarSinonimos();
  } catch (_) {}
  return (await baseOffline.ler("sinonimos")) || [];
}
