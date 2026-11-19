-- =====================================================================
-- Unidade de medida (migração 013)
--
-- * Coluna "unidade" nos produtos (UN, CX, PC, FR, RL...). Aparece na busca,
--   na cotação (a UM do item já entra certa) e é editada no painel.
-- * Importação de CSV: se o arquivo tiver a coluna UM (ou "Unidade"), ela é
--   gravada; célula vazia mantém a unidade atual.
-- * Sempre em MAIÚSCULAS e sem espaços sobrando. Vazio = ainda não informada.
--
-- Cole no SQL Editor do Supabase e clique em Run. Pode rodar mais de uma vez.
-- O mesmo conteúdo já está no schema.sql.
-- =====================================================================

-- 1) Coluna nova
alter table public.produtos add column if not exists unidade text not null default '';

-- 2) Padroniza: maiúsculas, sem espaços nas pontas
create or replace function public.normalizar_unidade_produto()
returns trigger
language plpgsql
as $$
begin
  new.unidade := upper(btrim(coalesce(new.unidade, '')));
  return new;
end;
$$;

drop trigger if exists c_normalizar_unidade on public.produtos;
create trigger c_normalizar_unidade
  before insert or update on public.produtos
  for each row execute function public.normalizar_unidade_produto();

-- 3) Histórico também registra mudança de unidade
create or replace function public.registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.descricao_tecnica, old.referencia, old.tags, old.fixo, old.categoria, old.areas, old.unidade)
         is distinct from
       (new.descricao_tecnica, new.referencia, new.tags, new.fixo, new.categoria, new.areas, new.unidade) then
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

-- 4) Importação de CSV com a unidade (mesmas regras de antes + UM)
--   * SKU novo      -> inclui (com categoria, tags e UM do CSV, se houver)
--   * SKU existente -> atualiza descrição/referência; categoria e UM só mudam se o
--                      CSV trouxer (vazio mantém); tags do CSV são ACRESCENTADAS
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
           public.mesclar_tags('', x.tags)          as tags,
           upper(btrim(coalesce(x.unidade, '')))    as unidade
    from jsonb_to_recordset(p_itens)
         as x(sku text, descricao_tecnica text, referencia text, categoria text, tags text, unidade text)
    left join public.categorias c on upper(c.nome) = upper(btrim(coalesce(x.categoria, '')))
    where btrim(coalesce(x.sku, '')) <> ''
  ),
  gravados as (
    insert into public.produtos as p (sku, descricao_tecnica, referencia, categoria, tags, unidade)
    select sku, descricao_tecnica, referencia, categoria, tags, unidade from entrada
    on conflict (sku) do update
      set descricao_tecnica = excluded.descricao_tecnica,
          referencia        = excluded.referencia,
          categoria         = case when excluded.categoria = '-' then p.categoria
                                   else excluded.categoria end,
          tags              = case when excluded.tags = '' then p.tags
                                   else public.mesclar_tags(p.tags, excluded.tags) end,
          unidade           = case when excluded.unidade = '' then p.unidade
                                   else excluded.unidade end
      where (p.descricao_tecnica, p.referencia, p.categoria, p.tags, p.unidade)
              is distinct from
            (excluded.descricao_tecnica, excluded.referencia,
             case when excluded.categoria = '-' then p.categoria else excluded.categoria end,
             case when excluded.tags = '' then p.tags
                  else public.mesclar_tags(p.tags, excluded.tags) end,
             case when excluded.unidade = '' then p.unidade else excluded.unidade end)
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
