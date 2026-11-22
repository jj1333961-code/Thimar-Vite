# ثمار — Android offline acceptance, 1.11.0 (versionCode 22)

Status: **NOT ACCEPTED — do not publish.**
Date: 2026-11-21 · Build under test: `packaging/android/app/build/outputs/apk/release/app-release.apk`

This report separates what was actually executed from what could not be executed in this
environment. Nothing in the device-dependent sections is marked PASS.

---

## 0. Test environment (and why device tests did not run)

| Environment | Available | Notes |
| --- | --- | --- |
| Real Android device | **No** | No device is attached; no `adb` server, no USB passthrough. |
| Android emulator | **No** | `/dev/kvm` exists but is `root:kvm 0660`, and this session runs as `uid=…(fbd946da…)` **not** in the `kvm` group; `sudo` is blocked (`no new privileges`). An x86_64 image cannot be accelerated, and no Android SDK/system image is installed. `adb`, `emulator`, `sdkmanager`, `avdmanager`, `java` are all absent. |
| Android microphone | **No** | Follows from the two rows above. |
| Host OS / VM | Ubuntu, 8 vCPU, 15 GB RAM, 51 GB free — Linux only | Useful for artifact inspection, not for running an APK. |
| Artifact inspection | **Yes** | Python `zipfile`/`hashlib`, APK v2 signing-block parsing. |
| CI logic execution | **Yes (locally)** | Workflow `run:` blocks extracted with PyYAML and executed against the real APK. |

Every item that needs a running app is reported as **NOT TESTED**, not as PASS.

---

## 1. Android WebView validation

### 1.1 Artifact facts (executed)

```
$ sha256sum app-release.apk
f24672ecf8266226aeddf99b1d4c2eedd40791893c88a5ad118d041811db93c6  app-release.apk
$ stat -c%s app-release.apk
92376085
```
* `applicationId app.thimar.quran`, `versionCode 22`, `versionName "1.11.0"` (from
  `app/build.gradle` and `app/build/outputs/apk/release/output-metadata.json`).
* minSdk 23, targetSdk 34.
* Signing: APK Signature Scheme **v2** block present (`0x7109871a`, plus stripping-protection
  `0x42726577`). Signer certificate SHA-256:
  `9d7099e4130421e5791188b8eb74831371ea7a6483e2c989dfae5d785a7c49f9`.
  The live production APK 1.10.2 has the **identical** certificate fingerprint
  (downloaded from `https://thimar.freebuff.page/assets/large/thimar-1.10.2-release.apk`),
  so 1.11.0 is signed with the same production identity. **PASS (artifact-level).**
* Bundled offline manifest verified against the bytes actually inside the APK:

```
OK full           67759744 bytes 714e98ad…af1b
OK lite           24650054 bytes 4974de78…0f1b
OK reference       4749281 bytes f236384e…b7727
OK wasm           29520971 bytes 5ab83617…ff8f
OK wasm-loader       47250 bytes 7838b4b2…fd3
ALL OK
```

> **Correction (see `ANDROID-CANDIDATE-1.11.1.md` §0).** The `.gz` half of this section was
> misdiagnosed: `aapt2` transparently gunzips assets ending in `.gz` and packages them under
> the name without `.gz`, so the APK was not shipping a stale `text.json` — it was rewriting
> the correct `text.json.gz`. The missing `quran/lines/*` and the generic asset-path fallthrough
> remain valid findings. The 1.11.1 candidate fixes both.

### 1.2 Blocking defect found in this APK: the web bundle and its asset tree disagree

The APK ships a web build that is **not** the one in the working tree:

| Expected by the shipped JS | Actual file inside the APK |
| --- | --- |
| `/quran/hafs/text.json.gz` (referenced 1× in `assets/www/assets/index-BE0QV6qM.js`) | `assets/www/quran/hafs/text.json` (uncompressed, 1,401,218 B) |
| `/quran/lines/<start>-<end>.json` (Madani line layout) | **absent** |

Current sources are `src/lib/mushafText.ts:91` → `quran/hafs/text.json.gz` and
`src/lib/quranPageLayout.ts:78` → `quran/lines/…`. The working-tree bundle
(`packaging/android/app/src/main/assets/www`, 13:23) *does* contain `text.json.gz` and
`dist/assets/index--YLP0oRF.js`, while the APK contains the older `index-BE0QV6qM.js`.
The APK (13:25) was therefore assembled from a stale `assets/www`.

`WebFallbackActivity.serveLocal()` returns `null` for any path it cannot open from
`assets/`, and `null` means “let the WebView go to the network”.
Consequence: **the Mushaf Hafs text is fetched from the network in this APK**, and in
airplane mode it cannot load. This directly violates “no required application asset
silently falls back to the internet”.

**Verdict: FAIL (proved by inspection of this exact APK).** The release must be rebuilt
through `scripts/bundle-android-assets.sh` (which the CI workflow does) before any
device acceptance run.

### 1.3 ONNX Runtime WASM, Lite/Full tiers, Quran data (NOT TESTED on device)

* ORT runtime is bundled (`assets/offline/v1/runtime/ort/…wasm`, 29.5 MB) and its SHA-256
  matches the manifest; `src/lib/tilawaRecitation.ts` points `wasmPaths` at
  `bundle.assetBase` when the bundle exists, with no network fallback
  (`OfflineAssetsError` otherwise). **Static: PASS. Runtime: NOT TESTED.**
* Tier selection: the app calls `createTilawa({ tier: "auto" })` — there is **no UI or
  setting to force Lite or Full** (`grep tier src` → only `tier: "auto"`, twice).
  `@tilawa/core` `web.autoTier()` = lite when `navigator.deviceMemory < 4`, or when the UA
  is mobile and `navigator.gpu` is absent. Android WebView normally has no WebGPU, so on
  Android the automatic choice is **lite**, and the 67.7 MB full model is effectively
  unused payload. “Both Lite and Full can initialize” is **not exercisable as shipped**:
  NOT TESTED / not reachable without a code change or a debug override.
* Quran reference / pages / Hafs text / Tajweed: `quran/pages.json` (97,589 B),
  `quran/tajweed.json` (3,113,255 B) are in the APK; Hafs text is broken per §1.2.
  Device load in airplane mode: **NOT TESTED**.
* `/api/`, auth, Supabase, Realtime over a live network: **NOT TESTED** (needs a device).
  Static note: `serveLocal()` deliberately passes `/api/` and `/updates/` through to the
  network, which is the intended behaviour.
* Existing WebView origin storage / login session preserved across upgrade: **NOT TESTED**
  (needs install-over-install on a device with a signed-in session).

### 1.4 Request routing (from code)

`WebFallbackActivity.serveLocal(Uri)` runs inside `shouldInterceptRequest` for **every**
request the WebView makes:

| Request | Handled by | Evidence |
| --- | --- | --- |
| `https://thimar.freebuff.page/` and any path without a dot | `shouldInterceptRequest` → `assets/www/index.html` | `serveLocal`, SPA fallback |
| Bundled same-origin assets: `/assets/*.js/css`, `/sw.js`, `/index.html`, `/fonts/*`, `/icons/*`, `/adhan/*`, `/quran/pages.json`, `/quran/tajweed.json`, `/quran/hafs/*`, `/offline/v1/*`, `/licenses/*` | `shouldInterceptRequest` → `getAssets().open("www"+path)`, `Cache-Control: no-cache`, header `X-Thimar-Offline-Bundle: 1` | `openAsset()` |
| `/mushaf-pages/NNN.webp` | `shouldInterceptRequest` → `assets/mushaf/NNN.webp`, immutable | `serveMushafPage()` — note: **no `assets/mushaf/` exists in the 1.11.0 APK**, so this path falls through to the network |
| `/api/…`, `/updates/…` | **Network (intentional)** | early `return null` in `serveLocal` |
| Any same-origin path not present in `assets/` | **Network (implicit)** — this is how the Hafs-text defect in §1.2 escapes silently | `openAsset()` returns `null` → WebView proceeds |
| Cross-origin (`api.alquran.cloud`, `api.aladhan.com`, `api.quran.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, Supabase, …) | **Service Worker**, then network | `public/sw.js` `fetch` handler: `OFFLINE_HOSTS` list, runtime cache |

Service Worker (`public/sw.js`, `VERSION = "v36"`, registered in `src/main.tsx` when
`import.meta.env.PROD`) handles, when it controls the page:

| Path | SW behaviour |
| --- | --- |
| navigation | network first, fallback to cached `/index.html` |
| `/updates/*` | network only, `no-store` (intentional) |
| `/assets/*` | network first, cache in `thimar-shell-v1` (or `thimar-large-v1`) |
| `/icons/`, `/adhan/`, `/quran/`, `/api/`, `/manifest.webmanifest` | cache-first (`thimar-shell-v1`) |
| `/offline/v1/*` | **no explicit rule** → generic branch: `fetch()` then **`cache.put` into `thimar-runtime-v1`** |
| other cross-origin in `OFFLINE_HOSTS` | network, cache on success |

Two consequences that must be settled on a device:

1. **Overlap between the two layers is undefined by design.** In WebView, a fetch issued by
   the Service Worker is not guaranteed to pass through `shouldInterceptRequest`. If it
   does not, `/offline/v1/*` (92.4 MB of models) would be requested **from the network**
   while “offline”, i.e. the opposite of the intent. If it does, the intercept wins and the
   SW rule is inert. This cannot be resolved by reading code — it needs `chrome://inspect`
   / `adb logcat` on a real WebView.
2. **The selected model is duplicated into Cache Storage.** `@tilawa/core`
   `fetchModel()` always finishes with `storage.put(key, bytes)`, and the app passes no
   custom storage, so the bundled 24.6 MB lite (or 67.7 MB full) model is copied out of the
   APK assets into the Cache API on first initialization — on top of the copy inside the
   APK. If the SW rule above also fires, a third copy lands in `thimar-runtime-v1`.

---

## 2. Offline lifecycle (install → setup → airplane mode → force-stop → reopen)

**NOT TESTED.** No Android device or emulator is available (§0). The eight-step procedure
was not executed, so there is no PASS for this section. §1.2 already predicts a failure at
step 6 (Open Quran) for this APK: the Hafs text asset path does not match.

---

## 3. Real microphone recitation (Arabic)

**NOT TESTED.** No device, no microphone. Specifically unverified: permission prompt and
denial paths, correct recognition/word alignment, omitted/incorrect/additional word
detection, continuous recitation, pause/resume, and error messages for missing assets.

Static observations only (not test results):
* `AndroidManifest.xml` declares `RECORD_AUDIO`; `WebChromeClient.onPermissionRequest`
  grants only `RESOURCE_AUDIO_CAPTURE`/`VIDEO_CAPTURE` **and only for origin
  `https://thimar.freebuff.page`**, requesting the runtime permission first — the denial
  path calls `request.deny()`.
* Missing-asset errors surface as `OfflineAssetsError` with Arabic messages
  (`src/lib/tilawaRecitation.ts`), and **no cloud fallback** is attempted when a bundle
  manifest is present.

**Tajweed-rule audio analysis is not claimed.** Only word-level alignment exists; nothing
in the tested code path analyses tajweed rules in audio.

---

## 4. Storage measurement

Measured from the artifact (exact bytes). Device-side figures are **not measured** and are
therefore not reported as numbers.

APK on disk: **92,376,085 bytes** (88.1 MiB).

| Component | Files | Uncompressed | Stored in APK (deflated) |
| --- | --- | --- | --- |
| `assets/offline` (5 files + manifest) | 6 | 126,728,373 | 83,263,725 |
| `assets/www` (web bundle) | 40 | 12,399,632 | 6,681,854 |
| `classes.dex` (+classes2) | 2 | 5,720,356 | 2,021,928 |
| `resources.arsc` / `res/` | 124 | 351,042 | 332,776 |
| `META-INF/` | 32 | 45,408 | 20,965 |
| other | 25 | 245,283 | 209,708 |
| **Total** | **229** | **145,298,758** | **92,339,620** |

Model payload: full 67,759,744 B · lite 24,650,054 B · reference 4,749,281 B ·
ORT wasm 29,520,971 B · wasm loader 47,250 B = **126,727,300 B**.

| Required measurement | Result |
| --- | --- |
| APK size | 92,376,085 B (measured) |
| Installed application size | **NOT MEASURED** — needs `adb shell dumpsys package` / Settings on a device. (Android stores the APK plus dex-opt artifacts; the APK is not extracted to a second copy for assets.) |
| Application data size after fresh install | **NOT MEASURED** |
| App data after first launch | **NOT MEASURED** |
| After first Lite init | **NOT MEASURED** — code predicts **+24,650,054 B** in Cache Storage (§1.4.2) |
| After first Full init | **NOT MEASURED** — code predicts **+67,759,744 B**, and lite+full may coexist (budget 200 MB) |
| Cache size | **NOT MEASURED** |
| Are both models duplicated into cache? | **Yes by construction** (`fetchModel` → `storage.put`); both may coexist in Cache Storage. Magnitude unmeasured. |

Additional runtime risk to measure on device: `verifyOfflineBundle()` re-reads and
SHA-256s **all 126.7 MB** of bundled assets on every cold start (`verifyOfflineBundle`,
cached per page load only). Peak single allocation ≈ 67.8 MB (full model). Startup cost and
OOM risk on 2–3 GB devices are unmeasured.

---

## 5. Release workflow (`\.github/workflows/android-update-notification.yml`)

Verified by reading the workflow and by executing its `run:` blocks locally with PyYAML.

| Requirement | Before | Now | Evidence |
| --- | --- | --- | --- |
| Generates all offline assets before building the APK | Yes — `npm run build` → `fetch-offline-assets.sh` → `bundle-android-assets.sh` → `assembleRelease` | unchanged | workflow order |
| Verifies every asset checksum | **Only on download** (`fetch-offline-assets.sh`), nothing checked the packaged result | **Added** `Verify bundled assets inside APK`: opens the APK, requires `index.html`, `sw.js`, `manifest.webmanifest`, `quran/pages.json`, `quran/hafs/text.json.gz`, `quran/tajweed.json`, licenses, then verifies `bytes` + `sha256` of every manifest asset **inside the APK** | executed locally: on the stale 1.11.0 APK → **exit 1** `Missing bundled assets: ['assets/www/quran/hafs/text.json.gz']` (the §1.2 defect, caught); on a freshly bundled tree → **exit 0**, all five assets OK |
| Uses the existing production signing certificate | Yes (`THIMAR_KEYSTORE*` secrets) | unchanged | certificate fingerprint equals production 1.10.2 (§1.1) |
| Rejects invalid or non-incrementing versionCode | **No such check** | **Added** `Reject invalid or non-incrementing versionCode` — fails unless `versionCode ≥ 1` and strictly greater than every other published/live code, and rejects a re-used code with a different `versionName` (falls back to repository history if production metadata is unreachable) | 22 → exit 0; 21 → exit 1 (“must increase: built 21 <= highest published 21”); 0 → exit 1 |
| Uploads the APK only after all checks pass | Yes (build job) | unchanged, plus the new checks run before upload | workflow |
| Updates release metadata only after successful upload verification | **No.** Metadata is committed first — that commit is what *triggers* the workflow; the APK is uploaded afterwards and the job only then waits for the live metadata+APK to agree | **Not fixed** (would require inverting the trigger). Mitigated: new `Verify repository metadata matches built APK` proves `sha256`/`fileSize`/`versionCode`/`versionName`/`fileName`/`downloadUrl` describe *this* APK before upload, so a stale or wrong metadata commit fails the run instead of publishing | executed: correct metadata → exit 0; wrong sha / wrong versionCode / wrong size → exit 1 |
| Invokes the notification function only after successful publication | Yes — after the “wait for production metadata and APK” step | unchanged | workflow |
| Sends notifications only to devices on an older version | **No.** Unknown `app_version` fell back to `app_version !== versionName`, which also matches *newer* and *unmapped* versions | **Fixed** in `supabase/functions/send-update-notification/index.ts`: unknown installed version → skipped; otherwise semantic-version comparison < target (after the `versionHistory` code lookup) | code review; not executed (no Deno runtime) |
| Records provider acceptance and device-delivery evidence | Only `curl` output in the log | **Added** in `scripts/publish-android-update.sh`: captures HTTP code + response body, fails the job on non-200, writes both to `$GITHUB_STEP_SUMMARY` and states explicitly that FCM acceptance ≠ device delivery | `bash -n` clean; not executed against FCM |

Not claimed: FCM acceptance is not delivery evidence. No device-delivery receipt exists and
none can be produced without devices.

---

## 6. Quran PDF

**Blocked, untouched.** No PDF was generated, downloaded, substituted, compressed, cropped
or modified. `scripts/bundle-android-assets.sh` only copies `public/quran/quran.pdf` or
`mushaf.pdf` *if present*; neither exists, so the APK contains no PDF.

---

## 7. Release safety

* Nothing was published, uploaded, deleted or replaced. `public/updates/android.json` still
  advertises **1.10.2 / versionCode 21** (production unchanged).
* Rollback copy preserved and verified:
  `artifacts/android-rollback/thimar-1.10.2-release.apk` — 2,418,410 B,
  sha256 `63f807eda671381f04aa975909a661eecc14a7e9d80973924474c8014c68a626`,
  identical to the live production metadata value.

---

## 8. Verdict

| Area | Result |
| --- | --- |
| APK integrity / signing identity / bundled-asset checksums | **PASS** (artifact-level) |
| Bundled web build matches the app source | **FAIL** — stale `assets/www`, Hafs text path mismatch, no `quran/lines` |
| WebView startup offline, ORT load, Quran data, sessions, `/api/` | **NOT TESTED** |
| Offline lifecycle (install → airplane → force-stop → reopen) | **NOT TESTED** |
| Real microphone recitation | **NOT TESTED** |
| Storage on device / cache duplication magnitude | **NOT MEASURED** (duplication proven in code) |
| Release workflow gates | **PARTIAL** — three gaps closed and locally executed; metadata-first ordering remains a design risk |
| Quran PDF | **BLOCKED** (awaiting original PDF) |

Required before acceptance: rebuild the APK through the workflow (regenerates `dist` →
`fetch-offline-assets.sh` → `bundle-android-assets.sh`), re-run the new in-APK asset check,
then execute §2 and §3 on a real device (or a KVM-enabled emulator) and record storage from
`adb shell du`/Settings. 1.11.0 must not be published until then.
