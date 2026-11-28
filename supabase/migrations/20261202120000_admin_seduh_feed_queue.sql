-- Seduh Score Next · the console's Seduh ID queue: a names view, Reject, and (switched OFF) Approve
--
-- Owner decisions, 2026-11-28 (thread "Tidy up Admin page and Seduh ID"): (1) the platform admin may SEE the names on the Seduh ID
-- feed queue (an amendment of D-A4, names and places only, never a phone number or a cafe); (2) Reject from the console;
-- (3) build the plumbing for Approve but do NOT surface it: the owner will harden the console first (Cloudflare) and decide then.
--
--   * app.seduh_feed_mode.console_actions   boolean, default false: THE SWITCH. Approve from the console is refused (hint
--                                            seduh_feed_console_off) until the owner sets it with SQL. Nothing in the app sets it.
--   * public.admin_seduh_feed_queue()       read: what waits in the queue, per result: organisation, event, date, when queued, and
--                                            the podium as positions and names. No phone, no cafe, no id of a person.
--   * public.admin_seduh_feed_reject(id)    marks one QUEUED result rejected (audit seduh_feed.reject). Creates nothing.
--   * public.admin_seduh_feed_approve(id)   runs the feed for one queued result (audit seduh_feed.approve). Refused while the switch
--                                            is off. NO button calls it yet.
--   * app.seduh_feed_apply                  redefined: the only change is a third path, p_via = 'admin', which needs
--                                            app.require_platform_admin() AND the switch. The owner path and the API-role refusal
--                                            are as before. The function still has no grant to any API role.
--   * seduh_feed_queue_via_vocab            gains 'admin'.
--
-- Every function opens with app.require_platform_admin() (an admin with aal2 and a TOTP in the last 60 minutes). The audit detail
-- carries ids and counts only (never a name).
--
-- rollback (run in this order; the queue rows marked 'admin' are set back to 'owner' first so the old constraint can return):
--   drop function if exists public.admin_seduh_feed_approve(uuid);
--   drop function if exists public.admin_seduh_feed_reject(uuid);
--   drop function if exists public.admin_seduh_feed_queue();
--   update app.seduh_feed_queue set processed_via = 'owner' where processed_via = 'admin';
--   alter table app.seduh_feed_queue drop constraint seduh_feed_queue_via_vocab;
--   alter table app.seduh_feed_queue add constraint seduh_feed_queue_via_vocab check (processed_via is null or processed_via in ('owner', 'auto'));
--   alter table app.seduh_feed_mode drop column console_actions;
--   (then re-run the app.seduh_feed_apply definition of 20261103100000_seduh_feed.sql)

alter table app.seduh_feed_mode add column console_actions boolean not null default false;

alter table app.seduh_feed_queue drop constraint seduh_feed_queue_via_vocab;
alter table app.seduh_feed_queue add constraint seduh_feed_queue_via_vocab
  check (processed_via is null or processed_via in ('owner', 'auto', 'admin'));

create or replace function app.seduh_feed_apply(p_result_ids uuid[], p_via text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api     text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_ids     uuid[];
  v_created jsonb := '[]';
  v_linked  jsonb := '[]';
begin
  if p_via = 'admin' then
    -- The console path (hidden until the owner switches it on): a platform admin at aal2 with a fresh TOTP, AND the owner's
    -- switch. Both are checked HERE, in the function that creates, so no caller can reach the creating step by any other door.
    -- require_platform_admin reads the verified token, which a caller cannot forge; the switch is owner SQL only.
    perform app.require_platform_admin();
    if not coalesce((select m.console_actions from app.seduh_feed_mode m), false) then
      raise exception 'approving from the console is switched off'
        using errcode = '42501', hint = 'seduh_feed_console_off';
    end if;
  elsif session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api)
     or p_via is null or p_via not in ('owner', 'auto') then
    raise exception 'seduh_feed_apply is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;

  select coalesce(array_agg(s.result_id order by s.result_id), '{}') into v_ids
    from (select q.result_id from app.seduh_feed_queue q
           where q.result_id = any (p_result_ids) and q.state = 'queued'
           order by q.result_id for update) s;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('processed', 0, 'created_identity_ids', '[]'::jsonb, 'linked_person_ids', '[]'::jsonb);
  end if;

  -- 1. create the identities that do not exist (the unique phone is the match key; a concurrent creator is not an error)
  with pl as (select * from app.seduh_feed_plan_internal(v_ids)),
  ins as (
    insert into app.seduh_identities (phone_e164, display_name, country, source, status)
    select pl.phone,
           left((array_agg(pl.cand_name order by pl.rank))[1], 120),
           (array_agg(pl.cand_country order by pl.rank) filter (where pl.cand_country is not null))[1],
           'archive', 'active'
    from pl
    where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null
    group by pl.phone
    on conflict (phone_e164) do nothing
    returning id, phone_e164
  )
  select coalesce(jsonb_agg(jsonb_build_object('i', ins.id, 'r',
           (select pl.result_id from pl where pl.phone = ins.phone_e164 and pl.class = 'eligible' order by pl.rank limit 1))), '[]')
    into v_created from ins;

  -- 2. decide again now that the new identities exist (also re-reads blocks and links), then link
  perform set_config('app.seduh_link_write', 'on', true);
  with pl as (select * from app.seduh_feed_plan_internal(v_ids)),
  upd as (
    update public.people p
       set global_person_id = pl.identity_id
      from pl
     where pl.person_id = p.id
       and pl.class = 'eligible'
       and pl.identity_id is not null
       and p.phone = pl.phone                  -- a number changed since the plan is left alone
       and p.global_person_id is null          -- never overwrite a link someone put there on purpose
    returning p.id, pl.result_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('p', upd.id, 'r', upd.result_id)), '[]') into v_linked from upd;
  perform set_config('app.seduh_link_write', '', true);

  update app.seduh_feed_queue q
     set state = 'processed', processed_at = now(), processed_via = p_via, last_error = null,
         created_identity_ids = q.created_identity_ids
           || coalesce((select array_agg((c ->> 'i')::uuid order by c ->> 'i') from jsonb_array_elements(v_created) c where (c ->> 'r')::uuid = q.result_id), '{}'),
         linked_person_ids = q.linked_person_ids
           || coalesce((select array_agg((l ->> 'p')::uuid order by l ->> 'p') from jsonb_array_elements(v_linked) l where (l ->> 'r')::uuid = q.result_id), '{}')
   where q.result_id = any (v_ids);

  return jsonb_build_object(
    'processed', cardinality(v_ids),
    'created_identity_ids', coalesce((select jsonb_agg(c -> 'i') from jsonb_array_elements(v_created) c), '[]'),
    'linked_person_ids', coalesce((select jsonb_agg(l -> 'p') from jsonb_array_elements(v_linked) l), '[]'));
end;
$$;
revoke all on function app.seduh_feed_apply(uuid[], text) from public, anon, authenticated, service_role;

-- ============ the view ============

create or replace function public.admin_seduh_feed_queue()
returns table (
  result_id   uuid,
  org_name    text,
  event_name  text,
  event_date  date,
  enqueued_at timestamptz,
  podium      jsonb,
  console_actions boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_platform_admin();
  return query
  select q.result_id,
         left(coalesce(o.name, ''), 120),
         left(coalesce(e.name, ''), 120),
         e.event_date,
         q.enqueued_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('position', t.pos, 'name', left(btrim(t.elem ->> 'name'), 80)) order by t.pos)
             from jsonb_array_elements(
                    case when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium' else '[]'::jsonb end
                  ) with ordinality as t(elem, pos)
            where nullif(btrim(t.elem ->> 'name'), '') is not null
         ), '[]'::jsonb),
         coalesce((select m.console_actions from app.seduh_feed_mode m), false)
    from app.seduh_feed_queue q
    left join public.public_results pr on pr.id = q.result_id
    left join public.events e on e.id = pr.event_id
    left join public.orgs o on o.id = q.org_id
   where q.state = 'queued'
   order by q.enqueued_at, q.result_id
   limit 100;
end;
$$;
revoke all on function public.admin_seduh_feed_queue() from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_feed_queue() to authenticated;

-- ============ reject ============

create or replace function public.admin_seduh_feed_reject(p_result_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  perform app.require_platform_admin();

  update app.seduh_feed_queue q
     set state = 'rejected', processed_at = now(), processed_via = 'admin', last_error = null
   where q.result_id = p_result_id and q.state = 'queued'
  returning q.org_id into v_org;
  if not found then
    raise exception 'admin_seduh_feed_reject: nothing waiting for that result'
      using errcode = '22023', hint = 'feed_not_queued';
  end if;

  perform app.admin_audit('seduh_feed.reject', v_org, null, jsonb_build_object('result_id', p_result_id));
end;
$$;
revoke all on function public.admin_seduh_feed_reject(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_feed_reject(uuid) to authenticated;

-- ============ approve (switched off; no button) ============

create or replace function public.admin_seduh_feed_approve(p_result_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_org  uuid;
  v_one  jsonb;
begin
  perform app.require_platform_admin();
  if not coalesce((select m.console_actions from app.seduh_feed_mode m), false) then
    raise exception 'approving from the console is switched off'
      using errcode = '42501', hint = 'seduh_feed_console_off';
  end if;
  select m.mode into v_mode from app.seduh_feed_mode m;
  if v_mode is distinct from 'queue' and v_mode is distinct from 'auto' then
    raise exception 'the Seduh ID feed is off' using errcode = 'P0001', hint = 'seduh_feed_mode_off';
  end if;
  select q.org_id into v_org from app.seduh_feed_queue q where q.result_id = p_result_id and q.state = 'queued';
  if v_org is null then
    raise exception 'admin_seduh_feed_approve: nothing waiting for that result'
      using errcode = '22023', hint = 'feed_not_queued';
  end if;

  v_one := app.seduh_feed_apply(array[p_result_id], 'admin');
  -- a reject that committed between the read above and the locked re-check inside apply leaves nothing processed: say so, audit nothing
  if (v_one ->> 'processed')::integer = 0 then
    raise exception 'admin_seduh_feed_approve: nothing waiting for that result'
      using errcode = '22023', hint = 'feed_not_queued';
  end if;

  perform app.admin_audit('seduh_feed.approve', v_org, null, jsonb_build_object(
    'result_id', p_result_id,
    'identities_created', jsonb_array_length(v_one -> 'created_identity_ids'),
    'people_linked', jsonb_array_length(v_one -> 'linked_person_ids')));

  return jsonb_build_object(
    'identities_created', jsonb_array_length(v_one -> 'created_identity_ids'),
    'people_linked', jsonb_array_length(v_one -> 'linked_person_ids'));
end;
$$;
revoke all on function public.admin_seduh_feed_approve(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_feed_approve(uuid) to authenticated;
