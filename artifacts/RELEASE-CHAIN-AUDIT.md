# Release chain audit — upload → metadata → notification

Static audit of `.github/workflows/android-update-notification.yml`,
`scripts/publish-android-update.sh` and `scripts/cleanup-old-android-releases.sh`.
**Nothing was executed**: the repository is empty, so no run exists. Findings below are from
reading the code, and are labelled as such.

## Chain as built (publish job, `publish: true` only)

1. `Verify repository metadata matches built APK` — compares the built APK's sha256/size with
   `public/updates/android.json` **committed in the repo**, and fails if they differ.
2. `Reject invalid or non-incrementing versionCode` — fetches live metadata, refuses a
   versionCode that does not exceed every published one, and refuses a code already published
   under a different versionName.
3. `Upload APK to R2` — `POST /api/admin/upload-large?name=…` with `X-Deploy-Token`, fails on
   non-200.
4. `Verify uploaded APK` — re-downloads `https://thimar.freebuff.page/assets/large/<name>`,
   recomputes SHA-256 and checks size against the build outputs.
5. `Wait for production metadata and APK publication` — up to 30 × 10 s: live metadata must
   equal the repo file exactly, `available` must be true, and the APK URL must return the
   expected size and SHA-256.
6. `Remove obsolete production APKs from R2` — only the explicitly named `previous_apk`; it
   keeps the file named in live metadata, deletes the named one, then verifies HTTP 404.
7. `Trigger update notification` — `scripts/publish-android-update.sh` POSTs to
   `send-update-notification` with `Authorization: Bearer $THIMAR_PUSH_SECRET`, prints the
   provider response and fails on a non-2xx.

Safety properties that are actually present:

- `concurrency` is declared with `cancel-in-progress: false`, so two publishes cannot
  interleave.
- The publish job cannot run from a manual dispatch unless `publish: true` is passed
  explicitly.
- An APK that fails upstream verification never reaches step 3.
- Deletion is opt-in per file name, keeps the metadata-named APK, and is verified with a 404
  check afterwards.
- The notification step cannot write or roll back the release: it runs last, and its failure
  leaves the verified APK and metadata in place.
- Notification dedup is enforced twice: `ALREADY_NOTIFIED` per `version_code` in the function,
  and `thimar_update_notifications` as the audit row.

## Finding A — ordering contradicts the stated gate (needs a decision before the first publish)

Requirement: upload and verify the APK **first**, update `public/updates/android.json`
**after** a successful upload. The workflow as built requires the opposite: step 1 compares the
build against the **committed** metadata and step 5 waits until live metadata equals that
committed file. Since the production site publishes on push, the metadata pointing at
1.11.1 becomes live before the APK exists in `assets/large/`.

Consequence: a window of minutes where live metadata advertises a `downloadUrl` that 404s,
and any failure between the push and step 3 leaves production advertising a missing APK with
`available: true`. That is exactly the state the requirement forbids, and it cannot be fixed
by ordering inside a single workflow run.

Fix (implemented in this change set, unexecuted): `android.json` is no longer
committed by hand. The publish job **renders** it from the build outputs, uploads the APK,
re-downloads and hash-checks it, and only then commits the metadata with `[skip release]`
and waits for the live URL. The workflow now triggers on a `build.gradle` version bump
instead of on the metadata file, which removes both the optimistic-metadata window and the
risk of the bot's own commit re-triggering a release. Until a run exists this remains
**unverified code**, not a verified fix.

## Finding B — rollback copy of 1.10.2 is not automated

After 1.11.1 becomes current, 1.10.2 is the "previous" file and stays in `assets/large/`
unless someone passes `previous_apk=thimar-1.10.2-release.apk`, which then deletes it for
real (verified 404). Nothing in the workflow copies it to a rollback location first. The only
preserved copy today is `artifacts/android-rollback/thimar-1.10.2-release.apk`
(2,418,410 B, sha256 `63f807ed…a626`). Requirement 13 is therefore **PARTIAL**: preserved
out-of-band, not by the pipeline.

## Finding C — notification evidence is provider acceptance, not delivery

The function returns FCM per-token HTTP status counts (`sent`, `failed`, `invalid`) and writes
a row to `thimar_update_notifications`. That proves Google's API accepted the messages. It
does **not** prove a device displayed the notification, and no device receipt is collected.
Requirement 10 ("distinguish provider acceptance from device delivery") is satisfied in
wording only if the report says exactly that; device delivery stays **NOT TESTED**.

## Finding D — chain end-to-end is unproven

No workflow run exists, so every step above is code-reviewed, never executed. Two credentials
it depends on have never been exercised in this repository: `THIMAR_DEPLOY_TOKEN` (R2 upload
and delete) and `THIMAR_PUSH_SECRET` (notification). The deployed function v8 does exist and
carries the older-only logic, which is the only part of the chain with runtime evidence.

## Verification status

| Requirement | Status |
| --- | --- |
| Concurrency protection | PASS (code) |
| Manual run is build-only by default | PASS (code) |
| Refuse non-incrementing versionCode | PASS (code) |
| Upload then re-download + SHA-256 | PASS (code) |
| Metadata only after upload | **FAIL (code)** — see Finding A |
| Rollback copy outside active location | PARTIAL — manual only |
| Notification only for older versions | PASS (function v8, deployed) |
| Duplicate notification prevention | PASS (code + DB audit row) |
| Notification failure cannot corrupt publication | PASS (code) |
| Provider acceptance recorded | PASS (code) |
| Device delivery proven | NOT TESTED |
| Whole chain executed | NOT TESTED — no run exists |
