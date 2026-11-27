import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/*
 * هوية المتصل لا تُقرأ من جسم الطلب: تُستخرج من رمز جلسة موقّع (HMAC-SHA256)
 * يُصدره الخادم في thimar-session بعد التحقق من كلمة المرور.
 *
 * CALLS_REQUIRE_SESSION=false مسار انتقالي للعملاء القدامى الذين لا يملكون
 * رمزًا بعد؛ ومع غيابه تُرفض الطلبات (فشل مُغلق) لأن السرّ غير مُعد.
 */

const textEncoder = new TextEncoder();

function b64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(message)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * مفتاح توقيع الجلسة: SESSION_SIGNING_SECRET إن وُجد، وإلا مفتاح مشتق من
 * مفتاح الخدمة حتى لا نضع سرًّا جديدًا في الكود أو في السجلات. الدالتان
 * thimar-session وthimar-calls تشتقّان المفتاح نفسه بنفس الطريقة.
 */
async function sessionSigningKey(): Promise<string> {
  const explicit = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";
  if (explicit) return explicit;
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base) return "";
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(`thimar-session-v1:${base}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** يتحقق من رمز الجلسة ويعيد معرّف الحساب، أو null إن كان الرمز غير صالح/منتهٍ. */
async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;
  let parsedHeader: { alg?: string };
  let parsedPayload: { sub?: unknown; exp?: unknown; scope?: unknown };
  try {
    parsedHeader = JSON.parse(new TextDecoder().decode(b64urlToBytes(header)));
    parsedPayload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (parsedHeader.alg !== "HS256") return null;
  if (parsedPayload.scope !== "session") return null;
  const expected = await hmacSign(secret, `${header}.${payload}`);
  let provided: Uint8Array;
  try {
    provided = b64urlToBytes(signature);
  } catch {
    return null;
  }
  if (!bytesEqual(expected, provided)) return null;
  const exp = Number(parsedPayload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  const sub = typeof parsedPayload.sub === "string" ? parsedPayload.sub.trim() : "";
  return sub || null;
}

Deno.serve(async (request) => {
  // CORS preflight must explicitly allow the headers used by the web app and Android WebView.
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    /* ---------- الهوية: من الرمز الموقّع فقط ---------- */
    const signingSecret = await sessionSigningKey();
    const requireSession = (Deno.env.get("CALLS_REQUIRE_SESSION") ?? "true").toLowerCase() !== "false";
    const authHeader = request.headers.get("Authorization") ?? "";
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const bearer = bearerMatch ? bearerMatch[1].trim() : "";
    let callerId = "";
    if (bearer) {
      const verified = await verifySessionToken(bearer, signingSecret);
      if (verified) {
        callerId = verified;
      } else if (!requireSession && !signingSecret) {
        callerId = String(body.callerId ?? "").trim();
      } else {
        return new Response(JSON.stringify({ error: "INVALID_SESSION" }), { status: 401, headers });
      }
    } else if (requireSession) {
      if (!signingSecret) {
        return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 503, headers });
      }
      return new Response(JSON.stringify({ error: "SESSION_REQUIRED" }), { status: 401, headers });
    } else {
      callerId = String(body.callerId ?? "").trim();
    }
    if (!callerId) return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401, headers });

    if (action === "create") {
      const calleeId = String(body.calleeId ?? "").trim();
      const mode = body.mode === "video" ? "video" : "audio";
      if (!calleeId || calleeId === callerId) {
        return new Response(JSON.stringify({ error: "INVALID_PARTICIPANTS" }), { status: 400, headers });
      }
      /* الطرفان يجب أن يكونا حسابين قائمين ونشطَين — لا اتصال بحساب محظور أو وهمي. */
      const { data: participants } = await supabase
        .from("thimar_accounts")
        .select("id,status,banned")
        .in("id", [callerId, calleeId]);
      const accountOk = (id: string) => {
        const row = (participants ?? []).find((item) => item.id === id);
        return !!row && !row.banned && row.status !== "pending" && row.status !== "rejected";
      };
      if (!accountOk(callerId)) {
        return new Response(JSON.stringify({ error: "CALLER_NOT_ACTIVE" }), { status: 403, headers });
      }
      if (!accountOk(calleeId)) {
        return new Response(JSON.stringify({ error: "CALLEE_UNAVAILABLE" }), { status: 404, headers });
      }
      const ACTIVE = ["initiated", "ringing", "accepted", "connecting", "connected"];
      const now = new Date().toISOString();
      // المكالمة الرنّانة التي انتهت مهلتها كانت تبقى "نشطة" للأبد فيمنع صاحبها من
      // الاتصال مرة أخرى. نُقفلها هنا قبل فحص الانشغال (نفس ما يفعله accept).
      await supabase
        .from("thimar_calls")
        .update({ state: "missed", ended_at: now, end_reason: "expired", updated_at: now })
        .in("state", ["initiated", "ringing"])
        .lt("expires_at", now);
      // المكالمة المتصلة تبقى نشطة مهما مرّ وقت؛ الرنّانة تُحسب نشطة فقط قبل انتهاء مهلتها.
      const isLive = (row: { state: string; expires_at: string }) =>
        ["accepted", "connecting", "connected"].includes(row.state) ||
        new Date(row.expires_at).getTime() > Date.now();
      const { data: callerRows } = await supabase
        .from("thimar_calls")
        .select("id,state,expires_at")
        .eq("caller_id", callerId)
        .in("state", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(5);
      const callerActive = (callerRows ?? []).filter(isLive);
      if (callerActive.length) {
        return new Response(JSON.stringify({ error: "CALLER_BUSY", callId: callerActive[0].id }), { status: 409, headers });
      }
      const { data: calleeRows } = await supabase
        .from("thimar_calls")
        .select("id,state,expires_at")
        .eq("callee_id", calleeId)
        .in("state", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(5);
      const calleeActive = (calleeRows ?? []).filter(isLive);
      if (calleeActive.length) {
        return new Response(JSON.stringify({ error: "CALLEE_BUSY" }), { status: 409, headers });
      }
      const timeoutSec = Math.min(Math.max(Number(body.timeoutSec ?? 60), 15), 120);
      const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();
      const { data: inserted, error } = await supabase
        .from("thimar_calls")
        .insert({ caller_id: callerId, callee_id: calleeId, mode, state: "ringing", expires_at: expiresAt })
        .select("id, expires_at")
        .single();
      if (error || !inserted) {
        return new Response(JSON.stringify({ error: error?.message ?? "INSERT_FAILED" }), { status: 500, headers });
      }
      return new Response(
        JSON.stringify({ callId: inserted.id, expiresAt: inserted.expires_at, state: "ringing" }),
        { status: 200, headers },
      );
    }

    /**
     * مكالمة رنين قائمة لهذا المستخدم (المستقبِل).
     *
     * Supabase Realtime يبثّ الدعوة مرة واحدة ولا يحتفظ بها، وسياسات RLS على
     * جدول thimar_calls تمنع عميل المتصفح (anon) من قراءته. لذلك نُعيد للمستقبِل
     * أحدث مكالمة رنين لم ينتهِ وقتها، ليكتمل مسار الاستقبال حتى لو ضاعت الدعوة.
     */
    if (action === "pending") {
      const nowIso = new Date().toISOString();
      const { data: rows, error } = await supabase
        .from("thimar_calls")
        .select("id,mode,caller_id,state,expires_at,created_at")
        .eq("callee_id", callerId)
        .in("state", ["initiated", "ringing"])
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      const row = (rows ?? [])[0];
      if (!row) return new Response(JSON.stringify({ call: null }), { status: 200, headers });
      const { data: callerRow } = await supabase
        .from("thimar_accounts")
        .select("full_name")
        .eq("id", row.caller_id)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          call: {
            callId: row.id,
            from: row.caller_id,
            fromName: callerRow?.full_name ?? "",
            mode: row.mode,
            state: row.state,
            expiresAt: row.expires_at,
          },
        }),
        { status: 200, headers },
      );
    }

    const callId = String(body.callId ?? "").trim();
    if (!callId) return new Response(JSON.stringify({ error: "MISSING_CALL_ID" }), { status: 400, headers });

    const { data: call, error: fetchErr } = await supabase
      .from("thimar_calls")
      .select("*")
      .eq("id", callId)
      .maybeSingle();
    if (fetchErr || !call) return new Response(JSON.stringify({ error: "CALL_NOT_FOUND" }), { status: 404, headers });

    const isCaller = call.caller_id === callerId;
    const isCallee = call.callee_id === callerId;
    if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });

    const TERMINAL = ["rejected", "cancelled", "busy", "unavailable", "missed", "ended", "failed"];
    const expired = new Date(call.expires_at).getTime() < Date.now() && !TERMINAL.includes(call.state);

    if (action === "accept") {
      if (!isCallee) return new Response(JSON.stringify({ error: "NOT_CALLEE" }), { status: 403, headers });
      if (expired) {
        await supabase
          .from("thimar_calls")
          .update({ state: "missed", ended_at: new Date().toISOString(), end_reason: "expired" })
          .eq("id", callId);
        return new Response(JSON.stringify({ error: "EXPIRED" }), { status: 409, headers });
      }
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ error: "ALREADY_ENDED", state: call.state }), { status: 409, headers });
      }
      const { data: updated, error: upErr } = await supabase
        .from("thimar_calls")
        .update({ state: "accepted", answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", callId)
        .eq("callee_id", callerId)
        .in("state", ["initiated", "ringing"])
        .select("id, state")
        .maybeSingle();
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers });
      if (!updated) {
        return new Response(JSON.stringify({ error: "DUPLICATE_OR_INVALID_ACCEPT" }), { status: 409, headers });
      }
      return new Response(JSON.stringify({ callId, state: "accepted" }), { status: 200, headers });
    }

    if (action === "reject") {
      if (!isCallee) return new Response(JSON.stringify({ error: "NOT_CALLEE" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      }
      await supabase
        .from("thimar_calls")
        .update({
          state: "rejected",
          ended_at: new Date().toISOString(),
          end_reason: "rejected",
          updated_at: new Date().toISOString(),
        })
        .eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "rejected" }), { status: 200, headers });
    }

    if (action === "cancel") {
      if (!isCaller) return new Response(JSON.stringify({ error: "NOT_CALLER" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      }
      await supabase
        .from("thimar_calls")
        .update({
          state: "cancelled",
          ended_at: new Date().toISOString(),
          end_reason: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "cancelled" }), { status: 200, headers });
    }

    if (action === "missed" || action === "timeout") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      }
      await supabase
        .from("thimar_calls")
        .update({
          state: "missed",
          ended_at: new Date().toISOString(),
          end_reason: "missed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "missed" }), { status: 200, headers });
    }

    if (action === "end" || action === "hangup") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      }
      const reason = String(body.reason ?? "ended").slice(0, 80);
      await supabase
        .from("thimar_calls")
        .update({
          state: "ended",
          ended_at: new Date().toISOString(),
          end_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "ended" }), { status: 200, headers });
    }

    if (action === "failed") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) {
        return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      }
      const reason = String(body.reason ?? "failed").slice(0, 80);
      await supabase
        .from("thimar_calls")
        .update({
          state: "failed",
          ended_at: new Date().toISOString(),
          end_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "failed" }), { status: 200, headers });
    }

    if (action === "get") return new Response(JSON.stringify({ call }), { status: 200, headers });

    return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});
