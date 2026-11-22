/*
 * طبقة تنسيق محركي التسميع: Tilawa (تدفّقي) و Quran ASR Small (دُفعي).
 *
 * المبدأ: تسجيل واحد للميكروفون يغذّي المحرك المختار، ثم يُقيَّم النص المحفوظ
 * في طبقة التقييم المستقلة. لا يُشغَّل المحركان معًا في وقت واحد: في الوضع
 * المشترك يعمل Tilawa أثناء التسجيل، ويُغلق قبل تحميل/تشغيل Quran ASR Small.
 * لا يوجد أي مسار شبكة هنا، ولا رجوع صامت إلى تعرّف سحابي.
 */

import {
  loadQuranAsr,
  type QuranAsrEngine,
  type QuranAsrTranscription,
} from "./quranAsrSmall";
import {
  assessRecitationAgainstAyahs,
  type AssessmentAyah,
  type RecitationAssessment,
} from "./quranAsrAssessment";

export type TasmeeEngineMode = "tilawa" | "quran-asr" | "combined";

export const TASMEE_ENGINE_MODE_KEY = "thimar.tasmee.engine";

export const TASMEE_ENGINE_MODES: { id: TasmeeEngineMode; label: string; hint: string }[] = [
  { id: "tilawa", label: "تتبّع أثناء القراءة", hint: "تُتتبّع الكلمات كلمةً كلمة أثناء التسميع." },
  { id: "quran-asr", label: "تسجيل ثم تقييم", hint: "يُسجَّل التسميع كاملًا ثم يُقيَّم بعد الإنهاء." },
  { id: "combined", label: "تتبّع مع تقييم", hint: "تتبّع أثناء القراءة، ثم تقييم التسجيل بعد الإنهاء." },
];

export function readTasmeeEngineMode(): TasmeeEngineMode {
  try {
    const raw = String(globalThis.localStorage?.getItem(TASMEE_ENGINE_MODE_KEY) ?? "").trim();
    if (raw === "quran-asr" || raw === "combined" || raw === "tilawa") return raw;
  } catch {
    /* التخزين غير متاح */
  }
  return "tilawa";
}

export function writeTasmeeEngineMode(mode: TasmeeEngineMode): void {
  try {
    globalThis.localStorage?.setItem(TASMEE_ENGINE_MODE_KEY, mode);
  } catch {
    /* تجاهل */
  }
}

export function modeUsesTilawa(mode: TasmeeEngineMode): boolean {
  return mode !== "quran-asr";
}

export function modeUsesQuranAsr(mode: TasmeeEngineMode): boolean {
  return mode !== "tilawa";
}

/** حد أقصى للتسجيل المحفوظ للتقييم (يُقصّ ما زاد بدل استنزاف الذاكرة). */
export const TASMEE_CAPTURE_MAX_SECONDS = 180;

export type TasmeeCapture = {
  readonly sampleRate: number;
  readonly seconds: number;
  readonly truncated: boolean;
  push(samples: Float32Array): void;
  finish(): { samples: Float32Array; sampleRate: number; durationMs: number; truncated: boolean };
  discard(): void;
};

/**
 * مخزن عيّنات أحادي القناة. ينسخ كل مقطع (المحرك قد يعيد استخدام مخزنه)،
 * ويحتفظ بحد أقصى زمني ثابت حتى لا ينمو التسجيل بلا سقف.
 */
export function createTasmeeCapture(
  sampleRate: number,
  maxSeconds = TASMEE_CAPTURE_MAX_SECONDS,
): TasmeeCapture {
  const chunks: Float32Array[] = [];
  const rate = Math.max(8000, Math.round(sampleRate));
  const limit = Math.max(1, Math.floor(rate * Math.max(1, maxSeconds)));
  let length = 0;
  let truncated = false;

  return {
    sampleRate: rate,
    get seconds() {
      return length / rate;
    },
    get truncated() {
      return truncated;
    },
    push(samples: Float32Array) {
      if (!samples || samples.length === 0) return;
      if (length >= limit) {
        truncated = true;
        return;
      }
      const room = limit - length;
      const chunk = room >= samples.length ? samples.slice() : samples.slice(0, room);
      if (chunk.length < samples.length) truncated = true;
      chunks.push(chunk);
      length += chunk.length;
    },
    finish() {
      const merged = new Float32Array(length);
      let at = 0;
      for (const chunk of chunks) {
        merged.set(chunk, at);
        at += chunk.length;
      }
      const durationMs = (merged.length / rate) * 1000;
      chunks.length = 0;
      length = 0;
      return { samples: merged, sampleRate: rate, durationMs, truncated };
    },
    discard() {
      chunks.length = 0;
      length = 0;
    },
  };
}

export type TasmeeEngineErrorCode =
  | "no-audio"
  | "engine-unavailable"
  | "engine-failed"
  | "low-memory"
  | "busy"
  | "mic-denied"
  | "mic-unavailable";

/** خطأ محلي صريح: `onlineFallback` ثابتة false حتى لا يُضلّل أي مستهلك. */
export class TasmeeEngineError extends Error {
  readonly code: TasmeeEngineErrorCode;
  readonly onlineFallback = false;

  constructor(code: TasmeeEngineErrorCode, message: string) {
    super(message);
    this.name = "TasmeeEngineError";
    this.code = code;
  }
}

function toEngineError(error: unknown): TasmeeEngineError {
  if (error instanceof TasmeeEngineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocat|out of memory|RangeError/i.test(message)) {
    return new TasmeeEngineError(
      "low-memory",
      "الذاكرة غير كافية للتقييم الصوتي الآن. أنهِ التسميع وأعد المحاولة، أو استخدم وضع التتبّع أثناء القراءة. لم يُرسل أي صوت إلى الشبكة.",
    );
  }
  return new TasmeeEngineError("engine-failed", message || "تعذّر تشغيل التقييم الصوتي محليًا.");
}

/** مخاطر الذاكرة عند تشغيل المحركين معًا — تقدير من الجهاز، لا قياس. */
export type TasmeeMemoryRisk = { level: "ok" | "warn" | "high"; deviceMemoryGb: number | null; message: string };

export function tasmeeMemoryRisk(): TasmeeMemoryRisk {
  const scope = globalThis as unknown as { navigator?: { deviceMemory?: number } };
  const gb = typeof scope.navigator?.deviceMemory === "number" ? scope.navigator.deviceMemory : null;
  if (gb === null) {
    return {
      level: "warn",
      deviceMemoryGb: null,
      message: "لا يعلن هذا الجهاز حجم ذاكرته. الوضع المشترك تجريبي: يعمل المحركان بالتتابع، وقد يحتاج مساحة RAM كبيرة.",
    };
  }
  if (gb < 2) {
    return {
      level: "high",
      deviceMemoryGb: gb,
      message: `الجهاز يعلن ${gb} ج.ب من الذاكرة. الوضع المشترك غير موصى به على هذا الجهاز؛ استخدم التتبّع أثناء القراءة.`,
    };
  }
  if (gb < 4) {
    return {
      level: "warn",
      deviceMemoryGb: gb,
      message: `الجهاز يعلن ${gb} ج.ب من الذاكرة. الوضع المشترك يعمل بالتتابع لكن استهلاكه مرتفع؛ راقب الاستقرار.`,
    };
  }
  return { level: "ok", deviceMemoryGb: gb, message: "" };
}

/* ------------------------------------------------------------------ */
/* ميكروفون لتقييم Quran ASR (بلا Tilawa)                              */
/* ------------------------------------------------------------------ */

export type TasmeeMicCapture = {
  sampleRate: number;
  level(): number;
  stop(): Promise<void>;
};

/**
 * ميكروفون خام لعيّنات أحادية. لا يستخدم Tilawa ولا شبكة. يُغذّي `onChunk`
 * بمقاطع Float32 بمعدل سياق الصوت، ثم يُغلق السياق والمسار عند `stop()`.
 */
export async function startTasmeeMicCapture(
  onChunk: (samples: Float32Array) => void,
): Promise<TasmeeMicCapture> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.mediaDevices?.getUserMedia) {
    throw new TasmeeEngineError("mic-unavailable", "الميكروفون غير متاح في هذا العرض.");
  }
  let stream: MediaStream;
  try {
    stream = await nav.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    throw new TasmeeEngineError("mic-denied", "لم يُسمح باستخدام الميكروفون. اسمح بالوصول من إعدادات الجهاز ثم أعد المحاولة.");
  }

  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new TasmeeEngineError("mic-unavailable", "معالجة الصوت غير مدعومة في هذا العرض.");
  }

  const context = new Ctor();
  await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  const buffer = new Float32Array(analyser.fftSize);
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    onChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(analyser);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  return {
    sampleRate: context.sampleRate,
    level() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      return Math.max(0, Math.min(1, (db + 60) / 54));
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      processor.onaudioprocess = null;
      try {
        source.disconnect();
        analyser.disconnect();
        processor.disconnect();
        mute.disconnect();
      } catch {
        /* تجاهل */
      }
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
    },
  };
}

/* ------------------------------------------------------------------ */
/* تقييم التسجيل                                                       */
/* ------------------------------------------------------------------ */

export type QuranAsrEngineProvider = () => Promise<QuranAsrEngine | null>;

const defaultProvider: QuranAsrEngineProvider = () => loadQuranAsr();
const seenEngines = new WeakSet<object>();

export type TasmeeAssessmentRun = {
  transcription: QuranAsrTranscription;
  assessment: RecitationAssessment;
  engine: { initializeMs: number; modelBytes: number; reused: boolean };
  timing: { captureMs: number; transcribeMs: number; totalMs: number };
};

/**
 * يقيّم تسجيلًا محفوظًا بـ Quran ASR Small + طبقة التقييم.
 * يُعاد استخدام الجلسة نفسها في كل استدعاء (لا تحميل مكرر للنموذج).
 */
export async function assessTasmeeRecording(
  ayahs: AssessmentAyah[],
  recording: { samples: Float32Array; sampleRate: number; durationMs: number },
  options: { provider?: QuranAsrEngineProvider } = {},
): Promise<TasmeeAssessmentRun> {
  if (!recording.samples.length) {
    throw new TasmeeEngineError("no-audio", "لا يوجد تسجيل كافٍ لتقييم التسميع. أعد المحاولة.");
  }
  const provider = options.provider ?? defaultProvider;
  const totalStart = performance.now();
  let engine: QuranAsrEngine | null;
  try {
    engine = await provider();
  } catch (error) {
    throw toEngineError(error);
  }
  if (!engine) {
    throw new TasmeeEngineError(
      "engine-unavailable",
      "التقييم الصوتي غير مضمَّن في هذه النسخة؛ لن يُستخدم أي تنزيل عبر الشبكة.",
    );
  }
  const reused = seenEngines.has(engine);
  seenEngines.add(engine);
  try {
    const transcribeStart = performance.now();
    const transcription = await engine.transcribe(recording.samples, recording.sampleRate);
    const transcribeMs = performance.now() - transcribeStart;
    const assessment = assessRecitationAgainstAyahs(ayahs, transcription.words);
    return {
      transcription,
      assessment,
      engine: { initializeMs: engine.initializeMs, modelBytes: engine.modelBytes, reused },
      timing: {
        captureMs: recording.durationMs,
        transcribeMs,
        totalMs: performance.now() - totalStart,
      },
    };
  } catch (error) {
    throw toEngineError(error);
  }
}

/* ------------------------------------------------------------------ */
/* المنسّق                                                             */
/* ------------------------------------------------------------------ */

export type TasmeeOrchestratorState = "idle" | "recording" | "recorded" | "assessing" | "done" | "error";

/**
 * يضمن تسلسل المحركين: التقاط واحد، ثم Tilawa أثناء التسجيل، ثم إغلاقه،
 * ثم تقييم Quran ASR. لا يسمح بتقييم متزامن أو مكرر.
 */
export class TasmeeOrchestrator {
  readonly mode: TasmeeEngineMode;
  private readonly provider?: QuranAsrEngineProvider;
  private captureValue: TasmeeCapture | null = null;
  private stateValue: TasmeeOrchestratorState = "idle";

  constructor(mode: TasmeeEngineMode, options: { provider?: QuranAsrEngineProvider } = {}) {
    this.mode = mode;
    this.provider = options.provider;
  }

  get state(): TasmeeOrchestratorState {
    return this.stateValue;
  }

  get capturedSeconds(): number {
    return this.captureValue?.seconds ?? 0;
  }

  /** يبدأ الالتقاط بمعدل معلوم (مسار الميكروفون المباشر). */
  begin(sampleRate: number): void {
    if (this.stateValue === "recording" || this.stateValue === "recorded" || this.stateValue === "assessing") {
      throw new TasmeeEngineError("busy", "يوجد تسجيل جارٍ بالفعل.");
    }
    this.stateValue = "recording";
    this.captureValue = createTasmeeCapture(sampleRate);
  }

  /** يستقبل مقطعًا من Tilawa (16 kHz بعد إعادة العيّنات) أو من الميكروفون المباشر. */
  tap(samples: Float32Array, sampleRate = 16000): void {
    if (!modeUsesQuranAsr(this.mode)) return;
    if (this.stateValue === "idle") {
      /* أول مقطع يبدأ الالتقاط بمعدل مصدره (ميكروفون مباشر بلا Tilawa). */
      this.stateValue = "recording";
      this.captureValue = createTasmeeCapture(sampleRate);
    }
    if (this.stateValue !== "recording") return;
    if (!this.captureValue) {
      this.captureValue = createTasmeeCapture(sampleRate);
      return;
    }
    if (Math.abs(this.captureValue.sampleRate - Math.round(sampleRate)) > 1) return;
    this.captureValue.push(samples);
  }

  /** يقفل الالتقاط؛ أي مقطع لاحق يُهمَل. */
  finishRecording(): { durationMs: number; truncated: boolean } {
    if (!this.captureValue) return { durationMs: 0, truncated: false };
    if (this.stateValue === "recording") this.stateValue = "recorded";
    return {
      durationMs: this.captureValue.seconds * 1000,
      truncated: this.captureValue.truncated,
    };
  }

  async assess(ayahs: AssessmentAyah[]): Promise<TasmeeAssessmentRun> {
    if (this.stateValue === "assessing") {
      throw new TasmeeEngineError("busy", "التقييم جارٍ بالفعل.");
    }
    if (!this.captureValue || this.stateValue === "idle" || this.stateValue === "recording") {
      throw new TasmeeEngineError("no-audio", "لم يُغلق التسجيل بعد؛ لا يمكن التقييم الآن.");
    }
    if (this.stateValue === "done") {
      throw new TasmeeEngineError("busy", "تم تقييم هذا التسجيل بالفعل.");
    }
    const finished = this.captureValue.finish();
    this.captureValue = null;
    this.stateValue = "assessing";
    try {
      const run = await assessTasmeeRecording(
        ayahs,
        { samples: finished.samples, sampleRate: finished.sampleRate, durationMs: finished.durationMs },
        this.provider ? { provider: this.provider } : {},
      );
      this.stateValue = "done";
      return run;
    } catch (error) {
      this.stateValue = "error";
      throw error;
    }
  }

  /** يحرّر الذاكرة ويعيد المنسّق إلى البداية (إعادة التسميع). */
  reset(): void {
    this.captureValue?.discard();
    this.captureValue = null;
    this.stateValue = "idle";
  }
}

/** يحوّل آيات حفص إلى مرجع التقييم، مع حذف البسملة من أول آية كما في واجهة التسميع. */
export function tasmeeAssessmentAyahs(
  ayahs: { surah: number; ayah: number; global: number; text: string }[],
): AssessmentAyah[] {
  return ayahs.map((ayah) => {
    let text = ayah.text;
    if (ayah.ayah === 1 && ayah.surah !== 1 && ayah.surah !== 9) {
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length >= 5 && tokens[0].startsWith("بِسْمِ")) text = tokens.slice(4).join(" ");
    }
    return { surah: ayah.surah, ayah: ayah.ayah, global: ayah.global, text };
  });
}
