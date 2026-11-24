-- Android offline Quran tasmee result sync.
-- Audio is never accepted or stored. Device authorization is reused from the secure
-- Thimar device authorization pipeline; no service-role key is exposed to clients.

create table if not exists public.thimar_tasmee_sessions (
  session_id uuid primary key,
  account_id text not null references public.thimar_accounts(id) on delete cascade,
  session_at bigint not null,
  page integer not null check (page between 1 and 604),
  surah integer not null check (surah between 1 and 114),
  from_ayah integer not null check (from_ayah > 0),
  to_ayah integer not null check (to_ayah >= from_ayah),
  accuracy integer not null check (accuracy between 0 and 100),
  correct integer not null check (correct >= 0),
  wrong integer not null check (wrong >= 0),
  total integer not null check (total >= 0),
  duration_sec integer not null check (duration_sec >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists thimar_tasmee_sessions_account_time_idx
  on public.thimar_tasmee_sessions (account_id, session_at desc);
alter table public.thimar_tasmee_sessions enable row level security;
revoke all on public.thimar_tasmee_sessions from public, anon, authenticated;
grant select, insert on public.thimar_tasmee_sessions to service_role;

create or replace function public.thimar_save_tasmee_session(
  p_account_id text, p_device_id text, p_device_secret text,
  p_request_nonce text, p_session_id uuid, p_session jsonb
) returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_auth public.thimar_device_authorizations;
  v_account public.thimar_accounts;
  v_nonce_hash text;
  v_inserted text;
  v_mistakes jsonb;
  v_safe_result jsonb;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_secret, '')), '') is null
     or nullif(btrim(coalesce(p_request_nonce, '')), '') is null
     or p_session_id is null or jsonb_typeof(p_session) <> 'object'
     or octet_length(p_session::text) > 24000 then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if length(btrim(p_request_nonce)) < 32 then raise exception 'INVALID_NONCE'; end if;
  if coalesce((p_session->>'at')::bigint, 0) <= 0
     or coalesce((p_session->>'page')::integer, 0) not between 1 and 604
     or coalesce((p_session->>'surah')::integer, 0) not between 1 and 114
     or coalesce((p_session->>'fromAyah')::integer, 0) <= 0
     or coalesce((p_session->>'toAyah')::integer, 0) < coalesce((p_session->>'fromAyah')::integer, 0)
     or coalesce((p_session->>'accuracy')::integer, -1) not between 0 and 100
     or coalesce((p_session->>'correct')::integer, -1) < 0
     or coalesce((p_session->>'wrong')::integer, -1) < 0
     or coalesce((p_session->>'total')::integer, -1) < 0
     or coalesce((p_session->>'durationSec')::integer, -1) < 0
     or coalesce(jsonb_typeof(p_session->'mistakes'), 'null') <> 'array'
     or jsonb_array_length(p_session->'mistakes') > 500 then
    raise exception 'INVALID_SESSION';
  end if;

  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));
  perform pg_advisory_xact_lock(hashtext('thimar-tasmee:' || p_session_id::text));
  select * into v_auth from public.thimar_device_authorizations
   where account_id = btrim(p_account_id) and device_id = btrim(p_device_id)
     and revoked_at is null and expires_at > now() for update;
  if v_auth.id is null then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if v_auth.secret_hash <> crypt(btrim(p_device_secret), v_auth.secret_hash) then raise exception 'INVALID_DEVICE_SECRET'; end if;

  select * into v_account from public.thimar_accounts where id = btrim(p_account_id);
  if v_account.id is null or v_account.type <> 'student'
     or v_account.status <> 'active' or v_account.banned then
    raise exception 'STUDENT_ACCOUNT_REQUIRED';
  end if;

  delete from public.thimar_binding_nonces where expires_at < now() - interval '24 hours';
  v_nonce_hash := encode(digest(btrim(p_request_nonce), 'sha256'), 'hex');
  insert into public.thimar_binding_nonces (nonce_hash, account_id, device_id, expires_at)
  values (v_nonce_hash, btrim(p_account_id), btrim(p_device_id), now() + interval '5 minutes')
  on conflict (nonce_hash) do nothing returning nonce_hash into v_inserted;
  if v_inserted is null then raise exception 'REPLAYED_NONCE'; end if;

  v_mistakes := p_session->'mistakes';
  if exists (
    select 1 from jsonb_array_elements(v_mistakes) as mistake(value)
    where jsonb_typeof(mistake.value) <> 'object'
       or coalesce(mistake.value->>'word', '') = ''
       or coalesce((mistake.value->>'surah')::integer, 0) not between 1 and 114
       or coalesce((mistake.value->>'ayah')::integer, 0) <= 0
       or coalesce((mistake.value->>'global')::integer, 0) <= 0
  ) then raise exception 'INVALID_MISTAKES'; end if;

  v_safe_result := jsonb_build_object(
    'scope', coalesce(p_session->>'scope', 'page'),
    'maxErrors', p_session->'maxErrors',
    'reciterId', left(coalesce(p_session->>'reciterId', ''), 80),
    'mistakes', v_mistakes
  );
  insert into public.thimar_tasmee_sessions (
    session_id, account_id, session_at, page, surah, from_ayah, to_ayah,
    accuracy, correct, wrong, total, duration_sec, result
  ) values (
    p_session_id, btrim(p_account_id), (p_session->>'at')::bigint,
    (p_session->>'page')::integer, (p_session->>'surah')::integer,
    (p_session->>'fromAyah')::integer, (p_session->>'toAyah')::integer,
    (p_session->>'accuracy')::integer, (p_session->>'correct')::integer,
    (p_session->>'wrong')::integer, (p_session->>'total')::integer,
    (p_session->>'durationSec')::integer, v_safe_result
  ) on conflict (session_id) do nothing;
  update public.thimar_device_authorizations set last_used_at = now() where id = v_auth.id;
  return true;
end;
$$;

create or replace function public.thimar_list_own_tasmee_sessions(
  p_account_id text, p_device_id text, p_device_secret text, p_request_nonce text
) returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_auth public.thimar_device_authorizations;
  v_account public.thimar_accounts;
  v_nonce_hash text;
  v_inserted text;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_id, '')), '') is null
     or nullif(btrim(coalesce(p_device_secret, '')), '') is null
     or nullif(btrim(coalesce(p_request_nonce, '')), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if length(btrim(p_request_nonce)) < 32 then raise exception 'INVALID_NONCE'; end if;
  perform pg_advisory_xact_lock(hashtext('device-auth:account:' || btrim(p_account_id)));
  select * into v_auth from public.thimar_device_authorizations
   where account_id = btrim(p_account_id) and device_id = btrim(p_device_id)
     and revoked_at is null and expires_at > now() for update;
  if v_auth.id is null then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if v_auth.secret_hash <> crypt(btrim(p_device_secret), v_auth.secret_hash) then raise exception 'INVALID_DEVICE_SECRET'; end if;
  select * into v_account from public.thimar_accounts
   where id = btrim(p_account_id) and type = 'student' and status = 'active' and banned = false;
  if v_account.id is null then raise exception 'STUDENT_ACCOUNT_REQUIRED'; end if;

  delete from public.thimar_binding_nonces where expires_at < now() - interval '24 hours';
  v_nonce_hash := encode(digest(btrim(p_request_nonce), 'sha256'), 'hex');
  insert into public.thimar_binding_nonces (nonce_hash, account_id, device_id, expires_at)
  values (v_nonce_hash, btrim(p_account_id), btrim(p_device_id), now() + interval '5 minutes')
  on conflict (nonce_hash) do nothing returning nonce_hash into v_inserted;
  if v_inserted is null then raise exception 'REPLAYED_NONCE'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'syncId', session_id::text, 'at', session_at, 'page', page,
    'scope', result->>'scope', 'surah', surah, 'fromAyah', from_ayah,
    'toAyah', to_ayah, 'accuracy', accuracy, 'correct', correct,
    'wrong', wrong, 'total', total, 'durationSec', duration_sec,
    'maxErrors', result->'maxErrors', 'reciterId', result->>'reciterId',
    'mistakes', result->'mistakes'
  ) order by session_at desc), '[]'::jsonb)
  into v_result from public.thimar_tasmee_sessions where account_id = btrim(p_account_id);
  update public.thimar_device_authorizations set last_used_at = now() where id = v_auth.id;
  return v_result;
end;
$$;

revoke all on function public.thimar_save_tasmee_session(text,text,text,text,uuid,jsonb) from public;
revoke all on function public.thimar_list_own_tasmee_sessions(text,text,text,text) from public;
grant execute on function public.thimar_save_tasmee_session(text,text,text,text,uuid,jsonb) to anon, authenticated;
grant execute on function public.thimar_list_own_tasmee_sessions(text,text,text,text) to anon, authenticated;
