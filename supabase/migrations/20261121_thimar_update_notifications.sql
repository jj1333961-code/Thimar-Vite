create table if not exists public.thimar_update_notifications (
  version_code integer primary key,
  version_name text,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  invalid_count integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.thimar_update_notifications enable row level security;
revoke all on public.thimar_update_notifications from anon, authenticated;