import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2] || "dist";

// نسخة الإصدار تُقرأ من بيانات أندرويد المنشورة كي يبقى المانيفست متوافقًا مع الحزمة.
function readAndroidVersion() {
  try {
    const meta = JSON.parse(readFileSync("public/updates/android.json", "utf8"));
    return {
      versionName: typeof meta.versionName === "string" ? meta.versionName : undefined,
      versionCode: Number.isFinite(Number(meta.versionCode)) ? Number(meta.versionCode) : undefined,
      resourceVersionName: typeof meta.resourceVersionName === "string" ? meta.resourceVersionName : (typeof meta.resourceVersion === "string" ? meta.resourceVersion : undefined),
      resourceVersionCode: Number.isFinite(Number(meta.resourceVersionCode)) ? Number(meta.resourceVersionCode) : (Number.isFinite(Number(meta.resourceVersion)) ? Number(meta.resourceVersion) : undefined),
    };
  } catch {
    return {};
  }
}
const androidVersion = readAndroidVersion();
const versionName = process.argv[3] || process.env.VERSION_NAME || androidVersion.versionName || "1.11.4";
const versionCode = Number(process.argv[4] || process.env.VERSION_CODE || androidVersion.versionCode || 26);
const resourceVersionName = process.env.RESOURCE_VERSION_NAME || androidVersion.resourceVersionName || versionName;
const resourceVersionCode = Number(process.env.RESOURCE_VERSION_CODE || androidVersion.resourceVersionCode || versionCode);
const outDir = "public/updates/manifests";
mkdirSync(outDir, { recursive: true });

// الموقع/التطبيق لا يحتاجان تضمين الملفات الضخمة (المصحف، WASM، إلخ) في التحديث التفاضلي؛
// هذه تُجلب من الخادم عند الحاجة. إدراجها كان يجعل التحديث ينزّل مئات الميغابايت ويسبب عدم تطابق الحجم.
const MAX_BYTES = Number(process.env.WEB_MANIFEST_MAX_BYTES || 1.5 * 1024 * 1024);

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    const relDir = relative(root, full).split(sep).join("/");
    if (st.isDirectory()) {
      if (relDir === "updates" || relDir.startsWith("updates/")) return result;
      result.push(...walk(full));
    } else {
      if (relDir.startsWith("updates/")) return result;
      result.push(full);
    }
  }
  return result;
}

const skipped = [];
const files = [];
for (const full of walk(root)) {
  const rel = relative(root, full).split(sep).join("/");
  // نتجاهل الملفات الضخمة قبل قراءتها في الذاكرة (المصحف 218MB/WASM 28MB).
  if (MAX_BYTES > 0 && statSync(full).size > MAX_BYTES) {
    skipped.push(rel);
    continue;
  }
  const data = readFileSync(full);
  files.push({
    path: rel,
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
if (skipped.length) {
  console.log(`Skipped ${skipped.length} large server-provided file(s): ${skipped.join(", ")}`);
}

const manifest = {
  platform: "web",
  versionName,
  versionCode,
  resourceVersion: resourceVersionName,
  resourceVersionCode,
  nativeVersionCode: versionCode,
  nativeVersionName: versionName,
  baseUrl: "/",
  generatedAt: new Date().toISOString(),
  files,
};

const serialized = JSON.stringify(manifest, null, 2) + "\n";
const target = `${outDir}/${versionName}.json`;
writeFileSync(target, serialized);
writeFileSync("public/updates/web-manifest.json", serialized);
// اكتب المانيفست أيضًا داخل مجلد البناء كي تُضمَّن النسخة المطابقة للبناء في الحزمة مباشرة.
const buildUpdates = join(root, "updates");
mkdirSync(buildUpdates, { recursive: true });
writeFileSync(join(buildUpdates, "web-manifest.json"), serialized);
console.log(`Generated ${files.length} entries for ${versionName} (${versionCode}) -> ${target}`);