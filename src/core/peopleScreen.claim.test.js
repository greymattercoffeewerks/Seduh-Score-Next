// The People screen's Seduh ID claim controls (T-ID2.B3b): one state per person, the link shown ONCE with its warning, Copy,
// WhatsApp and a QR, Revoke, 44px targets, and the roster still working when the claim check cannot be made.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPeopleScreen } from './peopleScreen.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-';
const GLOBAL = '9b1f0c52-7a44-4c8e-9d3e-5d0e6c1f2a77';

const P = (id, name) => ({
  id,
  org_id: 'org1',
  display_name: name,
  cafe: null,
  global_person_id: GLOBAL,
});

function fakeClient({
  states = {},
  statusError = null,
  issueError = null,
  revokeError = null,
} = {}) {
  const people = Object.keys(states).map((id) => P(id, `Person ${id}`));
  const live = { ...states };
  const rpc = vi.fn(async (name, args) => {
    if (name === 'seduh_claim_statuses') {
      if (statusError) return { data: null, error: statusError };
      return {
        data: args.p_person_ids.map((id) => ({
          person_id: id,
          state: live[id].state,
          expires_at: live[id].expires_at ?? null,
          handle: live[id].handle ?? null,
        })),
        error: null,
      };
    }
    if (name === 'issue_seduh_claim_link') {
      if (issueError) return { data: null, error: issueError };
      live[args.p_person_id] = { state: 'link_open', expires_at: '2026-11-20T10:30:00Z' };
      return { data: TOKEN, error: null };
    }
    if (name === 'revoke_seduh_claim_link') {
      if (revokeError) return { data: null, error: revokeError };
      live[args.p_person_id] = { state: 'can_issue' };
      return { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const builder = (rows) => {
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: rows, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return b;
  };
  return { rpc, from: (table) => builder(table === 'people' ? people : []) };
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
const row = (root, id) => root.querySelector(`#people-row-${id}`);
const button = (root, name) =>
  [...root.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.startsWith(name) || b.textContent === name,
  );

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('one line per state', () => {
  it('says why there is no button for a person with no Seduh ID', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'no_identity' } } }));
    expect(row(root, 'a').textContent).toContain(
      'No Seduh ID yet. One is made after this person’s results are published and reviewed.',
    );
    expect(row(root, 'a').querySelector('#people-claim-issue-a')).toBeNull();
  });
  it('says an unavailable one cannot be claimed, with no button', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'unavailable' } } }));
    expect(row(root, 'a').textContent).toContain('This Seduh ID cannot be claimed.');
    expect(row(root, 'a').querySelector('#people-claim-issue-a')).toBeNull();
  });
  it('offers Send claim link when one can be issued', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'can_issue' } } }));
    const issue = row(root, 'a').querySelector('#people-claim-issue-a');
    expect(issue.textContent).toBe('Send claim link');
    expect(row(root, 'a').textContent).toContain('Not claimed yet.');
    expect(row(root, 'a').querySelector('#people-claim-revoke-a')).toBeNull();
  });
  it('shows until when an open link works, and offers a new link or Cancel', async () => {
    const root = await mount(
      fakeClient({ states: { a: { state: 'link_open', expires_at: '2026-11-20T10:30:00Z' } } }),
    );
    expect(row(root, 'a').textContent).toMatch(/Claim link sent\. It works until .*\d/);
    expect(row(root, 'a').querySelector('#people-claim-issue-a').textContent).toBe(
      'Make a new link',
    );
    expect(row(root, 'a').querySelector('#people-claim-revoke-a').textContent).toBe('Cancel link');
  });
  it('shows a claimed person with their handle as a link to their page, and no button', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'claimed', handle: 'aisha' } } }));
    const link = row(root, 'a').querySelector('a.people-claim-handle');
    expect(link.textContent).toBe('@aisha');
    expect(link.getAttribute('href')).toBe('/id/aisha/');
    expect(row(root, 'a').textContent).toContain('Claimed');
    expect(row(root, 'a').querySelector('#people-claim-issue-a')).toBeNull();
  });
  it('asks the database once for everyone, in the organisation', async () => {
    const client = fakeClient({
      states: { a: { state: 'can_issue' }, b: { state: 'no_identity' } },
    });
    await mount(client);
    const calls = client.rpc.mock.calls.filter((c) => c[0] === 'seduh_claim_statuses');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ p_org_id: 'org1', p_person_ids: ['a', 'b'] });
  });
});

describe('sending a link', () => {
  it('shows the warning, the link, Copy, WhatsApp and a QR once, and focuses the link', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'can_issue' } } }));
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    const input = root.querySelector('#people-claim-url-a');
    expect(input.value).toBe(`${window.location.origin}/id/claim/#${TOKEN}`);
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(true);
    const text = row(root, 'a').textContent;
    expect(text).toContain(
      'This link works once, for one person, and lets whoever holds it claim this Seduh ID. Send it only to that person.',
    );
    expect(root.querySelector('#people-claim-copy-a').textContent).toBe('Copy link');
    expect(root.querySelector('a[href^="https://wa.me/?text="]')).not.toBeNull();
    expect(root.querySelector('.qr-block')).not.toBeNull();
    // the printed address beside the QR never contains the token
    expect(root.querySelector('.qr-block-url').textContent).toBe('seduhscore.com/id/claim');
    // the state behind it is now "link sent"
    expect(text).toContain('Claim link sent.');
  });
  it('copies the link and says so, or says to copy by hand when the clipboard refuses', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'can_issue' } } }));
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    root.querySelector('#people-claim-copy-a').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/id/claim/#${TOKEN}`);
    expect(root.querySelector('#people-claim-copied-a').textContent).toBe('Link copied.');
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async () => Promise.reject(new Error('no')) },
    });
    root.querySelector('#people-claim-copy-a').click();
    await flush();
    expect(root.querySelector('#people-claim-copied-a').textContent).toMatch(/copy it by hand/);
  });
  it('lets the link go for good on Done: it is in no markup afterwards, only the state remains', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'can_issue' } } }));
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    root.querySelector('#people-claim-done-a').click();
    await flush();
    expect(root.querySelector('#people-claim-url-a')).toBeNull();
    expect(root.innerHTML).not.toContain(TOKEN);
    expect(row(root, 'a').textContent).toContain('Claim link sent.');
    expect(root.querySelector('.qr-block')).toBeNull();
  });
  it('gives every claim control a 44px target class', async () => {
    const root = await mount(fakeClient({ states: { a: { state: 'can_issue' } } }));
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    const controls = [
      ...row(root, 'a').querySelectorAll('.people-claim button, .people-claim a.btn'),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const control of controls)
      expect(control.className, control.textContent).toContain('tap-target');
  });
  it('words a refusal and shows no link', async () => {
    const root = await mount(
      fakeClient({
        states: { a: { state: 'can_issue' } },
        issueError: { code: 'P0001', hint: 'identity_claimed' },
      }),
    );
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    expect(root.querySelector('#people-feedback').textContent).toBe(
      'This Seduh ID has already been claimed.',
    );
    expect(root.querySelector('#people-claim-url-a')).toBeNull();
  });
  it('makes a new link replace the old one, and shows only the new one', async () => {
    const client = fakeClient({
      states: { a: { state: 'link_open', expires_at: '2026-11-20T10:30:00Z' } },
    });
    const root = await mount(client);
    row(root, 'a').querySelector('#people-claim-issue-a').click();
    await flush();
    expect(client.rpc.mock.calls.filter((c) => c[0] === 'issue_seduh_claim_link')).toHaveLength(1);
    expect(root.querySelector('#people-claim-url-a')).not.toBeNull();
  });
});

describe('cancelling a link', () => {
  it('revokes, says so, and goes back to "Not claimed yet" with the send button', async () => {
    const client = fakeClient({
      states: { a: { state: 'link_open', expires_at: '2026-11-20T10:30:00Z' } },
    });
    const root = await mount(client);
    row(root, 'a').querySelector('#people-claim-revoke-a').click();
    await flush();
    expect(client.rpc).toHaveBeenCalledWith('revoke_seduh_claim_link', { p_person_id: 'a' });
    expect(root.querySelector('#people-feedback').textContent).toBe(
      'The claim link for Person a was cancelled.',
    );
    expect(row(root, 'a').querySelector('#people-claim-issue-a').textContent).toBe(
      'Send claim link',
    );
  });
  it('shows what is true now when the link had already gone', async () => {
    const root = await mount(
      fakeClient({
        states: { a: { state: 'link_open', expires_at: '2026-11-20T10:30:00Z' } },
        revokeError: { code: 'P0001', hint: 'no_open_link' },
      }),
    );
    row(root, 'a').querySelector('#people-claim-revoke-a').click();
    await flush();
    expect(root.querySelector('#people-feedback').textContent).toBe(
      'There is no open claim link for this person.',
    );
  });
});

describe('when the check cannot be made', () => {
  it('still lists people, shows no claim controls, and says so once', async () => {
    const root = await mount(
      fakeClient({ states: { a: { state: 'can_issue' } }, statusError: { code: 'PGRST202' } }),
    );
    expect(row(root, 'a')).not.toBeNull();
    expect(root.querySelector('.people-claim')).toBeNull();
    expect(root.querySelector('#people-claim-unchecked').textContent).toMatch(
      /could not be checked/,
    );
    expect(button(root, 'Send claim link')).toBeUndefined();
  });
});
