-- ============================================================================
-- ثمار — توسعة الواجهة: عمليتان تحتاجهما المزامنة
--   account.upsert  : تعديل الحساب (الذات دائمًا؛ غيرها للمسؤول فقط)
--   deletions.push  : آثار الحذف (لا تُقبل إلا لعناصر يملكها صاحب الجلسة)
--
-- تُنفَّذ بعد 20261126_02 (التي تنشئ thimar_api) و20261126_03 (التي تضبط المنح).
-- تُغلَّف الدالة الأصلية باسم thimar_api_core ثم تُوجَّه thimar_api للعمليتين
-- الجديدتين وتمرّر ما عداها إلى النواة كما هي.
-- ============================================================================

alter function public.thimar_api(text, text, jsonb) rename to thimar_api_core;

create or replace function public.thimar_api(
  p_token text, p_op text, p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me text;
  v_is_admin boolean;
  v_op text := lower(coalesce(p_op, ''));
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if v_op not in ('account.upsert', 'deletions.push') then
    return public.thimar_api_core(p_token, v_op, v_data);
  end if;

  v_me := public.thimar_require_session(p_token);
  select (type = 'admin') into v_is_admin from public.thimar_accounts where id = v_me;

  if v_op = 'account.upsert' then
    insert into public.thimar_accounts as a
      (id, type, full_name, country_code, phone, email, username, created_at,
       status, rejection_reason, student, teacher, guardian, banned)
    select x.id, coalesce(x.type, 'student'), coalesce(x.full_name, ''),
           coalesce(x.country_code, 'SA'), coalesce(x.phone, ''), coalesce(x.email, ''),
           lower(btrim(x.username)), coalesce(x.created_at, 0), coalesce(x.status, 'active'),
           x.rejection_reason, x.student, x.teacher, x.guardian, false
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        id text, type text, full_name text, country_code text, phone text, email text,
        username text, created_at bigint, status text, rejection_reason text,
        student jsonb, teacher jsonb, guardian jsonb)
     where x.id is not null and x.username is not null
    on conflict (id) do update
      set full_name = excluded.full_name,
          country_code = excluded.country_code,
          phone = excluded.phone,
          email = excluded.email,
          student = excluded.student,
          teacher = excluded.teacher,
          guardian = excluded.guardian,
          status = case when a.id = v_me or v_is_admin then excluded.status else a.status end,
          banned = case when v_is_admin then excluded.banned else a.banned end
      where a.id = v_me or v_is_admin;
    return jsonb_build_object('ok', true);

  elsif v_op = 'deletions.push' then
    insert into public.thimar_deletions as d (entity, id, deleted_at)
    select x.entity, x.id, coalesce(x.deleted_at, 0)
      from jsonb_to_recordset(coalesce(v_data->'rows', '[]'::jsonb)) as x(
        entity text, id text, deleted_at bigint)
     where x.id is not null
       and x.entity in ('account', 'notification', 'message', 'conversation')
       and (
         (x.entity = 'account' and (x.id = v_me or v_is_admin))
         or (x.entity = 'notification' and exists (
               select 1 from public.thimar_notifications n
                where n.id = x.id and n.recipient_id = v_me))
         or (x.entity = 'message' and exists (
               select 1 from public.thimar_chat_messages m
               join public.thimar_conversations c on c.id = m.conversation_id
                where m.id = x.id and c.member_ids @> jsonb_build_array(v_me)))
         or (x.entity = 'conversation' and exists (
               select 1 from public.thimar_conversations c
                where c.id = x.id and c.member_ids @> jsonb_build_array(v_me))))
    on conflict (entity, id) do update set deleted_at = excluded.deleted_at;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'UNKNOWN_OP' using errcode = '22023';
end;
$$;

grant execute on function public.thimar_api(text, text, jsonb) to anon, authenticated;
revoke execute on function public.thimar_api_core(text, text, jsonb) from anon, authenticated;
