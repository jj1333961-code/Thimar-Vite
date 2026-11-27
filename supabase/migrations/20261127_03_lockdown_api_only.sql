-- ============================================================================
-- ثمار — إغلاق الوصول المباشر: الواجهة الوحيدة هي public.thimar_api
--
-- يُطبَّق بعد 20261127_02_secure_api.sql وبعد نشر العميل الذي يستخدمها.
-- ما يفعله:
--   * يحذف كل سياسات "السماح للجميع" على جداول ثمار.
--   * يسحب كل الأذونات على جداول ثمار من anon/authenticated/PUBLIC.
--   * يبقي الوصول عبر دوال SECURITY DEFINER فقط (thimar_api + دوال FCM/التسميع).
--   * يمنع الرفع المجهول إلى حاوية الوسائط ويُبقي قراءة الملفات القديمة.
-- لا يحذف أي بيانات.
-- ============================================================================

-- 1) إسقاط سياسات السماح المفتوح
drop policy if exists thimar_accounts_all on public.thimar_accounts;
drop policy if exists thimar_notifications_all on public.thimar_notifications;
drop policy if exists thimar_conversations_all on public.thimar_conversations;
drop policy if exists thimar_chat_messages_all on public.thimar_chat_messages;
drop policy if exists thimar_link_requests_all on public.thimar_link_requests;
drop policy if exists thimar_deletions_all on public.thimar_deletions;
drop policy if exists thimar_memorization_plans_all on public.thimar_memorization_plans;
drop policy if exists thimar_push_subscriptions_all on public.thimar_push_subscriptions;
drop policy if exists challenge_rooms_all on public.thimar_challenge_rooms;
drop policy if exists challenge_events_all on public.thimar_challenge_events;

-- 2) سحب الأذونات من كل جداول ثمار
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'thimar%'
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- الجداول الجديدة: لا سياسات إطلاقًا ⇒ منع افتراضي.
alter table public.thimar_media enable row level security;
alter table public.thimar_homework enable row level security;
alter table public.thimar_homework_submissions enable row level security;
alter table public.thimar_password_resets enable row level security;
alter table public.thimar_api_sessions enable row level security;
alter table public.thimar_auth_rate_limits enable row level security;
alter table public.thimar_client_errors enable row level security;

-- 3) لا رفع مجهول إلى حاوية الوسائط (الملفات القديمة تبقى مقروءة بروابطها)
drop policy if exists "thimar chat media write" on storage.objects;
drop policy if exists "thimar chat media delete" on storage.objects;

-- 4) الدوال المسموح تنفيذها من العميل فقط
revoke all on function public.thimar_api(text, text, jsonb) from public;
grant execute on function public.thimar_api(text, text, jsonb) to anon, authenticated;
revoke all on function public.thimar_authorize_device(text, text, text) from public;
grant execute on function public.thimar_authorize_device(text, text, text) to anon, authenticated;

-- 5) تقرير حالة الأمان (للمشرف/الاختبارات): لا يكشف أي سرّ.
create or replace function public.thimar_security_status()
returns jsonb language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'lockedAt', '2026-11-27',
    'apiOnly', true,
    'openPolicies', coalesce((
      select jsonb_agg(p.tablename || '.' || p.policyname)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename like 'thimar%'
        and coalesce(p.qual, '') = 'true' and p.cmd in ('ALL', 'SELECT')), '[]'::jsonb),
    'tablesWithAnonGrants', coalesce((
      select jsonb_agg(g.table_name)
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name like 'thimar%'
        and g.grantee in ('anon', 'authenticated')), '[]'::jsonb),
    'passwordAlgo', coalesce((
      select jsonb_object_agg(algo, n) from (
        select coalesce(password_algo, 'sha256') as algo, count(*)::int as n
        from public.thimar_accounts group by 1) x), '{}'::jsonb),
    'accounts', (select count(*)::int from public.thimar_accounts),
    'liveSessions', (select count(*)::int from public.thimar_api_sessions where revoked_at is null and expires_at > now()),
    'pendingPasswordResets', (select count(*)::int from public.thimar_password_resets where status = 'pending'),
    'recentErrors', (select count(*)::int from public.thimar_client_errors where created_at > now() - interval '24 hours'),
    'openMediaUploads', (
      select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT')
  );
$$;
revoke all on function public.thimar_security_status() from public;
grant execute on function public.thimar_security_status() to anon, authenticated;
