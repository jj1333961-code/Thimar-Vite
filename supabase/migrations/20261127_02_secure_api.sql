-- ============================================================================
-- ثمار — واجهة الخادم الموحّدة (thimar_api) + جداول الواجبات واستعادة كلمة المرور
--
-- يُطبَّق هذا الملف قبل 20261127_03_lockdown_api_only.sql.
-- كل الدوال SECURITY DEFINER مع search_path مثبّت، وهي وحدها من يشتق هوية
-- المستخدم — لا يُقبل أي معرّف حساب من العميل.
--
-- الحالة/النوع لا يختارهما العميل أبدًا:
--   * register: معلّم => pending، غيره => active (قرار الخادم).
--   * account.update لا يمسّ status/type/banned/password.
--   * لا توجد أي عملية تسمح بإنشاء نوع admin من العميل.
-- ============================================================================

-- ---------- 1) بنية الأمان الأساسية -----------------------------------------
alter table public.thimar_accounts
  add column if not exists password_algo text not null default 'sha256';

create table if not exists public.thimar_api_sessions (
  id             uuid primary key default gen_random_uuid(),
  account_id     text not null references public.thimar_accounts(id) on delete cascade,
  token_hash     text not null unique,
  device_id      text,
  platform       text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_reason text
);
create index if not exists thimar_api_sessions_account_idx
  on public.thimar_api_sessions (account_id) where revoked_at is null;
create index if not exists thimar_api_sessions_live_idx
  on public.thimar_api_sessions (token_hash) where revoked_at is null;

create table if not exists public.thimar_media (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  uploader_id     text not null,
  file_name       text,
  mime            text,
  size_bytes      integer not null,
  sha256          text not null,
  bytes           bytea not null,
  created_at      timestamptz not null default now()
);
create index if not exists thimar_media_conversation_idx
  on public.thimar_media (conversation_id);

create table if not exists public.thimar_homework (
  id         text primary key,
  teacher_id text not null,
  student_id text not null,
  data       jsonb not null,
  created_at bigint not null default 0,
  due_at     bigint not null default 0,
  updated_at bigint not null default 0
);
create index if not exists thimar_homework_student_idx on public.thimar_homework (student_id);
create index if not exists thimar_homework_teacher_idx on public.thimar_homework (teacher_id);

create table if not exists public.thimar_homework_submissions (
  id          text primary key,
  homework_id text not null,
  student_id  text not null,
  teacher_id  text,
  data        jsonb not null,
  score       integer,
  feedback    text,
  graded_at   bigint,
  created_at  bigint not null default 0,
  updated_at  bigint not null default 0
);
create index if not exists thimar_submissions_student_idx on public.thimar_homework_submissions (student_id);
create index if not exists thimar_submissions_homework_idx on public.thimar_homework_submissions (homework_id);

create table if not exists public.thimar_password_resets (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null references public.thimar_accounts(id) on delete cascade,
  username    text not null,
  channel     text not null default 'admin',
  contact     text,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists thimar_password_resets_open_idx
  on public.thimar_password_resets (created_at desc) where status = 'pending';

-- ---------- 2) كلمات المرور ---------------------------------------------------
create or replace function public.thimar_pw_hash(p_password text)
returns text language sql volatile
set search_path = public, extensions, pg_temp
as $$ select extensions.crypt(p_password, extensions.gen_salt('bf', 12)); $$;

create or replace function public.thimar_pw_dummy_hash()
returns text language sql immutable
as $$ select '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7VQ0zEwJ0M3wZ0m9K3Vn0Yq4n5rZt8u'::text $$;

create or replace function public.thimar_pw_verify(
  p_password text, p_hash text, p_salt text, p_algo text
) returns boolean language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare v_hash text := coalesce(p_hash, '');
begin
  if p_password is null or v_hash = '' then return false; end if;
  if p_algo = 'bcrypt' or v_hash like '$2%' then
    begin
      return extensions.crypt(p_password, v_hash) = v_hash;
    exception when others then
      return false;
    end;
  end if;
  return encode(extensions.digest(coalesce(p_salt, '') || ':' || p_password, 'sha256'), 'hex') = v_hash;
end;
$$;

-- ---------- 3) الجلسات --------------------------------------------------------
create or replace function public.thimar_session_issue(
  p_account_id text, p_device_id text default null, p_platform text default null,
  p_ttl interval default interval '30 days'
) returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := 'ts_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_exp timestamptz := now() + p_ttl;
begin
  insert into public.thimar_api_sessions (account_id, token_hash, device_id, platform, expires_at)
  values (p_account_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_device_id, p_platform, v_exp)
  returning id into v_id;

  delete from public.thimar_api_sessions s
   where s.account_id = p_account_id
     and s.revoked_at is null
     and s.id not in (
       select id from public.thimar_api_sessions
        where account_id = p_account_id and revoked_at is null
        order by created_at desc limit 20);

  return jsonb_build_object('token', v_token, 'sessionId', v_id, 'expiresAt', v_exp);
end;
$$;

create or replace function public.thimar_require_session(p_token text)
returns text language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_account text; v_sid uuid;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select s.id, s.account_id into v_sid, v_account
    from public.thimar_api_sessions s
   where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and s.revoked_at is null
     and s.expires_at > now();
  if v_account is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  update public.thimar_api_sessions
     set last_seen_at = now()
   where id = v_sid and last_seen_at < now() - interval '5 minutes';
  return v_account;
end;
$$;

create or replace function public.thimar_session_revoke(p_token text, p_reason text default 'logout')
returns boolean language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_n int;
begin
  update public.thimar_api_sessions
     set revoked_at = now(), revoked_reason = p_reason
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---------- 4) إسقاطات الحساب (بلا أي سرّ) ------------------------------------
create or replace function public.thimar_account_json(p_row public.thimar_accounts)
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'id', p_row.id, 'type', p_row.type, 'full_name', p_row.full_name,
    'country_code', p_row.country_code, 'phone', p_row.phone, 'email', p_row.email,
    'username', p_row.username, 'created_at', p_row.created_at,
    'status', p_row.status, 'rejection_reason', p_row.rejection_reason,
    'student', p_row.student, 'teacher', p_row.teacher, 'guardian', p_row.guardian,
    'banned', p_row.banned);
$$;

create or replace function public.thimar_public_account_json(p_row public.thimar_accounts)
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'id', p_row.id, 'type', p_row.type, 'full_name', p_row.full_name,
    'username', p_row.username, 'status', p_row.status);
$$;

/* دليل المعلمين: يحتاجه الطالب لاختيار معلم، ولا يحمل أي بيانات تواصل خاصة. */
create or replace function public.thimar_directory_json(p_row public.thimar_accounts)
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'id', p_row.id, 'type', p_row.type, 'full_name', p_row.full_name,
    'username', p_row.username, 'status', p_row.status,
    'country_code', p_row.country_code, 'teacher', p_row.teacher);
$$;

/* هل يوجد رابط معتمد (أو مطلوب) بين معلّم وطالب؟ */
create or replace function public.thimar_linked(p_a text, p_b text)
returns boolean language sql stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.thimar_link_requests l
     where coalesce(l.status, 'pending') <> 'rejected'
       and ((l.payload->>'teacherId' = p_a and l.payload->>'studentId' = p_b)
         or (l.payload->>'teacherId' = p_b and l.payload->>'studentId' = p_a)));
$$;

-- ---------- 5) تحديد المعدّل ---------------------------------------------------
create or replace function public.thimar_rate_hit(
  p_key text, p_limit int default 10, p_window interval default interval '15 minutes'
) returns boolean language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_failures int;
begin
  insert into public.thimar_auth_rate_limits (key, window_start, failures)
  values (p_key, date_trunc('hour', now()) + ((extract(minute from now())::int / 15)::int * interval '15 minutes'), 0)
  on conflict (key, window_start) do nothing;

  select failures into v_failures from public.thimar_auth_rate_limits
   where key = p_key order by window_start desc limit 1;

  return coalesce(v_failures, 0) < p_limit;
end;
$$;

create or replace function public.thimar_rate_fail(p_key text)
returns void language sql volatile
set search_path = public, extensions, pg_temp
as $$
  insert into public.thimar_auth_rate_limits (key, window_start, failures)
  values (p_key, date_trunc('hour', now()) + ((extract(minute from now())::int / 15)::int * interval '15 minutes'), 1)
  on conflict (key, window_start)
  do update set failures = public.thimar_auth_rate_limits.failures + 1;
$$;

-- ---------- 6) تفويض الجهاز (يدعم bcrypt والقديم) ------------------------------
create or replace function public.thimar_authorize_device(
  p_account_id text, p_password text, p_device_id text
) returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.thimar_accounts;
  v_ok boolean := false;
  v_secret text;
  v_ip text := public.thimar_client_ip();
  v_account_key text := 'device-auth:account:' || btrim(coalesce(p_account_id, ''));
  v_ip_key text := 'device-auth:ip:' || v_ip;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_id, '')), '') is null
     or coalesce(p_password, '') = '' or length(p_password) > 200 then
    raise exception 'INVALID_ARGUMENT';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_account_key));
  perform pg_advisory_xact_lock(hashtext(v_ip_key));
  perform pg_advisory_xact_lock(hashtext('thimar-fcm-device:' || btrim(p_device_id)));
  if exists (select 1 from public.thimar_auth_rate_limits
              where key in (v_account_key, v_ip_key)
                and window_start > now() - interval '15 minutes'
                and failures >= case when key like 'device-auth:ip:%' then 30 else 8 end) then
    raise exception 'RATE_LIMITED';
  end if;

  select * into v_account from public.thimar_accounts where id = btrim(p_account_id);
  if v_account.id is null then
    perform public.thimar_pw_verify('thimar-dummy-password', public.thimar_pw_dummy_hash(), '', 'bcrypt');
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;

  v_ok := public.thimar_pw_verify(p_password, v_account.password_hash, v_account.password_salt, v_account.password_algo);
  if not v_ok or v_account.banned is true or v_account.status is distinct from 'active' then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;
  perform public.thimar_note_auth_attempt(v_account_key, true);
  perform public.thimar_note_auth_attempt(v_ip_key, true);

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.thimar_device_authorizations (account_id, device_id, secret_hash, expires_at, revoked_at)
  values (btrim(p_account_id), btrim(p_device_id),
          extensions.crypt(v_secret, extensions.gen_salt('bf', 12)), now() + interval '90 days', null)
  on conflict (account_id, device_id) do update
    set secret_hash = excluded.secret_hash, issued_at = now(),
        expires_at = excluded.expires_at, revoked_at = null, last_used_at = null;
  return v_secret;
end;
$$;

-- ---------- 7) الدخول ---------------------------------------------------------
create or replace function public.thimar_api_login(
  p_username text, p_password text,
  p_device_id text default null, p_platform text default null
) returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.thimar_accounts;
  v_key text := 'login:' || lower(coalesce(p_username, ''));
  v_session jsonb;
begin
  if coalesce(btrim(p_username), '') = '' or coalesce(p_password, '') = '' then
    raise exception 'MISSING_CREDENTIALS' using errcode = '22023';
  end if;
  if not public.thimar_rate_hit(v_key, 10) then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;

  select * into v_row from public.thimar_accounts
   where lower(username) = lower(btrim(p_username)) limit 1;

  if v_row.id is null then
    perform public.thimar_pw_verify(coalesce(p_password, ''), public.thimar_pw_dummy_hash(), '', 'bcrypt');
    perform public.thimar_rate_fail(v_key);
    raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
  end if;

  if not public.thimar_pw_verify(p_password, v_row.password_hash, v_row.password_salt, v_row.password_algo) then
    perform public.thimar_rate_fail(v_key);
    raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
  end if;

  if v_row.banned then raise exception 'ACCOUNT_BANNED' using errcode = '42501'; end if;
  if v_row.status <> 'active' then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;

  if v_row.password_algo <> 'bcrypt' or coalesce(v_row.password_hash, '') not like '$2%' then
    update public.thimar_accounts
       set password_hash = public.thimar_pw_hash(p_password),
           password_salt = null,
           password_algo = 'bcrypt'
     where id = v_row.id
     returning * into v_row;
  end if;

  delete from public.thimar_auth_rate_limits where key = v_key;
  v_session := public.thimar_session_issue(v_row.id, p_device_id, p_platform);
  return jsonb_build_object(
    'token', v_session->>'token',
    'expiresAt', v_session->>'expiresAt',
    'account', public.thimar_account_json(v_row));
end;
$$;

-- ---------- 8) التسجيل (النوع والحد الأدنى للحالة من الخادم) -------------------
create or replace function public.thimar_api_register(p_account jsonb, p_password text)
returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_id text := nullif(p_account->>'id', '');
  v_username text := lower(btrim(coalesce(p_account->>'username', '')));
  v_type text := lower(coalesce(p_account->>'type', 'student'));
  v_status text;
  v_row public.thimar_accounts;
  v_session jsonb;
begin
  if v_username = '' then raise exception 'MISSING_USERNAME' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  if v_type not in ('student', 'guardian', 'teacher') then
    raise exception 'INVALID_TYPE' using errcode = '22023';
  end if;
  -- قرار الخادم: المعلم ينتظر الاعتماد، وغيره يبدأ نشطًا.
  v_status := case when v_type = 'teacher' then 'pending' else 'active' end;
  if v_id is null then v_id := 'acc-' || (extract(epoch from now()) * 1000)::bigint; end if;

  if exists (select 1 from public.thimar_accounts where lower(username) = v_username) then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
  end if;
  if not public.thimar_rate_hit('register:' || public.thimar_client_ip(), 15) then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;
  perform public.thimar_rate_fail('register:' || public.thimar_client_ip());

  insert into public.thimar_accounts as a (
    id, type, full_name, country_code, phone, email, username, created_at,
    status, student, teacher, guardian, banned, password_hash, password_salt, password_algo)
  values (
    v_id, v_type, coalesce(p_account->>'full_name', ''), coalesce(p_account->>'country_code', 'SA'),
    coalesce(p_account->>'phone', ''), coalesce(p_account->>'email', ''), v_username,
    coalesce((p_account->>'created_at')::bigint, (extract(epoch from now()) * 1000)::bigint),
    v_status, p_account->'student', p_account->'teacher', p_account->'guardian',
    false, public.thimar_pw_hash(p_password), null, 'bcrypt')
  returning * into v_row;

  v_session := public.thimar_session_issue(v_row.id, p_account->>'device_id', p_account->>'platform');
  return jsonb_build_object(
    'token', v_session->>'token',
    'expiresAt', v_session->>'expiresAt',
    'account', public.thimar_account_json(v_row));
end;
$$;

-- ---------- 9) استعادة كلمة المرور -------------------------------------------
/* طلب استعادة: يُسجَّل للمراجعة ولا يكشف وجود الاسم أو عدمه. */
create or replace function public.thimar_password_reset_request(p_username text, p_contact text default null)
returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_row public.thimar_accounts; v_key text := 'pwreset:' || lower(btrim(coalesce(p_username, '')));
begin
  if coalesce(btrim(p_username), '') = '' then
    raise exception 'MISSING_USERNAME' using errcode = '22023';
  end if;
  if not public.thimar_rate_hit(v_key, 5) then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;
  perform public.thimar_rate_fail(v_key);

  select * into v_row from public.thimar_accounts
   where lower(username) = lower(btrim(p_username)) limit 1;
  if v_row.id is not null and not exists (
    select 1 from public.thimar_password_resets r
     where r.account_id = v_row.id and r.status = 'pending') then
    insert into public.thimar_password_resets (account_id, username, contact)
    values (v_row.id, v_row.username, left(coalesce(p_contact, ''), 120));
  end if;
  -- نفس الرد دائمًا: لا تسريب لوجود الحساب.
  return jsonb_build_object('ok', true);
end;
$$;

/* استعادة من جهاز موثوق: يثبت الملكية بسرّ الجهاز المخزَّن في العتاد. */
create or replace function public.thimar_password_reset_device(
  p_username text, p_device_id text, p_device_secret text, p_new_password text
) returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.thimar_accounts;
  v_key text := 'pwresetdev:' || lower(btrim(coalesce(p_username, '')));
  v_session jsonb;
begin
  if coalesce(p_new_password, '') = '' or length(p_new_password) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  if coalesce(btrim(p_device_id), '') = '' or coalesce(p_device_secret, '') = '' then
    raise exception 'DEVICE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not public.thimar_rate_hit(v_key, 5) then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;

  select * into v_row from public.thimar_accounts
   where lower(username) = lower(btrim(p_username)) limit 1;
  if v_row.id is null or v_row.banned then
    perform public.thimar_rate_fail(v_key);
    raise exception 'DEVICE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.thimar_device_authorizations d
     where d.account_id = v_row.id and d.device_id = btrim(p_device_id)
       and d.revoked_at is null and d.expires_at > now()
       and extensions.crypt(p_device_secret, d.secret_hash) = d.secret_hash) then
    perform public.thimar_rate_fail(v_key);
    raise exception 'DEVICE_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  update public.thimar_accounts
     set password_hash = public.thimar_pw_hash(p_new_password),
         password_salt = null, password_algo = 'bcrypt',
         status = case when status = 'pending' then status else 'active' end
   where id = v_row.id
   returning * into v_row;

  update public.thimar_api_sessions set revoked_at = now(), revoked_reason = 'password_reset'
   where account_id = v_row.id and revoked_at is null;
  update public.thimar_device_authorizations set revoked_at = now()
   where account_id = v_row.id and revoked_at is null;
  update public.thimar_password_resets set status = 'resolved', resolved_at = now(), resolved_by = 'device'
   where account_id = v_row.id and status = 'pending';

  delete from public.thimar_auth_rate_limits where key = 'login:' || lower(v_row.username);

  v_session := public.thimar_session_issue(v_row.id, btrim(p_device_id), 'password-reset');
  return jsonb_build_object(
    'ok', true,
    'token', v_session->>'token',
    'expiresAt', v_session->>'expiresAt',
    'account', public.thimar_account_json(v_row));
end;
$$;

-- ---------- 10) الواجهة الوحيدة -------------------------------------------------
create or replace function public.thimar_api(
  p_token text, p_op text, p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me text;
  v_row public.thimar_accounts;
  v_admin boolean := false;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_op text := lower(coalesce(p_op, ''));
  v_conv text;
  v_media public.thimar_media;
  v_target text;
  v_temp text;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  -- ===== عمليات بلا جلسة =====
  if v_op = 'health' then
    return jsonb_build_object('ok', true, 'now', now());
  elsif v_op = 'login' then
    return public.thimar_api_login(v_data->>'username', v_data->>'password',
                                   v_data->>'deviceId', v_data->>'platform');
  elsif v_op = 'register' then
    return public.thimar_api_register(coalesce(v_data->'account', v_data), v_data->>'password');
  elsif v_op = 'password.reset.request' then
    return public.thimar_password_reset_request(v_data->>'username', v_data->>'contact');
  elsif v_op = 'password.reset.device' then
    return public.thimar_password_reset_device(v_data->>'username', v_data->>'deviceId',
                                               v_data->>'deviceSecret', v_data->>'newPassword');
  end if;

  -- ===== كل ما تبقّى يتطلب جلسة =====
  v_me := public.thimar_require_session(p_token);
  select * into v_row from public.thimar_accounts where id = v_me;
  if v_row.id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if v_row.banned then raise exception 'ACCOUNT_BANNED' using errcode = '42501'; end if;
  v_admin := v_row.type = 'admin';

  -- ---------- الجلسة والحساب ----------
  if v_op = 'logout' then
    return jsonb_build_object('ok', public.thimar_session_revoke(p_token, 'logout'));
  elsif v_op = 'me' then
    return jsonb_build_object('account', public.thimar_account_json(v_row));
  elsif v_op = 'password.change' then
    declare v_new text := v_data->>'newPassword';
    begin
      if length(coalesce(v_new, '')) < 8 then
        raise exception 'WEAK_PASSWORD' using errcode = '22023';
      end if;
      if not public.thimar_rate_hit('pwchange:' || v_me, 5) then
        raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
      end if;
      if not public.thimar_pw_verify(v_data->>'oldPassword', v_row.password_hash, v_row.password_salt, v_row.password_algo) then
        perform public.thimar_rate_fail('pwchange:' || v_me);
        raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
      end if;
      update public.thimar_accounts
         set password_hash = public.thimar_pw_hash(v_new), password_salt = null, password_algo = 'bcrypt'
       where id = v_me;
      update public.thimar_api_sessions
         set revoked_at = now(), revoked_reason = 'password_change'
       where account_id = v_me and revoked_at is null
         and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
      update public.thimar_device_authorizations set revoked_at = now()
       where account_id = v_me and revoked_at is null;
      return jsonb_build_object('ok', true);
    end;

  -- ---------- الجلسات والأجهزة ----------
  elsif v_op = 'sessions.list' then
    return jsonb_build_object('sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'deviceId', s.device_id, 'platform', s.platform,
        'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at,
        'expiresAt', s.expires_at,
        'current', s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'))
        order by s.created_at desc)
      from public.thimar_api_sessions s
      where s.account_id = v_me and s.revoked_at is null and s.expires_at > now()), '[]'::jsonb));
  elsif v_op = 'sessions.revoke' then
    update public.thimar_api_sessions
       set revoked_at = now(), revoked_reason = 'user_revoked'
     where account_id = v_me
       and id = nullif(v_data->>'sessionId', '')::uuid
       and revoked_at is null
       and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
    return jsonb_build_object('ok', true);
  elsif v_op = 'sessions.revokeAll' then
    update public.thimar_api_sessions
       set revoked_at = now(), revoked_reason = 'user_revoked_all'
     where account_id = v_me and revoked_at is null
       and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
    return jsonb_build_object('ok', true);
  elsif v_op = 'devices.list' then
    return jsonb_build_object('devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deviceId', d.device_id, 'issuedAt', d.issued_at,
        'expiresAt', d.expires_at, 'lastUsedAt', d.last_used_at)
        order by d.issued_at desc)
      from public.thimar_device_authorizations d
      where d.account_id = v_me and d.revoked_at is null and d.expires_at > now()), '[]'::jsonb));
  elsif v_op = 'devices.revoke' then
    update public.thimar_device_authorizations set revoked_at = now()
     where account_id = v_me and device_id = v_data->>'deviceId' and revoked_at is null;
    update public.thimar_fcm_tokens set account_id = ''
     where account_id = v_me and device_id = v_data->>'deviceId';
    return jsonb_build_object('ok', true);

  -- ---------- السحب ----------
  elsif v_op = 'pull' then
    return (
      with my_conversations as (
        select c.* from public.thimar_conversations c
         where c.member_ids @> jsonb_build_array(v_me)
      ),
      my_links as (
        select l.* from public.thimar_link_requests l
         where l.payload->>'teacherId' = v_me
            or l.payload->>'studentId' = v_me
            or l.payload->>'guardianId' = v_me
            or v_admin
      ),
      peer_ids as (
        select distinct value as id
          from my_conversations c, jsonb_array_elements_text(c.member_ids) value
        union select l.payload->>'teacherId' from my_links l
        union select l.payload->>'studentId' from my_links l
        union select l.payload->>'guardianId' from my_links l
      )
      select jsonb_build_object(
        'serverTime', v_now,
        'account', public.thimar_account_json(v_row),
        'accounts', coalesce((
          select jsonb_agg(public.thimar_account_json(a) order by a.created_at desc)
          from public.thimar_accounts a
          where v_admin or a.id = v_me or a.id in (select id from peer_ids where id is not null)), '[]'::jsonb),
        'directory', coalesce((
          select jsonb_agg(public.thimar_directory_json(a) order by a.full_name)
          from public.thimar_accounts a
          where a.type = 'teacher' and a.status = 'active' and not a.banned), '[]'::jsonb),
        'adminIds', coalesce((
          select jsonb_agg(a.id) from public.thimar_accounts a
           where a.type = 'admin' and a.status = 'active' and not a.banned), '[]'::jsonb),
        'notifications', coalesce((
          select jsonb_agg(to_jsonb(n) order by n.created_at asc)
          from (select * from public.thimar_notifications
                 where recipient_id = v_me order by created_at desc limit 400) n), '[]'::jsonb),
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'kind', l.kind, 'status', l.status,
            'created_at', l.created_at, 'payload', l.payload) order by l.created_at desc)
          from my_links l), '[]'::jsonb),
        'conversations', coalesce((
          select jsonb_agg(to_jsonb(c) order by c.created_at desc)
          from (select * from my_conversations order by created_at desc limit 500) c), '[]'::jsonb),
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id,
            'kind', m.kind, 'text', m.text, 'duration', m.duration, 'file_name', m.file_name,
            'created_at', m.created_at, 'read_by', m.read_by, 'media_url', m.media_url)
            order by m.created_at asc)
          from (select * from public.thimar_chat_messages
                 where conversation_id in (select id from my_conversations)
                 order by created_at desc limit 5000) m), '[]'::jsonb),
        'homework', coalesce((
          select jsonb_agg(h.data order by h.created_at desc)
          from public.thimar_homework h
          where v_admin or h.student_id = v_me or h.teacher_id = v_me), '[]'::jsonb),
        'submissions', coalesce((
          select jsonb_agg(s.data order by s.created_at asc)
          from public.thimar_homework_submissions s
          where v_admin or s.student_id = v_me or s.teacher_id = v_me), '[]'::jsonb),
        'resetRequests', case when v_admin then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', r.id, 'accountId', r.account_id, 'username', r.username,
            'contact', r.contact, 'createdAt', r.created_at) order by r.created_at desc)
          from (select * from public.thimar_password_resets
                 where status = 'pending' order by created_at desc limit 100) r), '[]'::jsonb)
          else '[]'::jsonb end,
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'deviceId', s.device_id, 'platform', s.platform,
            'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at,
            'current', s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')))
          from public.thimar_api_sessions s
          where s.account_id = v_me and s.revoked_at is null and s.expires_at > now()), '[]'::jsonb),
        'deletions', coalesce((
          select jsonb_agg(to_jsonb(d))
          from public.thimar_deletions d
          where (d.entity = 'account' and d.id = v_me)
             or (d.entity in ('notification', 'message', 'conversation'))
        ), '[]'::jsonb)));

  -- ---------- الحساب ----------
  elsif v_op = 'account.update' then
    update public.thimar_accounts
       set full_name = coalesce(nullif(v_data->>'fullName', ''), full_name),
           phone = coalesce(nullif(v_data->>'phone', ''), phone),
           email = coalesce(nullif(v_data->>'email', ''), email),
           country_code = coalesce(nullif(v_data->>'countryCode', ''), country_code),
           student = coalesce(v_data->'student', student),
           teacher = coalesce(v_data->'teacher', teacher),
           guardian = coalesce(v_data->'guardian', guardian)
     where id = v_me
     returning * into v_row;
    return jsonb_build_object('account', public.thimar_account_json(v_row));

  elsif v_op = 'account.delete' then
    v_target := coalesce(nullif(v_data->>'accountId', ''), v_me);
    if v_target <> v_me and not v_admin then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    delete from public.thimar_deletions where entity = 'account' and id = v_target;
    insert into public.thimar_deletions (entity, id, deleted_at) values ('account', v_target, v_now);
    delete from public.thimar_chat_messages
     where conversation_id in (select id from public.thimar_conversations where created_by = v_target);
    delete from public.thimar_conversations where created_by = v_target;
    delete from public.thimar_chat_messages where sender_id = v_target;
    delete from public.thimar_notifications where recipient_id = v_target;
    delete from public.thimar_link_requests
     where payload->>'teacherId' = v_target or payload->>'studentId' = v_target
        or payload->>'guardianId' = v_target;
    delete from public.thimar_homework_submissions
     where student_id = v_target or teacher_id = v_target;
    delete from public.thimar_homework
     where student_id = v_target or teacher_id = v_target;
    delete from public.thimar_media where uploader_id = v_target;
    delete from public.thimar_api_sessions where account_id = v_target;
    delete from public.thimar_device_authorizations where account_id = v_target;
    delete from public.thimar_fcm_tokens where account_id = v_target;
    delete from public.thimar_push_subscriptions where account_id = v_target;
    delete from public.thimar_memorization_plans where account_id = v_target;
    delete from public.thimar_tasmee_sessions where account_id = v_target;
    delete from public.thimar_password_resets where account_id = v_target;
    delete from public.thimar_accounts where id = v_target;
    return jsonb_build_object('ok', true);

  -- ---------- الإشعارات ----------
  elsif v_op = 'notifications.push' then
    insert into public.thimar_notifications as n
      (id, recipient_id, kind, title, body, target, action, read, created_at)
    select x.id, x.recipient_id, coalesce(x.kind, 'system'), coalesce(x.title, ''),
           coalesce(x.body, ''), x.target, x.action, coalesce(x.read, false),
           coalesce(x.created_at, v_now)
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        id text, recipient_id text, kind text, title text, body text,
        target text, action text, read boolean, created_at bigint)
     where x.id is not null and x.recipient_id is not null
       and (
         x.recipient_id = v_me
         or v_admin
         or exists (select 1 from public.thimar_conversations c
                     where c.member_ids @> jsonb_build_array(v_me)
                       and c.member_ids @> jsonb_build_array(x.recipient_id))
         or exists (select 1 from public.thimar_link_requests l
                     where ((l.payload->>'teacherId' = v_me and l.payload->>'studentId' = x.recipient_id)
                         or (l.payload->>'guardianId' = v_me and l.payload->>'studentId' = x.recipient_id)
                         or (l.payload->>'studentId' = v_me and l.payload->>'teacherId' = x.recipient_id)
                         or (l.payload->>'studentId' = v_me and l.payload->>'guardianId' = x.recipient_id)))
         or (v_row.type = 'teacher' and x.kind = 'teacher'
             and exists (select 1 from public.thimar_accounts a
                          where a.id = x.recipient_id and a.type = 'admin' and a.status = 'active'))
       )
    on conflict (id) do update
      set title = excluded.title, body = excluded.body, kind = excluded.kind,
          read = excluded.read, target = excluded.target, action = excluded.action
      where n.recipient_id = v_me;
    return jsonb_build_object('ok', true);

  elsif v_op = 'notifications.delete' then
    delete from public.thimar_notifications
     where id = any (array(select jsonb_array_elements_text(coalesce(v_data->'ids', '[]'::jsonb))))
       and recipient_id = v_me;
    return jsonb_build_object('ok', true);

  -- ---------- طلبات الربط ----------
  elsif v_op = 'links.push' then
    insert into public.thimar_link_requests as l (id, kind, status, created_at, payload)
    select x.id, x.kind, coalesce(x.status, 'pending'), coalesce(x.created_at, 0), x.payload
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        id text, kind text, status text, created_at bigint, payload jsonb)
     where x.id is not null
       and x.kind in ('teacher', 'guardian')
       and (
         x.payload->>'teacherId' = v_me or x.payload->>'studentId' = v_me
         or x.payload->>'guardianId' = v_me or v_admin)
    on conflict (id) do update
      set status = excluded.status, payload = excluded.payload
      where (l.payload->>'teacherId' = v_me
          or l.payload->>'studentId' = v_me
          or l.payload->>'guardianId' = v_me
          or v_admin);
    return jsonb_build_object('ok', true);

  -- ---------- المحادثات والرسائل ----------
  elsif v_op = 'chat.push' then
    insert into public.thimar_conversations as c
      (id, title, is_group, member_ids, admins, created_by, created_at, updated_at)
    select x.id, coalesce(x.title, ''), coalesce(x.is_group, false),
           coalesce(x.member_ids, '[]'::jsonb), coalesce(x.admins, '[]'::jsonb),
           coalesce(x.created_by, v_me), coalesce(x.created_at, 0),
           coalesce(x.updated_at, v_now)
      from jsonb_to_recordset(coalesce(v_data->'conversations', '[]'::jsonb)) as x(
        id text, title text, is_group boolean, member_ids jsonb, admins jsonb,
        created_by text, created_at bigint, updated_at bigint)
     where x.id is not null
       and coalesce(x.member_ids, '[]'::jsonb) @> jsonb_build_array(v_me)
    on conflict (id) do update
      set title = excluded.title,
          member_ids = excluded.member_ids,
          admins = excluded.admins,
          updated_at = excluded.updated_at
      where c.member_ids @> jsonb_build_array(v_me)
        and excluded.member_ids @> jsonb_build_array(v_me);

    insert into public.thimar_chat_messages as m
      (id, conversation_id, sender_id, kind, text, duration, file_name, created_at, read_by, media_url)
    select x.id, x.conversation_id, v_me, coalesce(x.kind, 'text'), x.text, x.duration,
           x.file_name, coalesce(x.created_at, 0), coalesce(x.read_by, '[]'::jsonb), x.media_url
      from jsonb_to_recordset(coalesce(v_data->'messages', '[]'::jsonb)) as x(
        id text, conversation_id text, kind text, text text, duration integer,
        file_name text, created_at bigint, read_by jsonb, media_url text)
     where x.id is not null
       and exists (select 1 from public.thimar_conversations c
                    where c.id = x.conversation_id
                      and c.member_ids @> jsonb_build_array(v_me))
    on conflict (id) do update
      set text = excluded.text, read_by = excluded.read_by,
          media_url = coalesce(excluded.media_url, m.media_url), duration = excluded.duration
      where m.sender_id = v_me;
    return jsonb_build_object('ok', true);

  elsif v_op = 'chat.deleteMessages' then
    delete from public.thimar_chat_messages m
     where m.id = any (array(select jsonb_array_elements_text(coalesce(v_data->'ids', '[]'::jsonb))))
       and (m.sender_id = v_me or v_admin
            or exists (select 1 from public.thimar_conversations c
                        where c.id = m.conversation_id
                          and c.member_ids @> jsonb_build_array(v_me)
                          and (c.admins @> jsonb_build_array(v_me) or c.created_by = v_me)));
    return jsonb_build_object('ok', true);

  elsif v_op = 'chat.deleteConversation' then
    v_conv := v_data->>'conversationId';
    delete from public.thimar_chat_messages
     where conversation_id = v_conv
       and exists (select 1 from public.thimar_conversations c
                    where c.id = v_conv and c.member_ids @> jsonb_build_array(v_me)
                      and (c.created_by = v_me or c.admins @> jsonb_build_array(v_me) or v_admin));
    delete from public.thimar_conversations c
     where c.id = v_conv and c.member_ids @> jsonb_build_array(v_me)
       and (c.created_by = v_me or c.admins @> jsonb_build_array(v_me) or v_admin);
    return jsonb_build_object('ok', true);

  -- ---------- الوسائط (بدل الحاوية العامة) ----------
  elsif v_op = 'media.put' then
    v_conv := v_data->>'conversationId';
    if coalesce(v_conv, '') = '' then
      v_conv := 'homework:' || coalesce(v_data->>'homeworkId', '');
      if not (v_admin or exists (select 1 from public.thimar_homework h
                                  where h.id = v_data->>'homeworkId'
                                    and (h.student_id = v_me or h.teacher_id = v_me))) then
        raise exception 'FORBIDDEN' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.thimar_conversations c
                       where c.id = v_conv and c.member_ids @> jsonb_build_array(v_me)) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if coalesce(v_data->>'data', '') = '' then
      raise exception 'EMPTY_MEDIA' using errcode = '22023';
    end if;
    if length(v_data->>'data') > 11 * 1024 * 1024 then
      raise exception 'MEDIA_TOO_LARGE' using errcode = '22023';
    end if;
    insert into public.thimar_media
      (conversation_id, uploader_id, file_name, mime, size_bytes, sha256, bytes)
    values (v_conv, v_me, v_data->>'fileName', coalesce(v_data->>'mime', 'application/octet-stream'),
            length(decode(v_data->>'data', 'base64')), 'pending', decode(v_data->>'data', 'base64'))
    returning * into v_media;
    update public.thimar_media
       set sha256 = encode(extensions.digest(bytes, 'sha256'), 'hex')
     where id = v_media.id
     returning * into v_media;
    return jsonb_build_object('mediaId', v_media.id, 'ref', 'thimar-media:' || v_media.id);

  elsif v_op = 'media.get' then
    select * into v_media from public.thimar_media
     where id = nullif(replace(coalesce(v_data->>'ref', v_data->>'mediaId', ''), 'thimar-media:', ''), '')::uuid;
    if v_media.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_media.conversation_id like 'homework:%' then
      if not (v_admin or exists (select 1 from public.thimar_homework h
                                  where h.id = substring(v_media.conversation_id from 10)
                                    and (h.student_id = v_me or h.teacher_id = v_me))) then
        raise exception 'FORBIDDEN' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.thimar_conversations c
                       where c.id = v_media.conversation_id and c.member_ids @> jsonb_build_array(v_me)) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'ref', 'thimar-media:' || v_media.id, 'fileName', v_media.file_name, 'mime', v_media.mime,
      'size', v_media.size_bytes, 'sha256', v_media.sha256,
      'data', encode(v_media.bytes, 'base64'));

  -- ---------- الواجبات والتسليمات ----------
  elsif v_op = 'homework.push' then
    insert into public.thimar_homework as h (id, teacher_id, student_id, data, created_at, due_at, updated_at)
    select x.id,
           coalesce(nullif(x.data->>'teacherId', ''), v_me),
           x.data->>'studentId',
           x.data,
           coalesce((x.data->>'createdAt')::bigint, v_now),
           coalesce((x.data->>'dueAt')::bigint, 0),
           v_now
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(id text, data jsonb)
     where x.id is not null
       and nullif(x.data->>'studentId', '') is not null
       and (coalesce(nullif(x.data->>'teacherId', ''), v_me) = v_me or v_admin)
       and (
         v_admin
         or public.thimar_linked(v_me, x.data->>'studentId')
         or exists (select 1 from public.thimar_accounts a
                     where a.id = x.data->>'studentId'
                       and (a.student->>'teacherId' = v_me or a.student->>'teacherAccountId' = v_me))
       )
    on conflict (id) do update
      set data = excluded.data, due_at = excluded.due_at, updated_at = excluded.updated_at
      where h.teacher_id = v_me or v_admin;
    return jsonb_build_object('ok', true);

  elsif v_op = 'homework.delete' then
    delete from public.thimar_homework h
     where h.id = v_data->>'homeworkId' and (h.teacher_id = v_me or v_admin);
    delete from public.thimar_homework_submissions
     where homework_id = v_data->>'homeworkId' and (teacher_id = v_me or v_admin);
    return jsonb_build_object('ok', true);

  elsif v_op = 'homework.submit' then
    insert into public.thimar_homework_submissions as s
      (id, homework_id, student_id, teacher_id, data, score, feedback, graded_at, created_at, updated_at)
    select x.id,
           x.data->>'homeworkId',
           coalesce(nullif(x.data->>'studentId', ''), v_me),
           coalesce(nullif(x.data->>'teacherId', ''), h.teacher_id),
           x.data,
           nullif(x.data->>'score', '')::int,
           x.data->>'feedback',
           nullif(x.data->>'reviewedAt', '')::bigint,
           coalesce((x.data->>'createdAt')::bigint, v_now),
           v_now
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(id text, data jsonb)
      join public.thimar_homework h on h.id = x.data->>'homeworkId'
     where x.id is not null
       and (v_admin or coalesce(nullif(x.data->>'studentId', ''), v_me) = v_me)
       and (v_admin or h.student_id = v_me or h.teacher_id = v_me)
    on conflict (id) do update
      set data = excluded.data, updated_at = excluded.updated_at
      where (s.student_id = v_me and s.graded_at is null) or v_admin;
    return jsonb_build_object('ok', true);

  elsif v_op = 'homework.grade' then
    update public.thimar_homework_submissions s
       set score = least(5, greatest(0, coalesce((v_data->>'score')::int, 0))),
           feedback = left(coalesce(v_data->>'feedback', ''), 2000),
           graded_at = v_now,
           updated_at = v_now,
           data = s.data || jsonb_build_object(
             'score', least(5, greatest(0, coalesce((v_data->>'score')::int, 0))),
             'feedback', left(coalesce(v_data->>'feedback', ''), 2000),
             'reviewedAt', v_now)
     where s.id = v_data->>'submissionId'
       and (s.teacher_id = v_me or v_admin);
    return jsonb_build_object('ok', true);

  -- ---------- إشعار المسؤولين (طلب اعتماد معلّم) ----------
  elsif v_op = 'notify.admins' then
    if v_row.type not in ('teacher', 'guardian', 'student') then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if not public.thimar_rate_hit('notifyadmins:' || v_me, 5, interval '1 hour') then
      raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
    end if;
    perform public.thimar_rate_fail('notifyadmins:' || v_me);
    insert into public.thimar_notifications (id, recipient_id, kind, title, body, target, action, read, created_at)
    select 'ntf-adm-' || substr(md5(a.id || v_me || coalesce(v_data->>'title', '')), 1, 20),
           a.id, coalesce(v_data->>'kind', 'system'),
           left(coalesce(v_data->>'title', ''), 160), left(coalesce(v_data->>'body', ''), 1000),
           v_data->>'target', null, false, v_now
      from public.thimar_accounts a
     where a.type = 'admin' and a.status = 'active' and not a.banned
    on conflict (id) do update set body = excluded.body, title = excluded.title;
    return jsonb_build_object('adminIds', coalesce((
      select jsonb_agg(a.id) from public.thimar_accounts a
       where a.type = 'admin' and a.status = 'active' and not a.banned), '[]'::jsonb));

  -- ---------- المسؤول ----------
  elsif v_op like 'admin.%' then
    if not v_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if v_op = 'admin.accounts' then
      return jsonb_build_object('accounts', coalesce((
        select jsonb_agg(public.thimar_account_json(a) order by a.created_at desc)
        from public.thimar_accounts a), '[]'::jsonb));
    elsif v_op = 'admin.account.update' then
      update public.thimar_accounts
         set status = coalesce(nullif(v_data->>'status', ''), status),
             banned = coalesce((v_data->>'banned')::boolean, banned),
             type = coalesce(nullif(v_data->>'type', ''), type),
             rejection_reason = coalesce(v_data->>'rejectionReason', rejection_reason)
       where id = v_data->>'accountId' and id <> v_me
       returning * into v_row;
      if v_row.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      if v_row.banned or v_row.status <> 'active' then
        update public.thimar_api_sessions set revoked_at = now(), revoked_reason = 'admin_status'
         where account_id = v_row.id and revoked_at is null;
      end if;
      return jsonb_build_object('account', public.thimar_account_json(v_row));
    elsif v_op = 'admin.reset.issue' then
      v_target := v_data->>'accountId';
      if coalesce(v_target, '') = '' or v_target = v_me then
        raise exception 'INVALID_TARGET' using errcode = '22023';
      end if;
      v_temp := 'Th-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 9);
      update public.thimar_accounts
         set password_hash = public.thimar_pw_hash(v_temp), password_salt = null, password_algo = 'bcrypt'
       where id = v_target
       returning * into v_row;
      if v_row.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      update public.thimar_api_sessions set revoked_at = now(), revoked_reason = 'admin_reset'
       where account_id = v_target and revoked_at is null;
      update public.thimar_device_authorizations set revoked_at = now()
       where account_id = v_target and revoked_at is null;
      update public.thimar_password_resets
         set status = 'resolved', resolved_at = now(), resolved_by = v_me
       where account_id = v_target and status = 'pending';
      -- تُعرض كلمة المرور المؤقتة للمسؤول مرة واحدة فقط لتسليمها للمستخدم.
      return jsonb_build_object('username', v_row.username, 'temporaryPassword', v_temp);
    elsif v_op = 'admin.reset.requests' then
      return jsonb_build_object('requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'accountId', r.account_id, 'username', r.username,
          'contact', r.contact, 'createdAt', r.created_at) order by r.created_at desc)
        from public.thimar_password_resets r where r.status = 'pending'), '[]'::jsonb));
    end if;
  end if;

  raise exception 'UNKNOWN_OP' using errcode = '22023';
end;
$$;

-- ---------- 11) الأذونات: لا وصول مباشر للجداول، والواجهة وحدها تُنفَّذ ----------
revoke all on function public.thimar_session_issue(text, text, text, interval) from public;
revoke all on function public.thimar_require_session(text) from public;
revoke all on function public.thimar_session_revoke(text, text) from public;
revoke all on function public.thimar_pw_hash(text) from public;
revoke all on function public.thimar_pw_verify(text, text, text, text) from public;
revoke all on function public.thimar_api_login(text, text, text, text) from public;
revoke all on function public.thimar_api_register(jsonb, text) from public;
revoke all on function public.thimar_password_reset_request(text, text) from public;
revoke all on function public.thimar_password_reset_device(text, text, text, text) from public;
revoke all on function public.thimar_account_json(public.thimar_accounts) from public;
revoke all on function public.thimar_public_account_json(public.thimar_accounts) from public;
revoke all on function public.thimar_directory_json(public.thimar_accounts) from public;
revoke all on function public.thimar_rate_hit(text, int, interval) from public;
revoke all on function public.thimar_rate_fail(text) from public;

revoke all on function public.thimar_api(text, text, jsonb) from public;
grant execute on function public.thimar_api(text, text, jsonb) to anon, authenticated;
revoke all on function public.thimar_authorize_device(text, text, text) from public;
grant execute on function public.thimar_authorize_device(text, text, text) to anon, authenticated;

