-- Thimar calls table (metadata only; no audio/video streams stored)
create table if not exists public.thimar_calls (
  id uuid primary key default gen_random_uuid(),
  caller_id text not null,
  callee_id text not null,
  mode text not null check (mode in ('audio','video')),
  state text not null default 'initiated'
    check (state in ('initiated','ringing','accepted','rejected','cancelled','busy','unavailable','missed','connecting','connected','ended','failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  end_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists thimar_calls_callee_idx on public.thimar_calls (callee_id, state);
create index if not exists thimar_calls_caller_idx on public.thimar_calls (caller_id, state);

alter table public.thimar_calls enable row level security;

create policy "participants can read own calls"
  on public.thimar_calls for select
  using (caller_id = current_setting('request.jwt.claims', true)::json->>'sub'
      or callee_id = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "caller can insert"
  on public.thimar_calls for insert
  with check (caller_id = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "participants can update"
  on public.thimar_calls for update
  using (caller_id = current_setting('request.jwt.claims', true)::json->>'sub'
      or callee_id = current_setting('request.jwt.claims', true)::json->>'sub');