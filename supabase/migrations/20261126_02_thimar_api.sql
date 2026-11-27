-- ============================================================================
-- ثمار — واجهة البيانات الوحيدة (بديل الوصول المباشر إلى الجداول)
--
--   POST /rest/v1/rpc/thimar_api   { p_token, p_op, p_data }
--
-- * الدالة SECURITY DEFINER وبـ search_path مثبّت.
-- * كل عملية (عدا login/register) تتطلب رمز جلسة صالحًا وتشتقّ هوية المستخدم
--   من الخادم فقط — لا تُقبل أي هوية مرسلة من العميل.
-- * كل قراءة/كتابة مقيّدة بالملكية: المستخدم لا يرى إلا حسابه وما يخصّه.
-- ============================================================================

create or replace function public.thimar_api(
  p_token text, p_op text, p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me text;
  v_me_row public.thimar_accounts;
  v_is_admin boolean := false;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_op text := lower(coalesce(p_op, ''));
  v_result jsonb;
  v_ids text[];
  v_conv text;
  v_media public.thimar_media;
begin
  -- ---------- عمليات لا تحتاج جلسة ----------
  if v_op = 'login' then
    return public.thimar_api_login(v_data->>'username', v_data->>'password',
                                   v_data->>'deviceId', v_data->>'platform');
  elsif v_op = 'register' then
    return public.thimar_api_register(v_data->'account', v_data->>'password');
  elsif v_op = 'health' then
    return jsonb_build_object('ok', true, 'now', now());
  end if;

  -- ---------- كل ما تبقّى يتطلب جلسة ----------
  v_me := public.thimar_require_session(p_token);
  select * into v_me_row from public.thimar_accounts where id = v_me;
  if v_me_row.id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  v_is_admin := (v_me_row.type = 'admin');
  if v_me_row.banned then
    raise exception 'ACCOUNT_BANNED' using errcode = '42501';
  end if;

  -- ---------- الجلسة والحساب ----------
  if v_op = 'logout' then
    return jsonb_build_object('ok', public.thimar_session_revoke(p_token, 'logout'));
  elsif v_op = 'me' then
    return jsonb_build_object('account', public.thimar_account_json(v_me_row));
  elsif v_op = 'password.change' then
    return public.thimar_api_change_password(p_token, v_data->>'oldPassword', v_data->>'newPassword');
  elsif v_op = 'sessions.list' then
    return jsonb_build_object('sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'deviceId', s.device_id, 'platform', s.platform,
        'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at,
        'expiresAt', s.expires_at, 'current', s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'))
        order by s.created_at desc)
      from public.thimar_sessions s
      where s.account_id = v_me and s.revoked_at is null and s.expires_at > now()), '[]'::jsonb));
  elsif v_op = 'sessions.revoke' then
    update public.thimar_sessions
       set revoked_at = now(), revoked_reason = 'user_revoked'
     where account_id = v_me and id = nullif(v_data->>'sessionId', '')::uuid and revoked_at is null;
    return jsonb_build_object('ok', true);

  -- ---------- السحب: كل ما يخصّني فقط ----------
  elsif v_op = 'pull' then
    return (
      with my_conversations as (
        select c.* from public.thimar_conversations c
         where c.member_ids @> jsonb_build_array(v_me)
      ),
      my_links as (
        select l.* from public.thimar_link_requests l
         where l.payload->>'teacherId' = v_me
            or l.payload->>'studentId' = v_me
            or l.payload->>'guardianId' = v_me
            or (v_is_admin)
      ),
      peer_ids as (
        select distinct value as id
          from my_conversations c, jsonb_array_elements_text(c.member_ids) value
        union
        select l.payload->>'teacherId' from my_links l
        union
        select l.payload->>'studentId' from my_links l
        union
        select l.payload->>'guardianId' from my_links l
      )
      select jsonb_build_object(
        'serverTime', (extract(epoch from now()) * 1000)::bigint,
        'account', public.thimar_account_json(v_me_row),
        'accounts', coalesce((
          select jsonb_agg(public.thimar_account_json(a) order by a.created_at desc)
          from public.thimar_accounts a
          where v_is_admin
             or a.id = v_me
             or a.id in (select id from peer_ids where id is not null)), '[]'::jsonb),
        'notifications', coalesce((
          select jsonb_agg(to_jsonb(n) order by n.created_at asc)
          from (select * from public.thimar_notifications
                 where recipient_id = v_me order by created_at desc limit 400) n), '[]'::jsonb),
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'kind', l.kind, 'status', l.status,
            'created_at', l.created_at, 'payload', l.payload) order by l.created_at desc)
          from my_links l), '[]'::jsonb),
        'conversations', coalesce((
          select jsonb_agg(to_jsonb(c) order by c.created_at desc)
          from (select * from my_conversations order by created_at desc limit 500) c), '[]'::jsonb),
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id,
            'kind', m.kind, 'text', m.text, 'duration', m.duration, 'file_name', m.file_name,
            'created_at', m.created_at, 'read_by', m.read_by, 'media_url', m.media_url)
            order by m.created_at asc)
          from (select * from public.thimar_chat_messages
                 where conversation_id in (select id from my_conversations)
                 order by created_at asc limit 5000) m), '[]'::jsonb),
        'deletions', coalesce((
          select jsonb_agg(to_jsonb(d))
          from public.thimar_deletions d
          where (d.entity = 'account' and d.id = v_me)
             or (d.entity in ('notification', 'message', 'conversation'))), '[]'::jsonb));
  );

  -- ---------- الحساب ----------
  elsif v_op = 'account.update' then
    update public.thimar_accounts
       set full_name = coalesce(nullif(v_data->>'fullName', ''), full_name),
           phone = coalesce(nullif(v_data->>'phone', ''), phone),
           email = coalesce(nullif(v_data->>'email', ''), email),
           country_code = coalesce(nullif(v_data->>'countryCode', ''), country_code),
           student = coalesce(v_data->'student', student),
           teacher = coalesce(v_data->'teacher', teacher),
           guardian = coalesce(v_data->'guardian', guardian)
     where id = v_me
     returning * into v_me_row;
    return jsonb_build_object('account', public.thimar_account_json(v_me_row));

  elsif v_op = 'account.delete' then
    if v_data->>'accountId' is null or v_data->>'accountId' = v_me or v_is_admin then
      declare v_target text := coalesce(v_data->>'accountId', v_me);
      begin
        insert into public.thimar_deletions (entity, id, deleted_at)
        values ('account', v_target, (extract(epoch from now()) * 1000)::bigint)
        on conflict (entity, id) do update set deleted_at = excluded.deleted_at;

        delete from public.thimar_chat_messages
         where conversation_id in (select id from public.thimar_conversations where created_by = v_target);
        delete from public.thimar_conversations where created_by = v_target;
        delete from public.thimar_chat_messages where sender_id = v_target;
        delete from public.thimar_notifications where recipient_id = v_target;
        delete from public.thimar_sessions where account_id = v_target;
        delete from public.thimar_link_requests
         where payload->>'teacherId' = v_target or payload->>'studentId' = v_target or payload->>'guardianId' = v_target;
        delete from public.thimar_accounts where id = v_target;
      end;
      return jsonb_build_object('ok', true);
    end if;
    raise exception 'FORBIDDEN' using errcode = '42501';

  -- ---------- الإشعارات ----------
  elsif v_op = 'notifications.push' then
    insert into public.thimar_notifications as n
      (id, recipient_id, kind, title, body, target, action, read, created_at)
    select x.id, x.recipient_id, coalesce(x.kind, 'system'), coalesce(x.title, ''),
           coalesce(x.body, ''), x.target, x.action, coalesce(x.read, false),
           coalesce(x.created_at, (extract(epoch from now()) * 1000)::bigint)
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        id text, recipient_id text, kind text, title text, body text,
        target text, action text, read boolean, created_at bigint)
     where x.id is not null
       and (
         x.recipient_id = v_me
         or v_is_admin
         or exists (select 1 from public.thimar_conversations c
                     where c.member_ids @> jsonb_build_array(v_me)
                       and c.member_ids @> jsonb_build_array(x.recipient_id))
         or exists (select 1 from public.thimar_link_requests l
                     where (l.payload->>'teacherId' = v_me and l.payload->>'studentId' = x.recipient_id)
                        or (l.payload->>'guardianId' = v_me and l.payload->>'studentId' = x.recipient_id)
                        or (l.payload->>'studentId' = v_me and l.payload->>'teacherId' = x.recipient_id))
       )
    on conflict (id) do update
      set title = excluded.title, body = excluded.body, kind = excluded.kind,
          read = excluded.read, target = excluded.target, action = excluded.action
      where n.recipient_id = v_me or v_is_admin;
    return jsonb_build_object('ok', true);

  elsif v_op = 'notifications.delete' then
    delete from public.thimar_notifications
     where id = any (array(select jsonb_array_elements_text(coalesce(v_data->'ids', '[]'::jsonb))))
       and recipient_id = v_me;
    return jsonb_build_object('ok', true);

  -- ---------- طلبات الربط ----------
  elsif v_op = 'links.push' then
    insert into public.thimar_link_requests as l (id, kind, status, created_at, payload)
    select x.id, x.kind, coalesce(x.status, 'pending'), coalesce(x.created_at, 0), x.payload
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        id text, kind text, status text, created_at bigint, payload jsonb)
     where x.id is not null
       and x.kind in ('teacher', 'guardian')
       and (
         x.payload->>'teacherId' = v_me or x.payload->>'studentId' = v_me
         or x.payload->>'guardianId' = v_me or v_is_admin)
    on conflict (id) do update
      set status = excluded.status, payload = excluded.payload
      where (l.payload->>'teacherId' = v_me
          or l.payload->>'studentId' = v_me
          or l.payload->>'guardianId' = v_me
          or v_is_admin);
    return jsonb_build_object('ok', true);

  -- ---------- المحادثات والرسائل ----------
  elsif v_op = 'chat.push' then
    -- محادثات: يجب أن أكون عضوًا، ومنشئها أنا (أو عضوًا فيها مسبقًا).
    insert into public.thimar_conversations as c
      (id, title, is_group, member_ids, admins, created_by, created_at, updated_at)
    select x.id, coalesce(x.title, ''), coalesce(x.is_group, false),
           coalesce(x.member_ids, '[]'::jsonb), coalesce(x.admins, '[]'::jsonb),
           coalesce(x.created_by, v_me), coalesce(x.created_at, 0),
           coalesce(x.updated_at, (extract(epoch from now()) * 1000)::bigint)
      from jsonb_to_recordset(coalesce(v_data->'conversations', '[]'::jsonb)) as x(
        id text, title text, is_group boolean, member_ids jsonb, admins jsonb,
        created_by text, created_at bigint, updated_at bigint)
     where x.id is not null
       and coalesce(x.member_ids, '[]'::jsonb) @> jsonb_build_array(v_me)
    on conflict (id) do update
      set title = excluded.title,
          member_ids = excluded.member_ids,
          admins = excluded.admins,
          updated_at = excluded.updated_at
      where c.member_ids @> jsonb_build_array(v_me)
        and excluded.member_ids @> jsonb_build_array(v_me);

    -- رسائل: المحادثة لي، والمرسل أنا.
    insert into public.thimar_chat_messages as m
      (id, conversation_id, sender_id, kind, text, duration, file_name, created_at, read_by, media_url)
    select x.id, x.conversation_id, v_me, coalesce(x.kind, 'text'), x.text, x.duration,
           x.file_name, coalesce(x.created_at, 0), coalesce(x.read_by, '[]'::jsonb), x.media_url
      from jsonb_to_recordset(coalesce(v_data->'messages', '[]'::jsonb)) as x(
        id text, conversation_id text, kind text, text text, duration integer,
        file_name text, created_at bigint, read_by jsonb, media_url text)
     where x.id is not null
       and exists (select 1 from public.thimar_conversations c
                    where c.id = x.conversation_id
                      and c.member_ids @> jsonb_build_array(v_me))
    on conflict (id) do update
      set text = excluded.text, read_by = excluded.read_by,
          media_url = coalesce(excluded.media_url, m.media_url), duration = excluded.duration
      where m.sender_id = v_me
         or m.id in (select id from public.thimar_chat_messages where sender_id = v_me);
    return jsonb_build_object('ok', true);

  elsif v_op = 'chat.deleteMessages' then
    delete from public.thimar_chat_messages m
     where m.id = any (array(select jsonb_array_elements_text(coalesce(v_data->'ids', '[]'::jsonb))))
       and (m.sender_id = v_me or v_is_admin
            or exists (select 1 from public.thimar_conversations c
                        where c.id = m.conversation_id
                          and c.member_ids @> jsonb_build_array(v_me)
                          and (c.admins @> jsonb_build_array(v_me) or c.created_by = v_me)));
    return jsonb_build_object('ok', true);

  elsif v_op = 'chat.deleteConversation' then
    delete from public.thimar_chat_messages
     where conversation_id = v_data->>'conversationId'
       and exists (select 1 from public.thimar_conversations c
                    where c.id = v_data->>'conversationId'
                      and c.member_ids @> jsonb_build_array(v_me)
                      and (c.created_by = v_me or c.admins @> jsonb_build_array(v_me) or v_is_admin));
    delete from public.thimar_conversations c
     where c.id = v_data->>'conversationId'
       and c.member_ids @> jsonb_build_array(v_me)
       and (c.created_by = v_me or c.admins @> jsonb_build_array(v_me) or v_is_admin);
    return jsonb_build_object('ok', true);

  -- ---------- وسائط المحادثات (بدل الحاوية العامة) ----------
  elsif v_op = 'media.put' then
    v_conv := v_data->>'conversationId';
    if not exists (select 1 from public.thimar_conversations c
                    where c.id = v_conv and c.member_ids @> jsonb_build_array(v_me)) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if coalesce(v_data->>'data', '') = '' then
      raise exception 'EMPTY_MEDIA' using errcode = '22023';
    end if;
    if length(v_data->>'data') > 11 * 1024 * 1024 then
      raise exception 'MEDIA_TOO_LARGE' using errcode = '22023';
    end if;
    insert into public.thimar_media
      (conversation_id, uploader_id, file_name, mime, size_bytes, sha256, bytes)
    values (v_conv, v_me, v_data->>'fileName', coalesce(v_data->>'mime', 'application/octet-stream'),
            length(decode(v_data->>'data', 'base64')), 'pending', decode(v_data->>'data', 'base64'))
    returning * into v_media;
    update public.thimar_media
       set sha256 = encode(extensions.digest(bytes, 'sha256'), 'hex')
     where id = v_media.id
     returning * into v_media;
    return jsonb_build_object('mediaId', v_media.id, 'ref', 'thimar-media:' || v_media.id);

  elsif v_op = 'media.get' then
    select * into v_media from public.thimar_media
     where id = nullif(replace(coalesce(v_data->>'ref', v_data->>'mediaId', ''), 'thimar-media:', ''), '')::uuid;
    if v_media.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if not exists (select 1 from public.thimar_conversations c
                    where c.id = v_media.conversation_id and c.member_ids @> jsonb_build_array(v_me)) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'ref', 'thimar-media:' || v_media.id, 'fileName', v_media.file_name, 'mime', v_media.mime,
      'size', v_media.size_bytes, 'sha256', v_media.sha256,
      'data', encode(v_media.bytes, 'base64'));

  -- ---------- المسؤول ----------
  elsif v_op like 'admin.%' then
    if not v_is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if v_op = 'admin.accounts' then
      return jsonb_build_object('accounts', coalesce((
        select jsonb_agg(public.thimar_account_json(a) order by a.created_at desc)
        from public.thimar_accounts a), '[]'::jsonb));
    elsif v_op = 'admin.account.update' then
      update public.thimar_accounts
         set status = coalesce(v_data->>'status', status),
             banned = coalesce((v_data->>'banned')::boolean, banned),
             type = coalesce(nullif(v_data->>'type', ''), type),
             rejection_reason = v_data->>'rejectionReason'
       where id = v_data->>'accountId'
       returning * into v_me_row;
      return jsonb_build_object('account', public.thimar_account_json(v_me_row));
    end if;
  end if;

  raise exception 'UNKNOWN_OP' using errcode = '22023';
end;
$$;

revoke all on function public.thimar_api(text, text, jsonb) from public;
