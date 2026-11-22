# Incident — anonymous full access to Thimar production data

Detected 2026-11-21. Production Supabase project `jbsvmpiwdwowizzfzlqr`.
**Status: OPEN. No containment applied. No data changed.**

## 1. Independently confirmed exposures

All probes were unauthenticated, read-only, and used the anon key that is shipped inside the
public web bundle and the APK. No credential value, media content or secret was printed,
logged or stored.

| # | Probe | Result | Meaning |
| --- | --- | --- | --- |
| 1 | `GET /rest/v1/thimar_accounts?select=password_hash,password_salt` | **HTTP 200, 3 rows** | every account's 64-char hash and 32-char salt is world-readable |
| 2 | hash families | 3 distinct prefixes, lengths 64 / salt 32 | per-user salt, fast hash (SHA-256-class), offline-crackable |
| 3 | `GET /rest/v1/thimar_accounts?select=id` | 200 | full account rows enumerable |
| 4 | `DELETE /rest/v1/thimar_notifications?id=eq.__probe_nonexistent__` | **HTTP 200, `[]`** | anon holds DELETE and it executed (no row matched — nothing was modified) |
| 5 | `HEAD /storage/v1/object/public/thimar-chat-media/…voice….webm` | **HTTP 200, no credentials** | chat voice notes and photos downloadable by URL |
| 6 | `GET /rest/v1/thimar_fcm_tokens` | 401 | correctly closed |
| 7 | `GET /rest/v1/profiles`, `/quran_bookmarks` | 200 | reachable; currently 0 rows visible to anon |
| 8 | policies | 9 tables `ALL TO public USING (true) WITH CHECK (true)` | read + insert + update + delete for anyone |
| 9 | bucket | `thimar-chat-media public = true`, `SELECT` and `INSERT` to `public` | open read and open upload |

Tables fully open: `thimar_accounts`, `thimar_chat_messages`, `thimar_conversations`,
`thimar_challenge_rooms`, `thimar_challenge_events`, `thimar_notifications`,
`thimar_deletions`, `thimar_link_requests`, `thimar_push_subscriptions`.

## 2. Containment applied: **none — and here is exactly why**

The exposure cannot be closed server-side without taking the live app down, because the
shipped client (1.10.2, and the 1.11.1 candidate) *is* built on this access:

| Control that would close it | What breaks in the live client | Source |
| --- | --- | --- |
| Revoke `SELECT (password_hash, password_salt)` | **login and password change stop working** — the client reads the hash/salt to verify the password locally | `src/lib/auth.ts:118,119`, `src/lib/cloud.ts:94,115` |
| Restrict `thimar_accounts` to `auth.uid()` | every user looks anonymous to RLS → zero rows → **full app outage** | `auth.users` = 1 row; app sessions are not Supabase sessions |
| Remove `ALL` → keep only SELECT | chat, notifications, challenge join, sync writes fail | `src/lib/cloud.ts:151–168,299,349,415,552–561` |
| Revoke `DELETE` | admin account deletion, chat delete, notification cleanup fail | `src/lib/cloud.ts:211,222–226,365,580,596–598` |
| Make the bucket private | **all chat media stops rendering** (client calls `getPublicUrl`) | `src/lib/cloud.ts:539` |

I have no capability to close the gap from here either: the Supabase integration exposes
list/get/invoke for Edge Functions but **no deploy**, and there is no code-deployment path
(repository empty, no git credentials, no site/R2 deploy token). Deploying new authentication
code and a matching client is the only real fix, and it must be a release.

I will not claim containment I did not apply, and I did not apply a policy change that would
lock your three users out to look responsive.

## 3. Production features affected by each containment option

- **Break-glass A — rotate the anon/API keys in the dashboard (fastest, no code):** closes
  the leak within minutes; **takes the entire app offline** for every deployed client
  (web + 1.10.2 APK) until new keys ship in a release. Total availability loss, no data loss.
- **Break-glass B — revoke anon grants on the 9 tables:** same effect for all server-backed
  features, but scoped; also breaks login.
- **Containment C — column revoke + private bucket + JWT policies (the actual fix):** requires
  the auth Edge Function and a client release first; then nothing legitimate breaks.

## 4. Evidence of unauthorised modification

Nothing found, and it cannot be excluded:

- 3 accounts, none banned, created 2026-11-13 → 2026-11-19; 47 tombstones, 12 referencing
  account ids (consistent with normal sync churn, not proof either way).
- 4 media objects (`3 × audio/webm`, `1 × image/jpeg`), newest uploaded 2026-11-20 14:20 UTC,
  before this audit.
- No application-level audit trail records anonymous reads, so unauthorised *reads* of the
  hashes and media are **undetectable**. Assume they may have happened: the key is public and
  the policies have no filter. Treat the 3 password hashes as compromised — rotate them after
  the fix, not before (rotating now still leaves them readable).

## 5. Untested

- Whether the three hashes have already been cracked (not attempted, not testable from here).
- Whether any third party has queried these endpoints (no log retention configured for this).
- Every part of the remediation: it has not been applied anywhere, staging or production.
- All authenticated workflows under any proposed policy — no staging project exists.

## 6. Prepared, not applied

`artifacts/EMERGENCY-CONTAINMENT.sql` contains the staged migration: JWT issuance contract,
per-table least-privilege policies, credential-column revoke, private bucket with signed URLs,
verification probes and a rollback block. It is designed to be run **only** together with a
client that no longer needs anonymous access, after staging verification.
