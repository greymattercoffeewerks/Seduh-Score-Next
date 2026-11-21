// Undoing a confirmed match (td_reopen_match, migration 20261129100000; owner decisions 2026-11-21). Pure: the console
// asks this whether to offer Undo, and the database applies the same rule again and has the last word.
//
// The rule, as in SQL: a decided match that is not a bye can be undone while nothing after it has started. Confirming the
// last match of a main round creates every later round at once (the next main round, and from the semi-finals the 3rd
// place match with the Final), so undoing a main-round match removes those later rounds, and is refused once any of their
// matches has a tap, a score sheet or a result other than a bye. A 3rd place match and the Final have nothing after them.
// The console counts work still waiting in this device's outbox as started too (the database cannot see it yet).

// bracket: deriveBracket's output; sheets: the event's score sheet rows ({ match_id }); pending: the screen's per-match
// outbox snapshot (pendingSnapshot().matches).
export function reopenState(bracket, matchId, { sheets = [], pending = new Map() } = {}) {
  const rounds = bracket?.rounds ?? [];
  const round = rounds.find((r) => r.matches.some((m) => m.id === matchId));
  const match = round?.matches.find((m) => m.id === matchId);
  if (!match || !match.decided) return { allowed: false, reason: 'not_decided' };
  if (match.isBye) return { allowed: false, reason: 'bye' };
  if (pending.get(matchId)?.reopenQueued) return { allowed: false, reason: 'queued' };
  if (round.phase !== 'main') return { allowed: true, later: [] };

  const later = rounds.filter((r) => r.position > round.position);
  const sheeted = new Set(sheets.map((s) => s.match_id));
  const started = later.some((r) =>
    r.matches.some((m) => {
      const p = pending.get(m.id);
      return (
        (m.decided && !m.isBye) ||
        m.sides.some((s) => (s.votes ?? 0) > 0) ||
        sheeted.has(m.id) ||
        Boolean(p && (p.queued > 0 || p.decisionQueued || p.sheets?.size > 0))
      );
    }),
  );
  if (started) return { allowed: false, reason: 'next_round_started' };
  return { allowed: true, later };
}

// What the confirm step says before the organiser undoes a result.
export function reopenWords(match, later, { scored = false } = {}) {
  const winner = match.sides.find((s) => s.winner)?.name ?? 'the winner';
  const kept =
    match.resultKind === 'walkover'
      ? 'The match goes back to open.'
      : scored
        ? 'The match goes back to open with its scoresheets kept. Fix the sheet, then confirm again.'
        : 'The match goes back to open with its votes kept. Undo the wrong vote, then confirm again.';
  const removed = later.length
    ? later.some((r) => r.phase === 'third_place')
      ? ' The 3rd place match and the Final are removed and made again when you confirm.'
      : ' The next round is removed and made again when you confirm.'
    : '';
  return {
    question: `Undo ${winner}’s win?`,
    detail: `${kept}${removed} If you published the results, publish them again afterwards.`,
  };
}
