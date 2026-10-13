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
  atualizado_em     timestamptz not null default now()
);

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

-- 2b) TRIGGER: troca NULL por texto vazio (um CSV importado pelo painel do
-- Supabase costuma trazer células vazias como NULL) e tira espaços sobrando.
create or replace function public.normalizar_produto()
returns trigger
language plpgsql
as $$
begin
  new.sku               := btrim(new.sku);
  new.descricao_tecnica := btrim(coalesce(new.descricao_tecnica, ''));
  new.referencia        := btrim(coalesce(new.referencia, ''));
  new.tags              := btrim(coalesce(new.tags, ''));
  new.fixo              := coalesce(new.fixo, false);
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
    if (old.descricao_tecnica, old.referencia, old.tags, old.fixo)
         is distinct from
       (new.descricao_tecnica, new.referencia, new.tags, new.fixo) then
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

-- 4) IMPORTAÇÃO EM MASSA (atômica: ou aplica tudo, ou nada) ------------
-- Recebe a lista do CSV (sku, descricao_tecnica, referencia):
--   * SKU novo        -> inclui (tags vazias)
--   * SKU existente   -> atualiza descrição/referência (NUNCA mexe nas tags)
--   * SKU ausente     -> exclui, se p_excluir_ausentes = true (exceto "fixo")
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
           btrim(x.sku)                         as sku,
           btrim(coalesce(x.descricao_tecnica, '')) as descricao_tecnica,
           btrim(coalesce(x.referencia, ''))        as referencia
    from jsonb_to_recordset(p_itens)
         as x(sku text, descricao_tecnica text, referencia text)
    where btrim(coalesce(x.sku, '')) <> ''
  ),
  gravados as (
    insert into public.produtos as p (sku, descricao_tecnica, referencia)
    select sku, descricao_tecnica, referencia from entrada
    on conflict (sku) do update
      set descricao_tecnica = excluded.descricao_tecnica,
          referencia        = excluded.referencia
      where (p.descricao_tecnica, p.referencia)
              is distinct from (excluded.descricao_tecnica, excluded.referencia)
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

-- 4b) EDIÇÃO DE TAGS EM MASSA ------------------------------------------
-- Adiciona e/ou remove tags de vários produtos de uma vez (atômico).
--   * p_adicionar: tags novas (ignora as que o produto já tem)
--   * p_remover:   tags a tirar (compara sem diferenciar maiúsculas/minúsculas)
-- Só grava nos produtos que realmente mudam; cada um deles vai para o histórico.
create or replace function public.editar_tags_em_massa(
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
  if coalesce(array_length(p_skus, 1), 0) = 0 then
    raise exception 'Nenhum produto selecionado.';
  end if;
  if coalesce(array_length(p_adicionar, 1), 0) = 0
     and coalesce(array_length(p_remover, 1), 0) = 0 then
    raise exception 'Informe ao menos uma tag para adicionar ou remover.';
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
     set tags = n.tags
    from novas n
   where p.sku = n.sku
     and p.tags is distinct from n.tags;
  get diagnostics v_alterados = row_count;

  return jsonb_build_object(
    'selecionados', array_length(p_skus, 1),
    'alterados',    v_alterados
  );
end;
$$;


-- 5) PERMISSÕES (RLS) ----------------------------------------------------
-- ATENÇÃO: como combinado, o /admin NÃO tem login. Isso significa que a
-- chave pública (anon) precisa poder gravar. Qualquer pessoa que tenha a
-- URL do Supabase + a chave (ambas ficam visíveis no site) consegue editar.
-- O histórico acima existe justamente para poder desfazer qualquer estrago.
alter table public.produtos           enable row level security;
alter table public.produtos_historico enable row level security;

drop policy if exists "produtos_select" on public.produtos;
drop policy if exists "produtos_insert" on public.produtos;
drop policy if exists "produtos_update" on public.produtos;
drop policy if exists "produtos_delete" on public.produtos;
drop policy if exists "historico_select" on public.produtos_historico;

create policy "produtos_select" on public.produtos
  for select to anon using (true);
create policy "produtos_insert" on public.produtos
  for insert to anon with check (true);
create policy "produtos_update" on public.produtos
  for update to anon using (true) with check (true);
create policy "produtos_delete" on public.produtos
  for delete to anon using (true);
create policy "historico_select" on public.produtos_historico
  for select to anon using (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.produtos to anon;
grant select on public.produtos_historico to anon;
grant execute on function public.importar_catalogo(jsonb, boolean) to anon;
grant execute on function public.editar_tags_em_massa(text[], text[], text[]) to anon;
