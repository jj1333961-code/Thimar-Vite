import { useCallback, useEffect, useRef, useState } from "react";
import { CloudflareSfuClient, SfuError, parseSfuTrackName, sfuTrackName, type SfuSessionHandle } from "../../lib/sfu";
import { CALL_MAX_PARTICIPANTS, CALL_SIGNALING_BASE } from "../../lib/callConfig";
import { closeCall, getIceServers, getLocalStream, createChannel, sendSignal, subscribeChannel, userChannelName } from "../../lib/call";
import { RoomSignaling, type CallSignalingHandle } from "../../lib/callSignaling";
import { cachedSessionToken, ensureSessionToken } from "../../lib/sessionStore";
import type { CallMode, CallSignal } from "../../lib/callTypes";
import { loadAccounts } from "../../lib/auth";
import { Icon } from "./ui";
import "./CallConnect.css";

/**
 * مكالمة جماعية حقيقية عبر Cloudflare Realtime SFU (حتى 10 مشاركين).
 *
 * - كل مشارك يرفع مساراته مرة واحدة إلى SFU، ويستقبل نسخًا من الآخرين.
 * - WebSocket يحمل الإشارات والحضور فقط؛ لا وسائط فيه إطلاقًا.
 * - إعادة الاتصال: ناقل الإشارات يعيد نفسه تلقائيًا، وإن سقط اتصال SFU
 *   تُبنى جلسة جديدة وتُعاد المشاركة دون إخراج المستخدم من المكالمة.
 */

type Props = {
  selfId: string;
  selfName: string;
  roomId: string;
  title: string;
  mode: CallMode;
  incoming?: boolean;
  /** أعضاء يُرسل إليهم إشعار المكالمة عند البدء. */
  inviteUserIds?: string[];
  onClose: () => void;
  onLog: (text: string) => void;
};

type RemoteTile = {
  userId: string;
  stream: MediaStream;
  sessionId: string;
  tracks: Array<{ trackName: string; kind: "audio" | "video" }>;
};

const MAX_RECONNECT = 5;

export default function GroupCallOverlay({
  selfId,
  selfName,
  roomId,
  title,
  mode,
  incoming,
  inviteUserIds = [],
  onClose,
  onLog,
}: Props) {
  const [status, setStatus] = useState<"connecting" | "active" | "ended" | "error">("connecting");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(incoming ? "جارٍ الانضمام إلى المكالمة الجماعية…" : "جارٍ تجهيز الميكروفون…");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(mode === "audio");
  const [participants, setParticipants] = useState<string[]>([selfId]);
  const [tiles, setTiles] = useState<RemoteTile[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<SfuSessionHandle | null>(null);
  const signalingRef = useRef<CallSignalingHandle | null>(null);
  const participantsRef = useRef<string[]>([selfId]);
  const tilesRef = useRef<Map<string, RemoteTile>>(new Map());
  const publicationsRef = useRef<Map<string, { sessionId: string; tracks: Array<{ trackName: string; kind: "audio" | "video" }> }>>(new Map());
  const midOwnerRef = useRef<Map<string, string>>(new Map());
  const inviteChannelsRef = useRef<Array<ReturnType<typeof createChannel>>>([]);
  const endedRef = useRef(false);
  const sfuRef = useRef<CloudflareSfuClient | null>(null);
  const operationsRef = useRef<Promise<unknown>>(Promise.resolve());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const secondsRef = useRef(0);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const namesRef = useRef<Map<string, string>>(new Map());

  const displayName = useCallback((userId: string) => {
    if (userId === selfId) return `${selfName} (أنت)`;
    return namesRef.current.get(userId) ?? `مشارك ${userId.slice(0, 4)}`;
  }, [selfId, selfName]);

  /** كل عمليات SFU تُسلسَل لكل جلسة، كما توصي وثائق Cloudflare. */
  const serialize = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = operationsRef.current.then(operation, operation);
    operationsRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const upsertTile = useCallback((tile: RemoteTile) => {
    tilesRef.current.set(tile.userId, tile);
    setTiles([...tilesRef.current.values()]);
  }, []);

  const removeTile = useCallback((userId: string) => {
    tilesRef.current.delete(userId);
    setTiles([...tilesRef.current.values()]);
  }, []);

  const detachRemote = useCallback((userId: string) => {
    const existing = tilesRef.current.get(userId);
    existing?.stream.getTracks().forEach((track) => track.stop());
    removeTile(userId);
  }, [removeTile]);

  const finish = useCallback((reason?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const session = sessionRef.current;
    const sfu = sfuRef.current;
    if (session && sfu) {
      const mids = pcRef.current
        ? pcRef.current.getTransceivers().map((transceiver) => transceiver.mid).filter((mid): mid is string => Boolean(mid))
        : [];
      if (mids.length) void sfu.closeTracks(session, mids).catch(() => undefined);
    }
    signalingRef.current?.send({ kind: "sfu-unpublish", from: selfId, callId: roomId, trackNames: [] });
    signalingRef.current?.send({ kind: "hangup", from: selfId, callId: roomId });
    signalingRef.current?.close();
    signalingRef.current = null;
    inviteChannelsRef.current.forEach((channel) => {
      try { channel.unsubscribe(); } catch { /* ignore */ }
    });
    inviteChannelsRef.current = [];
    closeCall(pcRef.current, localStreamRef.current);
    pcRef.current = null;
    localStreamRef.current = null;
    tilesRef.current.forEach((tile) => tile.stream.getTracks().forEach((track) => track.stop()));
    tilesRef.current.clear();
    setTiles([]);
    setStatus("ended");
    const duration = secondsRef.current;
    const durationText = duration > 0
      ? ` (المدة ${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")})`
      : "";
    onLog(`${mode === "audio" ? "مكالمة صوتية جماعية" : "مكالمة فيديو جماعية"} — ${reason ?? "انتهت المكالمة"}${durationText}`);
    setTimeout(() => onClose(), 900);
  }, [mode, onClose, onLog, roomId, selfId]);

  const handleSfuError = useCallback((err: unknown) => {
    if (endedRef.current) return;
    if (err instanceof SfuError) {
      if (err.code === "ROOM_FULL") setNotice(`المكالمة ممتلئة (الحد ${CALL_MAX_PARTICIPANTS} مشاركين).`);
      else if (err.code === "SFU_NOT_CONFIGURED") setError("المكالمات الجماعية غير مفعّلة على الخادم بعد.");
      else if (err.code === "NOT_A_PARTICIPANT") setError("لم تُتحقق عضويتك في هذه المحادثة.");
      else if (err.code === "AUTH_REQUIRED") {
        /* عميل SFU يجدّد الرمز ويعيد المحاولة تلقائيًا؛ وصول الخطأ هنا يعني
           تعذّر التجديد (شبكة) لا انتهاء الجلسة. */
        setError(cachedSessionToken()
          ? "تعذّر تجديد جلستك الأمنية الآن (غالبًا بسبب الشبكة). أعد المحاولة بعد لحظات."
          : "لا توجد جلسة دخول على هذا الجهاز. سجّل الدخول من جديد.");
      }
      else setError(err.message);
    } else {
      setError(err instanceof Error ? err.message : "تعذّر الاتصال بخادم الوسائط.");
    }
  }, []);

  /** ينشئ PeerConnection جديدة ويرفع مساراتنا ويعلنها. */
  const startMediaSession = useCallback(async () => {
    const sfu = sfuRef.current;
    if (!sfu || endedRef.current) return;
    const previous = pcRef.current;
    closeCall(previous, null);
    const localStream = localStreamRef.current;
    if (!localStream) throw new Error("لا يوجد مسار وسائط محلي.");

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "max-bundle",
      iceCandidatePoolSize: 2,
    });
    pcRef.current = pc;

    localStream.getTracks().forEach((track) => {
      pc.addTransceiver(track, { direction: "sendonly", streams: [localStream] });
    });

    pc.ontrack = (event) => {
      const mid = event.transceiver.mid ?? "";
      const userId = midOwnerRef.current.get(mid) ?? "";
      if (!userId || userId === selfId) return;
      const session = publicationsRef.current.get(userId);
      const stream = tilesRef.current.get(userId)?.stream ?? new MediaStream();
      if (!stream.getTracks().some((item) => item.id === event.track.id)) stream.addTrack(event.track);
      upsertTile({
        userId,
        stream,
        sessionId: session?.sessionId ?? "",
        tracks: session?.tracks ?? [],
      });
    };

    const ids = pc.getTransceivers().map((transceiver) => transceiver.mid ?? "");
    if (ids.some((id) => !id)) {
      // mid يُسنَد بعد setLocalDescription الأول.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    }

    const { session } = await sfu.newSession();
    sessionRef.current = session;

    const localTracks = pc.getTransceivers()
      .map((transceiver) => {
        const track = transceiver.sender.track;
        if (!track || !transceiver.mid) return null;
        return {
          location: "local" as const,
          mid: transceiver.mid,
          trackName: sfuTrackName(selfId, track.kind === "video" ? "video" : "audio"),
        };
      })
      .filter((item): item is { location: "local"; mid: string; trackName: string } => Boolean(item));

    const offer = pc.localDescription ?? (await pc.createOffer());
    const published = await sfu.addTracks(session, localTracks, offer);
    if (published.tracks) {
      for (const item of published.tracks) {
        if (item.mid) midOwnerRef.current.set(item.mid, selfId);
      }
    }
    if (published.sessionDescription) await pc.setRemoteDescription(published.sessionDescription);

    const announcements = localTracks.map((track) => ({
      trackName: track.trackName,
      kind: track.trackName.endsWith(".video") ? ("video" as const) : ("audio" as const),
    }));
    signalingRef.current?.send({
      kind: "sfu-publish",
      from: selfId,
      callId: roomId,
      sessionId: session.sessionId,
      tracks: announcements,
    });

    // من كان يشارك قبل إعادة الاتصال: نسحب مساراته إلى الجلسة الجديدة.
    for (const [userId, publication] of publicationsRef.current) {
      if (userId === selfId) continue;
      await pullRemote(userId, publication.sessionId, publication.tracks);
    }

    reconnectAttemptRef.current = 0;
    setStatus("active");
    setNotice("");
    if (localVideoRef.current && mode === "video") {
      localVideoRef.current.srcObject = localStream;
      void localVideoRef.current.play().catch(() => undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomId, selfId, upsertTile]);

  const pullRemote = useCallback(async (
    userId: string,
    sessionId: string,
    tracks: Array<{ trackName: string; kind: "audio" | "video" }>,
  ) => {
    const sfu = sfuRef.current;
    const session = sessionRef.current;
    const pc = pcRef.current;
    if (!sfu || !session || !pc || endedRef.current || userId === selfId) return;
    publicationsRef.current.set(userId, { sessionId, tracks });
    await serialize(async () => {
      const response = await sfu.addTracks(
        session,
        tracks.map((track) => ({ location: "remote" as const, sessionId, trackName: track.trackName })),
      );
      if (response.tracks) {
        for (const item of response.tracks) {
          if (!item.mid) continue;
          midOwnerRef.current.set(item.mid, parseSfuTrackName(item.trackName ?? "")?.userId ?? userId);
        }
      }
      if (response.sessionDescription) {
        await pc.setRemoteDescription(response.sessionDescription);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sfu.renegotiate(session, answer);
      }
    });
  }, [selfId, serialize]);

  const restartMedia = useCallback(() => {
    if (endedRef.current) return;
    reconnectAttemptRef.current += 1;
    if (reconnectAttemptRef.current > MAX_RECONNECT) {
      setError("تعذّر استئناف المكالمة بعد انقطاع الشبكة.");
      finish("انقطع الاتصال");
      return;
    }
    setStatus("connecting");
    setNotice("نعيد الاتصال بخادم الوسائط…");
    serialize(() => startMediaSession()).catch((err) => {
      handleSfuError(err);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        restartMedia();
      }, Math.min(15_000, 3_000 * reconnectAttemptRef.current));
    });
  }, [finish, handleSfuError, serialize, startMediaSession]);

  const handleSignal = useCallback((signal: CallSignal) => {
    if (endedRef.current) return;
    if (signal.kind === "sfu-publish") {
      if (signal.from === selfId) return;
      publicationsRef.current.set(signal.from, { sessionId: signal.sessionId, tracks: signal.tracks });
      void pullRemote(signal.from, signal.sessionId, signal.tracks).catch(handleSfuError);
      return;
    }
    if (signal.kind === "sfu-unpublish") {
      detachRemote(signal.from);
      return;
    }
    if (signal.kind === "hangup" || signal.kind === "decline") {
      detachRemote(signal.from);
    }
  }, [detachRemote, handleSfuError, pullRemote, selfId]);

  /* التهيئة: إشارات + وسائط + دعوات. */
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        namesRef.current = new Map(loadAccounts().map((account) => [account.id, account.fullName]));
      } catch { /* الأسماء للعرض فقط. */ }

      if (!CALL_SIGNALING_BASE) {
        setError("المكالمات الجماعية تحتاج عنوان عامل Cloudflare (VITE_CALL_WORKER_URL).");
        setStatus("error");
        return;
      }
      /* نضمن رمز جلسة صالحًا (يُجدّد تلقائيًا إن كان قريب الانتهاء). */
      const sessionToken = await ensureSessionToken();
      if (!sessionToken) {
        throw new Error(cachedSessionToken()
          ? "تعذّر تجديد جلستك الأمنية الآن (غالبًا بسبب الشبكة). أعد المحاولة بعد لحظات."
          : "لا توجد جلسة دخول على هذا الجهاز. سجّل الدخول من جديد.");
      }

      sfuRef.current = new CloudflareSfuClient({ roomId, sessionToken });
      const signaling = new RoomSignaling({
        roomId,
        selfId,
        token: sessionToken,
        onSignal: handleSignal,
        onPresence: (uids) => {
          if (disposed || endedRef.current) return;
          participantsRef.current = uids.includes(selfId) ? uids : [...uids, selfId];
          setParticipants(participantsRef.current);
          if (uids.length > CALL_MAX_PARTICIPANTS) {
            setNotice(`المكالمة ممتلئة (الحد ${CALL_MAX_PARTICIPANTS} مشاركين).`);
            finish("المكالمة ممتلئة");
            return;
          }
          for (const tile of [...tilesRef.current.keys()]) {
            if (!uids.includes(tile)) detachRemote(tile);
          }
        },
        onState: (state) => {
          if (state === "open") {
            // قد تكون إشارات النشر فُقدت أثناء الانقطاع: نعلن من جديد.
            const publication = publicationsRef.current.get(selfId);
            const session = sessionRef.current;
            if (publication && session) {
              signalingRef.current?.send({
                kind: "sfu-publish",
                from: selfId,
                callId: roomId,
                sessionId: session.sessionId,
                tracks: publication.tracks,
              });
            }
          }
        },
      });
      signalingRef.current = signaling;
      await signaling.connect();

      const stream = await getLocalStream(mode);
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      if (mode === "video" && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => undefined);
      }

      // دعوة بقية أعضاء المحادثة إلى الغرفة (الإشارة فقط، بلا وسائط).
      for (const memberId of inviteUserIds) {
        if (memberId === selfId) continue;
        const channel = createChannel(userChannelName(memberId), selfId, () => undefined);
        inviteChannelsRef.current.push(channel);
        await subscribeChannel(channel);
        void sendSignal(channel, {
          kind: "invite",
          group: true,
          from: selfId,
          fromName: selfName,
          mode,
          callId: roomId,
        });
      }

      await startMediaSession();
    })().catch((err) => {
      if (disposed) return;
      handleSfuError(err);
      setStatus("error");
    });

    return () => {
      disposed = true;
      endedRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      signalingRef.current?.close();
      inviteChannelsRef.current.forEach((channel) => {
        try { channel.unsubscribe(); } catch { /* ignore */ }
      });
      closeCall(pcRef.current, localStreamRef.current);
      tilesRef.current.forEach((tile) => tile.stream.getTracks().forEach((track) => track.stop()));
      tilesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, selfId]);

  /* مراقبة اتصال SFU واستئنافه. */
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc) return;
    const onState = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") restartMedia();
    };
    pc.addEventListener("connectionstatechange", onState);
    const goOnline = () => {
      if (pcRef.current?.connectionState !== "connected") restartMedia();
    };
    window.addEventListener("online", goOnline);
    return () => {
      pc.removeEventListener("connectionstatechange", onState);
      window.removeEventListener("online", goOnline);
    };
  }, [restartMedia, status]);

  useEffect(() => {
    if (status !== "active") return;
    const timer = setInterval(() => {
      secondsRef.current += 1;
      setSeconds((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setCameraOff(next);
  };

  const label = status === "active"
    ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : status === "ended"
      ? "انتهت المكالمة"
      : "جارٍ الربط…";

  return (
    <div className="call-overlay group-call">
      <div className="group-call-shell">
        <header className="group-call-head">
          <div>
            <strong>{title}</strong>
            <span>{mode === "audio" ? "مكالمة صوتية جماعية" : "مكالمة فيديو جماعية"} • {label}</span>
          </div>
          <span className="group-call-count">
            <Icon name="group" size={16} /> {Math.min(participants.length, CALL_MAX_PARTICIPANTS)}/{CALL_MAX_PARTICIPANTS}
          </span>
        </header>

        <div className={`group-call-grid ${mode === "audio" ? "audio" : ""}`}>
          <section className="group-call-tile local">
            {mode === "video" ? (
              <video ref={localVideoRef} autoPlay playsInline muted />
            ) : (
              <div className="group-call-audio-avatar"><Icon name="mic" size={22} /></div>
            )}
            <footer>{selfName} (أنت){muted ? " • مكتوم" : ""}</footer>
          </section>

          {tiles.map((tile) => (
            <section key={tile.userId} className="group-call-tile">
              {mode === "video" ? (
                <ParticipantVideo stream={tile.stream} />
              ) : (
                <div className="group-call-audio-avatar"><Icon name="phone" size={22} /></div>
              )}
              <footer>{displayName(tile.userId)}</footer>
            </section>
          ))}

          {participants
            .filter((uid) => uid !== selfId && !tiles.some((tile) => tile.userId === uid))
            .map((uid) => (
              <section key={`waiting-${uid}`} className="group-call-tile waiting">
                <div className="group-call-audio-avatar"><Icon name="group" size={22} /></div>
                <footer>{displayName(uid)} • يربط…</footer>
              </section>
            ))}
        </div>

        {error ? <p className="call-error">{error}</p> : null}
        {!error && notice ? <p className="group-call-notice">{notice}</p> : null}

        <div className="call-actions bottom group-call-actions">
          <button type="button" className={`icon-button ${muted ? "active" : ""}`} onClick={toggleMute} aria-label="كتم الصوت">
            <Icon name="mic" size={18} />
          </button>
          {mode === "video" ? (
            <button type="button" className={`icon-button ${cameraOff ? "active" : ""}`} onClick={toggleCamera} aria-label={cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا"}>
              <Icon name="camera" size={18} />
            </button>
          ) : null}
          <button type="button" className="danger-button" onClick={() => finish()} disabled={status === "ended"}>
            <Icon name="phone" size={18} /> مغادرة
          </button>
        </div>
      </div>
    </div>
  );
}

function ParticipantVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}
