#!/usr/bin/env node
/**
 * Phase 1 security backup (read-only).
 *
 * Uses the public anon key only. It never writes to Supabase and never prints
 * row values. Tables that anon cannot read are recorded as inaccessible rather
 * than silently treated as empty.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SUPABASE_URL = "https://jbsvmpiwdwowizzfzlqr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk";
const PROJECT_REF = "jbsvmpiwdwowizzfzlqr";
const BUCKET = "thimar-chat-media";

const TABLES = [
  "_test_multi", "admins", "ai_question_history", "app_snapshots",
  "assignment_submissions", "assignments", "attendance", "daily_tasks",
  "exam_attempts", "exams", "extra_elements", "grades", "join_requests",
  "messages", "notifications", "proctor_events", "proctor_global_settings",
  "proctor_sessions", "proctoring_incidents", "profiles", "quran_bookmarks",
  "recitations", "record_elements", "repo_settings", "students", "subjects",
  "thimar_accounts", "thimar_auth_rate_limits", "thimar_binding_nonces",
  "thimar_calls", "thimar_challenge_events", "thimar_challenge_rooms",
  "thimar_chat_messages", "thimar_conversations", "thimar_deletions",
  "thimar_device_authorizations", "thimar_fcm_tokens", "thimar_link_requests",
  "thimar_memorization_plans", "thimar_notification_audit",
  "thimar_notifications", "thimar_push_config", "thimar_push_subscriptions",
  "thimar_runtime_flags", "thimar_tasmee_sessions", "thimar_update_notifications",
];

const STORAGE_OBJECTS = [
  "1795076782409-ii5rs6-voice-1795076782368.webm",
  "1795078547580-4td0yp-68456.jpeg",
  "1795080862717-w96xi3-voice-1795080862657.webm",
  "1795184398865-6x5wv6-voice-1795184398759.webm",
];

const root = join("backups", `security-phase1-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = join(root, "data");
const storageDir = join(root, "storage");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

async function exportTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  const response = await fetch(url, {
    headers: headers({
      Range: "0-9999",
      Prefer: "count=exact",
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return { table, accessible: false, status: response.status };
  }
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return { table, accessible: false, status: response.status, error: "invalid JSON" };
  }
  if (!Array.isArray(rows)) {
    return { table, accessible: false, status: response.status, error: "not an array" };
  }
  const payload = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFile(join(dataDir, `${table}.json`), payload, "utf8");
  const contentRange = response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/")[1]);
  return {
    table,
    accessible: true,
    rows: rows.length,
    reportedRows: Number.isFinite(total) ? total : null,
    sha256: sha256(payload),
  };
}

async function exportStorage() {
  const results = [];
  for (const name of STORAGE_OBJECTS) {
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (!response.ok) {
      results.push({ name, ok: false, status: response.status });
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(join(storageDir, name), bytes);
    results.push({
      name,
      ok: true,
      bytes: bytes.length,
      sha256: sha256(bytes),
      contentType: response.headers.get("content-type") || null,
    });
  }
  return results;
}

const startedAt = new Date().toISOString();
await mkdir(dataDir, { recursive: true });
await mkdir(storageDir, { recursive: true });

const tableResults = [];
for (const table of TABLES) tableResults.push(await exportTable(table));
const storageResults = await exportStorage();

const manifest = {
  projectRef: PROJECT_REF,
  startedAt,
  finishedAt: new Date().toISOString(),
  method: "PostgREST read-only export with public anon key + public storage object download",
  tables: tableResults,
  storage: storageResults,
  limitations: [
    "Tables not readable by the anon role are marked accessible:false; they were not dumped by this script.",
    "Storage list/objects were known from a read-only SQL inventory; this is not an exhaustive bucket scan.",
    "Schema DDL and RLS definitions are not included in this data manifest.",
  ],
};
const manifestPayload = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(join(root, "manifest.json"), manifestPayload, "utf8");
await writeFile(join(root, "manifest.sha256"), `${sha256(manifestPayload)}  manifest.json\n`, "utf8");

console.log(JSON.stringify({
  root,
  accessibleTables: tableResults.filter((r) => r.accessible).length,
  inaccessibleTables: tableResults.filter((r) => !r.accessible).map((r) => r.table),
  storageObjects: storageResults.filter((r) => r.ok).length,
  manifestSha256: sha256(manifestPayload),
}, null, 2));
