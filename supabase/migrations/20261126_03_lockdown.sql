-- ============================================================================
-- ثمار — إغلاق الوصول (T1): لا قراءة ولا كتابة مباشرة من العميل إطلاقًا
--
-- * تُسحب كل صلاحيات anon/authenticated عن كل الجداول والتسلسلات والدوال.
-- * تُحذف كل السياسات المفتوحة (53 سياسة USING true) وتُستبدل بسياسات ملكية
--   حقيقية للدور authenticated (طبقة دفاع ثانية إن أُضيف لاحقًا).
-- * تبقى الواجهة الوحيدة المتاحة للعميل: دالة public.thimar_api.
-- * حاوية المحادثات تصبح خاصة، وتُحذف سياساتها العامة.
-- * تحقق قابل للتشغيل: select public.thimar_security_status();
-- ============================================================================

-- ---------- 1) هوية الطلب (لطبقة RLS) ----------------------------------------
create or replace function public.thimar_uid()
returns text language sql stable
set search_path = public, pg_temp
as $$ select nullif(current_setting('thimar.uid', true), '') $$;

-- ---------- 2) حذف كل السياسات الحالية في public ------------------------------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- 3) سياسات ملكية صريحة (defense-in-depth) -------------------------
alter table public.thimar_accounts enable row level security;
create policy thimar_accounts_own_read on public.thimar_accounts
  for select to authenticated using (id = public.thimar_uid());
create policy thimar_accounts_own_update on public.thimar_accounts
  for update to authenticated using (id = public.thimar_uid())
  with check (id = public.thimar_uid());

alter table public.thimar_conversations enable row level security;
create policy thimar_conversations_member_read on public.thimar_conversations
  for select to authenticated
  using (member_ids @> jsonb_build_array(public.thimar_uid()));
create policy thimar_conversations_member_write on public.thimar_conversations
  for insert to authenticated
  with check (member_ids @> jsonb_build_array(public.thimar_uid()));
create policy thimar_conversations_member_update on public.thimar_conversations
  for update to authenticated
  using (member_ids @> jsonb_build_array(public.thimar_uid()))
  with check (member_ids @> jsonb_build_array(public.thimar_uid()));
create policy thimar_conversations_owner_delete on public.thimar_conversations
  for delete to authenticated
  using (created_by = public.thimar_uid()
         or admins @> jsonb_build_array(public.thimar_uid()));

alter table public.thimar_chat_messages enable row level security;
create policy thimar_messages_member_read on public.thimar_chat_messages
  for select to authenticated
  using (exists (select 1 from public.thimar_conversations c
                  where c.id = thimar_chat_messages.conversation_id
                    and c.member_ids @> jsonb_build_array(public.thimar_uid())));
create policy thimar_messages_sender_insert on public.thimar_chat_messages
  for insert to authenticated
  with check (sender_id = public.thimar_uid()
              and exists (select 1 from public.thimar_conversations c
                           where c.id = conversation_id
                             and c.member_ids @> jsonb_build_array(public.thimar_uid())));
create policy thimar_messages_sender_update on public.thimar_chat_messages
  for update to authenticated
  using (sender_id = public.thimar_uid())
  with check (sender_id = public.thimar_uid());
create policy thimar_messages_sender_delete on public.thimar_chat_messages
  for delete to authenticated
  using (sender_id = public.thimar_uid()
         or exists (select 1 from public.thimar_conversations c
                     where c.id = thimar_chat_messages.conversation_id
                       and c.created_by = public.thimar_uid()));

alter table public.thimar_notifications enable row level security;
create policy thimar_notifications_own on public.thimar_notifications
  for all to authenticated
  using (recipient_id = public.thimar_uid())
  with check (recipient_id = public.thimar_uid());

alter table public.thimar_link_requests enable row level security;
create policy thimar_links_participant on public.thimar_link_requests
  for all to authenticated
  using (payload->>'teacherId' = public.thimar_uid()
      or payload->>'studentId' = public.thimar_uid()
      or payload->>'guardianId' = public.thimar_uid())
  with check (payload->>'teacherId' = public.thimar_uid()
           or payload->>'studentId' = public.thimar_uid()
           or payload->>'guardianId' = public.thimar_uid());

alter table public.thimar_sessions enable row level security;
create policy thimar_sessions_own on public.thimar_sessions
  for select to authenticated using (account_id = public.thimar_uid());

alter table public.thimar_media enable row level security;
create policy thimar_media_member on public.thimar_media
  for select to authenticated
  using (exists (select 1 from public.thimar_conversations c
                  where c.id = thimar_media.conversation_id
                    and c.member_ids @> jsonb_build_array(public.thimar_uid())));

alter table public.thimar_tasmee_sessions enable row level security;
create policy thimar_tasmee_own on public.thimar_tasmee_sessions
  for all to authenticated
  using (account_id = public.thimar_uid())
  with check (account_id = public.thimar_uid());

alter table public.thimar_memorization_plans enable row level security;
create policy thimar_plans_own on public.thimar_memorization_plans
  for all to authenticated
  using (account_id = public.thimar_uid())
  with check (account_id = public.thimar_uid());

alter table public.thimar_calls enable row level security;
create policy thimar_calls_participant on public.thimar_calls
  for all to authenticated
  using (caller_id = public.thimar_uid() or callee_id = public.thimar_uid())
  with check (caller_id = public.thimar_uid() or callee_id = public.thimar_uid());

alter table public.thimar_fcm_tokens enable row level security;
create policy thimar_fcm_own on public.thimar_fcm_tokens
  for all to authenticated
  using (account_id = public.thimar_uid())
  with check (account_id = public.thimar_uid());

alter table public.thimar_device_authorizations enable row level security;
create policy thimar_devices_own on public.thimar_device_authorizations
  for select to authenticated using (account_id = public.thimar_uid());

alter table public.thimar_push_subscriptions enable row level security;
create policy thimar_push_own on public.thimar_push_subscriptions
  for all to authenticated
  using (account_id = public.thimar_uid())
  with check (account_id = public.thimar_uid());

alter table public.thimar_deletions enable row level security;
create policy thimar_deletions_read on public.thimar_deletions
  for select to authenticated
  using (entity <> 'account' or id = public.thimar_uid());

-- كل جدول آخر يبقى RLS مفعّلًا وبلا سياسة = منع كامل.
alter table public._test_multi enable row level security;

-- ---------- 4) سحب كل الصلاحيات عن anon و authenticated ----------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- صلاحيات افتراضية: أي جدول/دالة/تسلسل جديد لا يُمنح للعميل تلقائيًا.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------- 5) الواجهة الوحيدة المسموحة للعميل -------------------------------
grant execute on function public.thimar_api(text, text, jsonb) to anon, authenticated;

-- سياسات RLS تستدعي هذه الدالة بصلاحية الدور نفسه، فبدونها كل قراءة تفشل.
grant execute on function public.thimar_uid() to anon, authenticated;

-- دوال موجودة يستخدمها العميل مباشرة (تحقق ذاتي داخلي بسرّ الجهاز/الرمز).
-- to_regprocedure يجعل المنحة شرطية فلا تفشل على قاعدة لا تحتوي الدالة.
do $$
declare r record;
begin
  for r in
    select sig from unnest(array[
      'public.thimar_authorize_device(text, text, text)',
      'public.thimar_bind_fcm_token_secure(text, text, text, text, text, integer, text, text)',
      'public.thimar_revoke_fcm_token_secure(text, text, text, text)',
      'public.thimar_save_tasmee_session(text, text, text, text, uuid, jsonb)',
      'public.thimar_list_own_tasmee_sessions(text, text, text, text)']) as sig
  loop
    if to_regprocedure(r.sig) is not null then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end if;
  end loop;
end $$;

-- دالة تغيير كلمة المرور القديمة كانت تستقبل بصمة جاهزة من العميل — أُغلقت.
do $$
begin
  if to_regprocedure('public.thimar_change_password(text, text, text, text)') is not null then
    revoke execute on function public.thimar_change_password(text, text, text, text)
      from public, anon, authenticated;
  end if;
end $$;

-- ---------- 6) تثبيت search_path على الدوال الأمنية القائمة -------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (p.proconfig is null or not exists (
              select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
  end loop;
end $$;

-- ---------- 7) التخزين: الحاوية خاصة ولا سياسات عامة -------------------------
update storage.buckets set public = false where id = 'thimar-chat-media';
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') ilike '%thimar-chat-media%'
            or coalesce(with_check, '') ilike '%thimar-chat-media%')
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- ---------- 8) تحقق قابل للتشغيل --------------------------------------------
create or replace function public.thimar_security_status()
returns jsonb language sql stable
set search_path = public, storage, extensions, pg_temp
as $$
  select jsonb_build_object(
    'public_tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                       where n.nspname='public' and c.relkind='r'),
    'anon_table_grants', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           cross join lateral aclexplode(c.relacl) a
                          where n.nspname='public' and pg_get_userbyid(a.grantee) in ('anon','authenticated')),
    'open_policies', (select count(*) from pg_policies
                       where schemaname='public' and (qual = 'true' or with_check = 'true')),
    'policies_total', (select count(*) from pg_policies where schemaname='public'),
    'rls_enabled', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                     where n.nspname='public' and c.relkind='r' and c.relrowsecurity),
    'public_buckets', (select count(*) from storage.buckets where public),
    'storage_open_policies', (select count(*) from pg_policies where schemaname='storage' and tablename='objects'),
    'default_acl_anon', (select count(*) from pg_default_acl d
                          cross join lateral aclexplode(d.defaclacl) a
                          where pg_get_userbyid(a.grantee) in ('anon','authenticated')),
    'password_hash_type', (select coalesce(string_agg(distinct password_algo, ','), 'none')
                            from public.thimar_accounts),
    'bcrypt_accounts', (select count(*) from public.thimar_accounts where password_algo='bcrypt'),
    'legacy_accounts', (select count(*) from public.thimar_accounts where password_algo<>'bcrypt'),
    'live_sessions', (select count(*) from public.thimar_sessions where revoked_at is null and expires_at > now()));
$$;

grant execute on function public.thimar_security_status() to anon, authenticated;
