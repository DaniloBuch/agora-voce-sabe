# 🔍 Busca Inteligente CBS (Middleware Cognitivo)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Status](https://img.shields.io/badge/Status-MVP_Conclu%C3%ADdo-success?style=for-the-badge)

## 🎯 O Problema de Negócio (A Dor)

No setor comercial de suprimentos médicos, existe um "Descompasso de Impedância" entre a linguagem do vendedor (apelidos comerciais como "Transofix") e a linguagem do sistema/estoque (descrições técnicas longas e SKUs).
Isso gera alta dependência de funcionários seniores e lentidão na resposta de cotações, criando um gargalo operacional ("Infobesidade" em grupos de comunicação).

## 💡 A Solução

Esta aplicação é um **Motor de Busca Front-end (Single Page Application)** projetado para atuar como um "Filtro de Ruído". Ele consome uma base de dados JSON (derivada de planilhas de "De/Para" do time) e aplica um algoritmo de busca por partículas.

### ⚙️ Funcionalidades Core:

- **Busca Semântica Fuzzy:** O algoritmo tokeniza o input do usuário e verifica a intersecção em qualquer ordem. Digitar `000437 sonda` ou `sonda 04` trará o mesmo resultado.
- **Indexação Tripla:** A pesquisa varre simultaneamente `SKU` + `Descrição Técnica` + `Tags Ocultas (Apelidos)`.
- **Proteção de Renderização (Debounce & Slice):** Implementação de um "Freio ABS" via `setTimeout` para evitar travamento da Main Thread do navegador e limitação de nós na DOM (máx 100 resultados renderizados simultaneamente).
- **UI/UX Corporativa:** Design responsivo, _Skeleton Loaders_ para _Empty States_ das tags e transições de estado limpas (Zero -> Buscando -> Resultado).

## 🏗️ Arquitetura de Dados

Frontend estático (GitHub Pages) + banco **PostgreSQL no Supabase**, acessado direto pela API REST (`api.js`).

1. **Banco:** tabela `produtos` (`sku`, `descricao_tecnica`, `referencia`, `tags`, `fixo`) + `produtos_historico` (desfazer). Script em [`supabase/schema.sql`](supabase/schema.sql).
2. **Site (`/`):** baixa a lista do banco para a memória e busca localmente (milissegundos). Se o banco estiver fora do ar, usa o `db.json` como contingência.
3. **Admin (`/admin/`):** CRUD de produtos e tags, importação em massa de CSV (inclui novos, atualiza descrição/referência e exclui descontinuados, sem tocar nas tags) e histórico com restauração.

Configuração do banco: veja [`SETUP-SUPABASE.md`](SETUP-SUPABASE.md).

## 🎨 Identidade visual

O front-end segue o **CBS Design System** (Manual de Identidade Visual CBS, out/2025). Os tokens (cores, tipografia Quicksand, espaçamento, raios, sombras, movimento), a marca (SVGs) e os ícones (Lucide) ficam vendorizados em [`design-system/`](design-system/README.md) e são carregados por `design-system/styles.css`. Regras que valem aqui: títulos em caixa alta, corpo em Quicksand Light, quadrado do logotipo laranja `#dc9c01`, foco com anel azul, hover sem mudança de tamanho.

## 🚀 Como Rodar o Projeto

**Modo Usuário (Produção):**
Basta acessar o link do GitHub Pages: [CBS - Agora você sabe](https://danilobuch.github.io/agora-voce-sabe/)

**Modo Desenvolvedor (Local):**

1. Clone este repositório: `git clone https://github.com/DaniloBuch/agora-voce-sabe.git`
2. Abra a pasta no VS Code.
3. Instale a extensão **Live Server**.
4. Clique com o botão direito no arquivo `index.html` e selecione "Open with Live Server" (Necessário para não dar bloqueio de CORS na Fetch API).

## 🛣️ Roadmap & Próximos Passos (Evolução Sênior)

Este projeto é a Fase 1 (MVP). O objetivo arquitetural de longo prazo é:

- [ ] **Migração Backend:** Desenvolver uma API RESTful em **Java / Spring Boot**.
- [x] **Persistência de Dados:** JSON estático substituído por PostgreSQL (Supabase) com painel `/admin`.
- [ ] **Segurança:** Implementar Autenticação (Spring Security) para edição das Tags direto pelo sistema, eliminando a dependência do Excel.

---

_Desenvolvido por **Danilo Buch** - Unindo a visão estratégica de Negócios com a Engenharia de Software._
