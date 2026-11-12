import { escaparHtml as esc, formatarRef } from "../js/comum/texto.js";
import { criarMotor, prepararItem } from "../js/busca/motor.js";
import { fmt2, fmt4, fmtQtd, fmtSaldo, lerNumeroBR } from "../js/comum/numeros.js";
import { copiarTexto, copiarHtml } from "../js/comum/copiar.js";
import * as baseOffline from "../js/comum/base-offline.js";

const motor = criarMotor();

/* ==========================================================================
   Página de cotação: monta a tabela dos produtos marcados na busca (cotacao-store.js),
   com quantidade, unidade e valor unitário editáveis, para copiar ao papel timbrado,
   baixar em Excel ou imprimir. Tudo fica só neste navegador.
   ========================================================================== */
(function () {
  const cot = window.CBSCotacao;
  const $ = (s) => document.querySelector(s);
  const corpo = $("#cotCorpo");
  const CHAVE_LISTA = "cbs_lista_diaria_v1"; // Lista Diária carregada na busca (24 h)

  // "1.234,5" / "10" / "2,5" / "R$ 4,79" -> número (padrão brasileiro); vazio ou negativo -> null
  function lerNumero(texto) {
    const n = lerNumeroBR(texto);
    return n !== null && n >= 0 ? n : null;
  }

  const centavos = (n) => Math.round(n * 100) / 100;
  const totalDoItem = (i) => (i.preco != null && i.qtd != null ? centavos(i.qtd * i.preco) : null);

  /* ---------- Lista Diária (só leitura: saldo e preço campanha) ---------- */

  function lerListaDiaria() {
    try {
      const obj = JSON.parse(localStorage.getItem(CHAVE_LISTA));
      if (!obj || !Array.isArray(obj.itens) || Date.now() > obj.expiraEm) return null;
      return new Map(obj.itens.map(([sku, saldo, preco]) => [sku, { saldo, preco }]));
    } catch (_) {
      return null;
    }
  }

  /* ---------- Catálogo para a Lista Diária ----------
     O leitor da Lista Diária (../lista-diaria.js) só guarda os códigos que existem no catálogo.
     Aqui a base vem da cópia guardada pela busca neste aparelho; sem ela, do Supabase. */
  let skusCatalogo = [];
  window.CBS_skusCatalogo = () => skusCatalogo;
  let catalogo = []; // [{sku, descricao, referencia, ...campos do motor de busca}] para a mini-busca
  function prepararCatalogo(dados) {
    catalogo = dados
      .filter((p) => String(p.sku ?? "").trim())
      .map((p) => {
        const descricao = p.descricao_tecnica || p.descricao || "";
        const tags = Array.isArray(p.tags) ? p.tags.join(", ") : String(p.tags ?? "");
        const refOriginal = String(p.referencia ?? "").trim();
        return {
          sku: String(p.sku),
          descricao,
          referencia: formatarRef(refOriginal),
          unidade: String(p.unidade ?? "").trim().toUpperCase(),
          ...prepararItem({ sku: p.sku, descricao, referencia: refOriginal, tags }),
        };
      });
    skusCatalogo = catalogo.map((p) => p.sku);
    motor.definirBase(catalogo);
  }
  // sinônimos do dicionário (os mesmos da busca); sem internet, os guardados pela busca neste aparelho
  async function carregarSinonimos() {
    try {
      if (window.CBS_API && CBS_API.configurado && CBS_API.listarSinonimos) return await CBS_API.listarSinonimos();
    } catch (_) {}
    return (await baseOffline.ler("sinonimos")) || [];
  }
  (async function carregarCatalogo() {
    carregarSinonimos().then((g) => motor.definirSinonimos(g));
    const salvo = await baseOffline.lerProdutos();
    try {
      if (salvo) prepararCatalogo(salvo);
      else if (window.CBS_API && CBS_API.configurado) prepararCatalogo(await CBS_API.listarProdutos());
      else prepararCatalogo(await (await fetch("../db.json")).json());
    } catch (_) {}
    miniBuscaPronta();
  })();

  /* ---------- Mini-busca: adicionar produto sem sair da cotação ---------- */

  const buscaInput = $("#cotBuscaInput");
  const buscaLista = $("#cotBuscaResultados");
  const buscaInfo = $("#cotBuscaInfo");
  const MAX_SUGESTOES = 8;
  let sugestoes = [];

  function miniBuscaPronta() {
    if (!catalogo.length) {
      buscaInfo.textContent = "Não foi possível carregar o catálogo. Use a busca para adicionar produtos.";
      return;
    }
    buscaInput.disabled = false;
    buscaInfo.textContent = "";
  }

  // mesmo motor da busca do site: aspas, -palavra, sinônimos, relevância e erro de digitação
  function pesquisar(texto) {
    const r = motor.buscar(catalogo, texto);
    if (r.vazia) return { itens: [], total: 0 };
    return { itens: r.itens.slice(0, MAX_SUGESTOES), total: r.itens.length };
  }

  function desenharSugestoes() {
    const texto = buscaInput.value.trim();
    if (!texto) {
      sugestoes = [];
      buscaLista.hidden = true;
      buscaLista.innerHTML = "";
      buscaInfo.textContent = "";
      return;
    }
    const r = pesquisar(texto);
    sugestoes = r.itens;
    const lista = lerListaDiaria();
    buscaLista.hidden = sugestoes.length === 0;
    buscaLista.innerHTML = sugestoes
      .map((p) => {
        const na = cot.tem(p.sku);
        const info = lista ? lista.get(p.sku) : null;
        const extra = info
          ? `<span class="cot-sug__lista">Saldo: ${info.saldo != null ? fmtSaldo.format(info.saldo) : "—"}${info.preco ? ` · R$ ${fmt4.format(info.preco)}` : ""}</span>`
          : "";
        return `<li class="cot-sug${na ? " cot-sug--na" : ""}">
          <span class="cot-sug__cod">${esc(p.sku)}</span>
          <span class="cot-sug__desc">${esc(p.descricao)}${p.referencia ? `<span class="cot-ref">Ref. ${esc(p.referencia)}</span>` : ""}${extra}</span>
          <button type="button" class="cot-sug__btn" data-add="${esc(p.sku)}" ${na ? 'disabled aria-label="Já está na cotação"' : `aria-label="Adicionar ${esc(p.sku)} à cotação"`}>${na ? "✓ Na cotação" : "+ Adicionar"}</button>
        </li>`;
      })
      .join("");
    buscaInfo.textContent = r.total === 0
      ? "Nenhum produto encontrado com esse termo."
      : r.total > MAX_SUGESTOES ? `Mostrando ${MAX_SUGESTOES} de ${r.total.toLocaleString("pt-BR")}: digite mais para refinar.` : "";
  }

  const copiarCodigo = copiarTexto;

  function adicionarDaBusca(sku) {
    const p = catalogo.find((x) => x.sku === sku);
    if (!p || cot.tem(sku)) return;
    const copia = copiarCodigo(sku); // igual ao + da busca: também copia o código
    const lista = lerListaDiaria();
    const info = lista ? lista.get(sku) : null;
    cot.adicionar({ sku, descricao: p.descricao, referencia: p.referencia, um: p.unidade, preco: info && info.preco ? info.preco : null });
    desenhar();
    desenharSugestoes();
    copia.then((ok) => mensagem(`${sku} adicionado à cotação${ok ? " e código copiado" : ""}.`));
    const linhaNova = corpo.querySelector(`tr[data-sku="${CSS.escape(sku)}"]`);
    if (linhaNova) {
      linhaNova.classList.add("cot-linha--nova");
      setTimeout(() => linhaNova.classList.remove("cot-linha--nova"), 1600);
    }
  }

  let timerBusca = null;
  buscaInput.addEventListener("input", () => {
    clearTimeout(timerBusca);
    timerBusca = setTimeout(desenharSugestoes, 120);
  });
  buscaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timerBusca);
      desenharSugestoes();
      const primeiro = sugestoes.find((p) => !cot.tem(p.sku));
      if (primeiro) adicionarDaBusca(primeiro.sku);
    } else if (e.key === "Escape") {
      buscaInput.value = "";
      desenharSugestoes();
    } else if (e.key === "ArrowDown") {
      const b = buscaLista.querySelector("button:not(:disabled)");
      if (b) { e.preventDefault(); b.focus(); }
    }
  });
  buscaLista.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-add]");
    if (b) {
      adicionarDaBusca(b.dataset.add);
      buscaInput.focus();
    }
  });
  buscaLista.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const bs = [...buscaLista.querySelectorAll("button:not(:disabled)")];
    const i = bs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === "ArrowDown") (bs[i + 1] || bs[i]).focus();
    else (bs[i - 1] || buscaInput).focus();
  });

  /* ---------- Tabela ---------- */

  function linha(i, n, lista) {
    const total = totalDoItem(i);
    const info = lista ? lista.get(i.sku) : null;
    let saldo = "";
    if (lista) {
      if (!info || info.saldo == null) saldo = `<span class="cot-saldo" title="Este produto não está na Lista Diária">Sem saldo na lista</span>`;
      else {
        const falta = i.qtd != null && i.qtd > info.saldo;
        saldo = `<span class="cot-saldo${falta ? " cot-saldo--falta" : ""}" title="Saldo disponível na Lista Diária (consultivo)${falta ? ": a quantidade está acima do saldo" : ""}">Saldo: ${fmtSaldo.format(info.saldo)}${falta ? " · acima" : ""}</span>`;
      }
    }
    return `<tr data-sku="${esc(i.sku)}">
      <td class="c-item">${String(n).padStart(2, "0")}</td>
      <td class="c-cod">${esc(i.sku)}</td>
      <td class="c-desc">${esc(i.descricao)}${i.referencia ? `<span class="cot-ref">Ref. ${esc(i.referencia)}</span>` : ""}</td>
      <td class="c-um"><input class="cot-input cot-input--um" data-campo="um" value="${esc(i.um || "UN")}" maxlength="4" aria-label="Unidade de ${esc(i.sku)}" /></td>
      <td class="c-qtd"><input class="cot-input cot-input--num" data-campo="qtd" inputmode="decimal" value="${i.qtd != null ? fmtQtd.format(i.qtd) : ""}" aria-label="Quantidade de ${esc(i.sku)}" />${saldo}</td>
      <td class="c-unit"><input class="cot-input cot-input--num" data-campo="preco" inputmode="decimal" placeholder="0,0000" value="${i.preco != null ? fmt4.format(i.preco) : ""}" aria-label="Valor unitário de ${esc(i.sku)}" /></td>
      <td class="c-total">${total != null ? fmt2.format(total) : "—"}</td>
      <td class="c-acoes">
        <button type="button" class="cot-acao" data-acao="subir" title="Subir" aria-label="Subir ${esc(i.sku)}"${n === 1 ? " disabled" : ""}>↑</button>
        <button type="button" class="cot-acao" data-acao="descer" title="Descer" aria-label="Descer ${esc(i.sku)}">↓</button>
        <button type="button" class="cot-acao cot-acao--remover" data-acao="remover" title="Tirar da cotação" aria-label="Tirar ${esc(i.sku)} da cotação">✕</button>
      </td>
    </tr>`;
  }

  function desenhar() {
    const itens = cot.listar();
    const lista = lerListaDiaria();
    const vazia = itens.length === 0;
    $("#cotVazia").hidden = !vazia;
    $("#cotTabelaWrap").hidden = vazia;
    $("#cotRodape").hidden = vazia;
    $("#cotBarra").hidden = vazia;
    $("#btnPrecosLista").disabled = !lista;
    $("#btnPrecosLista").title = lista
      ? "Preenche o valor unitário com o preço campanha da Lista Diária (não mexe nos valores que você digitou)"
      : "Carregue a Lista Diária na busca para usar os preços campanha";
    corpo.innerHTML = itens.map((i, k) => linha(i, k + 1, lista)).join("");
    corpo.closest("table").classList.toggle("com-saldo", Boolean(lista)); // espaço para o saldo sob a quantidade
    const ultimo = corpo.querySelector("tr:last-child [data-acao=descer]");
    if (ultimo) ultimo.disabled = true;
    atualizarTotais(itens);
  }

  function atualizarTotais(itens = cot.listar()) {
    const total = itens.reduce((s, i) => s + (totalDoItem(i) || 0), 0);
    $("#cotNumItens").textContent = String(itens.length);
    $("#cotTotal").textContent = `R$ ${fmt2.format(centavos(total))}`;
  }

  function mensagem(texto, tom = "ok") {
    const el = $("#cotMsg");
    el.textContent = texto;
    el.className = `cot-msg cot-msg--${tom}`;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.hidden = true), 4000);
  }

  // Edição: grava ao sair do campo (ou Enter); os números ficam formatados no padrão brasileiro
  corpo.addEventListener("change", (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    const sku = e.target.closest("tr").dataset.sku;
    if (campo === "um") {
      cot.atualizar(sku, { um: e.target.value.trim().toUpperCase() || "UN" });
    } else if (campo === "qtd") {
      const n = lerNumero(e.target.value);
      cot.atualizar(sku, { qtd: n });
    } else if (campo === "preco") {
      const n = lerNumero(e.target.value);
      cot.atualizar(sku, { preco: n, precoManual: true });
    }
  });
  corpo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".cot-input")) e.target.blur();
  });
  // enquanto digita, o total da linha já acompanha
  corpo.addEventListener("input", (e) => {
    const campo = e.target.dataset.campo;
    if (campo !== "qtd" && campo !== "preco") return;
    const tr = e.target.closest("tr");
    const qtd = lerNumero(tr.querySelector('[data-campo="qtd"]').value);
    const preco = lerNumero(tr.querySelector('[data-campo="preco"]').value);
    tr.querySelector(".c-total").textContent = qtd != null && preco != null ? fmt2.format(centavos(qtd * preco)) : "—";
  });
  corpo.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    const sku = btn.closest("tr").dataset.sku;
    if (btn.dataset.acao === "remover") {
      cot.remover(sku);
      mensagem(`${sku} saiu da cotação.`);
    } else {
      cot.mover(sku, btn.dataset.acao === "subir" ? -1 : 1);
      const novo = corpo.querySelector(`tr[data-sku="${CSS.escape(sku)}"] [data-acao="${btn.dataset.acao}"]`);
      if (novo && !novo.disabled) novo.focus();
    }
  });

  // redesenha quando a cotação muda (aqui ou em outra aba), sem perder o campo em edição
  cot.aoMudar(() => {
    const ativo = document.activeElement;
    const pos = ativo && ativo.closest && ativo.closest("tr[data-sku]") ? [ativo.closest("tr").dataset.sku, ativo.dataset.campo] : null;
    desenhar();
    if (buscaInput.value.trim()) desenharSugestoes(); // "✓ Na cotação" acompanha as mudanças
    if (pos && pos[1]) {
      const el = corpo.querySelector(`tr[data-sku="${CSS.escape(pos[0])}"] [data-campo="${pos[1]}"]`);
      if (el && document.activeElement === document.body) el.focus();
    }
  });

  /* ---------- Copiar tabela (HTML para Word/e-mail + texto para Excel) ---------- */

  function dadosDaTabela() {
    return cot.listar().map((i, k) => ({
      item: String(k + 1).padStart(2, "0"),
      codigo: i.sku,
      descricao: i.descricao,
      um: i.um || "UN",
      qtd: i.qtd,
      unit: i.preco,
      total: totalDoItem(i),
    }));
  }

  function htmlParaCopiar(linhas, total) {
    const th = "background:#312783;color:#ffffff;font-weight:bold;padding:6px 8px;border:1px solid #312783;font-size:10pt;text-transform:uppercase;";
    const td = "padding:6px 8px;border:1px solid #d9d9e3;font-size:10pt;vertical-align:top;";
    const num = td + "text-align:right;white-space:nowrap;";
    const cab = ["Item", "Código", "Descrição do produto", "UM", "Qtd.", "Vl. unit. (R$)", "Vl. total (R$)"]
      .map((c, k) => `<th style="${th}${k >= 4 ? "text-align:right;" : "text-align:left;"}">${c}</th>`)
      .join("");
    const corpoHtml = linhas
      .map(
        (l) => `<tr><td style="${td}">${l.item}</td><td style="${td}">${esc(l.codigo)}</td><td style="${td}">${esc(l.descricao)}</td>` +
          `<td style="${td}">${esc(l.um)}</td><td style="${num}">${l.qtd != null ? fmt2.format(l.qtd) : ""}</td>` +
          `<td style="${num}">${l.unit != null ? fmt4.format(l.unit) : ""}</td><td style="${num}">${l.total != null ? fmt2.format(l.total) : ""}</td></tr>`,
      )
      .join("");
    const rodape = `<tr><td colspan="6" style="${td}text-align:right;font-weight:bold;">TOTAL GERAL (R$)</td><td style="${num}font-weight:bold;">${fmt2.format(total)}</td></tr>`;
    return `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;"><thead><tr>${cab}</tr></thead><tbody>${corpoHtml}${rodape}</tbody></table>`;
  }

  function textoParaCopiar(linhas, total) {
    const cab = ["Item", "Código", "Descrição do produto", "UM", "Qtd.", "Vl. unit. (R$)", "Vl. total (R$)"].join("\t");
    const corpoTxt = linhas.map((l) =>
      [l.item, l.codigo, l.descricao, l.um, l.qtd != null ? fmt2.format(l.qtd) : "", l.unit != null ? fmt4.format(l.unit) : "", l.total != null ? fmt2.format(l.total) : ""].join("\t"),
    );
    return [cab, ...corpoTxt, ["", "", "", "", "", "TOTAL GERAL (R$)", fmt2.format(total)].join("\t")].join("\n");
  }

  async function copiarTabela() {
    const linhas = dadosDaTabela();
    if (!linhas.length) return;
    const total = centavos(linhas.reduce((s, l) => s + (l.total || 0), 0));
    const html = htmlParaCopiar(linhas, total);
    const texto = textoParaCopiar(linhas, total);
    const ok = await copiarHtml(html, texto);
    const rotulo = $("#btnCopiar span");
    if (ok) {
      rotulo.textContent = "Tabela copiada!";
      mensagem("Tabela copiada. Cole no papel timbrado (Word), no e-mail ou no Excel.");
    } else {
      rotulo.textContent = "Não deu para copiar";
    }
    setTimeout(() => (rotulo.textContent = "Copiar tabela"), 2000);
  }

  /* ---------- Excel ---------- */

  function carregarExcel() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolver, rejeitar) => {
      const s = document.createElement("script");
      s.src = "../vendor/xlsx.full.min.js";
      s.onload = () => resolver();
      s.onerror = () => rejeitar(new Error("Não conseguimos carregar o gerador de Excel. Verifique a conexão."));
      document.head.appendChild(s);
    });
  }

  async function baixarExcel() {
    const linhas = dadosDaTabela();
    if (!linhas.length) return;
    try {
      await carregarExcel();
    } catch (err) {
      mensagem(err.message, "erro");
      return;
    }
    const X = window.XLSX;
    const total = centavos(linhas.reduce((s, l) => s + (l.total || 0), 0));
    const aoa = [
      ["Item", "Código", "Descrição do produto", "UM", "Qtd.", "Vl. unit. (R$)", "Vl. total (R$)"],
      ...linhas.map((l) => [l.item, l.codigo, l.descricao, l.um, l.qtd ?? "", l.unit ?? "", l.total ?? ""]),
      ["", "", "", "", "", "Total geral (R$)", total],
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    for (let r = 1; r < aoa.length; r++) {
      const cod = ws[X.utils.encode_cell({ r, c: 1 })];
      if (cod) { cod.t = "s"; cod.v = String(cod.v); cod.z = "@"; } // código com os zeros
      [[4, "#,##0.00"], [5, "#,##0.0000"], [6, "#,##0.00"]].forEach(([c, z]) => {
        const cel = ws[X.utils.encode_cell({ r, c })];
        if (cel && cel.t === "n") cel.z = z;
      });
    }
    ws["!cols"] = [{ wch: 6 }, { wch: 9 }, { wch: 62 }, { wch: 5 }, { wch: 9 }, { wch: 15 }, { wch: 15 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Cotação");
    const d = new Date();
    X.writeFile(wb, `cotacao_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`);
  }

  /* ---------- Outras ações ---------- */

  function precosDaLista() {
    const lista = lerListaDiaria();
    if (!lista) return;
    let n = 0;
    for (const i of cot.listar()) {
      const info = lista.get(i.sku);
      if (info && info.preco && !i.precoManual && i.preco !== info.preco) {
        cot.atualizar(i.sku, { preco: info.preco });
        n++;
      }
    }
    mensagem(n ? `${n} valor(es) unitário(s) preenchido(s) com o preço campanha da Lista Diária.` : "Nada para atualizar: os valores já estão iguais à Lista Diária (ou foram digitados por você).");
  }

  $("#btnCopiar").addEventListener("click", copiarTabela);
  $("#btnExcel").addEventListener("click", baixarExcel);
  $("#btnImprimir").addEventListener("click", () => window.print());
  $("#btnPrecosLista").addEventListener("click", precosDaLista);
  $("#btnLimpar").addEventListener("click", () => $("#dlgLimpar").showModal());
  $("#dlgLimpar").addEventListener("close", () => {
    if ($("#dlgLimpar").returnValue === "sim") {
      cot.limpar();
      mensagem("Cotação limpa.");
    }
  });
  // Lista Diária carregada, trocada ou apagada (aqui ou em outra aba): atualiza saldos e
  // preenche o valor unitário dos itens que ainda estão sem valor (não mexe no que foi digitado)
  let listaAnterior = localStorage.getItem(CHAVE_LISTA);
  function aoMudarLista() {
    const atual = localStorage.getItem(CHAVE_LISTA);
    const nova = atual && atual !== listaAnterior;
    listaAnterior = atual;
    if (nova) {
      const lista = lerListaDiaria();
      let n = 0;
      if (lista) {
        for (const i of cot.listar()) {
          const info = lista.get(i.sku);
          if (info && info.preco && i.preco == null) { cot.atualizar(i.sku, { preco: info.preco }); n++; }
        }
      }
      if (n) mensagem(`${n} valor(es) unitário(s) vazio(s) preenchido(s) com o preço campanha da nova Lista Diária.`);
    }
    desenhar();
  }
  window.addEventListener("listadiaria:mudou", aoMudarLista);
  window.addEventListener("storage", (e) => { if (e.key === CHAVE_LISTA) aoMudarLista(); });

  desenhar();
})();
