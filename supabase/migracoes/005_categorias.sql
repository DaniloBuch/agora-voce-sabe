-- =====================================================================
-- Categorias (migração 005): filtro por categoria no site e aba "Categorias"
-- no painel. Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais
-- de uma vez. Rode DEPOIS da 004. O mesmo conteúdo já está no schema.sql.
-- Depois rode também a 006 (categorias iniciais dos produtos atuais).
-- =====================================================================

-- 1) Coluna e tabela de categorias
alter table public.produtos
  add column if not exists categoria text not null default '-';   -- "-" = sem categoria

create table if not exists public.categorias (
  nome      text        primary key check (btrim(nome) <> '' and nome <> '-'),
  criado_em timestamptz not null default now()
);
-- sem duplicatas que só mudam de maiúscula/minúscula ("Luvas" x "LUVAS")
create unique index if not exists categorias_nome_ci_idx on public.categorias (upper(nome));

-- 2) Funções auxiliares e gatilhos (agora cientes da categoria)
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

-- 3) Importação (aceita categoria e tags) e edição em massa (aceita categoria)
-- Importação em massa (atômica: ou aplica tudo, ou nada).
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

-- Edição em massa: adiciona/remove tags e/ou define a categoria de vários produtos
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

-- 4) Gerenciar categorias
-- Gerenciar categorias: renomeia, mescla ou exclui uma categoria (atômico).
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

-- 5) Permissões
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
