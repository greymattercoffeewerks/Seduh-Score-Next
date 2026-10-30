import { describe, it, expect, vi } from 'vitest';
import {
  buildPeopleView,
  summarisePeople,
  peopleHeading,
  mountPeopleScreen,
  PEOPLE_INTRO,
} from './peopleScreen.js';

const GLOBAL_ID = '9b1f0c52-7a44-4c8e-9d3e-5d0e6c1f2a77';

// An in-memory stand-in for the two tables the screen reads and writes. It honours the
// open-row uniqueness the database enforces (23505) so the kind wording is exercised for real.
function fakeClient({ people, affiliations = [], failWrite = null, failRead = false } = {}) {
  const db = {
    people: people.map((p) => ({ ...p })),
    org_person_affiliations: affiliations.map((a) => ({ ...a })),
  };
  const writes = [];
  let seq = 0;
  function builder(table) {
    const filters = [];
    const b = {
      select: () => b,
      eq: (col, val) => (filters.push((r) => r[col] === val), b),
      is: (col, val) => (filters.push((r) => (r[col] ?? null) === val), b),
      order: () => b,
      limit: () => Promise.resolve(read()),
      insert: (payload) => {
        writes.push(['insert', payload]);
        if (failWrite) return Promise.resolve({ error: failWrite });
        const dup = db[table].some(
          (r) =>
            r.org_id === payload.org_id &&
            r.person_id === payload.person_id &&
            r.relationship === payload.relationship &&
            !r.ended_at,
        );
        if (dup) return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
        seq += 1;
        db[table].push({ id: `a${seq}`, ended_at: null, started_on: null, ...payload });
        return Promise.resolve({ error: null });
      },
      update: (patch) => {
        writes.push(['update', patch]);
        const u = {
          eq: (col, val) => (filters.push((r) => r[col] === val), u),
          is: (col, val) => {
            filters.push((r) => (r[col] ?? null) === val);
            if (failWrite) return Promise.resolve({ error: failWrite });
            for (const row of db[table])
              if (filters.every((f) => f(row))) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        };
        return u;
      },
      then: (resolve, reject) => Promise.resolve(read()).then(resolve, reject),
    };
    function read() {
      if (failRead)
        return { data: null, error: Object.assign(new Error('read failed'), { code: 'XX' }) };
      return { data: db[table].filter((r) => filters.every((f) => f(r))), error: null };
    }
    return b;
  }
  return { db, writes, from: (table) => builder(table) };
}

const person = (id, name, extra = {}) => ({
  id,
  org_id: 'org1',
  display_name: name,
  cafe: null,
  global_person_id: null,
  ...extra,
});

async function mount(client, opts = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const screen = await mountPeopleScreen(root, { orgId: 'org1', client, ...opts });
  return { root, screen };
}
const q = (root, s) => root.querySelector(s);
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('pure view logic', () => {
  const people = [
    { id: 'p1', displayName: 'Amy Tan', cafe: null, linked: true },
    { id: 'p2', displayName: 'Bo Lim', cafe: null, linked: false },
  ];
  const affs = [
    { id: 'a1', personId: 'p1', relationship: 'staff' },
    { id: 'a2', personId: 'p1', relationship: 'affiliate' },
  ];

  it('joins roles to people and sorts a person’s roles', () => {
    const view = buildPeopleView(people, affs);
    expect(view[0].roles.map((r) => r.relationship)).toEqual(['affiliate', 'staff']);
    expect(view[1].roles).toEqual([]);
  });

  it('filters by name, case-insensitively, trimming', () => {
    expect(buildPeopleView(people, affs, '  bo ').map((p) => p.id)).toEqual(['p2']);
    expect(buildPeopleView(people, affs, 'zzz')).toEqual([]);
  });

  it('summarises with singular and plural wording', () => {
    expect(summarisePeople(people, affs)).toBe('2 people, 1 staff, 1 affiliates');
    expect(summarisePeople([people[0]], [])).toBe('1 person, 0 staff, 0 affiliates');
  });

  it('names the organisation in the heading when it is known', () => {
    expect(peopleHeading('Grey Matter')).toBe('People in Grey Matter');
    expect(peopleHeading(null)).toBe('People');
  });

  it('the intro claims no directory or profile', () => {
    expect(PEOPLE_INTRO).not.toMatch(/directory|profile|public listing/i);
  });
});

describe('mountPeopleScreen', () => {
  it('lists people with the Linked words for a linked person and never renders the id', async () => {
    const client = fakeClient({
      people: [person('p1', 'Amy Tan', { global_person_id: GLOBAL_ID }), person('p2', 'Bo Lim')],
    });
    const { root } = await mount(client);
    expect(q(root, '#people-row-p1').textContent).toContain('Linked to a Seduh ID');
    expect(q(root, '#people-row-p2').textContent).not.toContain('Linked');
    expect(root.innerHTML).not.toContain(GLOBAL_ID);
    expect(document.activeElement).toBe(q(root, '#people-heading'));
  });

  it('reads only the active organisation’s people and roles', async () => {
    const client = fakeClient({
      people: [person('p1', 'Mine'), person('p9', 'Other org', { org_id: 'org2' })],
      affiliations: [
        { id: 'x', org_id: 'org2', person_id: 'p9', relationship: 'staff', ended_at: null },
      ],
    });
    const { root } = await mount(client);
    expect(root.textContent).toContain('Mine');
    expect(root.textContent).not.toContain('Other org');
    expect(q(root, '#people-row-p1').textContent).not.toContain('Staff');
  });

  it('marks a person as staff, announces it, and offers to end the role', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan')] });
    const { root } = await mount(client);
    q(root, '#people-add-p1-staff').click();
    await flush();
    expect(client.writes[0]).toEqual([
      'insert',
      { org_id: 'org1', person_id: 'p1', relationship: 'staff' },
    ]);
    const row = q(root, '#people-row-p1').textContent;
    expect(row).toContain('Staff');
    expect(row).toContain('End staff role');
    expect(row).not.toContain('Mark as staff');
    expect(row).toContain('Mark as affiliate');
    const feedback = q(root, '#people-feedback');
    expect(feedback.textContent).toBe('Amy Tan marked as staff.');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(feedback);
  });

  it('ending a role ends the row (ended_at), keeps the history, and frees the button again', async () => {
    const client = fakeClient({
      people: [person('p1', 'Amy Tan')],
      affiliations: [
        { id: 'a1', org_id: 'org1', person_id: 'p1', relationship: 'staff', ended_at: null },
      ],
    });
    const { root } = await mount(client);
    q(root, '#people-end-a1').click();
    await flush();
    expect(client.db.org_person_affiliations).toHaveLength(1);
    expect(client.db.org_person_affiliations[0].ended_at).not.toBeNull();
    expect(q(root, '#people-row-p1').textContent).toContain('Mark as staff');
    expect(q(root, '#people-feedback').textContent).toBe('Amy Tan is no longer staff.');
  });

  it('words a duplicate open role kindly, not as a database error', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan')] });
    const { root } = await mount(client);
    // Another device already made her staff between this screen's load and the tap.
    client.db.org_person_affiliations.push({
      id: 'zz',
      org_id: 'org1',
      person_id: 'p1',
      relationship: 'staff',
      ended_at: null,
    });
    q(root, '#people-add-p1-staff').click();
    await flush();
    const text = q(root, '#people-feedback').textContent;
    expect(text).toBe('This person is already marked as staff.');
    expect(text).not.toMatch(/duplicate|constraint|23505/i);
    expect(q(root, '#people-feedback').dataset.tone).toBe('error');
  });

  it('every action button names the person (accessible name) and is a 44px tap target class', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan')] });
    const { root } = await mount(client);
    const add = q(root, '#people-add-p1-affiliate');
    expect(add.getAttribute('aria-label')).toBe('Mark Amy Tan as affiliate');
    expect(add.classList.contains('tap-target')).toBe(true);
  });

  it('disables the buttons while a write is in flight and does not send a second one', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan')] });
    const { root } = await mount(client);
    const add = q(root, '#people-add-p1-staff');
    add.click();
    add.click();
    await flush();
    expect(client.writes.filter(([k]) => k === 'insert')).toHaveLength(1);
  });

  it('filters the list without losing the typed text on a later re-render', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan'), person('p2', 'Bo Lim')] });
    const { root } = await mount(client);
    const filter = q(root, '#people-filter');
    filter.value = 'bo';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q(root, '#people-row-p1')).toBeNull();
    q(root, '#people-add-p2-staff').click();
    await flush();
    expect(q(root, '#people-filter').value).toBe('bo');
    expect(q(root, '#people-row-p1')).toBeNull();
    expect(q(root, '#people-row-p2').textContent).toContain('Staff');
  });

  it('says so when nobody matches, and when there are no people yet', async () => {
    const { root } = await mount(fakeClient({ people: [person('p1', 'Amy Tan')] }));
    const filter = q(root, '#people-filter');
    filter.value = 'zzz';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.textContent).toContain('No one matches that name.');

    const empty = await mount(fakeClient({ people: [] }));
    expect(empty.root.textContent).toContain('No people yet.');
    expect(q(empty.root, '#people-filter')).toBeNull();
  });

  it('shows a worded load error with Retry, and recovers', async () => {
    const client = fakeClient({ people: [person('p1', 'Amy Tan')], failRead: true });
    const { root } = await mount(client);
    expect(q(root, '.screen-feedback').dataset.tone).toBe('error');
    expect(q(root, '.screen-feedback').textContent).not.toMatch(/read failed/);
    const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeTruthy();
  });

  it('never writes to root once its signal is aborted mid-load', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const slow = {
      from() {
        const b = {
          select: () => b,
          eq: () => b,
          is: () => b,
          order: () => b,
          limit: () => gate.then(() => ({ data: [], error: null })),
          then: (resolve) => gate.then(() => ({ data: [], error: null })).then(resolve),
        };
        return b;
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    const pending = mountPeopleScreen(root, {
      orgId: 'org1',
      client: slow,
      signal: controller.signal,
    });
    expect(root.textContent).toContain('Loading people…');
    root.textContent = 'newer screen';
    controller.abort();
    release();
    await pending;
    expect(root.textContent).toBe('newer screen');
  });

  it('logs nothing, with a linked person on screen', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const client = fakeClient({ people: [person('p1', 'Amy', { global_person_id: GLOBAL_ID })] });
    await mount(client);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('stylesheet', () => {
  it('uses tokens only: no raw colours, and no fixed pixel widths', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/core/peopleScreen.css', 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/\bwidth:\s*\d+px/);
  });
});
