-- =====================================================================
-- Áreas de atuação e data de inclusão (migração 011)
--
-- * Área de atuação (Hospitais, Clínicas, Laboratórios...): cada produto pode
--   ter VÁRIAS. Aparecem como ícones na busca e viram filtro no site.
--   A lista de áreas (nome + ícone) é editada na aba "Áreas" do painel.
-- * criado_em: data em que o produto entrou no catálogo. Os produtos que já
--   existem ficam sem data (não sabemos quando entraram); os novos ganham a
--   data automaticamente. Usado no filtro "Adicionados recentemente".
--
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- O mesmo conteúdo já está no schema.sql.
-- =====================================================================

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
