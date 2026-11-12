/* Link para o site oficial (cbsmed.com.br): endereço do produto, ícones de foto/ficha
   e a miniatura da foto ao passar o mouse. */
import { escaparHtml } from "../comum/texto.js";
import { tbody, resultsContainer } from "./dom.js";
import { renderizarPagina } from "./tabela.js";
import { E } from "./estado.js";

/* ---------- Link para o site oficial (cbsmed.com.br) ---------- */

const URL_SITE_PRODUTO = "https://cbsmed.com.br/produto/";

// Endereços exatos sincronizados com o site (tabela links_site). Para gastar pouco tráfego, a busca
// só pede os códigos da página que está na tela, e guarda o que já pediu.
let linksSincronizados = false; // true quando a tabela existe e tem dados

const cacheLinks = new Map(); // sku -> { caminho, ficha, imagem } | null (não está no site)

const linksPedidos = new Set();

// Descrição técnica -> endereço do produto, do mesmo jeito que o WordPress monta:
// sem acento (ç -> c), minúsculas, "/" e "." viram traço, o resto que não é letra,
// número, espaço, "_" ou "-" sai (vírgula, %, +, parênteses...), espaços viram traço.
//   "FILME TRANSP TEGADERM CHG 8,5X11,5 C/CLOREX 2% 3M 1657R(25)"
//   -> "filme-transp-tegaderm-chg-85x115-c-clorex-2-3m-1657r25"
export function slugProduto(descricao) {
  return String(descricao ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\/.\u2013\u2014]/g, "-")
    .replace(/\u00d7/g, "x")
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Endereço do produto no site. Com a sincronização, usa o endereço exato (resolve o "-2" do WordPress);
// produto que não estava no site na última sincronização vai para a busca do site, que abre direto
// o produto quando o nome bate. Sem sincronização (ou enquanto carrega), monta pela descrição.
export function linkDoProduto(item) {
  const info = linksSincronizados ? cacheLinks.get(item.sku) : undefined;
  if (info) {
    const url = info.caminho.startsWith("http") ? info.caminho : `${URL_SITE_PRODUTO}${info.caminho}/`;
    return { url, exato: true, ficha: info.ficha || "", imagem: info.imagem || "", sincronizado: true };
  }
  if (info === null) {
    return { url: `https://cbsmed.com.br/?s=${encodeURIComponent(item.descricao.replace(/\s+/g, " ").trim())}&post_type=product`, exato: false, ficha: "", imagem: "" };
  }
  return { url: `${URL_SITE_PRODUTO}${slugProduto(item.descricao)}/`, exato: true, ficha: "", imagem: "" };
}

const ICONE_SITE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';

const ICONE_FICHA =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 18v-6"></path><path d="m9 15 3 3 3-3"></path></svg>';

// Ícone de foto: o produto tem imagem cadastrada no site (passar o mouse mostra a miniatura)
const ICONE_FOTO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';

// Botão do site:
//   com foto -> ícone de foto, em roxo; passar o mouse mostra a miniatura
//   qualquer outro caso (sem foto, fora do site, ainda sem sincronizar) -> ícone de link, em cinza,
//   para o roxo significar sempre "tem foto no site"
function htmlSite(item) {
  const { url, exato, ficha, imagem, sincronizado } = linkDoProduto(item);
  const semFoto = sincronizado && !imagem;
  const dica = !exato
    ? "Procurar no site oficial"
    : imagem
      ? "Ver no site: foto e ficha técnica"
      : semFoto
        ? "Ver no site (ainda sem foto cadastrada)"
        : "Ver no site: imagem e ficha técnica";
  const nome = escaparHtml(item.descricao);
  const classe = imagem ? " tem-imagem" : " sem-imagem";
  const site =
    `<a class="link-site${classe}" href="${escaparHtml(url)}" target="_blank" rel="noopener" data-dica="${dica}"` +
    `${imagem ? ` data-imagem="${escaparHtml(imagem)}"` : ""} aria-label="${dica}: ${nome} (abre em nova aba)">${imagem ? ICONE_FOTO : ICONE_SITE}</a>`;
  const pdf = ficha
    ? `<a class="link-site link-ficha" href="${escaparHtml(ficha)}" target="_blank" rel="noopener" download data-dica="Baixar ficha técnica (PDF)" aria-label="Baixar ficha técnica (PDF): ${nome}">${ICONE_FICHA}</a>`
    : `<span class="link-vazio" aria-hidden="true"></span>`;
  return site + pdf;
}

export function celulaSite(item) {
  return `<td class="col-site" data-sku-site="${escaparHtml(item.sku)}">${htmlSite(item)}</td>`;
}

// Pede ao banco os links dos códigos da página atual que ainda não foram pedidos e atualiza só essas células
export async function carregarLinksDaPagina(itens) {
  if (!linksSincronizados || !CBS_API.linksSitePorSkus) return;
  const faltam = itens.map((i) => i.sku).filter((sku) => !linksPedidos.has(sku));
  if (!faltam.length) return;
  faltam.forEach((sku) => linksPedidos.add(sku));
  try {
    const linhas = await CBS_API.linksSitePorSkus(faltam);
    const achados = new Map(linhas.map((l) => [l.sku, l]));
    faltam.forEach((sku) => cacheLinks.set(sku, achados.get(sku) || null));
  } catch (_) {
    faltam.forEach((sku) => linksPedidos.delete(sku)); // tenta de novo na próxima página
    return;
  }
  const porSku = new Map(itens.map((i) => [i.sku, i]));
  tbody.querySelectorAll("td.col-site[data-sku-site]").forEach((td) => {
    const item = porSku.get(td.dataset.skuSite);
    if (item && faltam.includes(item.sku)) td.innerHTML = htmlSite(item);
  });
}

// Uma consulta leve na abertura: a sincronização com o site já foi feita? (sem ela vale o slugProduto)
export async function verificarLinksSite() {
  if (!window.CBS_API || !CBS_API.configurado || !CBS_API.resumoLinksSite) return;
  try {
    linksSincronizados = (await CBS_API.resumoLinksSite()).total > 0;
    if (linksSincronizados && E.estadoLista && resultsContainer.style.display === "block") renderizarPagina();
  } catch (_) {
    linksSincronizados = false; // migração 009/010 ainda não rodou: link pela descrição
  }
}

/* Miniatura da foto ao passar o mouse no ícone do site (carrega só a imagem que a pessoa pediu) */
const previaSite = document.createElement("div");

function mostrarPrevia(link) {
  const src = link.dataset.imagem;
  if (!src) return;
  previaSite.innerHTML = `<img src="${escaparHtml(src)}" alt="" width="180" height="180" /><span>Ver no site: imagem e ficha técnica</span>`;
  previaSite.querySelector("img").addEventListener("error", esconderPrevia, { once: true });
  previaSite.hidden = false;
  const r = link.getBoundingClientRect();
  const largura = previaSite.offsetWidth, altura = previaSite.offsetHeight;
  let top = r.top + r.height / 2 - altura / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - altura - 8));
  previaSite.style.top = `${top + window.scrollY}px`;
  previaSite.style.left = `${Math.max(8, r.left - largura - 10) + window.scrollX}px`;
}

function esconderPrevia() {
  previaSite.hidden = true;
  previaSite.innerHTML = "";
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  previaSite.className = "previa-site";

  previaSite.hidden = true;

  previaSite.setAttribute("aria-hidden", "true");

  document.body.appendChild(previaSite);

  tbody.addEventListener("mouseover", (e) => {
    const link = e.target.closest("a.link-site.tem-imagem");
    if (link && !link.contains(e.relatedTarget)) mostrarPrevia(link);
  });

  tbody.addEventListener("mouseout", (e) => {
    const link = e.target.closest("a.link-site.tem-imagem");
    if (link && !link.contains(e.relatedTarget)) esconderPrevia();
  });

  tbody.addEventListener("focusin", (e) => {
    const link = e.target.closest("a.link-site.tem-imagem");
    if (link && link.matches(":focus-visible")) mostrarPrevia(link);
  });

  tbody.addEventListener("focusout", esconderPrevia);

  window.addEventListener("scroll", esconderPrevia, { passive: true });
}
