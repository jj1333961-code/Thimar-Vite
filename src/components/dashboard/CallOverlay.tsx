import { useEffect, useRef, useState } from "react";
import {
  getIceServers,
  callChannelName,
  closeCall,
  createChannel,
  subscribeChannel,
  getLocalStream,
  sendSignal,
  callServer,
  type CallMode,
  type CallSignal,
} from "../../lib/call";
import { Icon } from "./ui";

type Props = {
  selfId: string;
  selfName: string;
  peerId: string;
  peerName: string;
  mode: CallMode;
  callId?: string;
  incoming?: { callId: string; fromName: string };
  onClose: () => void;
  onLog: (text: string) => void;
};

/**
 * مكالمة صوتية/فيديو حقيقية بين مستخدمين عبر الإنترنت (WebRTC).
 * الإشارات تُتبادل عبر قناة Supabase Realtime خاصة بالمكالمة.
 */
export default function CallOverlay({ selfId, selfName, peerId, peerName, mode, callId: givenCallId, incoming, onClose, onLog }: Props) {
  const callId = useRef(incoming?.callId ?? givenCallId ?? `call-${Math.random().toString(36).slice(2, 10)}`).current;
  const isCaller = !incoming;
  const [status, setStatus] = useState<"connecting" | "ringing" | "active" | "ended" | "error">("connecting");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof createChannel> | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const endedRef = useRef(false);
  const ringbackCtxRef = useRef<AudioContext | null>(null);
  const ringbackTimerRef = useRef<number | null>(null);

  const startRingback = () => {
    if (ringbackCtxRef.current) return;
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      ringbackCtxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      gain.connect(ctx.destination);
      const burst = () => {
        if (!ringbackCtxRef.current) return;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.frequency.value = 440;
        o2.frequency.value = 480;
        o1.connect(gain);
        o2.connect(gain);
        const now = ctx.currentTime;
        o1.start(now);
        o2.start(now);
        o1.stop(now + 1.0);
        o2.stop(now + 1.0);
      };
      burst();
      ringbackTimerRef.current = window.setInterval(burst, 3000);
    } catch {
      /* تجاهل — المتصفح قد يمنع الصوت تلقائيًا */
    }
  };
  const stopRingback = () => {
    if (ringbackTimerRef.current) {
      clearInterval(ringbackTimerRef.current);
      ringbackTimerRef.current = null;
    }
    if (ringbackCtxRef.current) {
      ringbackCtxRef.current.close().catch(() => undefined);
      ringbackCtxRef.current = null;
    }
  };

  const finish = (reason?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopRingback();
    closeCall(pcRef.current, localStreamRef.current);
    pcRef.current = null;
    localStreamRef.current = null;
    setStatus("ended");
    onLog(reason ? `${mode === "audio" ? "مكالمة صوتية" : "مكالمة فيديو"} — ${reason}` : "انتهت المكالمة");
    setTimeout(() => onClose(), 900);
  };

  const ensurePeer = async () => {
    if (pcRef.current) return pcRef.current;
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    const stream = await getLocalStream(mode);
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play().catch(() => undefined);
    }
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        void remoteVideoRef.current.play().catch(() => undefined);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        void sendSignal(channelRef.current, {
          kind: "ice",
          from: selfId,
          callId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("active");
        void callServer("connected", { callerId: selfId, callId });
      }
      if (pc.connectionState === "connecting") {
        void callServer("connecting", { callerId: selfId, callId });
      }
      if (pc.connectionState === "failed") {
        void callServer("failed", { callerId: selfId, callId, reason: "ice_failed" });
        setError("فشل الاتصال بين الطرفين. تحقق من الشبكة.");
        finish("فشل الاتصال");
      }
      if (pc.connectionState === "disconnected") {
        // محاولة إعادة اتصال محدودة (bounded) قبل الإنهاء.
        setTimeout(() => {
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            void callServer("failed", { callerId: selfId, callId, reason: "disconnected_timeout" });
            setError("انقطع الاتصال بين الطرفين. تحقق من الشبكة.");
            finish("انقطع الاتصال");
          }
        }, 8000);
      }
    };
    return pc;
  };

  const handleSignal = async (signal: CallSignal) => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      if (signal.kind === "offer") {
        offerRef.current = signal.sdp;
        setStatus("ringing");
        return;
      }
      if (signal.kind === "accept" && isCaller) {
        // نعيد إرسال العرض بعد القبول حتى لا يضيع قبل انضمام الطرف الآخر.
        if (localOfferRef.current) {
          await sendSignal(channel, { kind: "offer", from: selfId, callId, sdp: localOfferRef.current });
        }
        setStatus("connecting");
        return;
      }
      if (signal.kind === "answer" && isCaller) {
        const pc = await ensurePeer();
        await pc.setRemoteDescription(signal.sdp);
        while (pendingIce.current.length) {
          const candidate = pendingIce.current.shift();
          if (candidate) await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        setStatus("active");
        return;
      }
      if (signal.kind === "ice") {
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate).catch(() => undefined);
        } else {
          pendingIce.current.push(signal.candidate);
        }
        return;
      }
      if (signal.kind === "decline") {
        setError(`${signal.from === peerId ? peerName : "الطرف الآخر"} رفض المكالمة.`);
        finish("رفض الطرف الآخر المكالمة");
        return;
      }
      if (signal.kind === "hangup") {
        finish("أغلق الطرف الآخر المكالمة");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ في إشارات المكالمة");
    }
  };

  /* الإنشاء والانضمام */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const channel = createChannel(callChannelName(callId), selfId, (signal) => {
        void handleSignal(signal);
      });
      channelRef.current = channel;
      await subscribeChannel(channel);
      try {
        if (isCaller) {
          const pc = await ensurePeer();
          const offer = await pc.createOffer();
          localOfferRef.current = offer;
          await pc.setLocalDescription(offer);
          await sendSignal(channel, {
            kind: "invite",
            from: selfId,
            fromName: selfName,
            mode,
            callId,
          });
          await sendSignal(channel, { kind: "offer", from: selfId, callId, sdp: offer });
          if (!disposed) setStatus("ringing");
        } else {
          setStatus("connecting");
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "تعذّر بدء المكالمة. اسمح بالوصول للميكروفون والكاميرا.");
          setStatus("error");
        }
      }
    })();
    return () => {
      disposed = true;
      endedRef.current = true;
      stopRingback();
      closeCall(pcRef.current, localStreamRef.current);
      try { channelRef.current?.unsubscribe(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* نغمة الاتصال (ringback) للنّداء فقط، مع إيقافها عند أي تغيير في الحالة */
  useEffect(() => {
    if (status === "ringing" && isCaller) startRingback();
    else stopRingback();
    return () => stopRingback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isCaller]);

  /* مهلة ringing: 45 ثانية ثم "لم يرد" */
  useEffect(() => {
    if (status !== "ringing" || !isCaller) return;
    const timer = setTimeout(() => {
      void callServer("missed", { callerId: selfId, callId });
      setError("لم يرد الطرف الآخر.");
      finish("انتهت المهلة");
    }, 45000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isCaller]);

  /* الرد على مكالمة واردة */
  const acceptIncoming = async () => {
    const channel = channelRef.current;
    const offer = offerRef.current;
    if (!channel || !offer) {
      setError("لم تصل بيانات المكالمة بعد. انتظر لحظة ثم أعد المحاولة.");
      return;
    }
    const serverResult = await callServer("accept", { callerId: selfId, callId });
    if (serverResult?.error) {
      if (serverResult.error === "EXPIRED") setError("انتهت صلاحية المكالمة.");
      else if (serverResult.error === "DUPLICATE_OR_INVALID_ACCEPT") setError("تم قبول المكالمة من جهاز آخر.");
      else setError(`تعذّر قبول المكالمة: ${serverResult.error}`);
      finish("فشل القبول");
      return;
    }
    try {
      const pc = await ensurePeer();
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      while (pendingIce.current.length) {
        const candidate = pendingIce.current.shift();
        if (candidate) await pc.addIceCandidate(candidate).catch(() => undefined);
      }
      await sendSignal(channel, { kind: "accept", from: selfId, callId });
      await sendSignal(channel, { kind: "answer", from: selfId, callId, sdp: answer });
      setStatus("active");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الرد على المكالمة.");
      setStatus("error");
    }
  };

  const declineIncoming = () => {
    void callServer("reject", { callerId: selfId, callId });
    if (channelRef.current) {
      void sendSignal(channelRef.current, { kind: "decline", from: selfId, callId });
    }
    finish("رفضت المكالمة");
  };

  const hangUp = () => {
    if (status === "ringing" && isCaller) {
      void callServer("cancel", { callerId: selfId, callId });
    } else {
      void callServer("end", { callerId: selfId, callId, reason: "hangup" });
    }
    if (channelRef.current) {
      void sendSignal(channelRef.current, { kind: "hangup", from: selfId, callId });
    }
    finish();
  };

  useEffect(() => {
    if (status !== "active") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
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

  const label =
    status === "ringing"
      ? isCaller ? "جارٍ الاتصال…" : "مكالمة واردة"
      : status === "connecting"
        ? "جارٍ الربط عبر الإنترنت…"
        : status === "active"
          ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
          : status === "ended"
            ? "انتهت المكالمة"
            : "تعذّرت المكالمة";

  return (
    <div className="call-overlay">
      <div className="call-stage">
        <video
          ref={remoteVideoRef}
          className={`call-remote ${mode === "audio" ? "audio-only" : ""}`}
          autoPlay
          playsInline
        />
        {mode === "video" ? (
          <video ref={localVideoRef} className="call-local" autoPlay playsInline muted />
        ) : (
          <audio ref={localVideoRef as unknown as React.RefObject<HTMLAudioElement>} autoPlay />
        )}
        <div className="call-top">
          <strong>{peerName}</strong>
          <span>{mode === "audio" ? "مكالمة صوتية" : "مكالمة فيديو"} • {label}</span>
        </div>
        {status === "ringing" && !isCaller ? (
          <div className="call-incoming">
            <p>مكالمة واردة من {incoming?.fromName ?? peerName}</p>
            <div className="call-actions">
              <button type="button" className="success-button" onClick={() => void acceptIncoming()}>
                <Icon name={mode === "audio" ? "phone" : "video"} size={18} /> قبول
              </button>
              <button type="button" className="danger-button" onClick={declineIncoming}>رفض</button>
            </div>
          </div>
        ) : null}
        {error ? <p className="call-error">{error}</p> : null}
        <div className="call-actions bottom">
          <button type="button" className={`icon-button ${muted ? "active" : ""}`} onClick={toggleMute} aria-label="كتم الصوت">
            <Icon name="mic" size={18} />
          </button>
          {mode === "video" ? (
            <button type="button" className={`icon-button ${cameraOff ? "active" : ""}`} onClick={toggleCamera} aria-label="إيقاف الكاميرا">
              <Icon name="camera" size={18} />
            </button>
          ) : null}
          <button type="button" className="danger-button" onClick={hangUp}>
            <Icon name="phone" size={18} /> إنهاء
          </button>
        </div>
      </div>
    </div>
  );
}
