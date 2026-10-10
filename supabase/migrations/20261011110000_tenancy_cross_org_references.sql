-- Seduh Score Next · T-TEN.B2: no row may reference a parent in another org (or event)
--
-- Why now: row-level security on the Cup Taster child tables checks only ONE side of a
-- join. ct_stage_entries' policy looks at the stage's org, ct_heat_entries' at the heat's
-- org, and foreign-key existence checks bypass RLS entirely. For a user who belongs to a
-- single org that is enough, because every id they can name is their own. For a user who
-- belongs to org A AND org B it is not: they can attach org B's roster entry to org A's
-- stage (or vice versa), which mixes two orgs' data in one event. T-TEN.A2's matrix
-- (Handoffs and Specs/TENANCY-INVENTORY.md §3) found the gaps this closes:
--
--   1. ct_stage_entries(stage_id, entry_id)  - nothing checked the stage and the entry
--      belong to the same event. Now a trigger refuses it on INSERT.
--   2. ct_heat_entries(heat_id, entry_id)    - same, via the heat's stage's event.
--   3. ct_sets.stage_id                      - the table had NO trigger at all, so a
--      set could be re-pointed to another org's stage by UPDATE. Frozen now.
--   4. event_entries.event_id                - the person/org check only runs when
--      person_id is set (it is nullable), so an entry with no person could be moved to
--      another org's event. Frozen now.
--   5. btc_match_judges.(match_id, judge_id) - the check trigger only requires the judge
--      and the match to share an event, so BOTH could be changed together to another
--      org's match and judge. Frozen now (found by security-reviewer and schema-guardian
--      during B1/B2/B5 review; nothing in src or the migrations ever updates this table).
--
-- The two new same-event checks raise 42501 with the standard row-level-security message,
-- not a bespoke P0001. They run as SECURITY DEFINER BEFORE the RLS WITH CHECK, so a
-- distinct error would tell a non-member whether a stage uuid exists and whether it shares
-- an event with an entry (security-reviewer N4). To the caller it now looks like any other
-- refused write.
--
-- Same-EVENT (not just same-org) is enforced, which is stricter than tenancy needs and is
-- what the application already assumes: stages, heats and entries are generated per event.
--
-- Not in this migration, on purpose (recorded in ROADMAP):
--   - btc_matches_write is FOR ALL, so any member can write status/tie-break columns
--     directly. That is a within-one-org integrity gap, not a cross-org one, and splitting
--     the policy is an RLS redesign that needs its own security-reviewer pass.
--   - person_merges.merged_id has no foreign key (a bare uuid kept for the audit trail);
--     it is informational and nothing reads another org's person through it.
--
-- rollback:
--   drop trigger if exists trg_ct_stage_entries_check_event on ct_stage_entries;
--   drop trigger if exists trg_ct_heat_entries_check_event on ct_heat_entries;
--   drop trigger if exists trg_ct_sets_parent_immutable on ct_sets;
--   drop trigger if exists trg_event_entries_parent_immutable on event_entries;
--   drop trigger if exists trg_btc_match_judges_parent_immutable on btc_match_judges;
--   drop function if exists app.check_ct_stage_entry_event();
--   drop function if exists app.check_ct_heat_entry_event();

-- ============ (3), (4) and (5): freeze the columns that pick the parent ============

create trigger trg_ct_sets_parent_immutable
  before update on ct_sets
  for each row execute function app.forbid_parent_change('id', 'stage_id');

create trigger trg_event_entries_parent_immutable
  before update on event_entries
  for each row execute function app.forbid_parent_change('id', 'event_id');

create trigger trg_btc_match_judges_parent_immutable
  before update on btc_match_judges
  for each row execute function app.forbid_parent_change('match_id', 'judge_id');

-- ============ (1) ct_stage_entries: the stage and the entry share an event ============

create or replace function app.check_ct_stage_entry_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `is distinct from`, not `<>`: a missing parent resolves to NULL, and `NULL <> x` is
  -- NULL (not true), which would let the check silently pass. (A genuinely missing id
  -- still ends in the foreign key's own error when both sides are missing.)
  if (select s.event_id from public.ct_stages s where s.id = new.stage_id)
     is distinct from
     (select e.event_id from public.event_entries e where e.id = new.entry_id) then
    raise exception 'new row violates row-level security policy for table "ct_stage_entries"'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- INSERT only: stage_id and entry_id are frozen afterwards by forbid_parent_change
-- (trg_ct_stage_entries_parent_immutable), which keeps its own, more specific error for a
-- re-point (017_score_change_log.sql pins it). Firing this check on UPDATE too would
-- change that error for no gain.
create trigger trg_ct_stage_entries_check_event
  before insert on ct_stage_entries
  for each row execute function app.check_ct_stage_entry_event();

-- ============ (2) ct_heat_entries: the heat (via its stage) and the entry share an event ============

create or replace function app.check_ct_heat_entry_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select s.event_id
        from public.ct_heats h
        join public.ct_stages s on s.id = h.stage_id
       where h.id = new.heat_id)
     is distinct from
     (select e.event_id from public.event_entries e where e.id = new.entry_id) then
    raise exception 'new row violates row-level security policy for table "ct_heat_entries"'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- INSERT only, for the same reason (heat_id and entry_id are frozen afterwards).
create trigger trg_ct_heat_entries_check_event
  before insert on ct_heat_entries
  for each row execute function app.check_ct_heat_entry_event();

-- Trigger functions are never meant to be called directly; keep them off every API role,
-- the same way the other check_* functions are treated.
revoke all on function app.check_ct_stage_entry_event() from public, anon, authenticated;
revoke all on function app.check_ct_heat_entry_event() from public, anon, authenticated;
