-- جلسات قابلة للإبطال + فهارس لتحديد معدّل المكالمات.
-- لا حذف ولا تعديل لأي صف قائم: إنشاء جدول/فهارس/trigger فقط.

create table if not exists public.thimar_sessions (
  id text primary key,
  account_id text not null references public.thimar_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  rotated_from text
);

create index if not exists thimar_sessions_account_idx
  on public.thimar_sessions (account_id, expires_at desc);

create index if not exists thimar_sessions_live_idx
  on public.thimar_sessions (expires_at)
  where revoked_at is null;

-- RLS مفعّل بلا أي policy: الجلسات لا تُقرأ من العميل إطلاقًا،
-- بل من Edge Functions بمفتاح الخدمة فقط (service role يتجاوز RLS).
alter table public.thimar_sessions enable row level security;

create index if not exists thimar_calls_caller_created_idx
  on public.thimar_calls (caller_id, created_at desc);

create index if not exists thimar_calls_callee_created_idx
  on public.thimar_calls (callee_id, created_at desc);

-- إبطال فوري لكل جلسات الحساب عند تغيير كلمة المرور أو الحظر أو حالة الحساب.
create or replace function public.thimar_revoke_sessions_on_account_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if (new.password_hash is distinct from old.password_hash)
     or (new.banned is distinct from old.banned)
     or (new.status is distinct from old.status) then
    update public.thimar_sessions
       set revoked_at = now(),
           revoked_reason = case
             when new.password_hash is distinct from old.password_hash then 'password_changed'
             when coalesce(new.banned, false) then 'banned'
             else 'account_status_changed'
           end
     where account_id = new.id
       and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists thimar_accounts_revoke_sessions on public.thimar_accounts;
create trigger thimar_accounts_revoke_sessions
  after update of password_hash, banned, status on public.thimar_accounts
  for each row execute function public.thimar_revoke_sessions_on_account_change();

-- لا وصول مباشر من anon: الجدول يُدار من Edge Functions بمفتاح الخدمة فقط.
revoke all on public.thimar_sessions from anon;
