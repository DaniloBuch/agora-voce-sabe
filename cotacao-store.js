/* ==========================================================================
   Lista de cotação ("carrinho"): os produtos marcados na busca ficam guardados
   neste navegador (localStorage) até a pessoa limpar. Usado pela busca
   (botão + de cada produto) e pela página /cotacao/ (tabela para o papel timbrado).
   Nada vai para o banco.
   ========================================================================== */
(function () {
  const CHAVE = "cbs_cotacao_v1";
  const ouvintes = [];

  function ler() {
    try {
      const obj = JSON.parse(localStorage.getItem(CHAVE));
      return obj && Array.isArray(obj.itens) ? obj.itens.filter((i) => i && i.sku) : [];
    } catch (_) {
      return [];
    }
  }

  function gravar(itens) {
    try {
      if (itens.length) localStorage.setItem(CHAVE, JSON.stringify({ v: 1, itens, atualizadoEm: Date.now() }));
      else localStorage.removeItem(CHAVE);
    } catch (_) {}
    avisar();
  }

  function avisar() {
    const itens = ler();
    ouvintes.forEach((fn) => { try { fn(itens); } catch (_) {} });
  }

  // outra aba mexeu na cotação (ex.: busca numa aba, cotação na outra)
  window.addEventListener("storage", (e) => { if (e.key === CHAVE || e.key === null) avisar(); });

  window.CBSCotacao = {
    listar: ler,
    quantidade: () => ler().length,
    tem: (sku) => ler().some((i) => i.sku === sku),
    // item: { sku, descricao, referencia, preco (Lista Diária, opcional), saldo (opcional) }
    adicionar(item) {
      const itens = ler();
      if (itens.some((i) => i.sku === item.sku)) return;
      itens.push({
        sku: String(item.sku),
        descricao: String(item.descricao || ""),
        referencia: String(item.referencia || ""),
        um: "UN",
        qtd: 1,
        preco: typeof item.preco === "number" && item.preco > 0 ? item.preco : null,
        adicionadoEm: Date.now(),
      });
      gravar(itens);
    },
    remover(sku) {
      gravar(ler().filter((i) => i.sku !== sku));
    },
    atualizar(sku, campos) {
      gravar(ler().map((i) => (i.sku === sku ? { ...i, ...campos } : i)));
    },
    mover(sku, passo) {
      const itens = ler();
      const i = itens.findIndex((x) => x.sku === sku);
      const j = i + passo;
      if (i < 0 || j < 0 || j >= itens.length) return;
      [itens[i], itens[j]] = [itens[j], itens[i]];
      gravar(itens);
    },
    limpar() {
      gravar([]);
    },
    aoMudar(fn) {
      ouvintes.push(fn);
    },
  };
})();
