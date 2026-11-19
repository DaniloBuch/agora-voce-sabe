/* Página de busca: ponto de entrada. Liga cada parte da página na mesma ordem
   em que o antigo script.js fazia (a ordem importa pouco, mas fica igual). */
import { iniciar as iniciarDados } from "./dados.js";
import { iniciar as iniciarCampo } from "./campo.js";
import { iniciar as iniciarSite } from "./site.js";
import { iniciar as iniciarTabela } from "./tabela.js";
import { iniciar as iniciarCotacaoBusca } from "./cotacao-busca.js";
import { iniciar as iniciarExportar } from "./exportar.js";
import { iniciar as iniciarEndereco } from "./endereco.js";
import { iniciar as iniciarHistorico } from "./historico.js";
import { iniciar as iniciarAtalhos } from "./atalhos.js";
import { iniciar as iniciarGaveta } from "./gaveta.js";
import { iniciar as iniciarPwa } from "./pwa.js";
import { iniciar as iniciarHome } from "./home.js";

iniciarDados();
iniciarCampo();
iniciarSite();
iniciarTabela();
iniciarCotacaoBusca();
iniciarExportar();
iniciarEndereco();
iniciarHistorico();
iniciarAtalhos();
iniciarGaveta();
iniciarPwa();
iniciarHome();
