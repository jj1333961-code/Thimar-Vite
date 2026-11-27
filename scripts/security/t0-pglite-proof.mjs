/**
 * إثبات T0 على PGlite (PostgreSQL 17 محلي):
 *  1) يبني محاكاة مطابقة لكتالوج الإنتاج (46 جدولًا + نفس المنح + defaults).
 *  2) ينفّذ ملف T0 الفعلي (الأقسام 0→3) كما هو.
 *  3) يتحقق من: سحب T/R/G/M بالكامل، بقاء S/I/U/D، تفعيل RLS على _test_multi.
 *  4) يستدعي دالة التراجع الحقيقية من الملف ويقارن ACL حرفيًا (بما فيه GRANT OPTION)،
 *     وأعلام RLS، والصلاحيات الافتراضية.
 *  5) يثبت أن المفاتيح الأجنبية والمشغّلات القائمة ما زالت تعمل بعد السحب.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL_PATH = "artifacts/security/T0-EXPLICIT-NOT-APPLIED.sql";
const sqlFile = readFileSync(SQL_PATH, "utf8");

const tables = [...sqlFile.matchAll(/on table public\.(\w+) from anon, authenticated;/g)].map((m) => m[1]);
const PROTECTED = [
  "thimar_auth_rate_limits", "thimar_binding_nonces", "thimar_device_authorizations",
  "thimar_fcm_tokens", "thimar_notification_audit", "thimar_tasmee_sessions",
  "thimar_update_notifications",
];

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);

// ---------- 1) محاكاة الإنتاج ----------
for (const t of tables) {
  await db.exec(`create table public.${t} (id integer primary key);`);
}
for (const t of tables) {
  await db.exec(`revoke all on table public.${t} from public;`);
  await db.exec(`grant all on table public.${t} to service_role;`);
  if (PROTECTED.includes(t)) continue;
  if (t === "thimar_runtime_flags") {
    await db.exec(`grant select on table public.${t} to anon, authenticated;`);
    continue;
  }
  await db.exec(`grant all on table public.${t} to anon, authenticated;`);
}
// جدول إضافي عليه GRANT OPTION لإثبات أن التراجع يعيده أيضًا (غير موجود في الإنتاج اليوم)
await db.exec(`create table public.zz_grantopt_probe (id integer primary key);
               revoke all on public.zz_grantopt_probe from public;
               grant select, truncate on public.zz_grantopt_probe to anon with grant option;`);
// مفتاح أجنبي ومشغّل قائمان على جدول من قائمة T0
await db.exec(`
  create table public.zz_fk_child (id integer primary key, account_id integer references public.thimar_accounts(id));
  create table public.zz_trigger_log (id serial primary key, note text);
  create or replace function public.zz_trg() returns trigger language plpgsql as $$ begin
    insert into public.zz_trigger_log(note) values ('fired'); return new; end $$;
  create trigger zz_trg after insert on public.thimar_accounts for each row execute function public.zz_trg();
`);
// defaults مطابقة للإنتاج (postgres/public/tables: arwdDxtm لـanon+authenticated)
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;`);
// RLS كما في الإنتاج: مفعّل على كل الجداول عدا _test_multi
await db.exec(`do $$ declare r record; begin
  for r in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r' and c.relname <> '_test_multi' loop
    execute format('alter table %s enable row level security', r.rel);
  end loop; end $$;`);

const aclOf = async (rel) =>
  (await db.query(`select coalesce(relacl::text,'') a from pg_class where oid = $1::regclass`, [rel])).rows[0].a;
const normalized = (acl) => acl.replace(/^\{|\}$/g, "").split(",").filter(Boolean).sort().join(",");
const grantables = async (rel) =>
  (await db.query(
    `select coalesce(string_agg(pg_get_userbyid(a.grantee)||':'||a.privilege_type, ',' order by 1), '') g
       from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid = $1::regclass and a.is_grantable`, [rel])).rows[0].g;

const before = new Map();
for (const t of [...tables, "zz_grantopt_probe"]) before.set(t, await aclOf("public." + t));
const beforeGrantable = await grantables("public.zz_grantopt_probe");
const beforeDefacl = (await db.query(
  `select defaclacl::text a from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and defaclobjtype='r'`)).rows[0].a;
const beforeRls = (await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity`)).rows[0].c;

const preNonDml = (await db.query(
  `select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname='public' and pg_get_userbyid(a.grantee) in ('anon','authenticated')
      and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')`)).rows[0].c;
const preGrantable = (await db.query(
  `select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname='public' and pg_get_userbyid(a.grantee) in ('anon','authenticated') and a.is_grantable`)).rows[0].c;
check("المحاكاة: 46 أمر revoke مستخرجة من الملف", tables.length === 46, `found=${tables.length}`);
check("المحاكاة: 304 منحة T/R/G/M + 1 لجدول GRANT OPTION", preNonDml === 305, `preNonDml=${preNonDml}`);

// ---------- 2) تنفيذ الملف الفعلي ----------
try {
  await db.exec(sqlFile);
  check("تنفيذ ملف T0 الفعلي (0→3)", true);
} catch (e) {
  check("تنفيذ ملف T0 الفعلي (0→3)", false, String(e.message ?? e));
  process.exit(1);
}

const postNonDml = (await db.query(
  `select c.relname, a.privilege_type, pg_get_userbyid(a.grantee) g
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname='public' and pg_get_userbyid(a.grantee) in ('anon','authenticated')
      and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
      and c.relname not like 'zz\\_%'`)).rows;
check("بعد T0: صفر T/R/G/M لـanon و authenticated على جداول T0", postNonDml.length === 0,
  JSON.stringify(postNonDml));

const dml = (await db.query(
  `select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and has_table_privilege('anon', c.oid, 'SELECT')
      and has_table_privilege('anon', c.oid, 'INSERT')
      and has_table_privilege('anon', c.oid, 'UPDATE')
      and has_table_privilege('anon', c.oid, 'DELETE')`)).rows[0].c;
check("بعد T0: DML الأربعة باقية على 38 جدولًا", dml === 38, `tables_with_siud=${dml}`);

const rls = (await db.query(`select relrowsecurity from pg_class where oid='public._test_multi'::regclass`)).rows[0].relrowsecurity;
check("بعد T0: RLS مفعّل على _test_multi", rls === true);

const defaclAfter = (await db.query(
  `select defaclacl::text a from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and defaclobjtype='r'`)).rows[0].a;
const anonDefaults = (acl) => (acl.match(/anon=([a-zA-Z*]+)\//)?.[1] ?? "");
check("بعد T0: الصلاحيات الافتراضية فقدت T/R/G/M",
  !/[Dxtm]/.test(anonDefaults(defaclAfter)),
  defaclAfter);

// المشغّل والمفتاح الأجنبي القائمان
await db.exec(`insert into public.thimar_accounts(id) values (1)`);
const fired = (await db.query(`select count(*)::int c from public.zz_trigger_log`)).rows[0].c;
check("بعد T0: المشغّل القائم على thimar_accounts ما زال يعمل", fired === 1, `fired=${fired}`);
let fkBlocked = false;
try {
  await db.exec(`insert into public.zz_fk_child(id, account_id) values (1, 999)`);
} catch (e) {
  fkBlocked = String(e.message).includes("foreign key");
}
check("بعد T0: المفتاح الأجنبي القائم ما زال يمنع صفًا يتيمًا", fkBlocked);

let truncateBlocked = false;
await db.exec(`set role anon`);
try {
  await db.exec(`truncate public.thimar_accounts`);
} catch (e) {
  truncateBlocked = String(e.message).includes("permission denied");
}
await db.exec(`reset role`);
check("بعد T0: TRUNCATE مرفوض لـanon (42501)", truncateBlocked);

// ---------- 3) التراجع الحقيقي ----------
let rollbackMsg = "";
try {
  rollbackMsg = (await db.query(`select thimar_pre_containment.restore_pre_t0_state() r`)).rows[0].r;
  check("تنفيذ دالة التراجع", true, rollbackMsg);
} catch (e) {
  check("تنفيذ دالة التراجع", false, String(e.message ?? e));
}

let aclMismatch = 0;
for (const [t, acl] of before) {
  const now = await aclOf("public." + t);
  if (normalized(now) !== normalized(acl)) {
    aclMismatch += 1;
    console.log(`   mismatch ${t}\n     now=${now}\n     exp=${acl}`);
  }
}
check("التراجع: ACL مطابق حرفيًا لكل الجداول", aclMismatch === 0, `mismatches=${aclMismatch}`);

const afterGrantable = await grantables("public.zz_grantopt_probe");
check("التراجع: GRANT OPTION أُعيد كما كان", afterGrantable === beforeGrantable, `${afterGrantable}`);

const afterDefacl = (await db.query(
  `select defaclacl::text a from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and defaclobjtype='r'`)).rows[0].a;
check("التراجع: الصلاحيات الافتراضية مطابقة", normalized(afterDefacl) === normalized(beforeDefacl), `${afterDefacl}`);

const afterRls = (await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity`)).rows[0].c;
check("التراجع: أعلام RLS مطابقة لِما قبل T0", afterRls === beforeRls, `before=${beforeRls} after=${afterRls}`);

const rlsAfterRollback = (await db.query(`select relrowsecurity from pg_class where oid='public._test_multi'::regclass`)).rows[0].relrowsecurity;
check("التراجع: _test_multi عاد بلا RLS كما كان", rlsAfterRollback === false);

const restoredTruncatePrivs = (await db.query(
  `select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname='public' and pg_get_userbyid(a.grantee) in ('anon','authenticated')
      and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
      and c.relname not like 'zz\\_%'`)).rows[0].c;
check("التراجع: 304 منحة T/R/G/M عادت في الكتالوج", restoredTruncatePrivs === 304, `restored=${restoredTruncatePrivs}`);

let truncateAllowedAgain = false;
let truncateErr = "";
await db.exec(`set role anon`);
try {
  await db.exec(`truncate public.admins`);
  truncateAllowedAgain = true;
} catch (e) {
  truncateErr = String(e.message);
}
await db.exec(`reset role`);
check("التراجع: TRUNCATE مسموح فعليًا لـanon", truncateAllowedAgain, truncateErr);
check("التراجع: thimar_accounts لم تُفرَّغ (لا حذف بيانات)",
  (await db.query(`select count(*)::int c from public.thimar_accounts`)).rows[0].c === 1);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
