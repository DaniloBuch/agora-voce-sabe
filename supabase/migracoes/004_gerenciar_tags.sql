-- =====================================================================
-- Gerenciar tags (migração 004): aba "Tags" do painel de administração.
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- Rode DEPOIS da 003 (login). O mesmo bloco já está no schema.sql.
-- =====================================================================

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
