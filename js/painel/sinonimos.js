/* Aba Sinônimos: dicionário da busca do site (criar, editar, excluir, prévia de produtos). */
import { normalizar, escaparHtml as esc } from "../comum/texto.js";
import { $, api, estado, E } from "./estado.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { aviso } from "./util.js";

/* ---------------- aba Sinônimos (dicionário da busca do site) ---------------- */

const MSG_FALTA_008 =
  "O dicionário de sinônimos ainda não existe no Supabase. Rode o arquivo supabase/migracoes/008_sinonimos.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

let sinonimoEmEdicao = null;

const limparPalavraSin = (p) => String(p ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const chaveSin = (p) => normalizar(limparPalavraSin(p));

// Mesmo critério da busca do site: até 4 letras = palavra inteira; mais longas = começo de palavra
function regexSinonimo(palavra) {
  const p = chaveSin(palavra).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${p}${chaveSin(palavra).length <= 4 ? "(?![a-z0-9])" : ""}`);
}

export async function carregarSinonimos() {
  const aviso008 = $("#avisoSinonimos");
  try {
    E.sinonimos = await api.listarSinonimos();
    aviso008.hidden = true;
    $("#formNovoSinonimo").querySelectorAll("input, button").forEach((el) => (el.disabled = false));
  } catch (err) {
    E.sinonimos = [];
    aviso008.hidden = false;
    aviso008.innerHTML =
      window.CBSIcon("triangle-alert", 20) +
      `<div>${err.status === 404 ? esc(MSG_FALTA_008).replace("supabase/migracoes/008_sinonimos.sql", "<code>supabase/migracoes/008_sinonimos.sql</code>") : esc(err.message)}</div>`;
    $("#formNovoSinonimo").querySelectorAll("input, button").forEach((el) => (el.disabled = err.status === 404));
  }
  renderizarSinonimos();
}

function renderizarSinonimos() {
  const filtro = chaveSin($("#filtroSinonimos").value);
  const lista = E.sinonimos.filter((g) => !filtro || g.palavras.some((p) => chaveSin(p).includes(filtro)));
  $("#infoSinonimos").textContent = `${fmt.format(E.sinonimos.length)} grupo(s)` + (filtro ? ` · ${fmt.format(lista.length)} no filtro` : "");
  if (!lista.length) {
    $("#corpoSinonimos").innerHTML = `<tr><td colspan="3" class="vazio">${E.sinonimos.length ? "Nenhum grupo com esse filtro." : "Nenhum grupo de sinônimos ainda. Adicione o primeiro acima."}</td></tr>`;
    return;
  }
  $("#corpoSinonimos").innerHTML = lista
    .map((g) => {
      const res = g.palavras.map(regexSinonimo);
      let noGrupo = 0;
      const porPalavra = g.palavras.map(() => 0);
      for (const prod of estado.produtos) {
        let algum = false;
        res.forEach((re, i) => {
          if (re.test(prod._buscaFull)) { porPalavra[i]++; algum = true; }
        });
        if (algum) noGrupo++;
      }
      const chips = g.palavras
        .map((p, i) => `<span class="tag-pill tag-pill--sinonimo">${esc(p)} <span class="tag-pill__n">${fmt.format(porPalavra[i])}</span></span>`)
        .join("");
      return `<tr>
          <td><div class="lista-sinonimos">${chips}</div></td>
          <td class="c-num">${fmt.format(noGrupo)}</td>
          <td class="c-acoes">
            <button class="btn btn--secundario btn--sm" data-sin-acao="editar" data-sin="${g.id}">${window.CBSIcon("pencil", 14)}Editar</button>
            <button class="btn btn--secundario btn--sm btn--excluir" data-sin-acao="excluir" data-sin="${g.id}">${window.CBSIcon("trash-2", 14)}Excluir</button>
          </td>
        </tr>`;
    })
    .join("");
}

// Lê "cx, caixa" -> ["cx", "caixa"] e confere as regras. Devolve { palavras } ou { erro }.
function validarSinonimos(texto, idIgnorar = null) {
  const palavras = [];
  for (const bruta of String(texto ?? "").split(/[,;\n]/)) {
    const p = limparPalavraSin(bruta);
    if (!p) continue;
    if (p.startsWith("-") || p.includes('"')) return { erro: `"${p}": não use hífen no começo nem aspas (são comandos da busca).` };
    if (p.length < 2) return { erro: `"${p}": cada palavra precisa de pelo menos 2 caracteres.` };
    if (p.length > 60) return { erro: `"${p.slice(0, 20)}...": palavra longa demais (máx. 60 caracteres).` };
    if (!palavras.some((x) => chaveSin(x) === chaveSin(p))) palavras.push(p);
  }
  if (palavras.length < 2) return { erro: "Digite pelo menos 2 palavras diferentes, separadas por vírgula. Ex.: cx, caixa" };
  if (palavras.length > 20) return { erro: "Um grupo pode ter no máximo 20 palavras." };
  for (const p of palavras) {
    const outro = E.sinonimos.find((g) => g.id !== idIgnorar && g.palavras.some((x) => chaveSin(x) === chaveSin(p)));
    if (outro) return { erro: `"${p}" já está no grupo "${outro.palavras.join(", ")}". Edite aquele grupo (ou tire a palavra dele) para não repetir.` };
  }
  return { palavras };
}

function atualizarPreviaSinonimo() {
  const r = validarSinonimos($("#sinonimoPalavras").value, sinonimoEmEdicao && sinonimoEmEdicao.id);
  $("#sinonimoPreview").innerHTML = r.erro
    ? `<span class="dica">${esc(r.erro)}</span>`
    : `A busca vai tratar como iguais: ${r.palavras.map((p) => `<strong>${esc(p)}</strong>`).join(" = ")}`;
  $("#btnSalvarSinonimo").disabled = Boolean(r.erro);
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#filtroSinonimos").addEventListener("input", renderizarSinonimos);

  $("#formNovoSinonimo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#novoSinonimoErro");
    erro.textContent = "";
    const r = validarSinonimos($("#novoSinonimo").value);
    if (r.erro) {
      erro.textContent = r.erro;
      return;
    }
    const btn = $("#btnNovoSinonimo");
    btn.disabled = true;
    try {
      await api.criarSinonimo(r.palavras);
      $("#novoSinonimo").value = "";
      await carregarSinonimos();
      aviso(`Grupo "${r.palavras.join(", ")}" criado. Vale para quem abrir ou recarregar o site.`);
    } catch (err) {
      erro.textContent = err.status === 404 ? MSG_FALTA_008 : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#corpoSinonimos").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sin-acao]");
    if (!btn) return;
    sinonimoEmEdicao = E.sinonimos.find((g) => String(g.id) === btn.dataset.sin) || null;
    if (!sinonimoEmEdicao) return;
    if (btn.dataset.sinAcao === "editar") {
      $("#sinonimoPalavras").value = sinonimoEmEdicao.palavras.join(", ");
      $("#sinonimoErro").textContent = "";
      atualizarPreviaSinonimo();
      $("#dlgSinonimo").showModal();
      $("#sinonimoPalavras").focus();
    } else {
      $("#txtSinonimoExcluir").textContent = sinonimoEmEdicao.palavras.join(", ");
      $("#sinonimoExcluirErro").textContent = "";
      $("#dlgSinonimoExcluir").showModal();
    }
  });

  $("#sinonimoPalavras").addEventListener("input", atualizarPreviaSinonimo);

  $("#btnCancelarSinonimo").addEventListener("click", () => $("#dlgSinonimo").close());

  $("#btnFecharSinonimo").addEventListener("click", () => $("#dlgSinonimo").close());

  $("#btnNaoExcluirSinonimo").addEventListener("click", () => $("#dlgSinonimoExcluir").close());

  $("#btnFecharSinonimoExcluir").addEventListener("click", () => $("#dlgSinonimoExcluir").close());

  $("#formSinonimo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = validarSinonimos($("#sinonimoPalavras").value, sinonimoEmEdicao.id);
    if (r.erro) return;
    const btn = $("#btnSalvarSinonimo");
    btn.disabled = true;
    try {
      await api.atualizarSinonimo(sinonimoEmEdicao.id, r.palavras);
      $("#dlgSinonimo").close();
      await carregarSinonimos();
      aviso("Grupo de sinônimos atualizado.");
    } catch (err) {
      $("#sinonimoErro").textContent = err.status === 404 ? MSG_FALTA_008 : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#formSinonimoExcluir").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnSimExcluirSinonimo");
    btn.disabled = true;
    try {
      await api.excluirSinonimo(sinonimoEmEdicao.id);
      $("#dlgSinonimoExcluir").close();
      await carregarSinonimos();
      aviso("Grupo de sinônimos excluído.");
    } catch (err) {
      $("#sinonimoExcluirErro").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
