-- ============================================================================
-- ثمار — نواة الأمان (المرحلة T1)
-- 1) كلمات مرور bcrypt على الخادم + ترقية شفافة من sha256 القديمة
-- 2) جلسات قابلة للإبطال (رمز معتم يُخزَّن مُجزَّأً فقط)
-- 3) وسائط المحادثات داخل قاعدة البيانات (لا حاوية عامة)
-- 4) تسجيل/دخول/خروج/تغيير كلمة المرور — كلها على الخادم
--
-- لا تعتمد على أي دور عميل: كل الدوال SECURITY DEFINER بـ search_path مثبّت،
-- ولا تُعيد أبدًا password_hash أو password_salt أو secret_hash.
-- ============================================================================

-- ---------- 0) أعمدة ومساعدات ------------------------------------------------
alter table public.thimar_accounts
  add column if not exists password_algo text not null default 'sha256';

comment on column public.thimar_accounts.password_algo is
  'bcrypt = تجزئة حديثة | sha256 = الصيغة القديمة (تُرقّى عند أول دخول ناجح)';

create table if not exists public.thimar_sessions (
  id           uuid primary key default extensions.gen_random_uuid(),
  account_id   text not null references public.thimar_accounts(id) on delete cascade,
  token_hash   text not null unique,
  device_id    text,
  platform     text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_reason text
);
create index if not exists thimar_sessions_account_idx
  on public.thimar_sessions (account_id) where revoked_at is null;
create index if not exists thimar_sessions_live_idx
  on public.thimar_sessions (token_hash) where revoked_at is null;

create table if not exists public.thimar_media (
  id              uuid primary key default extensions.gen_random_uuid(),
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

-- ---------- 1) كلمات المرور ---------------------------------------------------
-- bcrypt عبر pgcrypto (cost 12). التجزئة القديمة: sha256(salt + ':' + password).
create or replace function public.thimar_pw_hash(p_password text)
returns text language sql volatile
set search_path = public, extensions, pg_temp
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf', 12));
$$;

-- بصمة وهمية ثابتة لتفادي كشف وجود اسم المستخدم عبر زمن الاستجابة.
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
  -- صيغة قديمة: sha256(salt + ':' + password)
  return encode(extensions.digest(coalesce(p_salt, '') || ':' || p_password, 'sha256'), 'hex') = v_hash;
end;
$$;

-- ---------- 2) الجلسات --------------------------------------------------------
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
  insert into public.thimar_sessions (account_id, token_hash, device_id, platform, expires_at)
  values (p_account_id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          p_device_id, p_platform, v_exp)
  returning id into v_id;

  -- حد أقصى 20 جلسة حيّة لكل حساب: نُبطل الأقدم.
  delete from public.thimar_sessions s
   where s.account_id = p_account_id
     and s.revoked_at is null
     and s.id not in (
       select id from public.thimar_sessions
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
    from public.thimar_sessions s
   where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and s.revoked_at is null
     and s.expires_at > now();
  if v_account is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  update public.thimar_sessions
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
  update public.thimar_sessions
     set revoked_at = now(), revoked_reason = p_reason
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---------- 3) عرض الحساب بلا أي سر ------------------------------------------
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

-- ---------- 4) تحديد المعدّل ---------------------------------------------------
create or replace function public.thimar_rate_hit(
  p_key text, p_limit int default 10, p_window interval default interval '15 minutes'
) returns boolean language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_window timestamptz := date_trunc('second', now()) - (extract(epoch from p_window)::int % 900) * interval '1 second';
        v_failures int;
begin
  insert into public.thimar_auth_rate_limits (key, window_start, failures)
  values (p_key, date_trunc('hour', now()) + ((extract(minute from now())::int / 15)::int * interval '15 minutes'), 0)
  on conflict (key, window_start) do nothing;

  select failures into v_failures from public.thimar_auth_rate_limits
   where key = p_key order by window_start desc limit 1;

  if coalesce(v_failures, 0) >= p_limit then
    return false;
  end if;
  return true;
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

-- ---------- 5) الدخول ---------------------------------------------------------
create or replace function public.thimar_api_login(
  p_username text, p_password text,
  p_device_id text default null, p_platform text default null
) returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.thimar_accounts;
  v_key text := 'login:' || lower(coalesce(p_username, ''));
  v_ok boolean;
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
    -- نفس كلفة التحقق حتى لا يُكشف وجود الاسم.
    perform public.thimar_pw_verify(coalesce(p_password, ''), public.thimar_pw_dummy_hash(), '', 'bcrypt');
    perform public.thimar_rate_fail(v_key);
    raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
  end if;

  v_ok := public.thimar_pw_verify(p_password, v_row.password_hash, v_row.password_salt, v_row.password_algo);
  if not v_ok then
    perform public.thimar_rate_fail(v_key);
    raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
  end if;

  if v_row.banned then
    raise exception 'ACCOUNT_BANNED' using errcode = '42501';
  end if;
  if v_row.status <> 'active' then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  -- ترقية شفافة: sha256 القديمة تُستبدل بـbcrypt، والملح القديم يُزال.
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

-- ---------- 6) التسجيل --------------------------------------------------------
create or replace function public.thimar_api_register(p_account jsonb, p_password text)
returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_id text := nullif(p_account->>'id', '');
  v_username text := lower(btrim(coalesce(p_account->>'username', '')));
  v_type text := coalesce(p_account->>'type', 'student');
  v_status text := coalesce(p_account->>'status', 'pending');
  v_row public.thimar_accounts;
  v_session jsonb;
begin
  if v_username = '' then raise exception 'MISSING_USERNAME' using errcode = '22023'; end if;
  if coalesce(p_password, '') = '' then raise exception 'MISSING_PASSWORD' using errcode = '22023'; end if;
  if v_type not in ('student', 'guardian', 'teacher') then
    raise exception 'INVALID_TYPE' using errcode = '22023';
  end if;
  if v_status not in ('pending', 'active') then v_status := 'pending'; end if;
  if v_id is null then v_id := 'acc-' || (extract(epoch from now()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 6); end if;

  if exists (select 1 from public.thimar_accounts where lower(username) = v_username) then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
  end if;

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

-- ---------- 7) تغيير كلمة المرور ----------------------------------------------
create or replace function public.thimar_api_change_password(
  p_token text, p_old text, p_new text
) returns jsonb language plpgsql volatile
set search_path = public, extensions, pg_temp
as $$
declare v_row public.thimar_accounts; v_me text;
begin
  v_me := public.thimar_require_session(p_token);
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  select * into v_row from public.thimar_accounts where id = v_me;
  if not public.thimar_pw_verify(p_old, v_row.password_hash, v_row.password_salt, v_row.password_algo) then
    perform public.thimar_rate_fail('pwchange:' || v_me);
    raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
  end if;

  update public.thimar_accounts
     set password_hash = public.thimar_pw_hash(p_new), password_salt = null, password_algo = 'bcrypt'
   where id = v_me;

  -- إبطال بقية الجلسات (يبقى الجهاز الحالي).
  update public.thimar_sessions
     set revoked_at = now(), revoked_reason = 'password_change'
   where account_id = v_me
     and revoked_at is null
     and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');

  return jsonb_build_object('ok', true);
end;
$$;
