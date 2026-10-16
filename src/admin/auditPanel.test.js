import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountAuditPanel, PAGE_SIZE, READ_FAILED } from './auditPanel.js';
import { describeAuditEntry, auditItem } from './auditView.js';
import { roleLabel } from './roles.js';
import { GENERIC_ERROR } from './adminErrors.js';
import { SLOW_MESSAGE } from './gate.js';
import { flush } from './consoleHarness.js';

const ORG = '33333333-3333-4333-8333-333333333333';

const row = (id, over = {}) => ({
  id,
  at: '2026-10-03T08:00:00Z',
  actor_id: 'a1',
  actor_email: 'ops@example.test',
  action: 'member.add',
  target_org_id: ORG,
  target_org_slug: 'alpha',
  target_user_id: 'u1',
  target_user_email: 'staff@alpha.test',
  detail: { role: 'organiser', attested: false },
  ...over,
});
const page = (from, count) => Array.from({ length: count }, (_, i) => row(from - i));
const ok = (data) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });

let host;
let handle;
function mount(answer) {
  const callAdmin = vi.fn(async (name, args) =>
    typeof answer === 'function' ? answer(args, name) : answer,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountAuditPanel(host, { callAdmin });
  return { callAdmin };
}
const items = () => [...host.querySelectorAll('li.adm-audit-item')];
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);

afterEach(() => {
  handle?.unmount();
  host?.remove();
  handle = host = undefined;
  vi.useRealTimers();
});

describe('describeAuditEntry and auditItem', () => {
  it('says each documented action in words, and the attestation when it was given', () => {
    expect(describeAuditEntry({ action: 'org.create' })).toBe('Organisation created');
    expect(describeAuditEntry({ action: 'member.add', detail: { role: 'owner' } })).toBe(
      'Member added as Owner',
    );
    expect(
      describeAuditEntry({ action: 'member.add', detail: { role: 'owner', attested: true } }),
    ).toBe('Member added as Owner, after confirming their own password');
    expect(
      describeAuditEntry({ action: 'member.add', detail: { role: 'owner', attested: 'yes' } }),
    ).toBe('Member added as Owner');
    expect(describeAuditEntry({ action: 'plan.set' })).toBe('plan.set');
    expect(roleLabel('constructor')).toBe('constructor');
  });

  it('names the organisation as a link only while it exists, and says so when it is gone', () => {
    const live = auditItem(row(1), { withOrg: true });
    expect(live.querySelector('a').getAttribute('href')).toBe(`#/orgs/${ORG}`);
    expect(live.querySelector('a').textContent).toBe('alpha');
    const gone = auditItem(row(2, { target_org_slug: null }), { withOrg: true });
    expect(gone.querySelector('a')).toBeNull();
    expect(gone.textContent).toContain('An organisation that no longer exists');
    const bad = auditItem(row(3, { target_org_id: 'not-an-id' }), { withOrg: true });
    expect(bad.querySelector('a')).toBeNull();
    const noOrg = auditItem(row(4, { target_org_id: null, target_org_slug: null }), {
      withOrg: true,
    });
    expect(noOrg.textContent).not.toContain('Organisation');
    // not asked for: not drawn
    expect(auditItem(row(5)).querySelector('a')).toBeNull();
  });

  it('writes an organisation link name as text, never as markup', () => {
    const item = auditItem(row(1, { target_org_slug: '<img src=x>' }), { withOrg: true });
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('a').textContent).toBe('<img src=x>');
  });
});

describe('the Audit log screen', () => {
  it('asks for the newest page, says it is loading, and draws each entry with its organisation', async () => {
    let answer;
    const { callAdmin } = mount(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    expect(host.querySelector('h1').textContent).toBe('Audit log');
    expect(host.textContent).toContain('Loading…');
    expect(callAdmin).toHaveBeenCalledWith('admin_list_audit', { p_limit: PAGE_SIZE });
    answer(ok([row(9), row(8, { action: 'org.create', detail: { slug: 'alpha' } })]));
    await flush();
    expect(host.textContent).not.toContain('Loading…');
    expect(items()).toHaveLength(2);
    expect(items()[0].textContent).toContain('Member added as Organiser');
    expect(items()[0].textContent).toContain('2026-10-03 08:00 UTC · by ops@example.test');
    expect(items()[1].textContent).toContain('Organisation created');
    expect(items()[0].querySelector('a').getAttribute('href')).toBe(`#/orgs/${ORG}`);
    expect(host.querySelector('ol').getAttribute('role')).toBe('list');
  });

  it('with fewer than a page it says that is everything and offers no more', async () => {
    mount(ok([row(3), row(2)]));
    await flush();
    expect(button('Show older changes')).toBeUndefined();
    expect(host.textContent).toContain('That is everything: 2 changes.');
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe(
      '2 changes loaded. 2 changes shown.',
    );
  });

  it('with nothing yet it says so', async () => {
    mount(ok([]));
    await flush();
    expect(host.textContent).toContain('Nothing has been changed through the console yet.');
    expect(items()).toHaveLength(0);
  });

  it('a full page offers older changes, asked for BEFORE the smallest id shown, and adds them below', async () => {
    const { callAdmin } = mount((args) =>
      ok(args.p_before === undefined ? page(200, PAGE_SIZE) : page(150, 3)),
    );
    await flush();
    expect(items()).toHaveLength(PAGE_SIZE);
    button('Show older changes').click();
    button('Show older changes')?.click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(2);
    expect(callAdmin).toHaveBeenLastCalledWith('admin_list_audit', {
      p_limit: PAGE_SIZE,
      p_before: 200 - PAGE_SIZE + 1,
    });
    expect(items()).toHaveLength(PAGE_SIZE + 3);
    expect(host.textContent).toContain(`That is everything: ${PAGE_SIZE + 3} changes.`);
    expect(button('Show older changes')).toBeUndefined();
  });

  it('after older changes arrive, focus is on the first of them (the button pressed is gone)', async () => {
    mount((args) => ok(args.p_before === undefined ? page(100, PAGE_SIZE) : page(40, 2)));
    await flush();
    button('Show older changes').click();
    await flush();
    expect(document.activeElement).toBe(items()[PAGE_SIZE]);
  });

  it('the older page keeps going while pages are full', async () => {
    mount((args) => ok(page(args.p_before === undefined ? 500 : args.p_before - 1, PAGE_SIZE)));
    await flush();
    button('Show older changes').click();
    await flush();
    expect(items()).toHaveLength(PAGE_SIZE * 2);
    expect(button('Show older changes')).toBeDefined();
  });

  it('a failure of the first page says so, with a Retry that asks for the same page once', async () => {
    let calls = 0;
    const { callAdmin } = mount(() => {
      calls += 1;
      return calls === 1 ? refused(undefined, { message: 'secret detail' }) : ok([row(2)]);
    });
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(GENERIC_ERROR);
    expect(host.textContent).not.toContain('secret detail');
    button('Retry').click();
    button('Retry')?.click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(2);
    expect(callAdmin).toHaveBeenLastCalledWith('admin_list_audit', { p_limit: PAGE_SIZE });
    expect(items()).toHaveLength(1);
    expect(host.querySelector('.screen-feedback').textContent).toBe('');
  });

  it('a failed older page keeps what is shown, and Retry asks for that same older page', async () => {
    let older = 0;
    const { callAdmin } = mount((args) => {
      if (args.p_before === undefined) return ok(page(100, PAGE_SIZE));
      older += 1;
      return older === 1 ? refused(undefined) : ok(page(40, 1));
    });
    await flush();
    button('Show older changes').click();
    await flush();
    expect(items()).toHaveLength(PAGE_SIZE);
    expect(button('Retry')).toBeDefined();
    button('Retry').click();
    await flush();
    expect(items()).toHaveLength(PAGE_SIZE + 1);
    const befores = callAdmin.mock.calls.map(([, args]) => args.p_before);
    expect(befores).toEqual([undefined, 51, 51]);
  });

  it('a request that never answers ends in the slow message', async () => {
    vi.useFakeTimers();
    mount(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(10001);
    expect(host.querySelector('.screen-feedback').textContent).toBe(SLOW_MESSAGE);
    expect(button('Retry')).toBeDefined();
  });

  it('a gate refusal clears the screen', async () => {
    mount(refused('admin_mfa_required'));
    await flush();
    expect(host.innerHTML).toBe('');
  });

  it('a row that is not what the function documents draws none of the page, says so, and offers Retry', async () => {
    mount(
      ok([
        row(5),
        {
          id: 4,
          get action() {
            throw new Error('boom');
          },
        },
      ]),
    );
    await flush();
    expect(host.querySelector('.screen-feedback').textContent).toBe(READ_FAILED);
    expect(items()).toHaveLength(0);
    expect(button('Retry')).toBeDefined();
    expect(document.activeElement).toBe(button('Retry'));
  });

  it('a page that is not a list, or whose rows have no usable ids, is the same failure (never "that is everything")', async () => {
    for (const data of [null, { rows: [] }, page(200, PAGE_SIZE).map((r) => ({ ...r, id: 'x' }))]) {
      mount(ok(data));
      await flush();
      expect(host.querySelector('.screen-feedback').textContent).toBe(READ_FAILED);
      expect(host.textContent).not.toContain('That is everything');
      handle.unmount();
      host.remove();
    }
  });

  it('draws only what it names: a detail value with an email-looking key never appears', async () => {
    mount(
      ok([
        row(5, { detail: { role: 'owner', email: 'leak@x.test', password: 'Zq9-never-shown' } }),
      ]),
    );
    await flush();
    expect(host.textContent).not.toContain('leak@x.test');
    expect(host.textContent).not.toContain('Zq9-never-shown');
  });

  it('after unmount a late answer draws nothing', async () => {
    let answer;
    mount(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    handle.unmount();
    answer(ok([row(2)]));
    await flush();
    expect(host.innerHTML).toBe('');
  });
});

describe('describeAuditEntry (from the organisation detail tests)', () => {
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

describe('the Audit log screen: focus and the shared host', () => {
  it('a late gate refusal for a screen that was left does not clear the screen that replaced it', async () => {
    let answer;
    host = document.createElement('div');
    document.body.appendChild(host);
    const a = mountAuditPanel(host, {
      callAdmin: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    a.unmount();
    // another screen takes the same host
    host.replaceChildren(
      Object.assign(document.createElement('h1'), { textContent: 'Newer screen' }),
    );
    answer(refused('admin_mfa_required'));
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Newer screen');
  });

  it('on opening it does not take focus into the list (the shell puts it on the heading)', async () => {
    mount(ok([row(3), row(2)]));
    await flush();
    expect(items().includes(document.activeElement)).toBe(false);
  });

  it('after older changes arrive the status says how many came and how many are shown', async () => {
    mount((args) => ok(args.p_before === undefined ? page(100, PAGE_SIZE) : page(40, 3)));
    await flush();
    button('Show older changes').click();
    await flush();
    expect(host.querySelector('.sr-only[role="status"]').textContent).toBe(
      '3 changes loaded. 53 changes shown.',
    );
  });

  it('a failed first page puts focus on its Retry, and a successful Retry puts it on the first change', async () => {
    let calls = 0;
    mount(() => {
      calls += 1;
      return calls === 1 ? refused(undefined) : ok([row(9), row(8)]);
    });
    await flush();
    expect(document.activeElement).toBe(button('Retry'));
    button('Retry').click();
    await flush();
    expect(document.activeElement).toBe(items()[0]);
  });

  it('a failed older page puts focus on its Retry', async () => {
    let older = 0;
    mount((args) => {
      if (args.p_before === undefined) return ok(page(100, PAGE_SIZE));
      older += 1;
      return older === 1 ? refused(undefined) : ok(page(40, 1));
    });
    await flush();
    button('Show older changes').click();
    await flush();
    expect(document.activeElement).toBe(button('Retry'));
  });

  it('an older page with nothing in it moves focus to the line that says the log ends', async () => {
    mount((args) => ok(args.p_before === undefined ? page(100, PAGE_SIZE) : []));
    await flush();
    button('Show older changes').click();
    await flush();
    const end = [...host.querySelectorAll('p')].find((p) =>
      p.textContent.startsWith('That is everything'),
    );
    expect(end).toBeDefined();
    expect(document.activeElement).toBe(end);
  });

  it('the organisation link has the organisation in its name', () => {
    const item = auditItem(row(1), { withOrg: true });
    expect(item.querySelector('a').getAttribute('aria-label')).toBe('Organisation alpha');
  });
});
