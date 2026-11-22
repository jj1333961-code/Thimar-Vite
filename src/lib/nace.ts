/**
 * Drex من Nace — أسئلة مُصنّفة على حالة واقعة، مع احتمال مُعاير لكل خيار.
 *
 * مفتاح NACE_API_KEY سري ولا تسمح CORS للمتصفح بمناداة /v1 مباشرة، لذلك تمر
 * الطلبات عبر وسيط التطوير `/api/nace/decide` في `vite.config.ts` الذي يقرأ
 * المفتاح على الخادم ويطلب نموذج Drex.
 */

export type NaceState =
  | string
  | number
  | boolean
  | null
  | NaceState[]
  | { [key: string]: NaceState };

export type NaceNoulQuestion = {
  type: "noul";
  instructions?: string;
  criteria?: { true?: string; false?: string };
};

export type NaceChoiceQuestion = {
  type: "choice";
  instructions?: string;
  criteria: Record<string, string | null>;
};

export type NaceScoreQuestion = {
  type: "score";
  instructions?: string;
  criteria: [string, ...string[]];
};

export type NaceQuestion = NaceNoulQuestion | NaceChoiceQuestion | NaceScoreQuestion;

/** احتمال "نعم" من صفر إلى واحد. */
export type NaceNoulAnswer = {
  type: "noul";
  noul: number;
  confidence?: number;
};

/** الخيار المختار مع احتمال لكل تسمية عرّفتها في criteria. */
export type NaceChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

/** درجة متوقّعة قد تقع بين مستويين، مع احتمال لكل مستوى. */
export type NaceScoreAnswer = {
  type: "score";
  score: number;
  legend: string[];
  confidence: number;
  probabilities: Record<string, number>;
};

export type NaceAnswer = NaceNoulAnswer | NaceChoiceAnswer | NaceScoreAnswer;

export type NaceDecision = {
  model: string;
  answers: Record<string, NaceAnswer>;
  requestId?: string;
};

export class NaceRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "NaceRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function naceConfigured(): Promise<boolean> {
  try {
    const response = await fetch("/api/nace/health", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { configured?: boolean };
    return data.configured === true;
  } catch {
    return false;
  }
}

/** يسأل Drex أسئلة مُصنّفة عن حالة واقعة واحدة، ويُعيد الإجابات المُعايرة. */
export async function askDrex(
  state: NaceState,
  questions: Record<string, NaceQuestion>,
  options: { model?: string; signal?: AbortSignal } = {},
): Promise<NaceDecision> {
  const response = await fetch("/api/nace/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ state, questions, model: options.model }),
    signal: options.signal,
  });
  const data = (await response.json().catch(() => null)) as {
    model?: string;
    answers?: Record<string, NaceAnswer>;
    request_id?: string;
    error?: string;
    detail?: string;
  } | null;
  if (!response.ok) {
    throw new NaceRequestError(
      data?.error ?? "NACE_REQUEST_FAILED",
      data?.detail ?? `HTTP ${response.status}`,
      response.status,
    );
  }
  if (!data?.answers || typeof data.answers !== "object") {
    throw new NaceRequestError("NACE_EMPTY_ANSWER", "لم يُعِد Drex أي إجابات.");
  }
  return { model: data.model ?? "", answers: data.answers, requestId: data.request_id };
}

export type NaceOption = { label: string; probability: number };

/** يرتّب خيارات سؤال choice بحسب الاحتمال المُعاير، الأعلى أولًا. */
export function rankOptions(answer: NaceChoiceAnswer): NaceOption[] {
  return Object.entries(answer.probabilities)
    .map(([label, probability]) => ({ label, probability }))
    .sort((a, b) => b.probability - a.probability);
}

export type NaceRoute = {
  route: string;
  probability: number;
  confident: boolean;
  ranked: NaceOption[];
};

/**
 * يوجّه القرار بحسب احتمال كل خيار: يأخذ الأعلى إن بلغ الحد الأدنى، وإلا
 * يُعيد المسار الآمن (`fallback`) مع `confident: false` بدل التخمين.
 */
export function routeChoice(
  answer: NaceChoiceAnswer,
  fallback: string,
  minProbability = 0.6,
): NaceRoute {
  const ranked = rankOptions(answer);
  const top = ranked[0] ?? { label: fallback, probability: 0 };
  const confident = top.probability >= minProbability;
  return {
    route: confident ? top.label : fallback,
    probability: top.probability,
    confident,
    ranked,
  };
}

/** يقارن احتمال "نعم" المُعاير بحدّ صريح؛ الحد الأعلى يقلّل الإيجابيات الكاذبة. */
export function isYes(answer: NaceNoulAnswer, threshold = 0.5): boolean {
  return answer.noul > threshold;
}
