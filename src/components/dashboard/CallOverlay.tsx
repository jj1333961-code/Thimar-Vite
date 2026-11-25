import { useEffect, useRef, useState } from "react";
import {
  CALL_ICE_TRANSPORT_POLICY,
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
import { loadChats, sendChatMessage, type ChatMessage } from "../../lib/appStore";
import { Icon } from "./ui";
import "./CallConnect.css";

type Props = {
  selfId: string;
  selfName: string;
  peerId: string;
  peerName: string;
  mode: CallMode;
  callId?: string;
  conversationId?: string;
  incoming?: { callId: string; fromName: string };
  onClose: () => void;
  onLog: (text: string) => void;
};

/**
 * مكالمة صوتية/فيديو حقيقية بين مستخدمين عبر الإنترنت (WebRTC).
 * الإشارات تُتبادل عبر قناة Supabase Realtime خاصة بالمكالمة.
 */
export default function CallOverlay({ selfId, selfName, peerId, peerName, mode, callId: givenCallId, conversationId, incoming, onClose, onLog }: Props) {
  const callId = useRef(incoming?.callId ?? givenCallId ?? `call-${Math.random().toString(36).slice(2, 10)}`).current;
  const isCaller = !incoming;
  const [status, setStatus] = useState<"connecting" | "ringing" | "active" | "ended" | "error">("connecting");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatItems, setChatItems] = useState<ChatMessage[]>([]);
  const [liveChat, setLiveChat] = useState<Array<{ id: string; from: string; text: string; at: number }>>([]);
  const [quality, setQuality] = useState<"unknown" | "good" | "fair" | "poor">("unknown");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const channelRef = useRef<ReturnType<typeof createChannel> | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localIceRef = useRef<RTCIceCandidateInit[]>([]);
  const offerRetryRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const ringbackCtxRef = useRef<AudioContext | null>(null);
  const ringbackTimerRef = useRef<number | null>(null);
  const incomingRingCtxRef = useRef<AudioContext | null>(null);
  const incomingRingTimerRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const secondsRef = useRef(0);

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

  /* نغمة رنين للمستقبِل — نغمتان قصيرتان كل ثانيتين ونصف. */
  const startIncomingRing = () => {
    if (incomingRingCtxRef.current) return;
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      incomingRingCtxRef.current = ctx;
      const burst = () => {
        if (!incomingRingCtxRef.current) return;
        [0, 0.45].forEach((delay) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 740;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + delay + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.32);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.35);
        });
      };
      burst();
      incomingRingTimerRef.current = window.setInterval(burst, 2500);
    } catch {
      /* المتصفح قد يمنع الصوت قبل تفاعل المستخدم. */
    }
  };
  const stopIncomingRing = () => {
    if (incomingRingTimerRef.current) {
      clearInterval(incomingRingTimerRef.current);
      incomingRingTimerRef.current = null;
    }
    if (incomingRingCtxRef.current) {
      incomingRingCtxRef.current.close().catch(() => undefined);
      incomingRingCtxRef.current = null;
    }
  };

  const finish = (reason?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopRingback();
    stopIncomingRing();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    closeCall(pcRef.current, localStreamRef.current);
    pcRef.current = null;
    localStreamRef.current = null;
    setStatus("ended");
    const duration = secondsRef.current;
    const durationText = duration > 0
      ? ` (المدة ${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")})`
      : "";
    onLog(`${mode === "audio" ? "مكالمة صوتية" : "مكالمة فيديو"} — ${reason ?? "انتهت المكالمة"}${durationText}`);
    setTimeout(() => onClose(), 900);
  };

  /* لا نعرض أو نشغّل وسائط الطرف الآخر إلا بعد اكتمال الاتصال الفعلي. */
  const attachRemoteMedia = () => {
    const element = remoteVideoRef.current;
    const stream = remoteStreamRef.current;
    if (!element || !stream.getTracks().length) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    element.muted = false;
    void element.play().catch(() => undefined);
  };

  const ensurePeer = async () => {
    if (pcRef.current) return pcRef.current;
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({
      iceServers,
      // TURN فقط: لا اتصال مباشر بين المستخدمين ولا كشف لعناوين IP.
      iceTransportPolicy: CALL_ICE_TRANSPORT_POLICY,
      // جمع المرشحات مسبقًا يقلل زمن الربط عند بدء المكالمة.
      iceCandidatePoolSize: 4,
      bundlePolicy: "max-bundle",
    });
    pcRef.current = pc;
    // نجهّز مسار فيديو احتياطيًا حتى يمكن مشاركة الشاشة لاحقًا في المكالمة الصوتية دون تفاوض جديد.
    if (mode === "audio") {
      const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      videoSenderRef.current = videoTransceiver.sender;
    }
    const stream = await getLocalStream(mode);
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play().catch(() => undefined);
    }
    stream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, stream);
      if (track.kind === "video") videoSenderRef.current = sender;
    });
    pc.ontrack = (event) => {
      // نُبقي الصوت والفيديو ومشاركة الشاشة داخل MediaStream واحد حتى عند وصول
      // مسار الشاشة بلا stream association في بعض المتصفحات.
      const remoteStream = remoteStreamRef.current;
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      if (pc.connectionState === "connected") attachRemoteMedia();
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        const candidate = event.candidate.toJSON();
        localIceRef.current.push(candidate);
        void sendSignal(channelRef.current, {
          kind: "ice",
          from: selfId,
          callId,
          candidate,
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("active");
        attachRemoteMedia();
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
      if (signal.kind === "screen-share") {
        setRemoteScreenSharing(signal.active);
        return;
      }
      if (signal.kind === "chat") {
        const text = String(signal.text ?? "").slice(0, 1000).trim();
        if (text) {
          const id = String(signal.id ?? `live-${signal.from}-${signal.at}`);
          if (conversationId) {
            sendChatMessage(conversationId, {
              id,
              senderId: signal.from,
              kind: "text",
              text,
              createdAt: signal.at,
            }, { silent: true });
            const conversation = loadChats().find((item) => item.id === conversationId);
            setChatItems(conversation?.messages ?? []);
          } else {
            setLiveChat((items) => [
              ...items.slice(-49),
              { id, from: signal.from, text, at: signal.at },
            ]);
          }
        }
        return;
      }
      if (signal.kind === "offer") {
        offerRef.current = signal.sdp;
        setStatus("ringing");
        if (offerRetryRef.current !== null) {
          window.clearInterval(offerRetryRef.current);
          offerRetryRef.current = null;
        }
        return;
      }
      if (signal.kind === "request-offer" && isCaller) {
        const offer = localOfferRef.current;
        if (offer) {
          await sendSignal(channel, { kind: "offer", from: selfId, callId, sdp: offer });
          for (const candidate of localIceRef.current) {
            await sendSignal(channel, { kind: "ice", from: selfId, callId, candidate });
          }
        }
        return;
      }
      if (signal.kind === "accept" && isCaller) {
        // نعيد إرسال العرض بعد القبول حتى لا يضيع قبل انضمام الطرف الآخر.
        if (localOfferRef.current) {
          await sendSignal(channel, { kind: "offer", from: selfId, callId, sdp: localOfferRef.current });
          for (const candidate of localIceRef.current) {
            await sendSignal(channel, { kind: "ice", from: selfId, callId, candidate });
          }
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
        setStatus("connecting");
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
      if (!isCaller) {
        // لا نفترض أن العرض الأول وصل: Realtime لا يحتفظ برسائل broadcast
        // قبل اشتراك الطرف المستقبل، لذا نطلب إعادة إرساله حتى يصل العرض.
        const requestOffer = () => void sendSignal(channel, {
          kind: "request-offer", from: selfId, callId,
        });
        requestOffer();
        let attempts = 0;
        offerRetryRef.current = window.setInterval(() => {
          if (offerRef.current || attempts >= 12) {
            if (offerRetryRef.current !== null) window.clearInterval(offerRetryRef.current);
            offerRetryRef.current = null;
            return;
          }
          attempts += 1;
          requestOffer();
        }, 1000);
      }
      try {
        if (isCaller) {
          const pc = await ensurePeer();
          const offer = await pc.createOffer();
          localOfferRef.current = offer;
          await pc.setLocalDescription(offer);
          localOfferRef.current = pc.localDescription ?? offer;
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
      if (offerRetryRef.current !== null) window.clearInterval(offerRetryRef.current);
      offerRetryRef.current = null;
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

  /* نغمة واردة للمستقبِل حتى يقبل أو يرفض. */
  useEffect(() => {
    if (status === "ringing" && !isCaller) startIncomingRing();
    else stopIncomingRing();
    return () => stopIncomingRing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isCaller]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* جودة الشبكة من زمن الاستجابة الفعلي لمسار الاتصال. */
  useEffect(() => {
    if (status !== "active") { setQuality("unknown"); return; }
    const pc = pcRef.current;
    if (!pc) return;
    let cancelled = false;
    const measure = async () => {
      try {
        const stats = await pc.getStats();
        let rtt: number | null = null;
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && (report.state === "succeeded" || report.nominated) && typeof report.currentRoundTripTime === "number") {
            rtt = report.currentRoundTripTime;
          }
        });
        if (cancelled) return;
        if (rtt === null) setQuality("unknown");
        else if (rtt < 0.15) setQuality("good");
        else if (rtt < 0.4) setQuality("fair");
        else setQuality("poor");
      } catch { if (!cancelled) setQuality("unknown"); }
    };
    void measure();
    const timer = window.setInterval(() => void measure(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status]);

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
      setStatus("connecting");
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
    const timer = setInterval(() => setSeconds((value) => {
      secondsRef.current = value + 1;
      return value + 1;
    }), 1000);
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

  /* تبديل الكاميرا الأمامية/الخلفية على الهاتف عبر facingMode. */
  const switchCamera = async () => {
    if (screenSharing) {
      setError("أوقف مشاركة الشاشة قبل تبديل الكاميرا.");
      return;
    }
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = facing === "user" ? "environment" : "user";
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: next }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      const track = camera.getVideoTracks()[0];
      if (!track) throw new Error("NO_CAMERA");
      track.enabled = !cameraOff;
      const sender = videoSenderRef.current ?? pcRef.current?.getSenders().find((item) => item.track?.kind === "video") ?? null;
      if (sender) await sender.replaceTrack(track);
      const previous = stream.getVideoTracks()[0];
      if (previous) {
        try { stream.removeTrack(previous); } catch { /* ignore */ }
        previous.stop();
      }
      stream.addTrack(track);
      cameraTrackRef.current = track;
      setFacing(next);
      setError("");
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => undefined);
      }
    } catch {
      setError("تعذّر تبديل الكاميرا على هذا الجهاز.");
    }
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      setError("ملء الشاشة غير مدعوم في هذه البيئة.");
    }
  };

  const togglePictureInPicture = async () => {
    const video = remoteVideoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      setError("الصورة داخل الصورة غير مدعومة في هذا المتصفح.");
    }
  };

  const stopScreenShare = async () => {
    const display = screenStreamRef.current;
    if (!display) return;
    const track = display.getVideoTracks()[0];
    if (track) track.onended = null;
    display.getTracks().forEach((item) => item.stop());
    screenStreamRef.current = null;
    try {
      if (videoSenderRef.current) await videoSenderRef.current.replaceTrack(cameraTrackRef.current);
    } catch { setError("تعذّر إيقاف مشاركة الشاشة بأمان."); }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = mode === "video" ? localStreamRef.current : null;
    }
    setScreenSharing(false);
    if (channelRef.current) void sendSignal(channelRef.current, { kind: "screen-share", from: selfId, callId, active: false });
  };

  const startScreenShare = async () => {
    if (screenSharing) { await stopScreenShare(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("مشاركة الشاشة غير مدعومة في هذا المتصفح أو داخل إصدار التطبيق الحالي. استخدم متصفح الكمبيوتر أو حدّث دعم الالتقاط الأصلي للهاتف.");
      return;
    }
    try {
      const pc = pcRef.current ?? await ensurePeer();
      const sender = videoSenderRef.current ?? pc.getSenders().find((item) => item.track?.kind === "video") ?? null;
      if (!sender) throw new Error("مسار الفيديو غير جاهز في هذه المكالمة.");
      cameraTrackRef.current = localStreamRef.current?.getVideoTracks()[0] ?? null;
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) { display.getTracks().forEach((item) => item.stop()); throw new Error("لم يتم اختيار شاشة للمشاركة."); }
      screenStreamRef.current = display;
      videoSenderRef.current = sender;
      await sender.replaceTrack(track);
      setScreenSharing(true);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = display;
        void localVideoRef.current.play().catch(() => undefined);
      }
      track.onended = () => { void stopScreenShare(); };
      if (channelRef.current) void sendSignal(channelRef.current, { kind: "screen-share", from: selfId, callId, active: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّرت مشاركة الشاشة.");
    }
  };

  const sendCallChat = () => {
    const value = chatDraft.trim();
    if (!value || !conversationId) return;
    const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const at = Date.now();
    if (channelRef.current) {
      void sendSignal(channelRef.current, { kind: "chat", from: selfId, callId, id, text: value, at });
    }
    sendChatMessage(conversationId, { id, senderId: selfId, kind: "text", text: value, createdAt: at }, { silent: true });
    setChatDraft("");
    const conversation = loadChats().find((item) => item.id === conversationId);
    setChatItems(conversation?.messages ?? []);
  };

  useEffect(() => {
    if (!screenSharing || !localVideoRef.current || !screenStreamRef.current) return;
    localVideoRef.current.srcObject = screenStreamRef.current;
    void localVideoRef.current.play().catch(() => undefined);
  }, [screenSharing]);

  useEffect(() => {
    if (!chatOpen || !conversationId) return;
    const refreshChat = () => {
      const conversation = loadChats().find((item) => item.id === conversationId);
      setChatItems(conversation?.messages ?? []);
    };
    refreshChat();
    const timer = window.setInterval(refreshChat, 1200);
    return () => window.clearInterval(timer);
  }, [chatOpen, conversationId]);

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

  const qualityLabel = quality === "good" ? "شبكة ممتازة" : quality === "fair" ? "شبكة متوسطة" : quality === "poor" ? "شبكة ضعيفة" : "جارٍ قياس الشبكة…";

  return (
    <div className="call-overlay">
      <div className="call-stage" ref={stageRef}>
        <video
          ref={remoteVideoRef}
          className={`call-remote ${mode === "audio" && !remoteScreenSharing ? "audio-only" : ""}`}
          autoPlay
          playsInline
        />
        {mode === "video" || screenSharing ? (
          <video ref={localVideoRef} className="call-local" autoPlay playsInline muted />
        ) : (
          <audio ref={localVideoRef as unknown as React.RefObject<HTMLAudioElement>} autoPlay muted />
        )}
        <div className="call-top">
          <strong>{peerName}</strong>
          <span>{mode === "audio" ? "مكالمة صوتية" : "مكالمة فيديو"} • {label}</span>
          {status === "active" ? (
            <span className="call-network" data-quality={quality}>
              <i aria-hidden="true" /> {qualityLabel}
            </span>
          ) : null}
        </div>
        {remoteScreenSharing ? <p className="call-sharing-badge"><Icon name="globe" size={14} /> {peerName} يشارك الشاشة الآن</p> : null}
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
        {chatOpen ? (
          <section className="call-chat-panel" aria-label="دردشة المكالمة">
            <header><strong>دردشة المكالمة</strong><button type="button" onClick={() => setChatOpen(false)} aria-label="إغلاق الدردشة">×</button></header>
            {!conversationId ? <p className="call-chat-empty">لا توجد محادثة محفوظة مرتبطة بهذا الاتصال.</p> : (
              <>
                <div className="call-chat-list">
                  {chatItems.slice(-30).map((item) => (
                    <div key={item.id} className={`call-chat-message ${item.senderId === selfId ? "mine" : "theirs"}`}>
                      <span>{item.senderId === selfId ? "أنت" : peerName}</span>
                      <p>{item.text ?? (item.kind === "audio" ? "رسالة صوتية" : "مرفق")}</p>
                    </div>
                  ))}
                  {liveChat.map((item) => (
                    <div key={item.id} className={`call-chat-message ${item.from === selfId ? "mine" : "theirs"}`}>
                      <span>{item.from === selfId ? "أنت" : peerName}</span>
                      <p>{item.text}</p>
                    </div>
                  ))}
                  {!chatItems.length && !liveChat.length ? <p className="call-chat-empty">لا رسائل بعد. الرسائل تصل فورًا أثناء المكالمة.</p> : null}
                </div>
                <form className="call-chat-compose" onSubmit={(event) => { event.preventDefault(); sendCallChat(); }}>
                  <input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="اكتب رسالة أثناء المكالمة..." maxLength={1000} />
                  <button type="submit" disabled={!chatDraft.trim()}>إرسال</button>
                </form>
              </>
            )}
          </section>
        ) : null}
        <div className="call-actions bottom">
          <button type="button" className={`icon-button ${muted ? "active" : ""}`} onClick={toggleMute} aria-label="كتم الصوت">
            <Icon name="mic" size={18} />
          </button>
          {mode === "video" ? (
            <>
              <button type="button" className={`icon-button ${cameraOff ? "active" : ""}`} onClick={toggleCamera} aria-label={cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا"} title={cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا"}>
                <Icon name="camera" size={18} />
              </button>
              {!screenSharing ? (
                <button type="button" className="icon-button" onClick={() => void switchCamera()} aria-label="تبديل الكاميرا الأمامية/الخلفية" title="تبديل الكاميرا">
                  <Icon name="switch" size={18} />
                </button>
              ) : null}
            </>
          ) : null}
          {status === "active" ? (
            <>
              <button type="button" className={`icon-button ${screenSharing ? "active" : ""}`} onClick={() => void startScreenShare()} aria-label={screenSharing ? "إيقاف مشاركة الشاشة" : "مشاركة الشاشة"} title={screenSharing ? "إيقاف مشاركة الشاشة" : "مشاركة الشاشة"}>
                <Icon name="globe" size={18} />
              </button>
              {typeof document !== "undefined" && document.fullscreenEnabled ? (
                <button type="button" className={`icon-button ${isFullscreen ? "active" : ""}`} onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"} title={isFullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}>
                  <Icon name="maximize" size={18} />
                </button>
              ) : null}
              {typeof document !== "undefined" && document.pictureInPictureEnabled ? (
                <button type="button" className="icon-button" onClick={() => void togglePictureInPicture()} aria-label="صورة داخل صورة" title="صورة داخل صورة">
                  <Icon name="pip" size={18} />
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" className={`icon-button ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen((value) => !value)} aria-label="دردشة المكالمة" title="دردشة المكالمة">
            <Icon name="chat" size={18} />
          </button>
          <button type="button" className="danger-button" onClick={hangUp}>
            <Icon name="phone" size={18} /> إنهاء
          </button>
        </div>
      </div>
    </div>
  );
}
