-- T-TD.PV: the bracket preview agrees with the real engine (src/formats/throwdown/bracketPreview.js).
-- Each fixture case builds a Throwdown event of n competitors with no modules, plays it out with slot 1 winning every match
-- (as a walkover, so no votes are needed), and compares the rounds the engine made with the fixture: per main round
-- [brewers in, matches, byes, through], whether a 3rd place match exists, and the total number of matches. The fixture is
-- supabase/tests/fixtures/td-bracket-preview-parity.json, embedded below; bracketPreview.test.js holds the two copies equal
-- and holds the fixture equal to what previewShape returns, so a change to app.td_advance's shape rule, or to the preview,
-- fails one side.
-- Redemption cases are not here: that module is on its own branch (TD.3). They are added with it.
begin;
select plan(42);

create schema t096;
grant usage on schema t096 to anon, authenticated;

create function t096.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00096' || lpad(n::text, 7, '0'))::uuid
$$;

insert into auth.users (id, email) values (t096.u(1), 't096@test.seduh-next');
insert into orgs (id, name, slug) values (t096.u(100), 'T096', 't096');
insert into org_members (org_id, user_id, role) values (t096.u(100), t096.u(1), 'owner');

-- parity-fixture:begin
create table t096.fx as select $fx$
{
 "note": "Shape of a Throwdown event without modules when slot 1 always wins. Source of truth: previewShape (bracketPreview.js), checked against the real engine by pgTAP 096. Rounds are [brewers in, matches, byes, through] of each main round; matches is the whole event including the 3rd place match.",
 "cases": [
  {
   "n": 2,
   "third": true,
   "rounds": [
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 1
  },
  {
   "n": 3,
   "third": true,
   "rounds": [
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 2
  },
  {
   "n": 4,
   "third": true,
   "rounds": [
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 4
  },
  {
   "n": 5,
   "third": true,
   "rounds": [
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 4
  },
  {
   "n": 6,
   "third": true,
   "rounds": [
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 5
  },
  {
   "n": 7,
   "third": true,
   "rounds": [
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 7
  },
  {
   "n": 8,
   "third": true,
   "rounds": [
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 8
  },
  {
   "n": 9,
   "third": true,
   "rounds": [
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 8
  },
  {
   "n": 10,
   "third": true,
   "rounds": [
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 9
  },
  {
   "n": 11,
   "third": true,
   "rounds": [
    [
     11,
     5,
     1,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 10
  },
  {
   "n": 12,
   "third": true,
   "rounds": [
    [
     12,
     6,
     0,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 11
  },
  {
   "n": 13,
   "third": true,
   "rounds": [
    [
     13,
     6,
     1,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 13
  },
  {
   "n": 14,
   "third": true,
   "rounds": [
    [
     14,
     7,
     0,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 14
  },
  {
   "n": 15,
   "third": true,
   "rounds": [
    [
     15,
     7,
     1,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 15
  },
  {
   "n": 16,
   "third": true,
   "rounds": [
    [
     16,
     8,
     0,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 16
  },
  {
   "n": 17,
   "third": true,
   "rounds": [
    [
     17,
     8,
     1,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 16
  },
  {
   "n": 18,
   "third": true,
   "rounds": [
    [
     18,
     9,
     0,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 17
  },
  {
   "n": 19,
   "third": true,
   "rounds": [
    [
     19,
     9,
     1,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 18
  },
  {
   "n": 20,
   "third": true,
   "rounds": [
    [
     20,
     10,
     0,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 19
  },
  {
   "n": 21,
   "third": true,
   "rounds": [
    [
     21,
     10,
     1,
     11
    ],
    [
     11,
     5,
     1,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 20
  },
  {
   "n": 22,
   "third": true,
   "rounds": [
    [
     22,
     11,
     0,
     11
    ],
    [
     11,
     5,
     1,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 21
  },
  {
   "n": 23,
   "third": true,
   "rounds": [
    [
     23,
     11,
     1,
     12
    ],
    [
     12,
     6,
     0,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 22
  },
  {
   "n": 24,
   "third": true,
   "rounds": [
    [
     24,
     12,
     0,
     12
    ],
    [
     12,
     6,
     0,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 23
  },
  {
   "n": 25,
   "third": true,
   "rounds": [
    [
     25,
     12,
     1,
     13
    ],
    [
     13,
     6,
     1,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 25
  },
  {
   "n": 26,
   "third": true,
   "rounds": [
    [
     26,
     13,
     0,
     13
    ],
    [
     13,
     6,
     1,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 26
  },
  {
   "n": 27,
   "third": true,
   "rounds": [
    [
     27,
     13,
     1,
     14
    ],
    [
     14,
     7,
     0,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 27
  },
  {
   "n": 28,
   "third": true,
   "rounds": [
    [
     28,
     14,
     0,
     14
    ],
    [
     14,
     7,
     0,
     7
    ],
    [
     7,
     3,
     1,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 28
  },
  {
   "n": 29,
   "third": true,
   "rounds": [
    [
     29,
     14,
     1,
     15
    ],
    [
     15,
     7,
     1,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 29
  },
  {
   "n": 30,
   "third": true,
   "rounds": [
    [
     30,
     15,
     0,
     15
    ],
    [
     15,
     7,
     1,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 30
  },
  {
   "n": 31,
   "third": true,
   "rounds": [
    [
     31,
     15,
     1,
     16
    ],
    [
     16,
     8,
     0,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 31
  },
  {
   "n": 32,
   "third": true,
   "rounds": [
    [
     32,
     16,
     0,
     16
    ],
    [
     16,
     8,
     0,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": true,
   "matches": 32
  },
  {
   "n": 33,
   "third": true,
   "rounds": [
    [
     33,
     16,
     1,
     17
    ],
    [
     17,
     8,
     1,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 32
  },
  {
   "n": 34,
   "third": true,
   "rounds": [
    [
     34,
     17,
     0,
     17
    ],
    [
     17,
     8,
     1,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 33
  },
  {
   "n": 35,
   "third": true,
   "rounds": [
    [
     35,
     17,
     1,
     18
    ],
    [
     18,
     9,
     0,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 34
  },
  {
   "n": 36,
   "third": true,
   "rounds": [
    [
     36,
     18,
     0,
     18
    ],
    [
     18,
     9,
     0,
     9
    ],
    [
     9,
     4,
     1,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 35
  },
  {
   "n": 37,
   "third": true,
   "rounds": [
    [
     37,
     18,
     1,
     19
    ],
    [
     19,
     9,
     1,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 36
  },
  {
   "n": 38,
   "third": true,
   "rounds": [
    [
     38,
     19,
     0,
     19
    ],
    [
     19,
     9,
     1,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 37
  },
  {
   "n": 39,
   "third": true,
   "rounds": [
    [
     39,
     19,
     1,
     20
    ],
    [
     20,
     10,
     0,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 38
  },
  {
   "n": 40,
   "third": true,
   "rounds": [
    [
     40,
     20,
     0,
     20
    ],
    [
     20,
     10,
     0,
     10
    ],
    [
     10,
     5,
     0,
     5
    ],
    [
     5,
     2,
     1,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 39
  },
  {
   "n": 8,
   "third": false,
   "rounds": [
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 7
  },
  {
   "n": 16,
   "third": false,
   "rounds": [
    [
     16,
     8,
     0,
     8
    ],
    [
     8,
     4,
     0,
     4
    ],
    [
     4,
     2,
     0,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 15
  },
  {
   "n": 21,
   "third": false,
   "rounds": [
    [
     21,
     10,
     1,
     11
    ],
    [
     11,
     5,
     1,
     6
    ],
    [
     6,
     3,
     0,
     3
    ],
    [
     3,
     1,
     1,
     2
    ],
    [
     2,
     1,
     0,
     1
    ]
   ],
   "thirdPlayed": false,
   "matches": 20
  }
 ]
}
$fx$::jsonb as j;
-- parity-fixture:end

-- Builds and plays case i (0-based) as the organiser; returns the engine's shape as text.
create function t096.actual(i int) returns text language plpgsql as $$
declare
  c        jsonb := (select j -> 'cases' -> i from t096.fx);
  n        int := (c ->> 'n')::int;
  third    boolean := (c ->> 'third')::boolean;
  ev       uuid := t096.u(1000 + i);
  org      uuid := t096.u(100);
  pairs    jsonb;
  m        record;
  rounds   text;
  total    int;
  has3     boolean;
begin
  insert into events (id, org_id, format, name) values (ev, org, 'throwdown', 'case ' || i);
  insert into event_entries (id, event_id, display_name)
    select t096.u(100000 + i * 100 + k), ev, 'P' || k from generate_series(1, n) k;
  select jsonb_agg(jsonb_build_array(
           t096.u(100000 + i * 100 + p), case when p + 1 <= n then t096.u(100000 + i * 100 + p + 1) end) order by p)
    into pairs from generate_series(1, n, 2) p;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t096.u(1))::text, true);
  perform set_config('request.jwt.claim.sub', t096.u(1)::text, true);
  perform public.td_save_settings(org, ev, 3, third, 'manual', '{}'::jsonb);
  perform public.td_start_event(gen_random_uuid(), org, ev, 'manual', null, 2 * jsonb_array_length(pairs), pairs);
  -- play: while any match is undecided, slot 1 wins it (a walkover)
  loop
    select mm.id as match_id, (select s.id from public.td_slots s where s.match_id = mm.id and s.position = 1) as slot1
      into m
      from public.td_matches mm join public.td_rounds rr on rr.id = mm.round_id
     where mm.event_id = ev and mm.result_kind is null order by rr.position, mm.position limit 1;
    exit when m.match_id is null;
    perform public.td_record_walkover(gen_random_uuid(), org, m.match_id, m.slot1);
  end loop;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select string_agg(format('[%s,%s,%s,%s]', r.enter, r.matches, r.byes, r.through), ',' order by r.position)
    into rounds
    from (select rd.position,
                 (select count(*) from public.td_slots s join public.td_matches mm on mm.id = s.match_id
                   where mm.round_id = rd.id and s.entry_id is not null) as enter,
                 (select count(*) from public.td_matches mm where mm.round_id = rd.id and mm.result_kind is distinct from 'bye') as matches,
                 (select count(*) from public.td_matches mm where mm.round_id = rd.id and mm.result_kind = 'bye') as byes,
                 (select count(*) from public.td_matches mm where mm.round_id = rd.id) as through
            from public.td_rounds rd where rd.event_id = ev and rd.phase = 'main') r;
  select exists (select 1 from public.td_rounds rd where rd.event_id = ev and rd.phase = 'third_place') into has3;
  select count(*) into total from public.td_matches mm where mm.event_id = ev and mm.result_kind is distinct from 'bye';
  return format('[%s] third=%s matches=%s', rounds, has3::text, total);
end $$;

create function t096.expected(i int) returns text language sql stable as $$
  select format('[%s] third=%s matches=%s',
           (select string_agg(replace(r::text, ' ', ''), ',' order by o) from jsonb_array_elements(c -> 'rounds') with ordinality as t(r, o)),
           c ->> 'thirdPlayed', c ->> 'matches')
    from (select j -> 'cases' -> i as c from t096.fx) q
$$;

select is(t096.actual(i), t096.expected(i),
          'case ' || i || ': ' || (select (j -> 'cases' -> i ->> 'n') || ' brewers, 3rd place ' || (j -> 'cases' -> i ->> 'third') from t096.fx))
  from generate_series(0, 41) i;

select * from finish();
rollback;
