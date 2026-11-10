/* ==========================================================================
   Service worker do "Agora Você Sabe" (PWA)

   - Guarda o "esqueleto" do site (HTML, CSS, JS, fontes, marca) para o app
     instalado abrir rápido e funcionar sem internet.
   - Sempre tenta a REDE primeiro: com internet, todo mundo recebe a versão
     nova logo que os arquivos sobem no GitHub. O cache é só o plano B.
   - Não mexe nas chamadas ao Supabase nem ao site cbsmed.com.br (outros
     endereços passam direto). A base de produtos para uso offline é guardada
     pelo próprio script.js (IndexedDB).

   Ao mudar a lista de arquivos abaixo, aumente a VERSAO.
   ========================================================================== */
const VERSAO = "v7";
const CACHE = `agora-voce-sabe-${VERSAO}`;
const ESPERA_REDE_MS = 4000; // rede lenta: depois disso usa o que está guardado (se houver)

const ESSENCIAIS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "api.js",
  "config.js",
  "lista-diaria.js",
  "cotacao-store.js",
  "areas-icones.js",
  "tema.js",
  "tema.css",
  "cotacao/",
  "cotacao/index.html",
  "cotacao/cotacao.js",
  "cotacao/cotacao.css",
  "manifest.webmanifest",
  "icon.png",
  "icons/icone-192.png",
  "icons/icone-512.png",
  "design-system/styles.css",
  "design-system/tokens/fonts.css",
  "design-system/tokens/colors.css",
  "design-system/tokens/typography.css",
  "design-system/tokens/spacing.css",
  "design-system/tokens/radii.css",
  "design-system/tokens/elevation.css",
  "design-system/tokens/motion.css",
  "design-system/tokens/base.css",
  "design-system/assets/fonts/Quicksand-VariableFont_wght.ttf",
  "design-system/assets/brand/logo-completo-gentequemove-roxo-quadrado-laranja.svg",
  "design-system/assets/brand/logo-completo-gentequemove-branco.svg",
  "design-system/assets/brand/simbolo-s-roxo-quadrado-laranja.svg",
  "design-system/assets/brand/grafismo-sorriso-roxo.svg",
  "design-system/assets/brand/grafismo-sorriso-branco.svg",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      // um arquivo que falhar não impede a instalação dos outros
      Promise.allSettled(ESSENCIAIS.map((url) => cache.add(new Request(url, { cache: "reload" })))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("agora-voce-sabe-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, cbsmed.com.br: direto na rede
  evento.respondWith(redePrimeiro(req));
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const navegacao = req.mode === "navigate";
  const guardado = () =>
    navegacao
      ? cache.match(req, { ignoreSearch: true }).then((r) => r || cache.match("index.html"))
      : cache.match(req, { ignoreSearch: true });

  // páginas com ?q=... guardadas sem a busca, para não encher o cache com uma cópia por pesquisa
  const chave = navegacao ? new URL(req.url).pathname : req;
  const daRede = fetch(req).then((resp) => {
    if (resp && resp.ok && resp.type === "basic") cache.put(chave, resp.clone()).catch(() => {});
    return resp;
  });

  try {
    // rede lenta: se em 4 s não respondeu e há cópia guardada, usa a cópia (a rede segue atualizando o cache)
    const tempo = new Promise((resolver) => setTimeout(resolver, ESPERA_REDE_MS, "tempo"));
    const primeiro = await Promise.race([daRede, tempo]);
    if (primeiro !== "tempo") return primeiro;
    const copia = await guardado();
    return copia || (await daRede);
  } catch (_) {
    const copia = await guardado();
    if (copia) return copia;
    throw _;
  }
}
