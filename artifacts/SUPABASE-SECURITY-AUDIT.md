# Supabase security audit — production `jbsvmpiwdwowizzfzlqr`

Read-only inspection + unauthenticated HTTP probes. **No policy, bucket, row or function was
modified.** Production stays exactly as found.

## Evidence collected

| Check | Result |
| --- | --- |
| Project status | `ACTIVE_HEALTHY`, Postgres 17.11, eu-west-1 |
| Public tables | 38, RLS enabled on all of them |
| Anon key in shipped client | **yes** — a JWT found in `dist/assets/*.js`, i.e. inside the published web app and the APK |
| `GET /rest/v1/thimar_accounts?select=id&limit=1` with that key | **HTTP 200**, rows returned |
| `GET /rest/v1/quran_bookmarks` | HTTP 200 (table empty) |
| `GET /rest/v1/profiles` | HTTP 200, RLS filters to 0 rows for anon |
| `GET /rest/v1/thimar_fcm_tokens` | **HTTP 401** — denied (no policy, no grant) |
| `HEAD /storage/v1/object/public/thimar-chat-media/…voice….webm` | **HTTP 200 without any credentials** |

I did not request the columns that hold credentials, did not download media, and did not
attempt any write.

## Finding 1 — CRITICAL: account rows, including password material, are world-readable

`public.thimar_accounts` carries `password_hash` (text) and `password_salt` (text) and is
governed by a single permissive policy:

```sql
policy "thimar_accounts_all"  for ALL  to public  using (true)  with check (true)
```

Consequence: anyone who extracts the anon key from the public web bundle can `SELECT` every
row of `thimar_accounts` — 3 rows exist — including both password columns, and can also
`INSERT`, `UPDATE` and `DELETE` them. There is no per-user filter of any kind.

## Finding 2 — HIGH: eight more app tables are fully open to anon

Identical `to public / ALL / using true / with check true` policies:

| Table | Rows | What an attacker gets |
| --- | --- | --- |
| `thimar_accounts` | 3 | accounts + password hash/salt (above) |
| `thimar_chat_messages` | 3 | message text, media URLs, read receipts |
| `thimar_conversations` | 1 | member/admins lists, titles |
| `thimar_challenge_rooms` | 3 | room definitions, participants |
| `thimar_challenge_events` | 0 | event stream |
| `thimar_notifications` | 5 | notifications per account |
| `thimar_deletions` | 47 | deletion tombstones |
| `thimar_link_requests` | 1 | link payloads (jsonb) |
| `thimar_push_subscriptions` | 0 | Web-Push endpoints + `p256dh`/`auth` secrets |

Write access matters as much as read: `DELETE`/`UPDATE` to `thimar_accounts` or
`thimar_deletions` from an unauthenticated client can destroy or forge state.

Correctly scoped for comparison: `thimar_calls` uses
`caller_id = (request.jwt.claims->>'sub')` so anon matches nothing;
`thimar_fcm_tokens`, `thimar_push_config` and `thimar_update_notifications` have no
`public`-role policy and correctly answer 401.

## Finding 3 — HIGH: the chat-media bucket is public and world-writable

```
bucket thimar-chat-media: public = true, 25 MiB limit, 4 objects
storage.objects policies:
  "thimar chat media read"  SELECT to public using (bucket_id = 'thimar-chat-media')
  "thimar chat media write" INSERT to public with check (bucket_id = 'thimar-chat-media')
objects: 3 × audio/webm voice notes (59–428 KB), 1 × image/jpeg (87 KB), all owner = NULL
```

Public bucket + no auth on the object path = any file URL works for anyone, forever, and
`public: true` also makes them cacheable by CDNs. The INSERT policy lets anyone upload
arbitrary objects into the bucket (quota/abuse + content injection). `owner` being NULL on
all four objects is why inference ("only the owner reads it") is not in play either.

## Why the policies look like this — and why "just tighten RLS" breaks the app

The app authenticates itself against `thimar_accounts` (custom login, its own salt/hash),
**not** Supabase Auth: `auth.users` has 1 row, `profiles` 1. For an app-issued session there
is no Supabase JWT, so `auth.uid()` and `request.jwt.claims->>'sub'` are NULL. Every
`using (true)` policy is therefore a workaround: RLS cannot identify the caller. Any attempt
to filter by `auth.uid()` today would return zero rows and take the app down.

That is the root cause to fix, not the individual policies.

## Recommended least-privilege target (proposal only — not applied)

Pick one identity model first:

**Option A (recommended): issue Supabase-compatible JWTs for app sessions.**
Sign a JWT per login with the project JWT secret, `sub = accounts.id`, `role = authenticated`
and a `app_role` claim (`student` / `teacher` / `guardian` / `admin`). Then each table gets:

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `thimar_accounts` | self (`id = auth.uid()`) + admin | self (signup path via service role) | self, excluding `password_hash`/`password_salt` | admin only |
| `thimar_accounts.password_hash`, `password_salt` | **no client role at all** | — | — | — |
| `thimar_chat_messages` | conversation member | member, `sender_id = auth.uid()` | own message | own/admin |
| `thimar_conversations` | member (`member_ids ? auth.uid()`) | creator | admin of room | creator |
| `thimar_challenge_rooms` / `_events` | participant | participant | room admin | room admin |
| `thimar_notifications` | `account_id = auth.uid()` | service role | self (read flag) | self |
| `thimar_link_requests` | requester/target | requester | target (approve/reject) | admin |
| `thimar_push_subscriptions` | `account_id = auth.uid()` | self | self | self |
| `thimar_deletions` | admin/service role only | service role | — | — |

Plus, independent of the identity model:

```sql
-- stops the password columns leaking even if a policy is later widened again
REVOKE SELECT (password_hash, password_salt) ON public.thimar_accounts FROM anon, authenticated;
-- storage: private bucket + per-path ownership
UPDATE storage.buckets SET public = false WHERE id = 'thimar-chat-media';
-- drop "thimar chat media write" and replace with authenticated, owner-scoped policies
```

and a signed-URL flow (`createSignedUrl`) for chat media instead of public URLs.

**Option B (no client-visible DB at all):** move the `thimar_*` reads/writes behind the
existing Edge Functions with the service role and per-user authorization inside the function.
Slower to build, but it removes the anon-key attack surface entirely.

## Safe rollout (no disruption to existing users)

1. Freeze the schema; snapshot the DB before touching policies.
2. Build the JWT issuance (Option A) or the function proxy (Option B) in a branch/staging
   project, not production.
3. Run the policy set in a staging project seeded from a production schema dump, and run the
   app's full flow against it: login, chat send/receive, challenge join, push subscribe,
   offline sync.
4. Only then apply the migration to production inside a transaction, with the old policies
   kept in a rollback migration.
5. **Two immediate, low-risk mitigations** worth doing before any of that, once the client's
   column usage is confirmed: revoke `SELECT` on the two password columns from `anon`, and
   set the bucket to private with signed URLs. Both require a client change, so they are
   also gated on a release — do not flip them under the current 1.10.2 client.
6. Rotate `password_hash`/`password_salt` for the 3 existing accounts if the anon read is
   judged to have been exploitable (the key has been public since the web app went live).

## Status

Findings are verified; the fixes are **NOT APPLIED** and were not tested anywhere. Nothing
here changes production, users, or data.
