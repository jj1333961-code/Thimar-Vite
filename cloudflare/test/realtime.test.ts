import { describe, expect, it } from "vitest";
import {
  clampTurnTtl,
  isSessionDescription,
  isSfuSessionId,
  readTrackList,
  sfuUpstreamBody,
  sfuUpstreamMethod,
  sfuUpstreamPath,
} from "../src/realtime";
import type { Env } from "../src/env";

const env = { CF_REALTIME_APP_ID: "app-1" } as Env;
const offer = { type: "offer" as const, sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" };

describe("TURN TTL", () => {
  it("يحصر المدة بين 5 دقائق و24 ساعة", () => {
    expect(clampTurnTtl(60)).toBe(300);
    expect(clampTurnTtl(900)).toBe(900);
    expect(clampTurnTtl(999_999)).toBe(86_400);
    expect(clampTurnTtl("bad")).toBe(3600);
    expect(clampTurnTtl(undefined)).toBe(3600);
  });
});

describe("SFU upstream mapping", () => {
  it("يبني المسارات الصحيحة لكل عملية", () => {
    expect(sfuUpstreamPath(env, { kind: "new-session" })).toBe("/apps/app-1/sessions/new");
    expect(sfuUpstreamPath(env, { kind: "new-tracks", sessionId: "s1", tracks: [] })).toBe(
      "/apps/app-1/sessions/s1/tracks/new",
    );
    expect(sfuUpstreamPath(env, { kind: "renegotiate", sessionId: "s1", sessionDescription: offer })).toBe(
      "/apps/app-1/sessions/s1/renegotiate",
    );
    expect(sfuUpstreamPath(env, { kind: "close-tracks", sessionId: "s1", tracks: [{ mid: "0" }] })).toBe(
      "/apps/app-1/sessions/s1/tracks/close",
    );
  });

  it("يستخدم POST للإنشاء و PUT للتعديل", () => {
    expect(sfuUpstreamMethod({ kind: "new-session" })).toBe("POST");
    expect(sfuUpstreamMethod({ kind: "new-tracks", sessionId: "s1", tracks: [] })).toBe("POST");
    expect(sfuUpstreamMethod({ kind: "renegotiate", sessionId: "s1", sessionDescription: offer })).toBe("PUT");
    expect(sfuUpstreamMethod({ kind: "close-tracks", sessionId: "s1", tracks: [] })).toBe("PUT");
  });

  it("لا يرسل جسمًا لعملية إنشاء بلا SDP", () => {
    expect(sfuUpstreamBody({ kind: "new-session" })).toEqual({});
    expect(sfuUpstreamBody({ kind: "new-session", sessionDescription: offer })).toEqual({ sessionDescription: offer });
  });
});

describe("تحقق مدخلات SFU", () => {
  it("يقبل عرضًا/جوابًا صالحًا ويرفض غير ذلك", () => {
    expect(isSessionDescription(offer)).toBe(true);
    expect(isSessionDescription({ type: "answer", sdp: "v=0" })).toBe(true);
    expect(isSessionDescription({ type: "pranswer", sdp: "v=0" })).toBe(false);
    expect(isSessionDescription({ type: "offer", sdp: "" })).toBe(false);
    expect(isSessionDescription(null)).toBe(false);
    expect(isSessionDescription({ type: "offer", sdp: "x".repeat(200_001) })).toBe(false);
  });

  it("يتحقق من معرّفات الجلسات", () => {
    expect(isSfuSessionId("session-abcdefgh")).toBe(true);
    expect(isSfuSessionId("short")).toBe(false);
    expect(isSfuSessionId("bad/slash/value")).toBe(false);
    expect(isSfuSessionId(42)).toBe(false);
  });

  it("يقبل مسارات محلية وبعيدة صحيحة فقط", () => {
    expect(readTrackList([{ location: "local", mid: "0", trackName: "u.audio" }])).toEqual([
      { location: "local", mid: "0", trackName: "u.audio" },
    ]);
    expect(
      readTrackList([{ location: "remote", sessionId: "session-abcdefgh", trackName: "peer.video" }]),
    ).toEqual([{ location: "remote", sessionId: "session-abcdefgh", trackName: "peer.video" }]);
    expect(readTrackList([])).toBeNull();
    expect(readTrackList([{ location: "local", mid: "0", trackName: "bad name" }])).toBeNull();
    expect(readTrackList([{ location: "remote", sessionId: "x", trackName: "peer.audio" }])).toBeNull();
    expect(readTrackList([{ location: "elsewhere", trackName: "peer.audio" }])).toBeNull();
    expect(readTrackList("nope")).toBeNull();
  });
});
