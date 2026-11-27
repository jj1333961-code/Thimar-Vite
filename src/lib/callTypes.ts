/**
 * أنواع إشارات المكالمات المشتركة بين ناقل WebSocket وSupabase Realtime
 * ومكوّنات المكالمة. منفصلة في ملف خاص حتى لا تنشأ دورة استيراد بين
 * `call.ts` و`callSignaling.ts`.
 */

export type CallMode = "audio" | "video";

export type SfuTrackAnnouncement = {
  trackName: string;
  kind: "audio" | "video";
};

export type CallSignal =
  | { kind: "invite"; from: string; fromName: string; mode: CallMode; callId: string; group?: boolean }
  | { kind: "accept"; from: string; callId: string }
  | { kind: "decline"; from: string; callId: string }
  | { kind: "offer"; from: string; callId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; callId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; callId: string; candidate: RTCIceCandidateInit }
  | { kind: "hangup"; from: string; callId: string }
  | { kind: "request-offer"; from: string; callId: string }
  | { kind: "screen-share"; from: string; callId: string; active: boolean }
  | { kind: "chat"; from: string; callId: string; id: string; text: string; at: number }
  | {
      kind: "sfu-publish";
      from: string;
      callId: string;
      sessionId: string;
      tracks: SfuTrackAnnouncement[];
    }
  | { kind: "sfu-unpublish"; from: string; callId: string; trackNames: string[] };

/** ما يرسله ناقل الإشارات إلى المكوّن بعد إزالة غلاف النقل. */
export type CallSignalHandler = (signal: CallSignal) => void;

export type SignalingState = "connecting" | "open" | "reconnecting" | "closed";
