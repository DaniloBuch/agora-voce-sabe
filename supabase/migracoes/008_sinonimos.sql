-- =====================================================================
-- Sinônimos (migração 008): dicionário de abreviações e jargões usado pela
-- busca do site ("cx" = "caixa", "cir" = "cirurgico"...) e editado na aba
-- "Sinônimos" do painel. Cole no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez. O mesmo conteúdo já está no schema.sql.
--
-- Cada linha é um GRUPO: todas as palavras do grupo valem como a mesma
-- coisa na busca (nos dois sentidos). Ex.: {cx, caixa}.
-- =====================================================================

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
