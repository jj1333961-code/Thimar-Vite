-- Thimar Android release pipeline + secure device-token binding.
-- Idempotent: safe to re-run. Do not run against production without staging validation.

create extension if not exists pgcrypto;

-- This migration intentionally uses only the columns already present in the Thimar
-- account schema: password_hash and password_salt. It does not add alternate
-- password columns or a second authentication policy.

-- Remove the legacy five-parameter bind overload. The six-parameter function has
-- defaults for the trailing arguments, so old clients still resolve correctly.
drop function if exists public.thimar_bind_fcm_token(text, text, text, text, text);

-- =====================================================================
-- Base release-pipeline objects (preserved)
-- =====================================================================

-- 1) Store the installed versionCode on each device token.
alter table public.thimar_fcm_tokens
  add column if not exists app_version_code integer;

-- Legacy bind RPC, retained during the backward-compatible rollout.
create or replace function public.thimar_bind_fcm_token(
  p_token            text,
  p_account_id       text,
  p_device_id        text,
  p_platform         text default 'android',
  p_app_version      text default null,
  p_app_version_code integer default null
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_token text := nullif(btrim(p_token), '');
begin
  if not exists (
        select 1 from public.thimar_runtime_flags
         where key = 'allow_legacy_fcm_binding' and value is true
      ) then
    raise exception 'LEGACY_FCM_BINDING_DISABLED';
  end if;

  if v_token is null
     or nullif(btrim(p_account_id), '') is null
     or nullif(btrim(p_device_id), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not exists (select 1 from public.thimar_accounts where id = p_account_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  delete from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id <> p_account_id;

  insert into public.thimar_fcm_tokens (token, account_id, device_id, platform, app_version, app_version_code)
  values (
    v_token,
    p_account_id,
    btrim(p_device_id),
    coalesce(nullif(btrim(p_platform), ''), 'android'),
    p_app_version,
    p_app_version_code
  )
  on conflict (token) do update
     set account_id       = excluded.account_id,
         device_id        = excluded.device_id,
         platform         = excluded.platform,
         app_version      = excluded.app_version,
         app_version_code = coalesce(excluded.app_version_code, thimar_fcm_tokens.app_version_code),
         updated_at       = now();
end;
$$;

-- Legacy revoke RPC, retained during the backward-compatible rollout.
create or replace function public.thimar_revoke_fcm_token(
  p_device_id  text,
  p_account_id text default null
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_removed integer := 0;
begin
  if not exists (
        select 1 from public.thimar_runtime_flags
         where key = 'allow_legacy_fcm_binding' and value is true
      ) then
    raise exception 'LEGACY_FCM_BINDING_DISABLED';
  end if;

  if nullif(btrim(coalesce(p_device_id, '')), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if nullif(btrim(coalesce(p_account_id, '')), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  delete from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id = btrim(p_account_id);

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.thimar_bind_fcm_token(text, text, text, text, text, integer) from public;
revoke all on function public.thimar_revoke_fcm_token(text, text) from public;
revoke execute on function public.thimar_bind_fcm_token(text, text, text, text, text, integer) from anon, authenticated;
revoke execute on function public.thimar_revoke_fcm_token(text, text) from anon, authenticated;

-- 3) Campaign audit columns (idempotent by version_code).
alter table public.thimar_update_notifications
  add column if not exists campaign_id text,
  add column if not exists attempted_count integer not null default 0,
  add column if not exists accepted_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists audit jsonb,
  add column if not exists error text;

do $$
begin
  if exists (
    select 1
      from public.thimar_update_notifications
     where campaign_id is not null
     group by campaign_id
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_CAMPAIGN_ID: resolve duplicate campaign_id values before applying this migration';
  end if;
end
$$;

create unique index if not exists thimar_update_notifications_campaign_uidx
  on public.thimar_update_notifications (campaign_id)
  where campaign_id is not null;

-- 4) Audit log table.
create table if not exists public.thimar_notification_audit (
  id            bigserial primary key,
  campaign_id   text not null,
  version_code  integer not null,
  version_name  text,
  event         text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

alter table public.thimar_notification_audit enable row level security;
revoke all on public.thimar_notification_audit from public, anon, authenticated;
grant all on public.thimar_notification_audit to service_role;
grant usage on schema public to service_role;

-- =====================================================================
-- Runtime flags (controlled legacy-RPC cutover)
-- =====================================================================

create table if not exists public.thimar_runtime_flags (
  key        text primary key,
  value      boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.thimar_runtime_flags (key, value)
values ('allow_legacy_fcm_binding', false)
on conflict (key) do update
  set value = false,
      updated_at = now();

alter table public.thimar_runtime_flags enable row level security;
revoke all on public.thimar_runtime_flags from public, anon, authenticated;
grant select on public.thimar_runtime_flags to anon, authenticated;
grant all on public.thimar_runtime_flags to service_role;

-- =====================================================================
-- Rate limiting for password-based device authorization
-- =====================================================================

create table if not exists public.thimar_auth_rate_limits (
  key          text not null,
  window_start timestamptz not null,
  failures     integer not null default 0,
  primary key (key, window_start)
);

alter table public.thimar_auth_rate_limits enable row level security;
revoke all on public.thimar_auth_rate_limits from public, anon, authenticated;
grant all on public.thimar_auth_rate_limits to service_role;

create or replace function public.thimar_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
  exception when others then
    raw := null;
  end;
  if raw is null or raw = '' then
    return 'unknown';
  end if;
  return left(split_part(raw, ',', 1), 60);
end;
$$;

revoke all on function public.thimar_client_ip() from public, anon, authenticated;

create or replace function public.thimar_note_auth_attempt(p_key text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / 900.0) * 900);
  v_failures integer;
begin
  delete from public.thimar_auth_rate_limits
   where window_start < now() - interval '1 day';

  if p_ok then
    delete from public.thimar_auth_rate_limits where key = p_key;
    return;
  end if;

  insert into public.thimar_auth_rate_limits (key, window_start, failures)
  values (p_key, v_bucket, 1)
  on conflict (key, window_start) do update
    set failures = public.thimar_auth_rate_limits.failures + 1
  returning failures into v_failures;
end;
$$;

revoke all on function public.thimar_note_auth_attempt(text, boolean) from public, anon, authenticated;

-- =====================================================================
-- Secure device authorization
-- =====================================================================

create table if not exists public.thimar_device_authorizations (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  device_id   text not null,
  secret_hash text not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  unique (account_id, device_id)
);

create index if not exists thimar_device_authorizations_lookup_idx
  on public.thimar_device_authorizations (account_id, device_id, expires_at);

alter table public.thimar_device_authorizations enable row level security;
revoke all on public.thimar_device_authorizations from public, anon, authenticated;
grant all on public.thimar_device_authorizations to service_role;

-- Nonce semantics:
--   The nonce is generated by the client and is not a server-issued challenge.
--   It is a one-time replay-protection value for a request that already proves
--   possession of the mandatory device secret. The device secret remains required;
--   a nonce alone cannot bind or revoke a token. Consumed nonce hashes are retained
--   and rejected on reuse.
create table if not exists public.thimar_binding_nonces (
  nonce_hash   text primary key,
  account_id  text not null,
  device_id   text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists thimar_binding_nonces_expiry_idx
  on public.thimar_binding_nonces (expires_at);

alter table public.thimar_binding_nonces enable row level security;
revoke all on public.thimar_binding_nonces from public, anon, authenticated;
grant all on public.thimar_binding_nonces to service_role;

-- Issue a high-entropy device secret after verifying the account password.
create or replace function public.thimar_authorize_device(
  p_account_id text,
  p_password   text,
  p_device_id  text
) returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_account public.thimar_accounts;
  v_ok boolean := false;
  v_candidate text;
  v_secret text;
  v_ip text := public.thimar_client_ip();
  v_account_key text := 'device-auth:account:' || btrim(coalesce(p_account_id, ''));
  v_ip_key text := 'device-auth:ip:' || v_ip;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_id, '')), '') is null
     or coalesce(p_password, '') = ''
     or length(p_password) > 200 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Advisory locks serialize attempts, but they do not make a failed authentication
  -- durable. Durability is achieved below by returning NULL instead of raising an
  -- uncaught exception after thimar_note_auth_attempt has updated the counters.
  perform pg_advisory_xact_lock(hashtext(v_account_key));
  perform pg_advisory_xact_lock(hashtext(v_ip_key));
  perform pg_advisory_xact_lock(hashtext('thimar-fcm-device:' || btrim(p_device_id)));

  -- Rate limit before any credential check.
  if exists (
        select 1 from public.thimar_auth_rate_limits
         where key in (v_account_key, v_ip_key)
           and window_start > now() - interval '15 minutes'
           and failures >= case when key like 'device-auth:ip:%' then 30 else 8 end
      ) then
    raise exception 'RATE_LIMITED';
  end if;

  select * into v_account
    from public.thimar_accounts
   where id = btrim(p_account_id);

  -- Constant-cost-ish dummy work for unknown accounts.
  if v_account.id is null then
    perform encode(digest('thimar-dummy-salt:thimar-dummy-password', 'sha256'), 'hex');
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;

  -- Exact existing Thimar password verification: sha256(salt + ':' + password).
  if v_account.password_hash is not null
     and coalesce(v_account.password_salt, '') <> '' then
    v_candidate := encode(digest(v_account.password_salt || ':' || p_password, 'sha256'), 'hex');
    v_ok := v_candidate = v_account.password_hash;
  end if;

  if not v_ok then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;

  if v_account.banned is true then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;

  if v_account.status is distinct from 'active' then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return null;
  end if;

  perform public.thimar_note_auth_attempt(v_account_key, true);
  perform public.thimar_note_auth_attempt(v_ip_key, true);

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.thimar_device_authorizations (
    account_id, device_id, secret_hash, expires_at, revoked_at
  )
  values (
    btrim(p_account_id),
    btrim(p_device_id),
    crypt(v_secret, gen_salt('bf', 12)),
    now() + interval '90 days',
    null
  )
  on conflict (account_id, device_id) do update
    set secret_hash  = excluded.secret_hash,
        issued_at    = now(),
        expires_at   = excluded.expires_at,
        revoked_at   = null,
        last_used_at = null;

  return v_secret;
end;
$$;

-- Secure, non-replayable token binding.
create or replace function public.thimar_bind_fcm_token_secure(
  p_token            text,
  p_account_id       text,
  p_device_id        text,
  p_platform         text default 'android',
  p_app_version      text default null,
  p_app_version_code integer default null,
  p_device_secret    text default null,
  p_request_nonce    text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_token text := nullif(btrim(p_token), '');
  v_auth public.thimar_device_authorizations;
  v_nonce_hash text;
  v_inserted text;
begin
  if v_token is null
     or nullif(btrim(p_account_id), '') is null
     or nullif(btrim(p_device_id), '') is null
     or nullif(btrim(coalesce(p_device_secret, '')), '') is null
     or nullif(btrim(coalesce(p_request_nonce, '')), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Serialize all token and authorization operations for this account/device.
  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));
  perform pg_advisory_xact_lock(hashtext('thimar-fcm-device:' || btrim(p_device_id)));

  select * into v_auth
    from public.thimar_device_authorizations
   where account_id = btrim(p_account_id)
     and device_id = btrim(p_device_id)
     and revoked_at is null
     and expires_at > now()
   for update;

  if v_auth.id is null then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  if v_auth.secret_hash <> crypt(btrim(p_device_secret), v_auth.secret_hash) then
    raise exception 'INVALID_DEVICE_SECRET';
  end if;

  if length(btrim(p_request_nonce)) < 32 then
    raise exception 'INVALID_NONCE';
  end if;

  delete from public.thimar_binding_nonces
   where expires_at < now() - interval '24 hours';

  v_nonce_hash := encode(digest(btrim(p_request_nonce), 'sha256'), 'hex');

  insert into public.thimar_binding_nonces (nonce_hash, account_id, device_id, expires_at)
  values (v_nonce_hash, btrim(p_account_id), btrim(p_device_id), now() + interval '5 minutes')
  on conflict (nonce_hash) do nothing
  returning nonce_hash into v_inserted;

  if v_inserted is null then
    raise exception 'REPLAYED_NONCE';
  end if;

  -- Lock the existing token row, if any, before replacing it.
  perform 1
    from public.thimar_fcm_tokens
   where token = v_token
   for update;

  delete from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id <> btrim(p_account_id);

  insert into public.thimar_fcm_tokens (token, account_id, device_id, platform, app_version, app_version_code)
  values (
    v_token,
    btrim(p_account_id),
    btrim(p_device_id),
    coalesce(nullif(btrim(p_platform), ''), 'android'),
    p_app_version,
    p_app_version_code
  )
  on conflict (token) do update
     set account_id       = excluded.account_id,
         device_id        = excluded.device_id,
         platform         = excluded.platform,
         app_version      = excluded.app_version,
         app_version_code = coalesce(excluded.app_version_code, thimar_fcm_tokens.app_version_code),
         updated_at       = now();

  update public.thimar_device_authorizations
     set last_used_at = now()
   where id = v_auth.id;
end;
$$;

-- Secure, non-replayable token revocation. No anonymous device-only revocation.
create or replace function public.thimar_revoke_fcm_token_secure(
  p_device_id     text,
  p_account_id    text,
  p_device_secret text,
  p_request_nonce text
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_removed integer := 0;
  v_auth public.thimar_device_authorizations;
  v_nonce_hash text;
  v_inserted text;
begin
  if nullif(btrim(coalesce(p_device_id, '')), '') is null
     or nullif(btrim(coalesce(p_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_secret, '')), '') is null
     or nullif(btrim(coalesce(p_request_nonce, '')), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));
  perform pg_advisory_xact_lock(hashtext('thimar-fcm-device:' || btrim(p_device_id)));

  select * into v_auth
    from public.thimar_device_authorizations
   where account_id = btrim(p_account_id)
     and device_id = btrim(p_device_id)
     and revoked_at is null
     and expires_at > now()
   for update;

  if v_auth.id is null then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  if v_auth.secret_hash <> crypt(btrim(p_device_secret), v_auth.secret_hash) then
    raise exception 'INVALID_DEVICE_SECRET';
  end if;

  if length(btrim(p_request_nonce)) < 32 then
    raise exception 'INVALID_NONCE';
  end if;

  delete from public.thimar_binding_nonces
   where expires_at < now() - interval '24 hours';

  v_nonce_hash := encode(digest(btrim(p_request_nonce), 'sha256'), 'hex');

  insert into public.thimar_binding_nonces (nonce_hash, account_id, device_id, expires_at)
  values (v_nonce_hash, btrim(p_account_id), btrim(p_device_id), now() + interval '5 minutes')
  on conflict (nonce_hash) do nothing
  returning nonce_hash into v_inserted;

  if v_inserted is null then
    raise exception 'REPLAYED_NONCE';
  end if;

  perform 1
    from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id = btrim(p_account_id)
   for update;

  delete from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id = btrim(p_account_id);

  get diagnostics v_removed = row_count;

  update public.thimar_device_authorizations
     set last_used_at = now()
   where id = v_auth.id;

  return v_removed;
end;
$$;

revoke all on function public.thimar_authorize_device(text, text, text) from public;
revoke all on function public.thimar_bind_fcm_token_secure(text, text, text, text, text, integer, text, text) from public;
revoke all on function public.thimar_revoke_fcm_token_secure(text, text, text, text) from public;

grant execute on function public.thimar_authorize_device(text, text, text) to anon, authenticated;
grant execute on function public.thimar_bind_fcm_token_secure(text, text, text, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.thimar_revoke_fcm_token_secure(text, text, text, text) to anon, authenticated;

-- Explicit service-role privileges for the notification pipeline.
revoke all on public.thimar_fcm_tokens from public, anon, authenticated;
revoke all on public.thimar_update_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.thimar_fcm_tokens to service_role;
grant select, insert, update, delete on public.thimar_update_notifications to service_role;
grant select, insert on public.thimar_notification_audit to service_role;
grant select, insert, update, delete on public.thimar_device_authorizations to service_role;
grant select, insert, update, delete on public.thimar_binding_nonces to service_role;
```
-- Revoke all device authorizations for an account after verifying its password.
-- Failed verification attempts are recorded durably by returning -1 instead of
-- raising an uncaught exception.
create or replace function public.thimar_revoke_device_authorizations(
  p_account_id text,
  p_password   text
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_account public.thimar_accounts;
  v_ok boolean := false;
  v_candidate text;
  v_removed integer := 0;
  v_ip text := public.thimar_client_ip();
  v_account_key text := 'device-revoke:account:' || btrim(coalesce(p_account_id, ''));
  v_ip_key text := 'device-revoke:ip:' || v_ip;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or coalesce(p_password, '') = ''
     or length(p_password) > 200
     or length(btrim(p_account_id)) > 128 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Lock the account before any credential check or rate-limit update.
  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));

  if exists (
        select 1 from public.thimar_auth_rate_limits
         where key in (v_account_key, v_ip_key)
           and window_start > now() - interval '15 minutes'
           and failures >= case when key like 'device-revoke:ip:%' then 30 else 8 end
      ) then
    raise exception 'RATE_LIMITED';
  end if;

  select * into v_account
    from public.thimar_accounts
   where id = btrim(p_account_id)
   for update;

  if v_account.id is null then
    perform encode(digest('thimar-dummy-salt:thimar-dummy-password', 'sha256'), 'hex');
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return -1;
  end if;

  if v_account.password_hash is not null
     and coalesce(v_account.password_salt, '') <> '' then
    v_candidate := encode(digest(v_account.password_salt || ':' || p_password, 'sha256'), 'hex');
    v_ok := v_candidate = v_account.password_hash;
  end if;

  if not v_ok or v_account.banned is true or v_account.status is distinct from 'active' then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return -1;
  end if;

  perform public.thimar_note_auth_attempt(v_account_key, true);
  perform public.thimar_note_auth_attempt(v_ip_key, true);

  perform 1
    from public.thimar_device_authorizations
   where account_id = btrim(p_account_id)
     and revoked_at is null
   for update;

  update public.thimar_device_authorizations
     set revoked_at = now()
   where account_id = btrim(p_account_id)
     and revoked_at is null;

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.thimar_revoke_device_authorizations(text, text) from public;
grant execute on function public.thimar_revoke_device_authorizations(text, text) to anon, authenticated;

-- Atomic password change: verify the current password, update the password, and
-- revoke every device authorization in one transaction. Failed verification is
-- recorded durably by returning false instead of raising an uncaught exception.
create or replace function public.thimar_change_password(
  p_account_id  text,
  p_old_password text,
  p_new_hash    text,
  p_new_salt    text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_account public.thimar_accounts;
  v_ok boolean := false;
  v_candidate text;
  v_ip text := public.thimar_client_ip();
  v_account_key text := 'password-change:account:' || btrim(coalesce(p_account_id, ''));
  v_ip_key text := 'password-change:ip:' || v_ip;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or coalesce(p_old_password, '') = ''
     or length(p_old_password) > 200
     or length(btrim(p_account_id)) > 128
     or length(coalesce(p_new_hash, '')) <> 64
     or length(coalesce(p_new_salt, '')) < 16
     or length(coalesce(p_new_salt, '')) > 128 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Lock the account before any credential check or rate-limit update.
  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));

  if exists (
        select 1 from public.thimar_auth_rate_limits
         where key in (v_account_key, v_ip_key)
           and window_start > now() - interval '15 minutes'
           and failures >= case when key like 'password-change:ip:%' then 30 else 8 end
      ) then
    raise exception 'RATE_LIMITED';
  end if;

  select * into v_account
    from public.thimar_accounts
   where id = btrim(p_account_id)
   for update;

  if v_account.id is null then
    perform encode(digest('thimar-dummy-salt:thimar-dummy-password', 'sha256'), 'hex');
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return false;
  end if;

  if v_account.password_hash is not null
     and coalesce(v_account.password_salt, '') <> '' then
    v_candidate := encode(digest(v_account.password_salt || ':' || p_old_password, 'sha256'), 'hex');
    v_ok := v_candidate = v_account.password_hash;
  end if;

  if not v_ok or v_account.banned is true or v_account.status is distinct from 'active' then
    perform public.thimar_note_auth_attempt(v_account_key, false);
    perform public.thimar_note_auth_attempt(v_ip_key, false);
    return false;
  end if;

  perform public.thimar_note_auth_attempt(v_account_key, true);
  perform public.thimar_note_auth_attempt(v_ip_key, true);

  update public.thimar_accounts
     set password_hash = p_new_hash,
         password_salt = p_new_salt
   where id = btrim(p_account_id);

  perform 1
    from public.thimar_device_authorizations
   where account_id = btrim(p_account_id)
     and revoked_at is null
   for update;

  update public.thimar_device_authorizations
     set revoked_at = now()
   where account_id = btrim(p_account_id)
     and revoked_at is null;

  return true;
end;
$$;

revoke all on function public.thimar_change_password(text, text, text, text) from public;
grant execute on function public.thimar_change_password(text, text, text, text) to anon, authenticated;

-- Minimum sequence access for the notification audit BIGSERIAL primary key.
grant usage, select on sequence public.thimar_notification_audit_id_seq to service_role;
