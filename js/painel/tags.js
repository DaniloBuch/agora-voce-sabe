/* Aba Tags: lista com contagem, possíveis duplicadas, renomear/mesclar e excluir. */
import { normalizar, escaparHtml as esc } from "../comum/texto.js";
import { estado, $, api } from "./estado.js";
import { separarTags, aviso } from "./util.js";
import { chaveTag } from "./massa.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { carregarProdutos } from "./carga.js";

/* ---------------- aba Tags (renomear / mesclar / excluir) ---------------- */

// (chaveTag, definida acima, compara como o banco: "curativo" e "CURATIVO" são a mesma tag)
// chave "frouxa" para achar possíveis duplicadas: sem acento, sem pontuação, sem plural simples
function chaveSimilar(t) {
  return normalizar(t)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

export function indiceTags() {
  const mapa = new Map(); // chaveTag -> {nome, n, grafias:Map(grafia->n), similares:[]}
  for (const p of estado.produtos) {
    const vistas = new Set();
    for (const t of separarTags(p.tags)) {
      const k = chaveTag(t);
      let e = mapa.get(k);
      if (!e) mapa.set(k, (e = { nome: t, n: 0, grafias: new Map(), similares: [] }));
      e.grafias.set(t, (e.grafias.get(t) || 0) + 1);
      if (!vistas.has(k)) {
        vistas.add(k);
        e.n++;
      }
    }
  }
  for (const e of mapa.values()) {
    // grafia exibida = a mais usada
    e.nome = [...e.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const grupos = new Map();
  for (const e of mapa.values()) {
    const k = chaveSimilar(e.nome);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(e);
  }
  for (const g of grupos.values()) {
    if (g.length > 1) for (const e of g) e.similares = g.filter((o) => o !== e).map((o) => o.nome);
  }
  return mapa;
}

export function renderizarTags() {
  const mapa = indiceTags();
  const termos = normalizar($("#filtroTags").value).split(/\s+/).filter(Boolean);
  const soDup = $("#soDuplicadas").checked;
  const todas = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const lista = todas.filter(
    (e) =>
      termos.every((t) => normalizar(e.nome).includes(t)) &&
      (!soDup || e.similares.length > 0 || e.grafias.size > 1),
  );
  const MAX = 300;
  const duplicadas = todas.filter((e) => e.similares.length > 0 || e.grafias.size > 1).length;
  $("#infoTags").textContent =
    `${fmt.format(todas.length)} tags · ${fmt.format(duplicadas)} com possível duplicata` +
    (lista.length > MAX ? ` · mostrando ${MAX} de ${fmt.format(lista.length)}, use o filtro` : "");

  $("#corpoTags").innerHTML =
    lista.length === 0
      ? `<tr><td colspan="4" class="vazio">Nenhuma tag encontrada.</td></tr>`
      : lista
          .slice(0, MAX)
          .map((e) => {
            const obs = [];
            if (e.grafias.size > 1) obs.push(`grafias diferentes: ${[...e.grafias.keys()].map(esc).join(", ")}`);
            if (e.similares.length) obs.push(`parecida com: ${e.similares.map(esc).join(", ")}`);
            return `<tr>
                <td><span class="tag-pill">${esc(e.nome)}</span></td>
                <td class="c-num">${fmt.format(e.n)}</td>
                <td class="obs">${obs.length ? `<span class="aviso-tag">${obs.join(" · ")}</span>` : ""}</td>
                <td class="c-acoes">
                  <button class="btn btn--secundario btn--sm" data-tag-acao="renomear" data-tag="${esc(e.nome)}">${window.CBSIcon("pencil", 14)}Renomear</button>
                  <button class="btn btn--secundario btn--sm btn--excluir" data-tag-acao="excluir" data-tag="${esc(e.nome)}">${window.CBSIcon("trash-2", 14)}Excluir</button>
                </td>
              </tr>`;
          })
          .join("");
}

let timerTags = null;

const MSG_FALTA_004 =
  "A função de gerenciar tags ainda não existe no Supabase. Rode o arquivo supabase/migracoes/004_gerenciar_tags.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

let tagEmEdicao = null; // {nome, n}

function produtosComTag(nome) {
  const k = chaveTag(nome);
  return estado.produtos.filter((p) => separarTags(p.tags).some((t) => chaveTag(t) === k));
}

function atualizarPreviaTag() {
  const novo = chaveTag($("#tagNovoNome").value);
  const origem = produtosComTag(tagEmEdicao);
  const btn = $("#btnSalvarTag");
  const alvo = $("#tagPreview");
  if (!novo) {
    alvo.innerHTML = `<span class="dica">Digite o novo nome. Para remover a tag, use o botão Excluir.</span>`;
    btn.disabled = true;
    return;
  }
  const mesmaChave = novo === chaveTag(tagEmEdicao);
  const textoAtual = new Set(origem.flatMap((p) => separarTags(p.tags).filter((t) => chaveTag(t) === novo)));
  const precisaMudar = !mesmaChave || [...textoAtual].some((t) => t !== novo);
  if (mesmaChave) {
    alvo.innerHTML = precisaMudar
      ? `Vai padronizar a grafia para <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`
      : `<span class="dica">O nome é igual ao atual; nada a mudar.</span>`;
    btn.disabled = !precisaMudar;
    return;
  }
  const destino = produtosComTag(novo);
  if (destino.length) {
    const ambos = origem.filter((p) => destino.includes(p)).length;
    alvo.innerHTML =
      `<strong>Mesclar:</strong> a tag <strong>${esc(novo)}</strong> já existe (${fmt.format(destino.length)} produtos). ` +
      `${fmt.format(origem.length)} produto(s) passam a usá-la` +
      (ambos ? `; ${fmt.format(ambos)} já tinham as duas e ficarão com uma só` : "") +
      ".";
  } else {
    alvo.innerHTML = `Vai trocar por <strong>${esc(novo)}</strong> em ${fmt.format(origem.length)} produto(s).`;
  }
  btn.disabled = false;
}

function abrirRenomearTag(nome) {
  tagEmEdicao = nome;
  $("#tagOrigem").textContent = `Tag atual: ${nome} (${fmt.format(produtosComTag(nome).length)} produtos)`;
  $("#tagNovoNome").value = nome.toLocaleUpperCase("pt-BR");
  $("#tagErro").textContent = "";
  atualizarPreviaTag();
  $("#dlgTag").showModal();
  $("#tagNovoNome").focus();
  $("#tagNovoNome").select();
}

async function aplicarRenomeio(novo, dialogo, botao, erroEl, textoBotao, mensagem) {
  erroEl.textContent = "";
  botao.disabled = true;
  botao.textContent = "Aplicando...";
  try {
    const r = await api.renomearTag(tagEmEdicao, novo);
    await carregarProdutos();
    renderizarTags();
    dialogo.close();
    aviso(mensagem(r.alterados));
  } catch (err) {
    erroEl.textContent = err.status === 404 ? MSG_FALTA_004 : err.message;
  } finally {
    botao.textContent = textoBotao;
    botao.disabled = false;
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#filtroTags").addEventListener("input", () => {
    clearTimeout(timerTags);
    timerTags = setTimeout(renderizarTags, 200);
  });

  $("#soDuplicadas").addEventListener("change", renderizarTags);

  $("#corpoTags").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tag-acao]");
    if (!btn) return;
    const nome = btn.dataset.tag;
    if (btn.dataset.tagAcao === "renomear") abrirRenomearTag(nome);
    else {
      tagEmEdicao = nome;
      $("#txtTagExcluir").textContent = `${nome} (${fmt.format(produtosComTag(nome).length)} produtos)`;
      $("#tagExcluirErro").textContent = "";
      $("#dlgTagExcluir").showModal();
    }
  });

  $("#tagNovoNome").addEventListener("input", atualizarPreviaTag);

  $("#btnCancelarTag").addEventListener("click", () => $("#dlgTag").close());

  $("#btnFecharTag").addEventListener("click", () => $("#dlgTag").close());

  $("#btnNaoExcluirTag").addEventListener("click", () => $("#dlgTagExcluir").close());

  $("#btnFecharTagExcluir").addEventListener("click", () => $("#dlgTagExcluir").close());

  $("#formTag").addEventListener("submit", (e) => {
    e.preventDefault();
    const novo = $("#tagNovoNome").value.trim().toLocaleUpperCase("pt-BR").replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!novo) return;
    aplicarRenomeio(novo, $("#dlgTag"), $("#btnSalvarTag"), $("#tagErro"), "Aplicar", (n) =>
      `Tag atualizada em ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.`,
    );
  });

  $("#formTagExcluir").addEventListener("submit", (e) => {
    e.preventDefault();
    aplicarRenomeio("", $("#dlgTagExcluir"), $("#btnSimExcluirTag"), $("#tagExcluirErro"), "Excluir tag", (n) =>
      `Tag removida de ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.`,
    );
  });
}
