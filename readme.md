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

## 🏗️ Arquitetura de Dados (ETL Simplificado)

Por ser um MVP _Serverless_, a arquitetura de dados flui da seguinte forma:

1. **Extract:** Planilha Excel base com colunas `SKU`, `Descrição` e `Tags` (CSV).
2. **Transform:** Conversão para formato `.json`. No frontend, o JS normaliza os dados (Tratamento de Strings para Arrays).
3. **Load:** O Fetch API consome o JSON estático hospedado no próprio repositório, carregando-o para a memória RAM (busca em milissegundos).

## 🚀 Como Rodar o Projeto

**Modo Usuário (Produção):**
Basta acessar o link do GitHub Pages: Processando..

**Modo Desenvolvedor (Local):**

1. Clone este repositório: `git clone https://github.com/DaniloBuch/agora-voce-sabe.git`
2. Abra a pasta no VS Code.
3. Instale a extensão **Live Server**.
4. Clique com o botão direito no arquivo `index.html` e selecione "Open with Live Server" (Necessário para não dar bloqueio de CORS na Fetch API).

## 🛣️ Roadmap & Próximos Passos (Evolução Sênior)

Este projeto é a Fase 1 (MVP). O objetivo arquitetural de longo prazo é:

- [ ] **Migração Backend:** Desenvolver uma API RESTful em **Java / Spring Boot**.
- [ ] **Persistência de Dados:** Substituir o JSON estático por um Banco de Dados Relacional (**PostgreSQL/MySQL**).
- [ ] **Segurança:** Implementar Autenticação (Spring Security) para edição das Tags direto pelo sistema, eliminando a dependência do Excel.

---

_Desenvolvido por **Danilo Buch** - Unindo a visão estratégica de Negócios com a Engenharia de Software._
