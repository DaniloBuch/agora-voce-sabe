/* ==========================================================================
   Cópia da base guardada neste aparelho (IndexedDB), para o app funcionar sem
   internet. Guarda só o que já é público (a mesma lista que o site lê do Supabase).
   Chaves usadas: "produtos" ({ em, dados }), "sinonimos" e "areas".
   A busca grava; a cotação e as novidades leem.
   ========================================================================== */
const NOME = "cbs_agora_voce_sabe";
const LOJA = "dados";

function abrir() {
  return new Promise((resolver, rejeitar) => {
    if (!window.indexedDB) return rejeitar(new Error("sem IndexedDB"));
    const pedido = indexedDB.open(NOME, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

export async function salvar(chave, valor) {
  try {
    const db = await abrir();
    await new Promise((resolver, rejeitar) => {
      const tx = db.transaction(LOJA, "readwrite");
      tx.objectStore(LOJA).put(valor, chave);
      tx.oncomplete = resolver;
      tx.onerror = () => rejeitar(tx.error);
    });
    db.close();
  } catch (_) {} // sem espaço ou navegação privada: só não fica disponível offline
}

// Devolve o valor guardado ou null (nunca lança erro)
export async function ler(chave) {
  try {
    const db = await abrir();
    const valor = await new Promise((resolver, rejeitar) => {
      const pedido = db.transaction(LOJA, "readonly").objectStore(LOJA).get(chave);
      pedido.onsuccess = () => resolver(pedido.result || null);
      pedido.onerror = () => rejeitar(pedido.error);
    });
    db.close();
    return valor;
  } catch (_) {
    return null;
  }
}

// Atalho: a lista de produtos guardada (array) ou null
export async function lerProdutos() {
  const salvo = await ler("produtos");
  return salvo && Array.isArray(salvo.dados) && salvo.dados.length ? salvo.dados : null;
}
