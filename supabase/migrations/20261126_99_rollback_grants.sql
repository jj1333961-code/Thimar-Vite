-- ============================================================================
-- ثمار — تراجع طارئ عن الإغلاق (T1)
--
-- ⚠ تحذير: هذا الملف يُعيد الثغرة الحرجة (قراءة/كتابة مباشرة بلا هوية).
--    لا يُستخدم إلا إذا تعذّر نشر العميل الجديد وأردت إعادة التطبيق القديم للعمل
--    مؤقتًا. البديل الأفضل دائمًا: استعادة النسخة الاحتياطية.
--
-- لا يحذف أي بيانات، ولا يمسّ كلمات المرور أو الجلسات أو الوسائط.
-- ما يفعله:
--   1) يُسقط سياسات الملكية الجديدة.
--   2) يُعيد سياسات ALL/true القديمة على الجداول التسعة (كما كانت في الإنتاج).
--   3) يُعيد منح arwdDxtm لـanon و authenticated على جداول public وتسلسلاته.
--   4) يُعيد الصلاحيات الافتراضية (arwdDxtm) لـpostgres في public.
--   5) يُبقي thimar_api وجداول الجلسات (لا تؤذي) لكنها تصبح غير مستخدمة.
--   6) يُعيد الحاوية عامة كما كانت.
-- ============================================================================

begin;

-- 1) إسقاط سياسات الملكية
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
            where schemaname = 'public' and policyname like 'thimar_%'
              and policyname not in ('thimar_accounts_all','thimar_chat_messages_all',
                                     'thimar_conversations_all','thimar_notifications_all',
                                     'thimar_deletions_all','thimar_link_requests_all',
                                     'thimar_memorization_plans_all','thimar_push_subscriptions_all',
                                     'thimar_challenge_rooms_all','thimar_challenge_events_all')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) إعادة السياسات المفتوحة القديمة
do $$
declare r record;
begin
  for r in select c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and c.relname in ('thimar_accounts','thimar_chat_messages','thimar_conversations',
                                'thimar_notifications','thimar_deletions','thimar_link_requests',
                                'thimar_memorization_plans','thimar_push_subscriptions',
                                'thimar_challenge_rooms','thimar_challenge_events')
  loop
    execute format('drop policy if exists %I on public.%I', r.tbl || '_all', r.tbl);
    execute format('create policy %I on public.%I for all to public using (true) with check (true)',
                   r.tbl || '_all', r.tbl);
  end loop;
end $$;

-- 3) إعادة المنح
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- 4) الصلاحيات الافتراضية
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- 5) الدوال القديمة التي يحتاجها العميل
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'thimar_authorize_device','thimar_bind_fcm_token_secure','thimar_revoke_fcm_token_secure',
       'thimar_save_tasmee_session','thimar_list_own_tasmee_sessions','thimar_change_password',
       'thimar_note_auth_attempt','thimar_client_ip','thimar_revoke_device_authorizations')
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;

-- 6) الحاوية عامة كما كانت
update storage.buckets set public = true where id = 'thimar-chat-media';

commit;

select public.thimar_security_status() as status_after_rollback;
