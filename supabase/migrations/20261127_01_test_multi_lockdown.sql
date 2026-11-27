-- إصلاح نتيجة Supabase Security Advisor: RLS Disabled in Public Schema — public._test_multi
--
-- التصنيف: جدول اختبار متبقٍّ (id integer، صف واحد id=1، لا مشغّلات/مفاتيح/عروض/دوال/نشر).
-- الإصلاح المختار: تفعيل RLS وسحب منح anon/authenticated دون حذف الجدول.
-- بلا سياسات ⇒ لا قراءة ولا كتابة لأي مستخدم، وservice_role يظل يعمل (BYPASSRLS).
--
-- التراجع: 20261127_01_test_multi_lockdown_rollback.sql
-- المتطلب: نسخة محفوظة من المحتوى والمنح في backups/production/
--           (manifest: backups/production/_test_multi-2026-11-26.manifest.json)

begin;

-- 1) التحقق من الهوية قبل التغيير: الجدول يجب أن يكون بلا RLS وبلا سياسات.
do $$
declare
  has_rls boolean;
  policy_count integer;
begin
  select relrowsecurity into has_rls from pg_class where oid = 'public._test_multi'::regclass;
  select count(*) into policy_count from pg_policy where polrelid = 'public._test_multi'::regclass;
  if has_rls or policy_count > 0 then
    raise exception 'PRECONDITION_FAILED: _test_multi already secured (rls=%, policies=%)', has_rls, policy_count;
  end if;
end
$$;

-- 2) تفعيل RLS (بلا FORCE: المالك/service_role يحتفظان بالوصول الإداري).
alter table public._test_multi enable row level security;

-- 3) سحب كل المنح عن الأدوار العامة. لا سياسات ⇒ منع تام لغير service_role.
revoke all on table public._test_multi from anon;
revoke all on table public._test_multi from authenticated;
revoke all on table public._test_multi from public;

-- 4) فحص بعدي داخل المعاملة: RLS مفعّل، لا سياسات، ولا منح لـanon/authenticated.
do $$
declare
  has_rls boolean;
  policy_count integer;
  leaked integer;
begin
  select relrowsecurity into has_rls from pg_class where oid = 'public._test_multi'::regclass;
  select count(*) into policy_count from pg_policy where polrelid = 'public._test_multi'::regclass;
  select count(*) into leaked
  from pg_class c, aclexplode(c.relacl) x
  where c.oid = 'public._test_multi'::regclass
    and (x.grantee = 'anon'::regrole or x.grantee = 'authenticated'::regrole or x.grantee = 0);
  if not has_rls then
    raise exception 'POSTCONDITION_FAILED: RLS still disabled';
  end if;
  if leaked > 0 then
    raise exception 'POSTCONDITION_FAILED: % grant(s) still present for anon/authenticated/PUBLIC', leaked;
  end if;
  if policy_count > 0 then
    raise exception 'UNEXPECTED_POLICIES: %', policy_count;
  end if;
end
$$;

commit;
