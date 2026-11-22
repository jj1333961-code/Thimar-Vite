# ثمار — Android acceptance build 1.11.1 (versionCode 23)

Candidate only. **Not uploaded, not published, not announced.** Android runtime and
microphone tests remain **NOT TESTED** — no device or emulator is available in this
environment (`/dev/kvm` is `root:kvm` and this session is not in that group, `sudo` is
blocked, no `adb`/emulator initially, no physical device).

Artifacts: `artifacts/android-candidate/` (APK, inventory, build log, gate output,
`verification.json`) · rollback: `artifacts/android-rollback/thimar-1.10.2-release.apk`.

---

## 0. Root cause of the rejected 1.11.0 bundle — corrected diagnosis

My previous report said the APK carried a stale `quran/hafs/text.json`. That was **wrong**,
and the real cause is more interesting:

**`aapt2` transparently gunzips any asset whose name ends in `.gz` and packages it under the
name without `.gz`.** The APK therefore contained `assets/www/quran/hafs/text.json`
(1,401,218 bytes, the decompressed file) even though the bundle correctly contained
`text.json.gz`. `WebFallbackActivity.serveLocal()` looks up `www` + the requested path, so a
request for `…/text.json.gz` finds nothing, returns `null`, and the WebView goes to the
network. Evidence: the AGP merger manifest records
`<file name="www/quran/hafs/text.json" path="…/www/quran/hafs/text.json.gz"/>`.

What was genuinely stale, and what was not:

| Claim in the previous report | Correct finding |
| --- | --- |
| APK shipped the wrong Hafs file (stale) | APK shipped the right file under a name aapt2 rewrote → unreachable path. Fixed by decompressing at bundle time. |
| Gradle incremental `mergeReleaseAssets` kept stale files | **No evidence found.** The merger manifest already referenced the current `.gz` source. The asset cleanup in `bundle-android-assets.sh` is kept as hardening, not as a proven fix. |
| `quran/lines/*` missing | True — the 1.11.0 APK predates the Madani line data. It is now bundled and gated. |
| JS/CSS hashes differed from `dist` | True but expected: `dist` was rebuilt after the APK was assembled. |

## 1. Pipeline fixes (source)

`scripts/bundle-android-assets.sh` now:

1. Refuses to run unless `dist/` contains `sw.js`, `manifest.webmanifest`,
   `quran/pages.json`, `quran/hafs/text.json.gz`, `quran/tajweed.json` and at least 61
   `quran/lines/*.json` chunks.
2. Replaces `www/quran/hafs/text.json.gz` with the decompressed `text.json` so the packaged
   name is the name the JavaScript actually requests (aapt2 can no longer rewrite it).
3. Deletes `app/build/intermediates/{assets,compressed_assets,merged_assets,packaged_assets}`
   before packaging, so packaging never reuses prior asset output.
4. Writes `www/build.json` with the commit SHA, build time, build source, `indexAssets`
   parsed from `index.html`, and the line-chunk count.

`src/lib/mushafText.ts`: `readHafsText()` tries `quran/hafs/text.json` first (valid JSON
required) and falls back to `quran/hafs/text.json.gz` + gunzip. In the APK the first request
is served locally by `shouldInterceptRequest`; on the web it falls through to the gzip asset.
No reader UI, layout, or Quran functionality was changed.

`src/lib/tilawaRecitation.ts`: bundled builds pass `storage: BUNDLED_STORAGE` (see §5) and
honour a test-only tier override (see §6). `public/sw.js`: `VERSION` bumped to `v37` and
same-origin `/offline/` requests are no longer intercepted or cached (see §5).

`packaging/android/app/build.gradle`: `versionCode 23`, `versionName "1.11.1"`.

## 2. Required evidence

### 2.1 Source commit SHA

`build.json` inside the APK: `"commit": "58eb44a98274b3872a5941d96ae65b86e6f64913"`,
`"source": "local"`, `"builtAt": "2026-11-21T17:03:03Z"`,
`"quranLineChunks": 61`, `"indexAssets": ["/assets/index-CMTe61D6.css", "/assets/index-ClSeBJC9.js"]`.

**Caveat, stated plainly:** this is a **local build of the committed tree**, not a GitHub
Actions run. The build ran with `GITHUB_SHA` set to the fixes commit
`58eb44a98274b3872a5941d96ae65b86e6f64913`, exactly as CI would set it, so `build.json`
records that commit and the gate passes against it. `"source": "local"` in `build.json`
marks it as non-CI. A CI run could not be started: no GitHub repository contains this
codebase (§3b).

### 2.2 Build command and clean-build log

```bash
rm -rf dist && npm run build
GITHUB_SHA=$(git rev-parse HEAD) bash scripts/fetch-offline-assets.sh
GITHUB_SHA=$(git rev-parse HEAD) bash scripts/bundle-android-assets.sh
cd packaging/android && rm -rf app/build
./gradlew :app:assembleRelease --no-daemon --console=plain
```

Log: `artifacts/android-candidate/build-release.log` → `BUILD SUCCESSFUL in 21s`,
`46 actionable tasks: 45 executed, 1 up-to-date`, 56 `> Task` lines, no task skipped for
assets (`mergeReleaseAssets`, `compressReleaseAssets`, `packageRelease` all executed).
Vite build: `✓ built in 5.48s`.

### 2.3 APK extracted file inventory

`artifacts/android-candidate/INVENTORY.txt` — **291 entries**, uncompressed 146,166,655 B,
stored 92,537,839 B, APK on disk **92,583,286 B**.

### 2.4 JavaScript-requested assets exist

* `index.html` references → `/assets/index-CMTe61D6.css` ✓, `/assets/index-ClSeBJC9.js` ✓,
  `/manifest.webmanifest` ✓.
* 19 same-origin asset paths extracted from the bundled JS; **17 present**, 2 intentionally
  absent: `assets/ort-wasm-simd-threaded.jsep-Dt5UNR3U.wasm` and
  `assets/large/ort-wasm-simd-threaded.jsep-Dt5UNR3U.wasm`. Both are the ONNX runtime URLs
  used **only** when no offline bundle exists (`WASM_URL` in `src/lib/tilawaRecitation.ts`).
  With a bundle present the code points `wasmPaths` at `offline/v1/runtime/ort/…` and throws
  `OfflineAssetsError` instead of touching the network; the duplicate 29.5 MB copy is
  deliberately stripped from `www/assets`.
* `dist/` vs bundled `www/`: **100 common files, 0 content differences**; added
  `build.json` + decompressed `text.json`; removed only `quran/hafs/text.json.gz` and the
  duplicated `assets/ort-wasm-…wasm`.

### 2.5 Quran line-layout files included

`assets/www/quran/lines/`: **61 chunks, 850,829 B, covering pages 1–604** (gate asserts
exactly 61 files and full 1..604 coverage).

### 2.6 Offline asset SHA-256 results (read from inside the APK)

| Label | Bytes | SHA-256 | Matches manifest |
| --- | --- | --- | --- |
| full | 67,759,744 | `714e98ad…af1b` | ✓ |
| lite | 24,650,054 | `4974de78…0f1b` | ✓ |
| reference | 4,749,281 | `f236384e…b7727` | ✓ |
| wasm | 29,520,971 | `5ab83617…ff8f` | ✓ |
| wasm-loader | 47,250 | `7838b4b2…fd3` | ✓ |

Total offline payload 126,727,300 B. Quran data in the APK: `quran/pages.json` 97,589 B,
`quran/tajweed.json` 3,113,255 B, `quran/hafs/text.json` **1,401,218 B / 6,236 verses**
(valid JSON, verified), no `.gz` variant packaged.

### 2.7 Signature and package verification

```
package: name='app.thimar.quran' versionCode='23' versionName='1.11.1'
sdkVersion:'23' targetSdkVersion:'34'
apksigner verify: exit 0 — v1 (JAR) true, v2 true
Signer DN: CN=Thimar, OU=Thimar, O=Thimar, L=Riyadh, ST=Riyadh, C=SA
Certificate SHA-256: 9d7099e4130421e5791188b8eb74831371ea7a6483e2c989dfae5d785a7c49f9
APK SHA-256: ba4ec5c9601d249b19a824089dd538a913139bdbdd05bfd551c6ec848d6c0196
```

The certificate is byte-identical to the live production 1.10.2 APK, so the existing signing
identity is preserved. (`validateSigningRelease`/`verifySigningConfig` ran; a build without
credentials fails fast — observed during this session: `Missing THIMAR_KEYSTORE/…`.)

### 2.8 Storage / cache duplication analysis

| Path | Before | After |
| --- | --- | --- |
| `loadTilawa()` → `createTilawa({storage})` (`src/lib/tilawaRecitation.ts`) | no `storage` passed → `@tilawa/core` default `cacheStorage()` | bundle builds pass `BUNDLED_STORAGE` (`get→null`, `put/delete→no-op`, `keys→[]`) |
| `fetchModel()` (`@tilawa/core/dist/runtime/models.js`) ends with `await o.storage.put(key, bytes)` | copied the selected tier (24.6 MB lite / 67.8 MB full) into Cache Storage **on top of** the APK copy | no write happens; bytes come from `assets/offline/v1/…` via `shouldInterceptRequest` |
| `public/sw.js` fetch handler | `/offline/*` fell into the generic branch → `fetch()` + `cache.put` into `thimar-runtime-v1` | early `return` for same-origin `/offline/` — the Service Worker neither fetches nor caches the bundle |
| Cache cleanup (`activate`) | deletes `thimar-*` caches | unchanged; it only ever touches Cache Storage, never APK assets |
| Model integrity failure | `OfflineAssetsError` with an Arabic message; `loadTilawa` throws | unchanged — the network branch of `loadTilawa` runs **only** when `loadOfflineBundle()` returns `null` |

Verified in the packaged `sw.js`: `VERSION "v37"`, `skips_offline_path: true`,
`caches_offline: false`. Expected device effect (design, **not measured**): first launch adds
**no** model copy to app data; only WebView HTTP cache and the existing shell/data caches.

Not measured, still open: actual `dumpsys diskstats`/Settings sizes, and peak memory of
`verifyOfflineBundle()`, which reads all 126.7 MB and SHA-256s it on every cold start (single
allocation up to 67.8 MB for the full model).

### 2.9 PASS / FAIL / NOT TESTED

| Check | Result |
| --- | --- |
| Hafs text path reachable in APK (`text.json` present, `.gz` absent) | **PASS** |
| Quran line-layout chunks (61 files, pages 1–604) | **PASS** |
| `index.html` asset references exist | **PASS** |
| JS-referenced assets exist (17/19; 2 network-only ORT URLs by design) | **PASS** |
| Offline manifest SHA-256 for all 5 assets | **PASS** |
| APK commit identity present and equal to HEAD | **PASS** |
| Package id `app.thimar.quran`, versionCode 23, versionName 1.11.1 | **PASS** |
| Signature valid; same certificate as production 1.10.2 | **PASS** |
| `dist` == bundled `www` (content) | **PASS** (100/100 identical) |
| Model no longer copied into Cache Storage (code path) | **PASS** (static) |
| Service Worker no longer caches `/offline/` | **PASS** (static) |
| App works in airplane mode from bundled assets | **NOT TESTED** (no device) |
| Both tiers initialize (Lite and Full) in WebView | **NOT TESTED** |
| Login session / WebView storage preserved across upgrade | **NOT TESTED** |
| Real microphone recitation (all cases) | **NOT TESTED** |
| Measured installed/data/cache size on device | **NOT MEASURED** |
| Notifications, release workflow end-to-end in Actions | **NOT TESTED** (not run; gate logic executed locally) |

## 3. Model tier behaviour on Android

`@tilawa/core/dist/web.js → autoTier()`:

1. `navigator.deviceMemory < 4` → **lite**
2. mobile UA (`Android|iPhone|iPad|iPod|Mobile`) **and** `!("gpu" in navigator)` → **lite**
3. otherwise → **full**

Android WebView reports a mobile UA and normally does not expose `navigator.gpu` (WebGPU is
off by default), so the automatic choice on Android is **lite**. Full is bundled (67.8 MB)
but is not reachable today without an explicit override.

Test override (defaults untouched): `?tilawaTier=lite|full` on the URL, or
`localStorage["thimar.tilawa.tier"] = "full"`. On a device, set the localStorage value via
`chrome://inspect` remote debugging and reload, or open `https://thimar.freebuff.page/?tilawaTier=full`.
Nothing forces Full on a low-memory device; the override only takes effect when someone sets
it deliberately. A Full-tier run on a 3 GB device is expected to be slow and may hit the
200 MB model budget — that is exactly what the test is meant to reveal.

## 3b. Commit, CI and comparison — BLOCKED

### Commit (done, local only)

| Item | Value |
| --- | --- |
| Commit | `58eb44a98274b3872a5941d96ae65b86e6f64913` |
| Branch | `freebuff/d946da0783ff8899ce10bfbb` |
| Parent | `0db5a3f` (import commit) |
| Files | 10 files, 2,311 insertions, 0 deletions |
| Patch | `artifacts/android-1.11.1-fixes.patch` (111,527 B, sha256 `43ccbf1f…a96`) |

The ten files are the six source/build fixes (`src/lib/mushafText.ts`,
`src/lib/tilawaRecitation.ts`, `public/sw.js`, `scripts/bundle-android-assets.sh`,
`scripts/publish-android-update.sh`, `supabase/functions/send-update-notification/index.ts`),
`packaging/android/app/build.gradle` (versionCode 23 / 1.11.1) and
`.github/workflows/android-update-notification.yml`, plus the two acceptance reports.
No key, keystore, token, credential or user data is included; a scan for private-key blocks
and inline passwords matched only a literal `-----BEGIN PRIVATE KEY-----` regex used to parse
the FCM service account at runtime. Generated assets (`assets/www`, `assets/offline`), `dist/`,
the APKs and `artifacts/deploy-token.txt` are excluded (`.gitignore` and explicit staging).

### Why it is not pushed

**No GitHub repository contains this codebase.** Findings:

* The cloud worktree has **no git remote**, and the imported history has an **empty tree**
  (`git show HEAD:<path>` is empty for every project file), so there is nothing to push to.
* The connected GitHub account `jj1333961-code` has 8 repositories and **no organizations**.
  The only Thimar-named repo, `jj1333961-code/Thimar` (public, default branch `main`,
tip `cdd81c6`), is a **different application**: Next.js (`next.config.mjs`, `app/`, `components/`,
`bun.lock`, `proxy.ts`), with a Capacitor `android/` tree and an older
`android-update-notification.yml` (4,476 B vs 12 KB here). `src/lib/mushafText.ts` does not
exist there at all (404 on `main`).
* `thimar-ios-build` is an empty private repo; the remaining repos are unrelated projects.

Pushing these files into `jj1333961-code/Thimar` would graft a Vite build system onto a
Next.js app and break it — it would also run that repo's workflow against unrelated code.
I did not do that.

### CI build and CI/local comparison — NOT TESTED

| Required CI evidence | Status |
| --- | --- |
| Workflow run URL and commit SHA | **NOT TESTED** — no run was started; there is no repository to run it in |
| Reproducible dependency install (`npm ci`) in CI | **NOT TESTED** (executed locally earlier from the existing `node_modules`) |
| Checks out the exact commit / embeds `GITHUB_SHA` | **NOT TESTED** |
| CI APK versionName / versionCode | **NOT TESTED** |
| CI APK size and SHA-256 | **NOT TESTED** |
| CI signing certificate fingerprint | **NOT TESTED** |
| CI asset inventory and checksum gate | **NOT TESTED** |
| CI artifact passed every gate | **NOT TESTED** |
| CI APK identical to the local APK | **NOT TESTED** — no CI artifact exists to compare |

What *is* proven about identity handling: the previous build (`build.json` commit
`0db5a3f`) was **rejected** by the gate against `58eb44a`
(`Bundled build commit 0db5a3fe… does not match workflow commit 58eb44a9…`, exit 1), and the
rebuilt APK from the committed tree **passes** (`GATE EXIT: 0`). Rebuilds are therefore no
longer byte-identical, but identity is enforced: the candidate now matches its commit.

### Workflow safety added for the future CI run

`workflow_dispatch` now has a `publish` choice input (default `false`) and the publish job is
guarded by
`if: github.event_name != 'workflow_dispatch' || github.event.inputs.publish == 'true'`.
A manual CI run therefore builds, signs and verifies the APK and uploads it only as a
workflow artifact — it cannot upload to R2, rewrite production metadata or send notifications
unless someone explicitly passes `publish: true`. Push-triggered runs (metadata change on
`main`) keep the original publishing behaviour.

## 4. Release safety

* No upload, no metadata change, no deletion. `public/updates/android.json` still advertises
  1.10.2 / code 21; production APK untouched.
* Rollback preserved and re-verified: `artifacts/android-rollback/thimar-1.10.2-release.apk`,
  2,418,410 B, sha256 `63f807ed…a626` (matches live metadata).
* The rejected 1.11.0 APK (sha256 `f24672ec…93c6`) was overwritten in place by this rebuild;
  it was never published. Only its hash is retained.
* Candidate `artifacts/android-candidate/thimar-1.11.1-release.apk` is byte-identical to
  `packaging/android/app/build/outputs/apk/release/app-release.apk`
  (sha256 `ba4ec5c9601d249b19a824089dd538a913139bdbdd05bfd551c6ec848d6c0196`).
* Quran PDF: still blocked, untouched, not generated or substituted.
