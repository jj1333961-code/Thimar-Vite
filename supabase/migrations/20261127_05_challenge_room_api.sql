-- ============================================================================
-- ثمار — غرف التحدي الأونلاين تمرّ عبر دالة بدل الجدول المفتوح
--
-- بعد 20261127_03_lockdown_api_only.sql لم يبقَ للعميل وصول مباشر إلى
-- public.thimar_challenge_rooms. هذه الدالة تعيد له ما يحتاجه فقط:
-- إنشاء غرفة (بجلسة موثّقة) وقراءة الأجزاء المشتركة برمز الغرفة.
-- اللعب نفسه يظل على بث Realtime، فلا يتأثر.
-- لا يحذف أي بيانات.
-- ============================================================================

create or replace function public.thimar_challenge_room(p_token text, p_op text, p_data jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := public.thimar_require_session(p_token);
  v_code text := upper(btrim(coalesce(p_data->>'code', '')));
  v_juzs int[] := array(select jsonb_array_elements_text(coalesce(p_data->'juzs', '[]'::jsonb))::int);
  v_room public.thimar_challenge_rooms;
begin
  if p_op = 'create' then
    if v_code !~ '^[A-Z0-9]{4,8}$' then
      raise exception 'INVALID_CODE' using errcode = '22023';
    end if;
    if coalesce(array_length(v_juzs, 1), 0) < 1 or array_length(v_juzs, 1) > 7 then
      raise exception 'INVALID_JUZS' using errcode = '22023';
    end if;
    if not public.thimar_rate_hit('room:' || v_me, 15, interval '1 hour') then
      raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
    end if;
    perform public.thimar_rate_fail('room:' || v_me);

    insert into public.thimar_challenge_rooms (code, host_name, juzs, status)
    values (v_code, left(coalesce(p_data->>'hostName', ''), 60), v_juzs, 'waiting')
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  if p_op = 'get' then
    if v_code = '' then
      raise exception 'CODE_REQUIRED' using errcode = '22023';
    end if;
    select * into v_room from public.thimar_challenge_rooms
     where code = v_code and created_at > now() - interval '6 hours'
     order by created_at desc limit 1;
    if v_room.id is null then
      return jsonb_build_object('room', null);
    end if;
    return jsonb_build_object('room', jsonb_build_object(
      'code', v_room.code, 'hostName', v_room.host_name,
      'juzs', to_jsonb(v_room.juzs), 'status', v_room.status));
  end if;

  raise exception 'UNKNOWN_OP' using errcode = '22023';
end;
$$;

revoke all on function public.thimar_challenge_room(text, text, jsonb) from public;
grant execute on function public.thimar_challenge_room(text, text, jsonb) to anon, authenticated;
