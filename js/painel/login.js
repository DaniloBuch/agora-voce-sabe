/* Login (Supabase Auth): entrar, sair e mostrar o painel. */
import { $, estado, api } from "./estado.js";
import { mostrarAba } from "./abas.js";
import { carregarProdutos } from "./carga.js";
import { aviso } from "./util.js";

/* ---------------- login ---------------- */

export function mostrarLogin(mensagem = "") {
  document.body.classList.remove("logado");
  $("#areaAdmin").hidden = true;
  $("#telaLogin").hidden = false;
  $("#btnSair").hidden = true;
  $("#topoUsuario").hidden = true;
  $("#loginErro").textContent = mensagem;
  $("#loginSenha").value = "";
  for (const dlg of document.querySelectorAll("dialog[open]")) dlg.close();
  estado.produtos = [];
  estado.selecionados.clear();
  ($("#loginEmail").value ? $("#loginSenha") : $("#loginEmail")).focus();
}

export async function mostrarAdmin() {
  document.body.classList.add("logado");
  $("#telaLogin").hidden = true;
  $("#areaAdmin").hidden = false;
  $("#btnSair").hidden = false;
  $("#topoUsuario").hidden = false;
  $("#topoUsuario").textContent = api.emailLogado();
  mostrarAba("produtos");
  $("#infoLista").textContent = "Carregando produtos...";
  try {
    await carregarProdutos();
  } catch (err) {
    $("#infoLista").textContent = "";
    aviso(`Não foi possível carregar os produtos: ${err.message}`, true);
  }
}

/** Liga os eventos e roda o que precisa na abertura da página (chamado por principal.js). */
export function iniciar() {
  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    const senha = $("#loginSenha").value;
    const erro = $("#loginErro");
    erro.textContent = "";
    if (!email || !senha) {
      erro.textContent = "Informe e-mail e senha.";
      return;
    }
    const btn = $("#btnEntrar");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    try {
      await api.entrar(email, senha);
      $("#loginSenha").value = "";
      await mostrarAdmin();
    } catch (err) {
      erro.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  $("#btnSair").addEventListener("click", async () => {
    await api.sair();
    mostrarLogin();
  });

  window.addEventListener("cbs:sessao-expirada", () => mostrarLogin("Sua sessão expirou. Entre novamente."));
}
