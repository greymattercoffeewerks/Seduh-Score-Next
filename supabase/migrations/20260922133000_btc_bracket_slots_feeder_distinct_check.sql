-- Seduh Score Next · T-BTC.2 sub-step 5: btc_bracket_slots.feeder_slot_1 <> feeder_slot_2
--
-- Defense in depth, flagged by scoring-auditor review: generate_btc_bracket
-- (20260922130000) never produces a row where the same slot feeds both of another
-- slot's team positions, so this isn't reachable today — but nothing before this
-- migration stopped it. confirm_btc_match's bracket-advancement update loop
-- (20260922132000) picks team1_id vs team2_id with
-- `if v_downstream.feeder_slot_1 = v_slot.id then ... else ...`, which silently only
-- ever writes team1_id if a row's feeder_slot_1 and feeder_slot_2 were ever the same
-- value — a constraint closes this off permanently rather than relying on
-- generate_btc_bracket staying the only writer forever.
--
-- rollback:
--   alter table btc_bracket_slots drop constraint if exists btc_bracket_slots_feeder_distinct_check;

alter table btc_bracket_slots
  add constraint btc_bracket_slots_feeder_distinct_check
  check (feeder_slot_1 is null or feeder_slot_2 is null or feeder_slot_1 <> feeder_slot_2);
