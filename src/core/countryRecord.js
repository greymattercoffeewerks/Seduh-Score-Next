// The anonymous reads behind the country pages: public.public_country_record(code) and public.public_country_index()
// (migration 20261113120000). Both always return the same keys and never an error for an unknown code, so "no
// record" is an answer (has_record false), distinct from a failed request (a thrown error).
//
// The JSON comes from a database function, but this is a public page: every field is rebuilt here from known keys and
// type-checked, so a malformed or future-shaped answer shows less, never throws and never reaches the DOM as
// anything but text. Pure shaping (normalise*) is split from the read (fetch*) so tests need no client.
import { getSupabase } from './supabaseClient.js';

// 'organiser_archive' is the label "From the organiser's records". 'seduh_score' (live BTC, not built yet) is
// "Recorded by Seduh Score". An unknown provenance is treated as the cautious one: we never claim more than we know.
export const PROVENANCE_LABELS = {
  organiser_archive: 'From the organiser’s records',
  seduh_score: 'Recorded by Seduh Score',
};
export function provenanceLabel(provenance) {
  return PROVENANCE_LABELS[provenance] ?? PROVENANCE_LABELS.organiser_archive;
}

const STAGES = ['champion', 'final', 'semi_final', 'quarter_final', 'preliminary', 'entered'];
const ROUNDS = ['preliminary', 'quarter_final', 'semi_final', 'final_champion', 'final_runner_up'];

const text = (value, max = 200) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);
const int = (value) => (Number.isFinite(value) ? Math.trunc(value) : null);
const list = (value) => (Array.isArray(value) ? value : []);

function normaliseRound(raw) {
  if (!raw || typeof raw !== 'object' || !ROUNDS.includes(raw.round)) return null;
  const score = int(raw.score);
  if (score === null) return null;
  const opponent = text(raw.opponent_team_name, 120);
  const opponentScore = int(raw.opponent_score);
  return {
    round: raw.round,
    r1: int(raw.r1),
    r2: int(raw.r2),
    score,
    opponentTeamName: opponent && opponentScore !== null ? opponent : null,
    opponentScore: opponent && opponentScore !== null ? opponentScore : null,
  };
}

function normaliseTeam(raw) {
  const name = text(raw?.team_name, 120);
  if (!name || !STAGES.includes(raw.stage_reached)) return null;
  return {
    teamName: name,
    stage: raw.stage_reached,
    placement: int(raw.placement),
    provenance: text(raw.provenance, 40),
    rounds: list(raw.rounds).map(normaliseRound).filter(Boolean),
  };
}

function normaliseChampionship(raw) {
  const year = int(raw?.edition_year);
  const name = text(raw?.competition_name, 120);
  if (year === null || !name) return null;
  return {
    competition: text(raw.competition, 20),
    name,
    year,
    hostCity: text(raw.host_city, 80),
    suppliedBy: text(raw.supplied_by, 120),
    hostCountryCode: /^[A-Z]{2}$/.test(raw.host_country_code ?? '') ? raw.host_country_code : null,
    provenance: text(raw.provenance, 40),
    teams: list(raw.teams).map(normaliseTeam).filter(Boolean),
  };
}

function normaliseBest(raw) {
  const name = text(raw?.team_name, 120);
  const year = int(raw?.edition_year);
  if (!name || year === null || !STAGES.includes(raw.stage_reached)) return null;
  return { teamName: name, year, stage: raw.stage_reached, placement: int(raw.placement) };
}

/** Pure. The record of one country in the shape the page draws; never throws, whatever it is given. */
export function normaliseCountryRecord(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const championships = list(data.championships).map(normaliseChampionship).filter(Boolean);
  return {
    code: /^[A-Z]{2}$/.test(data.country_code ?? '') ? data.country_code : null,
    // has_record is the database's word, but a record with nothing to draw is empty whatever it says.
    hasRecord: data.has_record === true && championships.length > 0,
    stats: {
      championships: count(stats.championships),
      entries: count(stats.entries),
      teams: count(stats.teams),
      // Read but not shown by the pages (owner decision, 2026-11-13: only the final pairings are published, so these
      // understate every country). Kept so the figure can return once full pairings exist.
      matchesWon: count(stats.matches_won),
      matchesLost: count(stats.matches_lost),
      bestFinish: normaliseBest(stats.best_finish),
    },
    championships,
    teams: list(data.teams)
      .map((team) => {
        const name = text(team?.team_name, 120);
        if (!name || !STAGES.includes(team.best_stage)) return null;
        return {
          teamName: name,
          years: list(team.years)
            .map(int)
            .filter((y) => y !== null),
          bestStage: team.best_stage,
          bestPlacement: int(team.best_placement),
        };
      })
      .filter(Boolean),
  };
}

/** Pure. The hub's list: [{ code, championships, entries, teams }], codes that are not two letters dropped. */
export function normaliseCountryIndex(raw) {
  return list(raw?.countries)
    .map((row) =>
      /^[A-Z]{2}$/.test(row?.country_code ?? '')
        ? {
            code: row.country_code,
            championships: count(row.championships),
            entries: count(row.entries),
            teams: count(row.teams),
          }
        : null,
    )
    .filter(Boolean);
}

export async function fetchCountryRecord(code, client = getSupabase()) {
  const { data, error } = await client.rpc('public_country_record', { p_country_code: code });
  if (error) throw error;
  return normaliseCountryRecord(data);
}

export async function fetchCountryIndex(client = getSupabase()) {
  const { data, error } = await client.rpc('public_country_index');
  if (error) throw error;
  return normaliseCountryIndex(data);
}
