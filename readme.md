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
- **Ignora acentos e maiúsculas:** `esfigmomanometro` encontra "Esfigmomanômetro".
- **Categorias:** barra lateral à esquerda (Luvas, Cateteres, Fraldas…, da mais cheia para a menos cheia) filtra a base por tipo de produto; depois é só digitar no campo para refinar dentro da categoria. "Todos os produtos" ou um novo clique na categoria desfaz o filtro. No celular a barra vira um seletor "Categorias" que abre e recolhe, e o link compartilhado guarda categoria e busca (`?cat=Luvas&q=nitril`).
- **Quatro campos ao mesmo tempo:** SKU, descrição técnica, referência (Ref.) e tags.
- **Ordenado por relevância:** código exato, referência exata e tags vêm antes de coincidências soltas na descrição.
- **Termos destacados** nos resultados; tags que casaram com a busca aparecem primeiro.
- **Referência legível:** referências só numéricas aparecem sem zeros à esquerda (`000000000038833014` → `38833014`); as com letras ficam como estão (`AR420`). A busca aceita as duas formas.
- **Tolera erros de digitação:** se nada for encontrado, sugere palavras parecidas da própria base (`esfigmomanomtero` → `esfigmomanometro`) e avisa o que foi buscado.
- **Praticidade:** clique no código para copiar o SKU e use "Copiar link desta busca" para compartilhar (`?q=sonda`); a busca do link abre já executada.
- **Leve e seguro:** debounce na digitação, máximo de 100 linhas renderizadas e escape de HTML nos dados.
- **Modo contingência:** se o banco estiver fora do ar, o site lê o `db.json` e avisa na tela.

### Painel de administração (`/admin/`)

Painel para manter a base sem mexer em arquivos JSON. O acesso é pelo botão **Login** no cabeçalho do site (ou direto em `/admin/`) e exige e-mail e senha. Depois de entrar, você encontra:

- **Visão geral** no topo, com o total de produtos, quantos estão sem tags e quantas tags existem;
- **Acesso com login** (Supabase Auth): só quem tem usuário e senha altera a base; o site público só lê;
- **CRUD de produtos e tags**, com chips, sugestões e filtro de produtos sem tags;
- **Categorias:** uma por produto (`-` quando não há), com aba própria para criar, renomear, mesclar e excluir, filtro na lista e campo no cadastro e na edição em massa;
- **Gerenciamento de tags:** lista com contagem, renomear, mesclar e excluir em todos os produtos, com alerta de possíveis duplicadas;
- **Edição de tags em massa**, com seleção múltipla e prévia do resultado;
- **Importação de CSV** do sistema (inclui novos SKUs, atualiza descrição e referência e remove descontinuados), com resumo e confirmação antes de gravar. Colunas opcionais **Categoria** e **Tags**: as tags do CSV são só **acrescentadas** às existentes, nunca removidas;
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
| `admin/` | Painel de administração (`index.html`, `admin.js`, `admin.css`), acessado por `/admin/` |
| `api.js` | Camada de acesso ao Supabase (login, listar, CRUD, importar, histórico, tags) |
| `config.js` | Endereço do projeto e chave pública (`anon`) do Supabase |
| `supabase/schema.sql` | Tabelas, políticas, triggers e funções do banco |
| `supabase/migracoes/` | Scripts incrementais para bancos já criados (`002` edição em massa, `003` login, `004` gerenciar tags, `005` categorias, `006` categorias iniciais) |
| `supabase/produtos_seed.csv` | Carga inicial dos produtos |
| `db.json` | Cópia estática usada como contingência |
| `design-system/` | CBS Design System vendorizado ([detalhes](design-system/README.md)) |

**Banco de dados:** tabela `produtos` (`sku`, `descricao_tecnica`, `referencia`, `tags`, `categoria`, `fixo`), tabela `categorias` e `produtos_historico` (preenchida por trigger a cada edição/exclusão). A importação de CSV e a edição de tags em massa são funções SQL (RPC), então rodam de forma atômica: ou tudo é gravado ou nada. Produtos marcados como **fixo** nunca são excluídos pela importação.

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
- A chave `anon` no `config.js` é pública por natureza e não dá permissão de gravação.
- O **Histórico** guarda a versão anterior de tudo o que for alterado ou excluído, e a exportação em CSV serve de backup extra.

## 🛣️ Roadmap

- [x] Busca por partículas, sem acento, com relevância e destaque
- [x] Banco PostgreSQL (Supabase) no lugar do JSON estático
- [x] Painel de administração com CRUD, importação de CSV e histórico
- [x] Edição de tags em massa e gerenciamento de tags (renomear, mesclar, excluir)
- [x] Login no painel (Supabase Auth) e novo visual do painel e exportação de backup em CSV
- [x] CBS Design System aplicado
- [x] Copiar SKU, link compartilhável da busca e tolerância a erro de digitação
- [x] Categorias de produtos (filtro no site, gestão no painel, CSV)
- [ ] Valor e saldo em estoque apenas para usuários logados (exige perfis de acesso e avaliação de dado sensível)
- [ ] Registrar buscas sem resultado, para descobrir apelidos que faltam virar tag
- [ ] Backup automático agendado
- [ ] Atalhos e melhorias de uso no celular

---

_Desenvolvido por **Danilo Buch** — unindo a visão estratégica de Negócios com a Engenharia de Software._
