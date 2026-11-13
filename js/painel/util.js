/* Utilitários do painel: aviso (toast), caixas de alerta, separar tags e preparar produto. */
import { $ } from "./estado.js";
import { prepararItem } from "../busca/motor.js";

/* ---------------- utilitários ---------------- */


let toastTimer = null;

export function aviso(msg, erro = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("erro-toast", erro);
  el.classList.add("visivel");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visivel"), erro ? 6000 : 3000);
}

const ICONE_ALERTA = { info: "info", ok: "circle-check", alerta: "triangle-alert", erro: "circle-alert" };

// Alert do design system: régua de 3px na borda de ataque + ícone
export function alerta(tom, html, id = "") {
  return `<div class="alerta alerta--${tom}" role="${tom === "erro" ? "alert" : "status"}"${id ? ` id="${id}"` : ""}>${window.CBSIcon(ICONE_ALERTA[tom], 20)}<div>${html}</div></div>`;
}

export function separarTags(texto) {
  return String(texto ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function prepararProduto(p) {
  const tags = String(p.tags ?? "");
  const categoria = String(p.categoria ?? "").trim() || "-"; // "-" = sem categoria
  return {
    sku: String(p.sku),
    descricao_tecnica: String(p.descricao_tecnica ?? ""),
    referencia: String(p.referencia ?? ""),
    tags,
    fixo: Boolean(p.fixo),
    categoria,
    areas: Array.isArray(p.areas) ? p.areas.map(String) : [],
    criado_em: p.criado_em || null,
    unidade: String(p.unidade ?? "").trim().toUpperCase(), // UM (migração 013); "" = não informada
    // campos do motor de busca; a categoria também é encontrada pelo filtro
    ...prepararItem({ sku: p.sku, descricao: p.descricao_tecnica, referencia: p.referencia, tags, extra: categoria === "-" ? "" : categoria }),
  };
}
