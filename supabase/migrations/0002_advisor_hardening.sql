-- Advisor-driven hardening (Supabase security + performance lints, 2026-06-10).
-- 1. Pin search_path on set_updated_at (lint 0011: function_search_path_mutable).
-- 2. Revoke API-role EXECUTE on internal trigger functions (lints 0028/0029:
--    SECURITY DEFINER functions exposed via /rest/v1/rpc).
-- 3. Wrap auth.uid() in a scalar subquery so RLS evaluates it once per statement
--    instead of once per row (lint 0003: auth_rls_initplan).
-- 4. Covering index for the mock_templates.exam_id FK (lint 0001).

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end; $$;

revoke execute on function public.set_updated_at()  from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop policy "own row"   on public.users;
drop policy "own plans" on public.study_plans;
drop policy "own prog"  on public.user_progress;
drop policy "own cards" on public.fsrs_cards;
drop policy "own mocks" on public.mock_attempts;

create policy "own row"   on public.users         for all using ((select auth.uid()) = id)      with check ((select auth.uid()) = id);
create policy "own plans" on public.study_plans   for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own prog"  on public.user_progress for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own cards" on public.fsrs_cards    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own mocks" on public.mock_attempts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists idx_mock_templates_exam on public.mock_templates (exam_id);
