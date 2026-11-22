# THIMAR — Delivery status (1.11.1 candidate vs 1.10.2 production)

Date: 2026-11-21. Nothing was published. Production remains 1.10.2 (versionCode 21).

## Verdict

**Release is BLOCKED.** Two independent gates cannot be satisfied from this workspace:
the repository cannot be written to (no git credentials), and no Android device or
emulator exists for the mandatory offline/recitation acceptance. Every affected row
below is therefore NOT TESTED or BLOCKED, never PASS by assumption.

## 1. Repository

| Item | Value |
| --- | --- |
| URL | https://github.com/jj1333961-code/Thimar-Vite |
| Private | yes (`private: true`, `visibility: private`) |
| Default branch | `main` |
| Latest commit SHA | **none** — repository is empty (`409 Git Repository is empty`) |
| Source tree on GitHub | **absent** — setup is NOT complete |
| Unrelated `jj1333961-code/Thimar` | untouched (different Next.js app) |

Push attempt (prompt disabled): `remote: Repository not found. / fatal: Authentication
failed` — the unauthenticated answer for a private repo. No token exists in the
environment, and the connector's blob/tree/commit APIs would require uploading ~20 MB of
binary assets through tool arguments, which cannot carry this tree or its history.

Ready-to-push artifact: `artifacts/thimar-vite.bundle`
(13,884,806 B, sha256 `53a03087c12e536e685483425fbcb03fd7700d6ba6237bbb756935c4daa1f68a`),
326 files, three commits:
`9b676a4` import · `f739d97` offline bundle + gate fixes · `0de30e6` evidence reports.
Verified by cloning the bundle: all commits present, working tree clean, no `.jks`,
`SIGNING.txt`, `.env`, `.apk` or deploy token in the file list.

## 2. GitHub Actions

NOT TESTED. No run URL, no CI APK, no local-vs-CI comparison — there is no commit to build.

## 3. Candidate APK (local build, verified)

| Field | Value |
| --- | --- |
| Version | 1.11.1, versionCode 23 |
| Package | `app.thimar.quran` |
| Size | 92,583,286 B |
| SHA-256 | `ba4ec5c9601d249b19a824089dd538a913139bdbdd05bfd551c6ec848d6c0196` |
| Certificate | `9d7099e4…49f9` (CN=Thimar, Riyadh, SA) — same as production 1.10.2 |
| Signature schemes | v1 true, v2 true, v3 false |
| In-APK gate | exit 0 (build identity = `58eb44a`, 61 line chunks 1–604, 6,236 Hafs verses, 5/5 asset digests) |

## 4. Offline asset inventory

291 files, 146,166,655 B uncompressed; five offline payloads verified against manifest
SHA-256 inside the APK; `quran/hafs/text.json` valid JSON with 6,236 verses; no `.gz`
asset packaged; all `index.html` and JS asset references present. Quran PDF: still
absent and still blocked — no substitute was generated.

## 5. Android acceptance (offline reader, microphone)

NOT TESTED. No device; `/dev/kvm` is root-only and `sudo` is unavailable, so no emulator.
Desktop-browser results are not a substitute and were not used.

## 6. Database (production Supabase `jbsvmpiwdwowizzfzlqr`, ACTIVE_HEALTHY)

Inspected read-only. Connectivity PASS. Schema: 38 public tables, 75 total across
public/auth/storage, 0 views; RLS enabled on every public table.

| Table | Rows |
| --- | --- |
| `auth.users` | 1 |
| `public.profiles` | 1 |
| `public.thimar_accounts` | 3 |
| `public.admins` | 1 |
| `public.quran_bookmarks` | 0 |
| `public.recitations` | 0 |
| `public.app_snapshots` | 0 |
| `public.students` | 0 |
| `public.thimar_deletions` | 47 |

Realtime publication: `thimar_challenge_events`, `thimar_challenge_rooms`.
Storage: one bucket `thimar-chat-media`, **public = true**, 25 MiB object limit, 4 objects.

Authentication is app-level (`thimar_accounts`), not Supabase Auth: only one auth user
exists. CRUD write tests NOT TESTED — the connector is read-only here and no test
accounts were created (creating users would modify production data). RLS policies exist
for all `thimar_*` tables, several with role `public` and `ALL`; their permissiveness was
not audited to conclusion.

## 7. Offline synchronization

NOT TESTED. Requires two sessions with connectivity transitions on a device.

## 8. Background operation

NOT TESTED (device). No new permissions or services were added in this pass; audit of the
existing lifecycle code was not performed to conclusion.

## 9. Live APK URL and metadata

Unchanged production metadata in `public/updates/android.json`:
versionName 1.10.2, versionCode 21, 2,418,410 B,
sha256 `63f807eda671381f04aa975909a661eecc14a7e9d80973924474c8014c68a626`,
`https://thimar.freebuff.page/assets/large/thimar-1.10.2-release.apk`.
Not re-fetched over HTTP in this pass, so live reachability is NOT TESTED here.

## 10. Notifications

Deployed `send-update-notification` v8 (ACTIVE, `verify_jwt: false`, guarded by
`THIMAR_PUSH_SECRET`) contains the intended logic: idempotent per `version_code`,
eligibility by `versionCode < target` via `versionHistory`, FCM v1 with invalid-token
cleanup, and a `thimar_update_notifications` audit row. Invocation and delivery: NOT
TESTED. Workflow→function automation: NOT PROVEN (no workflow run exists).

## 11. Rollback

`artifacts/android-rollback/thimar-1.10.2-release.apk`, 2,418,410 B,
sha256 `63f807eda671381f04aa975909a661eecc14a7e9d80973924474c8014c68a626` — identical
to the live production artifact.

## 12. What must happen before any publication

1. Push `artifacts/thimar-vite.bundle` to `Thimar-Vite` `main` (credentials are the
   blocker), then add secrets `THIMAR_KEYSTORE_BASE64`, `THIMAR_KEYSTORE_PASSWORD`,
   `THIMAR_KEY_ALIAS`, `THIMAR_KEY_PASSWORD` plus the R2 credentials.
2. Run the workflow with `publish: false` and compare the CI APK with
   `ba4ec5c9…0196`.
3. Run the real-device sequence (install → sign in → airplane mode → force-stop →
   restart → offline Quran → Lite/Full → microphone → screen lock → reopen) and record
   model, OS, logs.
4. Only then publish, re-download, verify SHA-256, update metadata, notify.
