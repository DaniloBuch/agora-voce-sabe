-- =====================================================================
-- CBS - Agora Você Sabe  |  Estrutura do banco (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no "SQL Editor" do Supabase e clique em Run.
-- Pode rodar mais de uma vez sem problema (é idempotente).
-- =====================================================================

-- 1) TABELA PRINCIPAL ---------------------------------------------------
create table if not exists public.produtos (
  sku               text primary key check (length(btrim(sku)) > 0),
  descricao_tecnica text        not null default '',
  referencia        text        not null default '',   -- "Cod prd forn"
  tags              text        not null default '',   -- separadas por vírgula (igual ao db.json)
  fixo              boolean     not null default false, -- true = a importação de CSV nunca exclui
  categoria         text        not null default '-',   -- "-" = sem categoria
  atualizado_em     timestamptz not null default now()
);

-- 1b) CATEGORIAS (lista gerenciada no painel; cada produto tem no máximo uma)
alter table public.produtos
  add column if not exists categoria text not null default '-';   -- "-" = sem categoria

create table if not exists public.categorias (
  nome      text        primary key check (btrim(nome) <> '' and nome <> '-'),
  criado_em timestamptz not null default now()
);
-- sem duplicatas que só mudam de maiúscula/minúscula ("Luvas" x "LUVAS")
create unique index if not exists categorias_nome_ci_idx on public.categorias (upper(nome));


-- 2) HISTÓRICO (rede de segurança para desfazer edições e exclusões) ----
create table if not exists public.produtos_historico (
  id           bigint generated always as identity primary key,
  acao         text        not null check (acao in ('UPDATE', 'DELETE')),
  sku          text        not null,
  dados        jsonb       not null,   -- como o produto estava ANTES da mudança
  registrado_em timestamptz not null default now()
);
create index if not exists produtos_historico_registrado_idx
  on public.produtos_historico (registrado_em desc);

-- 2b) FUNÇÕES AUXILIARES e TRIGGER de normalização (troca NULL por texto vazio,
-- tira espaços sobrando e confere a categoria).
-- Junta tags: mantém as que já existem e só ACRESCENTA as novas (sem repetir,
-- sem diferenciar maiúsculas/minúsculas). Nunca remove nada. Aceita "," ou "|".
create or replace function public.mesclar_tags(p_atual text, p_novas text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(d.t, ', ' order by d.ord), '')
  from (
    select distinct on (upper(q.t)) q.t, q.ord
    from (
      select btrim(x.t) as t, x.n as ord
      from unnest(string_to_array(coalesce(p_atual, ''), ',')) with ordinality as x(t, n)
      union all
      select btrim(a.t), 100000 + a.n
      from unnest(string_to_array(replace(coalesce(p_novas, ''), '|', ','), ',')) with ordinality as a(t, n)
    ) q
    where q.t <> ''
    order by upper(q.t), q.ord
  ) d;
$$;

create or replace function public.normalizar_produto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat text;
begin
  new.sku               := btrim(new.sku);
  new.descricao_tecnica := btrim(coalesce(new.descricao_tecnica, ''));
  new.referencia        := btrim(coalesce(new.referencia, ''));
  new.tags              := btrim(coalesce(new.tags, ''));
  new.fixo              := coalesce(new.fixo, false);
  new.categoria         := coalesce(nullif(btrim(coalesce(new.categoria, '')), ''), '-');

  -- categoria nova entra na lista de categorias; a grafia existente vale
  -- ("luvas" vira "Luvas" se a categoria "Luvas" já existe)
  if new.categoria <> '-' then
    select nome into v_cat from public.categorias where upper(nome) = upper(new.categoria);
    if v_cat is null then
      insert into public.categorias (nome) values (new.categoria)
      on conflict do nothing;
    else
      new.categoria := v_cat;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists a_normalizar_produto on public.produtos;
create trigger a_normalizar_produto
  before insert or update on public.produtos
  for each row execute function public.normalizar_produto();

-- 3) TRIGGER: guarda a versão anterior a cada edição/exclusão -----------
create or replace function public.registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.descricao_tecnica, old.referencia, old.tags, old.fixo, old.categoria)
         is distinct from
       (new.descricao_tecnica, new.referencia, new.tags, new.fixo, new.categoria) then
      insert into public.produtos_historico (acao, sku, dados)
      values ('UPDATE', old.sku, to_jsonb(old));
      new.atualizado_em := now();
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.produtos_historico (acao, sku, dados)
    values ('DELETE', old.sku, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_produtos_historico on public.produtos;
create trigger trg_produtos_historico
  before update or delete on public.produtos
  for each row execute function public.registrar_historico();

-- 4) Importação em massa (atômica: ou aplica tudo, ou nada).
-- Cada item: sku, descricao_tecnica, referencia e, se vierem no CSV, categoria e tags.
--   * SKU novo      -> inclui (com categoria e tags do CSV, se houver)
--   * SKU existente -> atualiza descrição/referência; a categoria só muda se o CSV
--                      trouxer uma (célula vazia ou "-" mantém a atual); as tags
--                      do CSV são ACRESCENTADAS às atuais (nunca removem nenhuma)
--   * SKU ausente   -> exclui, se p_excluir_ausentes = true (exceto "fixo")
create or replace function public.importar_catalogo(
  p_itens             jsonb,
  p_excluir_ausentes  boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_inseridos   int := 0;
  v_atualizados int := 0;
  v_excluidos   int := 0;
  v_recebidos   int;
begin
  select count(*) into v_recebidos
  from jsonb_to_recordset(p_itens) as x(sku text)
  where btrim(coalesce(x.sku, '')) <> '';

  if v_recebidos = 0 then
    raise exception 'Importação vazia: nenhum SKU válido foi recebido.';
  end if;

  with entrada as (
    select distinct on (btrim(x.sku))
           btrim(x.sku)                             as sku,
           btrim(coalesce(x.descricao_tecnica, '')) as descricao_tecnica,
           btrim(coalesce(x.referencia, ''))        as referencia,
           case when btrim(coalesce(x.categoria, '')) in ('', '-') then '-'
                else coalesce(c.nome, btrim(x.categoria)) end as categoria,
           public.mesclar_tags('', x.tags)          as tags
    from jsonb_to_recordset(p_itens)
         as x(sku text, descricao_tecnica text, referencia text, categoria text, tags text)
    left join public.categorias c on upper(c.nome) = upper(btrim(coalesce(x.categoria, '')))
    where btrim(coalesce(x.sku, '')) <> ''
  ),
  gravados as (
    insert into public.produtos as p (sku, descricao_tecnica, referencia, categoria, tags)
    select sku, descricao_tecnica, referencia, categoria, tags from entrada
    on conflict (sku) do update
      set descricao_tecnica = excluded.descricao_tecnica,
          referencia        = excluded.referencia,
          categoria         = case when excluded.categoria = '-' then p.categoria
                                   else excluded.categoria end,
          tags              = case when excluded.tags = '' then p.tags
                                   else public.mesclar_tags(p.tags, excluded.tags) end
      where (p.descricao_tecnica, p.referencia, p.categoria, p.tags)
              is distinct from
            (excluded.descricao_tecnica, excluded.referencia,
             case when excluded.categoria = '-' then p.categoria else excluded.categoria end,
             case when excluded.tags = '' then p.tags
                  else public.mesclar_tags(p.tags, excluded.tags) end)
    returning (xmax = 0) as foi_inserido
  )
  select count(*) filter (where foi_inserido),
         count(*) filter (where not foi_inserido)
    into v_inseridos, v_atualizados
  from gravados;

  if p_excluir_ausentes then
    delete from public.produtos p
    where not p.fixo
      and not exists (
        select 1
        from jsonb_to_recordset(p_itens) as x(sku text)
        where btrim(coalesce(x.sku, '')) = p.sku
      );
    get diagnostics v_excluidos = row_count;
  end if;

  return jsonb_build_object(
    'inseridos',   v_inseridos,
    'atualizados', v_atualizados,
    'excluidos',   v_excluidos
  );
end;
$$;

-- 4b) Edição em massa: adiciona/remove tags e/ou define a categoria de vários produtos
-- de uma vez (atômico).
--   * p_adicionar: tags novas (ignora as que o produto já tem)
--   * p_remover:   tags a tirar (compara sem diferenciar maiúsculas/minúsculas)
--   * p_categoria: null = não mexe; vazio ou "-" = tira a categoria; senão define
-- Só grava nos produtos que realmente mudam; cada um deles vai para o histórico.
drop function if exists public.editar_tags_em_massa(text[], text[], text[]);
create or replace function public.editar_tags_em_massa(
  p_skus      text[],
  p_adicionar text[] default '{}',
  p_remover   text[] default '{}',
  p_categoria text   default null
)
returns jsonb
language plpgsql
as $$
declare
  v_alterados int := 0;
  v_cat       text;
begin
  if coalesce(array_length(p_skus, 1), 0) = 0 then
    raise exception 'Nenhum produto selecionado.';
  end if;
  if coalesce(array_length(p_adicionar, 1), 0) = 0
     and coalesce(array_length(p_remover, 1), 0) = 0
     and p_categoria is null then
    raise exception 'Informe ao menos uma tag para adicionar ou remover, ou uma categoria.';
  end if;

  if p_categoria is not null then
    v_cat := coalesce(nullif(btrim(p_categoria), ''), '-');
    if v_cat <> '-' then
      select nome into v_cat from public.categorias where upper(nome) = upper(v_cat);
      v_cat := coalesce(v_cat, btrim(p_categoria));
    end if;
  end if;

  with novas as (
    select p.sku,
           coalesce((
             select string_agg(d.t, ', ' order by d.ord)
             from (
               select distinct on (upper(q.t)) q.t, q.ord
               from (
                 select btrim(x.t) as t, x.n as ord
                 from unnest(string_to_array(p.tags, ',')) with ordinality as x(t, n)
                 union all
                 select btrim(a.t), 100000 + a.n
                 from unnest(p_adicionar) with ordinality as a(t, n)
               ) q
               where q.t <> ''
                 and upper(q.t) <> all (
                   select upper(btrim(r)) from unnest(p_remover) as r
                 )
               order by upper(q.t), q.ord
             ) d
           ), '') as tags
    from public.produtos p
    where p.sku = any (p_skus)
  )
  update public.produtos p
     set tags      = n.tags,
         categoria = coalesce(v_cat, p.categoria)
    from novas n
   where p.sku = n.sku
     and (p.tags is distinct from n.tags
          or p.categoria is distinct from coalesce(v_cat, p.categoria));
  get diagnostics v_alterados = row_count;

  return jsonb_build_object(
    'selecionados', array_length(p_skus, 1),
    'alterados',    v_alterados
  );
end;
$$;


-- 4c) GERENCIAR TAGS (renomear / mesclar / excluir em todos os produtos) -
-- Renomeia, mescla ou exclui uma tag em TODOS os produtos (atômico).
--   * Compara sem diferenciar maiúsculas/minúsculas ("curativo" = "CURATIVO").
--   * p_novo = nome novo. Se o produto já tiver esse nome, fica uma só (mescla).
--   * p_novo vazio = exclui a tag dos produtos.
-- Só grava nos produtos que realmente mudam; cada um deles vai para o histórico.
create or replace function public.renomear_tag(
  p_origem text,
  p_novo   text default ''
)
returns jsonb
language plpgsql
as $$
declare
  v_origem    text := btrim(coalesce(p_origem, ''));
  v_novo      text := btrim(coalesce(p_novo, ''));
  v_afetados  int  := 0;
  v_alterados int  := 0;
begin
  if v_origem = '' then
    raise exception 'Informe a tag que será renomeada.';
  end if;

  select count(*) into v_afetados
  from public.produtos p
  where exists (
    select 1 from unnest(string_to_array(p.tags, ',')) as t
    where upper(btrim(t)) = upper(v_origem)
  );

  with novas as (
    select p.sku,
           coalesce((
             select string_agg(d.t, ', ' order by d.ord)
             from (
               select distinct on (upper(q.t)) q.t, q.ord
               from (
                 select case when upper(btrim(x.t)) = upper(v_origem)
                             then v_novo else btrim(x.t) end as t,
                        x.n as ord
                 from unnest(string_to_array(p.tags, ',')) with ordinality as x(t, n)
               ) q
               where q.t <> ''
               order by upper(q.t), q.ord
             ) d
           ), '') as tags
    from public.produtos p
    where exists (
      select 1 from unnest(string_to_array(p.tags, ',')) as t
      where upper(btrim(t)) = upper(v_origem)
    )
  )
  update public.produtos p
     set tags = n.tags
    from novas n
   where p.sku = n.sku
     and p.tags is distinct from n.tags;
  get diagnostics v_alterados = row_count;

  return jsonb_build_object('afetados', v_afetados, 'alterados', v_alterados);
end;
$$;

revoke execute on function public.renomear_tag(text, text) from public, anon;
grant execute on function public.renomear_tag(text, text) to authenticated;


-- 4d) Gerenciar categorias: renomeia, mescla ou exclui uma categoria (atômico).
--   * p_novo = nome novo. Se já existir outra categoria com esse nome, as duas viram uma só.
--   * p_novo vazio (ou "-") = exclui a categoria; os produtos ficam sem categoria ("-").
-- Compara sem diferenciar maiúsculas/minúsculas. Cada produto alterado vai para o histórico.
create or replace function public.renomear_categoria(
  p_origem text,
  p_novo   text default ''
)
returns jsonb
language plpgsql
as $$
declare
  v_origem    text := btrim(coalesce(p_origem, ''));
  v_novo      text := btrim(coalesce(p_novo, ''));
  v_destino   text;
  v_afetados  int  := 0;
  v_alterados int  := 0;
begin
  if v_origem in ('', '-') then
    raise exception 'Informe a categoria que será renomeada.';
  end if;
  if v_novo = '-' then v_novo := ''; end if;

  select count(*) into v_afetados
  from public.produtos where upper(categoria) = upper(v_origem);

  if v_novo = '' then
    update public.produtos set categoria = '-' where upper(categoria) = upper(v_origem);
    get diagnostics v_alterados = row_count;
    delete from public.categorias where upper(nome) = upper(v_origem);
  else
    select nome into v_destino from public.categorias
     where upper(nome) = upper(v_novo) and upper(nome) <> upper(v_origem);
    if v_destino is not null then
      -- mescla: os produtos passam para a categoria que já existia
      update public.produtos set categoria = v_destino where upper(categoria) = upper(v_origem);
      get diagnostics v_alterados = row_count;
      delete from public.categorias where upper(nome) = upper(v_origem);
    else
      update public.categorias set nome = v_novo where upper(nome) = upper(v_origem);
      if not found then
        insert into public.categorias (nome) values (v_novo) on conflict do nothing;
      end if;
      update public.produtos set categoria = v_novo
       where upper(categoria) = upper(v_origem) and categoria is distinct from v_novo;
      get diagnostics v_alterados = row_count;
    end if;
  end if;

  return jsonb_build_object('afetados', v_afetados, 'alterados', v_alterados);
end;
$$;


-- 5) PERMISSÕES (RLS) ----------------------------------------------------
-- * Qualquer pessoa (anon) só LÊ os produtos: é o que o site público usa.
-- * Quem fez LOGIN (authenticated) pode criar, editar, excluir, importar e
--   ver o histórico: é o painel de administração.
-- IMPORTANTE: no Supabase, desative o cadastro público de usuários
-- (Authentication > Sign In / Providers > Email > "Allow new users to sign up"),
-- senão qualquer pessoa poderia criar uma conta e virar "authenticated".
alter table public.produtos           enable row level security;
alter table public.produtos_historico enable row level security;

drop policy if exists "produtos_select" on public.produtos;
drop policy if exists "produtos_insert" on public.produtos;
drop policy if exists "produtos_update" on public.produtos;
drop policy if exists "produtos_delete" on public.produtos;
drop policy if exists "historico_select" on public.produtos_historico;

create policy "produtos_select" on public.produtos
  for select to anon, authenticated using (true);
create policy "produtos_insert" on public.produtos
  for insert to authenticated with check (true);
create policy "produtos_update" on public.produtos
  for update to authenticated using (true) with check (true);
create policy "produtos_delete" on public.produtos
  for delete to authenticated using (true);
create policy "historico_select" on public.produtos_historico
  for select to authenticated using (true);

grant usage on schema public to anon, authenticated;

revoke insert, update, delete on public.produtos from anon;
revoke all on public.produtos_historico from anon;
grant select on public.produtos to anon;
grant select, insert, update, delete on public.produtos to authenticated;
grant select on public.produtos_historico to authenticated;

revoke execute on function public.importar_catalogo(jsonb, boolean) from public, anon;
grant execute on function public.importar_catalogo(jsonb, boolean) to authenticated;

-- 6) CATEGORIAS: permissões
alter table public.categorias enable row level security;
drop policy if exists "categorias_select" on public.categorias;
drop policy if exists "categorias_insert" on public.categorias;
drop policy if exists "categorias_update" on public.categorias;
drop policy if exists "categorias_delete" on public.categorias;
create policy "categorias_select" on public.categorias
  for select to anon, authenticated using (true);
create policy "categorias_insert" on public.categorias
  for insert to authenticated with check (true);
create policy "categorias_update" on public.categorias
  for update to authenticated using (true) with check (true);
create policy "categorias_delete" on public.categorias
  for delete to authenticated using (true);
revoke insert, update, delete on public.categorias from anon;
grant select on public.categorias to anon;
grant select, insert, update, delete on public.categorias to authenticated;

revoke execute on function public.mesclar_tags(text, text) from public, anon;
revoke execute on function public.editar_tags_em_massa(text[], text[], text[], text) from public, anon;
revoke execute on function public.renomear_categoria(text, text) from public, anon;
grant execute on function public.mesclar_tags(text, text) to authenticated;
grant execute on function public.editar_tags_em_massa(text[], text[], text[], text) to authenticated;
grant execute on function public.renomear_categoria(text, text) to authenticated;

-- 7) SINÔNIMOS: dicionário da busca do site (aba "Sinônimos" do painel)
-- Cada linha é um grupo de palavras equivalentes, nos dois sentidos. Ex.: {cx, caixa}.
create table if not exists public.sinonimos (
  id            bigint      generated always as identity primary key,
  palavras      text[]      not null check (cardinality(palavras) between 2 and 20),
  atualizado_em timestamptz not null default now()
);

-- Padroniza: minúsculas, sem espaços sobrando, sem palavras vazias ou repetidas
create or replace function public.normalizar_sinonimos()
returns trigger
language plpgsql
as $$
begin
  -- mantém a ordem em que as palavras foram digitadas
  new.palavras := array(
    select q.p
    from (
      select lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) as p, min(n) as primeira
      from unnest(new.palavras) with ordinality as u(x, n)
      group by 1
    ) q
    where q.p <> ''
    order by q.primeira
  );
  if cardinality(new.palavras) < 2 then
    raise exception 'Um grupo de sinônimos precisa de pelo menos 2 palavras diferentes.';
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists sinonimos_normalizar on public.sinonimos;
create trigger sinonimos_normalizar
  before insert or update on public.sinonimos
  for each row execute function public.normalizar_sinonimos();

-- Permissões: o site lê (anônimo); só quem tem login altera
alter table public.sinonimos enable row level security;
drop policy if exists "sinonimos_select" on public.sinonimos;
drop policy if exists "sinonimos_insert" on public.sinonimos;
drop policy if exists "sinonimos_update" on public.sinonimos;
drop policy if exists "sinonimos_delete" on public.sinonimos;
create policy "sinonimos_select" on public.sinonimos
  for select to anon, authenticated using (true);
create policy "sinonimos_insert" on public.sinonimos
  for insert to authenticated with check (true);
create policy "sinonimos_update" on public.sinonimos
  for update to authenticated using (true) with check (true);
create policy "sinonimos_delete" on public.sinonimos
  for delete to authenticated using (true);
revoke insert, update, delete on public.sinonimos from anon;
grant select on public.sinonimos to anon;
grant select, insert, update, delete on public.sinonimos to authenticated;

-- Grupos iniciais (abreviações que aparecem nas descrições da base).
-- Só entram se a tabela estiver vazia: rodar de novo não duplica nem desfaz edições.
insert into public.sinonimos (palavras)
select g.palavras
from (values
  (array['cx', 'caixa']),
  (array['pct', 'pacote']),
  (array['cir', 'cirurgico', 'cirurgica']),
  (array['hosp', 'hospitalar']),
  (array['valv', 'valvula']),
  (array['desc', 'descart', 'descartavel']),
  (array['est', 'esteril'])
) as g(palavras)
where not exists (select 1 from public.sinonimos);

-- 8) LINKS DO SITE OFICIAL: endereço exato de cada produto em cbsmed.com.br (botão "Site" da busca)
create table if not exists public.links_site (
  sku           text        primary key,          -- código do catálogo, com 6 dígitos (000927)
  caminho       text        not null,             -- o que vem depois de /produto/ (ex.: traqueia-...-ca-2)
  atualizado_em timestamptz not null default now()
);

-- Troca a lista inteira de uma vez (atômico: ou grava tudo, ou nada).
-- p_itens: [{ "sku": "000927", "caminho": "traqueia-espaco-morto-14mm-x-22mm-unitec-ca-2" }, ...]
create or replace function public.substituir_links_site(p_itens jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_gravados int;
begin
  delete from public.links_site where true;
  insert into public.links_site (sku, caminho)
  select distinct on (btrim(x.sku)) btrim(x.sku), btrim(x.caminho)
  from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(sku text, caminho text)
  where btrim(coalesce(x.sku, '')) <> '' and btrim(coalesce(x.caminho, '')) <> ''
  order by btrim(x.sku);
  get diagnostics v_gravados = row_count;
  return jsonb_build_object('gravados', v_gravados);
end;
$$;

-- Permissões: o site lê (anônimo); só quem tem login sincroniza
alter table public.links_site enable row level security;
drop policy if exists "links_site_select" on public.links_site;
drop policy if exists "links_site_insert" on public.links_site;
drop policy if exists "links_site_update" on public.links_site;
drop policy if exists "links_site_delete" on public.links_site;
create policy "links_site_select" on public.links_site
  for select to anon, authenticated using (true);
create policy "links_site_insert" on public.links_site
  for insert to authenticated with check (true);
create policy "links_site_update" on public.links_site
  for update to authenticated using (true) with check (true);
create policy "links_site_delete" on public.links_site
  for delete to authenticated using (true);
revoke insert, update, delete on public.links_site from anon;
grant select on public.links_site to anon;
grant select, insert, update, delete on public.links_site to authenticated;

revoke execute on function public.substituir_links_site(jsonb) from public, anon;
grant execute on function public.substituir_links_site(jsonb) to authenticated;

-- 9) SINCRONIZAÇÃO COM O SITE (migração 010): o banco lê a lista de produtos de cbsmed.com.br
--    (endereço, ficha técnica e foto) pelo botão do painel e toda segunda-feira às 06:15.
-- 1) Extensões: "http" (chamar o site) e "pg_cron" (agendar)
create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- 2) Tabela (igual à 009) + colunas novas
create table if not exists public.links_site (
  sku           text        primary key,          -- código do catálogo, com 6 dígitos (000927)
  caminho       text        not null,             -- o que vem depois de /produto/ (ex.: traqueia-...-ca-2)
  atualizado_em timestamptz not null default now()
);
alter table public.links_site add column if not exists ficha    text;  -- PDF da ficha técnica
alter table public.links_site add column if not exists imagem   text;  -- foto do produto (sem a imagem genérica)
alter table public.links_site add column if not exists visto_em timestamptz not null default now(); -- última vez que apareceu no site

alter table public.links_site enable row level security;
drop policy if exists "links_site_select" on public.links_site;
drop policy if exists "links_site_insert" on public.links_site;
drop policy if exists "links_site_update" on public.links_site;
drop policy if exists "links_site_delete" on public.links_site;
create policy "links_site_select" on public.links_site
  for select to anon, authenticated using (true);
create policy "links_site_insert" on public.links_site
  for insert to authenticated with check (true);
create policy "links_site_update" on public.links_site
  for update to authenticated using (true) with check (true);
create policy "links_site_delete" on public.links_site
  for delete to authenticated using (true);
revoke insert, update, delete on public.links_site from anon;
grant select on public.links_site to anon;
grant select, insert, update, delete on public.links_site to authenticated;

-- 3) Lê UMA página da lista de produtos do site e grava o que é do catálogo.
--    Uma página por chamada: cada chamada fica bem abaixo do limite de tempo do Supabase.
--    Devolve { pagina, total_paginas, lidos, gravados, inicio }.
create or replace function public.sincronizar_links_site_pagina(p_pagina int)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_resp     extensions.http_response;
  v_total    int;
  v_itens    jsonb;
  v_gravados int;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '7');
  select * into v_resp from extensions.http_get(
    'https://cbsmed.com.br/wp-json/wc/store/v1/products?per_page=100&page=' || greatest(p_pagina, 1)
    || '&_fields=sku,permalink,description,images'
  );
  if v_resp.status <> 200 then
    raise exception 'O site respondeu com erro % na página % da lista de produtos.', v_resp.status, p_pagina;
  end if;

  select nullif(h.value, '')::int into v_total
  from unnest(v_resp.headers) as h
  where lower(h.field) = 'x-wp-totalpages'
  limit 1;

  v_itens := v_resp.content::jsonb;
  if jsonb_typeof(v_itens) <> 'array' then
    raise exception 'Resposta inesperada do site na página %.', p_pagina;
  end if;

  with prod as (
    select
      -- SKU do site sem zeros (927) -> código do catálogo (000927)
      case when btrim(coalesce(p->>'sku', '')) ~ '^[0-9]+$' and length(btrim(p->>'sku')) < 6
           then lpad(btrim(p->>'sku'), 6, '0') else btrim(coalesce(p->>'sku', '')) end as sku,
      regexp_replace(regexp_replace(coalesce(p->>'permalink', ''), '^https?://(www\.)?cbsmed\.com\.br/produto/', ''), '/+$', '') as caminho,
      substring(coalesce(p->>'description', '') from '(https?://[^"''<>[:space:]]+\.pdf)') as ficha,
      nullif(p->'images'->0->>'src', '') as imagem
    from jsonb_array_elements(v_itens) as p
  ), novos as (
    select distinct on (prod.sku)
      prod.sku, prod.caminho, prod.ficha,
      case when prod.imagem ilike '%placeholder%' then null else prod.imagem end as imagem
    from prod
    join public.produtos pr on pr.sku = prod.sku          -- só o que existe no catálogo
    where prod.sku <> '' and prod.caminho <> ''
    order by prod.sku
  )
  insert into public.links_site as l (sku, caminho, ficha, imagem, visto_em)
  select sku, caminho, ficha, imagem, now() from novos
  on conflict (sku) do update
    set caminho  = excluded.caminho,
        ficha    = excluded.ficha,
        imagem   = excluded.imagem,
        visto_em = excluded.visto_em,
        atualizado_em = case
          when (l.caminho, l.ficha, l.imagem) is distinct from (excluded.caminho, excluded.ficha, excluded.imagem)
          then now() else l.atualizado_em end;
  get diagnostics v_gravados = row_count;

  return jsonb_build_object(
    'pagina', p_pagina,
    'total_paginas', coalesce(v_total, 0),
    'lidos', jsonb_array_length(v_itens),
    'gravados', v_gravados,
    'inicio', now()
  );
end;
$$;

-- 4) Fecha a sincronização: tira quem não apareceu mais no site e devolve o resumo.
--    p_inicio = "inicio" devolvido pela página 1. Nunca apaga tudo por engano.
create or replace function public.finalizar_links_site(p_inicio timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vistos    int;
  v_removidos int;
begin
  select count(*) into v_vistos from public.links_site where visto_em >= p_inicio;
  if v_vistos = 0 then
    raise exception 'Nenhum produto do site foi lido nesta sincronização; nada foi removido.';
  end if;
  delete from public.links_site where visto_em < p_inicio;
  get diagnostics v_removidos = row_count;
  return (
    select jsonb_build_object(
      'total', count(*),
      'com_ficha', count(*) filter (where ficha is not null),
      'com_imagem', count(*) filter (where imagem is not null),
      'removidos', v_removidos
    )
    from public.links_site
  );
end;
$$;

-- 5) Sincronização completa numa chamada só (usada pelo agendamento)
create or replace function public.sincronizar_links_site()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r      jsonb;
  v_inicio timestamptz;
  v_total  int;
begin
  v_r := public.sincronizar_links_site_pagina(1);
  v_inicio := (v_r->>'inicio')::timestamptz;
  v_total := greatest((v_r->>'total_paginas')::int, 1);
  for i in 2..v_total loop
    perform public.sincronizar_links_site_pagina(i);
  end loop;
  return public.finalizar_links_site(v_inicio);
end;
$$;

revoke execute on function public.sincronizar_links_site_pagina(int) from public, anon;
revoke execute on function public.finalizar_links_site(timestamptz) from public, anon;
revoke execute on function public.sincronizar_links_site() from public, anon, authenticated;
grant execute on function public.sincronizar_links_site_pagina(int) to authenticated;
grant execute on function public.finalizar_links_site(timestamptz) to authenticated;

-- 6) Agendamento: toda segunda-feira às 06:15 de Brasília (09:15 UTC).
--    As fichas e imagens mudam pouco; uma vez por semana basta, e o botão do
--    painel sincroniza na hora quando entrar produto novo.
--    Para ver as últimas execuções:
--      select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--    Para desligar:  select cron.unschedule('sincronizar-links-site');
select cron.schedule('sincronizar-links-site', '15 9 * * 1', $$select public.sincronizar_links_site()$$);


-- 11) ÁREAS DE ATUAÇÃO E DATA DE INCLUSÃO (igual à migração 011) ------
-- 1) Colunas novas em produtos
alter table public.produtos add column if not exists areas text[] not null default '{}';
alter table public.produtos add column if not exists criado_em timestamptz;   -- vazio nos que já existiam
alter table public.produtos alter column criado_em set default now();          -- os novos ganham a data
create index if not exists produtos_criado_em_idx on public.produtos (criado_em desc nulls last);

-- 2) Lista de áreas (nome + ícone)
create table if not exists public.areas (
  nome      text        primary key check (btrim(nome) <> '' and nome <> '-'),
  icone     text        not null default 'briefcase-medical',  -- chave do ícone (areas-icones.js)
  ordem     int         not null default 100,                  -- ordem de exibição
  criado_em timestamptz not null default now()
);
create unique index if not exists areas_nome_ci_idx on public.areas (upper(nome));

-- Sugestões iniciais (só entram se a tabela estiver vazia; nenhum produto é marcado)
insert into public.areas (nome, icone, ordem)
select a.nome, a.icone, a.ordem
from (values
  ('Hospitais',        'hospital',            10),
  ('Clínicas',         'stethoscope',         20),
  ('Laboratórios',     'test-tube-diagonal',  30),
  ('Veterinária',      'paw-print',           40),
  ('Odontologia',      'smile',               50),
  ('Home Care',        'house',               60),
  ('Emergência e APH', 'ambulance',           70),
  ('Farmácias',        'pill',                80)
) as a(nome, icone, ordem)
where not exists (select 1 from public.areas);

-- 3) Padroniza as áreas de cada produto: sem espaços sobrando, sem repetir,
--    com a grafia da lista ("hospitais" vira "Hospitais"); área nova entra na lista.
create or replace function public.normalizar_areas_produto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saida text[] := '{}';
  v_area  text;
  v_nome  text;
begin
  foreach v_area in array coalesce(new.areas, '{}') loop
    v_area := regexp_replace(btrim(coalesce(v_area, '')), '\s+', ' ', 'g');
    continue when v_area = '' or v_area = '-';
    select nome into v_nome from public.areas where upper(nome) = upper(v_area);
    if v_nome is null then
      insert into public.areas (nome) values (v_area) on conflict do nothing;
      v_nome := v_area;
    end if;
    if not exists (select 1 from unnest(v_saida) s where upper(s) = upper(v_nome)) then
      v_saida := v_saida || v_nome;
    end if;
  end loop;
  new.areas := v_saida;
  return new;
end;
$$;

drop trigger if exists b_normalizar_areas on public.produtos;
create trigger b_normalizar_areas
  before insert or update of areas on public.produtos
  for each row execute function public.normalizar_areas_produto();

-- 4) Histórico também registra mudança de área
create or replace function public.registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.descricao_tecnica, old.referencia, old.tags, old.fixo, old.categoria, old.areas)
         is distinct from
       (new.descricao_tecnica, new.referencia, new.tags, new.fixo, new.categoria, new.areas) then
      insert into public.produtos_historico (acao, sku, dados)
      values ('UPDATE', old.sku, to_jsonb(old));
      new.atualizado_em := now();
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.produtos_historico (acao, sku, dados)
    values ('DELETE', old.sku, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

-- 5) Criar / renomear / mesclar / trocar ícone de uma área (atômico).
--    p_origem vazio = área nova. Se p_nome já existe (outra área), mescla.
create or replace function public.salvar_area(
  p_origem text,
  p_nome   text,
  p_icone  text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_origem    text := btrim(coalesce(p_origem, ''));
  v_nome      text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_icone     text := nullif(btrim(coalesce(p_icone, '')), '');
  v_destino   text;
  v_alterados int  := 0;
begin
  if v_nome in ('', '-') then
    raise exception 'Informe o nome da área.';
  end if;

  if v_origem = '' then
    if exists (select 1 from public.areas where upper(nome) = upper(v_nome)) then
      raise exception 'A área "%" já existe.', v_nome;
    end if;
    insert into public.areas (nome, icone) values (v_nome, coalesce(v_icone, 'briefcase-medical'));
    return jsonb_build_object('alterados', 0);
  end if;

  select nome into v_destino from public.areas
   where upper(nome) = upper(v_nome) and upper(nome) <> upper(v_origem);

  if v_destino is not null then
    -- mescla: quem tinha a origem passa a ter o destino (sem repetir)
    update public.produtos
       set areas = array(select distinct on (upper(x)) x
                         from unnest(array_replace_ci(areas, v_origem, v_destino)) as x)
     where exists (select 1 from unnest(areas) a where upper(a) = upper(v_origem));
    get diagnostics v_alterados = row_count;
    delete from public.areas where upper(nome) = upper(v_origem);
    if v_icone is not null then
      update public.areas set icone = v_icone where nome = v_destino;
    end if;
  else
    update public.areas set nome = v_nome, icone = coalesce(v_icone, icone)
     where upper(nome) = upper(v_origem);
    if not found then
      insert into public.areas (nome, icone) values (v_nome, coalesce(v_icone, 'briefcase-medical'));
    end if;
    update public.produtos
       set areas = array_replace_ci(areas, v_origem, v_nome)
     where exists (select 1 from unnest(areas) a where upper(a) = upper(v_origem) and a <> v_nome);
    get diagnostics v_alterados = row_count;
  end if;
  return jsonb_build_object('alterados', v_alterados);
end;
$$;

-- troca um item do array sem diferenciar maiúsculas/minúsculas (mantém a posição)
create or replace function public.array_replace_ci(p_arr text[], p_de text, p_para text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(case when upper(x) = upper(p_de) then p_para else x end order by n), '{}')
  from unnest(coalesce(p_arr, '{}')) with ordinality as u(x, n);
$$;

-- 6) Excluir uma área: some da lista e de todos os produtos (fica no Histórico)
create or replace function public.excluir_area(p_nome text)
returns jsonb
language plpgsql
as $$
declare
  v_alterados int := 0;
begin
  update public.produtos
     set areas = array(select a from unnest(areas) a where upper(a) <> upper(btrim(p_nome)))
   where exists (select 1 from unnest(areas) a where upper(a) = upper(btrim(p_nome)));
  get diagnostics v_alterados = row_count;
  delete from public.areas where upper(nome) = upper(btrim(p_nome));
  return jsonb_build_object('alterados', v_alterados);
end;
$$;

-- 7) Edição em massa: acrescenta e/ou tira áreas de vários produtos (atômico)
create or replace function public.editar_areas_em_massa(
  p_skus      text[],
  p_adicionar text[] default '{}',
  p_remover   text[] default '{}'
)
returns jsonb
language plpgsql
as $$
declare
  v_alterados int := 0;
begin
  update public.produtos p
     set areas = array(
           select x from (
             select a as x, n from unnest(p.areas) with ordinality as u(a, n)
              where not exists (select 1 from unnest(coalesce(p_remover, '{}')) r where upper(r) = upper(a))
             union all
             select a, 1000 + n from unnest(coalesce(p_adicionar, '{}')) with ordinality as v(a, n)
              where not exists (select 1 from unnest(p.areas) e where upper(e) = upper(a))
                and not exists (select 1 from unnest(coalesce(p_remover, '{}')) r where upper(r) = upper(a))
           ) q order by n)
   where p.sku = any(p_skus);
  get diagnostics v_alterados = row_count;
  return jsonb_build_object('alterados', v_alterados);
end;
$$;

-- 8) Permissões: o site lê (anônimo); só quem tem login altera
alter table public.areas enable row level security;
drop policy if exists "areas_select" on public.areas;
drop policy if exists "areas_insert" on public.areas;
drop policy if exists "areas_update" on public.areas;
drop policy if exists "areas_delete" on public.areas;
create policy "areas_select" on public.areas for select to anon, authenticated using (true);
create policy "areas_insert" on public.areas for insert to authenticated with check (true);
create policy "areas_update" on public.areas for update to authenticated using (true) with check (true);
create policy "areas_delete" on public.areas for delete to authenticated using (true);
revoke insert, update, delete on public.areas from anon;
grant select on public.areas to anon;
grant select, insert, update, delete on public.areas to authenticated;

revoke execute on function public.salvar_area(text, text, text) from public, anon;
revoke execute on function public.excluir_area(text) from public, anon;
revoke execute on function public.editar_areas_em_massa(text[], text[], text[]) from public, anon;
grant execute on function public.salvar_area(text, text, text) to authenticated;
grant execute on function public.excluir_area(text) to authenticated;
grant execute on function public.editar_areas_em_massa(text[], text[], text[]) to authenticated;
grant execute on function public.array_replace_ci(text[], text, text) to authenticated;
