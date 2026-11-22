# Quran ASR Small — Final Physical Android Acceptance Preparation

Status: **PENDING physical acceptance** — production release 1.11.1 (versionCode 23) has been
built with the legitimate production keystore and published to the production website
(https://thimar.freebuff.page). Packaging/signing verification passed, but no physical
Android device or usable emulator test has been completed. The engine is **not** claimed as
fully accepted or physically verified.

## 1. Test build (throwaway signing key — NOT a production release)

Label this APK explicitly as a **test build**. It is signed with a temporary local keystore
(`/tmp/thimar-verify.jks`, alias `verify`) created only for packaging inspection. Do not
distribute it as a production release and do not use this key for production signing.

| Field | Value |
| --- | --- |
| Artifact (release APK) | `packaging/android/app/build/outputs/apk/release/app-release.apk` |
| Artifact (debug APK) | `packaging/android/app/build/outputs/apk/debug/app-debug.apk` |
| Artifact (AAB) | `packaging/android/app/build/outputs/bundle/release/app-release.aab` |
| Package identifier | `app.thimar.quran` |
| Version name | `1.11.1` |
| Version code | `23` |
| minSdk / targetSdk | `23` / `34` |
| Release APK size | `121,512,893` bytes (≈115.9 MiB) |
| Release APK SHA-256 | `bfd8ed01fea7b4d6e3b23631fa68d7e4365a6adb764138dad3b0100a49099cdf` |
| Debug APK size | `126,760,194` bytes |
| Debug APK SHA-256 | `fc227efeb81d8fe4ab8eb1b7dd4a316d33ee0237cddd09097010cbe9b850ec24` |
| AAB size | `121,169,103` bytes |
| AAB SHA-256 | `16bdd942ef8188fa0e8c8d57ce9d5178b1dafd9712621652e6c033876a15835e` |
| Signing | Temporary throwaway key only (test build). Production signing credentials were not requested. |

### Mandatory Quran ASR Small assets embedded

Verified by `scripts/verify-quran-asr-assets.sh` (source tree) and
`scripts/verify-package-assets.sh` (APK/AAB bytes). All mandatory files are embedded and
their sizes/SHA-256 match the pinned manifest.

| Asset | Bytes | SHA-256 |
| --- | --- | --- |
| `quran-asr-small/model.int8.onnx` | `36,081,762` | `88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0` |
| `quran-asr-small/tokens.txt` | `180` | `75b53814499cee84a07c7b7a318524d30bcaf84273c0f8b28a04176023e8c74f` |
| `quran-asr-small/spelling.json` | `69,970` | `7adff00aa1d4b0413a3a89f898117682a22639624b3666121f6de785e0fb346a` |
| `quran-asr-small/LICENSE` | `1,062` | `3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c` |

Manifest: `assets/offline/v1/manifest.json`, schema `1`, `assetBase "/offline/v1/"`,
9 registered assets. Package verification result: `{"status":"verified"}` for both APK and AAB.

Build-time enforcement: `verifyQuranAsrAssets` runs on `preBuild`; `verifyQuranAsrDebugPackage`,
`verifyQuranAsrReleasePackage`, and `verifyQuranAsrBundlePackage` run as `finalizedBy` of
`assembleDebug`, `assembleRelease`, and `bundleRelease` respectively. A missing or corrupted
mandatory asset fails the build.

## 2. Initialization behavior review (code paths)

- **Quran ASR selected (mode `quran-asr` or `combined`)**: `src/main.tsx` `warmQuranAsr()`
  runs 3 s after paint. It dynamically imports `tasmeeEngines`, checks
  `readTasmeeEngineMode() !== "tilawa"` and `tasmeeMemoryRisk().level !== "high"`, then
  dynamically imports `quranAsrSmall` and calls `scheduleQuranAsrPreload()` (requestIdleCallback
  with 2 s timeout, else `setTimeout(0)`). `loadQuranAsr()` reads the bundled manifest,
  verifies model + tokens (size + SHA-256), creates one ORT WASM session, and stores it in
  the module-level `engine` singleton. `loadPromise` deduplicates concurrent callers.
- **Tilawa selected (default mode)**: `warmQuranAsr()` returns early before importing
  `quranAsrSmall`, so Quran ASR is not initialized. Tilawa warm-up (`warmTilawa`) runs
  independently. No second large model is loaded on low-end devices.
- **Tasmee started before initialization finishes**: `assessTasmeeRecording()` calls the
  provider (`loadQuranAsr()` by default), which returns the in-flight `loadPromise` if loading
  is already underway, so the caller awaits the existing load instead of starting a duplicate.
  `MushafTasmeeSheet` constructs `TasmeeOrchestrator(mode)` without a custom provider, so it
  uses the default provider and therefore the shared session.
- **Repeated recitation**: `engine` persists across calls; `seenEngines` (WeakSet) reports
  `reused: true` after the first run. `TasmeeOrchestrator.reset()` resets capture state only;
  it does not dispose the engine. No reload per recitation.
- **Insufficient memory**: `toEngineError()` maps OOM/allocation/RangeError messages to
  `low-memory` (`TasmeeEngineError`), surfaced as a local Arabic error with
  `onlineFallback === false`. No network fallback is attempted. Warm-up is also skipped when
  `tasmeeMemoryRisk().level === "high"`.
- **Missing or corrupted bundled model**: `loadQuranAsrManifest()` returns `null` or
  `fetchVerified()` throws on size/SHA mismatch. `loadQuranAsr()` sets state `error` with a
  local message and rethrows; `assessTasmeeRecording()` converts it to `engine-failed`/`low-memory`.
  No download is attempted. Settings shows `quranAsr.message` (read-only card, no download/retry
  buttons).

### Memory threshold review

`src/lib/tasmeeEngines.ts` `tasmeeMemoryRisk()` uses `navigator.deviceMemory` (total RAM,
bucketed by the browser/WebView, capped at 8). Thresholds: `< 2 GB → high`, `< 4 GB → warn`,
otherwise `ok`; `null` → `warn`.

Caveats to verify on device:
- `navigator.deviceMemory` reports **total** device RAM, not available/free memory. On Android
  the WebView value is a coarse bucket, so a 3 GB device may report `2` and a 2 GB device
  may report `2` even when only a fraction is free.
- The threshold gates only the **optional background warm-up** for non-default modes; it does
  not block an on-demand load during Tasmee, which could still OOM on very low-memory devices.
- Recommended physical check: run on a 2 GB and a 3 GB device, monitor `dumpsys meminfo`
  during warm-up and during a 3-minute recitation, and confirm no OOM kill. If OOM occurs,
  raise the warm-up threshold to `< 4` and/or add an available-memory check before on-demand
  load. No code change is made here pending that measurement.

## 3. Physical device acceptance checklist

Record for every run: device model, Android version/build, WebView version, APK/AAB SHA-256,
timestamp, and `adb logcat`.

### A. APK installation test (release APK)

- [ ] `adb install -r app-release.apk` returns `Success`.
- [ ] Settings → Apps → Thimar shows version `1.11.1 (23)`.
- [ ] `adb shell dumpsys package app.thimar.quran | grep versionName` matches.
- [ ] App launches without crash on first open (online, then repeat offline).

### B. AAB installation test (separate track)

- [ ] Install via bundletool/Play internal track: `bundletool install-apks` or Play Console
      internal testing; confirm install succeeds.
- [ ] Version name/code match `1.11.1 / 23`.
- [ ] Repeat all offline/airplane-mode steps below on the AAB install.
- [ ] Note any install-time differences (split APKs, asset delivery) versus the APK install.

### C. Fresh install in airplane mode

- [ ] Enable airplane mode + Wi-Fi/mobile data off before install.
- [ ] Install the APK/AAB while offline.
- [ ] Launch; app shell loads from bundled `www` (no blank screen, no "no internet" wall).

### D. First launch without internet

- [ ] Cold start in airplane mode completes without crash.
- [ ] Open Settings → Quran ASR card shows `✅ مثبَّت داخل التطبيق` (read-only, no download
      button, no progress screen, no verify/retry buttons).
- [ ] No network requests to `/offline/v1/...` fall through to the network (check logcat /
      WebView network panel).

### E. Open Tasmee and start microphone recording

- [ ] Open Mushaf Tasmee, select `Quran ASR Small فقط` or `الاثنان (تسلسلي)`.
- [ ] Grant microphone permission; recording starts without visiting Settings.
- [ ] Level meter / capture works offline.

### F. Complete Quran ASR recognition + memorization assessment

- [ ] Recite a known passage (e.g. Al-Baqarah 2:255 continuously).
- [ ] Assessment completes; words/accuracy shown in the separate Quran ASR result block.
- [ ] Tilawa remains intact (no redesign/unrelated changes observed).

### G. Repeat several attempts

- [ ] Repeat 3+ times; verify session reuse (init time ~0 ms after first run; no reload).
- [ ] Force `combined` mode and confirm Tilawa runs during recording then Quran ASR assesses
      after stop (sequential, not concurrent).

### H. Force-stop and reopen while offline

- [ ] `adb shell am force-stop app.thimar.quran`, then cold start in airplane mode.
- [ ] App + Tasmee + Quran ASR assessment still work.
- [ ] Repeat the test after force-stop.

### I. Record measurements

- [ ] Peak RAM (`adb shell dumpsys meminfo app.thimar.quran`) during warm-up and during a
      3-minute recitation.
- [ ] Initialization latency (first `loadQuranAsr` ms) and processing latency (transcribeMs).
- [ ] Any crashes / OOM kills (check `adb logcat` for `OutOfMemoryError`).
- [ ] Confirm zero external network requests during recitation (airplane mode already
      guarantees; additionally disable airplane mode + mobile data only and confirm no audio
      upload).

### J. Corrupted/missing bundle behavior (optional, destructive to install only)

- [ ] Install a build with a deliberately renamed/corrupted mandatory asset, or truncate one
      asset via `run-as` (debuggable build only).
- [ ] App shows a clear local error; no download attempted; no silent online fallback.

## 4. Known blockers

- No physical Android device available in this environment.
- No usable KVM / emulator (`/dev/kvm` is `root:kvm 0660`, session not in `kvm` group;
  `sudo` blocked; `adb`/emulator initially absent).
- Release/AAB artifacts are signed with a throwaway key only; production signing credentials
  were not requested and are not present.
- On-device measurements (RAM, init/processing latency, OOM behavior, AAB install split
  delivery) are unmeasured.
- `navigator.deviceMemory` total-RAM bucketing vs. available memory is unvalidated on real
  Android WebView.

## 5. Remaining code-level risks

- Warm-up threshold (2 GB) is based on total reported RAM, not available memory; could
  over-trigger on memory-constrained devices. Mitigation present: warm-up only for
  non-default persisted modes; on-demand load still guarded by `toEngineError` low-memory
  mapping, but a hard OOM crash inside the WebView is possible and untested.
- `loadQuranAsr()` does not fetch/verify `spelling.json` at runtime (it is bundled and
  build-verified but unused by the current inference path). If a future feature needs it,
  add a `fetchVerified` call; otherwise it is dead weight in the APK (69,970 B, verified).
- `resetQuranAsr()` disposes the session but `seenEngines` (WeakSet) retains the old
  reference harmlessly; new engine reports `reused: false`. No functional impact.
- Service Worker (`public/sw.js`, VERSION `v37`) early-returns for same-origin `/offline/`
  paths and does not cache them; if the SW is stale on an upgraded device, old caching
  behavior could briefly apply until activation. Mitigated by `updateViaCache: "none"` and
  `controllerchange` reload in `src/main.tsx`.
- The engine is a singleton per page context; a full process restart reloads it (expected).
  No cross-tab sharing; each WebView instance loads its own session.
- Tilawa integration is intentionally untouched; regression risk is limited to the new
  orchestration in `tasmeeEngines.ts` and `MushafTasmeeSheet.tsx`, which has passed the
  Node harness (capture 60.73 s, Tilawa RTF 0.173, ASR 6,268 ms RTF 0.103, peak RSS
  1,271.3 MB, session reuse, low-memory/no-audio errors, assessment including 2:255 50/50,
  Tilawa integrity 8/8) but not a real device.

## 6. Verdict

**PENDING** — physical device acceptance not performed. Do not report the engine as fully
accepted, production-ready, or physically verified until sections 3.A–3.I pass on a real
Android device (and 3.B for the AAB track).
