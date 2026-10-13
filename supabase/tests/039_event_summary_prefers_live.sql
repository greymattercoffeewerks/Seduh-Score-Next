-- public_event_summary picks the event the audience should see: the LIVE event first, otherwise the newest
-- event that is not a test event, otherwise the newest event (a test one).
-- Fixtures (one org each, no member needed: the function is the anonymous door):
--   Alpha: a real event (older), a newer rehearsal, no live session           -> the real event
--   Bravo: a real event (older, LIVE), a newer real event                      -> the live one (not the newest)
--   Charlie: a real event (older), a newer rehearsal that is LIVE              -> the live rehearsal
--   Delta: only rehearsals                                                    -> the newest rehearsal
--   Echo: a real event that WAS live (session now inactive), a newer real one  -> the newest real one
--   Foxtrot: two real events created at the same moment                      -> the higher id
begin;
select plan(9);

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Alpha', 'alpha'),
  ('00000000-0000-0000-0000-0000000000b0', 'Bravo', 'bravo'),
  ('00000000-0000-0000-0000-0000000000c0', 'Charlie', 'charlie'),
  ('00000000-0000-0000-0000-0000000000d0', 'Delta', 'delta'),
  ('00000000-0000-0000-0000-0000000000e0', 'Echo', 'echo'),
  ('00000000-0000-0000-0000-0000000000f0', 'Foxtrot', 'foxtrot');
insert into events (id, org_id, format, name, is_test, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Real',      false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Rehearsal', true,  '2026-10-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Bravo Live',      false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Bravo Newest',    false, '2026-10-03 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c0', 'cup_taster', 'Charlie Real',    false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c0', 'cup_taster', 'Charlie Rehearsal Live', true, '2026-10-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d0', 'cup_taster', 'Delta Test One',  true,  '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d0', 'cup_taster', 'Delta Test Two',  true,  '2026-10-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e0', 'cup_taster', 'Echo Was Live',   false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e0', 'cup_taster', 'Echo Newest',     false, '2026-10-03 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f0', 'cup_taster', 'Foxtrot One',     false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f0', 'cup_taster', 'Foxtrot Two',     false, '2026-10-01 10:00:00+00');
insert into live_sessions (org_id, event_id, format, active) values
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b1', 'cup_taster', true),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000c2', 'cup_taster', true),
  ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster', false);

set local role anon;

select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000a0')),
  'Alpha Real',
  'no live session: the newest REAL event wins over a newer rehearsal'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000b0')),
  'Bravo Live',
  'the live event wins even though a newer real event exists'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000c0')),
  'Charlie Rehearsal Live',
  'a live rehearsal is what is on screen, so it is what the splash names'
);
select is(
  (select is_test from public_event_summary('00000000-0000-0000-0000-0000000000c0')),
  true,
  'and it is still flagged as a test, so the splash can mark it'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000d0')),
  'Delta Test Two',
  'only rehearsals: the newest one'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000e0')),
  'Echo Newest',
  'a session that is no longer active does not make its event "live"'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000f0')),
  'Foxtrot Two',
  'a tie on creation time goes to the higher id, as before'
);
select is(
  (select count(*)::int from public_event_summary('00000000-0000-0000-0000-0000000000ff')),
  0,
  'an organisation with no events still gets no row'
);
select is(
  (select string_agg(x.argname, ',' order by x.ord)
     from pg_proc p, unnest(p.proargnames) with ordinality as x(argname, ord)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'public_event_summary'),
  'p_org_id,id,name,event_date,is_test',
  'the columns it returns are unchanged'
);

select * from finish();
rollback;
