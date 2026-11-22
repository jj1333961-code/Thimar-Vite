# Containment report — 2026-11-21

Production project `jbsvmpiwdwowizzfzlqr`. Status: **exposure open; nothing in production changed.**

## 1. The anonymous DELETE probe — exact evidence

| Question | Answer |
| --- | --- |
| Endpoint | `DELETE /rest/v1/thimar_notifications?id=eq.__probe_nonexistent__` |
| Table targeted | `public.thimar_notifications` |
| Filter | `id = '__probe_nonexistent__'` — a literal that cannot match any row |
| HTTP status | **200** (PostgREST executed the statement and returned `[]`) |
| Rows returned | `[]` |
| Rows affected | **0** |
| Was any real record deleted? | **No.** No row could match the filter |
| Was it a diagnostic record? | No record of any kind was touched |

What this proves: the **capability** exists (anon holds `DELETE` and a permissive `ALL`
policy), and the request was not rejected. It does not prove any record was deleted.

**My later probe wrote one row and I removed it.** The `thimar-calls` diagnostic invocation
created call row `7caff9e8-ffcf-4a64-a21a-2699168c974d` (`ringing`). I ended it
(`end_reason=diagnostic_probe_cleanup`), then deleted it. `thimar_calls` is back to its
original 3 rows.

## 2. Data integrity right now

| Table | Rows | Compared to the first audit |
| --- | --- | --- |
| `thimar_accounts` | 3 | unchanged |
| `thimar_notifications` | 5 | unchanged |
| `thimar_deletions` | 47 | unchanged |
| `thimar_calls` | 3 | unchanged (probe row removed) |
| active call rows | 0 | none blocking |
| `storage.objects` (chat media) | 4 | unchanged |

No account, conversation, notification, tombstone or media object is missing.

## 3. Audit of past unauthorised modifications — limited but attempted

- Log retention available through the API is **24 hours**. Anything earlier is gone.
- In that window: 3,131 `edge_logs`, 126 `postgrest_logs`, 6 `storage_logs`, 0 rows matching
  `delete`/`patch` in `postgrest_logs`.
- `postgrest_logs` here carry **no request-method attribute**, so I cannot attribute requests
  to methods. A statement-level audit trail does not exist for PostgREST traffic.

Conclusion: **no evidence of unauthorised modification, and no ability to exclude it.** Treat
the three password hashes as compromised and rotate them after the auth boundary is live.

## 4. Why no write restriction was applied

Every write path the shipped client uses is anonymous, so each candidate restriction is an
outage rather than containment:

| Restriction | What stops working |
| --- | --- |
| Revoke INSERT/UPDATE on `thimar_accounts` | signup, profile save, password change |
| Revoke DELETE on `thimar_accounts` | admin account deletion |
| Revoke writes on conversations/messages | chat send, delete, sync |
| Revoke writes on `thimar_notifications` | notification sync |
| Revoke writes on `thimar_link_requests` / push subscriptions | teacher/guardian linking, push registration |
| Private bucket | every chat media render (client uses `getPublicUrl`) |
| Revoke anon SELECT on `thimar_accounts` | **login** (`src/lib/auth.ts:118`, hash + salt read client-side) |

Applying any of these today converts a data exposure into a total service outage for the three
existing accounts, with no replacement path in the deployed client.

## 5. The staged path that does work (prepared, not applied)

The password boundary can be built server-side **without** a new Edge Function deploy, using
`SECURITY DEFINER` RPCs over PostgREST — see `artifacts/AUTH-BOUNDARY.sql`. The hash format is
known exactly: `sha256hex(salt + ":" + password)` (`src/lib/password.ts:12-19`), so Postgres
`pgcrypto` can verify the existing hashes without any data migration.

Order of operations:

1. **Staging first.** Create a staging project, restore a schema + data dump from production,
   apply `AUTH-BOUNDARY.sql`, and verify `thimar_login` accepts a known password and rejects a
   wrong one.
2. **Ship a client that calls the RPC** for login, signup, password change — and stops reading
   `password_hash`/`password_salt`. Until this release is out, the columns must stay readable.
3. **Only then** revoke the credential columns and the table's anon SELECT. This is the step
   that closes the leak permanently, and it is gated on step 2 being live for all users.
4. Storage: create private bucket + owner-scoped policies + `createSignedUrl`, again only
   together with the client that requests signed URLs.
5. Then the eight other tables, one at a time, each with its own staging pass.

Steps 1 and 3–5 need a database/function deploy and a client release; I have neither here, so I
stopped at prepared, reviewable SQL. **No part of this has been applied or tested.**

## 6. What I recommend right now

Given the hashes are readable and cannot be protected without a client release, the only
lever that closes the hole today is break-glass: rotate the anon key (full outage until the new
client ships), or revoke anon grants on the nine tables (same, scoped). Both are dashboard
actions. Neither is something I can do, and neither is reversible without shipping a client, so
the decision is yours — but the exposure stays open until one of the two happens or step 2-3
above completes.
