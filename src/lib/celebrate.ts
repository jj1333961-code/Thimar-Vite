/**
 * احتفال ثمار: حدث عام واحد يفتح الاحتفال من أي مكان في التطبيق.
 * (ورق ملوّن + نجوم + بالونات + ألعاب نارية صغيرة مع صوت بوق)
 */

export type CelebrationKind =
  | "register"
  | "login"
  | "exam"
  | "challenge"
  | "path"
  | "task"
  | "memorize";

export const CELEBRATE_EVENT = "thimar:celebrate";

export function celebrate(kind: CelebrationKind, detail?: string): void {
  try {
    window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { kind, detail } }));
  } catch {
    /* ignore */
  }
}

/** احتفال مرة واحدة فقط لكل مفتاح (أول دخول، إنشاء حساب…). */
export function celebrateOnce(key: string, kind: CelebrationKind, detail?: string): void {
  const storageKey = `thimar.celebrated.${key}`;
  try {
    if (localStorage.getItem(storageKey)) return;
    localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    /* ignore */
  }
  celebrate(kind, detail);
}

/**
 * صوت الاحتفال: نفخة بوق صاعدة ثم رشّة ألعاب نارية قصيرة.
 * مبني على WebAudio حتى لا يحتاج ملفات صوت.
 */
export function playCelebrationSound(): void {
  const Ctx =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }
  const now = ctx.currentTime;
  void ctx.resume().catch(() => undefined);

  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  // نفخة البوق: ثلاث نغمات صاعدة.
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + index * 0.13);
    gain.gain.setValueAtTime(0.0001, now + index * 0.13);
    gain.gain.exponentialRampToValueAtTime(0.9, now + index * 0.13 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.22);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + index * 0.13);
    osc.stop(now + index * 0.13 + 0.26);
  });

  // رشّة قصيرة تشبه الألعاب النارية.
  const noiseLength = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i += 1) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLength, 2.6);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 900;
  const popGain = ctx.createGain();
  popGain.gain.setValueAtTime(0.0001, now + 0.5);
  popGain.gain.exponentialRampToValueAtTime(0.7, now + 0.54);
  popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
  noise.connect(filter);
  filter.connect(popGain);
  popGain.connect(master);
  noise.start(now + 0.5);
  noise.stop(now + 1.0);

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, 1800);
}
