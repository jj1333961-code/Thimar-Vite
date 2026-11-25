import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = (origin: string) => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
});

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacVerify(secret: string, message: string, signatureB64: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = b64urlDecode(signatureB64);
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(message));
}

async function verifySessionToken(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const ok = await hmacVerify(secret, `${header}.${payload}`, signature);
    if (!ok) return null;
    const decoded = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!decoded?.sub || typeof decoded.exp !== "number") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    if (decoded.scope !== "session") return null;
    return { sub: String(decoded.sub) };
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const signingSecret = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // --- Phase 1: verify signed session token, derive callerId server-side ---
    const authHeader = request.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const token = String(body.token ?? bearer ?? "").trim();
    const verified = token ? await verifySessionToken(token, signingSecret) : null;
    if (!verified) {
      return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401, headers });
    }
    const callerId = verified.sub;
    // Reject forged callerId if a (legacy) client still sends one.
    if (body.callerId && String(body.callerId).trim() !== callerId) {
      return new Response(JSON.stringify({ error: "CALLER_MISMATCH" }), { status: 403, headers });
    }

    if (action === "create") {
      const calleeId = String(body.calleeId ?? "").trim();
      const mode = body.mode === "video" ? "video" : "audio";
      if (!calleeId || calleeId === callerId) {
        return new Response(JSON.stringify({ error: "INVALID_PARTICIPANTS" }), { status: 400, headers });
      }
      const ACTIVE = ["initiated", "ringing", "accepted", "connecting", "connected"];
      const now = new Date().toISOString();
      await supabase
        .from("thimar_calls")
        .update({ state: "missed", ended_at: now, end_reason: "expired", updated_at: now })
        .in("state", ["initiated", "ringing"])
        .lt("expires_at", now);
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
      return new Response(JSON.stringify({ callId: inserted.id, expiresAt: inserted.expires_at, state: "ringing" }), { status: 200, headers });
    }

    const callId = String(body.callId ?? "").trim();
    if (!callId) {
      return new Response(JSON.stringify({ error: "MISSING_CALL_ID" }), { status: 400, headers });
    }

    const { data: call, error: fetchErr } = await supabase.from("thimar_calls").select("*").eq("id", callId).maybeSingle();
    if (fetchErr || !call) {
      return new Response(JSON.stringify({ error: "CALL_NOT_FOUND" }), { status: 404, headers });
    }
    const isCaller = call.caller_id === callerId;
    const isCallee = call.callee_id === callerId;
    if (!isCaller && !isCallee) {
      return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
    }

    const TERMINAL = ["rejected", "cancelled", "busy", "unavailable", "missed", "ended", "failed"];
    const expired = new Date(call.expires_at).getTime() < Date.now() && !TERMINAL.includes(call.state);

    if (action === "accept") {
      if (!isCallee) return new Response(JSON.stringify({ error: "NOT_CALLEE" }), { status: 403, headers });
      if (expired) {
        await supabase.from("thimar_calls").update({ state: "missed", ended_at: new Date().toISOString(), end_reason: "expired" }).eq("id", callId);
        return new Response(JSON.stringify({ error: "EXPIRED" }), { status: 409, headers });
      }
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ error: "ALREADY_ENDED", state: call.state }), { status: 409, headers });
      const { data: updated, error: upErr } = await supabase
        .from("thimar_calls")
        .update({ state: "accepted", answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", callId)
        .eq("callee_id", callerId)
        .in("state", ["initiated", "ringing"])
        .select("id, state")
        .maybeSingle();
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers });
      if (!updated) return new Response(JSON.stringify({ error: "DUPLICATE_OR_INVALID_ACCEPT" }), { status: 409, headers });
      return new Response(JSON.stringify({ callId, state: "accepted" }), { status: 200, headers });
    }
    if (action === "reject") {
      if (!isCallee) return new Response(JSON.stringify({ error: "NOT_CALLEE" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      await supabase.from("thimar_calls").update({ state: "rejected", ended_at: new Date().toISOString(), end_reason: "rejected", updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "rejected" }), { status: 200, headers });
    }
    if (action === "cancel") {
      if (!isCaller) return new Response(JSON.stringify({ error: "NOT_CALLER" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      await supabase.from("thimar_calls").update({ state: "cancelled", ended_at: new Date().toISOString(), end_reason: "cancelled", updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "cancelled" }), { status: 200, headers });
    }
    if (action === "missed" || action === "timeout") {
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      await supabase.from("thimar_calls").update({ state: "missed", ended_at: new Date().toISOString(), end_reason: "missed", updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "missed" }), { status: 200, headers });
    }
    if (action === "end" || action === "hangup") {
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      await supabase.from("thimar_calls").update({ state: "ended", ended_at: new Date().toISOString(), end_reason: "ended", updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "ended" }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "SERVER_ERROR" }), { status: 500, headers });
  }
});
