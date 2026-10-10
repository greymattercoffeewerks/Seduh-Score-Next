-- T-TEN.B1 guard: every public table that carries an org_id column must freeze it.
-- If this fails, someone added a tenant table (or an org_id column) without deciding that
-- a user who belongs to two orgs cannot move its rows between them. The fix is a
-- `before update` trigger calling app.forbid_parent_change('org_id', ...) in the same
-- migration that adds the column, never an exception added here. The one standing
-- exception is score_change_log, whose every UPDATE is already refused outright.
-- A trigger only counts if it would really fire on an org_id change: it must be enabled,
-- row-level, unconditional (no WHEN), and either have no column list or list org_id.
-- Known limit, recorded in ROADMAP: this only sees tables with an org_id COLUMN. A tenant
-- table scoped purely through event_id / stage_id (ct_sets was one) is not caught here.
begin;
select plan(9);

create function pg_temp.unprotected_org_tables() returns setof text language sql as $f$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
  where c.relkind = 'r'
    and not exists (
      select 1
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = c.oid
        and not t.tgisinternal
        and t.tgenabled <> 'D'                    -- not disabled
        and (t.tgtype & 1) > 0                    -- FOR EACH ROW
        and (t.tgtype & 2) > 0                    -- BEFORE
        and (t.tgtype & 16) > 0                   -- UPDATE
        and t.tgqual is null                      -- no WHEN condition that could skip it
        and (
          t.tgattr::text = ''                     -- no column list, or one that includes org_id
          or a.attnum::text = any (string_to_array(t.tgattr::text, ' '))
        )
        and (
          (p.proname = 'forbid_parent_change'
            and 'org_id' = any (string_to_array(rtrim(replace(encode(t.tgargs, 'escape'), '\000', ','), ','), ',')))
          or p.proname = 'forbid_score_change_log_mutation'
        )
    )
  order by 1;
$f$;

select cmp_ok(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where c.relkind = 'r'),
  '>=', 9,
  'the guard sees at least the nine tables known to carry an org_id (zero would mean it matches nothing)'
);

select is(
  (select coalesce(string_agg(t, ', '), '') from pg_temp.unprotected_org_tables() t),
  '',
  'every table with an org_id column freezes it'
);

-- Mutation checks: each leaves the people trigger in place but unable to protect org_id,
-- and the guard must name people (membership test, so unrelated tables never confuse it).
drop trigger trg_people_org_immutable on people;
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'a missing trigger is reported'
);

create trigger trg_people_org_immutable
  before update on people
  for each row execute function app.forbid_parent_change('id');
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'a trigger that freezes only some other column (id) is reported'
);
drop trigger trg_people_org_immutable on people;

create trigger trg_people_org_immutable
  before update of display_name on people
  for each row execute function app.forbid_parent_change('org_id');
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'a trigger whose UPDATE OF column list leaves out org_id (so an org_id change never fires it) is reported'
);
drop trigger trg_people_org_immutable on people;

create trigger trg_people_org_immutable
  before update on people
  for each row when (false) execute function app.forbid_parent_change('org_id');
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'a trigger with a WHEN condition that can skip it is reported'
);
drop trigger trg_people_org_immutable on people;

create trigger trg_people_org_immutable
  after update on people
  for each row execute function app.forbid_parent_change('org_id');
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'an AFTER trigger (too late to stop the write) is reported'
);
drop trigger trg_people_org_immutable on people;

create trigger trg_people_org_immutable
  before update on people
  for each row execute function app.forbid_parent_change('org_id');
alter table people disable trigger trg_people_org_immutable;
select ok(
  exists (select 1 from pg_temp.unprotected_org_tables() t where t = 'people'),
  'a disabled trigger is reported'
);
alter table people enable trigger trg_people_org_immutable;
select is(
  (select coalesce(string_agg(t, ', '), '') from pg_temp.unprotected_org_tables() t),
  '',
  'and with a correct, enabled trigger put back, nothing is reported (the guard is not simply always failing)'
);

select * from finish();
rollback;
