-- إشعارات FCM لتطبيق ثمار (Android APK).
-- يُشغَّل مرة واحدة على مشروع Supabase الحالي: SQL Editor ← الصق ← Run.
--
-- مبدأ الأمان:
--   • لا يقرأ العميل الجدول ولا يكتب فيه مباشرة (RLS مفعّلة بلا سياسات anon).
--   • الجهاز يربط رمزه بحسابه عبر دالة آمنة (security definer) تتحقق من وجود الحساب،
--     وتُلغي أي ربط سابق على نفس الجهاز حتى لا تصل إشعارات حساب قديم لجهاز مُستخدَم.
--   • القراءة (لإرسال الإشعارات) تكون بمفتاح service role على الخادم فقط.

create table if not exists public.thimar_fcm_tokens (
  token        text primary key,
  account_id   text not null,
  device_id    text not null,
  platform     text not null default 'android',
  app_version  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists thimar_fcm_tokens_account_idx
  on public.thimar_fcm_tokens (account_id);

-- جهاز واحد = حساب واحد نشط.
create unique index if not exists thimar_fcm_tokens_device_uidx
  on public.thimar_fcm_tokens (device_id);

alter table public.thimar_fcm_tokens enable row level security;

-- لا وصول مباشر من التطبيق (anon) إلى الجدول: لا سياسات، مع سحب الصلاحيات.
drop policy if exists "thimar fcm tokens read" on public.thimar_fcm_tokens;
drop policy if exists "thimar fcm tokens write" on public.thimar_fcm_tokens;
drop policy if exists "thimar fcm tokens update" on public.thimar_fcm_tokens;
revoke all on public.thimar_fcm_tokens from anon, authenticated;

-- ربط رمز الجهاز بالحساب المُسجَّل حاليًا (يُستدعى من التطبيق).
create or replace function public.thimar_bind_fcm_token(
  p_token       text,
  p_account_id  text,
  p_device_id   text,
  p_platform    text default 'android',
  p_app_version text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_token), '');
begin
  if v_token is null
     or nullif(btrim(p_account_id), '') is null
     or nullif(btrim(p_device_id), '') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not exists (select 1 from public.thimar_accounts where id = p_account_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  -- جهاز مُستخدَم بحساب آخر: يُحذف ربطه السابق قبل ربط الحساب الجديد.
  delete from public.thimar_fcm_tokens
   where device_id = btrim(p_device_id)
     and account_id <> p_account_id;

  insert into public.thimar_fcm_tokens (token, account_id, device_id, platform, app_version)
  values (
    v_token,
    p_account_id,
    btrim(p_device_id),
    coalesce(nullif(btrim(p_platform), ''), 'android'),
    p_app_version
  )
  on conflict (token) do update
     set account_id  = excluded.account_id,
         device_id   = excluded.device_id,
         platform    = excluded.platform,
         app_version = excluded.app_version,
         updated_at  = now();
end;
$$;

-- إلغاء ربط الجهاز (تسجيل الخروج أو حذف الرمز على الجهاز).
create or replace function public.thimar_revoke_fcm_token(
  p_device_id  text,
  p_account_id text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  delete from public.thimar_fcm_tokens
   where device_id = btrim(coalesce(p_device_id, ''))
     and (p_account_id is null or account_id = p_account_id);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.thimar_bind_fcm_token(text, text, text, text, text) from public;
revoke all on function public.thimar_revoke_fcm_token(text, text) from public;
grant execute on function public.thimar_bind_fcm_token(text, text, text, text, text) to anon, authenticated;
grant execute on function public.thimar_revoke_fcm_token(text, text) to anon, authenticated;

-- تنظيف الرموز القديمة تلقائيًا بعد 90 يومًا بلا تحديث.
create or replace function public.thimar_prune_fcm_tokens()
returns void language sql as $$
  delete from public.thimar_fcm_tokens where updated_at < now() - interval '90 days';
$$;
