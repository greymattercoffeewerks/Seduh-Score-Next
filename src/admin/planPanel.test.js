import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mountPlanPanel, parsePlanRoute } from './planPanel.js';
import { flush } from './consoleHarness.js';

// The Plan panel against a fake ctx.callAdmin: what it asks for, what it draws, what it never draws, and what each control sends.

const ORG = '11111111-1111-4111-8111-111111111111';
const EV_OPEN = '33333333-3333-4333-8333-333333333331';
const EV_DONE = '33333333-3333-4333-8333-333333333332';
const GRANT_A = '44444444-4444-4444-8444-444444444441';
const GRANT_B = '44444444-4444-4444-8444-444444444442';

const keyRow = (over = {}) => ({
  key: 'btc_format',
  kind: 'flag',
  min_tier: 'per_event',
  enforced: false,
  window_bound: true,
  note: 'Creating a BTC event (D-G17).',
  caps: null,
  ...over,
});
const KEYS = [
  keyRow(),
  keyRow({
    key: 'cup_taster_participants',
    kind: 'cap',
    min_tier: null,
    caps: { community: 8, per_event: null, annual: null },
    enforced: true,
    note: 'Cap',
  }),
];
const ORGS = [
  {
    org_id: ORG,
    name: 'Alpha Roasters',
    slug: 'alpha',
    tier: 'community',
    event_grants: 1,
    locked_events: 0,
  },
];

const PLAN = {
  org: { id: ORG, name: 'Alpha Roasters', slug: 'alpha' },
  tier: 'community',
  grants: [
    {
      id: GRANT_A,
      event_id: EV_DONE,
      tier: 'per_event',
      valid_from: '2026-12-07T16:00:00Z',
      valid_until: '2026-12-12T16:00:00Z',
      source: 'payment',
      granted_by: '99999999-aaaa-4bbb-8ccc-000000000001',
      note: 'BND 18 cash',
      extends_grant_id: null,
      revoked_at: null,
      created_at: '2026-11-01T08:00:00Z',
    },
    {
      id: GRANT_B,
      event_id: null,
      tier: 'annual',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: null,
      source: 'manual',
      granted_by: '99999999-aaaa-4bbb-8ccc-000000000001',
      note: null,
      extends_grant_id: null,
      revoked_at: '2026-10-05T00:00:00Z',
      created_at: '2026-10-01T08:00:00Z',
    },
  ],
  events: [
    {
      id: EV_OPEN,
      label: 'cup_taster · 2026-12-10 · 33333333',
      format: 'cup_taster',
      event_date: '2026-12-10',
      is_test: false,
      ended_via: null,
      ended_at: null,
      snapshot_tier: null,
      window_ends_at: null,
      window_ended: false,
      has_window: false,
    },
    {
      id: EV_DONE,
      label: 'btc · 2026-12-10 · 33333333',
      format: 'btc',
      event_date: '2026-12-10',
      is_test: false,
      ended_via: 'organiser',
      ended_at: '2026-12-12T10:00:00Z',
      snapshot_tier: 'per_event',
      window_ends_at: '2026-12-12T16:00:00Z',
      window_ended: true,
      has_window: true,
    },
  ],
  keys: [
    { key: 'btc_format', kind: 'flag', enforced: false, allowed_if_enforced: false, limit: null },
    { key: 'events_open', kind: 'cap', enforced: false, allowed_if_enforced: true, limit: 1 },
    {
      key: 'cup_taster_report',
      kind: 'flag',
      enforced: true,
      allowed_if_enforced: false,
      limit: null,
    },
    {
      key: 'cup_taster_analytics',
      kind: 'flag',
      enforced: true,
      allowed_if_enforced: true,
      limit: null,
    },
  ],
};

let host;
let handle;
let callAdmin;

function mount(answers = {}) {
  callAdmin = vi.fn(async (name, args) => {
    const answer = answers[name];
    if (answer === undefined) throw new Error(`unexpected call ${name}`);
    return typeof answer === 'function' ? answer(args) : answer;
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountPlanPanel(host, { callAdmin });
}

const ok = (data) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });
const text = () => host.textContent;
const calls = (name) => callAdmin.mock.calls.filter(([n]) => n === name);
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (label) => {
  const b = button(label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
  await flush();
};
const open = (summary) => {
  const d = [...host.querySelectorAll('details')].find(
    (x) => x.querySelector('summary').textContent === summary,
  );
  if (!d) throw new Error(`no details ${summary}`);
  d.open = true;
  return d;
};
const submitForm = async (form) => {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
};
const goto = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};

const overview = (extra = {}) => ({
  admin_list_keys: ok(KEYS),
  admin_plan_orgs: ok(ORGS),
  ...extra,
});

beforeEach(() => {
  window.location.hash = '#/plan';
});
afterEach(() => {
  handle?.unmount();
  host?.remove();
  host = undefined;
  handle = undefined;
  window.location.hash = '';
});

describe('parsePlanRoute', () => {
  it('knows the overview, an organisation, an id that cannot be one, and another panel', () => {
    expect(parsePlanRoute('#/plan')).toEqual({ view: 'overview' });
    expect(parsePlanRoute('#/plan/')).toEqual({ view: 'overview' });
    expect(parsePlanRoute(`#/plan/${ORG}`)).toEqual({ view: 'org', id: ORG });
    expect(parsePlanRoute(`#/plan/${ORG.toUpperCase()}`)).toEqual({ view: 'org', id: ORG });
    for (const hash of ['#/plan/nope', `#/plan/${ORG}/x`, '#/plan/a/b'])
      expect(parsePlanRoute(hash)).toEqual({ view: 'missing' });
    expect(parsePlanRoute('#/orgs')).toEqual({ view: 'other' });
  });
});

describe('the overview', () => {
  it('draws every key with its state in words, and the organisations with their plan now', async () => {
    mount(overview());
    await flush();
    expect(host.querySelector('h1').textContent).toBe('Plans and keys');
    expect(text()).toContain('Barista Team Championship (BTC) events');
    expect(text()).toContain('Participants per Cup Taster event');
    // the id stays, small, for the operator who needs to name the key
    expect(host.querySelector('.adm-key-id').textContent).toBe('btc_format');
    expect(text()).toContain('Off: nobody is restricted yet');
    expect(text()).toContain('On: in force');
    expect(host.querySelector('.adm-badge--off').textContent).toBe('Off: nobody is restricted yet');
    expect(host.querySelector('.adm-badge--on').textContent).toBe('On: in force');
    // the note keeps its words and drops the decision code
    expect(text()).toContain('Creating a BTC event.');
    expect(text()).not.toContain('D-G17');
    for (const jargon of ['Dark', 'Enforced', 'frozen']) expect(text()).not.toContain(jargon);
    expect(text()).toContain('Needs Per-event or above');
    expect(text()).toContain('Limit: Community 8, Per-event no limit, Annual no limit');
    expect(text()).toContain('Alpha Roasters');
    expect(host.querySelector(`a[href="#/plan/${ORG}"]`)).not.toBeNull();
    expect(calls('admin_set_key_enforced')).toHaveLength(0);
  });

  it('turning a key on needs the preview first, shows what it would do, and sends the previewed count', async () => {
    mount(
      overview({
        admin_gating_preview: ok({
          key: 'btc_format',
          would_lose: 2,
          organisations: [{ name: 'Beta', tier: 'community', detail: { event_grants: 1 } }],
        }),
        admin_set_key_enforced: ok(null),
      }),
    );
    await flush();
    expect(button('Turn on')).toBeUndefined();
    await click('Preview turning it on');
    expect(calls('admin_gating_preview')[0][1]).toEqual({ p_key: 'btc_format' });
    expect(text()).toContain('If you turned this on now, 2 organisations would lose access.');
    expect(text()).toContain('Beta');
    expect(text()).toContain('1 single-event plan (not counted here)');
    expect(calls('admin_set_key_enforced')).toHaveLength(0);
    await click('Turn on');
    expect(text()).toContain('Turn on “Barista Team Championship (BTC) events” now?');
    expect(text()).toContain('Needs Per-event or above');
    expect(text()).toContain('2 organisations would lose access today.');
    expect(calls('admin_set_key_enforced')).toHaveLength(0);
    await click('Turn on');
    expect(calls('admin_set_key_enforced')[0][1]).toEqual({
      p_key: 'btc_format',
      p_enforced: true,
      p_confirm: 2,
    });
  });

  it('a limit key says an organisation would hit the limit, a feature key says it would lose access, and zero says nobody', async () => {
    const dark = keyRow({
      key: 'events_open',
      kind: 'cap',
      min_tier: null,
      caps: { community: 1, per_event: null, annual: null },
    });
    mount({
      admin_list_keys: ok([dark]),
      admin_plan_orgs: ok(ORGS),
      admin_gating_preview: ok({ would_lose: 1, organisations: [] }),
    });
    await flush();
    expect(host.querySelector('h3').textContent).toBe('One open event at a time');
    await click('Preview turning it on');
    expect(text()).toContain(
      'If you turned this on now, 1 organisation would be held to the limit.',
    );
    await click('Turn on');
    expect(text()).toContain('1 organisation would be held to the limit today.');
    handle.unmount();
    host.remove();
    mount({
      admin_list_keys: ok([dark]),
      admin_plan_orgs: ok(ORGS),
      admin_gating_preview: ok({ would_lose: 0, organisations: [] }),
    });
    await flush();
    await click('Preview turning it on');
    expect(text()).toContain('If you turned this on now, nobody would lose anything.');
  });

  it('a key this console has no name for is still drawn, by its id', async () => {
    mount({
      admin_list_keys: ok([keyRow({ key: 'a_new_key', note: null })]),
      admin_plan_orgs: ok(ORGS),
    });
    await flush();
    expect(host.querySelector('h3').textContent).toBe('a_new_key');
    expect(host.querySelector('.adm-key-id')).toBeNull();
  });

  it('a stale count is refused by the database and said in words', async () => {
    mount(
      overview({
        admin_gating_preview: ok({ would_lose: 1, organisations: [] }),
        admin_set_key_enforced: refused('confirm_mismatch'),
      }),
    );
    await flush();
    await click('Preview turning it on');
    await click('Turn on');
    await click('Turn on');
    expect(text()).toContain('changed since the preview');
  });

  it('turning an enforced key off is one confirmed step with no count', async () => {
    mount(overview({ admin_set_key_enforced: ok(null) }));
    await flush();
    await click('Turn off');
    expect(calls('admin_set_key_enforced')).toHaveLength(0);
    await click('Turn off'); // the confirm button carries the same words
    expect(calls('admin_set_key_enforced')[0][1]).toEqual({
      p_key: 'cup_taster_participants',
      p_enforced: false,
      p_confirm: null,
    });
  });

  it('the buttons start their names with their visible words and say which key or plan they act on', async () => {
    mount(overview());
    await flush();
    const names = [...host.querySelectorAll('li.adm-key button')].map((b) => [
      b.textContent,
      b.getAttribute('aria-label'),
    ]);
    expect(names).toContainEqual([
      'Preview turning it on',
      'Preview turning it on: Barista Team Championship (BTC) events',
    ]);
    expect(names).toContainEqual(['Turn off', 'Turn off: Participants per Cup Taster event']);
    for (const [visible, name] of names) expect(name.startsWith(visible)).toBe(true);
  });

  it('a preview with no count never offers to turn the key on (the UI invents no number)', async () => {
    mount(
      overview({
        admin_gating_preview: ok({ organisations: [] }),
        admin_set_key_enforced: ok(null),
      }),
    );
    await flush();
    await click('Preview turning it on');
    expect(button('Turn on')).toBeUndefined();
    expect(calls('admin_set_key_enforced')).toHaveLength(0);
    expect(text()).toContain('Something went wrong');
  });

  it('a confirm is taken once: a double click on Turn off or Revoke sends one request', async () => {
    let resolve;
    mount({
      ...overview(),
      admin_set_key_enforced: () => new Promise((r) => (resolve = r)),
    });
    await flush();
    await click('Turn off');
    const confirm = button('Turn off');
    confirm.click();
    confirm.click();
    await flush();
    expect(calls('admin_set_key_enforced')).toHaveLength(1);
    resolve(ok(null));
  });

  it('a failed list says so and offers Retry', async () => {
    mount({ admin_list_keys: refused('boom'), admin_plan_orgs: refused('boom') });
    await flush();
    expect(text()).toContain('Something went wrong');
    expect(button('Retry')).toBeDefined();
  });

  it('a gate refusal draws nothing of its own', async () => {
    mount({
      admin_list_keys: refused('admin_mfa_required'),
      admin_plan_orgs: refused('admin_mfa_required'),
    });
    await flush();
    expect(host.textContent).toBe('');
  });
});

describe('one organisation', () => {
  beforeEach(() => {
    window.location.hash = `#/plan/${ORG}`;
  });

  it('draws the plan now, the grants with source and Brunei time, the events, and the keys', async () => {
    mount({ admin_plan_org: ok(PLAN) });
    await flush();
    expect(calls('admin_plan_org')[0][1]).toEqual({ p_org_id: ORG });
    expect(host.querySelector('h1').textContent).toBe('Plan: Alpha Roasters');
    expect(text()).toContain('Payment confirmed');
    expect(text()).toContain('2026-12-08 00:00 to 2026-12-13 00:00 Brunei time');
    expect(text()).toContain('Revoked');
    expect(host.querySelector('.adm-badge--revoked').textContent).toBe('Revoked');
    expect(text()).toContain('Note: BND 18 cash');
    expect(text()).toContain('by 99999999');
    expect(text()).toContain('cup_taster · 2026-12-10 · 33333333');
    expect(text()).toContain('Finished by the organiser');
    expect(text()).toContain('Plan fixed when the event went live: Per-event');
    expect(text()).toContain('Cup Taster · 2026-12-10');
    expect(text()).not.toContain('frozen');
    const rows = [...host.querySelectorAll('.adm-members li')].map((li) => li.textContent);
    expect(rows.find((r) => r.startsWith('Barista Team Championship (BTC) events'))).toContain(
      'Would be blocked once this is on',
    );
    const events = rows.find((r) => r.startsWith('One open event at a time'));
    expect(events).toContain('Allowed once this is on');
    expect(events).toContain('limit 1');
    // a key that is already on says what is happening now, not what would
    const report = rows.find((r) => r.startsWith('Cup Taster report and CSV export'));
    expect(report).toContain('On');
    expect(report).toContain('Blocked');
    expect(report).not.toContain('once this is on');
    expect(rows.find((r) => r.startsWith('Cup Taster analytics'))).toContain('Allowed');
  });

  it('marks a test event with the dedicated test badge', async () => {
    const withTestEvent = structuredClone(PLAN);
    withTestEvent.events[0].is_test = true;
    mount({ admin_plan_org: ok(withTestEvent) });
    await flush();
    expect(host.querySelector('.adm-badge--test').textContent).toBe('Test event');
  });

  it('draws only the fields it names (a field the function started returning later does not appear)', async () => {
    const leaky = structuredClone(PLAN);
    leaky.events[0].entry_names = ['SECRET-CUPPER'];
    leaky.events[0].name = 'SECRET-EVENT-NAME';
    leaky.grants[0].email = 'secret@example.test';
    mount({ admin_plan_org: ok(leaky) });
    await flush();
    expect(text()).not.toContain('SECRET');
    expect(text()).not.toContain('secret@example.test');
  });

  it('a gate refusal on the organisation page draws nothing, whichever refusal it is', async () => {
    for (const hint of ['admin_required', 'admin_session_ended', 'admin_mfa_required']) {
      mount({ admin_plan_org: refused(hint) });
      await flush();
      expect(host.textContent).toBe('');
      handle.unmount();
      host.remove();
    }
  });

  it('a gate refusal from a form draws nothing either', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_event_release: refused('admin_session_ended') });
    await flush();
    const d = open('Release this event…');
    d.querySelector('input').value = 'x';
    await submitForm(d.querySelector('form'));
    expect(host.textContent).toBe('');
  });

  it('an unknown organisation says so without a Retry', async () => {
    mount({ admin_plan_org: refused('org_not_found') });
    await flush();
    expect(text()).toContain('That organisation no longer exists');
    expect(button('Retry')).toBeUndefined();
  });

  it('a Per-event plan for an event sends the chosen offset', async () => {
    mount({
      admin_plan_org: ok(PLAN),
      admin_grant_create: ok('g'),
      admin_payment_confirm: ok('g'),
    });
    await flush();
    const d = open('Per-event plan…');
    const select = d.querySelector('select');
    expect([...select.options].map((o) => o.textContent)).toContain(
      'T-2 to T+2 (2026-12-08 to 2026-12-12)',
    );
    select.value = '-3';
    await submitForm(d.querySelector('form'));
    expect(calls('admin_grant_create')[0][1]).toEqual({
      p_org_id: ORG,
      p_tier: 'per_event',
      p_event_id: EV_OPEN,
      p_start_offset_days: -3,
      p_valid_until: null,
      p_note: null,
    });
    expect(calls('admin_payment_confirm')).toHaveLength(0);
  });

  it('a payment note makes it a confirmed payment', async () => {
    mount({
      admin_plan_org: ok(PLAN),
      admin_grant_create: ok('g'),
      admin_payment_confirm: ok('g'),
    });
    await flush();
    const d = open('Per-event plan…');
    d.querySelector('input[id$="-payment"]').value = 'BND 18 received, ref 77';
    await submitForm(d.querySelector('form'));
    expect(calls('admin_grant_create')).toHaveLength(0);
    expect(calls('admin_payment_confirm')[0][1]).toEqual({
      p_org_id: ORG,
      p_tier: 'per_event',
      p_event_id: EV_OPEN,
      p_start_offset_days: -2,
      p_valid_until: null,
      p_amount_note: 'BND 18 received, ref 77',
    });
  });

  it('the organisation plan form sends the tier and an end at midnight Brunei time after the chosen day', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_grant_create: ok('g') });
    await flush();
    const form = [...host.querySelectorAll('form')].find(
      (f) => f.querySelector('input[type="date"]') && f.textContent.includes('Give the plan'),
    );
    form.querySelector('select').value = 'annual';
    form.querySelector('input[type="date"]').value = '2027-03-31';
    await submitForm(form);
    expect(calls('admin_grant_create')[0][1]).toEqual({
      p_org_id: ORG,
      p_tier: 'annual',
      p_event_id: null,
      p_start_offset_days: null,
      p_valid_until: '2027-04-01T00:00:00+08:00',
      p_note: null,
    });
  });

  it('extending needs a date and a reason, and sends them', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_grant_extend: ok('g') });
    await flush();
    const d = open('Extend…');
    const form = d.querySelector('form');
    await submitForm(form);
    expect(calls('admin_grant_extend')).toHaveLength(0);
    expect(d.textContent).toContain('Choose the new end date');
    form.querySelector('input[type="date"]').value = '2026-12-15';
    await submitForm(form);
    expect(d.textContent).toContain('Give a reason');
    form.querySelector('input[id$="-reason"]').value = 'venue postponed';
    await submitForm(form);
    expect(calls('admin_grant_extend')[0][1]).toEqual({
      p_grant_id: GRANT_A,
      p_new_valid_until: '2026-12-16T00:00:00+08:00',
      p_reason: 'venue postponed',
    });
  });

  it('an extension that ends on or before the current end is refused before it is sent', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_grant_extend: ok('g') });
    await flush();
    const d = open('Extend…');
    const form = d.querySelector('form');
    form.querySelector('input[type="date"]').value = '2026-12-12'; // ends 2026-12-13 00:00 Brunei = the current end
    form.querySelector('input[id$="-reason"]').value = 'why';
    await submitForm(form);
    expect(calls('admin_grant_extend')).toHaveLength(0);
    expect(d.textContent).toContain('The new end must be later than the current end.');
  });

  it('says when only the newest events are listed', async () => {
    mount({ admin_plan_org: ok({ ...PLAN, events_total: 350 }) });
    await flush();
    expect(text()).toContain('Showing the newest 2 of 350 events.');
  });

  it('a write still out when the person moves on does not leave the page locked', async () => {
    let resolve;
    mount({
      ...overview(),
      admin_plan_org: ok(PLAN),
      admin_event_release: () => new Promise((r) => (resolve = r)),
    });
    await flush();
    const d = open('Release this event…');
    d.querySelector('input').value = 'x';
    await submitForm(d.querySelector('form'));
    await goto('#/plan');
    await goto(`#/plan/${ORG}`);
    resolve(ok(null)); // the first answer arrives for a form that is gone
    await flush();
    const again = open('Release this event…');
    again.querySelector('input').value = 'y';
    await submitForm(again.querySelector('form'));
    expect(calls('admin_event_release')).toHaveLength(2);
  });

  it('a revoked plan offers no actions; a live one offers revoke after a question', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_grant_revoke: ok(null) });
    await flush();
    expect(host.querySelectorAll('button[aria-label^="Revoke:"]')).toHaveLength(1);
    await click('Revoke');
    expect(calls('admin_grant_revoke')).toHaveLength(0);
    expect(text()).toContain('Revoke this Per-event plan?');
    await click('Revoke');
    expect(calls('admin_grant_revoke')[0][1]).toEqual({ p_grant_id: GRANT_A, p_note: null });
  });

  it('releasing an open event and raising an event’s plan each need a reason', async () => {
    mount({
      admin_plan_org: ok(PLAN),
      admin_event_release: ok(null),
      admin_event_resnapshot: ok(null),
    });
    await flush();
    const release = open('Release this event…');
    await submitForm(release.querySelector('form'));
    expect(calls('admin_event_release')).toHaveLength(0);
    release.querySelector('input').value = 'organiser lost their login';
    await submitForm(release.querySelector('form'));
    expect(calls('admin_event_release')[0][1]).toEqual({
      p_event_id: EV_OPEN,
      p_reason: 'organiser lost their login',
    });
  });

  it('raising an event’s plan sends the reason', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_event_resnapshot: ok(null) });
    await flush();
    const raise = open('Raise this event’s plan…');
    raise.querySelector('input').value = 'annual bought after go-live';
    await submitForm(raise.querySelector('form'));
    expect(calls('admin_event_resnapshot')[0][1]).toEqual({
      p_event_id: EV_DONE,
      p_reason: 'annual bought after go-live',
    });
  });

  it('only an open event can be released and only an event without a plan gets the Per-event form', async () => {
    mount({ admin_plan_org: ok(PLAN) });
    await flush();
    const summaries = [...host.querySelectorAll('summary')].map((s) => s.textContent);
    expect(summaries.filter((s) => s === 'Release this event…')).toHaveLength(1);
    expect(summaries.filter((s) => s === 'Per-event plan…')).toHaveLength(1);
  });

  it('shows the database refusal in words, and a hint it has no words for as "could not confirm"', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_event_release: refused('reason_required') });
    await flush();
    const d = open('Release this event…');
    d.querySelector('input').value = 'x';
    await submitForm(d.querySelector('form'));
    expect(d.textContent).toContain('Give a reason. It is logged.');
    handle.unmount();
    host.remove();
    mount({ admin_plan_org: ok(PLAN), admin_event_release: refused('who_knows') });
    await flush();
    const d2 = open('Release this event…');
    d2.querySelector('input').value = 'x';
    await submitForm(d2.querySelector('form'));
    expect(d2.textContent).toContain('could not confirm whether the change was made');
  });

  it('a form is taken once: a second submit while the first is out sends nothing', async () => {
    let resolve;
    mount({
      admin_plan_org: ok(PLAN),
      admin_event_release: () => new Promise((r) => (resolve = r)),
    });
    await flush();
    const d = open('Release this event…');
    d.querySelector('input').value = 'x';
    const form = d.querySelector('form');
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(calls('admin_event_release')).toHaveLength(1);
    resolve(ok(null));
  });

  it('after a change the page is drawn again from the database with a notice', async () => {
    mount({ admin_plan_org: ok(PLAN), admin_event_release: ok(null) });
    await flush();
    const d = open('Release this event…');
    d.querySelector('input').value = 'stuck';
    await submitForm(d.querySelector('form'));
    expect(calls('admin_plan_org')).toHaveLength(2);
    expect(text()).toContain('was released.');
  });

  it('moves between the overview and an organisation by the hash', async () => {
    mount({ ...overview(), admin_plan_org: ok(PLAN) });
    await goto('#/plan');
    expect(host.querySelector('h1').textContent).toBe('Plans and keys');
    await goto(`#/plan/${ORG}`);
    expect(host.querySelector('h1').textContent).toBe('Plan: Alpha Roasters');
    await goto('#/plan/not-an-id');
    expect(host.querySelector('h1').textContent).toBe('Organisation not found');
  });
});
