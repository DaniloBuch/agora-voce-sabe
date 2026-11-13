/* Áreas de atuação: ícones, escolha no cadastro e aba Áreas (nova, editar, mesclar, excluir). */
import { estado, api, $ } from "./estado.js";
import { chaveCat, nomeCategoriaValido } from "./categorias.js";
import { escaparHtml as esc } from "../comum/texto.js";
import { atualizarMassa } from "./massa.js";
import { fmtNum as fmt } from "../comum/numeros.js";
import { mostrarAba } from "./abas.js";
import { renderizarLista } from "./produtos.js";
import { carregarProdutos } from "./carga.js";
import { aviso } from "./util.js";

/* ---------------- áreas de atuação ---------------- */

const ICONES = window.CBS_AREAS_ICONES;

export function iconeArea(nome, tam = 16) {
  const a = estado.areas.find((x) => chaveCat(x.nome) === chaveCat(nome));
  return ICONES ? ICONES.svg(a ? a.icone : "", tam) : "";
}

// Lista = cadastradas (na ordem do painel) + as que algum produto usa e ainda não estão nela
export async function carregarAreas() {
  const tem = api.areasDisponiveis();
  document.body.classList.toggle("sem-areas", !tem);
  $("#avisoAreas").hidden = tem || !api.categoriasDisponiveis(); // o aviso das categorias vem antes
  if (!tem) {
    estado.areas = [];
    return;
  }
  const lista = (await api.listarAreas()).map((a) => ({ nome: a.nome, icone: a.icone }));
  for (const p of estado.produtos)
    for (const a of p.areas) if (!lista.some((x) => chaveCat(x.nome) === chaveCat(a))) lista.push({ nome: a, icone: "" });
  estado.areas = lista;
  const filtro = $("#filtroArea");
  filtro.innerHTML =
    `<option value="">Todas as áreas</option><option value="-">Sem área</option>` +
    lista.map((a) => `<option value="${esc(a.nome)}">${esc(a.nome)}</option>`).join("");
  if (![...filtro.options].some((o) => o.value === estado.area)) estado.area = "";
  filtro.value = estado.area;
}

// Caixinhas de área no diálogo do produto
export function desenharEscolhaAreas(marcadas) {
  const chaves = new Set((marcadas || []).map(chaveCat));
  $("#fAreas").innerHTML = estado.areas.length
    ? estado.areas
        .map(
          (a) =>
            `<label class="area-opcao"><input type="checkbox" value="${esc(a.nome)}"${chaves.has(chaveCat(a.nome)) ? " checked" : ""} />` +
            `${ICONES ? ICONES.svg(a.icone, 16) : ""}<span>${esc(a.nome)}</span></label>`,
        )
        .join("")
    : `<span class="dica">Nenhuma área cadastrada. Crie na aba Áreas.</span>`;
}

// Edição em massa: cada área alterna entre não alterar → + adicionar → − remover
const CICLO_MASSA = { "": "add", add: "rem", rem: "" };

export function desenharMassaAreas() {
  $("#fMassaAreas").innerHTML = estado.areas
    .map(
      (a) =>
        `<button type="button" class="area-opcao area-opcao--massa" data-area="${esc(a.nome)}" data-estado="">` +
        `<span class="area-opcao__sinal" aria-hidden="true"></span>${ICONES ? ICONES.svg(a.icone, 16) : ""}<span>${esc(a.nome)}</span></button>`,
    )
    .join("");
}

export function areasMassa() {
  const r = { add: [], rem: [] };
  if (!api.areasDisponiveis()) return r;
  $("#fMassaAreas").querySelectorAll("button[data-area]").forEach((b) => {
    if (b.dataset.estado === "add") r.add.push(b.dataset.area);
    if (b.dataset.estado === "rem") r.rem.push(b.dataset.area);
  });
  return r;
}

export function mudaAreas(p, ar) {
  const tem = new Set(p.areas.map(chaveCat));
  return ar.add.some((a) => !tem.has(chaveCat(a))) || ar.rem.some((a) => tem.has(chaveCat(a)));
}

/* ---------------- aba Áreas (nova / editar / mesclar / excluir) ---------------- */

const MSG_FALTA_011 =
  "As áreas de atuação ainda não existem no Supabase. Rode o arquivo supabase/migracoes/011_areas_atuacao.sql no SQL Editor (veja o SETUP-SUPABASE.md).";

const produtosDaArea = (nome) => estado.produtos.filter((p) => p.areas.some((a) => chaveCat(a) === chaveCat(nome)));

export function renderizarAreas() {
  const sem = estado.produtos.filter((p) => p.areas.length === 0).length;
  $("#infoAreas").textContent = `${fmt.format(estado.areas.length)} áreas · ${fmt.format(sem)} produtos sem área`;
  $("#corpoAreas").innerHTML = estado.areas.length
    ? estado.areas
        .map(
          (a) => `<tr>
        <td class="c-ico"><span class="area-ico-admin">${ICONES ? ICONES.svg(a.icone, 20) : ""}</span></td>
        <td><strong>${esc(a.nome)}</strong></td>
        <td class="c-num">${fmt.format(produtosDaArea(a.nome).length)}</td>
        <td class="c-acoes">
          <button class="btn btn--secundario btn--sm" data-area-acao="ver" data-area="${esc(a.nome)}">${window.CBSIcon("search", 14)}Ver produtos</button>
          <button class="btn btn--secundario btn--sm" data-area-acao="editar" data-area="${esc(a.nome)}">${window.CBSIcon("pencil", 14)}Editar</button>
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="vazio">Nenhuma área cadastrada.</td></tr>`;
}

let areaEmEdicao = null; // null = nova

let confirmandoExclusaoArea = false;

function desenharIcones(atual) {
  if (!ICONES) return;
  $("#areaIcones").innerHTML = ICONES.chaves
    .map(
      (k) =>
        `<label class="icone-opcao" title="${esc(ICONES.rotulo(k))}"><input type="radio" name="areaIcone" value="${k}"${k === atual ? " checked" : ""} />` +
        `${ICONES.svg(k, 22)}<span class="sr-only">${esc(ICONES.rotulo(k))}</span></label>`,
    )
    .join("");
}

function abrirArea(nome) {
  const area = nome ? estado.areas.find((a) => a.nome === nome) : null;
  areaEmEdicao = area ? area.nome : null;
  confirmandoExclusaoArea = false;
  $("#areaTitulo").textContent = area ? `Editar área: ${area.nome}` : "Nova área";
  $("#areaNome").value = area ? area.nome : "";
  desenharIcones(area && area.icone ? area.icone : "briefcase-medical");
  $("#btnExcluirArea").hidden = !area;
  $("#areaExcluirConfirma").hidden = true;
  $("#btnSalvarArea").textContent = "Salvar";
  $("#btnSalvarArea").className = "btn btn--primario";
  $("#areaErro").textContent = "";
  atualizarPreviaArea();
  $("#dlgArea").showModal();
  $("#areaNome").focus();
}

function atualizarPreviaArea() {
  const novo = nomeCategoriaValido($("#areaNome").value);
  const alvo = $("#areaPreview");
  if (!areaEmEdicao || !novo || chaveCat(novo) === chaveCat(areaEmEdicao)) {
    alvo.innerHTML = "";
    return;
  }
  const destino = estado.areas.find((a) => chaveCat(a.nome) === chaveCat(novo));
  const n = produtosDaArea(areaEmEdicao).length;
  alvo.innerHTML = destino
    ? `<strong>Mesclar:</strong> a área <strong>${esc(destino.nome)}</strong> já existe (${fmt.format(produtosDaArea(destino.nome).length)} produtos). ${fmt.format(n)} produto(s) passam a usá-la.`
    : `Vai trocar o nome em ${fmt.format(n)} produto(s).`;
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#fMassaAreas").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-area]");
    if (!b) return;
    b.dataset.estado = CICLO_MASSA[b.dataset.estado || ""];
    const rotulo = { add: "vai adicionar", rem: "vai remover", "": "não altera" }[b.dataset.estado];
    b.setAttribute("aria-label", `${b.dataset.area}: ${rotulo}`);
    atualizarMassa();
  });

  $("#areaNome").addEventListener("input", atualizarPreviaArea);

  $("#btnNovaArea").addEventListener("click", () => abrirArea(null));

  $("#btnCancelarArea").addEventListener("click", () => $("#dlgArea").close());

  $("#btnFecharArea").addEventListener("click", () => $("#dlgArea").close());

  $("#corpoAreas").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-area-acao]");
    if (!b) return;
    if (b.dataset.areaAcao === "ver") {
      estado.area = b.dataset.area;
      estado.pagina = 1;
      $("#filtroArea").value = b.dataset.area;
      mostrarAba("produtos");
      renderizarLista();
    } else abrirArea(b.dataset.area);
  });

  // Excluir: o primeiro clique pede confirmação (o botão Salvar vira "Excluir área")
  $("#btnExcluirArea").addEventListener("click", () => {
    confirmandoExclusaoArea = true;
    const n = produtosDaArea(areaEmEdicao).length;
    const conf = $("#areaExcluirConfirma");
    conf.hidden = false;
    conf.innerHTML = `${window.CBSIcon("triangle-alert", 20)}<div>Excluir a área <strong>${esc(areaEmEdicao)}</strong>? Ela sai de ${fmt.format(n)} produto(s). Dá para desfazer no Histórico.</div>`;
    $("#btnExcluirArea").hidden = true;
    $("#btnSalvarArea").textContent = "Excluir área";
    $("#btnSalvarArea").className = "btn btn--perigo";
  });

  $("#formArea").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#areaErro");
    erro.textContent = "";
    const nome = nomeCategoriaValido($("#areaNome").value);
    const icone = ($("#areaIcones input:checked") || {}).value || "";
    if (!confirmandoExclusaoArea && (!nome || nome === "-")) {
      erro.textContent = "Digite o nome da área.";
      return;
    }
    if (!confirmandoExclusaoArea && !areaEmEdicao && estado.areas.some((a) => chaveCat(a.nome) === chaveCat(nome))) {
      erro.textContent = `A área "${nome}" já existe.`;
      return;
    }
    const btn = $("#btnSalvarArea");
    const texto = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Aplicando...";
    try {
      let msg;
      if (confirmandoExclusaoArea) {
        const r = await api.excluirArea(areaEmEdicao);
        msg = `Área excluída (saiu de ${fmt.format(r.alterados)} produto(s)). Dá para desfazer no Histórico.`;
      } else {
        const r = await api.salvarArea(areaEmEdicao || "", nome, icone);
        msg = areaEmEdicao ? `Área atualizada em ${fmt.format(r.alterados)} produto(s).` : `Área "${nome}" criada.`;
      }
      await carregarProdutos();
      renderizarAreas();
      $("#dlgArea").close();
      aviso(msg);
    } catch (err) {
      erro.textContent = err.status === 404 ? MSG_FALTA_011 : err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = texto;
    }
  });
}
