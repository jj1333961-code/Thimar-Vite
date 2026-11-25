import { handlePush } from "./freebuff-sites-build/push.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.5-flash";
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"];

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // إشعارات الدفع (Web Push + FCM) — تعمل والتطبيق مغلق.
    if (url.pathname.startsWith("/api/push/")) {
      const handled = await handlePush(request, env, url);
      if (handled) return handled;
    }

    if (url.pathname === "/api/ai/health") {
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      return json(200, {
        configured: Boolean(key),
        model: DEFAULT_MODEL,
        models: MODELS,
      });
    }

    if (url.pathname === "/api/ai/chat") {
      if (request.method === "OPTIONS") {
        return new Response("ok", {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        });
      }
      if (request.method !== "POST") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      if (!key) {
        return json(501, { error: "AI_NOT_CONFIGURED" });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "INVALID_JSON" });
      }
      if (!Array.isArray(body?.messages) || body.messages.length === 0) {
        return json(400, { error: "MESSAGES_REQUIRED" });
      }
      const upstream = await fetch(`${GEMINI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: body.messages,
          temperature: Math.min(1, Math.max(0, body.temperature ?? 0.4)),
          max_tokens: Math.min(1200, Math.max(64, body.max_tokens ?? 500)),
        }),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        return json(502, {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          detail: text.slice(0, 500),
        });
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return json(502, { error: "INVALID_UPSTREAM_RESPONSE" });
      }
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return json(502, { error: "EMPTY_AI_RESPONSE" });
      }
      return json(200, { content, model: data?.model || DEFAULT_MODEL });
    }

    return env.ASSETS.fetch(request);
  },
};