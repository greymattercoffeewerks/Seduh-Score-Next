// Which selected judges share a country with a match's teams. Pure: rows in, conflicts out, no DOM or database.
// A judge or a team with no country never conflicts. This is a WARNING for the manual match form (a committee may
// need an exception); the draw (Build B) reuses it for its own rules.

// `judges` and `teams` are rows with `id` and `country_code`; `team1Id`/`team2Id` pick the two teams, `judgeIds` the
// selected judges. Returns [{ judgeId, teamId }]: one entry per selected judge per team of the same country (a judge
// matching both teams has two). An id with no row is ignored.
export function judgeCountryConflicts({
  judges = [],
  teams = [],
  team1Id,
  team2Id,
  judgeIds = [],
}) {
  const judgeById = new Map(judges.map((j) => [j.id, j]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const picked = [];
  for (const id of [team1Id, team2Id]) {
    const team = teamById.get(id);
    if (team && !picked.includes(team)) picked.push(team);
  }
  const conflicts = [];
  for (const judgeId of judgeIds) {
    const judge = judgeById.get(judgeId);
    if (!judge?.country_code) continue;
    for (const team of picked) {
      if (team.country_code && team.country_code === judge.country_code) {
        conflicts.push({ judgeId, teamId: team.id });
      }
    }
  }
  return conflicts;
}
