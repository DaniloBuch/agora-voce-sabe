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

  /* ---------- Sessão de login (só o painel de administração usa) ---------- */

  const CHAVE_SESSAO = "cbs_admin_sessao";
  const MARGEM_RENOVACAO = 60; // segundos antes de expirar para renovar o login
  let sessao = lerSessao();
  let renovando = null;

  function lerSessao() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO));
      return s && s.access_token && s.refresh_token ? s : null;
    } catch (_) {
      return null;
    }
  }

  function gravarSessao(s) {
    sessao = s;
    try {
      if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (_) {}
  }

  function sessaoDaResposta(dados) {
    const agora = Math.floor(Date.now() / 1000);
    return {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expires_at: dados.expires_at || agora + Number(dados.expires_in || 3600),
      email: (dados.user && dados.user.email) || "",
    };
  }

  async function chamarAuth(caminho, corpo) {
    let resp;
    try {
      resp = await fetch(`${BASE}/auth/v1/${caminho}`, {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    } catch (_) {
      throw new Error("Sem conexão com o servidor de login.");
    }
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const erro = new Error(dados.msg || dados.error_description || dados.message || `Erro ${resp.status}`);
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  async function entrar(email, senha) {
    if (!configurado) throw new Error("Supabase não configurado (config.js).");
    try {
      const dados = await chamarAuth("token?grant_type=password", { email: String(email).trim(), password: senha });
      gravarSessao(sessaoDaResposta(dados));
    } catch (erro) {
      if (erro.status === 400) throw Object.assign(new Error("E-mail ou senha incorretos."), { status: 400 });
      if (erro.status === 429) throw Object.assign(new Error("Muitas tentativas. Aguarde alguns minutos e tente de novo."), { status: 429 });
      throw erro;
    }
  }

  async function sair() {
    const antiga = sessao;
    gravarSessao(null);
    if (antiga) {
      try {
        await fetch(`${BASE}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${antiga.access_token}` },
        });
      } catch (_) {} // o login local já foi apagado; o servidor expira sozinho
    }
  }

  // Renova o token de acesso (uma renovação por vez, mesmo com várias chamadas juntas).
  function renovarSessao() {
    if (!sessao) return Promise.reject(new Error("Faça login para continuar."));
    if (!renovando) {
      renovando = chamarAuth("token?grant_type=refresh_token", { refresh_token: sessao.refresh_token })
        .then((dados) => gravarSessao(sessaoDaResposta(dados)))
        .catch((erro) => {
          gravarSessao(null);
          window.dispatchEvent(new Event("cbs:sessao-expirada"));
          throw Object.assign(new Error("Sua sessão expirou. Entre novamente."), { status: 401 });
        })
        .finally(() => {
          renovando = null;
        });
    }
    return renovando;
  }

  async function garantirSessao() {
    if (sessao && sessao.expires_at - Math.floor(Date.now() / 1000) < MARGEM_RENOVACAO) {
      await renovarSessao();
    }
  }

  function cabecalhos(extra, anonimo) {
    const h = { apikey: KEY, "Content-Type": "application/json", ...extra };
    if (sessao && !anonimo) h.Authorization = `Bearer ${sessao.access_token}`;
    // Chaves antigas (JWT) também vão em Authorization; as novas "sb_publishable_" não.
    else if (KEY.startsWith("eyJ")) h.Authorization = `Bearer ${KEY}`;
    return h;
  }

  // anonimo: leitura pública (site e lista do admin); nunca envia o login, para que
  // um login vencido no navegador jamais atrapalhe a busca.
  async function requisitar(caminho, { method = "GET", corpo, headers, anonimo = false } = {}, jaRenovou = false) {
    if (!configurado) throw new Error("Supabase não configurado (config.js).");
    if (!anonimo) await garantirSessao();
    let resp;
    try {
      resp = await fetch(`${BASE}/rest/v1/${caminho}`, {
        method,
        headers: cabecalhos(headers, anonimo),
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (e) {
      throw new Error("Sem conexão com o banco de dados.");
    }
    if (resp.status === 401 && sessao && !anonimo && !jaRenovou) {
      await renovarSessao();
      return requisitar(caminho, { method, corpo, headers, anonimo }, true);
    }
    if (!resp.ok) {
      let detalhe = "";
      try {
        const j = await resp.json();
        detalhe = j.message || j.hint || JSON.stringify(j);
      } catch (_) {}
      let mensagem = detalhe || `Erro ${resp.status}`;
      if ((resp.status === 401 || resp.status === 403) && !anonimo) {
        mensagem = sessao
          ? "Sem permissão para esta operação."
          : "Faça login para continuar.";
      }
      const erro = new Error(mensagem);
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
      anonimo: true,
    });
    const linhas = await primeira.json();
    if (linhas.length < PAGINA) return linhas;

    const total = Number((primeira.headers.get("content-range") || "").split("/")[1]);
    if (Number.isFinite(total)) {
      const paginas = [];
      for (let off = PAGINA; off < total; off += PAGINA) {
        paginas.push(
          requisitar(`${base}&limit=${PAGINA}&offset=${off}`, { anonimo: true }).then((r) => r.json()),
        );
      }
      return linhas.concat(...(await Promise.all(paginas)));
    }
    // Plano B: sem o total, vai buscando até a página vir incompleta.
    let todas = linhas;
    for (let off = PAGINA; ; off += PAGINA) {
      const pag = await (await requisitar(`${base}&limit=${PAGINA}&offset=${off}`, { anonimo: true })).json();
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

  // Renomeia/mescla (p_novo preenchido) ou exclui (p_novo vazio) uma tag em todos os produtos.
  async function renomearTag(origem, novo) {
    const resp = await requisitar("rpc/renomear_tag", {
      method: "POST",
      corpo: { p_origem: origem, p_novo: novo },
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
    entrar,
    sair,
    logado: () => Boolean(sessao),
    emailLogado: () => (sessao ? sessao.email : ""),
    listarProdutos,
    criar,
    atualizar,
    excluir,
    importar,
    historico,
    restaurar,
    restaurarVarios,
    editarTagsEmMassa,
    renomearTag,
  };
})();
