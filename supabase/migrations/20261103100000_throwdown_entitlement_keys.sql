-- Seduh Score Next - T-TD.1.1: Throwdown entitlement keys, and the Throwdown branch of the participant cap
--
-- Throwdown declares its keys in its first commit (gating spec; the catalog contract test fails otherwise):
--   * throwdown_participants (cap): Community 8, Per-event and Annual unlimited. The unit is the active (non-withdrawn)
--     event_entries row of a Throwdown event, counted exactly like Cup Taster's.
--   * four module slots (flags), one per later module phase: redemption and revival need Per-event, lucky loser and
--     latte art are free. Declared only; no code branches on any of them (D14) and no module is built in TD.1.
-- All keys are seeded unenforced (every key starts off; flipping one is the owner's, by hand).
--
-- app.check_event_entry_cap is REPLACED: the format -> key map gains 'throwdown'. Everything else about the function is
-- unchanged (it still opens with refuse_non_member, still fails closed: an unknown format is capped as Cup Taster).
--
-- rollback:
--   restores the previous body of app.check_event_entry_cap (btc exempt, everything else capped as Cup Taster) and removes
--   the five keys (their caps first).
--     delete from app.entitlement_caps where key = 'throwdown_participants';
--     delete from app.entitlement_keys where key in ('throwdown_participants','throwdown_redemption','throwdown_revival','throwdown_lucky_loser','throwdown_latte_art');
--     (then re-run the B3 body: supabase/migrations/20261023120000_entitlement_enforcement_hooks.sql, app.check_event_entry_cap)

do $seed$
declare
  v_add jsonb := $catalog_add$
{
  "keys": [
    {
      "key": "throwdown_participants",
      "kind": "cap",
      "min_tier": null,
      "window_bound": true,
      "note": "Active (non-withdrawn) competitors per Throwdown event. Community 8; Per-event and Annual unlimited (Throwdown spec, section 10). Whether a withdrawn competitor still counts is open (Q8b).",
      "caps": {
        "community": 8,
        "per_event": null,
        "annual": null
      }
    },
    {
      "key": "throwdown_redemption",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "Throwdown redemption round module. Slot only: the module is not built (TD.3)."
    },
    {
      "key": "throwdown_revival",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "Throwdown revival draw module. Slot only: the module is not built (TD.5)."
    },
    {
      "key": "throwdown_lucky_loser",
      "kind": "flag",
      "min_tier": null,
      "window_bound": true,
      "note": "Throwdown lucky loser draw module. Free. Slot only: the module is not built (TD.4)."
    },
    {
      "key": "throwdown_latte_art",
      "kind": "flag",
      "min_tier": null,
      "window_bound": true,
      "note": "Throwdown latte art pre-round draw module. Free. Slot only: the module is not built (TD.6)."
    }
  ]
}
$catalog_add$::jsonb;
  k jsonb;
  t record;
begin
  for k in select * from jsonb_array_elements(v_add -> 'keys') loop
    insert into app.entitlement_keys (key, kind, min_tier, enforced, window_bound, note)
    values (k ->> 'key', k ->> 'kind', k ->> 'min_tier', false, coalesce((k ->> 'window_bound')::boolean, true), k ->> 'note');
    if k ->> 'kind' = 'cap' then
      for t in select tier from app.entitlement_tiers loop
        if not ((k -> 'caps') ? t.tier) then
          raise exception 'catalog: cap key % has no entry for tier %', k ->> 'key', t.tier;
        end if;
        insert into app.entitlement_caps (key, tier, cap_limit)
        values (k ->> 'key', t.tier, (k -> 'caps' ->> t.tier)::int);
      end loop;
    end if;
  end loop;
end
$seed$;

create or replace function app.check_event_entry_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_format text;
  v_key    text;
  v_limit  int;
begin
  v_org := app.org_id_for_event_internal(new.event_id);
  perform app.refuse_non_member(v_org, 'event_entries');

  -- only an insert of an active entry, or a reinstate (withdrawn true to false), adds a participant
  if new.withdrawn then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.withdrawn then
    return new;
  end if;
  if not app.entitlement_api_caller() then
    return new;
  end if;

  select e.format into v_format from public.events e where e.id = new.event_id;
  -- Fails closed: btc is exempt (its screens do not use event_entries), throwdown has its own key, and anything else
  -- (a typo, another case, a format that has not yet declared its own key) is capped as Cup Taster.
  v_key := case
    when v_format = 'btc' then null
    when v_format = 'throwdown' then 'throwdown_participants'
    else 'cup_taster_participants'
  end;
  if v_key is null then
    return new;
  end if;

  -- the roster can be open on several devices: count and decide under one lock per event
  perform pg_advisory_xact_lock(hashtext('entitlement_cap:' || new.event_id::text));

  v_limit := app.entitlement_limit(v_org, v_key, new.event_id);
  if v_limit is null then
    return new;
  end if;
  if (select count(*) from public.event_entries x
       where x.event_id = new.event_id and not x.withdrawn and x.id <> new.id) >= v_limit then
    raise exception 'entitlement_cap_reached'
      using errcode = '42501', hint = 'entitlement_cap_reached', detail = v_key;
  end if;
  return new;
end;
$$;
revoke all on function app.check_event_entry_cap() from public, anon, authenticated, service_role;
