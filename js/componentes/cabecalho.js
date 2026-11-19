/* ==========================================================================
   Cabeçalho único do site (busca, cotação e novidades).

   Uso (logo depois do <header>, como script COMUM, não "module"):
     <header class="site-header" data-pagina="busca"></header>
     <script src="js/componentes/cabecalho.js"></script>

   Por que script comum: ele roda na hora, antes de a página aparecer na tela,
   então o cabeçalho nunca "pisca" vazio. Os scripts que mexem nele (sino.js,
   tema.js, busca) encontram os mesmos ids e classes de sempre.

   data-pagina: "busca" | "cotacao" | "novidades"
   O caminho até a raiz do site ("./" ou "../") sai do endereço deste arquivo.
   ========================================================================== */
(function () {
  const script = document.currentScript;
  const header = script && script.previousElementSibling;
  if (!header || !header.matches("header.site-header")) return;

  const pagina = header.dataset.pagina || "busca";
  // este arquivo fica em js/componentes/: a raiz do site é dois níveis acima ("" na própria raiz, "../" numa subpasta)
  const raizAbs = new URL("../../", script.src).href;
  const aqui = new URL(".", location.href).href;
  const raiz = aqui === raizAbs ? "" : aqui.startsWith(raizAbs) ? "../".repeat(aqui.slice(raizAbs.length).split("/").filter(Boolean).length) : raizAbs;
  const r = (caminho) => raiz + caminho;

  const svg = (tam, corpo, classe = "icone") =>
    `<svg class="${classe}" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
  const ICONE = {
    menu: '<path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/>',
    novidades: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    cotacao: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path>',
    instalar: '<path d="M12 15V3"></path><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path>',
    abrir: '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
    sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    fechar: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    login: '<path d="m10 17 5-5-5-5"></path><path d="M15 12H3"></path><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>',
    voltar: '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  };

  const ROTULO = { busca: "Busca de produtos", cotacao: "Cotação", novidades: "Novidades" };
  const naBusca = pagina === "busca";

  // gaveta de categorias: só na busca
  const categorias = naBusca
    ? `<button type="button" class="menu-categorias" id="categoriasToggle" aria-expanded="false" aria-controls="categorias" aria-label="Abrir categorias" title="Categorias">${svg(20, ICONE.menu)}<span class="menu-categorias__texto">Categorias</span></button>`
    : "";

  const marca = naBusca
    ? `<a class="brand" href="./" aria-label="CBS Médico Científica, página inicial">`
    : `<a class="brand" href="${r("")}" aria-label="CBS Médico Científica, voltar à busca">`;

  const novidades =
    `<a class="site-header__cotacao site-header__novidades" href="${r("novidades/")}" title="Novidades do catálogo: entraram, saíram e mudanças de preço"${pagina === "novidades" ? ' aria-current="page"' : ""}>` +
    `${svg(16, ICONE.novidades)}<span class="site-header__cotacao-rotulo">Novidades</span></a>`;

  // link da cotação (com o contador de itens): não aparece na própria página da cotação
  const cotacao =
    pagina === "cotacao"
      ? ""
      : `<a class="site-header__cotacao" id="linkCotacao" href="${r("cotacao/")}" title="Ver a lista de cotação">${svg(16, ICONE.cotacao)}<span class="site-header__cotacao-rotulo">Cotação</span><span class="contador-cotacao" id="contadorCotacao" hidden>0</span></a>`;

  // App (PWA): "Instalar app" quando dá para instalar; "Abrir o app" quando já está instalado (só na busca)
  const app = naBusca
    ? `<div class="instalar-wrap">
          <button type="button" class="site-header__instalar" id="btnInstalar" hidden aria-expanded="false">${svg(14, ICONE.instalar, "icone-instalar")}${svg(14, ICONE.abrir, "icone-abrir")}<span class="site-header__instalar-rotulo">Instalar app</span></button>
          <div class="instalar-ajuda" id="instalarAjuda" role="dialog" aria-labelledby="instalarAjudaTitulo" hidden>
            <p class="instalar-ajuda__titulo" id="instalarAjudaTitulo">O Firefox não instala sites como app</p>
            <p>Abra no <strong>Microsoft Edge</strong> e clique em <strong>Instalar app</strong>: o "Agora Você Sabe" vira um programa com ícone na área de trabalho.</p>
            <a class="btn-explorar" id="abrirNoEdge" href="microsoft-edge:https://danilobuch.github.io/agora-voce-sabe/">${svg(16, ICONE.abrir)}Abrir no Edge</a>
            <p class="instalar-ajuda__dica">Já instalou pelo Edge? <a href="web+agoravocesabe:" id="abrirAppFirefox">Abrir o app</a>. Prefere ficar no Firefox? Arraste o cadeado da barra de endereço para a área de trabalho e crie um atalho.</p>
          </div>
        </div>`
    : "";

  // sino (sino.js preenche): na página de novidades não precisa do link para ela mesma
  const rodapeSino =
    pagina === "novidades" ? "" : `<a class="sino-painel__rodape" href="${r("novidades/")}">Ver novidades do catálogo: entraram, saíram e preços →</a>`;
  const sino = `<div class="sino-wrap" id="sino">
          <button type="button" class="btn-sino" id="sinoBotao" aria-haspopup="true" aria-expanded="false" aria-controls="sinoPainel" aria-label="Novidades" title="Novidades">${svg(16, ICONE.sino)}<span class="sino-contador" id="sinoContador" hidden>0</span></button>
          <div class="sino-painel" id="sinoPainel" role="region" aria-label="Novidades do Agora Você Sabe" tabindex="-1" hidden>
            <div class="sino-painel__topo"><strong>Novidades</strong><button type="button" class="sino-fechar" id="sinoFechar" aria-label="Fechar novidades">${svg(16, ICONE.fechar)}</button></div>
            <ul class="sino-lista" id="sinoLista"></ul>
            ${rodapeSino}
          </div>
        </div>`;

  // na busca: Login (painel); nas outras: Voltar à busca
  const saida = naBusca
    ? `<a class="site-header__login" href="admin/">${svg(14, ICONE.login)}Login</a>`
    : `<a class="site-header__login" href="${r("")}">${svg(14, ICONE.voltar)}Voltar à busca</a>`;

  // tema por último (tema.js cuida do clique e do rótulo)
  const tema = `<button type="button" class="btn-tema" aria-label="Usar tema escuro" title="Tema escuro">${svg(16, ICONE.lua, "tema-lua")}${svg(16, ICONE.sol, "tema-sol")}</button>`;

  header.innerHTML = `
      <div class="site-header__inner">
        ${categorias}
        ${marca}
          <img data-logo src="${r("design-system/assets/brand/logo-completo-gentequemove-roxo-quadrado-laranja.svg")}" alt="CBS · Gente que move o cuidado" width="160" />
        </a>
        <span class="site-header__label">${ROTULO[pagina] || ""}</span>
        ${novidades}
        ${cotacao}
        ${app}
        ${sino}
        ${saida}
        ${tema}
      </div>`;
})();
