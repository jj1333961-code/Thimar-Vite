import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!/^[a-f0-9]{64}$/i.test(token)) return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401, headers });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: session, error: sessionError } = await supabase.from("thimar_call_sessions").select("account_id").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError || !session) return new Response(JSON.stringify({ error: "INVALID_SESSION" }), { status: 401, headers });
    const { data: account, error: accountError } = await supabase.from("thimar_accounts").select("id,status,banned").eq("id", session.account_id).maybeSingle();
    if (accountError || !account || account.banned || account.status !== "active") return new Response(JSON.stringify({ error: "ACCOUNT_UNAVAILABLE" }), { status: 403, headers });
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const callerId = String(body.callerId ?? "").trim();
    if (!callerId || callerId !== session.account_id) return new Response(JSON.stringify({ error: "CALLER_IDENTITY_MISMATCH" }), { status: 403, headers });

    if (action === "create") {
      const calleeId = String(body.calleeId ?? "").trim();
      const mode = body.mode === "video" ? "video" : "audio";
      if (!callerId || !calleeId || calleeId === callerId) return new Response(JSON.stringify({ error: "INVALID_PARTICIPANTS" }), { status: 400, headers });
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
      const { data: callerRows } = await supabase.from("thimar_calls").select("id,state,expires_at").eq("caller_id", callerId).in("state", ACTIVE).order("created_at", { ascending: false }).limit(5);
      const callerActive = (callerRows ?? []).filter(isLive);
      if (callerActive.length) return new Response(JSON.stringify({ error: "CALLER_BUSY", callId: callerActive[0].id }), { status: 409, headers });
      const { data: calleeRows } = await supabase.from("thimar_calls").select("id,state,expires_at").eq("callee_id", calleeId).in("state", ACTIVE).order("created_at", { ascending: false }).limit(5);
      const calleeActive = (calleeRows ?? []).filter(isLive);
      if (calleeActive.length) return new Response(JSON.stringify({ error: "CALLEE_BUSY" }), { status: 409, headers });
      const timeoutSec = Math.min(Math.max(Number(body.timeoutSec ?? 60), 15), 120);
      const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();
      const { data: inserted, error } = await supabase.from("thimar_calls").insert({ caller_id: callerId, callee_id: calleeId, mode, state: "ringing", expires_at: expiresAt }).select("id, expires_at").single();
      if (error || !inserted) return new Response(JSON.stringify({ error: error?.message ?? "INSERT_FAILED" }), { status: 500, headers });
      return new Response(JSON.stringify({ callId: inserted.id, expiresAt: inserted.expires_at, state: "ringing" }), { status: 200, headers });
    }

    const callId = String(body.callId ?? "").trim();
    if (!callId) return new Response(JSON.stringify({ error: "MISSING_CALL_ID" }), { status: 400, headers });

    const { data: call, error: fetchErr } = await supabase.from("thimar_calls").select("*").eq("id", callId).maybeSingle();
    if (fetchErr || !call) return new Response(JSON.stringify({ error: "CALL_NOT_FOUND" }), { status: 404, headers });
    const isCaller = call.caller_id === callerId;
    const isCallee = call.callee_id === callerId;
    if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });

    const TERMINAL = ["rejected", "cancelled", "busy", "unavailable", "missed", "ended", "failed"];
    const expired = new Date(call.expires_at).getTime() < Date.now() && !TERMINAL.includes(call.state);

    if (action === "connecting" || action === "connected") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ error: "ALREADY_ENDED", state: call.state }), { status: 409, headers });
      const nextState = action === "connected" ? "connected" : "connecting";
      const allowedStates = action === "connected" ? ["accepted", "connecting", "connected"] : ["accepted", "connecting"];
      const { data: updated, error: updateError } = await supabase.from("thimar_calls")
        .update({ state: nextState, ...(action === "connected" ? { connected_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() })
        .eq("id", callId).in("state", allowedStates).select("id,state").maybeSingle();
      if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers });
      if (!updated) return new Response(JSON.stringify({ error: "INVALID_CALL_TRANSITION" }), { status: 409, headers });
      return new Response(JSON.stringify({ callId, state: nextState }), { status: 200, headers });
    }
    if (action === "accept") {
      if (!isCallee) return new Response(JSON.stringify({ error: "NOT_CALLEE" }), { status: 403, headers });
      if (expired) { await supabase.from("thimar_calls").update({ state: "missed", ended_at: new Date().toISOString(), end_reason: "expired" }).eq("id", callId); return new Response(JSON.stringify({ error: "EXPIRED" }), { status: 409, headers }); }
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ error: "ALREADY_ENDED", state: call.state }), { status: 409, headers });
      const { data: updated, error: upErr } = await supabase.from("thimar_calls").update({ state: "accepted", answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", callId).eq("callee_id", callerId).in("state", ["initiated", "ringing"]).select("id, state").maybeSingle();
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
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      await supabase.from("thimar_calls").update({ state: "missed", ended_at: new Date().toISOString(), end_reason: "missed", updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "missed" }), { status: 200, headers });
    }
    if (action === "end" || action === "hangup") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      const reason = String(body.reason ?? "ended").slice(0, 80);
      await supabase.from("thimar_calls").update({ state: "ended", ended_at: new Date().toISOString(), end_reason: reason, updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "ended" }), { status: 200, headers });
    }
    if (action === "failed") {
      if (!isCaller && !isCallee) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers });
      if (TERMINAL.includes(call.state)) return new Response(JSON.stringify({ callId, state: call.state }), { status: 200, headers });
      const reason = String(body.reason ?? "failed").slice(0, 80);
      await supabase.from("thimar_calls").update({ state: "failed", ended_at: new Date().toISOString(), end_reason: reason, updated_at: new Date().toISOString() }).eq("id", callId);
      return new Response(JSON.stringify({ callId, state: "failed" }), { status: 200, headers });
    }
    if (action === "get") return new Response(JSON.stringify({ call }), { status: 200, headers });
    return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});