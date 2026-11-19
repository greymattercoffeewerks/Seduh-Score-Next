-- Seduh Score Next - Throwdown scoresheet, part 1 of 2: the module, its key and its setup
--
-- Some Throwdown rounds are decided by judges' paper scoresheets that a scorekeeper types in, instead of taps (spec:
-- Handoffs and Specs/THROWDOWN-SCORESHEET-SPEC.md, local only). This part makes the module SWITCHABLE; part 2
-- (20261127110000) holds the data and the two writers.
--   * the entitlement key throwdown_scoresheet (a free flag, seeded unenforced like every key; D14: nothing branches on it);
--   * app.td_module_registry() gains the one module: { scoresheet, requires none, key throwdown_scoresheet };
--   * td_settings.modules.scoresheet = { preset, lines, cups }, validated by a check that calls an app function: the preset
--     is known, `lines` equals the preset's own lines (so a later preset change can never alter a past event), `cups` names
--     only the four known round roles, each 1 to 3, and at least one. A round whose role is left out is tap-voted.
--   * td_save_settings (same signature) copies the chosen preset's lines into the settings at save, so a client names a
--     preset and the cups and never writes the lines itself.
-- The database never knows the word "latte art": a preset is a list of lines { key, label, max } and this is the only place
-- a preset is named. A brewing sheet later is another `when` in app.td_scoresheet_preset_lines, no schema change.
--
-- rollback:
--   alter table td_settings drop constraint if exists td_settings_scoresheet_valid;
--   drop function if exists app.td_modules_scoresheet_ok(jsonb);
--   drop function if exists app.td_scoresheet_config_valid(jsonb);
--   drop function if exists app.td_scoresheet_roles();
--   drop function if exists app.td_scoresheet_preset_lines(text);
--   delete from app.entitlement_keys where key = 'throwdown_scoresheet';
--   create or replace function app.td_module_registry()
--   returns table (module text, requires text[], entitlement_key text)
--   language sql
--   immutable
--   set search_path = ''
--   as $$
--     select null::text, null::text[], null::text where false;
--   $$;
--   -- the TD.1 body of public.td_save_settings (20261103120000), restored:
--   create or replace function public.td_save_settings(
--     p_org_id uuid, p_event_id uuid, p_judge_count int, p_third_place boolean, p_seeding_mode text, p_modules jsonb
--   )
--   returns void
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_modules jsonb := coalesce(p_modules, '{}'::jsonb);
--     k         text;
--     req       text;
--     reg       record;
--   begin
--     perform app.td_guard('td_save_settings', p_org_id, p_event_id);
--     perform pg_advisory_xact_lock(hashtext('td:' || p_event_id::text));
--
--     if exists (select 1 from public.td_rounds r where r.event_id = p_event_id) then
--       raise exception 'td_save_settings: setup is locked, Round 1 has started'
--         using errcode = '23001', hint = 'td_setup_locked';
--     end if;
--     if p_judge_count is null or p_judge_count not between 1 and 15 then
--       raise exception 'td_save_settings: the judge count must be between 1 and 15' using hint = 'td_judge_count_invalid';
--     end if;
--     if p_seeding_mode is null or p_seeding_mode not in ('random', 'manual') then
--       raise exception 'td_save_settings: the seeding mode must be random or manual' using hint = 'td_seeding_invalid';
--     end if;
--     if jsonb_typeof(v_modules) <> 'object' then
--       raise exception 'td_save_settings: modules must be an object' using hint = 'td_module_invalid';
--     end if;
--
--     -- the module toggle mechanism: every enabled key must be a known module, its declared dependencies must be enabled
--     -- too (a refusal with the reason, never a silent no-op), and its entitlement key slot must allow it.
--     for k in select jsonb_object_keys(v_modules) loop
--       if v_modules -> k in ('false'::jsonb, 'null'::jsonb) then
--         continue;
--       end if;
--       select * into reg from app.td_module_registry() r where r.module = k;
--       if not found then
--         raise exception 'td_save_settings: unknown module %', k using hint = 'td_module_unknown';
--       end if;
--       foreach req in array coalesce(reg.requires, '{}'::text[]) loop
--         if coalesce(v_modules -> req, 'false'::jsonb) in ('false'::jsonb, 'null'::jsonb) then
--           raise exception 'td_save_settings: module % needs module % to be on', k, req
--             using hint = 'td_module_dependency', detail = req;
--         end if;
--       end loop;
--       if reg.entitlement_key is not null and not app.has_entitlement(p_org_id, reg.entitlement_key, p_event_id) then
--         raise exception 'entitlement_required'
--           using errcode = '42501', hint = 'entitlement_required', detail = reg.entitlement_key;
--       end if;
--     end loop;
--     -- stored with the switched-off toggles removed, so a module that is off leaves no trace
--     select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_modules
--       from jsonb_each(v_modules) where value not in ('false'::jsonb, 'null'::jsonb);
--
--     insert into public.td_settings (event_id, judge_count, third_place, seeding_mode, modules)
--     values (p_event_id, p_judge_count, coalesce(p_third_place, true), p_seeding_mode, v_modules)
--     on conflict (event_id) do update
--       set judge_count = excluded.judge_count, third_place = excluded.third_place,
--           seeding_mode = excluded.seeding_mode, modules = excluded.modules;
--   end;
--   $$;

-- ============ the entitlement key (free flag, unenforced) ============
do $seed$
declare
  v_add jsonb := $catalog_add$
{
  "keys": [
    {
      "key": "throwdown_scoresheet",
      "kind": "flag",
      "min_tier": null,
      "window_bound": true,
      "note": "Throwdown scoresheet rounds module: rounds decided by judges' scoresheets typed in by a scorekeeper. Free."
    }
  ]
}
$catalog_add$::jsonb;
  k jsonb;
begin
  for k in select * from jsonb_array_elements(v_add -> 'keys') loop
    insert into app.entitlement_keys (key, kind, min_tier, enforced, window_bound, note)
    values (k ->> 'key', k ->> 'kind', k ->> 'min_tier', false, coalesce((k ->> 'window_bound')::boolean, true), k ->> 'note');
  end loop;
end
$seed$;

-- ============ the presets (data) ============
create or replace function app.td_scoresheet_preset_lines(p_preset text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_preset
    when 'latte_art_v1' then '[
      {"key": "contrast",      "label": "Contrast/Definition",         "max": 6},
      {"key": "surface",       "label": "Visual surface",              "max": 3},
      {"key": "harmony",       "label": "Harmony",                     "max": 3},
      {"key": "size_position", "label": "Size & position of pattern",  "max": 3},
      {"key": "achieved",      "label": "Successfully achieved",       "max": 6},
      {"key": "appeal",        "label": "Overall appeal",              "max": 6}
    ]'::jsonb
  end
$$;
revoke all on function app.td_scoresheet_preset_lines(text) from public, anon, authenticated, service_role;

create or replace function app.td_scoresheet_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['final', 'third_place', 'semi_final', 'quarter_final']
$$;
revoke all on function app.td_scoresheet_roles() from public, anon, authenticated, service_role;

-- The stored shape: exactly { preset, lines, cups }, nothing else.
create or replace function app.td_scoresheet_config_valid(p_cfg jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lines jsonb;
begin
  if jsonb_typeof(p_cfg) is distinct from 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_cfg)) <> 3
     or not (p_cfg ? 'preset' and p_cfg ? 'lines' and p_cfg ? 'cups') then
    return false;
  end if;
  if jsonb_typeof(p_cfg -> 'preset') is distinct from 'string' then
    return false;
  end if;
  v_lines := app.td_scoresheet_preset_lines(p_cfg ->> 'preset');
  if v_lines is null or (p_cfg -> 'lines') is distinct from v_lines then
    return false;
  end if;
  if jsonb_typeof(p_cfg -> 'cups') is distinct from 'object' or not exists (select 1 from jsonb_object_keys(p_cfg -> 'cups')) then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_each(p_cfg -> 'cups') c
     where c.key <> all (app.td_scoresheet_roles())
        or case when jsonb_typeof(c.value) = 'number'
                then (c.value #>> '{}') not in ('1', '2', '3')
                else true end);
end;
$$;
revoke all on function app.td_scoresheet_config_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function app.td_modules_scoresheet_ok(p_modules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (p_modules ? 'scoresheet') or app.td_scoresheet_config_valid(p_modules -> 'scoresheet')
$$;
revoke all on function app.td_modules_scoresheet_ok(jsonb) from public, anon, authenticated, service_role;

-- ============ the registry: the one module ============
create or replace function app.td_module_registry()
returns table (module text, requires text[], entitlement_key text)
language sql
immutable
set search_path = ''
as $$
  select 'scoresheet'::text, '{}'::text[], 'throwdown_scoresheet'::text;
$$;
revoke all on function app.td_module_registry() from public, anon, authenticated, service_role;

alter table td_settings
  add constraint td_settings_scoresheet_valid check (app.td_modules_scoresheet_ok(modules));

-- ============ setup: td_save_settings copies the preset's lines in ============
-- Same signature and behaviour as TD.1's, plus: a switched-on `scoresheet` must be an object naming a known preset and
-- its cups; the stored value is rebuilt as { preset, lines (copied from the preset here), cups } and checked as a whole.
create or replace function public.td_save_settings(
  p_org_id uuid, p_event_id uuid, p_judge_count int, p_third_place boolean, p_seeding_mode text, p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules jsonb := coalesce(p_modules, '{}'::jsonb);
  k         text;
  req       text;
  reg       record;
  v_preset  text;
begin
  perform app.td_guard('td_save_settings', p_org_id, p_event_id);
  perform pg_advisory_xact_lock(hashtext('td:' || p_event_id::text));

  if exists (select 1 from public.td_rounds r where r.event_id = p_event_id) then
    raise exception 'td_save_settings: setup is locked, Round 1 has started'
      using errcode = '23001', hint = 'td_setup_locked';
  end if;
  if p_judge_count is null or p_judge_count not between 1 and 15 then
    raise exception 'td_save_settings: the judge count must be between 1 and 15' using hint = 'td_judge_count_invalid';
  end if;
  if p_seeding_mode is null or p_seeding_mode not in ('random', 'manual') then
    raise exception 'td_save_settings: the seeding mode must be random or manual' using hint = 'td_seeding_invalid';
  end if;
  if jsonb_typeof(v_modules) <> 'object' then
    raise exception 'td_save_settings: modules must be an object' using hint = 'td_module_invalid';
  end if;

  -- the module toggle mechanism: every enabled key must be a known module, its declared dependencies must be enabled
  -- too (a refusal with the reason, never a silent no-op), and its entitlement key slot must allow it.
  for k in select jsonb_object_keys(v_modules) loop
    if v_modules -> k in ('false'::jsonb, 'null'::jsonb) then
      continue;
    end if;
    select * into reg from app.td_module_registry() r where r.module = k;
    if not found then
      raise exception 'td_save_settings: unknown module %', k using hint = 'td_module_unknown';
    end if;
    foreach req in array coalesce(reg.requires, '{}'::text[]) loop
      if coalesce(v_modules -> req, 'false'::jsonb) in ('false'::jsonb, 'null'::jsonb) then
        raise exception 'td_save_settings: module % needs module % to be on', k, req
          using hint = 'td_module_dependency', detail = req;
      end if;
    end loop;
    if reg.entitlement_key is not null and not app.has_entitlement(p_org_id, reg.entitlement_key, p_event_id) then
      raise exception 'entitlement_required'
        using errcode = '42501', hint = 'entitlement_required', detail = reg.entitlement_key;
    end if;
  end loop;

  -- the scoresheet module: a preset and the cups per round role; the preset's lines are copied in here
  if v_modules ? 'scoresheet' and v_modules -> 'scoresheet' not in ('false'::jsonb, 'null'::jsonb) then
    if jsonb_typeof(v_modules -> 'scoresheet') <> 'object'
       or jsonb_typeof(v_modules -> 'scoresheet' -> 'preset') is distinct from 'string'
       or jsonb_typeof(v_modules -> 'scoresheet' -> 'cups') is distinct from 'object' then
      raise exception 'td_save_settings: the scoresheet module needs a preset and the cups per round'
        using hint = 'td_scoresheet_invalid';
    end if;
    v_preset := v_modules -> 'scoresheet' ->> 'preset';
    if app.td_scoresheet_preset_lines(v_preset) is null then
      raise exception 'td_save_settings: unknown scoresheet preset' using hint = 'td_scoresheet_invalid';
    end if;
    v_modules := jsonb_set(v_modules, '{scoresheet}', jsonb_build_object(
      'preset', v_preset,
      'lines', app.td_scoresheet_preset_lines(v_preset),
      'cups', v_modules -> 'scoresheet' -> 'cups'));
    if not app.td_scoresheet_config_valid(v_modules -> 'scoresheet') then
      raise exception 'td_save_settings: the scoresheet needs 1 to 3 cups for at least one of final, third_place, semi_final, quarter_final'
        using hint = 'td_scoresheet_invalid';
    end if;
  end if;

  -- stored with the switched-off toggles removed, so a module that is off leaves no trace
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_modules
    from jsonb_each(v_modules) where value not in ('false'::jsonb, 'null'::jsonb);

  insert into public.td_settings (event_id, judge_count, third_place, seeding_mode, modules)
  values (p_event_id, p_judge_count, coalesce(p_third_place, true), p_seeding_mode, v_modules)
  on conflict (event_id) do update
    set judge_count = excluded.judge_count, third_place = excluded.third_place,
        seeding_mode = excluded.seeding_mode, modules = excluded.modules;
end;
$$;
revoke all on function public.td_save_settings(uuid, uuid, int, boolean, text, jsonb) from public, anon;
grant execute on function public.td_save_settings(uuid, uuid, int, boolean, text, jsonb) to authenticated;
