# Thimar — Technical Limitations (Differential Update System)

## Implemented (verified in this workspace)
- Web/application-asset differential engine: `src/lib/differentialUpdate.ts`
  - Manifest comparison (unchanged/added/modified/deleted/corrupted), SHA-256 + size verification.
  - Local manifest persistence (memory + localStorage stores), staged download with rollback, deleted-file removal only when explicitly listed and not protected.
  - Unit tests: `tests/differential-update.test.mjs`, `tests/differential-engine.test.mjs` (9 tests passing).
- Release notes system: `public/updates/release-notes.json` now includes 1.11.3 (AR/EN); `public/updates/android.json` synced.
- Update UI: `src/components/UpdatePrompt.tsx` now shows version, release date, size, mandatory/optional, release notes (features/improvements/bug fixes/security), progress indicator, view-details toggle.
- Release manifest generator: `scripts/generate-release-manifest.mjs`.
- Native APK updater scaffold: `packaging/android/app/src/main/java/app/thimar/quran/ThimarUpdater.java` + manifest FileProvider + permission + registration in `WebFallbackActivity`.
- Existing pipeline (GitHub Actions) already uploads APK, verifies, publishes metadata, triggers notifications.

## Not implemented / not verifiable here
1. **Site redeploy (metadata live)**: The Freebuff site does not auto-deploy from git push. `https://thimar.freebuff.page/updates/android.json` still serves versionCode 23. Redeploy must be done from the origin chat or by providing the Worker source. Until then, the in-app checker and notification campaign cannot be verified against 1.11.3.
2. **Native APK updater untested**: `ThimarUpdater.java` was written without an Android SDK/Java compiler in this workspace (java not installed). It must be compiled and tested on a device/emulator. Binary differential APK patches (bsdiff) are NOT implemented; the system falls back to full signed APK download, as permitted by the spec when safety cannot be guaranteed.
3. **Binary differential APK patches**: Not supported. The signing identity is preserved (no rebuild), but patch generation/application was not implemented because patch tooling and verification infra are not available. Full APK download is the safe fallback.
4. **Resumable downloads (cross-session)**: The engine supports in-memory retry with Range headers, but does not persist partial downloads across page reloads.
5. **Atomic promotion across Cache API**: Staging uses in-memory Map; promotion writes to the asset store. True cross-store atomic swap is limited by Cache API capabilities.
6. **Physical device tests**: Cannot run (no device/emulator). Automated code tests are distinguished from device tests in `tests/`.
7. **CI notification trigger**: Not triggered because live metadata is still 23; triggering now would target the wrong version.
8. **Differential web-asset upload to R2**: Freebuff Sites deploy uploads the full asset set; per-file differential upload is not supported by the platform. Vite content-hashing prevents redundant browser downloads of unchanged assets.
9. **Downgrade prevention on client**: `minSupportedVersionCode` is present in metadata; client-side enforcement is partial (UpdatePrompt compares versionCode).

## Required manual steps
- Redeploy Freebuff site with updated `public/updates/android.json` (versionCode 25).
- Compile and test `ThimarUpdater` with Android SDK; add `REQUEST_INSTALL_PACKAGES` handling UX.
- Trigger notification campaign only after live metadata returns versionCode 25.
- (Optional) Provide keystore secrets to run full CI workflow.
