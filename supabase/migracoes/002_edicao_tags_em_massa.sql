-- =====================================================================
-- Edição de tags em massa (aba Produtos do /admin)
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- Este mesmo bloco já está no final do schema.sql (para projetos novos).
-- =====================================================================

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

grant execute on function public.editar_tags_em_massa(text[], text[], text[]) to anon;
