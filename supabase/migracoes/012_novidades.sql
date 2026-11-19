-- =====================================================================
-- Novidades (migração 012)
--
-- * Tabela "novidades": as mensagens do sino do site. São escritas na aba
--   "Novidades" do painel; a cada atualização do site chegam sugestões prontas
--   (arquivo novidades-site.json) que podem ser publicadas como estão, editadas
--   ou ignoradas. O site (anônimo) só lê as publicadas.
-- * Função "produtos_removidos": os produtos que saíram do catálogo nos últimos
--   dias, para o painel de novidades do site (só código, descrição, referência,
--   categoria e data; o histórico completo continua restrito ao painel).
--
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- O mesmo conteúdo já está no schema.sql.
-- =====================================================================

-- 1) Mensagens do sino
create table if not exists public.novidades (
  id            bigint      generated always as identity primary key,
  chave         text        unique,                       -- id da sugestão (novidades-site.json); vazio = escrita à mão
  titulo        text        not null check (btrim(titulo) <> ''),
  texto         text        not null default '',
  status        text        not null default 'publicada' check (status in ('publicada', 'ignorada')),
  publicado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists novidades_publicado_idx on public.novidades (publicado_em desc);

create or replace function public.novidades_carimbo()
returns trigger
language plpgsql
as $$
begin
  new.titulo := btrim(new.titulo);
  new.texto := btrim(coalesce(new.texto, ''));
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists novidades_carimbo on public.novidades;
create trigger novidades_carimbo
  before insert or update on public.novidades
  for each row execute function public.novidades_carimbo();

alter table public.novidades enable row level security;
drop policy if exists "novidades_select_publicadas" on public.novidades;
drop policy if exists "novidades_select_painel" on public.novidades;
drop policy if exists "novidades_insert" on public.novidades;
drop policy if exists "novidades_update" on public.novidades;
drop policy if exists "novidades_delete" on public.novidades;
-- o site vê só as publicadas (e nada com data futura: dá para agendar)
create policy "novidades_select_publicadas" on public.novidades
  for select to anon using (status = 'publicada' and publicado_em <= now());
create policy "novidades_select_painel" on public.novidades
  for select to authenticated using (true);
create policy "novidades_insert" on public.novidades for insert to authenticated with check (true);
create policy "novidades_update" on public.novidades for update to authenticated using (true) with check (true);
create policy "novidades_delete" on public.novidades for delete to authenticated using (true);
revoke insert, update, delete on public.novidades from anon;
grant select on public.novidades to anon;
grant select, insert, update, delete on public.novidades to authenticated;

-- 2) Produtos removidos do catálogo nos últimos p_dias (os que voltaram não aparecem)
create or replace function public.produtos_removidos(p_dias int default 90, p_limite int default 500)
returns table (sku text, descricao_tecnica text, referencia text, categoria text, removido_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.sku, r.descricao_tecnica, r.referencia, r.categoria, r.removido_em
  from (
    select distinct on (h.sku)
           h.sku,
           coalesce(h.dados->>'descricao_tecnica', '') as descricao_tecnica,
           coalesce(h.dados->>'referencia', '')        as referencia,
           coalesce(h.dados->>'categoria', '-')        as categoria,
           h.registrado_em                             as removido_em
    from public.produtos_historico h
    where h.acao = 'DELETE'
      and h.registrado_em >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 366)))
      and not exists (select 1 from public.produtos p where p.sku = h.sku)
    order by h.sku, h.registrado_em desc
  ) r
  order by r.removido_em desc, r.sku
  limit greatest(1, least(coalesce(p_limite, 500), 2000));
$$;

revoke execute on function public.produtos_removidos(int, int) from public;
grant execute on function public.produtos_removidos(int, int) to anon, authenticated;
