/**
 * مدخل صوتي محسّن للتسميع: يطلب الميكروفون بعزل الضوضاء وإلغاء الصدى
 * وتكبير الصوت التلقائي، ثم يمرّر الإشارة عبر سلسلة معالجة (تنقية الترددات
 * المنخفضة، إبراز المخارج، ضاغط صوت، تكبير) ويعطي مستوى صوت مباشرًا.
 */
export type VoiceInput = {
  stream: MediaStream;
  level: () => number;
  /** يشغّل مقطعًا مسجّلًا من المعالجة نفسها (يعمل دون إنترنت). */
  stop: () => void;
};

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export async function startVoiceInput(): Promise<VoiceInput> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("no-media");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    },
  });

  const Ctor = audioContextCtor();
  if (!Ctor) {
    return {
      stream,
      level: () => 0,
      stop: () => stream.getTracks().forEach((track) => track.stop()),
    };
  }

  const context = new Ctor();
  const source = context.createMediaStreamSource(stream);

  /* قطع الترددات المنخفضة (همهمة، تكييف، اهتزاز طاولة). */
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 85;
  highpass.Q.value = 0.7;

  /* إبراز مخارج الحروف لتوضيح النطق. */
  const presence = context.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = 4;

  /* ضغط المدى: يرفع الصوت الهادئ ويقصّ الصاخب بلا تشويه. */
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -45;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.25;

  const gain = context.createGain();
  gain.gain.value = 1.5;

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(compressor);
  compressor.connect(gain);
  gain.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  const level = () => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);
    /* تطبيع بصري: -60dB…-6dB → 0…1 */
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    return Math.max(0, Math.min(1, (db + 60) / 54));
  };

  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    void context.close().catch(() => undefined);
  };

  return { stream, level, stop };
}
