-- Seduh Score Next · T-ID2.B3b: only an OPEN account blocks claiming an identity (the undo-claim fix)
-- (owner decision 2026-11-16; B3a's CONVENTIONS "Known limit: the identity cannot be claimed again".)
--
-- A2 made app.seduh_accounts.identity_id plainly unique and never deletes a row, so an identity whose claim was undone (closed) could
-- never be claimed again. That is wrong for a wrong person claiming a link, and for a person who closes and comes back. Now:
--   * the plain unique constraint is replaced by a PARTIAL unique index: one OPEN account (closed_at is null) per identity;
--   * a closed account keeps its row, its retired handle (seduh_accounts_handle_key stays plain unique) and its founding number
--     (seduh_accounts_founding_number_key stays plain unique), and is never deleted (A2's triggers are untouched);
--   * a re-claim makes a NEW row with a NEW handle and a NEW number (the next from the sequence; #0001, once consumed, is not reissued);
--   * seduh_accounts_id_identity_key unique (id, identity_id), which the claim links' and the reservation's composite foreign keys
--     use, is untouched, so a link or a reservation still names the account that made it AND that account's identity;
--   * the four B3a functions that asked "does this identity have an account" now ask "an open one": issue_seduh_claim_link,
--     seduh_claim_statuses (a closed account is back to can_issue, and a person with two rows (one closed) still gets one row),
--     seduh_claim_begin and claim_seduh_id (a lost race for the identity maps to identity_claimed from the new index's name).
--     Each function body is B3a's, with only those predicates changed.
--
-- ROLLBACK restores the plain unique constraint and FAILS, on purpose, if any identity has been re-claimed (two rows): do not roll
-- back a populated database. The four functions are not restored by it: with the plain unique back they still work, but a database
-- that holds a CLOSED account keeps this migration's behaviour (a new link can be issued, and the claim then fails with a raw
-- unique violation instead of B3a's up-front hint). To go back fully, re-run the four function bodies of 20261118100000.
-- rollback:
--   drop index if exists app.seduh_accounts_identity_open_key;
--   alter table app.seduh_accounts add constraint seduh_accounts_identity_id_key unique (identity_id);

alter table app.seduh_accounts drop constraint seduh_accounts_identity_id_key;
create unique index seduh_accounts_identity_open_key on app.seduh_accounts (identity_id) where closed_at is null;

create or replace function public.issue_seduh_claim_link(p_person_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_identity  uuid;
  v_status    text;
  v_token     text;
  v_link      uuid;
  v_replaced  integer;
begin
  -- 1. membership first, with the organisation DERIVED from the person: a missing person, another organisation's person
  --    and NULL are the same refusal for a non-member
  v_org := app.org_id_for_person_internal(p_person_id);
  perform app.refuse_non_member(v_org, 'people');
  if v_org is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  select p.global_person_id into v_identity from public.people p where p.id = p_person_id;
  if v_identity is null then
    raise exception 'This person has no Seduh ID yet: it is made when a published result is reviewed.'
      using errcode = 'P0001', hint = 'no_identity';
  end if;

  -- 2. serialise everything about this identity (issue, revoke, claim all lock it first)
  select i.status into v_status from app.seduh_identities i where i.id = v_identity for update;
  if v_status = 'opted_out' then
    raise exception 'This person has no Seduh ID yet: it is made when a published result is reviewed.'
      using errcode = 'P0001', hint = 'no_identity';
  elsif v_status is distinct from 'active' then
    raise exception 'This Seduh ID cannot be claimed.' using errcode = 'P0001', hint = 'identity_unavailable';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.identity_id = v_identity and a.closed_at is null) then
    raise exception 'This Seduh ID has already been claimed.' using errcode = 'P0001', hint = 'identity_claimed';
  end if;

  -- 3. at most one open link per identity: revoke every open one, EXPIRED ones too (a partial index cannot see the clock)
  update app.seduh_claim_links l set revoked_at = now()
   where l.identity_id = v_identity and l.used_at is null and l.revoked_at is null;
  get diagnostics v_replaced = row_count;

  -- 4. 256 random bits, URL-safe (43 characters); only the SHA-256 is stored
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=' || chr(10), '-_');
  insert into app.seduh_claim_links (identity_id, org_id, issued_by, token_hash)
  values (v_identity, v_org, auth.uid(), app.seduh_claim_token_hash(v_token))
  returning id into v_link;

  perform app.seduh_claim_audit_write('claim_link.issue', v_org, v_identity, v_link, null,
    jsonb_build_object('person_id', p_person_id, 'replaced_open_links', v_replaced));
  return v_token;
end;
$$;

create or replace function public.seduh_claim_statuses(p_org_id uuid, p_person_ids uuid[])
returns table (person_id uuid, state text, expires_at timestamptz, handle text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(p_org_id, 'people');
  if p_org_id is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_person_ids), 0) > 500 then
    raise exception 'Too many people at once.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  -- every id must be a person of THIS organisation: a missing id and another organisation's person are the SAME refusal
  if (select count(*) from public.people p where p.org_id = p_org_id and p.id = any (coalesce(p_person_ids, '{}'::uuid[])))
     <> (select count(distinct x) from unnest(coalesce(p_person_ids, '{}'::uuid[])) x) then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  return query
  select p.id,
         case
           when p.global_person_id is null or i.id is null or i.status = 'opted_out' then 'no_identity'
           when i.status = 'merged' then 'unavailable'
           when a.id is not null then 'claimed'
           when l.id is not null then 'link_open'
           else 'can_issue'
         end,
         case when a.id is null and i.status = 'active' then l.expires_at end,
         case when i.status = 'active' then a.handle end
    from public.people p
    left join app.seduh_identities i on i.id = p.global_person_id
    left join app.seduh_accounts a on a.identity_id = i.id and a.closed_at is null
    left join app.seduh_claim_links l
           on l.identity_id = i.id and l.used_at is null and l.revoked_at is null and l.expires_at > now()
   where p.org_id = p_org_id and p.id = any (coalesce(p_person_ids, '{}'::uuid[]));
end;
$$;

create or replace function public.seduh_claim_begin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l     app.seduh_claim_links%rowtype;
  v_st  text;
  v_dn  text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into l from app.seduh_claim_links where token_hash = app.seduh_claim_token_hash(p_token) for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if l.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if l.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;

  select i.status, i.display_name into v_st, v_dn from app.seduh_identities i where i.id = l.identity_id;
  if v_st is distinct from 'active'
     or exists (select 1 from app.seduh_accounts a where a.identity_id = l.identity_id and a.closed_at is null) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if l.code_sends >= 6 then
    return jsonb_build_object('status', 'too_many');
  end if;
  update app.seduh_claim_links set code_sends = code_sends + 1, last_code_sent_at = now() where id = l.id;
  return jsonb_build_object('status', 'ok', 'display_name', v_dn);
end;
$$;

create or replace function public.claim_seduh_id(p_token text, p_handle text, p_adult boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_handle    text := lower(btrim(coalesce(p_handle, '')));
  l           app.seduh_claim_links%rowtype;
  v_identity  uuid;
  v_status    text;
  v_hash      text;
  v_acct      uuid;
  v_number    integer;
  v_reserved  boolean := false;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- an admin login never becomes a competitor account (the owner uses a separate competitor email)
  if exists (select 1 from app.platform_admins pa where pa.user_id = v_uid) then
    raise exception 'This login is an administrator login and cannot claim a Seduh ID.'
      using errcode = 'P0001', hint = 'admin_cannot_claim';
  end if;
  if p_adult is distinct from true then
    raise exception 'You must confirm you are 18 or over.' using errcode = 'P0001', hint = 'adult_required';
  end if;

  -- handle: shape, reserved, taken (a closed account keeps its handle, so that is taken too: a re-claim after an undo needs a NEW handle)
  if not (v_handle ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(v_handle) between 3 and 30) then
    raise exception 'That handle is not allowed.' using errcode = 'P0001', hint = 'handle_invalid';
  end if;
  if app.seduh_handle_reserved(v_handle) then
    raise exception 'That handle is reserved.' using errcode = 'P0001', hint = 'handle_reserved';
  end if;

  -- the link: found by hash, without a lock first, so the identity can be locked BEFORE the link (issue and revoke lock the
  -- identity first too: one lock order, no deadlock)
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'This claim link is not valid.' using errcode = 'P0001', hint = 'link_invalid';
  end if;
  v_hash := app.seduh_claim_token_hash(p_token);
  select l0.identity_id into v_identity from app.seduh_claim_links l0 where l0.token_hash = v_hash;
  if v_identity is null then
    raise exception 'This claim link is not valid.' using errcode = 'P0001', hint = 'link_invalid';
  end if;
  select i.status into v_status from app.seduh_identities i where i.id = v_identity for update;
  select * into l from app.seduh_claim_links where token_hash = v_hash for update;

  if l.used_at is not null then
    raise exception 'This claim link has already been used.' using errcode = 'P0001', hint = 'link_used';
  elsif l.revoked_at is not null then
    raise exception 'This claim link was cancelled.' using errcode = 'P0001', hint = 'link_revoked';
  elsif l.expires_at <= now() then
    raise exception 'This claim link has expired.' using errcode = 'P0001', hint = 'link_expired';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'This Seduh ID cannot be claimed.' using errcode = 'P0001', hint = 'identity_unavailable';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.identity_id = v_identity and a.closed_at is null) then
    raise exception 'This Seduh ID has already been claimed.' using errcode = 'P0001', hint = 'identity_claimed';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.user_id = v_uid) then
    raise exception 'This login already has a Seduh ID.' using errcode = 'P0001', hint = 'account_exists';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.handle = v_handle) then
    raise exception 'That handle is taken.' using errcode = 'P0001', hint = 'handle_taken';
  end if;

  -- the owner's #0001: a reservation for THIS identity, and nothing else, may pass the number explicitly
  select r.founding_number into v_number
    from app.seduh_reserved_numbers r
   where r.identity_id = v_identity and r.consumed_at is null
   for update;
  v_reserved := found;

  begin
    if v_reserved then
      perform set_config('app.seduh_owner_assignment', 'on', true);
      insert into app.seduh_accounts (identity_id, user_id, handle, founding_number, claim_method, adult_attested_at)
      values (v_identity, v_uid, v_handle, v_number, 'organiser_link', now())
      returning id, founding_number into v_acct, v_number;
      perform set_config('app.seduh_owner_assignment', '', true);
    else
      insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at)
      values (v_identity, v_uid, v_handle, 'organiser_link', now())
      returning id, founding_number into v_acct, v_number;
    end if;
  exception when unique_violation then
    -- a concurrent claim won the handle (or the login): say which, from the constraint. Anything else (the founding number,
    -- when the owner inserted number 1 by hand while a reservation was open) is NOT a handle problem: re-raise it unchanged.
    get stacked diagnostics v_constraint = constraint_name;
    perform set_config('app.seduh_owner_assignment', '', true);
    if v_constraint = 'seduh_accounts_user_id_key' then
      raise exception 'This login already has a Seduh ID.' using errcode = 'P0001', hint = 'account_exists';
    elsif v_constraint = 'seduh_accounts_handle_key' then
      raise exception 'That handle is taken.' using errcode = 'P0001', hint = 'handle_taken';
    elsif v_constraint = 'seduh_accounts_identity_open_key' then
      raise exception 'This Seduh ID has already been claimed.' using errcode = 'P0001', hint = 'identity_claimed';
    end if;
    raise;
  end;

  if v_reserved then
    update app.seduh_reserved_numbers set account_id = v_acct, consumed_at = now()
     where identity_id = v_identity and consumed_at is null;
  end if;
  update app.seduh_claim_links set used_at = now(), account_id = v_acct where id = l.id;

  perform app.seduh_claim_audit_write('claim.complete', l.org_id, v_identity, l.id, v_acct,
    jsonb_build_object('claim_method', 'organiser_link', 'founding_number', v_number, 'reserved_number', v_reserved));

  return jsonb_build_object('handle', v_handle, 'founding_number', v_number, 'profile_path', '/id/' || v_handle || '/');
end;
$$;
