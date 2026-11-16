// My Seduh ID: every state and every form, driven by a fake api. No network, no Supabase.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountMeScreen } from './meScreen.js';
import { SETTINGS, describeMeHint, normaliseMyRecord } from './meFlow.js';

afterEach(() => {
  document.body.replaceChildren();
});

const rawRecord = (over = {}) => ({
  account: {
    handle: 'mine',
    founding_number: 1,
    display_name: 'Test Person',
    country_code: 'BN',
    email: 'secret.person@example.test',
    phone_e164: '+6737777777',
  },
  settings: {
    vis_identity: 'public',
    vis_recorded_results: 'public',
    vis_organiser_results: 'public',
    vis_self_reported_results: 'public',
    vis_judging_roles: 'public',
    vis_cafe_affiliations: 'public',
    vis_knockout_record: 'public',
    listed_on_country_pages: false,
  },
  entries: [
    {
      id: 1,
      year: 2025,
      competition_name: 'Regional Open',
      kind: 'competed',
      location: 'Bandar',
      role: 'Competitor',
      result_text: '2nd',
      placement: 2,
      note: 'Good day',
    },
    { id: 2, year: 2024, competition_name: 'Judges Cup', kind: 'judged' },
    { id: 3, year: 2024, competition_name: 'Another', kind: 'organised' },
  ],
  team_links: [
    {
      id: 11,
      team_key: 'k1',
      team_name: 'Bean Bandits',
      country_code: 'BN',
      competition_name: 'Championship 2024',
      edition_year: 2024,
      stage_reached: 'semi_final',
      placement: 4,
      role: 'member',
      membership: 'self_reported',
      listed: true,
    },
  ],
  ...over,
});

const ok = (data) => ({ ok: true, data });
function fakeApi(over = {}) {
  const state = { raw: rawRecord(), session: true };
  const api = {
    hasSession: vi.fn(async () => state.session),
    requestCode: vi.fn(async () => ({ ok: true })),
    verifyCode: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => {
      state.session = false;
    }),
    loadRecord: vi.fn(async () => ({ ok: true, record: normaliseMyRecord(state.raw) })),
    addEntry: vi.fn(async () => ok({ id: 99 })),
    updateEntry: vi.fn(async () => ok({ id: 1 })),
    deleteEntry: vi.fn(async () => ok(null)),
    teamOptions: vi.fn(async () => ({
      ok: true,
      options: {
        truncated: false,
        teams: [
          {
            team_key: 'k2',
            team_name: 'Kopi Crew',
            country_code: 'BN',
            competition_name: 'Championship 2025',
            edition_year: 2025,
            stage_reached: 'quarter_final',
            placement: null,
            linked: false,
          },
          {
            team_key: 'k1',
            team_name: 'Bean Bandits',
            country_code: 'BN',
            competition_name: 'Championship 2024',
            edition_year: 2024,
            stage_reached: 'semi_final',
            placement: 4,
            linked: true,
          },
        ],
      },
    })),
    addTeamLink: vi.fn(async () => ok({ id: 12 })),
    removeTeamLink: vi.fn(async () => ok(null)),
    setSettings: vi.fn(async (s) => ok({ ...state.raw.settings, ...s })),
    ...over,
  };
  return { api, state };
}

async function mount(over, { signedIn = true } = {}) {
  const { api, state } = fakeApi(over);
  state.session = signedIn;
  const root = document.createElement('div');
  document.body.append(root);
  mountMeScreen(root, { api, thisYear: 2026 });
  await settle();
  return { root, api, state };
}
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const text = (root) => root.textContent.replace(/\s+/g, ' ');
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const byText = (root, selector, label) =>
  [...root.querySelectorAll(selector)].find((n) => n.textContent === label);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (form) =>
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
async function tab(root, label) {
  click(byText(root, '.me-tab', label));
  await settle();
}

describe('signed out', () => {
  it('a visit with no session shows the email step and calls no door', async () => {
    const { root, api } = await mount({}, { signedIn: false });
    expect(root.querySelector('h1').textContent).toBe('My Seduh ID');
    expect(root.querySelector('input[type="email"]')).not.toBeNull();
    expect(api.loadRecord).not.toHaveBeenCalled();
  });

  it('a bad email is refused in words before anything is sent', async () => {
    const { root, api } = await mount({}, { signedIn: false });
    type(root.querySelector('#me-email'), 'nope');
    submit(root.querySelector('form'));
    await settle();
    expect(text(root)).toContain('Enter a valid email address');
    expect(root.querySelector('#me-email').getAttribute('aria-invalid')).toBe('true');
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it('after asking for a code it says only "if that email has a Seduh ID", whatever the answer was', async () => {
    const { root, api } = await mount({}, { signedIn: false });
    type(root.querySelector('#me-email'), ' Someone@Example.test ');
    submit(root.querySelector('form'));
    await settle();
    expect(api.requestCode).toHaveBeenCalledWith('someone@example.test');
    expect(text(root)).toContain(
      'If that email has a Seduh ID, we sent a code to someone@example.test',
    );
    expect(text(root)).not.toMatch(/no seduh id|not found|does not exist/i);
  });

  it('a connection failure is said, and the person stays on the email step', async () => {
    const { root } = await mount(
      { requestCode: vi.fn(async () => ({ ok: false, hint: 'offline' })) },
      { signedIn: false },
    );
    type(root.querySelector('#me-email'), 'a@example.test');
    submit(root.querySelector('form'));
    await settle();
    expect(text(root)).toContain(describeMeHint('offline'));
    expect(root.querySelector('#me-email')).not.toBeNull();
  });

  async function toCodeStep(over) {
    const m = await mount(over, { signedIn: false });
    type(m.root.querySelector('#me-email'), 'a@example.test');
    submit(m.root.querySelector('form'));
    await settle();
    return m;
  }

  it('a code that is not six digits is refused; a wrong code is said; a good code signs in', async () => {
    const m = await toCodeStep({
      verifyCode: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, hint: 'otp_invalid' })
        .mockResolvedValue({ ok: true }),
    });
    const { root, api } = m;
    type(root.querySelector('#me-code'), '12');
    submit(root.querySelector('form'));
    await settle();
    expect(text(root)).toContain('Enter the 6 digits');
    expect(api.verifyCode).not.toHaveBeenCalled();
    type(root.querySelector('#me-code'), '123 456');
    submit(root.querySelector('form'));
    await settle();
    expect(api.verifyCode).toHaveBeenCalledWith('a@example.test', '123456');
    expect(text(root)).toContain('not right, or it has expired');
    submit(root.querySelector('form'));
    await settle();
    expect(root.querySelector('h1').textContent).toBe('Test Person');
  });

  it('a login with no Seduh ID is told so, in words, at the email step, and its session is dropped', async () => {
    const m = await toCodeStep({
      loadRecord: vi.fn(async () => ({ ok: false, hint: 'no_account' })),
    });
    type(m.root.querySelector('#me-code'), '123456');
    submit(m.root.querySelector('form'));
    await settle();
    expect(m.api.signOut).toHaveBeenCalled();
    expect(text(m.root)).toContain('This sign-in has no Seduh ID');
    expect(m.root.querySelector('#me-email')).not.toBeNull();
  });
});

describe('signed in: the header', () => {
  it('shows the name, the founding number, a link to the public page and a way to sign out', async () => {
    const { root, api } = await mount();
    expect(root.querySelector('h1').textContent).toBe('Test Person');
    expect(text(root)).toContain('#0001');
    expect(root.querySelector('#me-public-link').getAttribute('href')).toBe('/id/mine/');
    click(root.querySelector('#me-signout'));
    await settle();
    expect(api.signOut).toHaveBeenCalled();
    expect(root.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('a failed first read is an alert with Try again; an ended session returns to sign-in', async () => {
    const failing = await mount({
      loadRecord: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, hint: 'offline' })
        .mockResolvedValue({ ok: true, record: normaliseMyRecord(rawRecord()) }),
    });
    expect(failing.root.querySelector('[role="alert"]').textContent).toContain(
      describeMeHint('offline'),
    );
    click(byText(failing.root, 'button', 'Try again'));
    await settle();
    expect(failing.root.querySelector('h1').textContent).toBe('Test Person');
    const ended = await mount({
      loadRecord: vi.fn(async () => ({ ok: false, hint: 'signed_out' })),
    });
    expect(ended.root.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('has three sections and marks the current one', async () => {
    const { root } = await mount();
    const tabs = [...root.querySelectorAll('.me-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['My record', 'My teams', 'Privacy']);
    expect(tabs[0].getAttribute('aria-current')).toBe('true');
    await tab(root, 'Privacy');
    expect(root.querySelectorAll('.me-tab[aria-current="true"]')).toHaveLength(1);
    expect(byText(root, '.me-tab', 'Privacy').getAttribute('aria-current')).toBe('true');
  });
});

describe('my record', () => {
  it('lists entries by year, newest year open, with the count against the limit', async () => {
    const { root } = await mount();
    expect(text(root)).toContain('3 of 200 entries');
    const years = [...root.querySelectorAll('details.profile-year')];
    expect(years.map((y) => y.querySelector('h3').textContent)).toEqual(['2025', '2024']);
    expect(years[0].open).toBe(true);
    expect(years[1].open).toBe(false);
    expect(text(root)).toContain('Regional Open');
    expect(text(root)).toContain('Competitor · 2nd · place 2');
  });

  it('says the record is empty, and offers to add', async () => {
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({
        ok: true,
        record: normaliseMyRecord(rawRecord({ entries: [] })),
      })),
    });
    expect(text(root)).toContain('You have not added any entries yet');
    expect(root.querySelector('#me-add-entry').disabled).toBe(false);
  });

  it('adding refuses a bad form in words beside each field and sends nothing', async () => {
    const { root, api } = await mount();
    click(root.querySelector('#me-add-entry'));
    const form = root.querySelector('.me-entry-form');
    expect(form.querySelectorAll('input, select, textarea').length).toBe(8);
    type(form.querySelector('[name="year"]'), '1900');
    submit(form);
    await settle();
    expect(api.addEntry).not.toHaveBeenCalled();
    expect(text(form)).toContain('Enter a year from 1980 to this year');
    expect(text(form)).toContain("Enter the competition's name");
    expect(form.querySelector('[name="year"]').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(form.querySelector('[name="year"]'));
  });

  it('adding sends every field, then reloads the record and announces it', async () => {
    const { root, api, state } = await mount();
    click(root.querySelector('#me-add-entry'));
    const form = root.querySelector('.me-entry-form');
    type(form.querySelector('[name="year"]'), '2026');
    type(form.querySelector('[name="competition_name"]'), 'New Cup');
    form.querySelector('[name="kind"]').value = 'coached';
    type(form.querySelector('[name="location"]'), 'Kuala Belait');
    type(form.querySelector('[name="role"]'), 'coach');
    type(form.querySelector('[name="result_text"]'), 'Team won');
    type(form.querySelector('[name="placement"]'), '1');
    type(form.querySelector('[name="note"]'), 'a note');
    state.raw.entries = [
      ...state.raw.entries,
      { id: 50, year: 2026, competition_name: 'New Cup', kind: 'coached' },
    ];
    submit(form);
    await settle();
    expect(api.addEntry).toHaveBeenCalledWith({
      p_year: 2026,
      p_competition_name: 'New Cup',
      p_kind: 'coached',
      p_location: 'Kuala Belait',
      p_role: 'coach',
      p_result_text: 'Team won',
      p_placement: 1,
      p_note: 'a note',
    });
    expect(root.querySelector('#me-status').textContent).toBe('Entry added.');
    expect(text(root)).toContain('4 of 200 entries');
    expect(text(root)).toContain('New Cup');
    expect(root.querySelector('.me-entry-form')).toBeNull();
  });

  it('a refusal from the database is shown in words on its field and in the live region; the form stays', async () => {
    const { root } = await mount({
      addEntry: vi.fn(async () => ({ ok: false, hint: 'bad_note' })),
    });
    click(root.querySelector('#me-add-entry'));
    const form = root.querySelector('.me-entry-form');
    type(form.querySelector('[name="year"]'), '2025');
    type(form.querySelector('[name="competition_name"]'), 'Cup');
    submit(form);
    await settle();
    expect(root.querySelector('.me-entry-form')).not.toBeNull();
    expect(text(form)).toContain(describeMeHint('bad_note'));
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('bad_note'));
    expect(root.querySelector('#me-status').dataset.tone).toBe('error');
    expect(form.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('the limit: the button is disabled at 200 entries and says why', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      year: 2020 + (i % 5),
      competition_name: `E${i}`,
      kind: 'competed',
    }));
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({
        ok: true,
        record: normaliseMyRecord(rawRecord({ entries })),
      })),
    });
    expect(text(root)).toContain('200 of 200 entries');
    expect(root.querySelector('#me-add-entry').disabled).toBe(true);
    expect(text(root)).toContain(describeMeHint('too_many_entries'));
  });

  it('editing shows the current values, sends a FULL replace with the entry id, and returns to the list', async () => {
    const { root, api } = await mount();
    click(root.querySelector('button[aria-label="Edit Regional Open"]'));
    const form = root.querySelector('.me-entry-form');
    expect(form.querySelector('[name="competition_name"]').value).toBe('Regional Open');
    expect(form.querySelector('[name="placement"]').value).toBe('2');
    type(form.querySelector('[name="note"]'), '');
    submit(form);
    await settle();
    expect(api.updateEntry).toHaveBeenCalledTimes(1);
    const [id, params] = api.updateEntry.mock.calls[0];
    expect(id).toBe(1);
    expect(params).toMatchObject({
      p_competition_name: 'Regional Open',
      p_note: null,
      p_placement: 2,
      p_year: 2025,
    });
    expect(root.querySelector('#me-status').textContent).toBe('Entry saved.');
  });

  it('cancelling an edit changes nothing and puts focus back on its Edit button', async () => {
    const { root, api } = await mount();
    click(root.querySelector('button[aria-label="Edit Regional Open"]'));
    click(byText(root, 'button', 'Cancel'));
    expect(api.updateEntry).not.toHaveBeenCalled();
    expect(document.activeElement.getAttribute('aria-label')).toBe('Edit Regional Open');
  });

  it('delete asks inside the page first; Keep it does nothing; Yes deletes that entry and reloads', async () => {
    const { root, api, state } = await mount();
    click(root.querySelector('button[aria-label="Delete Regional Open"]'));
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toContain(
      'Delete “Regional Open” (2025)? This cannot be undone.',
    );
    click(byText(root, 'button', 'Keep it'));
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(text(root)).toContain('Regional Open');
    click(root.querySelector('button[aria-label="Delete Regional Open"]'));
    state.raw.entries = state.raw.entries.filter((e) => e.id !== 1);
    click(byText(root, 'button', 'Yes, delete it'));
    await settle();
    expect(api.deleteEntry).toHaveBeenCalledWith(1);
    expect(root.querySelector('#me-status').textContent).toBe('Entry deleted.');
    expect(text(root)).not.toContain('Regional Open');
  });

  it('a refused delete says why and keeps the entry; an ended session returns to sign-in', async () => {
    const { root } = await mount({
      deleteEntry: vi.fn(async () => ({ ok: false, hint: 'not_found' })),
    });
    click(root.querySelector('button[aria-label="Delete Regional Open"]'));
    click(byText(root, 'button', 'Yes, delete it'));
    await settle();
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('not_found'));
    const gone = await mount({
      deleteEntry: vi.fn(async () => ({ ok: false, hint: 'signed_out' })),
    });
    click(gone.root.querySelector('button[aria-label="Delete Regional Open"]'));
    click(byText(gone.root, 'button', 'Yes, delete it'));
    await settle();
    expect(gone.root.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('shows a 60-entry record without a horizontal layout hazard: every row is text-only and grouped', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      year: 2019 + (i % 8),
      competition_name: `Entry ${i} ${'long '.repeat(10)}`,
      kind: 'competed',
    }));
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({
        ok: true,
        record: normaliseMyRecord(rawRecord({ entries })),
      })),
    });
    expect(root.querySelectorAll('.me-entry')).toHaveLength(60);
    expect(root.querySelectorAll('details.profile-year')).toHaveLength(8);
    expect(root.querySelectorAll('details[open]')).toHaveLength(1);
  });
});

describe('my teams', () => {
  it('lists my links with the status in words, and explains who can confirm', async () => {
    const { root } = await mount();
    await tab(root, 'My teams');
    expect(text(root)).toContain('1 of 40 team links');
    expect(text(root)).toContain('Bean Bandits (BN)');
    expect(text(root)).toContain('Member · 4th place');
    expect(text(root)).toContain('Membership self-reported');
    expect(text(root)).toContain('Only a teammate or Seduh Score can confirm it, not you');
  });

  it('a confirmed link says confirmed; an unlisted team result says it is off the public page', async () => {
    const links = [
      { id: 1, team_key: 'a', team_name: 'Alpha', membership: 'confirmed', listed: true },
      { id: 2, team_key: 'b', team_name: 'Beta', membership: 'self_reported', listed: false },
    ];
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({
        ok: true,
        record: normaliseMyRecord(rawRecord({ team_links: links })),
      })),
    });
    await tab(root, 'My teams');
    expect(text(root)).toContain('Membership confirmed');
    expect(text(root)).toContain('no longer listed');
  });

  it('asks the picker for Brunei by default and again when the country changes', async () => {
    const { root, api } = await mount();
    await tab(root, 'My teams');
    expect(api.teamOptions).toHaveBeenLastCalledWith('BN');
    const select = root.querySelector('#me-country');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.teamOptions).toHaveBeenLastCalledWith('');
  });

  it('keeps the chosen country after linking a team', async () => {
    const { root, api } = await mount();
    await tab(root, 'My teams');
    const select = root.querySelector('#me-country');
    select.value = 'MY';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    click(root.querySelector('.me-picker .me-entry button'));
    await settle();
    expect(root.querySelector('#me-country').value).toBe('MY');
    expect(api.teamOptions).toHaveBeenLastCalledWith('MY');
  });

  it('links a team with the chosen role; an already-linked team cannot be linked again', async () => {
    const { root, api } = await mount();
    await tab(root, 'My teams');
    const picker = root.querySelector('.me-picker');
    expect(text(picker)).toContain('Already linked');
    const row = [...picker.querySelectorAll('.me-entry')].find((r) =>
      r.textContent.includes('Kopi Crew'),
    );
    row.querySelector('select').value = 'captain';
    click(row.querySelector('button'));
    await settle();
    expect(api.addTeamLink).toHaveBeenCalledWith('k2', 'captain');
    expect(root.querySelector('#me-status').textContent).toContain(
      'self-reported until it is confirmed',
    );
  });

  it('says a refusal in words (already linked, too many) and keeps the page', async () => {
    const { root } = await mount({
      addTeamLink: vi.fn(async () => ({ ok: false, hint: 'already_linked' })),
    });
    await tab(root, 'My teams');
    click(root.querySelector('.me-picker .me-entry button'));
    await settle();
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('already_linked'));
  });

  it('removing asks first, then removes that link', async () => {
    const { root, api } = await mount();
    await tab(root, 'My teams');
    click(root.querySelector('button[aria-label^="Remove Bean Bandits"]'));
    expect(api.removeTeamLink).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toContain(
      'Remove your link to Bean Bandits (2024)?',
    );
    click(byText(root, 'button', 'Yes, remove it'));
    await settle();
    expect(api.removeTeamLink).toHaveBeenCalledWith(11);
    expect(root.querySelector('#me-status').textContent).toBe('Team link removed.');
  });

  it('an empty picker and a failed picker both say so', async () => {
    const empty = await mount({
      teamOptions: vi.fn(async () => ({ ok: true, options: { teams: [], truncated: false } })),
    });
    await tab(empty.root, 'My teams');
    expect(text(empty.root)).toContain('No team results for Brunei are available to link yet');
    const failed = await mount({
      teamOptions: vi.fn(async () => ({ ok: false, hint: 'offline' })),
    });
    await tab(failed.root, 'My teams');
    expect(failed.root.querySelector('.me-picker [role="alert"]').textContent).toBe(
      describeMeHint('offline'),
    );
  });
});

describe('privacy', () => {
  it('shows every setting of the door in plain words with its current value, and the country listing OFF by default', async () => {
    const { root } = await mount();
    await tab(root, 'Privacy');
    for (const s of SETTINGS) {
      expect(text(root), s.key).toContain(s.label);
      expect(root.querySelector(`input[name="${s.key}"]:checked`).value, s.key).toBe('public');
    }
    const listed = root.querySelector('#me-set-listed');
    expect(listed.checked).toBe(false);
    expect(text(root)).toContain('Show me on my country’s page');
    expect(text(root)).toContain('Off unless you switch it on');
    expect(text(root)).toContain('Hidden: your page still exists');
    expect(text(root)).toContain('Organisers do not have a view of it yet');
  });

  it('every control is labelled: each setting is a fieldset with a legend, each choice a label', async () => {
    const { root } = await mount();
    await tab(root, 'Privacy');
    expect(root.querySelectorAll('fieldset > legend')).toHaveLength(SETTINGS.length);
    for (const input of root.querySelectorAll('input'))
      expect(input.closest('label'), input.name).not.toBeNull();
  });

  it.each(
    SETTINGS.flatMap((s) =>
      s.choices.filter(([v]) => v !== 'public').map(([value, label]) => [s.key, value, label]),
    ),
  )('%s saves "%s" at once and says so', async (key, value, label) => {
    const { root, api } = await mount();
    await tab(root, 'Privacy');
    const radio = root.querySelector(`input[name="${key}"][value="${value}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.setSettings).toHaveBeenCalledTimes(1);
    expect(api.setSettings).toHaveBeenCalledWith({ [key]: value });
    expect(root.querySelector('#me-status').textContent).toContain(`${label}. Saved.`);
    // the new value survives switching section and back (it is the page's record now)
    await tab(root, 'My record');
    await tab(root, 'Privacy');
    expect(root.querySelector(`input[name="${key}"]:checked`).value).toBe(value);
  });

  it('the country listing switches on and off, each sent at once', async () => {
    const { root, api } = await mount();
    await tab(root, 'Privacy');
    const listed = root.querySelector('#me-set-listed');
    listed.checked = true;
    listed.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.setSettings).toHaveBeenLastCalledWith({ listed_on_country_pages: true });
    expect(root.querySelector('#me-status').textContent).toContain(
      'Show me on my country’s page: on. Saved.',
    );
    listed.checked = false;
    listed.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.setSettings).toHaveBeenLastCalledWith({ listed_on_country_pages: false });
    expect(root.querySelector('#me-status').textContent).toContain(': off. Saved.');
  });

  it('a failed save says so and puts the control back as it was', async () => {
    const { root } = await mount({
      setSettings: vi.fn(async () => ({ ok: false, hint: 'bad_setting' })),
    });
    await tab(root, 'Privacy');
    const radio = root.querySelector('input[name="vis_identity"][value="hidden"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('bad_setting'));
    expect(root.querySelector('input[name="vis_identity"]:checked').value).toBe('public');
    const listed = root.querySelector('#me-set-listed');
    listed.checked = true;
    listed.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(root.querySelector('#me-set-listed').checked).toBe(false);
  });

  it('never disables the control being changed (keyboard focus stays), and saves one after another, last choice winning', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = [];
    const { root } = await mount({
      setSettings: vi.fn(async (s) => {
        calls.push(s);
        if (calls.length === 1) await gate;
        return ok(s);
      }),
    });
    await tab(root, 'Privacy');
    const hidden = root.querySelector('input[name="vis_identity"][value="hidden"]');
    hidden.focus();
    hidden.checked = true;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(hidden.disabled).toBe(false);
    expect(document.activeElement).toBe(hidden);
    const pub = root.querySelector('input[name="vis_identity"][value="public"]');
    pub.checked = true;
    pub.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(calls).toHaveLength(1); // the second waits for the first
    release();
    await settle();
    expect(calls).toEqual([{ vis_identity: 'hidden' }, { vis_identity: 'public' }]);
  });

  it('a failed radio save puts the radio back in place, without a redraw and without moving focus', async () => {
    const { root } = await mount({
      setSettings: vi.fn(async () => ({ ok: false, hint: 'server_error' })),
    });
    await tab(root, 'Privacy');
    const hidden = root.querySelector('input[name="vis_identity"][value="hidden"]');
    hidden.focus();
    hidden.checked = true;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(root.querySelector('input[name="vis_identity"]:checked').value).toBe('public');
    expect(root.querySelector('input[name="vis_identity"][value="hidden"]')).toBe(hidden); // not rebuilt
    expect(document.activeElement).toBe(hidden); // focus is where the person put it
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('server_error'));
  });

  it('a failed save does not disturb an entry form the person has since started', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { root } = await mount({
      setSettings: vi.fn(async () => {
        await gate;
        return { ok: false, hint: 'server_error' };
      }),
    });
    await tab(root, 'Privacy');
    const hidden = root.querySelector('input[name="vis_identity"][value="hidden"]');
    hidden.checked = true;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    await tab(root, 'My record');
    click(root.querySelector('#me-add-entry'));
    type(root.querySelector('.me-entry-form [name="competition_name"]'), 'Half typed');
    release();
    await settle();
    expect(root.querySelector('.me-entry-form [name="competition_name"]').value).toBe('Half typed');
    expect(root.querySelector('#me-status').textContent).toBe(describeMeHint('server_error'));
  });

  it('two quick changes: the first refused, the second saved; the screen ends on the second, and the error is not overwritten while it waits', async () => {
    const results = [{ ok: false, hint: 'server_error' }];
    const calls = [];
    const { root } = await mount({
      setSettings: vi.fn(async (x) => {
        calls.push(x);
        return results.shift() ?? ok(x);
      }),
    });
    await tab(root, 'Privacy');
    const hidden = root.querySelector('input[name="vis_identity"][value="hidden"]');
    hidden.checked = true;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    const pub = root.querySelector('input[name="vis_identity"][value="public"]');
    pub.checked = true;
    pub.dispatchEvent(new Event('change', { bubbles: true }));
    const again = root.querySelector('input[name="vis_cafe_affiliations"][value="hidden"]');
    again.checked = true;
    again.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(calls).toEqual([
      { vis_identity: 'hidden' },
      { vis_identity: 'public' },
      { vis_cafe_affiliations: 'hidden' },
    ]);
    expect(root.querySelector('input[name="vis_identity"]:checked').value).toBe('public');
    expect(root.querySelector('input[name="vis_cafe_affiliations"]:checked').value).toBe('hidden');
    expect(root.querySelector('#me-status').textContent).toContain('Cafe links: Hidden. Saved.');
  });

  it('a refused first change while a second is waiting leaves the screen on the second, never on the old value', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    let n = 0;
    const { root } = await mount({
      setSettings: vi.fn(async (x) => {
        n += 1;
        if (n === 1) {
          await gate;
          return { ok: false, hint: 'server_error' };
        }
        return ok(x);
      }),
    });
    await tab(root, 'Privacy');
    const group = (v) => root.querySelector(`input[name="vis_judging_roles"][value="${v}"]`);
    group('hidden').checked = true;
    group('hidden').dispatchEvent(new Event('change', { bubbles: true }));
    group('organisers').checked = true;
    group('organisers').dispatchEvent(new Event('change', { bubbles: true }));
    release();
    await settle();
    expect(root.querySelector('input[name="vis_judging_roles"]:checked').value).toBe('organisers');
    expect(root.querySelector('#me-status').textContent).toContain('Saved.');
  });

  it('focus the person has moved to another control is not pulled back when a save finishes', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { root } = await mount({
      updateEntry: vi.fn(async () => {
        await gate;
        return { ok: false, hint: 'server_error' };
      }),
    });
    click(root.querySelector('button[aria-label="Edit Regional Open"]'));
    const form = root.querySelector('.me-entry-form');
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.focus();
    submit(form);
    await settle();
    const note = form.querySelector('[name="note"]');
    note.focus();
    release();
    await settle();
    expect(document.activeElement).toBe(note);
  });

  it('switching away and back while a save is pending shows the pending choice, and re-clicking the other one is saved too', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = [];
    const { root } = await mount({
      setSettings: vi.fn(async (x) => {
        calls.push(x);
        if (calls.length === 1) await gate;
        return ok(x);
      }),
    });
    await tab(root, 'Privacy');
    const radio = (v) => root.querySelector(`input[name="vis_identity"][value="${v}"]`);
    radio('hidden').checked = true;
    radio('hidden').dispatchEvent(new Event('change', { bubbles: true }));
    await tab(root, 'My record');
    await tab(root, 'Privacy');
    expect(radio('hidden').checked).toBe(true); // the pending choice, not the older record
    radio('public').checked = true;
    radio('public').dispatchEvent(new Event('change', { bubbles: true }));
    release();
    await settle();
    expect(calls).toEqual([{ vis_identity: 'hidden' }, { vis_identity: 'public' }]);
    expect(root.querySelector('input[name="vis_identity"]:checked').value).toBe('public');
  });

  it('a thrown save does not stop later saves', async () => {
    const calls = [];
    const { root } = await mount({
      setSettings: vi.fn(async (x) => {
        calls.push(x);
        if (calls.length === 1) throw new Error('boom');
        return ok(x);
      }),
    });
    await tab(root, 'Privacy');
    for (const v of ['hidden', 'public']) {
      const r = root.querySelector(`input[name="vis_identity"][value="${v}"]`);
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    }
    expect(calls).toHaveLength(2);
  });

  it('shows the current values from the record, not defaults', async () => {
    const raw = rawRecord();
    raw.settings.vis_knockout_record = 'hidden';
    raw.settings.vis_judging_roles = 'organisers';
    raw.settings.listed_on_country_pages = true;
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({ ok: true, record: normaliseMyRecord(raw) })),
    });
    await tab(root, 'Privacy');
    expect(root.querySelector('input[name="vis_knockout_record"]:checked').value).toBe('hidden');
    expect(root.querySelector('input[name="vis_judging_roles"]:checked').value).toBe('organisers');
    expect(root.querySelector('#me-set-listed').checked).toBe(true);
  });
});

describe('what the page never does', () => {
  it('draws text only: a name or competition with markup is shown as text', async () => {
    const raw = rawRecord({
      entries: [
        { id: 1, year: 2024, competition_name: '<img src=x onerror=alert(1)>', kind: 'competed' },
      ],
    });
    raw.account.display_name = '<b>Bold</b>';
    const { root } = await mount({
      loadRecord: vi.fn(async () => ({ ok: true, record: normaliseMyRecord(raw) })),
    });
    expect(root.querySelector('img[src="x"]')).toBeNull();
    expect(root.querySelector('h1 b')).toBeNull();
    expect(text(root)).toContain('<img src=x onerror=alert(1)>');
  });

  it('never shows an email or phone, and has no link into the console or the admin', async () => {
    const { root } = await mount();
    expect(root.querySelector('main a[href^="/app"], main a[href^="/admin"]')).toBeNull();
    expect(text(root)).not.toContain('secret.person@example.test');
    expect(text(root)).not.toContain('7777777');
  });
});
