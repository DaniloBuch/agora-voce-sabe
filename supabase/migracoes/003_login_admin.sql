-- =====================================================================
-- Login no painel de administração (migração 003)
-- Para bancos que já existem: cole no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez. O mesmo bloco já está no fim do schema.sql.
--
-- ANTES de rodar: (1) publique os arquivos novos do site no GitHub e
-- (2) crie seu usuário em Authentication > Users > Add user (marque
-- "Auto Confirm User") e (3) desative o cadastro público
-- (Authentication > Sign In / Providers > Email > "Allow new users to sign up").
-- Depois de rodar, só quem estiver logado consegue gravar.
-- =====================================================================

-- 5) PERMISSÕES (RLS) ----------------------------------------------------
-- * Qualquer pessoa (anon) só LÊ os produtos: é o que o site público usa.
-- * Quem fez LOGIN (authenticated) pode criar, editar, excluir, importar e
--   ver o histórico: é o painel de administração.
-- IMPORTANTE: no Supabase, desative o cadastro público de usuários
-- (Authentication > Sign In / Providers > Email > "Allow new users to sign up"),
-- senão qualquer pessoa poderia criar uma conta e virar "authenticated".
alter table public.produtos           enable row level security;
alter table public.produtos_historico enable row level security;

drop policy if exists "produtos_select" on public.produtos;
drop policy if exists "produtos_insert" on public.produtos;
drop policy if exists "produtos_update" on public.produtos;
drop policy if exists "produtos_delete" on public.produtos;
drop policy if exists "historico_select" on public.produtos_historico;

create policy "produtos_select" on public.produtos
  for select to anon, authenticated using (true);
create policy "produtos_insert" on public.produtos
  for insert to authenticated with check (true);
create policy "produtos_update" on public.produtos
  for update to authenticated using (true) with check (true);
create policy "produtos_delete" on public.produtos
  for delete to authenticated using (true);
create policy "historico_select" on public.produtos_historico
  for select to authenticated using (true);

grant usage on schema public to anon, authenticated;

revoke insert, update, delete on public.produtos from anon;
revoke all on public.produtos_historico from anon;
grant select on public.produtos to anon;
grant select, insert, update, delete on public.produtos to authenticated;
grant select on public.produtos_historico to authenticated;

revoke execute on function public.importar_catalogo(jsonb, boolean) from public, anon;
revoke execute on function public.editar_tags_em_massa(text[], text[], text[]) from public, anon;
grant execute on function public.importar_catalogo(jsonb, boolean) to authenticated;
grant execute on function public.editar_tags_em_massa(text[], text[], text[]) to authenticated;
