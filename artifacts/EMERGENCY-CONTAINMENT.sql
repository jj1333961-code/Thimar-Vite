-- Thimar emergency containment — PREPARED, NOT APPLIED.
-- Do not run this against production until a client that no longer requires anonymous
-- access to thimar_accounts and thimar-chat-media has been built and staged.
-- Every block is reversible; the rollback is at the bottom.
--
-- Identity contract assumed by these policies:
--   * app sessions carry a Supabase-compatible JWT signed with the project JWT secret
--   * sub = public.thimar_accounts.id
--   * role = "authenticated"
--   * app_role claim = 'student' | 'teacher' | 'guardian' | 'admin'
--   * everything else (anon) gets nothing on these tables

begin;

-- ---------------------------------------------------------------- helpers
create or replace function public.app_account_id() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  ), '')
$$;

create or replace function public.app_role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'app_role', '')
$$;

-- ------------------------------------------------- 1. thimar_accounts
drop policy if exists thimar_accounts_all on public.thimar_accounts;

-- a signed-in account sees only itself; admins see all
create policy thimar_accounts_select on public.thimar_accounts
  for select to authenticated
  using (id = public.app_account_id() or public.app_role() = 'admin');

-- signup and profile edits stay possible, but only for the caller's own row
create policy thimar_accounts_insert on public.thimar_accounts
  for insert to authenticated
  with check (id = public.app_account_id());

create policy thimar_accounts_update on public.thimar_accounts
  for update to authenticated
  using (id = public.app_account_id() or public.app_role() = 'admin')
  with check (id = public.app_account_id() or public.app_role() = 'admin');

create policy thimar_accounts_delete on public.thimar_accounts
  for delete to authenticated
  using (public.app_role() = 'admin');

-- credential material never leaves the database, for any client role
revoke select (password_hash, password_salt) on public.thimar_accounts from anon, authenticated;

-- ------------------------------------------------- 2. chat
drop policy if exists thimar_conversations_all on public.thimar_conversations;

create policy conversations_member_read on public.thimar_conversations
  for select to authenticated
  using (member_ids ? public.app_account_id()
         or created_by = public.app_account_id()
         or public.app_role() = 'admin');

create policy conversations_insert on public.thimar_conversations
  for insert to authenticated
  with check (created_by = public.app_account_id());

create policy conversations_admin_update on public.thimar_conversations
  for update to authenticated
  using (admins ? public.app_account_id() or public.app_role() = 'admin')
  with check (admins ? public.app_account_id() or public.app_role() = 'admin');

create policy conversations_admin_delete on public.thimar_conversations
  for delete to authenticated
  using (created_by = public.app_account_id() or public.app_role() = 'admin');

drop policy if exists thimar_chat_messages_all on public.thimar_chat_messages;

create policy messages_member_read on public.thimar_chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.thimar_conversations c
    where c.id = thimar_chat_messages.conversation_id
      and (c.member_ids ? public.app_account_id() or public.app_role() = 'admin')
  ));

create policy messages_sender_insert on public.thimar_chat_messages
  for insert to authenticated
  with check (sender_id = public.app_account_id());

create policy messages_sender_delete on public.thimar_chat_messages
  for delete to authenticated
  using (sender_id = public.app_account_id() or public.app_role() = 'admin');

-- ------------------------------------------------- 3. notifications
drop policy if exists thimar_notifications_all on public.thimar_notifications;

create policy notifications_owner_read on public.thimar_notifications
  for select to authenticated
  using (recipient_id = public.app_account_id() or public.app_role() = 'admin');

create policy notifications_owner_update on public.thimar_notifications
  for update to authenticated
  using (recipient_id = public.app_account_id() or public.app_role() = 'admin')
  with check (recipient_id = public.app_account_id() or public.app_role() = 'admin');

create policy notifications_owner_delete on public.thimar_notifications
  for delete to authenticated
  using (recipient_id = public.app_account_id() or public.app_role() = 'admin');

-- delivery is a server action, not a client one
revoke insert, update, delete on public.thimar_notifications from anon;

-- ------------------------------------------------- 4. challenges
drop policy if exists challenge_rooms_all on public.thimar_challenge_rooms;
drop policy if exists challenge_events_all on public.thimar_challenge_events;

create policy challenge_rooms_read on public.thimar_challenge_rooms
  for select to authenticated using (true);            -- lobby is public to signed-in users

create policy challenge_rooms_manage on public.thimar_challenge_rooms
  for all to authenticated
  using (public.app_role() in ('teacher','admin'))
  with check (public.app_role() in ('teacher','admin'));

create policy challenge_events_read on public.thimar_challenge_events
  for select to authenticated using (true);

create policy challenge_events_insert on public.thimar_challenge_events
  for insert to authenticated with check (true);

-- ------------------------------------------------- 5. push subscriptions
drop policy if exists thimar_push_subscriptions_all on public.thimar_push_subscriptions;

-- endpoint/p256dh/auth are bearer-equivalent: owner only, no admin read
create policy push_owner_all on public.thimar_push_subscriptions
  for all to authenticated
  using (account_id = public.app_account_id())
  with check (account_id = public.app_account_id());

-- ------------------------------------------------- 6. link requests + tombstones
drop policy if exists thimar_link_requests_all on public.thimar_link_requests;

create policy link_requests_participant_read on public.thimar_link_requests
  for select to authenticated
  using (public.app_role() = 'admin'
         or to_jsonb(thimar_link_requests) ?| array[public.app_account_id()]);

create policy link_requests_insert on public.thimar_link_requests
  for insert to authenticated with check (true);

create policy link_requests_admin_delete on public.thimar_link_requests
  for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists thimar_deletions_all on public.thimar_deletions;

create policy deletions_authenticated_read on public.thimar_deletions
  for select to authenticated using (true);            -- sync tombstones, ids only

create policy deletions_owner_write on public.thimar_deletions
  for insert to authenticated with check (true);

-- ------------------------------------------------- 7. storage
update storage.buckets set public = false where id = 'thimar-chat-media';

drop policy if exists "thimar chat media read" on storage.objects;
drop policy if exists "thimar chat media write" on storage.objects;

-- path convention: <account_id>/<file>; clients use createSignedUrl for reads
create policy "chat media owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'thimar-chat-media'
         and (storage.foldername(name))[1] = public.app_account_id());

create policy "chat media owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'thimar-chat-media'
              and (storage.foldername(name))[1] = public.app_account_id());

create policy "chat media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'thimar-chat-media'
         and (storage.foldername(name))[1] = public.app_account_id());

-- existing objects predate the path convention and have owner = NULL; backfill before
-- enabling the policies above, e.g.
--   update storage.objects set owner = (regexp_match(name, '^([^/]+)/'))[1]::uuid
--   where bucket_id = 'thimar-chat-media' and owner is null;
-- (uuid cast requires the path prefix to be an existing account id — verify first)

-- ------------------------------------------------- 8. verification (run after commit)
-- as anon, every one of these must fail with 401/403 or return 0 rows:
--   GET  /rest/v1/thimar_accounts?select=id
--   GET  /rest/v1/thimar_accounts?select=password_hash
--   DELETE /rest/v1/thimar_notifications?id=eq.<some id>
--   HEAD /storage/v1/object/public/thimar-chat-media/<object>
-- as an authenticated JWT of a student, these must still work:
--   login (via the auth function), own profile read/update, conversation list,
--   message send, notification list, signed media URL, challenge join.

-- ------------------------------------------------- rollback
-- begin;
--   drop policy if exists thimar_accounts_select on public.thimar_accounts;
--   ... (drop each policy created above)
--   create policy thimar_accounts_all on public.thimar_accounts
--     for all to public using (true) with check (true);
--   ... recreate the original nine policies verbatim from the pre-migration dump
--   grant select (password_hash, password_salt) on public.thimar_accounts to anon, authenticated;
--   update storage.buckets set public = true where id = 'thimar-chat-media';
--   drop policy if exists "chat media owner read" on storage.objects;
--   create policy "thimar chat media read" on storage.objects
--     for select to public using (bucket_id = 'thimar-chat-media');
--   create policy "thimar chat media write" on storage.objects
--     for insert to public with check (bucket_id = 'thimar-chat-media');
-- rollback;
