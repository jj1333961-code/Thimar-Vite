import test from "node:test";
import assert from "node:assert/strict";
import { getMediaStreamChecks, getRecitationDiagnosticStatus } from "../src/lib/adminDiagnosticsCore.mjs";

test("recitation diagnostic status uses clear accuracy bands", () => {
  assert.equal(getRecitationDiagnosticStatus(100), "excellent");
  assert.equal(getRecitationDiagnosticStatus(90), "excellent");
  assert.equal(getRecitationDiagnosticStatus(89), "review");
  assert.equal(getRecitationDiagnosticStatus(70), "review");
  assert.equal(getRecitationDiagnosticStatus(69), "retry");
  assert.equal(getRecitationDiagnosticStatus(0), "retry");
  assert.equal(getRecitationDiagnosticStatus(101), "invalid");
  assert.equal(getRecitationDiagnosticStatus(Number.NaN), "invalid");
});

test("media diagnostics require both live audio and video tracks", () => {
  const track = (readyState, enabled = true) => ({ readyState, enabled });
  const stream = (audio, video) => ({
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
  });
  assert.deepEqual(getMediaStreamChecks(null), { audio: false, video: false, ready: false });
  assert.deepEqual(getMediaStreamChecks(stream([track("live")], [track("live")])), { audio: true, video: true, ready: true });
  assert.deepEqual(getMediaStreamChecks(stream([track("ended")], [track("live")])), { audio: false, video: true, ready: false });
  assert.deepEqual(getMediaStreamChecks(stream([track("live")], [track("live", false)])), { audio: true, video: false, ready: false });
});
