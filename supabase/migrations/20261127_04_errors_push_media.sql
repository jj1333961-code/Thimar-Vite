-- ============================================================================
-- ثمار — مراقبة أخطاء الإنتاج وتسجيل اشتراك Web Push
--
-- دوال صغيرة مستقلة بدل توسيع `thimar_api`: الجداول تبقى مغلقة أمام
-- anon/authenticated، والوصول عبر SECURITY DEFINER فقط.
-- ============================================================================

-- ---------- 1) أخطاء العملاء ----------
create table if not exists public.thimar_client_errors (
  id bigserial primary key,
  account_id text,
  role text,
  kind text,
  message text,
  stack text,
  source text,
  version text,
  platform text,
  url text,
  ua text,
  country text,
  created_at timestamptz not null default now()
);
create index if not exists thimar_client_errors_created_idx
  on public.thimar_client_errors (created_at desc);
alter table public.thimar_client_errors enable row level security;
revoke all on table public.thimar_client_errors from public, anon, authenticated;

/**
 * تسجيل خطأ من التطبيق. يقبل جلسة أو لا يقبلها (أخطاء شاشة الدخول مهمة أيضًا)،
 * ويحدّ المعدّل لكل هوية حتى لا يُستخدم كنفق إساءة.
 */
create or replace function public.thimar_report_error(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me text;
  v_role text;
  v_key text;
begin
  if p_token is not null and length(p_token) > 0 then
    select s.account_id into v_me
      from public.thimar_api_sessions s
     where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       and s.revoked_at is null and s.expires_at > now()
     limit 1;
  end if;
  if v_me is not null then
    select type into v_role from public.thimar_accounts where id = v_me;
  end if;

  v_key := 'err:' || coalesce(v_me, 'anon');
  if not public.thimar_rate_hit(v_key, 40, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  end if;
  perform public.thimar_rate_fail(v_key);

  insert into public.thimar_client_errors
    (account_id, role, kind, message, stack, source, version, platform, url, ua, country)
  values (
    v_me,
    v_role,
    left(coalesce(p_data->>'kind', 'error'), 40),
    left(coalesce(p_data->>'message', ''), 800),
    left(coalesce(p_data->>'stack', ''), 4000),
    left(coalesce(p_data->>'source', ''), 200),
    left(coalesce(p_data->>'version', ''), 40),
    left(coalesce(p_data->>'platform', ''), 40),
    left(coalesce(p_data->>'url', ''), 300),
    left(coalesce(p_data->>'ua', ''), 240),
    left(coalesce(p_data->>'country', ''), 8)
  );
  return jsonb_build_object('ok', true);
end;
$$;

/** لوحة الأخطاء للمسؤول: آخر 100 خطأ بلا أي بيانات أسرار. */
create or replace function public.thimar_admin_errors(p_token text)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := public.thimar_require_session(p_token);
  v_type text;
begin
  select type into v_type from public.thimar_accounts where id = v_me;
  if v_type is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object('errors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'accountId', e.account_id, 'role', e.role, 'kind', e.kind,
      'message', e.message, 'stack', e.stack, 'source', e.source,
      'version', e.version, 'platform', e.platform, 'url', e.url,
      'country', e.country, 'createdAt', e.created_at)
      order by e.created_at desc)
    from (select * from public.thimar_client_errors order by created_at desc limit 100) e), '[]'::jsonb));
end;
$$;

-- ---------- 2) تسجيل اشتراك Web Push ----------
/** يُسجّل اشتراك الدفع لهوية الجلسة فقط؛ لا يمكن تسجيله لحساب آخر. */
create or replace function public.thimar_push_register(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := public.thimar_require_session(p_token);
  v_endpoint text := nullif(btrim(coalesce(p_data->>'endpoint', '')), '');
begin
  if v_endpoint is null then
    raise exception 'ENDPOINT_REQUIRED' using errcode = '22023';
  end if;
  if not public.thimar_rate_hit('pushsub:' || v_me, 20, interval '1 hour') then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;
  perform public.thimar_rate_fail('pushsub:' || v_me);

  insert into public.thimar_push_subscriptions as s
    (account_id, endpoint, p256dh, auth, timezone, latitude, longitude,
     prayer_method, adhan_enabled, daily_enabled, created_at, updated_at)
  values (
    v_me, v_endpoint, p_data->>'p256dh', p_data->>'auth',
    coalesce(p_data->>'timezone', 'UTC'),
    nullif(p_data->>'latitude', '')::double precision,
    nullif(p_data->>'longitude', '')::double precision,
    coalesce((p_data->>'prayerMethod')::int, 4),
    coalesce((p_data->>'adhan')::boolean, true),
    coalesce((p_data->>'daily')::boolean, true),
    (extract(epoch from now()) * 1000)::bigint,
    (extract(epoch from now()) * 1000)::bigint)
  on conflict (endpoint) do update
    set account_id = v_me,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        timezone = excluded.timezone,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        prayer_method = excluded.prayer_method,
        adhan_enabled = excluded.adhan_enabled,
        daily_enabled = excluded.daily_enabled,
        updated_at = excluded.updated_at
    where s.account_id = v_me;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.thimar_report_error(text, jsonb) from public;
grant execute on function public.thimar_report_error(text, jsonb) to anon, authenticated;
revoke all on function public.thimar_admin_errors(text) from public;
grant execute on function public.thimar_admin_errors(text) to anon, authenticated;
revoke all on function public.thimar_push_register(text, jsonb) from public;
grant execute on function public.thimar_push_register(text, jsonb) to anon, authenticated;

-- تقرير الأمان يعرض عدّاد الأخطاء أيضًا (يُعاد إنشاؤه ليشمل الجدول الجديد).
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
