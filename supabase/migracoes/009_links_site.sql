-- =====================================================================
-- Links do site oficial (migração 009): endereço exato de cada produto em
-- cbsmed.com.br, usado pelo botão "Ver no site" da busca. Preenchido pelo
-- botão "Sincronizar com o site" (aba Importar CSV do painel), que lê a
-- lista pública de produtos do site (WooCommerce) e casa pelo SKU.
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- O mesmo conteúdo já está no schema.sql.
--
-- Sem esta tabela (ou antes da primeira sincronização) o site monta o link
-- pela descrição técnica, como o WordPress faz.
-- =====================================================================

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
