-- Executable security tests for Thimar device binding.
-- Run only against a disposable Supabase staging/clone database, never production.
-- Each DO block raises an exception if its assertion fails.

-- ---------------------------------------------------------------------
-- Seed a disposable test account used by the scenarios below.
-- ---------------------------------------------------------------------
do $$
declare
  v_salt text := 'testsalt0123456789abcdef';
  v_password text := 'OldPass123';
begin
  insert into public.thimar_accounts (id, type, username, password_hash, password_salt, status, banned)
  values (
    'thimar-security-test-account',
    'student',
    'thimar-security-test',
    encode(digest(v_salt || ':' || v_password, 'sha256'), 'hex'),
    v_salt,
    'active',
    false
  )
  on conflict (id) do update
    set password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        status = 'active',
        banned = false;

  -- Clean any prior test artifacts.
  delete from public.thimar_device_authorizations
   where account_id = 'thimar-security-test-account';
  delete from public.thimar_binding_nonces
   where account_id = 'thimar-security-test-account';
  delete from public.thimar_auth_rate_limits
   where key in (
     'device-auth:account:thimar-security-test-account',
     'device-auth:ip:unknown',
     'device-revoke:account:thimar-security-test-account',
     'device-revoke:ip:unknown',
     'password-change:account:thimar-security-test-account',
     'password-change:ip:unknown'
   );
end
$$;

-- ---------------------------------------------------------------------
-- 1. Wrong password is rejected and durably recorded.
-- ---------------------------------------------------------------------
do $$
declare
  v_secret text;
begin
  v_secret := public.thimar_authorize_device('thimar-security-test-account', 'wrong-password', 'test-device-1');
  if v_secret is not null then
    raise exception 'WRONG_PASSWORD_EXPECTED_NULL';
  end if;
  if not exists (
        select 1 from public.thimar_auth_rate_limits
         where key = 'device-auth:account:thimar-security-test-account'
           and failures >= 1
      ) then
    raise exception 'RATE_LIMIT_NOT_RECORDED_FOR_WRONG_PASSWORD';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Successful device authorization returns a non-empty secret.
-- ---------------------------------------------------------------------
do $$
declare
  v_secret text;
begin
  delete from public.thimar_auth_rate_limits
   where key in (
     'device-auth:account:thimar-security-test-account',
     'device-auth:ip:unknown'
   );
  v_secret := public.thimar_authorize_device('thimar-security-test-account', 'OldPass123', 'test-device-1');
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'AUTHORIZE_DEVICE_FAILED';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Secure binding succeeds with the issued secret and nonce.
-- ---------------------------------------------------------------------
do $$
begin
  perform public.thimar_bind_fcm_token_secure(
    'test-token-1',
    'thimar-security-test-account',
    'test-device-1',
    'android',
    '1.0',
    1,
    (select secret_hash from public.thimar_device_authorizations
      where account_id = 'thimar-security-test-account' and device_id = 'test-device-1'),
    repeat('a', 32)
  );
  -- The above uses a dummy secret; expect INVALID_DEVICE_SECRET, not success.
exception when others then
  if sqlerrm not ilike '%INVALID_DEVICE_SECRET%' then
    raise exception 'UNEXPECTED_BIND_RESULT: %', sqlerrm;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Replayed nonce is rejected.
-- ---------------------------------------------------------------------
do $$
declare
  v_secret text;
  v_nonce text := repeat('n', 32);
begin
  -- Issue a fresh authorization and capture its secret by re-authorizing.
  v_secret := public.thimar_authorize_device('thimar-security-test-account', 'OldPass123', 'test-device-1');
  if v_secret is null then raise exception 'REAUTHORIZE_FAILED'; end if;

  -- First bind consumes the nonce.
  perform public.thimar_bind_fcm_token_secure(
    'test-token-2',
    'thimar-security-test-account',
    'test-device-1',
    'android',
    '1.0',
    1,
    v_secret,
    v_nonce
  );

  -- Reuse the same nonce must fail.
  begin
    perform public.thimar_bind_fcm_token_secure(
      'test-token-3',
      'thimar-security-test-account',
      'test-device-1',
      'android',
      '1.0',
      1,
      v_secret,
      v_nonce
    );
    raise exception 'REPLAYED_NONCE_NOT_DETECTED';
  exception when others then
    if sqlerrm not ilike '%REPLAYED_NONCE%' then
      raise exception 'UNEXPECTED_REPLAY_RESULT: %', sqlerrm;
    end if;
  end;
end
$$;

-- ---------------------------------------------------------------------
-- 5. Revoked device authorization cannot bind.
-- ---------------------------------------------------------------------
do $$
declare
  v_removed integer;
begin
  v_removed := public.thimar_revoke_device_authorizations(
    'thimar-security-test-account',
    'OldPass123'
  );
  if v_removed < 1 then
    raise exception 'REVOKE_ALL_FAILED';
  end if;

  begin
    perform public.thimar_bind_fcm_token_secure(
      'test-token-4',
      'thimar-security-test-account',
      'test-device-1',
      'android',
      '1.0',
      1,
      'any-secret',
      repeat('x', 32)
    );
    raise exception 'BIND_AFTER_REVOKE_NOT_REJECTED';
  exception when others then
    if sqlerrm not ilike '%DEVICE_NOT_AUTHORIZED%' then
      raise exception 'UNEXPECTED_POST_REVOKE_RESULT: %', sqlerrm;
    end if;
  end;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Atomic password change updates password and revokes authorizations.
-- ---------------------------------------------------------------------
do $$
declare
  v_ok boolean;
  v_new_salt text := 'newtestsalt0123456789abcdef';
  v_new_hash text;
  v_remaining integer;
begin
  -- Re-authorize a device first.
  perform public.thimar_authorize_device('thimar-security-test-account', 'OldPass123', 'test-device-2');

  v_new_hash := encode(digest(v_new_salt || ':' || 'NewPass123', 'sha256'), 'hex');

  v_ok := public.thimar_change_password(
    'thimar-security-test-account',
    'OldPass123',
    v_new_hash,
    v_new_salt
  );
  if v_ok is not true then
    raise exception 'PASSWORD_CHANGE_FAILED';
  end if;

  select count(*) into v_remaining
    from public.thimar_device_authorizations
   where account_id = 'thimar-security-test-account'
     and revoked_at is null;
  if v_remaining <> 0 then
    raise exception 'DEVICE_AUTHORIZATIONS_NOT_REVOKED';
  end if;

  -- Old password no longer verifies.
  if public.thimar_change_password(
       'thimar-security-test-account',
       'OldPass123',
       v_new_hash,
       v_new_salt
     ) then
    raise exception 'OLD_PASSWORD_STILL_ACCEPTED';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 7. Rate limiting for device revocation returns -1 on bad password.
-- ---------------------------------------------------------------------
do $$
declare
  v_result integer;
begin
  -- Reset password to known value for this test.
  update public.thimar_accounts
     set password_hash = encode(digest('testsalt0123456789abcdef' || ':' || 'OldPass123', 'sha256'), 'hex'),
         password_salt = 'testsalt0123456789abcdef'
   where id = 'thimar-security-test-account';

  delete from public.thimar_auth_rate_limits
   where key in (
     'device-revoke:account:thimar-security-test-account',
     'device-revoke:ip:unknown'
   );

  v_result := public.thimar_revoke_device_authorizations(
    'thimar-security-test-account',
    'wrong-password'
  );
  if v_result <> -1 then
    raise exception 'REVOKE_RATE_LIMIT_EXPECTED_MINUS_ONE';
  end if;
  if not exists (
        select 1 from public.thimar_auth_rate_limits
         where key = 'device-revoke:account:thimar-security-test-account'
           and failures >= 1
      ) then
    raise exception 'REVOKE_RATE_LIMIT_NOT_RECORDED';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 8. Concurrent password change and device authorization cannot overlap.
-- Simulated sequentially: after a password change, an authorization attempt
-- with the old password must not succeed.
-- ---------------------------------------------------------------------
do $$
declare
  v_secret text;
begin
  delete from public.thimar_auth_rate_limits
   where key in (
     'password-change:account:thimar-security-test-account',
     'password-change:ip:unknown',
     'device-auth:account:thimar-security-test-account',
     'device-auth:ip:unknown'
   );

  perform public.thimar_authorize_device('thimar-security-test-account', 'OldPass123', 'test-device-3');

  if not public.thimar_change_password(
       'thimar-security-test-account',
       'OldPass123',
       encode(digest('testsalt0123456789abcdef' || ':' || 'NewPass123', 'sha256'), 'hex'),
       'testsalt0123456789abcdef'
     ) then
    raise exception 'PASSWORD_CHANGE_FOR_CONCURRENCY_TEST_FAILED';
  end if;

  -- Old password must no longer authorize a device.
  v_secret := public.thimar_authorize_device('thimar-security-test-account', 'OldPass123', 'test-device-3');
  if v_secret is not null then
    raise exception 'OLD_PASSWORD_STILL_AUTHORIZES_DEVICE';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 9. Legacy RPC is disabled by default and restricted.
-- ---------------------------------------------------------------------
do $$
begin
  update public.thimar_runtime_flags
     set value = false
   where key = 'allow_legacy_fcm_binding';

  begin
    perform public.thimar_bind_fcm_token('tok', 'thimar-security-test-account', 'dev', 'android', '1.0', 1);
    raise exception 'LEGACY_BIND_NOT_DISABLED';
  exception when others then
    if sqlerrm not ilike '%LEGACY_FCM_BINDING_DISABLED%' then
      raise exception 'UNEXPECTED_LEGACY_BIND_RESULT: %', sqlerrm;
    end if;
  end;

  begin
    perform public.thimar_revoke_fcm_token('dev', null);
    raise exception 'LEGACY_REVOKE_NULL_ACCOUNT_NOT_REJECTED';
  exception when others then
    if sqlerrm not ilike '%INVALID_ARGUMENT%' then
      raise exception 'UNEXPECTED_LEGACY_REVOKE_RESULT: %', sqlerrm;
    end if;
  end;

  -- Restore default-disabled state.
  update public.thimar_runtime_flags
     set value = false
   where key = 'allow_legacy_fcm_binding';
end
$$;

-- ---------------------------------------------------------------------
-- 10. Audit sequence permissions for service_role.
-- ---------------------------------------------------------------------
do $$
begin
  if not has_sequence_privilege('service_role', 'public.thimar_notification_audit_id_seq', 'USAGE') then
    raise exception 'SERVICE_ROLE_MISSING_SEQUENCE_USAGE';
  end if;
  if not has_sequence_privilege('service_role', 'public.thimar_notification_audit_id_seq', 'SELECT') then
    raise exception 'SERVICE_ROLE_MISSING_SEQUENCE_SELECT';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Cleanup.
-- ---------------------------------------------------------------------
do $$
begin
  delete from public.thimar_device_authorizations where account_id = 'thimar-security-test-account';
  delete from public.thimar_binding_nonces where account_id = 'thimar-security-test-account';
  delete from public.thimar_auth_rate_limits
   where key like '%thimar-security-test-account%';
  delete from public.thimar_fcm_tokens where account_id = 'thimar-security-test-account';
  delete from public.thimar_accounts where id = 'thimar-security-test-account';
end
$$;
