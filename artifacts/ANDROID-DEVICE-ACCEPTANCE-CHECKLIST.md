# Android real-device acceptance checklist — Thimar 1.11.1 (versionCode 23)

Candidate under test: `artifacts/android-candidate/thimar-1.11.1-release.apk`
92,583,286 B · sha256 `ba4ec5c9601d249b19a824089dd538a913139bdbdd05bfd551c6ec848d6c0196`
certificate `9d7099e4…49f9` · `app.thimar.quran`

Record for every run: device model, Android version/build, WebView version
(`chrome://version` in the WebView or `adb shell dumpsys webviewupdate`), APK sha256,
timestamp, and `adb logcat` saved per step.

## 0. Preconditions

- [ ] Device on a clean Wi-Fi network; note the SSID.
- [ ] `adb devices` shows the device; `adb shell getprop ro.build.version.release` recorded.
- [ ] Existing production account credentials available for the test user (do not create a
      new account unless testing signup).
- [ ] Battery > 50 %, screen lock (PIN) configured to test lock/unlock.
- [ ] Stopwatch or screen recording for recitation timing.

## 1. Install and identity

- [ ] `adb install -r thimar-1.11.1-release.apk` succeeds (`Success`).
- [ ] Settings → Apps → Thimar shows version 1.11.1 (23).
- [ ] `adb shell dumpsys package app.thimar.quran | grep versionName` matches.
- [ ] App launches without a crash on first open (online).

## 2. Online baseline and session

- [ ] Sign in with the existing account; existing data appears (profile name, any chats).
- [ ] Note the values that must survive later: signed-in account id, last-read Quran page,
      selected reciter, Tilawa tier, settings toggles.
- [ ] Open the Quran reader online once; note page and surah.
- [ ] Kill the app (`adb shell am force-stop app.thimar.quran`) and reopen online:
      session still active, no re-login.

## 3. Offline launch (the 1.11.0 regression)

- [ ] Enable airplane mode (`adb shell cmd connectivity airplane-mode enable`).
- [ ] Force-stop, then cold start.
- [ ] App shell loads from the bundled `www` (no blank screen, no "no internet" wall).
- [ ] Quran reader opens an arbitrary page offline; text renders.
- [ ] Check `chrome://inspect` network panel or `adb logcat` for requests to
      `quran/hafs/text.json.gz` — must be **absent**; the request must be `quran/hafs/text.json`
      served from the app origin.
- [ ] Page navigation across at least 3 surahs and pages 1, 100, 604 renders correctly.
- [ ] Tajweed colouring renders if enabled; line layout matches the Madani chunks.

## 4. Tilawa engine — Lite

- [ ] With airplane mode still on, open Tilawa.
- [ ] Force Lite via override: `?tilawaTier=lite` in the app URL, or
      `localStorage["thimar.tilawa.tier"]="lite"` then reload.
- [ ] Confirm in logs/UI that the Lite model loaded from the bundled path, not the network.
- [ ] Start recitation; Arabic text follows the reciter; alignment highlights advance.
- [ ] Stop, seek backwards and forwards; no crash, no stuck state.

## 5. Tilawa engine — Full

- [ ] Force Full via `?tilawaTier=full` (or `localStorage["thimar.tilawa.tier"]="full"`).
- [ ] Confirm the Full model loaded from the bundle; measure time to ready (record seconds).
- [ ] Repeat the alignment checks; compare accuracy against Lite where visible.
- [ ] Confirm the safe-fallback rule still applies when the device cannot run Full
      (see `autoTier()`: `deviceMemory < 4` or mobile UA without GPU → lite).

## 6. Microphone recitation, offline

Grant the microphone permission when prompted; if it was previously denied, verify the app
explains how to re-enable it (system settings deep link) rather than failing silently.

For each case, recite a short known passage and record the app's verdict:

- [ ] Correct recitation → accepted, expected wording marked.
- [ ] Omitted word (skip one word) → reported as omission, not as a silent pass.
- [ ] Incorrect word (swap a word) → reported as error at the right position.
- [ ] Additional word (insert a word) → reported or tolerated per product rule; note which.
- [ ] Continuous recitation of 3+ verses without pausing → alignment keeps up.
- [ ] Silence / background noise → explicit "no speech" feedback, no hang.
- [ ] Airplane mode kept ON for all of the above.
- [ ] **Privacy check:** with airplane mode ON and mobile data OFF, the recitation works;
      then disable airplane mode, enable mobile data only, and confirm in a proxy/`adb logcat`
      that no audio upload is attempted during recitation (`*.webm` POST to Supabase storage
      must not appear).

## 7. Corrupted / missing bundle behaviour

- [ ] (Optional, destructive to the install only) truncate one bundled asset with
      `adb shell run-as` if debuggable, or reinstall a build with a deliberately renamed
      asset, then open Tilawa.
- [ ] App shows a clear, actionable error ("offline assets damaged — reinstall") instead of
      silently falling back to the network or spinning forever.

## 8. Force-stop, restart, data preservation

- [ ] Airplane mode ON → `am force-stop` → cold start → reader and Tilawa both still work.
- [ ] Note progress (page/surah), open a different page, force-stop, restart:
      progress persisted (locally, offline).
- [ ] Queue something offline that must sync (e.g. bookmark or reading progress), then
      disable airplane mode and confirm it reaches Supabase exactly once (no duplicate row;
      check `quran_bookmarks`/`app_snapshots` row counts before and after).

## 9. Background behaviour and audio

- [ ] Start a supported recitation/playback, press Home → audio continues as designed;
      notification shows the session with pause/resume.
- [ ] Lock the screen → audio continues; unlock → UI state matches the audio.
- [ ] Pause from the notification, resume, then stop; no orphaned foreground service
      (`adb shell dumpsys activity services app.thimar.quran` shows nothing after stop).
- [ ] Doze test: screen off 30+ minutes with the app backgrounded → return and confirm the
      app resumes without a crash and does not claim continuous background work that
      Android throttles.
- [ ] Notification permission denied path: update checks still work, no crash.
- [ ] Battery-optimisation exemption prompt (if present) explains itself and is optional.

## 10. Settings and session after everything

- [ ] Signed-in account unchanged; no re-login forced.
- [ ] Reciter, tier, tajweed, theme and notification settings all preserved.
- [ ] Quran bookmarks and reading position preserved across force-stop and offline.
- [ ] Uninstall/reinstall with the same build: data-loss expectation documented.

## 11. Evidence to attach

- [ ] `adb logcat -d > logcat-<step>.txt` per section.
- [ ] Screen recordings for §4, §5, §6, §9.
- [ ] Screenshots of version info, offline reader, both tiers, recitation verdicts.
- [ ] Row counts before/after for the sync check in §8.

## Verdict rule

The release ships only if §3, §4, §5, §6 (all five recitation cases), §7, §8 and §9 pass on a
real device. Any untested box stays UNTESTED in the final report — a desktop browser run is
not evidence for any item in this document.
