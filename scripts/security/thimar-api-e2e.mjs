#!/usr/bin/env node
/**
 * اختبار طرفي لواجهة الخادم كما يتصل بها التطبيق بالضبط (RPC واحد).
 * يستخدم مشروع الاختبار (Staging) فقط — لا يلمس الإنتاج.
 *
 *   node scripts/security/thimar-api-e2e.mjs
 *
 * المتغيران الاختياريان: THIMAR_TEST_URL و THIMAR_TEST_ANON_KEY.
 */
const URL = process.env.THIMAR_TEST_URL || "https://escgivknjyyryysbihws.supabase.co";
const KEY =
  process.env.THIMAR_TEST_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzY2dpdmtuanl5cnl5c2JpaHdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2OTgwMTcsImV4cCI6MjExMTI3NDAxN30.xmFBht0sxQN2zSCm-mE_suY6UXBcAvvJPykKhdydzOg";

const results = [];

function record(check, ok, detail = "") {
  results.push({ check, ok, detail });
}

async function api(op, data = {}, token = null) {
  const response = await fetch(`${URL}/rest/v1/rpc/thimar_api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ p_token: token, p_op: op, p_data: data }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const health = await api("health");
record("health over HTTP", health.status === 200 && health.body?.ok === true, JSON.stringify(health.body));

const wrong = await api("login", { username: "a_test", password: "definitely-wrong" });
record(
  "wrong password rejected over HTTP",
  wrong.status >= 400 && JSON.stringify(wrong.body).includes("INVALID_CREDENTIALS"),
  `${wrong.status} ${JSON.stringify(wrong.body)}`,
);

const login = await api("login", { username: "a_test", password: "pwA", platform: "e2e" });
const token = login.body?.token;
record("login returns a session token", typeof token === "string" && token.startsWith("ts_"), String(token).slice(0, 12));
record(
  "login response carries no password hash",
  !JSON.stringify(login.body ?? {}).includes("password"),
  "",
);

const pulled = await api("pull", {}, token);
const snapshot = pulled.body ?? {};
record(
  "pull returns only the caller's conversation",
  Array.isArray(snapshot.conversations) &&
    snapshot.conversations.length === 1 &&
    snapshot.conversations[0].id === "conv-AB",
  JSON.stringify(snapshot.conversations?.map((c) => c.id)),
);
record(
  "pull scopes messages",
  Array.isArray(snapshot.messages) && snapshot.messages.length === 2,
  String(snapshot.messages?.length),
);
record(
  "pull hides unrelated accounts",
  !(snapshot.accounts ?? []).some((a) => a.id === "acc-C"),
  JSON.stringify((snapshot.accounts ?? []).map((a) => a.id)),
);

const noToken = await api("pull", {});
record(
  "no token is rejected",
  noToken.status >= 400 && JSON.stringify(noToken.body).includes("UNAUTHENTICATED"),
  `${noToken.status}`,
);

const direct = await fetch(`${URL}/rest/v1/thimar_accounts?select=id,password_hash&limit=1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
record(
  "anon cannot read the accounts table directly",
  direct.status !== 200,
  `HTTP ${direct.status}`,
);

const directStorage = await fetch(`${URL}/storage/v1/object/public/thimar-chat-media/`, {
  headers: { apikey: KEY },
});
record(
  "media bucket is not public",
  directStorage.status !== 200,
  `HTTP ${directStorage.status}`,
);

const logout = await api("logout", {}, token);
record("logout revokes the session", logout.status === 200 && logout.body?.ok === true, JSON.stringify(logout.body));

const afterLogout = await api("pull", {}, token);
record(
  "revoked session is refused",
  afterLogout.status >= 400 && JSON.stringify(afterLogout.body).includes("UNAUTHENTICATED"),
  `${afterLogout.status}`,
);

const passed = results.filter((r) => r.ok).length;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
