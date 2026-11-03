-- =====================================================================
-- Sincronização com o site oficial pelo próprio Supabase (migração 010)
--
-- O navegador não pode ler a lista de produtos de cbsmed.com.br (o site não
-- libera CORS), então quem lê é o BANCO, de servidor para servidor, com a
-- extensão "http". De cada produto do site guardamos: o endereço exato da
-- página, o link do PDF da ficha técnica e o link da imagem.
--
-- * Botão "Sincronizar com o site" (painel, aba Importar CSV): lê página por
--   página (100 produtos cada), mostrando o progresso.
-- * Automático: toda segunda-feira às 06:15 (horário de Brasília), pelo pg_cron.
--
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- Inclui a 009 (tabela links_site); não precisa ter rodado a 009 antes.
-- =====================================================================

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
