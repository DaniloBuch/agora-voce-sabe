/* Aba Histórico: versões anteriores (agrupadas por alteração em massa) e restaurar. */
import { escaparHtml as esc } from "../comum/texto.js";
import { fmtDataHora as fmtData, fmtNum as fmt } from "../comum/numeros.js";
import { separarTags, aviso } from "./util.js";
import { $, api } from "./estado.js";
import { carregarProdutos } from "./carga.js";

/* ---------------- histórico ---------------- */

let historicoCache = [];

let historicoGrupos = [];

// Alterações feitas na mesma transação (mesmo registrado_em) formam um grupo:
// é o que permite desfazer uma edição/exclusão em massa de uma vez.
function agruparHistorico(linhas) {
  const grupos = [];
  const porTempo = new Map();
  for (const h of linhas) {
    let g = porTempo.get(h.registrado_em);
    if (!g) {
      g = { quando: h.registrado_em, itens: [] };
      porTempo.set(h.registrado_em, g);
      grupos.push(g);
    }
    g.itens.push(h);
  }
  return grupos;
}

function linhaHistorico(h) {
  return `<tr>
      <td>${esc(fmtData.format(new Date(h.registrado_em)))}</td>
      <td>${h.acao === "DELETE" ? "Excluído" : "Editado"}</td>
      <td class="c-sku">${esc(h.sku)}</td>
      <td>${esc(h.dados.descricao_tecnica)}${h.dados.categoria && h.dados.categoria !== "-" ? ` <span class="dica">· categoria: ${esc(h.dados.categoria)}</span>` : ""}</td>
      <td class="c-tags">${separarTags(h.dados.tags).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</td>
      <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-hid="${h.id}">${window.CBSIcon("rotate-ccw", 14)}Restaurar</button></td>
    </tr>`;
}

function linhaGrupo(g, i) {
  const exclusao = g.itens.every((h) => h.acao === "DELETE");
  const primeiro = g.itens[0];
  return `<tr class="grupo">
      <td>${esc(fmtData.format(new Date(g.quando)))}</td>
      <td>${exclusao ? "Exclusão em massa" : "Edição em massa"}</td>
      <td class="c-sku">${fmt.format(g.itens.length)} produtos</td>
      <td>${esc(primeiro.dados.descricao_tecnica)} <span class="dica">e mais ${fmt.format(g.itens.length - 1)}</span></td>
      <td class="c-tags"><span class="dica">versões anteriores</span></td>
      <td class="c-acoes"><button class="btn btn--secundario btn--sm" data-grupo="${i}">${window.CBSIcon("rotate-ccw", 14)}Restaurar todos</button></td>
    </tr>`;
}

export async function carregarHistorico() {
  const corpo = $("#corpoHistorico");
  corpo.innerHTML = `<tr><td colspan="6" class="vazio">Carregando...</td></tr>`;
  try {
    const de = $("#histDe").value;
    const ate = $("#histAte").value;
    $("#btnHistLimpar").hidden = !(de || ate);
    if (de && ate && de > ate) {
      corpo.innerHTML = `<tr><td colspan="6" class="vazio">A data inicial é depois da final.</td></tr>`;
      $("#infoHistorico").textContent = "";
      return;
    }
    historicoCache = await api.historico(2000, { de, ate });
    historicoGrupos = agruparHistorico(historicoCache);
    corpo.innerHTML =
      historicoCache.length === 0
        ? `<tr><td colspan="6" class="vazio">${de || ate ? "Nenhuma alteração neste período." : "Nenhuma alteração registrada ainda."}</td></tr>`
        : historicoGrupos
            .slice(0, 100)
            .map((g, i) => (g.itens.length > 1 ? linhaGrupo(g, i) : linhaHistorico(g.itens[0])))
            .join("");
    $("#infoHistorico").textContent =
      historicoCache.length === 0
        ? ""
        : `${fmt.format(historicoCache.length)} registro(s)` +
          (historicoGrupos.length > 100 ? " · mostrando as 100 alterações mais recentes; use as datas para ver as anteriores" : "");
  } catch (err) {
    corpo.innerHTML = `<tr><td colspan="6" class="vazio">${esc(err.message)}</td></tr>`;
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  ["#histDe", "#histAte"].forEach((id) => $(id).addEventListener("change", carregarHistorico));

  $("#btnHistLimpar").addEventListener("click", () => {
    $("#histDe").value = "";
    $("#histAte").value = "";
    carregarHistorico();
  });

  $("#corpoHistorico").addEventListener("click", async (e) => {
    const btnGrupo = e.target.closest("button[data-grupo]");
    if (btnGrupo) {
      const g = historicoGrupos[Number(btnGrupo.dataset.grupo)];
      if (!g) return;
      btnGrupo.disabled = true;
      try {
        // se o mesmo SKU aparece mais de uma vez no grupo, vale a versão mais antiga guardada
        const porSku = new Map();
        for (const h of g.itens) porSku.set(h.sku, h.dados);
        await api.restaurarVarios([...porSku.values()]);
        await carregarProdutos();
        await carregarHistorico();
        aviso(`${fmt.format(porSku.size)} produtos restaurados.`);
      } catch (err) {
        aviso(err.message, true);
        btnGrupo.disabled = false;
      }
      return;
    }
    const btn = e.target.closest("button[data-hid]");
    if (!btn) return;
    const entrada = historicoCache.find((h) => String(h.id) === btn.dataset.hid);
    if (!entrada) return;
    btn.disabled = true;
    try {
      await api.restaurar(entrada.dados);
      await carregarProdutos();
      await carregarHistorico();
      aviso(`Produto ${entrada.sku} restaurado.`);
    } catch (err) {
      aviso(err.message, true);
      btn.disabled = false;
    }
  });
}
