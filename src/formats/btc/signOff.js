// What the BTC sign-off sheet says (Organiser UX S4, spec U3 and Q9): the pure part that turns the cut's data into the
// spec core/signOffSheet.js prints. Nothing here decides who qualifies: the eight are the teams the database seeds 1 to
// 8 (cutData.js), every tie is the database's own group with the order and reason the organiser recorded, and a sheet
// that cannot say "final" says NOT FINAL in its status line.
import { ordinalLabel } from '../../core/ordinal.js';
import {
  cutOthers,
  LOCKED_DIFFERS_NOTE,
  cutQualifiers,
  lockedDiffers,
  deriveCutRows,
  lockState,
  pointsCell,
  rankCutRows,
  timeCells,
} from './cutData.js';
import { seedingTieGroups } from './seeding.js';
import { KNOCKOUT_PLACES, teamLabel, teamLabelNode } from './words.js';

export const SIGN_OFF_TITLE = 'Top 8 sign-off';
export const SIGN_OFF_SIGNATORIES = [{ role: 'Committee chair' }, { role: 'Organiser' }];

function groupTitle(group) {
  const places =
    group.firstSeed === group.lastSeed
      ? ordinalLabel(group.firstSeed)
      : `${ordinalLabel(group.firstSeed)} to ${ordinalLabel(group.lastSeed)}`;
  return `Level for ${places} · ${group.points} pts`;
}

// Pure. The spec for core/signOffSheet.js's `renderSignOffSheet`.
export function buildBtcSignOff({
  event,
  teams,
  seedingRows,
  matches,
  scores,
  times,
  bracketExists = false,
  lockedSeeds = null,
  now = new Date(),
}) {
  const rows = deriveCutRows({ teams, seedingRows, matches, scores, times, lockedSeeds });
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? 'Unknown team';
  const groups = seedingTieGroups(seedingRows);
  const groupOfTeam = new Map();
  for (const group of groups) for (const team of group.teams) groupOfTeam.set(team.teamId, group);

  const lock = lockState({
    matches,
    seedingRows,
    readFailed: false,
    formOpen: false,
    bracketExists: false,
  });
  const final = lock.allowed || bracketExists;
  // Anything the sheet cannot stand behind says so: after the lock, the bracket's seeds are the record.
  const differs = bracketExists && lockedDiffers(seedingRows, lockedSeeds);
  const provisional = !bracketExists && groups.some((group) => !group.resolved);

  const noteFor = (row) => {
    const group = groupOfTeam.get(row.teamId);
    if (!group) return '';
    return group.resolved ? 'Level on points: order settled' : 'Level on points: NOT SETTLED';
  };

  const places = new Map(rankCutRows(rows).map(({ item, position }) => [item.teamId, position]));

  return {
    title: SIGN_OFF_TITLE,
    eventName: event?.name ?? '',
    dateText: event?.event_date ? `Event date ${event.event_date}` : '',
    event,
    status: {
      kind: final ? 'final' : 'draft',
      text: final
        ? [
            `The ${KNOCKOUT_PLACES} teams below go through to the knockout.`,
            provisional ? 'Seed order inside a tie that is not settled is provisional.' : '',
            differs ? LOCKED_DIFFERS_NOTE : '',
          ]
            .filter(Boolean)
            .join(' ')
        : `NOT FINAL. ${lock.reason}`,
    },
    qualifiers: {
      heading: `The ${KNOCKOUT_PLACES} going through, in seed order`,
      columns: [
        { key: 'seed', header: 'Seed', numeric: true, cell: (row) => String(row.seed) },
        { key: 'team', header: 'Team', cell: (row) => teamLabelNode(row.team) },
        { key: 'r1', header: 'R1 pts', numeric: true, cell: (row) => pointsCell(row.round1) },
        { key: 'r2', header: 'R2 pts', numeric: true, cell: (row) => pointsCell(row.round2) },
        { key: 'total', header: 'Total', numeric: true, cell: (row) => String(row.totalPoints) },
        { key: 't1', header: 'R1 time', numeric: true, cell: (row) => timeCells(row).round1 },
        { key: 't2', header: 'R2 time', numeric: true, cell: (row) => timeCells(row).round2 },
        { key: 'tsum', header: 'Time sum', numeric: true, cell: (row) => timeCells(row).sum },
        { key: 'note', header: 'Note', cell: noteFor },
      ],
      rows: cutQualifiers(rows),
    },
    notes: {
      heading: 'Ties settled',
      emptyText: 'No teams were level on points.',
      items: groups.map((group) => ({
        title: groupTitle(group),
        text: group.resolved
          ? `Order: ${group.teams.map((t) => nameOf(t.teamId)).join(', then ')}.${group.reason ? ` Reason: ${group.reason}` : ''}`
          : 'The order has not been recorded yet.',
      })),
    },
    others: {
      heading: 'Not going through',
      items: cutOthers(rows).map((row) =>
        row.seed === null
          ? `${teamLabel(row.team)} · no result`
          : `${places.get(row.teamId)}. ${teamLabel(row.team)} · ${row.totalPoints} pts`,
      ),
    },
    signatories: SIGN_OFF_SIGNATORIES,
    generatedAt: now,
  };
}
