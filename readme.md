# 🔍 Agora você sabe — Busca Inteligente CBS

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222222?style=for-the-badge&logo=githubpages&logoColor=white)

**👉 [Acessar o site](https://danilobuch.github.io/agora-voce-sabe/)**

Ferramenta interna da **CBS** para encontrar produtos pelo código, pela descrição técnica, pela referência do fornecedor ou pelo **apelido comercial** (as tags), em milissegundos.

## 🎯 O problema

No comercial de suprimentos médicos há um descompasso entre a linguagem de quem vende (apelidos como "Transofix") e a do sistema (SKUs e descrições técnicas longas). Resultado: dependência de pessoas seniores, cotações lentas e excesso de perguntas nos grupos de comunicação.

## 💡 A solução

Uma aplicação web estática que carrega a base de produtos e filtra tudo localmente no navegador, como um "filtro de ruído" entre o vocabulário comercial e o técnico.

### Busca (site público)

- **Busca por partículas:** os termos podem vir em qualquer ordem. `000437 sonda` e `sonda 04` levam ao mesmo produto.
- **Busca avançada:** `"luva procedimento"` entre aspas busca o **trecho exato**, nessa ordem; `luva -latex` (hífen antes da palavra) **tira** da lista quem tem "latex" (também vale `-"trecho"`). O hífen só conta no começo da palavra, então referências como `AR-420` continuam funcionando.
- **Sinônimos:** um dicionário editável no painel (aba **Sinônimos**) faz abreviações e jargões valerem como a palavra por extenso, nos dois sentidos: quem busca `caixa` também acha "CX", quem busca `cirurgica` acha "AVENTAL CIR". Abreviações de até 4 letras só contam como palavra inteira (`est` não pega "estilo").
- **Ignora acentos e maiúsculas:** `esfigmomanometro` encontra "Esfigmomanômetro".
- **Categorias:** o botão **Categorias** no cabeçalho abre uma gaveta lateral (por cima da página, fecha com Esc, clique fora, « ou ao escolher) com Luvas, Cateteres, Fraldas…, da mais cheia para a menos cheia. O campo **Buscar categoria...** no topo da gaveta filtra a lista enquanto você digita (Enter escolhe a primeira; limpa ao fechar). A categoria filtra a base por tipo de produto e aparece como um selo abaixo do campo de busca (com × para remover); depois é só digitar para refinar dentro dela. O botão já aparece ao abrir a página; se a gaveta for aberta antes de a base terminar de carregar, mostra um esqueleto animado no lugar da lista. O link compartilhado guarda categoria e busca (`?cat=Luvas&q=nitril`).
- **Áreas de atuação:** cada produto pode ser indicado para uma ou mais áreas (Hospitais, Clínicas, Laboratórios, Veterinária...), mostradas como selos com ícone ("Indicado para") sob a descrição, para o vendedor montar o kit de cada cliente. Na gaveta, a seção **Área de atuação** filtra a busca (e combina com a categoria); só aparecem as áreas que já têm produtos. O link guarda a área (`?area=Hospitais`).
- **Tema escuro:** o botão de lua no cabeçalho troca para o tema escuro (o claro é o padrão); a escolha fica guardada no navegador e vale para a busca, a cotação e o painel. A impressão sai sempre clara.
- **Quatro campos ao mesmo tempo:** SKU, descrição técnica, referência (Ref.) e tags.
- **Ordenar pela coluna:** clicar no título (SKU, Descrição, Saldo, Preço camp. ou Ref.) ordena os resultados: 1º clique crescente, 2º decrescente, 3º volta à relevância (ou "Voltar à relevância" no texto acima da tabela). Produtos sem valor (sem saldo/preço na lista) ficam no fim, os "parecidos" continuam depois dos exatos, a ordem vale para a busca seguinte, vai no link (`?ord=preco.asc`) e no Excel.
- **Ordenado por relevância:** código exato, referência exata e tags vêm antes de coincidências soltas na descrição.
- **Termos destacados** nos resultados; tags que casaram com a busca aparecem primeiro.
- **"Também conhecido por" (aprender os nomes):** as tags (apelidos comerciais, marcas, termos técnicos) aparecem sempre à vista, numa linha logo abaixo da descrição, para quem busca aprender os outros nomes de cada produto. O nome que fez o produto aparecer na busca vem primeiro, em azul. No computador cabem em média 4 a 5 nomes numa linha; o que não couber vira "+N nomes", que abre todos ali mesmo com um clique (no celular são até 2 linhas). A descrição continua sempre em uma linha só.
- **Referência legível:** referências só numéricas aparecem sem zeros à esquerda (`000000000038833014` → `38833014`); as com letras ficam como estão (`AR420`). A busca aceita as duas formas.
- **Tolera erros de digitação:** se nada for encontrado, sugere palavras parecidas da própria base (`esfigmomanomtero` → `esfigmomanometro`) e avisa o que foi buscado. Quando a busca traz poucos resultados (menos de 50), os produtos com palavras de grafia parecida aparecem **depois** dos exatos, numa seção "Parecidos com a sua busca" (só para termos de 5 letras ou mais).
- **Paginação e catálogo completo:** os resultados vêm em páginas de 50 (antes a lista parava em 100). O botão **Explorar catálogo completo** (ou "Todos os produtos" na gaveta) lista a base inteira em ordem alfabética; categoria sem termo também fica em ordem alfabética. A página atual vai no link (`?q=luva&p=2`, `?ver=todos`).
- **Buscas recentes:** as últimas 8 buscas que trouxeram resultado ficam **só neste navegador**. Aparecem ao clicar no campo vazio (ou com ↓), como no Google; o foco automático ao abrir a página não abre a lista. Uma busca entra no histórico com Enter, ao copiar um código ou o link, ou depois de 2,5 s parada; cada item pode ser removido, e há "Limpar histórico".
- **Praticidade:** clique no código para copiar o SKU e use "Copiar link desta busca" para compartilhar (`?q=sonda`); a busca do link abre já executada.
- **Exportar para Excel e atalhos:** o botão **Exportar para Excel** (acima da tabela) baixa **todos** os resultados da busca, não só a página: SKU (como texto, com os zeros), descrição, referência, categoria, "também conhecido por", link do site e, com a Lista Diária carregada, saldo e preço campanha. Atalhos: **/** vai para a busca de qualquer lugar da página e **Esc** limpa.
- **Lista de cotação:** o botão **+** no começo de cada linha guarda o produto numa lista (como um carrinho), que fica **só neste navegador** até ser limpa; o botão **Cotação** no cabeçalho mostra quantos itens há. Na página **Cotação** (`/cotacao/`) a tabela tem as colunas do papel timbrado (Item, Código, Descrição, UM, Qtd., Vl. unit., Vl. total) e o total geral; quantidade, unidade e valor unitário são editáveis (o preço campanha da Lista Diária entra como sugestão e o saldo aparece como aviso). A Lista Diária também pode ser anexada direto na página da cotação, que mostra quando ela foi carregada e quanto tempo falta para vencer; ao anexar, só os valores unitários vazios são preenchidos (o que foi digitado não muda). O campo **Adicionar produto**, no topo da página, procura no catálogo (código, descrição, referência ou apelido) e põe o produto na cotação sem voltar para a busca: **Enter** adiciona o primeiro resultado, as setas andam pela lista, e cada sugestão mostra saldo e preço da Lista Diária. Adicionar (aqui ou pelo **+** da busca) também **copia o código** do produto. Dá para reordenar, tirar itens, **Copiar tabela** (cola formatada no Word/e-mail e em colunas no Excel), **Baixar Excel**, **Imprimir** e **Limpar cotação**.
- **Leve e seguro:** debounce na digitação, 50 linhas por página e escape de HTML nos dados.
- **Lista Diária (saldo e preço campanha):** qualquer usuário, sem login, pode carregar a planilha Excel da Lista Diária (botão **Carregar Lista Diária**; aceita `.xlsx`, `.xls`, `.xlsm` e `.csv`; o CSV é lido pelo próprio site, como texto, com separador `;`, `,` ou tab, UTF-8 ou Windows-1252 e números no padrão brasileiro, `4,7983` e `1.234,5`). O site lê as colunas **Saldo disponível** e **Preco campanha** e mostra os valores na tabela (colunas *Saldo* e *Preço camp.*; no celular, uma linha sob a descrição) conforme as buscas são feitas. **Esses dados nunca vão para o banco nem para nenhum servidor:** a leitura é feita no navegador e o resultado fica só no `localStorage` do próprio usuário, que é apagado automaticamente após **24 horas**. Um aviso ao lado do botão mostra quando a lista foi atualizada e em quanto tempo ela se apaga, e o **(?)** explica que os valores são meramente consultivos e que, para maior exatidão, deve-se consultar o Protheus (TOTVS). O botão **×** apaga a lista na hora (útil em computador compartilhado). Linhas repetidas do mesmo SKU somam o saldo e usam o primeiro preço diferente de zero (o preço campanha sempre é mostrado com 4 casas decimais, ex.: R$ 12,5000); SKUs que não estão no catálogo são ignorados.
- **Site oficial, foto e ficha técnica:** a coluna **Site** tem dois ícones: um abre, em nova aba, a página do produto em cbsmed.com.br (passando o mouse aparece a **foto em miniatura**) e o outro abre o **PDF da ficha técnica**. Sem sincronizar, o endereço é montado pela descrição técnica do jeito do WordPress (sem acento, minúsculas, `/` e `.` viram traço, vírgula, `%`, `+` e parênteses saem: `FILME TRANSP TEGADERM CHG 8,5X11,5 C/CLOREX 2% 3M 1657R(25)` → `/produto/filme-transp-tegaderm-chg-85x115-c-clorex-2-3m-1657r25/`). A **sincronização** é feita pelo próprio Supabase (o site não libera a leitura pelo navegador): toda segunda-feira às 06:15 e pelo botão do painel, ela guarda o endereço exato (resolve o `-2` do WordPress), a ficha e a foto de cada código. Produto que não está no site abre a busca do site. O ícone mostra se o produto tem foto no site: **ícone de foto, em roxo**, quando tem (com a miniatura ao passar o mouse); **ícone de link, em cinza**, em qualquer outro caso (sem foto, fora do site ou antes da sincronização). A busca só pede os links da página na tela, para gastar pouco tráfego.
- **Variação de preço:** ao carregar a Lista Diária, o site compara o preço campanha com o da lista de data anterior (a data vem do nome do arquivo, ex.: `LISTA DIÁRIA 10-11-2026.xlsx`; sem data no nome, vale o dia em que foi carregada) e mostra, sob o preço, a diferença em % e em R$: **▼ −10,0% · −R$ 0,10** em verde quando caiu e **▲ +11,1% · +R$ 0,50** em vermelho quando subiu (na tela só a seta e o %; o preço antigo e a diferença em R$ aparecem ao passar o mouse). A mensagem de carregamento diz quantos preços mudaram. Para isso o navegador guarda **só os preços** (nunca o saldo) da lista anterior por até 5 dias, o que cobre fim de semana e feriado prolongado; recarregar a mesma lista continua comparando com a anterior, e o **×** apaga tudo.
- **Sino de novidades:** o sino no cabeçalho mostra as mensagens sobre as atualizações do site, com o número de não lidas (contadas por navegador). A cada atualização chegam sugestões de mensagem prontas, que são publicadas, editadas ou ignoradas no painel; dá para agendar uma mensagem para um dia futuro.
- **Novidades do catálogo (`/novidades/`):** página com três abas em forma de cartão: produtos **adicionados** e **removidos** no período (7, 30, 90 dias ou 1 ano) e **mudanças de preço** da Lista Diária carregada neste navegador (antes, agora, variação em % e em R$; filtro "só os que caíram/subiram"). Filtros por categoria e texto, ordenação clicando no título da coluna e **+** para pôr na cotação. Abre pelo botão **Novidades** no cabeçalho (ao lado de Cotação) ou pelo rodapé do sino; o endereço guarda a aba (`/novidades/#precos`).
- **Copiar o valor unitário:** com a Lista Diária carregada, clicar no preço campanha copia o número (ex.: `4,7983`), igual ao clique no SKU.
- **App instalável (PWA) e modo offline:** no Chrome ou no Edge aparece o botão **Instalar app** no cabeçalho (ou o ícone de instalar na barra de endereço). Instalado, o site abre em janela própria, com ícone na área de trabalho e no menu Iniciar; no celular, "Adicionar à tela inicial". O app guarda o próprio site (`sw.js`) e a última base carregada neste aparelho: **sem internet, a busca continua funcionando** e o painel avisa de quando é a base. Com internet, sempre vale a versão mais nova (o cache é só plano B). Depois de instalado, o botão vira **Abrir o app** (abre o app já com a busca da tela, pelo protocolo `web+agoravocesabe:`), útil para quem apagou o atalho; se o app for desinstalado, volta a ser "Instalar app". O **Firefox** não instala sites como app no computador: lá o botão abre uma ajuda com **Abrir no Edge** (para instalar por lá) e a dica de criar um atalho arrastando o cadeado. Para instalar em todos os computadores de uma vez, o TI pode usar a política `WebAppInstallForceList` do Edge/Chrome.
- **Modo contingência:** se o banco estiver fora do ar, o site lê o `db.json` e avisa na tela.

### Painel de administração (`/admin/`)

Painel para manter a base sem mexer em arquivos JSON. O acesso é pelo botão **Login** no cabeçalho do site (ou direto em `/admin/`) e exige e-mail e senha. Depois de entrar, você encontra:

- **Visão geral** no topo, com o total de produtos, quantos estão sem tags e quantas tags existem;
- **Acesso com login** (Supabase Auth): só quem tem usuário e senha altera a base; o site público só lê;
- **CRUD de produtos e tags**, com chips, sugestões e filtro de produtos sem tags;
- **Sinônimos:** grupos de palavras equivalentes para a busca do site (`cx, caixa`), com a contagem de produtos de cada palavra;
- **Categorias:** uma por produto (`-` quando não há), com aba própria para criar, renomear, mesclar e excluir, filtro na lista e campo no cadastro e na edição em massa;
- **Áreas de atuação:** várias por produto, com ícone; aba própria para criar, trocar nome e ícone, mesclar e excluir, filtro na lista e escolha no cadastro e na edição em massa (cada área alterna entre adicionar, remover e não alterar);
- **Novidades (sino):** sugestões da atualização do site (arquivo `novidades-site.json`) para publicar, editar ou ignorar; mensagens escritas à mão, editáveis, com data de publicação (inclusive agendada) e exclusão;
- **Adicionados recentemente:** filtro por data de inclusão (hoje, 7, 30 ou 90 dias), do mais novo ao mais antigo, com selo "novo" e a data;
- **Gerenciamento de tags:** lista com contagem, renomear, mesclar e excluir em todos os produtos, com alerta de possíveis duplicadas;
- **Edição de tags em massa**, com seleção múltipla e prévia do resultado;
- **Importação de CSV** do sistema (inclui novos SKUs, atualiza descrição e referência e remove descontinuados), com resumo e confirmação antes de gravar. Colunas opcionais **Categoria** e **Tags**: as tags do CSV são só **acrescentadas** às existentes, nunca removidas; CSV enxuto só com `Codigo` + `Categoria`/`Tags` (botão **Exportar p/ categorizar**) e opção de não alterar referências; referências que o Excel estragou (notação científica, pontos de milhar, zeros perdidos) são detectadas e não sobrescrevem o banco;
- **Histórico** de edições e exclusões, com restauração (inclusive em lote) e filtro por data;
- **Exportação em CSV** de toda a base, para backup.

## 🏗️ Arquitetura

```
GitHub Pages (HTML + CSS + JS, sem build)
        │  fetch (API REST do Supabase)
        ▼
Supabase (PostgreSQL + PostgREST)
```

| Arquivo / pasta | Função |
| --- | --- |
| `index.html`, `script.js`, `style.css` | Site público de busca |
| `tema.css`, `tema.js` | Tema escuro (redefine a paleta do Design System; a escolha fica no navegador) |
| `sino.js`, `novidades/` | Sino de novidades no cabeçalho e página "Novidades do catálogo" (adicionados, removidos e mudanças de preço) |
| `novidades-site.json` | Sugestões de mensagem do sino, uma por atualização do site (o painel oferece para publicar) |
| `areas-icones.js` | Ícones das áreas de atuação (Lucide, ISC), usados pelo site e pelo painel |
| `cotacao/`, `cotacao-store.js` | Lista de cotação: página com a tabela para o papel timbrado e a lista guardada no navegador |
| `manifest.webmanifest`, `sw.js`, `icons/` | App instalável (PWA): nome, ícones e cores do app; service worker que guarda o site para abrir sem internet |
| `lista-diaria.js`, `vendor/xlsx.full.min.js` | Lista Diária: leitura local do Excel (SheetJS 0.18.5, Apache-2.0, carregado só quando alguém envia uma planilha) e armazenamento de 24 h no navegador |
| `admin/` | Painel de administração (`index.html`, `admin.js`, `admin.css`), acessado por `/admin/` |
| `api.js` | Camada de acesso ao Supabase (login, listar, CRUD, importar, histórico, tags) |
| `config.js` | Endereço do projeto e chave pública (`anon`) do Supabase |
| `supabase/schema.sql` | Tabelas, políticas, triggers e funções do banco |
| `supabase/migracoes/` | Scripts incrementais para bancos já criados (`002` edição em massa, `003` login, `004` gerenciar tags, `005` categorias, `006` categorias iniciais, `007` correção de referências estragadas pelo Excel, `008` sinônimos da busca, `009` links do site oficial, `010` sincronização com o site pelo Supabase, `011` áreas de atuação e data de inclusão, `012` mensagens do sino e produtos removidos) |
| `supabase/produtos_seed.csv` | Carga inicial dos produtos |
| `db.json` | Cópia estática usada como contingência |
| `design-system/` | CBS Design System vendorizado ([detalhes](design-system/README.md)) |

**Banco de dados:** tabela `produtos` (`sku`, `descricao_tecnica`, `referencia`, `tags`, `categoria`, `fixo`), tabela `categorias`, tabela `sinonimos` (grupos de palavras equivalentes) e `produtos_historico` (preenchida por trigger a cada edição/exclusão). A importação de CSV e a edição de tags em massa são funções SQL (RPC), então rodam de forma atômica: ou tudo é gravado ou nada. Produtos marcados como **fixo** nunca são excluídos pela importação.

## 🎨 Identidade visual

O front-end segue o **CBS Design System** (Manual de Identidade Visual CBS, out/2025): tokens de cor, tipografia Quicksand, espaçamento, raios e movimento, marca em SVG e ícones Lucide. Regras que valem aqui: títulos em caixa alta, corpo em Quicksand Light, quadrado do logotipo em laranja `#dc9c01`, foco com anel azul e hover sem mudança de tamanho.

## 🚀 Como rodar

**Produção:** acesse [danilobuch.github.io/agora-voce-sabe](https://danilobuch.github.io/agora-voce-sabe/). Para administrar a base, use o botão **Login** no cabeçalho (`/admin/`).

**Local:**

1. `git clone https://github.com/DaniloBuch/agora-voce-sabe.git`
2. Abra a pasta no VS Code e use a extensão **Live Server** em `index.html` (necessário para a Fetch API não ser bloqueada por CORS).
3. Para usar o banco, preencha o `config.js` com o endereço do projeto Supabase (sem `/rest/v1`) e a chave pública.

**Criar o banco do zero:** siga o passo a passo em [`SETUP-SUPABASE.md`](SETUP-SUPABASE.md) (criar o projeto, rodar o SQL, carregar os produtos e conectar o site). Para bancos já existentes, rode os scripts de `supabase/migracoes/` no SQL Editor.

## 🔐 Segurança

- A **leitura** dos produtos é pública (é o que o site usa); **qualquer alteração** exige login (Supabase Auth) e é protegida por regras de acesso no próprio banco (RLS), não só pela interface.
- O cadastro público de usuários deve ficar **desativado** no Supabase, para que só as contas criadas por você existam.
- **Saldo e preço campanha da Lista Diária não são gravados no banco.** Ficam só no navegador de quem carregou a lista, por no máximo 24 horas (só os preços da lista anterior ficam até 5 dias, para mostrar a variação), e são apenas consultivos (a fonte oficial é o Protheus/TOTVS). Se um dia esses dados precisarem ficar no servidor, será necessário separar usuários por privilégio.
- A chave `anon` no `config.js` é pública por natureza e não dá permissão de gravação.
- O **Histórico** guarda a versão anterior de tudo o que for alterado ou excluído, e a exportação em CSV serve de backup extra.

## 📣 Ao publicar uma atualização do site

Acrescente no topo de `novidades-site.json` um item com `chave` única (ex.: `2026-11-20-nome-da-melhoria`), `data`, `titulo` e `texto` (linguagem simples, só o que o usuário vê; nada do painel). Depois do deploy, a sugestão aparece na aba **Novidades** do painel para publicar no sino.

## 🛣️ Roadmap

- [x] Busca por partículas, sem acento, com relevância e destaque
- [x] Banco PostgreSQL (Supabase) no lugar do JSON estático
- [x] Painel de administração com CRUD, importação de CSV e histórico
- [x] Edição de tags em massa e gerenciamento de tags (renomear, mesclar, excluir)
- [x] Login no painel (Supabase Auth) e novo visual do painel e exportação de backup em CSV
- [x] CBS Design System aplicado
- [x] Copiar SKU, link compartilhável da busca e tolerância a erro de digitação
- [x] Categorias de produtos (filtro no site, gestão no painel, CSV)
- [x] Busca avançada (aspas e exclusão), sinônimos editáveis e resultados parecidos
- [x] Paginação, catálogo completo, histórico de buscas e busca na gaveta de categorias
- [x] Lista Diária: saldo e preço campanha, só no navegador, por 24 horas
- [x] "Também conhecido por": os outros nomes do produto sempre à vista
- [x] Site oficial, foto e ficha técnica (sincronização semanal pelo Supabase)
- [x] App instalável (PWA) com modo offline, "Abrir o app" e ajuda para quem usa Firefox
- [x] Exportar o resultado da busca para Excel e atalhos de teclado ("/" e Esc)
- [x] Lista de cotação: marcar produtos, ajustar quantidade e valor e copiar a tabela para o papel timbrado
- [x] Tema escuro, áreas de atuação (filtro e painel) e filtro de adicionados recentemente
- [x] Variação de preço da Lista Diária, mini-busca na cotação e copiar o código ao adicionar
- [x] Sino de novidades (mensagens editáveis no painel) e página de novidades do catálogo
- [ ] Alternativas ("De/Para"): ligar produtos equivalentes no painel e, quando a Lista Diária mostrar saldo zero, sugerir os substitutos com saldo
- [ ] "Outros clientes também compram": sugerir itens que costumam ir juntos (ex.: agulha de coleta a vácuo + swab com álcool + garrote)
- [ ] Backup automático agendado da base

---

_Desenvolvido por **Danilo Buch** — unindo a visão estratégica de Negócios com a Engenharia de Software._
