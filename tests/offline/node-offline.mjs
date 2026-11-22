// Offline recitation verification (local/desktop lane).
//
// Runs the shipped @tilawa/core engine — the same engine and the same int8
// models that are packaged inside the APK — on real recorded recitation, with
// no network available. It:
//   1. re-verifies every model/reference file against the engine's registry
//      manifest (size + SHA-256),
//   2. loads the model and reports load time,
//   3. feeds real audio through a free-recitation session and a memorization
//      session, collecting word-level position events and confirmed mistakes,
//   4. attempts outbound HTTP to prove the network is genuinely absent.
//
// Usage:
//   node tests/offline/node-offline.mjs --tier lite --models <dir> \
//     --reference <ref-v2.json> --wav <a.wav> [--wav <b.wav>] --out <file>

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createTilawa, readWav } from "@tilawa/core/node";
import { MODEL_REGISTRY } from "@tilawa/core";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const tier = opt("tier", "lite");
const modelDir = opt("models");
const referencePath = opt("reference");
const outPath = opt("out", "/tmp/offline-result.json");
const wavs = all("wav");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const started = Date.now();
const result = {
  lane: "desktop-local-node",
  tier,
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  startedAt: new Date().toISOString(),
  network: null,
  assets: null,
  load: null,
  free: null,
  memorization: null,
  errors: [],
};

// 1) Network must be absent. This is recorded as evidence, not assumed.
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const res = await fetch("https://tilawa.dev/v1/health", { signal: controller.signal });
  clearTimeout(timer);
  result.network = { reachable: true, status: res.status };
} catch (error) {
  result.network = { reachable: false, error: error instanceof Error ? error.message : String(error) };
}

// 2) Verify the model + reference bytes against the registry manifest.
const entry = MODEL_REGISTRY.tiers.find((t) => t.tier === tier);
if (!entry) throw new Error(`unknown tier ${tier}`);
const manifestPath = `${modelDir}/manifest.json`;
const modelPath = `${modelDir}/${entry.manifest.file}`;
const modelBytes = await readFile(modelPath);
const refBytes = await readFile(referencePath);
const modelDigest = sha256(modelBytes);
result.assets = {
  model: {
    path: modelPath,
    bytes: modelBytes.length,
    expectedBytes: entry.manifest.bytes,
    sha256: modelDigest,
    expectedSha256: entry.manifest.sha256,
    ok: modelBytes.length === entry.manifest.bytes && modelDigest === entry.manifest.sha256,
  },
  reference: {
    path: referencePath,
    bytes: refBytes.length,
    sha256: sha256(refBytes),
  },
};
if (!result.assets.model.ok) throw new Error("model bytes do not match the registry manifest");

// 3) Load the engine from the local model directory only.
const reference = JSON.parse(refBytes.toString("utf8"));
const loadStart = Date.now();
const tilawa = await createTilawa({
  tier,
  modelDir,
  reference,
  threads: 1,
  onProgress: (p) => result.errors.push({ progress: p }),
});
result.errors = [];
result.load = { ms: Date.now() - loadStart, model: tilawa.model, capabilities: tilawa.capabilities };

const ref = (word) => (word ? `${word.surah}:${word.ayah}:${word.word}` : null);

const summarize = (events) => {
  const byType = {};
  const observed = [];
  const confirmed = [];
  const positions = [];
  for (const event of events) {
    const key = `${event.type}${event.state ? `:${event.state}` : ""}${event.errorClass ? `:${event.errorClass}` : ""}`;
    byType[key] = (byType[key] ?? 0) + 1;
    if (event.type === "position") {
      const best = Array.isArray(event.observed) && event.observed[0] ? event.observed[0] : null;
      positions.push({
        timeMs: event.timeMs,
        state: event.state,
        expected: ref(event.expected),
        best: ref(best?.word),
        per: best ? Number(best.per?.toFixed?.(3) ?? best.per) : null,
        confidence: best ? Number(best.confidence?.toFixed?.(3) ?? best.confidence) : null,
        spanEnd: ref(best?.span?.end),
        hold: event.hold ?? null,
      });
      if (Array.isArray(event.observed)) {
        for (const item of event.observed) {
          if (item?.word) observed.push(ref(item.word));
        }
      }
    }
    if (event.type === "checker" && event.state === "confirmed") {
      confirmed.push({
        errorClass: event.errorClass ?? null,
        location: event.location ? `${event.location.surah}:${event.location.ayah}:${event.location.word}` : null,
      });
    }
  }
  return { byType, observed, confirmed, positions };
};

async function feed(session, samples, sampleRate, chunkMs = 500) {
  const events = [];
  const unsubscribe = session.subscribe((event) => events.push(event));
  const chunk = Math.max(1, Math.round((chunkMs * sampleRate) / 1000));
  const t0 = Date.now();
  for (let i = 0; i < samples.length; i += chunk) {
    await session.pushAudio(samples.slice(i, i + chunk), sampleRate);
  }
  const final = await session.end();
  unsubscribe();
  return { events: [...events, ...final], wallMs: Date.now() - t0 };
}

// 4a) Free recitation over every fixture.
result.free = [];
for (const wav of wavs) {
  const { samples, sampleRate } = await readWav(wav);
  const session = tilawa.startFreeRecitation();
  const run = await feed(session, samples, sampleRate);
  const summary = summarize(run.events);
  result.free.push({
    wav,
    seconds: Number((samples.length / sampleRate).toFixed(2)),
    wallMs: run.wallMs,
    eventCount: run.events.length,
    byType: summary.byType,
    uniqueObservedWords: [...new Set(summary.observed)],
    confirmedMistakes: summary.confirmed,
    positions: summary.positions,
  });
  session.dispose();
}

// 4b) Memorization session scoped to al-Fatiha 1:1-7 over the concatenated audio.
const joined = [];
let rate = 16000;
for (const wav of wavs) {
  const decoded = await readWav(wav);
  rate = decoded.sampleRate;
  joined.push(decoded.samples);
}
const total = joined.reduce((sum, part) => sum + part.length, 0);
const concat = new Float32Array(total);
let offset = 0;
for (const part of joined) {
  concat.set(part, offset);
  offset += part.length;
}
const passage = {
  surah: Number(opt("surah", 1)),
  fromAyah: Number(opt("from", 1)),
  toAyah: Number(opt("to", 7)),
};
const memo = tilawa.startMemorization(passage, { confirm: { after: "next-word" } });
const memoRun = await feed(memo, concat, rate);
const memoSummary = summarize(memoRun.events);
result.memorization = {
  passage: memo.passage,
  seconds: Number((concat.length / rate).toFixed(2)),
  wallMs: memoRun.wallMs,
  eventCount: memoRun.events.length,
  byType: memoSummary.byType,
  uniqueObservedWords: [...new Set(memoSummary.observed)],
  confirmedMistakes: memoSummary.confirmed,
  positions: memoSummary.positions,
  mistakesLength: memo.mistakes().length,
};
memo.dispose();

await tilawa.dispose();
result.finishedAt = new Date().toISOString();
result.totalMs = Date.now() - started;
await writeFile(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
