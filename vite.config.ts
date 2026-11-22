import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { APIError, NaceClient, choice, noul, score, type Questions } from "nace-sdk";
// @ts-expect-error — وحدة مشتركة مكتوبة بـ JavaScript للـWorker والمعاينة المحلية.
import { resolveTafsir } from "./freebuff-sites-build/tafsir.mjs";
import type { NaceQuestion, NaceState } from "./src/lib/nace";

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

type ProxyConfig = {
  apiKey: string;
  base: string;
  model: string;
};

function payloadTooLarge(): Error {
  const error = new Error("الطلب أكبر من الحد المسموح.");
  error.name = "PayloadTooLargeError";
  return error;
}

function readBody(request: IncomingMessage, limit = 64_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(payloadTooLarge());
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function aiProxyPlugin(config: ProxyConfig): Plugin {
  return {
    name: "thimar-ai-proxy",
    configureServer(server) {
      server.middlewares.use("/api/ai/health", (_request, response) => {
        sendJson(response, 200, {
          configured: Boolean(config.apiKey),
          model: config.model,
        });
      });

      server.middlewares.use("/api/ai/chat", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return;
        }
        if (!config.apiKey) {
          sendJson(response, 501, { error: "AI_NOT_CONFIGURED" });
          return;
        }
        try {
          const raw = await readBody(request);
          const body = JSON.parse(raw) as {
            messages?: Array<{ role: string; content: string }>;
            temperature?: number;
            max_tokens?: number;
          };
          if (!Array.isArray(body.messages) || body.messages.length === 0) {
            sendJson(response, 400, { error: "MESSAGES_REQUIRED" });
            return;
          }
          const upstream = await fetch(`${config.base}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: body.messages,
              temperature: Math.min(1, Math.max(0, body.temperature ?? 0.4)),
              max_tokens: Math.min(1200, Math.max(64, body.max_tokens ?? 500)),
            }),
            signal: AbortSignal.timeout(30_000),
          });
          const text = await upstream.text();
          if (!upstream.ok) {
            sendJson(response, 502, {
              error: "UPSTREAM_ERROR",
              status: upstream.status,
              detail: text.slice(0, 500),
            });
            return;
          }
          const data = JSON.parse(text) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = data.choices?.[0]?.message?.content?.trim();
          if (!content) {
            sendJson(response, 502, { error: "EMPTY_AI_RESPONSE" });
            return;
          }
          sendJson(response, 200, { content });
        } catch (error) {
          sendJson(response, 500, {
            error: "AI_PROXY_ERROR",
            detail: error instanceof Error ? error.message : "unknown",
          });
        }
      });
    },
  };
}

const NACE_MAX_BODY_CHARS = 262_144;
const NACE_MAX_QUESTIONS = 32;

class NaceInputError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "NaceInputError";
    this.code = code;
    this.status = status;
  }
}

/** يتحقق من سؤال واحد ويحوّله إلى صيغة Drex المُصنّفة (noul / choice / score). */
function readNaceQuestion(id: string, value: unknown) {
  const question = value as NaceQuestion | null;
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new NaceInputError("QUESTION_INVALID", `${id} must be a question object.`);
  }
  const instructions =
    typeof question.instructions === "string" ? question.instructions.trim() : "";
  if (question.type === "noul") {
    const criteria = question.criteria ?? null;
    if (!instructions && (!criteria || Object.keys(criteria).length === 0)) {
      throw new NaceInputError("QUESTION_INVALID", `${id} needs instructions or criteria.`);
    }
    return noul(instructions || null, criteria);
  }
  if (question.type === "choice") {
    const criteria = question.criteria;
    if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
      throw new NaceInputError("QUESTION_INVALID", `${id} needs criteria labels.`);
    }
    const labels: Record<string, string | null> = {};
    for (const [label, description] of Object.entries(criteria)) {
      if (!label.trim()) {
        throw new NaceInputError("QUESTION_INVALID", `${id} has an empty label.`);
      }
      if (description !== null && typeof description !== "string") {
        throw new NaceInputError("QUESTION_INVALID", `${id}.${label} must be text or null.`);
      }
      labels[label] = typeof description === "string" ? description.trim() : null;
    }
    if (Object.keys(labels).length === 0) {
      throw new NaceInputError("QUESTION_INVALID", `${id} needs at least one label.`);
    }
    return choice(instructions || null, labels);
  }
  if (question.type === "score") {
    const criteria = question.criteria;
    if (
      !Array.isArray(criteria) ||
      criteria.length === 0 ||
      criteria.length > 255 ||
      criteria.some((level) => typeof level !== "string" || !level.trim())
    ) {
      throw new NaceInputError("QUESTION_INVALID", `${id} needs 1-255 non-empty score levels.`);
    }
    return score(
      instructions || null,
      criteria.map((level: string) => level.trim()) as [string, ...string[]],
    );
  }
  throw new NaceInputError("QUESTION_TYPE_UNKNOWN", `${id} has an unsupported type.`);
}

function readNaceQuestions(raw: unknown): Questions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NaceInputError("QUESTIONS_REQUIRED", "questions must be an object keyed by question id.");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > NACE_MAX_QUESTIONS) {
    throw new NaceInputError("QUESTIONS_INVALID", `questions must hold 1-${NACE_MAX_QUESTIONS} entries.`);
  }
  const questions: Questions = {};
  for (const [rawId, value] of entries) {
    const id = rawId.trim();
    if (!id) throw new NaceInputError("QUESTION_INVALID", "question ids must not be empty.");
    questions[id] = readNaceQuestion(id, value);
  }
  return questions;
}

function naceProxyPlugin(config: { apiKey: string; model: string }): Plugin {
  const client = config.apiKey
    ? new NaceClient({
        apiKey: config.apiKey,
        defaultModel: config.model,
        clientInfo: "thimar/0.1.0",
      })
    : null;

  return {
    name: "thimar-nace-proxy",
    configureServer(server) {
      server.middlewares.use("/api/nace/health", (_request, response) => {
        sendJson(response, 200, { configured: Boolean(client), model: config.model });
      });

      server.middlewares.use("/api/nace/decide", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return;
        }
        if (!client) {
          sendJson(response, 501, { error: "NACE_NOT_CONFIGURED" });
          return;
        }
        try {
          const raw = await readBody(request, NACE_MAX_BODY_CHARS);
          const body = JSON.parse(raw) as { state?: unknown; questions?: unknown; model?: unknown };
          if (body.state === undefined) {
            throw new NaceInputError("STATE_REQUIRED", "state is required.");
          }
          const state = body.state as NaceState;
          if ((JSON.stringify(state) ?? "").length > NACE_MAX_BODY_CHARS) {
            throw new NaceInputError("STATE_TOO_LONG", "state exceeds the request limit.", 413);
          }
          const questions = readNaceQuestions(body.questions);
          const model =
            typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.model;
          const result = await client.systemOne({ state, questions, model });
          sendJson(response, 200, {
            model: result.model,
            answers: result.answers,
            usage: result.usage,
            evaluation_time_ms: result.evaluation_time_ms,
            request_id: result.request_id,
          });
        } catch (error) {
          if (error instanceof NaceInputError) {
            sendJson(response, error.status, { error: error.code, detail: error.message });
            return;
          }
          if (error instanceof APIError) {
            sendJson(response, error.status, {
              error: "NACE_API_ERROR",
              status: error.status,
              detail: error.message,
              request_id: error.requestId,
            });
            return;
          }
          if (error instanceof Error && error.name === "PayloadTooLargeError") {
            sendJson(response, 413, { error: "PAYLOAD_TOO_LARGE", detail: error.message });
            return;
          }
          sendJson(response, 502, {
            error: "NACE_PROXY_ERROR",
            detail: error instanceof Error ? error.message : "unknown",
          });
        }
      });
    },
  };
}

function tafsirProxyPlugin(apiKey: string): Plugin {
  return {
    name: "thimar-tafsir-proxy",
    configureServer(server) {
      server.middlewares.use("/api/tafsir", async (request, response) => {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return;
        }
        if (!apiKey) {
          sendJson(response, 501, { error: "YOUTUBE_NOT_CONFIGURED" });
          return;
        }
        const params = new URL(request.url ?? "/", "http://localhost").searchParams;
        const book = params.get("book") === "tuhfa" ? "tuhfa" : "quran";
        const from = Math.max(1, Number(params.get("from") ?? 1) || 1);
        const to = Math.max(from, Number(params.get("to") ?? from) || from);
        const surahName = (params.get("surah") ?? "").slice(0, 80);
        try {
          const result = await resolveTafsir({ key: apiKey, book, surahName, from, to });
          if (!result) {
            sendJson(response, 404, { error: "NO_MATCH" });
            return;
          }
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 502, {
            error: "YOUTUBE_ERROR",
            detail: error instanceof Error ? error.message : "unknown",
          });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // يقبل مفتاحًا عامًا أو مفاتيح المزوّدين الشائعة مباشرة.
  const geminiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  const openrouterKey = (env.OPENROUTER_API_KEY || "").trim();
  const apiKey = (env.AI_API_KEY || geminiKey || openrouterKey).trim();
  const base = (
    env.AI_API_BASE ||
    (geminiKey
      ? "https://generativelanguage.googleapis.com/v1beta/openai"
      : openrouterKey
        ? "https://openrouter.ai/api/v1"
        : "https://api.z.ai/api/paas/v4")
  ).replace(/\/+$/, "");
  const model =
    env.AI_MODEL ||
    (geminiKey ? "gemini-3.8-flash" : openrouterKey ? "google/gemini-3.5-flash" : "glm-4.7-flash");
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
  const youtubeKey = (env.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY ?? "").trim();
  // Nace Drex — المفتاح سري ويبقى على الخادم؛ الواجهة تنادي /api/nace/decide فقط.
  const naceKey = (env.NACE_API_KEY ?? process.env.NACE_API_KEY ?? "").trim();
  const naceModel = (env.NACE_DREX_MODEL ?? process.env.NACE_DREX_MODEL ?? "").trim() || "drex-latest";

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnon),
    },
    plugins: [
      react(),
      aiProxyPlugin({ apiKey, base, model }),
      tafsirProxyPlugin(youtubeKey),
      naceProxyPlugin({ apiKey: naceKey, model: naceModel }),
    ],
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : [".style.dev"],
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : [".style.dev"],
    },
  };
});
