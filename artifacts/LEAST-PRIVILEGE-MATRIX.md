# Access matrix — prepared, not applied

Target state for every exposed relation, derived from the actual call sites in `src/`.
`anon` = the public key in the shipped bundle. `self` = the account id carried in the JWT
`sub`. `member` = participant of the conversation/room. `admin` = `app_role = 'admin'`.
`service` = service-role only, never reachable from a browser.

## Anonymous operations that must be denied

| # | Operation | Today | Target |
| --- | --- | --- | --- |
| 1 | `SELECT` any row of `thimar_accounts` | allowed | denied |
| 2 | `SELECT password_hash, password_salt` | allowed | denied (column revoke, both roles) |
| 3 | `INSERT/UPDATE/DELETE` any `thimar_accounts` row | allowed | self-only, delete admin-only |
| 4 | `SELECT` all conversations / messages | allowed | member-only |
| 5 | `DELETE` any notification or message | allowed | owner-only |
| 6 | `SELECT` push subscription endpoints/keys | allowed | self-only |
| 7 | `SELECT` link requests (payloads) | allowed | participant/admin |
| 8 | `SELECT/INSERT` challenge rooms and events | allowed | signed-in only |
| 9 | `GET` `storage/v1/object/public/thimar-chat-media/*` | allowed | denied → signed URL |
| 10 | `INSERT/DELETE` into the media bucket | allowed | owner-path only |

## Legitimate operations that must stay available

| Flow | Tables | RPC / path |
| --- | --- | --- |
| login, signup, password change | `thimar_accounts` | `thimar_login`, `thimar_change_password` (SECURITY DEFINER), registration via existing path |
| profile edit | `thimar_accounts` | self UPDATE (non-credential columns) |
| chat list/send/delete | `thimar_conversations`, `thimar_chat_messages` | member-scoped CRUD |
| notification list/mark-read | `thimar_notifications` | recipient-scoped SELECT/UPDATE/DELETE |
| teacher/guardian linking | `thimar_link_requests` | participant INSERT/SELECT/UPDATE |
| challenge join/play | `thimar_challenge_rooms`, `_events` | authenticated read, participant write |
| push registration | `thimar_push_subscriptions` | self CRUD |
| offline sync | all of the above + `thimar_deletions` | authenticated; tombstones ids-only |
| media upload/read | `storage.objects` | owner path + signed URL |

## Table-by-table

| Table | Rows | Policy today | anon | student | teacher | guardian | admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `thimar_accounts` | 3 | `ALL to public using true` | **none** | SELECT self, UPDATE self (no credential cols) | + SELECT own students | + SELECT linked children | full |
| `thimar_accounts.password_hash/salt` | 3 | inherited | **none** | none | none | none | none (server-verified only) |
| `thimar_conversations` | 1 | `ALL using true` | none | member SELECT | member + create | member SELECT | full |
| `thimar_chat_messages` | 3 | `ALL using true` | none | member SELECT/INSERT, own DELETE | same | member SELECT | full |
| `thimar_notifications` | 5 | `ALL using true` | none | self SELECT/UPDATE/DELETE | self | self | full; INSERT service-only |
| `thimar_link_requests` | 1 | `ALL using true` | none | own request R/W | own request R/W | own request R/W | full |
| `thimar_push_subscriptions` | 0 | `ALL using true` | none | self CRUD | self | self | self only (no admin read of keys) |
| `thimar_challenge_rooms` | 3 | `ALL using true` | none | SELECT | SELECT + manage | SELECT | full |
| `thimar_challenge_events` | 0 | `ALL using true` | none | SELECT/INSERT | same | SELECT | full |
| `thimar_deletions` | 47 | `ALL using true` | none | SELECT/INSERT (ids only) | same | same | full |
| `thimar_calls` | 3 | JWT-`sub` scoped (no-op for anon) | none | participant via function | same | same | full |
| `thimar_fcm_tokens` | 1 | none (RLS deny) | denied | service-only | service-only | service-only | service-only |
| `thimar_push_config` | 1 | none (RLS deny) | denied | service-only | service-only | service-only | service-only |
| `thimar_update_notifications` | 0 | none (RLS deny) | denied | service-only | service-only | service-only | service-only |
| `storage.objects` (chat media) | 4 | SELECT+INSERT to public, bucket public | none | own path | own path | own path | own path |

Policies that are already correct and were not touched: `profiles`,
`quran_bookmarks`, `recitations`, `students`, `assignments`, `exam_attempts`,
`proctor_*`, `attendance`, `grades`, `messages` (the non-Thimar set) — all keyed to
`auth.uid()` or `is_teacher()`.

## Staging test report — NOT RUN

No staging project exists and I cannot create one from this workspace. The exact cases to run,
before any production change:

1. anonymous probe table: for each of the 14 relations above, `SELECT`/`INSERT`/`UPDATE`/
   `DELETE` with the anon key → expect 401/403 or 0 rows.
2. anonymous media probe: `HEAD` public object → expect 404/403.
3. student workflow: login via RPC, list conversations, send a message, list notifications,
   join a challenge room, upload media, fetch it via signed URL.
4. teacher workflow: approve a link request, view a student's progress.
5. guardian workflow: view linked children only.
6. admin workflow: ban/unban, delete a test account.
7. account lifecycle: register → login → change password → login with the new password →
   confirm the old one fails.
8. offline sync: mutate locally, reconnect, confirm exactly one server row (no duplicates).

## Production migration + rollback

Order: snapshot → staging pass → deploy RPCs → client release → revokes → probes.
Each step has a matching rollback block in `AUTH-BOUNDARY.sql` and
`EMERGENCY-CONTAINMENT.sql`. Nothing here has been applied.

## Status

Matrix is **prepared**. Anonymous denial is **not in force**; the probes still succeed today.
