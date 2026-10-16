import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mountOrgsPanel, parseOrgsRoute, describeAuditEntry } from './orgsPanel.js';
import { flush } from './consoleHarness.js';

// The Organisations panel against a fake ctx.callAdmin: what it asks for, what it draws, what it never draws, and
// how it behaves when a request fails, hangs, or answers late.

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const orgRow = (over = {}) => ({
  org_id: ID_A,
  name: 'Alpha Roasters',
  slug: 'alpha-roasters',
  created_at: '2026-10-01T08:00:00Z',
  member_count: 2,
  event_count: 1,
  last_event_date: '2026-10-12',
  ...over,
});

const detailOf = (over = {}) => ({
  org: {
    id: ID_A,
    name: 'Alpha Roasters',
    slug: 'alpha-roasters',
    created_at: '2026-10-01T08:00:00Z',
  },
  event_count: 1,
  last_event_date: '2026-10-12',
  members: [
    { user_id: 'u1', email: 'owner@alpha.test', role: 'owner', joined_at: '2026-10-01T08:00:00Z' },
    {
      user_id: 'u2',
      email: 'staff@alpha.test',
      role: 'organiser',
      joined_at: '2026-10-03T08:00:00Z',
    },
  ],
  ...over,
});

const auditRow = (over = {}) => ({
  id: 5,
  at: '2026-10-03T08:00:00Z',
  actor_id: 'admin-1',
  actor_email: 'ops@example.test',
  action: 'member.add',
  target_org_id: ID_A,
  target_org_slug: 'alpha-roasters',
  target_user_id: 'u2',
  target_user_email: 'staff@alpha.test',
  detail: { role: 'organiser', attested: false },
  ...over,
});

let host;
let handle;

// answers: { admin_list_orgs, admin_org_detail, admin_list_audit }: each a value, or a function of the args.
function mount(answers = {}) {
  const callAdmin = vi.fn(async (name, args) => {
    const answer = answers[name];
    if (answer === undefined) throw new Error(`unexpected call ${name}`);
    return typeof answer === 'function' ? answer(args) : answer;
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountOrgsPanel(host, { callAdmin });
  return { callAdmin };
}

const ok = (data) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });
const text = () => host.textContent;
const buttons = (label) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent === label);
const goto = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};

beforeEach(() => {
  window.location.hash = '#/orgs';
});

afterEach(() => {
  handle?.unmount();
  host?.remove();
  host = undefined;
  handle = undefined;
  window.location.hash = '';
  vi.useRealTimers();
});

describe('parseOrgsRoute', () => {
  it('knows the list, a detail, an id that cannot be one, and another panel', () => {
    expect(parseOrgsRoute('#/orgs')).toEqual({ view: 'list' });
    expect(parseOrgsRoute('#/orgs/')).toEqual({ view: 'list' });
    expect(parseOrgsRoute(`#/orgs/${ID_A}`)).toEqual({ view: 'detail', id: ID_A });
    expect(parseOrgsRoute(`#/orgs/${ID_A.toUpperCase()}`)).toEqual({ view: 'detail', id: ID_A });
    for (const hash of [
      '#/orgs/not-a-uuid',
      `#/orgs/${ID_A}/extra`,
      '#/orgs/a/b/c',
      '#/orgs/%00',
    ]) {
      expect(parseOrgsRoute(hash), hash).toEqual({ view: 'missing' });
    }
    for (const hash of ['', '#', '#/', '#/audit', '#/organisations', '#/orgsx', undefined]) {
      expect(parseOrgsRoute(hash), String(hash)).toEqual({ view: 'other' });
    }
  });
});

describe('describeAuditEntry', () => {
  it('says each documented action in words, reading only the keys it is documented to carry', () => {
    expect(describeAuditEntry({ action: 'org.create' })).toBe('Organisation created');
    expect(describeAuditEntry({ action: 'member.add', detail: { role: 'organiser' } })).toBe(
      'Member added as Organiser',
    );
    expect(
      describeAuditEntry({ action: 'member.role_set', detail: { from: 'organiser', to: 'owner' } }),
    ).toBe('Role changed from Organiser to Owner');
    expect(describeAuditEntry({ action: 'account.create' })).toBe('Login created');
  });

  it('shows an action it does not know by its name, and survives a missing detail', () => {
    expect(describeAuditEntry({ action: 'plan.set' })).toBe('plan.set');
    expect(describeAuditEntry({ action: 'member.add' })).toBe('Member added');
    expect(describeAuditEntry({})).toBe('Change');
    expect(describeAuditEntry(null)).toBe('Change');
  });

  it('shows a role it does not know as it came, and never reads a role off the prototype chain', () => {
    expect(describeAuditEntry({ action: 'member.add', detail: { role: 'steward' } })).toBe(
      'Member added as steward',
    );
    for (const role of ['constructor', 'toString', '__proto__']) {
      expect(describeAuditEntry({ action: 'member.add', detail: { role } }), role).toBe(
        `Member added as ${role}`,
      );
    }
  });
});

describe('the list', () => {
  it('asks for the list once, with no arguments, and says it is loading until the answer comes', async () => {
    let answer;
    const { callAdmin } = mount({
      admin_list_orgs: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    expect(host.querySelector('h1').textContent).toBe('Organisations');
    expect(text()).toContain('Loading organisations…');
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(callAdmin).toHaveBeenCalledWith('admin_list_orgs', undefined);
    answer(ok([orgRow()]));
    await flush();
    expect(text()).not.toContain('Loading');
  });

  it('draws one card per organisation: name as a link to its detail, link name, counts and dates', async () => {
    mount({
      admin_list_orgs: ok([
        orgRow(),
        orgRow({
          org_id: ID_B,
          name: 'Bravo Beans',
          slug: 'bravo',
          member_count: 1,
          event_count: 0,
          last_event_date: null,
          created_at: '2026-09-20T00:00:00Z',
        }),
      ]),
    });
    await flush();
    expect(text()).toContain('2 organisations');
    const cards = host.querySelectorAll('li.adm-org');
    expect(cards).toHaveLength(2);
    const first = cards[0];
    expect(first.querySelector('a').getAttribute('href')).toBe(`#/orgs/${ID_A}`);
    expect(first.querySelector('a').textContent).toBe('Alpha Roasters');
    expect(first.querySelector('code').textContent).toBe('alpha-roasters');
    expect(first.textContent).toContain(
      '2 members · 1 event · last event 2026-10-12 · created 2026-10-01',
    );
    expect(cards[1].textContent).toContain(
      '1 member · 0 events · last event — · created 2026-09-20',
    );
  });

  it('says "1 organisation" for one, and says there are none for none', async () => {
    mount({ admin_list_orgs: ok([orgRow()]) });
    await flush();
    expect(text()).toContain('1 organisation');
    expect(text()).not.toContain('1 organisations');
    handle.unmount();
    host.remove();
    mount({ admin_list_orgs: ok([]) });
    await flush();
    expect(text()).toContain('There are no organisations yet.');
    expect(host.querySelector('ul')).toBeNull();
  });

  it('treats a non-array answer as an empty list rather than crashing', async () => {
    mount({ admin_list_orgs: ok(null) });
    await flush();
    expect(text()).toContain('There are no organisations yet.');
  });

  it('draws only the fields it names: nothing else the function might return reaches the page', async () => {
    mount({
      admin_list_orgs: ok([
        orgRow({
          event_names: ['SECRET SUMMIT 2026'],
          scores: [{ cupper: 'A. Person', total: 99 }],
          phone: '+673 555 0100',
        }),
      ]),
    });
    await flush();
    for (const leaked of ['SECRET SUMMIT', 'A. Person', '555 0100', '99']) {
      expect(text(), leaked).not.toContain(leaked);
    }
  });

  it('writes a name as text, never as markup', async () => {
    mount({
      admin_list_orgs: ok([
        orgRow({ name: '<img src=x onerror="alert(1)">Evil', slug: '<b>x</b>' }),
      ]),
    });
    await flush();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('.adm-org-name').textContent).toBe(
      '<img src=x onerror="alert(1)">Evil',
    );
  });

  it('a failure says so in words, never with the raw error, and Retry asks again exactly once per click', async () => {
    let calls = 0;
    const { callAdmin } = mount({
      admin_list_orgs: () => {
        calls += 1;
        return calls === 1
          ? refused(undefined, { message: 'relation "orgs" does not exist' })
          : ok([orgRow()]);
      },
    });
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'Something went wrong. Nothing was changed. Try again.',
    );
    expect(text()).not.toContain('relation');
    const [retry] = buttons('Retry');
    retry.click();
    retry.click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(2);
    expect(host.querySelector('li.adm-org')).not.toBeNull();
    expect(host.querySelector('.screen-feedback').textContent).toBe('');
  });

  it('a hint with words is shown in those words; an unknown hint falls back to the generic sentence', async () => {
    mount({ admin_list_orgs: refused('org_not_found') });
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'That organisation no longer exists.',
    );
  });

  it('a request that never answers ends in the slow message at the timeout', async () => {
    vi.useFakeTimers();
    mount({ admin_list_orgs: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(10001);
    expect(host.querySelector('.screen-feedback').textContent).toMatch(/longer than expected/);
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('a call that throws is a failure message with a Retry, not an unhandled rejection', async () => {
    const callAdmin = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    host = document.createElement('div');
    document.body.appendChild(host);
    handle = mountOrgsPanel(host, { callAdmin });
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'Something went wrong. Nothing was changed. Try again.',
    );
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('a gate refusal draws nothing at all: the console is re-checking access and will replace the panel', async () => {
    for (const hint of ['admin_mfa_required', 'admin_session_ended', 'admin_required']) {
      mount({ admin_list_orgs: refused(hint) });
      await flush();
      expect(host.innerHTML, hint).toBe('');
      handle.unmount();
      host.remove();
    }
  });

  it('a row that is not what the function documents is a failure with a Retry, not a blank page', async () => {
    mount({
      admin_list_orgs: ok([
        orgRow({
          name: {
            toString() {
              throw new Error('not a name');
            },
          },
        }),
      ]),
    });
    await flush();
    expect(host.querySelector('li.adm-org')).toBeNull();
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'Something went wrong. Nothing was changed. Try again.',
    );
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('after Retry the heading has focus again (the button that had it was replaced)', async () => {
    let calls = 0;
    mount({
      admin_list_orgs: () => {
        calls += 1;
        return calls === 1 ? refused(undefined) : ok([orgRow()]);
      },
    });
    await flush();
    const [retry] = buttons('Retry');
    retry.focus();
    retry.click();
    await flush();
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('an error that arrives late does not take focus from where the person has since moved', async () => {
    let fail;
    mount({
      admin_list_orgs: () =>
        new Promise((resolve) => {
          fail = resolve;
        }),
    });
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fail(refused(undefined));
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toMatch(/Something went wrong/);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('an error takes focus when focus is on the panel or nowhere', async () => {
    mount({ admin_list_orgs: refused(undefined) });
    await flush();
    expect(document.activeElement).toBe(host.querySelector('.screen-feedback'));
  });

  it('says in a screen-reader-only status when the list has loaded, and how many there are', async () => {
    mount({ admin_list_orgs: ok([orgRow(), orgRow({ org_id: ID_B, name: 'B' })]) });
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe('');
    await flush();
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe(
      '2 organisations loaded.',
    );
    handle.unmount();
    host.remove();
    mount({ admin_list_orgs: ok([]) });
    await flush();
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe(
      'There are no organisations yet.',
    );
  });

  it('marks its lists as lists (list-style none removes the role in Safari) and links each card to its link name', async () => {
    mount({ admin_list_orgs: ok([orgRow()]) });
    await flush();
    expect(host.querySelector('ul.adm-org-list').getAttribute('role')).toBe('list');
    const link = host.querySelector('a.adm-org-name');
    const described = host.querySelector(`#${link.getAttribute('aria-describedby')}`);
    expect(described.textContent).toBe('Link name: alpha-roasters');
  });
});

describe('one organisation', () => {
  const full = () => ({
    admin_org_detail: ok(detailOf()),
    admin_list_audit: ok([
      auditRow(),
      auditRow({
        id: 4,
        action: 'org.create',
        detail: { slug: 'alpha-roasters' },
        target_user_email: 'owner@alpha.test',
        at: '2026-10-01T08:00:00Z',
      }),
    ]),
  });

  it('asks for the organisation and for its recent changes, both for that id', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    const { callAdmin } = mount(full());
    await flush();
    expect(callAdmin).toHaveBeenCalledWith('admin_org_detail', { p_org_id: ID_A });
    expect(callAdmin).toHaveBeenCalledWith('admin_list_audit', { p_limit: 20, p_org_id: ID_A });
    expect(callAdmin).toHaveBeenCalledTimes(2);
    expect(callAdmin).not.toHaveBeenCalledWith('admin_list_orgs', expect.anything());
  });

  it('draws the name, the facts, the members with their roles, and the changes', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount(full());
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    const facts = [...host.querySelectorAll('.adm-fact')].map((f) => f.textContent);
    expect(facts).toEqual([
      'Link namealpha-roasters',
      'Created2026-10-01',
      'Events1 event',
      'Last event2026-10-12',
    ]);
    expect(text()).toContain('Members (2)');
    const members = [...host.querySelectorAll('.adm-member')].map((m) => m.textContent);
    expect(members).toEqual([
      'owner@alpha.testOwnerjoined 2026-10-01Make organiser',
      'staff@alpha.testOrganiserjoined 2026-10-03Make owner',
    ]);
    const changes = [...host.querySelectorAll('.adm-audit-item')].map((m) => m.textContent);
    expect(changes).toEqual([
      'Member added as Organiser2026-10-03 08:00 UTC · by ops@example.test · staff@alpha.test',
      'Organisation created2026-10-01 08:00 UTC · by ops@example.test · owner@alpha.test',
    ]);
  });

  it('has a way back to the list, and its link goes there', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount(full());
    await flush();
    const back = host.querySelector('a.adm-back');
    expect(back.getAttribute('href')).toBe('#/orgs');
    expect(back.textContent).toBe('← Organisations');
  });

  it('shows the empty states: no members, no changes', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({ admin_org_detail: ok(detailOf({ members: [] })), admin_list_audit: ok([]) });
    await flush();
    expect(text()).toContain('This organisation has no members.');
    expect(text()).toContain('No changes have been made here through the console yet.');
  });

  it('an organisation with no events yet says so with a dash and a zero', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(detailOf({ event_count: 0, last_event_date: null })),
      admin_list_audit: ok([]),
    });
    await flush();
    const facts = [...host.querySelectorAll('.adm-fact')].map((f) => f.textContent);
    expect(facts).toContain('Events0 events');
    expect(facts).toContain('Last event—');
  });

  it('names an account that no longer exists as such, and an action it does not know by its name', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([
        auditRow({ actor_email: null, target_user_email: null, action: 'plan.set' }),
      ]),
    });
    await flush();
    expect(host.querySelector('.adm-audit-item').textContent).toBe(
      'plan.set2026-10-03 08:00 UTC · by an account that no longer exists',
    );
  });

  it('never draws an event name, a score or a person who is not a member, even if a function returned them', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(
        detailOf({
          events: [{ name: 'SECRET SUMMIT 2026' }],
          scores: [{ cupper: 'A. Person' }],
          members: [
            {
              user_id: 'u1',
              email: 'owner@alpha.test',
              role: 'owner',
              joined_at: '2026-10-01T08:00:00Z',
              phone: '+673 555 0100',
            },
          ],
        }),
      ),
      admin_list_audit: ok([]),
    });
    await flush();
    for (const leaked of ['SECRET SUMMIT', 'A. Person', '555 0100']) {
      expect(text(), leaked).not.toContain(leaked);
    }
  });

  it('writes member emails and names as text, never as markup', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(
        detailOf({
          org: {
            id: ID_A,
            name: '<script>x()</script>',
            slug: 's',
            created_at: '2026-10-01T00:00:00Z',
          },
          members: [
            {
              user_id: 'u',
              email: '<img src=x>@a.test',
              role: 'owner',
              joined_at: '2026-10-01T00:00:00Z',
            },
          ],
        }),
      ),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(host.querySelector('script, img')).toBeNull();
    expect(host.querySelector('h1').textContent).toBe('<script>x()</script>');
  });

  it('a role it does not know is shown as it came, not hidden', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(
        detailOf({
          members: [{ user_id: 'u', email: 'a@b.test', role: 'steward', joined_at: null }],
        }),
      ),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(host.querySelector('.adm-member').textContent).toBe('a@b.teststewardjoined —');
  });

  it('an organisation that no longer exists says so, offers no Retry, and still has the way back', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({ admin_org_detail: refused('org_not_found'), admin_list_audit: ok([]) });
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'That organisation no longer exists.',
    );
    expect(buttons('Retry')).toHaveLength(0);
    expect(host.querySelector('a.adm-back')).not.toBeNull();
  });

  it('another failure offers Retry, which asks for both again', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let first = true;
    const { callAdmin } = mount({
      admin_org_detail: () => {
        if (first) {
          first = false;
          return refused(undefined);
        }
        return ok(detailOf());
      },
      admin_list_audit: ok([]),
    });
    await flush();
    expect(buttons('Retry')).toHaveLength(1);
    buttons('Retry')[0].click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(4);
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
  });

  it('a failure of the changes alone does not hide the organisation: it says that part failed', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: refused(undefined) });
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    expect(text()).toContain('Members (2)');
    expect(text()).toContain('Recent changes could not be loaded.');
  });

  it('a gate refusal on either request clears the panel: nothing of the data stays on screen', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: refused('admin_mfa_required') });
    await flush();
    expect(host.innerHTML).toBe('');
    handle.unmount();
    host.remove();
    mount({ admin_org_detail: refused('admin_session_ended'), admin_list_audit: ok([]) });
    await flush();
    expect(host.innerHTML).toBe('');
  });

  it('draws the organisation as soon as ITS answer arrives, without waiting for the changes', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let answerAudit;
    mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: () =>
        new Promise((resolve) => {
          answerAudit = resolve;
        }),
    });
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    expect(text()).toContain('Members (2)');
    expect(text()).toContain('Loading recent changes…');
    answerAudit(ok([auditRow()]));
    await flush();
    expect(text()).not.toContain('Loading recent changes');
    expect(host.querySelectorAll('.adm-audit-item')).toHaveLength(1);
  });

  it('changes that never answer end in the slow message beside a Retry, and the organisation stays', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    vi.useFakeTimers();
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(10001);
    expect(text()).toMatch(/Recent changes could not be loaded\. .*longer than expected/);
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('the changes have a Retry of their own that asks for the changes only', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let calls = 0;
    const { callAdmin } = mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: () => {
        calls += 1;
        return calls === 1 ? refused(undefined) : ok([auditRow()]);
      },
    });
    await flush();
    const [retry] = buttons('Retry');
    retry.click();
    retry.click();
    await flush();
    expect(callAdmin.mock.calls.filter(([name]) => name === 'admin_list_audit')).toHaveLength(2);
    expect(callAdmin.mock.calls.filter(([name]) => name === 'admin_org_detail')).toHaveLength(1);
    expect(host.querySelectorAll('.adm-audit-item')).toHaveLength(1);
    expect(text()).not.toContain('could not be loaded');
  });

  it('says the changes are cut when there are exactly as many as it asked for, and not when there are fewer', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    const rows = (n) => Array.from({ length: n }, (_, i) => auditRow({ id: i + 1 }));
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: ok(rows(20)) });
    await flush();
    expect(text()).toContain('Showing the latest 20 changes.');
    handle.unmount();
    host.remove();
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: ok(rows(19)) });
    await flush();
    expect(host.querySelectorAll('.adm-audit-item')).toHaveLength(19);
    expect(text()).not.toContain('Showing the latest');
  });

  it('after Retry on the whole organisation the heading has focus again', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let calls = 0;
    mount({
      admin_org_detail: () => {
        calls += 1;
        return calls === 1 ? refused(undefined) : ok(detailOf());
      },
      admin_list_audit: ok([]),
    });
    await flush();
    buttons('Retry')[0].focus();
    buttons('Retry')[0].click();
    await flush();
    expect(document.activeElement).toBe(host.querySelector('h1'));
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
  });

  it('a body that is not what the function documents is a failure with a Retry, not a blank page', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(
        detailOf({
          org: {
            name: {
              toString() {
                throw new Error('not a name');
              },
            },
          },
        }),
      ),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Organisation');
    expect(host.querySelector('.screen-feedback').textContent).toMatch(/Something went wrong/);
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('says in a screen-reader-only status that the organisation has loaded, by name', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount(full());
    await flush();
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe(
      'Alpha Roasters loaded.',
    );
  });

  it('hides the back arrow from a screen reader, and marks its lists as lists', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount(full());
    await flush();
    expect(host.querySelector('a.adm-back [aria-hidden="true"]').textContent).toBe('←');
    for (const selector of ['ul.adm-members', 'ol.adm-audit']) {
      expect(host.querySelector(selector).getAttribute('role'), selector).toBe('list');
    }
  });

  it('shows an unknown role by its own text even when it is named like something on the prototype chain', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(
        detailOf({
          members: [{ user_id: 'u', email: 'a@b.test', role: 'constructor', joined_at: null }],
        }),
      ),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(host.querySelector('.adm-role').textContent).toBe('constructor');
  });

  it('an id that cannot be one asks for nothing and says the organisation is not found', async () => {
    window.location.hash = '#/orgs/not-a-uuid';
    const { callAdmin } = mount({});
    await flush();
    expect(callAdmin).not.toHaveBeenCalled();
    expect(host.querySelector('h1').textContent).toBe('Organisation not found');
    // static text: focus is on the heading, so it is read next, and a live region would say it twice
    const note = host.querySelector('.screen-feedback');
    expect(note.textContent).toBe('That organisation no longer exists.');
    expect(note.getAttribute('role')).toBeNull();
    expect(host.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(host.querySelector('a.adm-back').getAttribute('href')).toBe('#/orgs');
  });
});

describe('moving inside the panel', () => {
  it('follows the hash from the list to a detail and back, and puts focus on the new heading', async () => {
    const { callAdmin } = mount({
      admin_list_orgs: ok([orgRow()]),
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Organisations');

    await goto(`#/orgs/${ID_A}`);
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    expect(document.activeElement).toBe(host.querySelector('h1'));

    await goto('#/orgs');
    expect(host.querySelector('h1').textContent).toBe('Organisations');
    expect(callAdmin.mock.calls.filter(([name]) => name === 'admin_list_orgs')).toHaveLength(2);
  });

  it('an answer for a view that has been left is thrown away', async () => {
    let answerList;
    mount({
      admin_list_orgs: () =>
        new Promise((resolve) => {
          answerList = resolve;
        }),
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
    });
    await goto(`#/orgs/${ID_A}`);
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    answerList(ok([orgRow({ name: 'Late List Org' })]));
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
    expect(text()).not.toContain('Late List Org');
  });

  it('a hash for another panel is ignored (the shell is about to unmount this one)', async () => {
    const { callAdmin } = mount({ admin_list_orgs: ok([orgRow()]) });
    await flush();
    await goto('#/audit');
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(host.querySelector('h1').textContent).toBe('Organisations');
  });

  it('after unmount it stops listening and discards a request still in flight', async () => {
    let answer;
    const { callAdmin } = mount({
      admin_list_orgs: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    handle.unmount();
    const before = host.innerHTML;
    answer(ok([orgRow({ name: 'After Unmount' })]));
    await flush();
    expect(host.innerHTML).toBe(before);
    await goto(`#/orgs/${ID_A}`);
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe(before);
  });

  it('opened on an address that names no panel it shows the list, and the shell correcting the address does not reload it', async () => {
    window.location.hash = '';
    const { callAdmin } = mount({ admin_list_orgs: ok([orgRow()]) });
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Organisations');
    await goto('#/orgs');
    expect(callAdmin).toHaveBeenCalledTimes(1);
  });

  it('mounting does not move focus by itself (the shell moves it to the heading when the panel opens)', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    mount({ admin_list_orgs: ok([]) });
    await flush();
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

describe('ids, stale answers and other panels (gaps found by mutation)', () => {
  const MIXED = 'ABCDEF01-2345-4ABC-8DEF-0123456789AB';

  it('lower-cases an id that has letters, and rejects ids that only look like one', () => {
    expect(parseOrgsRoute(`#/orgs/${MIXED}`)).toEqual({ view: 'detail', id: MIXED.toLowerCase() });
    for (const bad of [
      `${ID_A}0`, // one character too long
      ID_A.slice(0, -1), // one too short
      'abcdef01-2345-4abc-8def-0123456789a', // hex, but short
      'abcdef0123454abc8def0123456789ab', // no hyphens
      'abc-def',
      'abcdef01-2345-4abc-8def-0123456789ag', // one non-hex character
    ]) {
      expect(parseOrgsRoute(`#/orgs/${bad}`), bad).toEqual({ view: 'missing' });
    }
  });

  it('asks the database for the lower-cased id', async () => {
    window.location.hash = `#/orgs/${MIXED}`;
    const { callAdmin } = mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
    });
    await flush();
    expect(callAdmin).toHaveBeenCalledWith('admin_org_detail', { p_org_id: MIXED.toLowerCase() });
  });

  it('a detail answer that arrives after the person has gone back to the list is thrown away', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let answerDetail;
    mount({
      admin_org_detail: () =>
        new Promise((resolve) => {
          answerDetail = resolve;
        }),
      admin_list_audit: ok([]),
      admin_list_orgs: ok([orgRow({ name: 'The List' })]),
    });
    await flush();
    await goto('#/orgs');
    expect(host.querySelector('.adm-org-name').textContent).toBe('The List');
    answerDetail(
      ok(detailOf({ org: { id: ID_A, name: 'Late Detail', slug: 's', created_at: null } })),
    );
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Organisations');
    expect(text()).not.toContain('Late Detail');
  });

  it('a hash for another panel, set while a detail is open, leaves the detail alone (the shell swaps the panel)', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    const { callAdmin } = mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
      admin_list_orgs: ok([orgRow()]),
    });
    await flush();
    const calls = callAdmin.mock.calls.length;
    await goto('#/audit');
    expect(callAdmin.mock.calls.length).toBe(calls);
    expect(host.querySelector('h1').textContent).toBe('Alpha Roasters');
  });
});

describe('a detail still loading when the panel is closed', () => {
  it('draws nothing afterwards (the host is still on the page, so a late answer would show)', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let answerDetail;
    mount({
      admin_org_detail: () =>
        new Promise((resolve) => {
          answerDetail = resolve;
        }),
      admin_list_audit: ok([]),
    });
    await flush();
    handle.unmount();
    const before = host.innerHTML;
    answerDetail(
      ok(detailOf({ org: { id: ID_A, name: 'Closed Panel Org', slug: 's', created_at: null } })),
    );
    await flush();
    expect(host.innerHTML).toBe(before);
    expect(text()).not.toContain('Closed Panel Org');
  });
});

describe('changing an organisation from its detail (add a member, change a role)', () => {
  const click = async (label) => {
    buttons(label)[0].click();
    await flush();
  };
  const detailCalls = (callAdmin) =>
    callAdmin.mock.calls.filter(([name]) => name === 'admin_org_detail').length;

  it('shows an Add a member section and a role button for each member, under the members', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({ admin_org_detail: ok(detailOf()), admin_list_audit: ok([]) });
    await flush();
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Members (2)',
      'Add a member',
      'Recent changes',
    ]);
    const roleButtons = [...host.querySelectorAll('.adm-member button')].map((b) => b.textContent);
    expect(roleButtons).toEqual(['Make organiser', 'Make owner']);
  });

  it('after a role change the detail is drawn again from the database, with a notice and focus on the heading', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let changed = false;
    const { callAdmin } = mount({
      admin_org_detail: () =>
        ok(
          detailOf({
            members: [
              {
                user_id: '66666666-6666-4666-8666-666666666666',
                email: 'staff@alpha.test',
                role: changed ? 'owner' : 'organiser',
                joined_at: '2026-10-03T08:00:00Z',
              },
            ],
          }),
        ),
      admin_list_audit: ok([]),
      admin_set_role: () => {
        changed = true;
        return ok(null);
      },
    });
    await flush();
    await click('Make owner');
    await click('Confirm');
    expect(callAdmin).toHaveBeenCalledWith('admin_set_role', {
      p_org_id: ID_A,
      p_user_id: '66666666-6666-4666-8666-666666666666',
      p_role: 'owner',
    });
    expect(detailCalls(callAdmin)).toBe(2);
    expect(host.querySelector('.adm-role').textContent).toBe('Owner');
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'staff@alpha.test is now Owner.',
    );
    expect(host.querySelector('.screen-feedback').dataset.tone).toBe('success');
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('a refused role change says why and leaves the detail as it was (no reload)', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    const { callAdmin } = mount({
      admin_org_detail: ok(
        detailOf({
          members: [
            {
              user_id: '66666666-6666-4666-8666-666666666666',
              email: 'only@alpha.test',
              role: 'owner',
              joined_at: null,
            },
          ],
        }),
      ),
      admin_list_audit: ok([]),
      admin_set_role: refused('last_owner'),
    });
    await flush();
    await click('Make organiser');
    await click('Confirm');
    expect(text()).toContain('An organisation must keep at least one owner');
    expect(detailCalls(callAdmin)).toBe(1);
  });

  it('after a member is added the detail is drawn again with a notice', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let added = false;
    const { callAdmin } = mount({
      admin_org_detail: () =>
        ok(
          added
            ? detailOf({
                members: [
                  ...detailOf().members,
                  {
                    user_id: '77777777-7777-4777-8777-777777777777',
                    email: 'new@alpha.test',
                    role: 'organiser',
                    joined_at: '2026-10-16T08:00:00Z',
                  },
                ],
              })
            : detailOf(),
        ),
      admin_list_audit: ok([]),
      admin_find_user: ok([
        {
          user_id: '77777777-7777-4777-8777-777777777777',
          email: 'new@alpha.test',
          banned: false,
          deleted: false,
          org_count: 0,
          must_change_password: false,
          needs_attestation: false,
        },
      ]),
      admin_add_member: () => {
        added = true;
        return ok(null);
      },
    });
    await flush();
    const email = host.querySelector('#adm-member-email');
    email.value = 'new@alpha.test';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    await click('Look up account');
    host.querySelector('#adm-member-role').value = 'organiser';
    host
      .querySelector('#adm-member-email')
      .closest('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(callAdmin).toHaveBeenCalledWith('admin_add_member', {
      p_org_id: ID_A,
      p_user_id: '77777777-7777-4777-8777-777777777777',
      p_role: 'organiser',
      p_attest_own_password: false,
    });
    expect(text()).toContain('Members (3)');
    expect(host.querySelector('.screen-feedback').textContent).toBe(
      'new@alpha.test was added as Organiser.',
    );
  });

  it('a gate refusal from a role change clears the panel', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
      admin_set_role: refused('admin_mfa_required'),
    });
    await flush();
    await click('Make owner');
    await click('Confirm');
    expect(host.innerHTML).toBe('');
  });

  it('a lookup refused after the person went back to the list does not clear the list it never belonged to', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let answer;
    mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
      admin_list_orgs: ok([orgRow({ name: 'The List' })]),
      admin_find_user: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await flush();
    const email = host.querySelector('#adm-member-email');
    email.value = 'new@alpha.test';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    buttons('Look up account')[0].click();
    await goto('#/orgs');
    answer(refused('admin_mfa_required'));
    await flush();
    expect(host.querySelector('.adm-org-name').textContent).toBe('The List');
  });

  it('a lookup still out when the person goes back to the list draws nothing', async () => {
    window.location.hash = `#/orgs/${ID_A}`;
    let answer;
    mount({
      admin_org_detail: ok(detailOf()),
      admin_list_audit: ok([]),
      admin_list_orgs: ok([orgRow()]),
      admin_find_user: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await flush();
    const email = host.querySelector('#adm-member-email');
    email.value = 'new@alpha.test';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    buttons('Look up account')[0].click();
    await goto('#/orgs');
    const before = host.innerHTML;
    answer(ok([]));
    await flush();
    expect(host.innerHTML).toBe(before);
  });
});
