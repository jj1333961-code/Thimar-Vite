/*
 * محرك «Quran ASR Small» — تعرّف صوتي محلي على التلاوة، يعمل داخل التطبيق دون إنترنت.
 *
 * النموذج: Abdou/quran-asr-small (MIT) — Conformer-CTC بـ33 مليون معامل، نسخة int8
 * (36 م.ب)، 31 رمزًا (حروف عربية + فاصل كلمات)، مُصدَّر بواجهة sherpa-onnx
 * "zipformer2_ctc": المدخل x=[N,T,80] (log-mel fbank)، الخرج log_probs=[N,T/4,31].
 *
 * لماذا ONNX Runtime Web مباشرة بدل sherpa-onnx؟
 *   - التطبيق يشحن onnxruntime-web وhis wasm داخل الحزمة أصلًا (نفس runtime Tilawa)،
 *     فلا نضيف 50+ م.ب من WASM آخر إلى الـAPK.
 *   - النموذج نفسه محمول ONNX قياسي، وواجهته هنا مطابقة لِما يفعله sherpa-onnx.
 *   وقد تحقّقنا من التطابق حرفيًا: مخرجات هذا المسار تساوي مخرجات sherpa-onnx
 *   على خمس تلاوات (بما فيها آية 60 ثانية) — انظر artifacts/quran-asr/verify.py.
 *
 * لا تنزيل وقت التشغيل إطلاقًا: النموذج والرموز تُقرأ من الحزمة المضمَّنة داخل الـAPK
 * بعد التحقق من الحجم والبصمة، وأي فشل يظهر كخطأ صريح بلا انتقال إلى خدمة سحابية.
 */

export const QURAN_ASR_LABEL = "quran-asr-small";
export const QURAN_ASR_MANIFEST = "/offline/v1/manifest.json";

type BundleAsset = { path: string; label: string; bytes: number; sha256: string };
type BundleManifest = { schema: number; assetBase: string; assets: BundleAsset[] };

/** نفس بيان الحزمة الذي يتحقق منه محرك Tilawa: مصدر واحد للحقيقة داخل التطبيق. */
async function loadQuranAsrManifest(): Promise<BundleManifest | null> {
  try {
    const response = await fetch(QURAN_ASR_MANIFEST, { cache: "no-store" });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trimStart().startsWith("{")) return null;
    const parsed = JSON.parse(text) as BundleManifest;
    if (parsed?.schema !== 1 || !Array.isArray(parsed.assets) || parsed.assets.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
export const QURAN_ASR_SAMPLE_RATE = 16000;
export const QURAN_ASR_NUM_MELS = 80;

/** مدة الإطار الواحد بعد التخفيض الرباعي في النموذج (10ms × 4). */
const OUTPUT_FRAME_MS = 40;

/* ------------------------------------------------------------------ */
/* الحالة والتجهيز المسبق                                              */
/* ------------------------------------------------------------------ */

export type QuranAsrState = "idle" | "loading" | "ready" | "error";

export type QuranAsrSnapshot = {
  state: QuranAsrState;
  message: string;
  /** زمن إنشاء الجلسة من أول بايت حتى جهوزية ORT. */
  initializeMs: number | null;
  modelBytes: number | null;
  bundled: boolean;
};

let snapshot: QuranAsrSnapshot = {
  state: "idle",
  message: "",
  initializeMs: null,
  modelBytes: null,
  bundled: false,
};

const listeners = new Set<(value: QuranAsrSnapshot) => void>();
let loadPromise: Promise<QuranAsrEngine | null> | null = null;
let engine: QuranAsrEngine | null = null;

function publish(patch: Partial<QuranAsrSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      /* مستمع معطوب لا يوقف المحرك */
    }
  }
}

export function getQuranAsrSnapshot(): QuranAsrSnapshot {
  return snapshot;
}

export function subscribeQuranAsr(listener: (value: QuranAsrSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ */
/* استخراج السمات: نفس وصفة Kaldi في code/quran_asr/features.py        */
/* ------------------------------------------------------------------ */

const SHIFT = 160;
const WINDOW_LENGTH = 400;
const FFT_SIZE = 512;
const EPS = 1.1920928955078125e-7; // finfo(float32).eps

function melFrequency(hz: number): number {
  return 1127 * Math.log(1 + hz / 700);
}

/* مرشّحات mel مضغوطة (CSR): كل مرشّح يغطي عددًا صغيرًا من صناديق FFT. */
const MEL_OFFSETS = new Int32Array(QURAN_ASR_NUM_MELS + 1);
let MEL_WEIGHTS = new Float64Array(0);
const MEL_INDICES: Int32Array = (() => {
  const bins = FFT_SIZE / 2;
  const width = QURAN_ASR_SAMPLE_RATE / FFT_SIZE;
  const low = 20;
  const high = QURAN_ASR_SAMPLE_RATE / 2 - 400;
  const melLow = melFrequency(low);
  const melHigh = melFrequency(high);
  const delta = (melHigh - melLow) / (QURAN_ASR_NUM_MELS + 1);
  const indexLists: number[][] = [];
  const weightLists: number[][] = [];
  for (let b = 0; b < QURAN_ASR_NUM_MELS; b += 1) {
    const left = melLow + b * delta;
    const center = melLow + (b + 1) * delta;
    const right = melLow + (b + 2) * delta;
    const indexes: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < bins; i += 1) {
      const m = melFrequency(width * i);
      if (m <= left || m >= right) continue;
      indexes.push(i);
      weights.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
    }
    indexLists.push(indexes);
    weightLists.push(weights);
  }
  const total = indexLists.reduce((sum, list) => sum + list.length, 0);
  const indices = new Int32Array(total);
  const weights = new Float64Array(total);
  let at = 0;
  for (let b = 0; b < QURAN_ASR_NUM_MELS; b += 1) {
    MEL_OFFSETS[b] = at;
    for (let k = 0; k < indexLists[b].length; k += 1) {
      indices[at] = indexLists[b][k];
      weights[at] = weightLists[b][k];
      at += 1;
    }
  }
  MEL_OFFSETS[QURAN_ASR_NUM_MELS] = at;
  MEL_WEIGHTS = weights;
  return indices;
})();

/* نافذة povey (hann^0.85). */
const POVEY_WINDOW = (() => {
  const win = new Float64Array(WINDOW_LENGTH);
  for (let i = 0; i < WINDOW_LENGTH; i += 1) {
    win[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW_LENGTH - 1)), 0.85);
  }
  return win;
})();

/* FFT radix-2: جداول ثابتة تُحسب مرة واحدة. */
const FFT_REV = (() => {
  const rev = new Uint16Array(FFT_SIZE);
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    let value = i;
    let mirror = 0;
    for (let b = 0; b < bits; b += 1) {
      mirror = (mirror << 1) | (value & 1);
      value >>= 1;
    }
    rev[i] = mirror;
  }
  return rev;
})();
const FFT_COS = new Float64Array(FFT_SIZE / 2);
const FFT_SIN = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i += 1) {
  FFT_COS[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  FFT_SIN[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}
const FFT_RE = new Float64Array(FFT_SIZE);
const FFT_IM = new Float64Array(FFT_SIZE);

function fftInPlace(): void {
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const j = FFT_REV[i];
    if (j > i) {
      const tr = FFT_RE[i];
      FFT_RE[i] = FFT_RE[j];
      FFT_RE[j] = tr;
      const ti = FFT_IM[i];
      FFT_IM[i] = FFT_IM[j];
      FFT_IM[j] = ti;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = FFT_COS[k * step];
        const wi = FFT_SIN[k * step];
        const a = start + k;
        const b = a + half;
        const xr = FFT_RE[b] * wr - FFT_IM[b] * wi;
        const xi = FFT_RE[b] * wi + FFT_IM[b] * wr;
        FFT_RE[b] = FFT_RE[a] - xr;
        FFT_IM[b] = FFT_IM[a] - xi;
        FFT_RE[a] += xr;
        FFT_IM[a] += xi;
      }
    }
  }
}

export function quranAsrFrames(sampleCount: number): number {
  return Math.floor((sampleCount + SHIFT / 2) / SHIFT);
}

/**
 * 80-pin log-mel fbank كما يحسبه sherpa-onnx على الهاتف:
 * نافذة povey 25ms، إزاحة 10ms، إزالة DC، pre-emphasis 0.97، FFT 512،
 * mel من 20Hz إلى 7600Hz، لوغاريتم بحد أدنى epsilon، بلا dither،
 * وreflect للحواف (snip_edges=false).
 */
export function quranAsrFbank(wave: Float32Array): Float32Array {
  const n = wave.length;
  const frames = quranAsrFrames(n);
  const features = new Float32Array(frames * QURAN_ASR_NUM_MELS);
  if (n === 0 || frames === 0) return features;
  const power = new Float64Array(FFT_SIZE / 2);
  const raw = new Float64Array(WINDOW_LENGTH);

  for (let t = 0; t < frames; t += 1) {
    const offset = t * SHIFT + SHIFT / 2 - WINDOW_LENGTH / 2;
    let mean = 0;
    for (let i = 0; i < WINDOW_LENGTH; i += 1) {
      let index = offset + i;
      if (index < 0) index = -index - 1;
      else if (index >= n) index = 2 * n - 1 - index;
      if (index < 0) index = 0;
      else if (index >= n) index = n - 1;
      const value = wave[index];
      raw[i] = value;
      mean += value;
    }
    mean /= WINDOW_LENGTH;
    let previous = 0;
    for (let i = 0; i < WINDOW_LENGTH; i += 1) {
      const centered = raw[i] - mean;
      const emphasized = i === 0 ? centered * (1 - 0.97) : centered - 0.97 * previous;
      previous = centered;
      FFT_RE[i] = emphasized * POVEY_WINDOW[i];
      FFT_IM[i] = 0;
    }
    for (let i = WINDOW_LENGTH; i < FFT_SIZE; i += 1) {
      FFT_RE[i] = 0;
      FFT_IM[i] = 0;
    }
    fftInPlace();
    for (let bin = 0; bin < FFT_SIZE / 2; bin += 1) {
      power[bin] = FFT_RE[bin] * FFT_RE[bin] + FFT_IM[bin] * FFT_IM[bin];
    }
    for (let m = 0; m < QURAN_ASR_NUM_MELS; m += 1) {
      let sum = 0;
      for (let k = MEL_OFFSETS[m]; k < MEL_OFFSETS[m + 1]; k += 1) {
        sum += power[MEL_INDICES[k]] * MEL_WEIGHTS[k];
      }
      features[t * QURAN_ASR_NUM_MELS + m] = Math.log(Math.max(sum, EPS));
    }
  }
  return features;
}

/* ------------------------------------------------------------------ */
/* إعادة العيّن إلى 16kHz                                              */
/* ------------------------------------------------------------------ */

function linearResample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  /* ترشيح بسيط مضاد للالتفاف عند التخفيض بمعدل صحيح (48k ← 16k: متوسط 3 عينات). */
  let source = input;
  const factor = Math.round(from / to);
  if (factor >= 2 && Math.abs(from / factor - to) < 1) {
    const length = Math.floor(input.length / factor);
    const filtered = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      let sum = 0;
      for (let k = 0; k < factor; k += 1) sum += input[i * factor + k];
      filtered[i] = sum / factor;
    }
    source = filtered;
    from = to;
  }
  const ratio = to / from;
  const length = Math.max(1, Math.round(source.length * ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i / ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, source.length - 1);
    const weight = position - left;
    output[i] = source[left] * (1 - weight) + source[right] * weight;
  }
  return output;
}

type OfflineAudioContextCtor = typeof OfflineAudioContext;

/**
 * يحوّل عيّنات الميكروفون إلى 16kHz أحادية. يستخدم OfflineAudioContext عندما
 * يتوفر (مُعيد تعيين عينات عالي الجودة داخل WebView)، وإلا يعود إلى مسار خطي
 * مع ترشيح مسبق.
 */
export async function resampleToQuranAsrRate(
  samples: Float32Array,
  sampleRate: number,
): Promise<Float32Array> {
  if (sampleRate === QURAN_ASR_SAMPLE_RATE || samples.length === 0) return samples;
  const scope = globalThis as unknown as {
    OfflineAudioContext?: OfflineAudioContextCtor;
    webkitOfflineAudioContext?: OfflineAudioContextCtor;
  };
  const Ctor = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  if (!Ctor) return linearResample(samples, sampleRate, QURAN_ASR_SAMPLE_RATE);
  try {
    const targetLength = Math.max(1, Math.ceil((samples.length * QURAN_ASR_SAMPLE_RATE) / sampleRate));
    const context = new Ctor(1, targetLength, QURAN_ASR_SAMPLE_RATE);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    return rendered.getChannelData(0).slice();
  } catch {
    return linearResample(samples, sampleRate, QURAN_ASR_SAMPLE_RATE);
  }
}

/* ------------------------------------------------------------------ */
/* الجهوزية والجلسة                                                    */
/* ------------------------------------------------------------------ */

export type QuranAsrWord = {
  text: string;
  startMs: number;
  endMs: number;
  /** متوسط احتمال رموز الكلمة (0..1) — يُستخدم لتمييز الخطأ المؤكد من المشكوك فيه. */
  confidence: number;
};

export type QuranAsrTranscription = {
  /** نص الكلمات كما يكتبه النموذج (رسم عثماني بلا تشكيل). */
  text: string;
  words: QuranAsrWord[];
  sampleCount: number;
  durationMs: number;
  featureMs: number;
  inferenceMs: number;
  modelBytes: number;
};

export type QuranAsrEngine = {
  transcribe(samples: Float32Array, sampleRate?: number): Promise<QuranAsrTranscription>;
  dispose(): Promise<void>;
  modelBytes: number;
  initializeMs: number;
};

function assetFor(manifest: BundleManifest, label: string) {
  return manifest.assets.find((asset) => asset.label === label) ?? null;
}

function assetUrl(base: string, path: string): string {
  const root = base.startsWith("/") ? base : `/${base}`;
  return `${root.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("التحقق من سلامة نموذج التلاوة يحتاج WebCrypto، وهو غير متاح في هذا العرض.");
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchVerified(url: string, bytes: number, sha256: string, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`ملف ${what} مفقود من الحزمة المضمَّنة (HTTP ${response.status}). أعد تثبيت التطبيق.`);
  const data = await response.arrayBuffer();
  if (data.byteLength !== bytes) {
    throw new Error(`حجم ${what} غير مطابق: ${data.byteLength} بدل ${bytes}. أعد تثبيت التطبيق.`);
  }
  if ((await sha256Hex(data)) !== sha256) {
    throw new Error(`بصمة ${what} غير مطابقة. أعد تثبيت التطبيق.`);
  }
  return data;
}

function parseTokens(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const tokens: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(.*)\s+(\d+)\s*$/);
    if (!match) throw new Error("ملف رموز النموذج تالف.");
    tokens[Number(match[2])] = match[1];
  }
  if (tokens.length !== 31 || tokens.some((token) => token === undefined)) {
    throw new Error("ملف رموز النموذج غير متوافق (المتوقع 31 رمزًا).");
  }
  return tokens;
}

export type QuranAsrSessionOptions = {
  numThreads?: number;
  wasmPaths?: { wasm: string; mjs: string } | string;
};

/**
 * ينشئ جلسة استدلال من بايتات النموذج. مكشوف للاختبار ولإعادة الاستخدام،
 * وليس مسارًا بديلًا للتنزيل.
 */
export async function createQuranAsrEngine(
  modelBytes: ArrayBuffer,
  tokensFile: string,
  options: QuranAsrSessionOptions = {},
): Promise<QuranAsrEngine> {
  const tokens = parseTokens(tokensFile);
  const startedAt = performance.now();
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = options.numThreads ?? 1;
  ort.env.wasm.simd = true;
  if (options.wasmPaths) {
    (ort.env.wasm as unknown as { wasmPaths: unknown }).wasmPaths = options.wasmPaths;
  }
  const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  const initializeMs = performance.now() - startedAt;
  let disposed = false;

  return {
    modelBytes: modelBytes.byteLength,
    initializeMs,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await session.release();
    },
    async transcribe(samples: Float32Array, sampleRate = QURAN_ASR_SAMPLE_RATE) {
      if (disposed) throw new Error("جلسة المحرك مغلقة.");
      const featureStart = performance.now();
      const wave = await resampleToQuranAsrRate(samples, sampleRate);
      const frames = quranAsrFrames(wave.length);
      if (frames === 0) {
        return {
          text: "",
          words: [],
          sampleCount: wave.length,
          durationMs: (wave.length / QURAN_ASR_SAMPLE_RATE) * 1000,
          featureMs: performance.now() - featureStart,
          inferenceMs: 0,
          modelBytes: modelBytes.byteLength,
        };
      }
      const features = quranAsrFbank(wave);
      const featureMs = performance.now() - featureStart;
      const inferenceStart = performance.now();
      const outputs = await session.run({
        x: new ort.Tensor("float32", features, [1, frames, QURAN_ASR_NUM_MELS]),
        x_lens: new ort.Tensor("int64", BigInt64Array.from([BigInt(frames)]), [1]),
      });
      const inferenceMs = performance.now() - inferenceStart;
      const logProbs = outputs.log_probs;
      const lengths = outputs.log_probs_len;
      const outputFrames = Number((lengths.data as BigInt64Array)[0]);
      const decoded = decodeCtc(
        logProbs.data as Float32Array,
        outputFrames,
        logProbs.dims[2],
        tokens,
      );
      return {
        ...decoded,
        sampleCount: wave.length,
        durationMs: (wave.length / QURAN_ASR_SAMPLE_RATE) * 1000,
        featureMs,
        inferenceMs,
        modelBytes: modelBytes.byteLength,
      };
    },
  };
}

const BLANK = 0;

/** فك ترميز CTC جشع مع أزمنة واحتمالات لكل كلمة. */
export function decodeCtc(
  logProbs: Float32Array,
  frames: number,
  classes: number,
  tokens: string[],
): { text: string; words: QuranAsrWord[] } {
  const words: QuranAsrWord[] = [];
  let current = "";
  let startFrame = 0;
  let endFrame = 0;
  let probability = 0;
  let emissions = 0;
  let previous = -1;

  const flush = () => {
    if (!current) return;
    words.push({
      text: current,
      startMs: startFrame * OUTPUT_FRAME_MS,
      endMs: (endFrame + 1) * OUTPUT_FRAME_MS,
      confidence: emissions > 0 ? probability / emissions : 0,
    });
    current = "";
    probability = 0;
    emissions = 0;
  };

  for (let t = 0; t < frames; t += 1) {
    const base = t * classes;
    let best = 0;
    let bestValue = logProbs[base];
    for (let c = 1; c < classes; c += 1) {
      const value = logProbs[base + c];
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    if (best === BLANK || best === previous) {
      previous = best;
      continue;
    }
    previous = best;
    const token = tokens[best] ?? "";
    if (token === "▁") {
      flush();
      startFrame = t;
      endFrame = t;
      continue;
    }
    if (!current) startFrame = t;
    current += token;
    endFrame = t;
    probability += Math.exp(bestValue);
    emissions += 1;
  }
  flush();

  return { text: words.map((word) => word.text).join(" "), words };
}

/**
 * يحمّل المحرك من الحزمة المضمَّنة (مرة واحدة، وتُعاد الجلسة نفسها بعدها).
 * `wasmPaths` اختياري للاختبار فقط (Node لا يستورد مسارًا مطلقًا كـ URL)؛
 * التطبيق لا يمرّره أبدًا فيستخدم مسارات الحزمة المضمَّنة.
 */
export function loadQuranAsr(options: { wasmPaths?: { wasm: string; mjs: string } | string } = {}): Promise<QuranAsrEngine | null> {
  if (engine) return Promise.resolve(engine);
  if (loadPromise) return loadPromise;
  const startedAt = performance.now();
  publish({ state: "loading", message: "", initializeMs: null });
  loadPromise = (async () => {
    const manifest = await loadQuranAsrManifest();
    if (!manifest) {
      throw new Error("لا توجد حزمة مضمَّنة لمحرك Quran ASR Small في هذه النسخة؛ لن يُستخدم أي تنزيل عبر الشبكة.");
    }
    const modelAsset = assetFor(manifest, "quran-asr-model");
    const tokensAsset = assetFor(manifest, "quran-asr-tokens");
    if (!modelAsset || !tokensAsset) {
      throw new Error("الحزمة المضمَّنة لا تحوي نموذج Quran ASR Small أو رموزه. أعد بناء التطبيق بالأصول الصحيحة.");
    }
    const wasm = assetFor(manifest, "wasm");
    const loader = assetFor(manifest, "wasm-loader");
    const [modelData, tokensData] = await Promise.all([
      fetchVerified(assetUrl(manifest.assetBase, modelAsset.path), modelAsset.bytes, modelAsset.sha256, "نموذج Quran ASR Small"),
      fetchVerified(assetUrl(manifest.assetBase, tokensAsset.path), tokensAsset.bytes, tokensAsset.sha256, "رموز Quran ASR Small"),
    ]);
    const tokens = new TextDecoder().decode(tokensData);
    const created = await createQuranAsrEngine(modelData, tokens, {
      numThreads: 1,
      wasmPaths: options.wasmPaths ?? (wasm && loader
        ? { wasm: assetUrl(manifest.assetBase, wasm.path), mjs: assetUrl(manifest.assetBase, loader.path) }
        : undefined),
    });
    engine = created;
    publish({
      state: "ready",
      message: "",
      bundled: true,
      modelBytes: created.modelBytes,
      initializeMs: performance.now() - startedAt,
    });
    return created;
  })().catch((error) => {
    loadPromise = null;
    engine = null;
    publish({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
      initializeMs: performance.now() - startedAt,
    });
    throw error instanceof Error ? error : new Error(String(error));
  });
  return loadPromise;
}

/** إعادة محاولة محلية فقط: تعيد قراءة الحزمة المضمَّنة، بلا أي شبكة. */
export function retryQuranAsr(): Promise<QuranAsrEngine | null> {
  engine = null;
  loadPromise = null;
  return loadQuranAsr();
}

export function resetQuranAsr(): void {
  const current = engine;
  engine = null;
  loadPromise = null;
  snapshot = { state: "idle", message: "", initializeMs: null, modelBytes: null, bundled: false };
  if (current) void current.dispose().catch(() => undefined);
}

/** تجهيز تلقائي بعد أول رسم، دون حجب الإقلاع. */
export function scheduleQuranAsrPreload(): void {
  if (typeof window === "undefined") return;
  const start = () => {
    void loadQuranAsr().catch(() => undefined);
  };
  const idle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof idle === "function") idle(start, { timeout: 2000 });
  else window.setTimeout(start, 0);
}

/** فك ترميز ملف صوتي (تسجيل أو ملف) إلى عيّنات أحادية، بلا شبكة. */
export async function decodeAudioToSamples(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) throw new Error("فك ترميز الصوت غير مدعوم في هذا العرض.");
  const context = new Ctor();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = buffer.numberOfChannels;
    const samples = new Float32Array(buffer.length);
    for (let c = 0; c < channels; c += 1) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < channel.length; i += 1) samples[i] += channel[i] / channels;
    }
    return { samples, sampleRate: buffer.sampleRate };
  } finally {
    void context.close().catch(() => undefined);
  }
}
