// Camada de acesso ao Supabase (REST/PostgREST) usada pelo site e pelo /admin.
// Sem dependências: só fetch. Expõe window.CBS_API.
(function () {
  const cfg = window.CBS_CONFIG || {};
  // Aceita a URL do projeto com ou sem "/rest/v1" no final, e com "/" sobrando.
  const BASE = String(cfg.SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "");
  const KEY = String(cfg.SUPABASE_ANON_KEY || "").trim();
  const configurado = Boolean(BASE && KEY);

  const PAGINA = 1000; // limite padrão de linhas por requisição no Supabase
  const COLUNAS = "sku,descricao_tecnica,referencia,tags,fixo";

  function cabecalhos(extra) {
    const h = { apikey: KEY, "Content-Type": "application/json", ...extra };
    // Chaves antigas (JWT) também vão em Authorization; as novas "sb_publishable_" não.
    if (KEY.startsWith("eyJ")) h.Authorization = `Bearer ${KEY}`;
    return h;
  }

  async function requisitar(caminho, { method = "GET", corpo, headers } = {}) {
    if (!configurado) throw new Error("Supabase não configurado (config.js).");
    let resp;
    try {
      resp = await fetch(`${BASE}/rest/v1/${caminho}`, {
        method,
        headers: cabecalhos(headers),
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (e) {
      throw new Error("Sem conexão com o banco de dados.");
    }
    if (!resp.ok) {
      let detalhe = "";
      try {
        const j = await resp.json();
        detalhe = j.message || j.hint || JSON.stringify(j);
      } catch (_) {}
      const erro = new Error(detalhe || `Erro ${resp.status}`);
      erro.status = resp.status;
      throw erro;
    }
    return resp;
  }

  const filtroSku = (sku) => `sku=eq.${encodeURIComponent(sku)}`;

  // Lê TODOS os produtos (o Supabase entrega no máx. 1000 por vez).
  async function listarProdutos() {
    const base = `produtos?select=${COLUNAS}&order=descricao_tecnica.asc,sku.asc`;
    const primeira = await requisitar(`${base}&limit=${PAGINA}&offset=0`, {
      headers: { Prefer: "count=exact" },
    });
    const linhas = await primeira.json();
    if (linhas.length < PAGINA) return linhas;

    const total = Number((primeira.headers.get("content-range") || "").split("/")[1]);
    if (Number.isFinite(total)) {
      const paginas = [];
      for (let off = PAGINA; off < total; off += PAGINA) {
        paginas.push(
          requisitar(`${base}&limit=${PAGINA}&offset=${off}`).then((r) => r.json()),
        );
      }
      return linhas.concat(...(await Promise.all(paginas)));
    }
    // Plano B: sem o total, vai buscando até a página vir incompleta.
    let todas = linhas;
    for (let off = PAGINA; ; off += PAGINA) {
      const pag = await (await requisitar(`${base}&limit=${PAGINA}&offset=${off}`)).json();
      todas = todas.concat(pag);
      if (pag.length < PAGINA) return todas;
    }
  }

  async function criar(produto) {
    await requisitar("produtos", { method: "POST", corpo: produto });
  }

  async function atualizar(sku, campos) {
    const resp = await requisitar(`produtos?${filtroSku(sku)}`, {
      method: "PATCH",
      corpo: campos,
      headers: { Prefer: "return=representation" },
    });
    const linhas = await resp.json();
    if (linhas.length === 0) throw new Error("Produto não encontrado (talvez já tenha sido excluído).");
  }

  async function excluir(sku) {
    await requisitar(`produtos?${filtroSku(sku)}`, { method: "DELETE" });
  }

  // Importação em massa; roda numa transação única no banco.
  async function importar(itens, excluirAusentes) {
    const resp = await requisitar("rpc/importar_catalogo", {
      method: "POST",
      corpo: { p_itens: itens, p_excluir_ausentes: Boolean(excluirAusentes) },
    });
    return resp.json();
  }

  // Adiciona/remove tags de vários produtos numa transação única (função SQL editar_tags_em_massa).
  async function editarTagsEmMassa(skus, adicionar, remover) {
    const resp = await requisitar("rpc/editar_tags_em_massa", {
      method: "POST",
      corpo: { p_skus: skus, p_adicionar: adicionar, p_remover: remover },
    });
    return resp.json();
  }

  // de/ate: datas "AAAA-MM-DD" (horário de Brasília, ambas inclusivas), opcionais.
  async function historico(limite = 100, { de, ate } = {}) {
    let filtro = "";
    if (de) filtro += `&registrado_em=gte.${encodeURIComponent(`${de}T00:00:00-03:00`)}`;
    if (ate) {
      const proximo = new Date(`${ate}T12:00:00Z`);
      proximo.setUTCDate(proximo.getUTCDate() + 1);
      filtro += `&registrado_em=lt.${encodeURIComponent(`${proximo.toISOString().slice(0, 10)}T00:00:00-03:00`)}`;
    }
    const resp = await requisitar(
      `produtos_historico?select=*&order=id.desc&limit=${limite}${filtro}`,
    );
    return resp.json();
  }

  // Devolve ao banco a versão guardada no histórico (recria ou sobrescreve).
  async function restaurar(dados) {
    const { atualizado_em, ...produto } = dados;
    await requisitar("produtos?on_conflict=sku", {
      method: "POST",
      corpo: produto,
      headers: { Prefer: "resolution=merge-duplicates" },
    });
  }

  // Restaura várias versões de uma vez (um único pedido = uma transação).
  async function restaurarVarios(listaDados) {
    const produtos = listaDados.map(({ atualizado_em, ...produto }) => produto);
    await requisitar("produtos?on_conflict=sku", {
      method: "POST",
      corpo: produtos,
      headers: { Prefer: "resolution=merge-duplicates" },
    });
  }

  window.CBS_API = {
    configurado,
    listarProdutos,
    criar,
    atualizar,
    excluir,
    importar,
    historico,
    restaurar,
    restaurarVarios,
    editarTagsEmMassa,
  };
})();
