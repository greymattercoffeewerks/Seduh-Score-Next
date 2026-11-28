// The People screen's "Tidy up": the database says who is safe to remove, the screen offers only those, asks before
// removing, sends exactly the ticked ids, and shows the refusal in words when the database says no.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('./feedback.js', async (orig) => ({ ...(await orig()), confirmDialog }));

import { mountPeopleScreen } from './peopleScreen.js';

function fakeClient({ unused = [], listError = null, removeError = null } = {}) {
  let people = [
    { id: 'keep', org_id: 'org1', display_name: 'Kept Person', cafe: null, global_person_id: null },
    ...unused.map((u) => ({
      id: u.id,
      org_id: 'org1',
      display_name: u.name,
      cafe: null,
      global_person_id: null,
    })),
  ];
  const rpc = vi.fn(async (name, args) => {
    if (name === 'seduh_claim_statuses') return { data: [], error: null };
    if (name === 'list_unused_people') {
      if (listError) return { data: null, error: listError };
      return {
        data: unused.map((u) => ({ person_id: u.id, display_name: u.name, cafe: u.cafe ?? null })),
        error: null,
      };
    }
    if (name === 'remove_unused_people') {
      if (removeError) return { data: null, error: removeError };
      const gone = people.filter((p) => args.p_person_ids.includes(p.id)).length;
      people = people.filter((p) => !args.p_person_ids.includes(p.id));
      return { data: gone, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const builder = (rows) => {
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: rows(), error: null }),
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return b;
  };
  return { rpc, from: (table) => builder(() => (table === 'people' ? people : [])) };
}

async function mount(client) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  await mountPeopleScreen(root, { orgId: 'org1', client });
  return root;
}
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const click = async (root, selector) => {
  root.querySelector(selector).click();
  await flush();
};

beforeEach(() => confirmDialog.mockReset());
afterEach(() => document.body.replaceChildren());

describe('Tidy up', () => {
  it('asks nothing of the database until the organiser presses Find', async () => {
    const client = fakeClient({ unused: [{ id: 'u1', name: 'Leftover One' }] });
    const root = await mount(client);
    expect(client.rpc.mock.calls.some(([name]) => name === 'list_unused_people')).toBe(false);
    expect(root.querySelector('#people-tidy-find')).not.toBeNull();
  });

  it('offers exactly the people the database listed, none ticked, with Remove disabled', async () => {
    const root = await mount(
      fakeClient({
        unused: [
          { id: 'u1', name: 'Leftover One' },
          { id: 'u2', name: 'Leftover Two', cafe: 'Cafe X' },
        ],
      }),
    );
    await click(root, '#people-tidy-find');
    expect(root.querySelector('#people-tidy-u1')).not.toBeNull();
    expect(root.querySelector('#people-tidy-u2').closest('label').textContent).toBe(
      'Leftover Two, Cafe X',
    );
    expect(root.querySelector('#people-tidy-u1').checked).toBe(false);
    expect(root.querySelector('#people-tidy-remove').disabled).toBe(true);
  });

  it('keeps focus on the checkbox after ticking, and lands focus on the heading after Find', async () => {
    const root = await mount(fakeClient({ unused: [{ id: 'u1', name: 'Leftover One' }] }));
    document.body.appendChild(root);
    await click(root, '#people-tidy-find');
    expect(document.activeElement.id).toBe('people-tidy-heading');
    expect(root.querySelector('#people-feedback').textContent).toBe('1 person can be removed.');
    await click(root, '#people-tidy-u1');
    expect(document.activeElement.id).toBe('people-tidy-u1');
  });

  it('says so when there is nobody to tidy up', async () => {
    const root = await mount(fakeClient({ unused: [] }));
    await click(root, '#people-tidy-find');
    expect(root.querySelector('#people-tidy-none').textContent).toBe('Nobody to tidy up.');
    expect(document.activeElement.id).toBe('people-tidy-none');
    expect(root.querySelector('#people-tidy-remove')).toBeNull();
  });

  it('sends only the ticked ids, after the organiser confirms, then refreshes the list', async () => {
    confirmDialog.mockResolvedValue(true);
    const client = fakeClient({
      unused: [
        { id: 'u1', name: 'Leftover One' },
        { id: 'u2', name: 'Leftover Two' },
      ],
    });
    const root = await mount(client);
    await click(root, '#people-tidy-find');
    await click(root, '#people-tidy-u2');
    expect(root.querySelector('#people-tidy-remove').textContent).toBe('Remove 1 person');
    await click(root, '#people-tidy-remove');
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('remove_unused_people', {
      p_org_id: 'org1',
      p_person_ids: ['u2'],
    });
    expect(root.querySelector('#people-feedback').textContent).toBe('Removed 1 person.');
    expect(root.textContent).not.toContain('Leftover Two');
    expect(root.textContent).toContain('Leftover One');
  });

  it('removes nobody when the organiser cancels the confirmation', async () => {
    confirmDialog.mockResolvedValue(false);
    const client = fakeClient({ unused: [{ id: 'u1', name: 'Leftover One' }] });
    const root = await mount(client);
    await click(root, '#people-tidy-find');
    await click(root, '#people-tidy-u1');
    await click(root, '#people-tidy-remove');
    expect(client.rpc.mock.calls.some(([name]) => name === 'remove_unused_people')).toBe(false);
    expect(root.textContent).toContain('Leftover One');
  });

  it('shows a refusal in words and keeps the list', async () => {
    confirmDialog.mockResolvedValue(true);
    const client = fakeClient({
      unused: [{ id: 'u1', name: 'Leftover One' }],
      removeError: {
        message: 'new row violates row-level security policy for table "people"',
        code: '42501',
      },
    });
    const root = await mount(client);
    await click(root, '#people-tidy-find');
    await click(root, '#people-tidy-u1');
    await click(root, '#people-tidy-remove');
    expect(root.querySelector('#people-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('#people-tidy-u1')).not.toBeNull();
  });

  it('shows the error when the list cannot be read', async () => {
    const root = await mount(fakeClient({ listError: { message: 'boom', code: 'XX000' } }));
    await click(root, '#people-tidy-find');
    expect(root.querySelector('#people-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('#people-tidy-find')).not.toBeNull();
  });
});
