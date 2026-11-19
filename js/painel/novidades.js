/* Aba Novidades: mensagens do sino do site (sugestões, publicar, agendar, editar, excluir). */
import { api, $ } from "./estado.js";
import { escaparHtml as esc } from "../comum/texto.js";
import { fmtDataHora as fmtData } from "../comum/numeros.js";
import { aviso } from "./util.js";

/* ---------------- aba Novidades (mensagens do sino do site) ---------------- */

const nov = { linhas: [], sugestoes: [], emEdicao: null, chaveEmEdicao: null, excluindo: null };

// Sugestões que chegam com cada atualização do site (arquivo novidades-site.json do repositório)
async function lerSugestoesDoSite() {
  try {
    const r = await fetch("../novidades-site.json", { cache: "no-store" });
    return r.ok ? await r.json() : [];
  } catch (_) {
    return [];
  }
}

export async function carregarNovidades() {
  const [linhas, sugestoes] = await Promise.all([api.listarNovidadesPainel().catch(() => null), lerSugestoesDoSite()]);
  $("#avisoNovidades").hidden = linhas !== null;
  $("#btnNovaNovidade").disabled = linhas === null;
  nov.linhas = linhas || [];
  const usadas = new Set(nov.linhas.map((n) => n.chave).filter(Boolean));
  nov.sugestoes = linhas === null ? [] : sugestoes.filter((x) => x && x.chave && !usadas.has(x.chave));
  renderizarNovidades();
}

function renderizarNovidades() {
  const selo = $("#seloSugestoes");
  selo.hidden = nov.sugestoes.length === 0;
  selo.textContent = String(nov.sugestoes.length);
  $("#novSugestoes").innerHTML = nov.sugestoes.length
    ? nov.sugestoes
        .map(
          (x) => `<article class="nov-sugestao">
          <h4>${esc(x.titulo)}</h4>
          <p class="nov-texto">${esc(x.texto)}</p>
          <div class="nov-sugestao__acoes">
            <button type="button" class="btn btn--primario btn--sm" data-sug="publicar" data-chave="${esc(x.chave)}">${window.CBSIcon("check", 14)}Publicar</button>
            <button type="button" class="btn btn--secundario btn--sm" data-sug="editar" data-chave="${esc(x.chave)}">${window.CBSIcon("pencil", 14)}Editar e publicar</button>
            <button type="button" class="btn btn--secundario btn--sm" data-sug="ignorar" data-chave="${esc(x.chave)}">Ignorar</button>
          </div>
        </article>`,
        )
        .join("")
    : `<p class="dica">Nenhuma sugestão pendente. Elas aparecem aqui quando o site é atualizado.</p>`;
  const agora = Date.now();
  $("#corpoNovidades").innerHTML = nov.linhas.length
    ? nov.linhas
        .map((n) => {
          const quando = Date.parse(n.publicado_em);
          const sit = n.status === "ignorada" ? "ignorada" : quando > agora ? "agendada" : "publicada";
          const rotulo = { ignorada: "Sugestão ignorada", agendada: "Agendada", publicada: "Publicada" }[sit];
          const excl = nov.excluindo === n.id;
          return `<tr>
          <td class="c-data">${esc(fmtData.format(new Date(quando)))}</td>
          <td><strong>${esc(n.titulo)}</strong><span class="nov-texto">${esc(n.texto)}</span></td>
          <td class="c-status"><span class="status-pill status-pill--${sit}">${rotulo}</span></td>
          <td class="c-acoes">
            <button class="btn btn--secundario btn--sm" data-nov="editar" data-id="${n.id}">${window.CBSIcon("pencil", 14)}${n.status === "ignorada" ? "Publicar" : "Editar"}</button>
            <button class="btn btn--secundario btn--sm btn--excluir" data-nov="excluir" data-id="${n.id}">${window.CBSIcon("trash-2", 14)}${excl ? "Confirmar" : "Excluir"}</button>
          </td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="vazio">Nenhuma mensagem ainda.</td></tr>`;
}

// "2026-11-10T15:30" (campo datetime-local) <-> ISO
function paraCampoData(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function abrirNovidade({ id = null, chave = null, titulo = "", texto = "", publicado_em = null, publicar = false } = {}) {
  nov.emEdicao = id;
  nov.chaveEmEdicao = chave;
  $("#novidadeTitulo").textContent = id && !publicar ? "Editar mensagem" : chave ? "Publicar sugestão" : "Nova mensagem";
  $("#nTitulo").value = titulo;
  $("#nTexto").value = texto;
  $("#nData").value = paraCampoData(publicar ? null : publicado_em);
  $("#btnSalvarNovidade").textContent = id && !publicar ? "Salvar" : "Publicar";
  $("#nErro").textContent = "";
  $("#dlgNovidade").showModal();
  $("#nTitulo").focus();
}

async function acaoNovidade(fn, msg) {
  try {
    await fn();
    await carregarNovidades();
    aviso(msg);
  } catch (err) {
    aviso(err.message, true);
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#btnNovaNovidade").addEventListener("click", () => abrirNovidade());

  $("#btnCancelarNovidade").addEventListener("click", () => $("#dlgNovidade").close());

  $("#btnFecharNovidade").addEventListener("click", () => $("#dlgNovidade").close());

  $("#novSugestoes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sug]");
    if (!b) return;
    const x = nov.sugestoes.find((s) => s.chave === b.dataset.chave);
    if (!x) return;
    if (b.dataset.sug === "editar") return abrirNovidade({ chave: x.chave, titulo: x.titulo, texto: x.texto });
    b.disabled = true;
    if (b.dataset.sug === "publicar") {
      acaoNovidade(() => api.salvarNovidade(null, { chave: x.chave, titulo: x.titulo, texto: x.texto, status: "publicada", publicado_em: new Date().toISOString() }), "Mensagem publicada no sino.");
    } else {
      acaoNovidade(() => api.salvarNovidade(null, { chave: x.chave, titulo: x.titulo, texto: x.texto, status: "ignorada" }), "Sugestão ignorada (dá para publicar depois, na lista abaixo).");
    }
  });

  $("#corpoNovidades").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-nov]");
    if (!b) return;
    const n = nov.linhas.find((x) => String(x.id) === b.dataset.id);
    if (!n) return;
    if (b.dataset.nov === "editar") {
      abrirNovidade({ id: n.id, chave: n.chave, titulo: n.titulo, texto: n.texto, publicado_em: n.publicado_em, publicar: n.status === "ignorada" });
    } else if (nov.excluindo !== n.id) {
      nov.excluindo = n.id; // primeiro clique pede confirmação
      renderizarNovidades();
    } else {
      nov.excluindo = null;
      acaoNovidade(() => api.excluirNovidade(n.id), "Mensagem excluída.");
    }
  });

  $("#formNovidade").addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = $("#nTitulo").value.trim();
    const texto = $("#nTexto").value.trim();
    const data = $("#nData").value ? new Date($("#nData").value) : new Date();
    if (!titulo) {
      $("#nErro").textContent = "Escreva o título.";
      return;
    }
    if (Number.isNaN(data.getTime())) {
      $("#nErro").textContent = "Data inválida.";
      return;
    }
    const campos = { titulo, texto, status: "publicada", publicado_em: data.toISOString() };
    const btn = $("#btnSalvarNovidade");
    btn.disabled = true;
    try {
      if (nov.emEdicao) await api.salvarNovidade(nov.emEdicao, campos);
      else await api.salvarNovidade(null, { ...campos, chave: nov.chaveEmEdicao || null });
      $("#dlgNovidade").close();
      await carregarNovidades();
      aviso(data.getTime() > Date.now() ? "Mensagem agendada." : "Mensagem publicada no sino.");
    } catch (err) {
      $("#nErro").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
