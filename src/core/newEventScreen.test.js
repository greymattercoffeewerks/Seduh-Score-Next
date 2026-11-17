import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  blankDraft,
  validateDraft,
  renderNewEventForm,
  mountNewEventScreen,
  newEventHeading,
} from './newEventScreen.js';

const FORMATS = [
  {
    value: 'cup_taster',
    label: 'Cup Taster',
    kind: 'Individual · timed',
    description: 'Find the odd cup.',
  },
  { value: 'btc', label: 'BTC', kind: 'Teams', description: 'A team championship.' },
  { value: 'throwdown', label: 'Throwdown', description: 'Head to head.' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A client that records inserts, honours a held insert (to model a create still in flight) and can refuse it.
function fakeClient({ insertResult } = {}) {
  const calls = [];
  let gate = null;
  return {
    calls,
    holdInserts(promise) {
      gate = promise;
    },
    from(table) {
      return {
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          const inserted = { id: 'ev-new', ...payload };
          return {
            select: () => ({
              single: async () => {
                if (gate) await gate;
                return insertResult ?? { data: inserted, error: null };
              },
            }),
          };
        },
      };
    },
  };
}

const mounted = [];
function mountScreen(extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  const client = extra.client ?? fakeClient();
  const onCreated = vi.fn();
  const screen = mountNewEventScreen(root, {
    orgId: 'org1',
    orgName: 'Alpha Coffee',
    client,
    defaultFormat: 'cup_taster',
    formatOptions: FORMATS,
    onCreated,
    ...extra,
  });
  return { root, client, onCreated, screen };
}
afterEach(() => {
  for (const root of mounted.splice(0)) root.remove();
});

function typeName(root, name) {
  const field = root.querySelector('[data-field="name"]');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function choose(root, value) {
  const radio = root.querySelector(`input[data-field="format"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('validateDraft', () => {
  it('requires a non-blank name', () => {
    expect(validateDraft(blankDraft())).toBe('Name is required.');
    expect(validateDraft({ ...blankDraft(), name: '  ' })).toBe('Name is required.');
  });

  it('is satisfied by a name alone — date/venue/isTest are all optional', () => {
    expect(validateDraft({ ...blankDraft(), name: 'October Cup' })).toBeNull();
  });
});

describe('newEventHeading', () => {
  it('names the organisation, and reads plainly without one', () => {
    expect(newEventHeading('Alpha Coffee')).toBe('New event in Alpha Coffee');
    for (const none of [null, undefined, '', '   '])
      expect(newEventHeading(none)).toBe('New event');
  });
});

describe('renderNewEventForm', () => {
  it('the visible label text for date/venue/city matches their own aria-label — both say "(optional)", so a sighted user and a screen-reader user get the same information', () => {
    const form = renderNewEventForm(blankDraft('cup_taster'), { disabled: false });
    const labels = [...form.querySelectorAll('.form-field-label')].map((node) => node.textContent);
    for (const [field, words] of [
      ['eventDate', 'Event date (optional)'],
      ['venue', 'Venue (optional)'],
      ['city', 'City (optional)'],
    ]) {
      expect(labels).toContain(words);
      expect(form.querySelector(`[data-field="${field}"]`).getAttribute('aria-label')).toBe(words);
    }
  });

  it('typing into the City field updates the draft, same as Venue', () => {
    const draft = blankDraft('cup_taster');
    const form = renderNewEventForm(draft, { disabled: false });
    const cityInput = form.querySelector('[data-field="city"]');
    cityInput.value = 'Bandar Seri Begawan';
    cityInput.dispatchEvent(new Event('input'));
    expect(draft.city).toBe('Bandar Seri Begawan');
  });

  it('draws the formats as radio cards with their description, only when more than one is configured', () => {
    const many = renderNewEventForm(blankDraft('cup_taster'), {
      disabled: false,
      formatOptions: FORMATS,
    });
    const radios = [...many.querySelectorAll('input[type="radio"][data-field="format"]')];
    expect(radios.map((r) => r.value)).toEqual(['cup_taster', 'btc', 'throwdown']);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
    expect(many.textContent).toContain('A team championship.');
    expect(many.querySelector('select')).toBeNull();
    expect(many.querySelector('fieldset legend').textContent).toContain('Format');

    for (const formatOptions of [undefined, [], [FORMATS[0]]]) {
      const form = renderNewEventForm(blankDraft('cup_taster'), { disabled: false, formatOptions });
      expect(form.querySelector('[data-field="format"]')).toBeNull();
    }
  });

  it('marks only the chosen card as selected, with a check that is not colour alone (the shared .is-selected)', () => {
    const form = renderNewEventForm(blankDraft('btc'), { disabled: false, formatOptions: FORMATS });
    const selected = [...form.querySelectorAll('.events-format-card.is-selected')];
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('BTC');
    choose(form, 'throwdown');
    expect(
      [...form.querySelectorAll('.events-format-card.is-selected')].map((c) => c.textContent),
    ).toEqual([expect.stringContaining('Throwdown')]);
  });

  it('names the chosen format on the submit button, and the test checkbox starts unchecked with its hint linked (D9)', () => {
    const form = renderNewEventForm(blankDraft('cup_taster'), {
      disabled: false,
      formatOptions: FORMATS,
    });
    const submitButton = form.querySelector('button[type="submit"]');
    expect(submitButton.textContent).toBe('Create Cup Taster event');
    choose(form, 'btc');
    expect(submitButton.textContent).toBe('Create BTC event');
    const test = form.querySelector('[data-field="isTest"]');
    expect(test.checked).toBe(false);
    expect(form.querySelector(`#${test.getAttribute('aria-describedby')}`).textContent).toContain(
      'TEST banner',
    );
    expect(form.querySelector('.events-test-field')).not.toBeNull();
  });

  it('disables every control and says Creating… while a create is in flight', () => {
    const form = renderNewEventForm(blankDraft('cup_taster'), {
      disabled: true,
      formatOptions: FORMATS,
    });
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Creating…');
    for (const control of form.querySelectorAll('input, button[type="submit"]')) {
      expect(control.disabled, control.outerHTML).toBe(true);
    }
  });

  it('offers Cancel back to the events home', () => {
    const form = renderNewEventForm(blankDraft('cup_taster'), {
      disabled: false,
      eventsHref: '#/events',
    });
    const cancel = [...form.querySelectorAll('a')].find((a) => a.textContent === 'Cancel');
    expect(cancel.getAttribute('href')).toBe('#/events');
  });
});

describe('mountNewEventScreen', () => {
  it('names the organisation in its heading, labels the form with it, and links back to Events', async () => {
    const { root, screen } = mountScreen();
    await screen;
    const heading = root.querySelector('h1');
    expect(heading.textContent).toBe('New event in Alpha Coffee');
    const form = root.querySelector('form');
    expect(form.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(root.querySelector('.events-breadcrumb a').getAttribute('href')).toBe('#/events');
  });

  it('writes the organisation name as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { root, screen } = mountScreen({ orgName: hostile });
    await screen;
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('h1').textContent).toBe(`New event in ${hostile}`);
  });

  it('creates through core/events.js in the mounted organisation, as the SELECTED format, then hands the event on', async () => {
    const { root, client, onCreated } = mountScreen({ orgId: 'org2' });
    typeName(root, '  Regional Bracket ');
    choose(root, 'btc');
    root.querySelector('[data-field="venue"]').value = ' The Roastery ';
    root.querySelector('[data-field="venue"]').dispatchEvent(new Event('input', { bubbles: true }));
    submit(root);
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const insert = client.calls.find(([kind]) => kind === 'insert');
    expect(insert[2]).toMatchObject({
      org_id: 'org2',
      format: 'btc',
      name: 'Regional Bracket',
      venue: 'The Roastery',
      city: null,
      event_date: null,
      is_test: false,
    });
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'ev-new', name: 'Regional Bracket' });
  });

  it('never hardcodes a format — with one format, or none given, the create uses whatever defaultFormat was passed in', async () => {
    for (const formatOptions of [undefined, [{ value: 'guess_the_bean', label: 'Guess' }]]) {
      const { root, client, onCreated } = mountScreen({
        defaultFormat: 'guess_the_bean',
        formatOptions,
      });
      expect(root.querySelector('[data-field="format"]')).toBeNull();
      typeName(root, 'Booth Night');
      submit(root);
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
      expect(client.calls.find(([kind]) => kind === 'insert')[2].format).toBe('guess_the_bean');
    }
  });

  it('creates test data only when the checkbox was ticked (D9)', async () => {
    const { root, client, onCreated } = mountScreen();
    typeName(root, 'Rehearsal');
    const box = root.querySelector('[data-field="isTest"]');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    submit(root);
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(client.calls.find(([kind]) => kind === 'insert')[2].is_test).toBe(true);
  });

  it('rejects a blank name without ever calling the client, in the focused feedback region', async () => {
    const { root, client, onCreated } = mountScreen();
    submit(root);
    await tick();
    expect(client.calls).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toBe('Name is required.');
    expect(document.activeElement).toBe(feedback);
  });

  it('shows the open-event refusal in the focused live feedback panel, keeping what was typed', async () => {
    const { root, onCreated } = mountScreen({
      client: fakeClient({
        insertResult: {
          data: null,
          error: { code: '42501', hint: 'entitlement_cap_reached', details: 'events_open' },
        },
      }),
    });
    typeName(root, 'November Cup');
    submit(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.screen-feedback').textContent).toContain(
        'You already have an open event, and your plan allows one at a time. If it is a test event, delete it to make room.',
      ),
    );
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(feedback);
    expect(root.querySelector('[data-field="name"]').value).toBe('November Cup');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the format plan message in the same focused live feedback panel', async () => {
    const { root } = mountScreen({
      defaultFormat: 'btc',
      client: fakeClient({
        insertResult: {
          data: null,
          error: { code: '42501', hint: 'entitlement_required', details: 'btc_format' },
        },
      }),
    });
    typeName(root, 'November Brew Team Challenge');
    submit(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.screen-feedback').textContent).toContain(
        'This format needs a plan that includes it.',
      ),
    );
    expect(document.activeElement).toBe(root.querySelector('.screen-feedback'));
  });

  it('a second submit while a create is in flight sends one insert', async () => {
    const client = fakeClient();
    let release;
    client.holdInserts(new Promise((resolve) => (release = resolve)));
    const { root, onCreated } = mountScreen({ client });
    typeName(root, 'Once');
    submit(root);
    await tick();
    submit(root);
    await tick();
    release();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(client.calls.filter(([kind]) => kind === 'insert')).toHaveLength(1);
  });

  describe('a screen that has been superseded sends nothing', () => {
    it('a create submitted after the signal was aborted is not sent, and nothing is painted', async () => {
      const controller = new AbortController();
      const { root, client, onCreated } = mountScreen({ signal: controller.signal });
      typeName(root, 'Too Late');
      const before = root.innerHTML;
      controller.abort();
      submit(root);
      await tick();
      expect(client.calls).toEqual([]);
      expect(onCreated).not.toHaveBeenCalled();
      expect(root.innerHTML).toBe(before);
    });

    it('a create already in flight when the organisation changes is created where the person pressed Create, but does not navigate or paint over the new screen', async () => {
      const client = fakeClient();
      let release;
      client.holdInserts(new Promise((resolve) => (release = resolve)));
      const controller = new AbortController();
      const { root, onCreated } = mountScreen({ client, signal: controller.signal });
      typeName(root, 'Alpha Open');
      submit(root);
      await tick();
      controller.abort();
      root.innerHTML = '<p>the other organisation</p>';
      release();
      await tick();
      await tick();
      expect(client.calls.find(([kind]) => kind === 'insert')[2].org_id).toBe('org1');
      expect(onCreated).not.toHaveBeenCalled();
      expect(root.innerHTML).toBe('<p>the other organisation</p>');
    });
  });
});
