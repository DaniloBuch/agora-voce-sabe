/* ==========================================================================
   Lista Diária (saldo e preço campanha) — consulta LOCAL
   - O Excel é lido no próprio navegador (SheetJS, carregado só quando alguém envia um arquivo).
   - Nada é enviado ao banco nem a qualquer servidor.
   - Os valores ficam no localStorage deste navegador por no máximo 24 horas e depois são apagados.
   - Qualquer pessoa pode carregar a lista (não precisa de login).
   - Variação de preço: só os PREÇOS da lista de um dia anterior ficam guardados (até 5 dias, sem
     saldo) para comparar com a lista nova; o × apaga tudo na hora.
   ========================================================================== */
import { fmtSaldo, fmtPreco, fmtData, fmtHora } from "../comum/numeros.js";
import {
  CHAVE, VALIDADE_MS, lerArmazenado, apagarArmazenado, salvarArmazenado, inicioDoDia, dataDoNome, dataDe,
  lerAnterior, guardarAnterior, apagarAnterior, calcularVariacoes, expirada,
} from "./armazenamento.js";
import { lerLista } from "./leitor.js";

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    botao: $("listaBotao"),
    arquivo: $("listaArquivo"),
    status: $("listaStatus"),
    limpar: $("listaLimpar"),
    ajuda: $("listaAjuda"),
    ajudaTexto: $("listaAjudaTexto"),
    msg: $("listaMsg"),
    nota: $("listaNota"),
  };
  if (!el.botao) return; // página sem o recurso

  let dados = null; // { nome, atualizadoEm, expiraEm, mapa: Map(sku -> {saldo, preco}), variacoes: Map(sku -> preço anterior), comparadaCom }


  /** Lê o que está salvo, apaga se passou de 24 h e atualiza a tela. Devolve true se houve expiração. */
  // "assinatura" da lista: só avisa a página (que redesenha a tabela) quando ela muda de verdade
  let ultimaAssinatura;
  const assinatura = () => (dados ? `${dados.atualizadoEm}|${dados.expiraEm}|${dados.mapa.size}|${dados.variacoes.size}` : "");

  function sincronizar() {
    const o = lerArmazenado();
    let expirou = false;
    if (o && expirada(o)) {
      guardarAnterior(o); // os preços servem de base para a variação da próxima lista
      apagarArmazenado();
      expirou = true;
      dados = null;
    } else if (o) {
      const mapa = new Map();
      for (const [sku, saldo, preco] of o.itens) mapa.set(String(sku), { saldo, preco });
      const variacoes = new Map((o.variacoes || []).map(([sku, a]) => [String(sku), a]));
      dados = { nome: o.nome, atualizadoEm: o.atualizadoEm, expiraEm: o.expiraEm, dataLista: o.dataLista || null, mapa, variacoes, comparadaCom: o.comparadaCom || null };
    } else {
      dados = null;
    }
    desenhar();
    return expirou;
  }

  /* ---------- interface ---------- */

  function tempoRestante(ms) {
    const min = Math.max(1, Math.floor(ms / 60000));
    if (min >= 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
    return `${min} min`;
  }

  function textoData(ms) {
    const d = new Date(ms);
    return `${fmtData.format(d)} às ${fmtHora.format(d)}`;
  }

  function desenhar() {
    const ativa = Boolean(dados);
    document.body.classList.toggle("com-lista", ativa);
    el.limpar.hidden = !ativa;
    el.botao.querySelector(".btn-lista__rotulo").textContent = ativa ? "Atualizar Lista Diária" : "Carregar Lista Diária";
    if (ativa) {
      const resta = dados.expiraEm - Date.now();
      // lista de um dia anterior (pelo nome do arquivo ou pelo dia do upload): lembra de carregar a de hoje
      const diaDaLista = new Date(dados.dataLista || dados.atualizadoEm).setHours(0, 0, 0, 0);
      const velha = diaDaLista < new Date().setHours(0, 0, 0, 0);
      el.status.className = "lista-status lista-status--ativa" + (resta < 2 * 60 * 60 * 1000 || velha ? " lista-status--acabando" : "");
      el.status.innerHTML =
        `<span class="lista-status__ponto" aria-hidden="true"></span>` +
        `<span>Lista Diária atualizada em <strong>${textoData(dados.atualizadoEm)}</strong>` +
        `<span class="lista-status__resta"> · apaga sozinha em ${tempoRestante(resta)}</span>` +
        (velha ? `<span class="lista-status__lembrete"> · é a lista de ${fmtData.format(new Date(diaDaLista))}: carregue a de hoje</span>` : "") +
        (dados.comparadaCom
          ? `<span class="lista-status__comp"> · preços comparados com a lista de ${fmtData.format(new Date(dados.comparadaCom))}</span>`
          : `<span class="lista-status__comp"> · sem lista anterior para comparar preços</span>`) +
        `</span>`;
      el.nota.hidden = false;
      el.nota.textContent =
        `Saldo e preço campanha da Lista Diária de ${textoData(dados.atualizadoEm)}. Valores meramente consultivos: ` +
        `para maior exatidão, consulte o Protheus (TOTVS).`;
    } else {
      el.status.className = "lista-status lista-status--lembrete";
      el.status.innerHTML = `<span class="lista-status__ponto" aria-hidden="true"></span><span>Sem Lista Diária: <strong>carregue a de hoje</strong> para ver saldo e preço campanha</span>`;
      el.nota.hidden = true;
    }
    // a conferência de validade (a cada 30 s) só atualiza o texto "apaga sozinha em...";
    // a tabela só é redesenhada quando a lista entra, muda, sai ou vence
    const a = assinatura();
    if (a !== ultimaAssinatura) {
      ultimaAssinatura = a;
      window.dispatchEvent(new CustomEvent("listadiaria:mudou"));
    }
  }

  let timerMsg = null;
  function mostrarMsg(tipo, html) {
    clearTimeout(timerMsg);
    if (tipo === "ok") timerMsg = setTimeout(() => { el.msg.hidden = true; }, 12000); // confirmação some sozinha
    el.msg.hidden = !html;
    el.msg.className = "lista-msg lista-msg--" + tipo;
    el.msg.innerHTML = html;
  }

  async function aoEscolherArquivo(arquivo) {
    if (!arquivo) return;
    el.botao.disabled = true;
    mostrarMsg("info", "Lendo a Lista Diária...");
    try {
      const r = await lerLista(arquivo);
      const agora = Date.now();
      // a lista que está saindo vira base de comparação (se for de uma data anterior à da nova)
      const dataLista = dataDoNome(arquivo.name) ?? inicioDoDia(agora);
      guardarAnterior(lerArmazenado(), dataLista);
      let anterior = lerAnterior();
      if (anterior && dataDe(anterior) >= dataLista) anterior = null; // só compara com lista de data anterior
      const itens = [...r.mapa].map(([sku, v]) => [sku, v.saldo, v.preco]);
      const variacoes = calcularVariacoes(itens, anterior);
      const obj = {
        v: 1,
        nome: arquivo.name,
        atualizadoEm: agora,
        expiraEm: agora + VALIDADE_MS,
        dataLista,
        itens,
        variacoes,
        comparadaCom: anterior ? dataDe(anterior) : null,
      };
      salvarArmazenado(obj);
      sincronizar();
      const fora = r.foraDoCatalogo ? ` ${r.foraDoCatalogo.toLocaleString("pt-BR")} código(s) da lista não estão no catálogo e foram ignorados.` : "";
      const mudou = anterior
        ? ` <strong>${variacoes.length.toLocaleString("pt-BR")}</strong> preço(s) mudaram desde a lista de ${fmtData.format(new Date(dataDe(anterior)))}.`
        : " Sem lista de data anterior neste navegador para comparar os preços: a variação aparece quando você carregar uma lista mais nova que esta.";
      mostrarMsg("ok", `Lista Diária carregada: saldo e preço de <strong>${r.mapa.size.toLocaleString("pt-BR")}</strong> produtos.${mudou}${fora}`);
    } catch (err) {
      console.error(err);
      mostrarMsg("erro", String(err.message || err).replace(/</g, "&lt;"));
    } finally {
      el.botao.disabled = false;
      el.arquivo.value = "";
    }
  }

  /* ---------- eventos ---------- */

  el.botao.addEventListener("click", () => el.arquivo.click());
  el.arquivo.addEventListener("change", () => aoEscolherArquivo(el.arquivo.files[0]));
  el.limpar.addEventListener("click", () => {
    apagarArmazenado();
    apagarAnterior(); // o × apaga tudo, inclusive os preços guardados para comparar
    sincronizar();
    mostrarMsg("info", "Lista Diária removida deste navegador.");
  });

  // (?) informativo: aparece com mouse/foco; o clique fixa aberto; Esc ou clique fora fecham
  let ajudaFixada = false;
  function ajudaAberta(aberta) {
    el.ajudaTexto.hidden = !aberta;
    el.ajuda.setAttribute("aria-expanded", String(aberta));
    if (!aberta) ajudaFixada = false;
  }
  el.ajuda.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ajudaFixada) ajudaAberta(false);
    else { ajudaAberta(true); ajudaFixada = true; }
  });
  el.ajuda.addEventListener("mouseenter", () => ajudaAberta(true));
  el.ajuda.addEventListener("mouseleave", () => { if (!ajudaFixada && document.activeElement !== el.ajuda) ajudaAberta(false); });
  el.ajuda.addEventListener("focus", () => ajudaAberta(true));
  el.ajuda.addEventListener("blur", () => { if (!ajudaFixada) ajudaAberta(false); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".lista-ajuda-wrap")) ajudaAberta(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ajudaAberta(false); });

  // Validade: confere a cada 30 s, ao voltar para a aba e quando outra aba mexe no armazenamento
  function conferirValidade() {
    if (sincronizar()) mostrarMsg("alerta", "A Lista Diária passou de 24 horas e foi apagada deste navegador. Carregue a de hoje.");
  }
  setInterval(() => { if (dados) conferirValidade(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) conferirValidade(); });
  window.addEventListener("storage", (e) => { if (e.key === CHAVE || e.key === null) sincronizar(); });

  /* ---------- API usada pela tabela de resultados ---------- */
  window.ListaDiaria = {
    ativa: () => Boolean(dados),
    obter: (sku) => (dados ? dados.mapa.get(String(sku)) || null : null),
    formatarSaldo: (n) => (n === null || n === undefined ? null : fmtSaldo.format(n)),
    formatarPreco: (n) => (!n ? null : fmtPreco.format(n)),
    // { anterior, atual, dif, pct } se o preço mudou desde a lista anterior; senão null
    variacao(sku) {
      if (!dados) return null;
      const anterior = dados.variacoes.get(String(sku));
      const v = dados.mapa.get(String(sku));
      if (anterior === undefined || !v || !v.preco) return null;
      return { anterior, atual: v.preco, dif: v.preco - anterior, pct: ((v.preco - anterior) / anterior) * 100 };
    },
    // todas as mudanças (para o painel de novidades) e a data da lista usada na comparação
    variacoes: () => (dados ? [...dados.variacoes.keys()].map((sku) => ({ sku, ...window.ListaDiaria.variacao(sku) })) : []),
    comparadaCom: () => (dados ? dados.comparadaCom : null),
    // só para testes
    _validadeMs: VALIDADE_MS,
  };

  // Ao abrir a página: restaura o que ainda está válido e apaga o que passou de 24 h
  if (sincronizar()) mostrarMsg("alerta", "A Lista Diária anterior passou de 24 horas e foi apagada. Carregue a de hoje.");
})();
