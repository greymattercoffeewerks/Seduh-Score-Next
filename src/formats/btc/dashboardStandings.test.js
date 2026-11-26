// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DRAFT_NOTE,
  LEVEL_NOTE,
  PREVIEW_ROWS,
  buildDashboardStandings,
  describeStandingsPreview,
} from './dashboardStandings.js';

const teams = Array.from({ length: 12 }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` }));
// seed order as the database hands it over; `points` per seed
const seeding = (points) =>
  points.map((p, i) => ({
    teamId: `t${i + 1}`,
    seed: i + 1,
    played: 2,
    wins: 1,
    totalPoints: p,
    tiedCount: 1,
    groupResolved: true,
  }));
const distinct = [90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7];

describe('standings preview', () => {
  it('says unread when the read failed, and empty before any result, never a made-up order', () => {
    expect(describeStandingsPreview({ teams, seedingRows: null }).state).toBe('unread');
    expect(describeStandingsPreview({ teams, seedingRows: [] }).state).toBe('empty');
  });

  it('shows the eight and two more, with the rest counted', () => {
    const view = describeStandingsPreview({ teams, seedingRows: seeding(distinct) });
    expect(view.rows).toHaveLength(PREVIEW_ROWS);
    expect(view.rows.filter((r) => r.aboveLine)).toHaveLength(8);
    expect(view.hidden).toBe(2);
    expect(view.level).toBe(false);
  });

  it('flags a tie across the cut line (8th and 9th level on points)', () => {
    const rows = seeding(distinct).map((r, i) =>
      i === 7 || i === 8 ? { ...r, totalPoints: 15, tiedCount: 2, groupResolved: false } : r,
    );
    expect(describeStandingsPreview({ teams, seedingRows: rows }).level).toBe(true);
  });

  it('does not flag a tie wholly above or wholly below the line, or one the organiser has settled', () => {
    const tied = (pairs, resolved = false) =>
      seeding(distinct).map((r, i) =>
        pairs.includes(i)
          ? { ...r, totalPoints: 999 - (i < 2 ? 0 : 500), tiedCount: 2, groupResolved: resolved }
          : r,
      );
    const level = (rows) => describeStandingsPreview({ teams, seedingRows: rows }).level;
    expect(level(tied([0, 1]))).toBe(false); // seeds 1 and 2
    expect(level(tied([8, 9]))).toBe(false); // seeds 9 and 10
    const border = seeding(distinct).map((r, i) =>
      i === 7 || i === 8 ? { ...r, totalPoints: 15, tiedCount: 2, groupResolved: true } : r,
    );
    expect(level(border)).toBe(false); // organiser already recorded the order
    const card = buildDashboardStandings({ teams, seedingRows: tied([0, 1]) });
    expect(card.textContent).not.toContain(LEVEL_NOTE);
  });

  it('draws the cut line once, after 8th, with the draft note and the committee tie rule when level', () => {
    const rows = seeding(distinct).map((r, i) =>
      i === 7 || i === 8 ? { ...r, totalPoints: 15, tiedCount: 2, groupResolved: false } : r,
    );
    const card = buildDashboardStandings({
      teams,
      seedingRows: rows,
      href: '#/events/e/standings',
    });
    const lines = card.querySelectorAll('.cutline');
    expect(lines).toHaveLength(1);
    const bodyRows = [...card.querySelectorAll('tbody tr')];
    expect(bodyRows[8].querySelector('.cutline')).not.toBeNull();
    expect(card.textContent).toContain(DRAFT_NOTE);
    expect(card.textContent).toContain(LEVEL_NOTE);
    expect(card.querySelector('a').getAttribute('href')).toBe('#/events/e/standings');
  });

  it('says so in words when it cannot read or has nothing', () => {
    expect(buildDashboardStandings({ teams, seedingRows: null }).textContent).toContain(
      'could not be read',
    );
    expect(buildDashboardStandings({ teams, seedingRows: [] }).textContent).toContain(
      'No results yet',
    );
  });
});
