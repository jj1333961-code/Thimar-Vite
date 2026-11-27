-- تراجع عن 20261127_01_test_multi_lockdown.sql — يعيد الحالة السابقة تمامًا:
-- RLS معطّل + منح anon/authenticated/service_role كما كانت (arwdDxtm).
-- لا يُشغَّل إلا إذا ظهر اعتماد فعلي على الجدول (لم يظهر في التدقيق).

begin;

alter table public._test_multi disable row level security;

grant select, insert, update, delete, truncate, references, trigger on table public._test_multi to anon;
grant select, insert, update, delete, truncate, references, trigger on table public._test_multi to authenticated;

do $$
declare
  has_rls boolean;
  anon_grants integer;
begin
  select relrowsecurity into has_rls from pg_class where oid = 'public._test_multi'::regclass;
  select count(*) into anon_grants
  from pg_class c, aclexplode(c.relacl) x
  where c.oid = 'public._test_multi'::regclass and x.grantee = 'anon'::regrole;
  if has_rls then raise exception 'ROLLBACK_FAILED: RLS still enabled'; end if;
  if anon_grants = 0 then raise exception 'ROLLBACK_FAILED: anon grants missing'; end if;
end
$$;

commit;
