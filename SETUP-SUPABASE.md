# Passo a passo: colocar o banco de dados (Supabase) no ar

Tempo estimado: 20–30 minutos. Não precisa instalar nada, tudo é feito pelo navegador.

> Enquanto o `config.js` estiver vazio, o site continua funcionando normalmente
> lendo o `db.json`. Ou seja: dá para fazer tudo com calma, sem derrubar nada.

## 1. Criar a conta e o projeto

1. Acesse <https://supabase.com> e clique em **Start your project** (pode entrar com o GitHub).
2. Clique em **New project** e preencha:
   - **Name:** `agora-voce-sabe`
   - **Database Password:** crie uma senha forte e **guarde num lugar seguro** (você quase não vai usar, mas não dá para recuperar).
   - **Region:** `South America (São Paulo)`.
3. Clique em **Create new project** e espere 1–2 minutos até ficar pronto.

## 2. Criar as tabelas (SQL)

1. No menu da esquerda, abra **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/schema.sql` deste repositório, copie **todo** o conteúdo e cole no editor.
3. Clique em **Run**. Deve aparecer "Success. No rows returned".

Isso cria a tabela `produtos`, a tabela de histórico (para desfazer erros), a função de
importação em massa e as permissões de acesso.

## 3. Carregar os produtos atuais

1. Menu da esquerda: **Table Editor** → tabela **produtos**.
2. Clique em **Insert** → **Import data from CSV**.
3. Escolha o arquivo `supabase/produtos_seed.csv` (5.751 produtos já com as tags atuais).
4. Confira se as colunas foram reconhecidas (`sku`, `descricao_tecnica`, `referencia`, `tags`, `fixo`) e confirme.
5. Ao terminar, a tabela deve mostrar 5.751 linhas.

## 4. Conectar o site ao banco

1. Menu da esquerda: **Project Settings** (engrenagem) → **API** (ou **API Keys**).
2. Copie dois valores:
   - **Project URL** (algo como `https://abcdefghijkl.supabase.co`)
   - a chave **anon public** (ou **publishable**). **Não** copie a `service_role`/`secret`!
3. Abra o `config.js` e cole:

   ```js
   window.CBS_CONFIG = {
     SUPABASE_URL: "https://abcdefghijkl.supabase.co",
     SUPABASE_ANON_KEY: "cole-a-chave-anon-aqui",
   };
   ```

4. Faça commit e push. Em ~1 minuto o GitHub Pages atualiza.

## 5. Testar

- Site: abra a página inicial. O card deve dizer **"5751 produtos carregados"** (sem "modo contingência").
- Admin: acesse `https://danilobuch.github.io/agora-voce-sabe/admin/`. Edite as tags de um produto,
  salve, recarregue o site público e busque por ele.

## Como usar o /admin

| Aba | Para quê |
| --- | --- |
| **Produtos** | Buscar, criar, editar (inclusive tags) e excluir. O filtro **"Só sem tags"** mostra o que falta etiquetar. |
| **Importar CSV** | Atualiza a base em massa (veja abaixo). |
| **Histórico** | Mostra versões anteriores de qualquer edição/exclusão, com botão **Restaurar**. Alterações em massa aparecem agrupadas, com **Restaurar todos**. |

### Importação de CSV

O arquivo precisa ter as colunas **Codigo**, **Descricao** e **Cod prd forn** (qualquer ordem;
aceita `;` ou `,` e acentos em UTF-8 ou Windows-1252). A importação:

- **Inclui** os códigos que ainda não existem (com tags vazias).
- **Atualiza** descrição/referência dos que mudaram. **Nunca altera as tags.**
- **Exclui** (opcional) os códigos que não estão mais no CSV. Antes de gravar você vê o resumo e
  as listas. Se a exclusão for grande (mais de 20% da base ou 200 itens) o sistema pede uma
  confirmação extra, para evitar apagar tudo por engano com um CSV incompleto.
- Zeros à esquerda perdidos pelo Excel são recuperados (`462` vira `000462`).
- É **tudo ou nada**: se algo falhar, nada é alterado.

Produtos marcados como **Fixo** (ex.: `999999 – NAO FAZ PARTE DO NOSSO PORTIFOLIO`) nunca são
excluídos pela importação.

### Edição de tags em massa

Útil quando vários produtos de descrição parecida levam a mesma tag.

1. Na aba **Produtos**, filtre (ex.: `aparelho pressao`) e marque os produtos: a caixa do cabeçalho
   marca a página; **"Selecionar os N resultados do filtro"** marca todas as páginas.
2. Clique em **Editar tags em massa**. Digite as tags a **adicionar** (Enter ou vírgula) e/ou a
   **remover**; as tags já presentes na seleção aparecem para você clicar e remover.
3. A prévia mostra quantos produtos mudam. Em **Aplicar**, as tags existentes são preservadas, sem
   duplicar, e tudo é gravado de uma vez (tudo ou nada).
4. Para desfazer: aba **Histórico** → **Restaurar todos** na linha "Edição em massa".

> **Importante (uma vez só):** a edição em massa usa uma função no banco. Se ainda não rodou,
> abra o **SQL Editor** do Supabase, cole o conteúdo de
> `supabase/migracoes/002_edicao_tags_em_massa.sql` e clique em **Run**.

## Pontos de atenção

- **O /admin não tem senha** (decisão do projeto). Como o site é estático, a chave pública precisa
  ter permissão de gravação; quem tiver a URL do admin ou inspecionar o site consegue editar a
  base. O **Histórico** é a rede de segurança: tudo que é editado/excluído pode ser restaurado.
  Se um dia quiser proteger, o caminho natural é adicionar login (Supabase Auth) e trocar as
  políticas do arquivo `schema.sql` de `anon` para `authenticated`.
- **Plano gratuito do Supabase:** projetos sem uso por um período podem ser pausados. Se o banco
  ficar fora do ar, o site entra em **modo contingência** (lê o `db.json`, com aviso em vermelho
  no card inicial) e esse arquivo pode estar desatualizado. Para reativar, entre no painel e
  clique em **Restore**.
- **Referências numéricas:** no `db.json` antigo, algumas referências já tinham perdido zeros no
  final (ex.: `231.04` em vez de `231.040`). Isso veio do Excel e foi migrado como estava; a
  próxima importação do CSV corrige quando o CSV trouxer o valor certo.
