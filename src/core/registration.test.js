import { describe, it, expect, vi } from 'vitest';
import { parsePhone, phoneErrorMessage } from './phone.js';
import {
  REGISTRATION_LIMITS,
  phoneProblem,
  registerAndLink,
  tooLongProblem,
  validateEdit,
  buildEditFields,
  describeRegistrationEditError,
  isEntryInPublishedResults,
  matchFieldsChanged,
  initialEditDraft,
  savedEditSentence,
} from './registration.js';

describe('core/registration', () => {
  it('holds the registration RPC caps in one place', () => {
    expect(REGISTRATION_LIMITS).toEqual({ displayName: 200, email: 254, cafe: 200, bib: 50 });
    expect(Object.isFrozen(REGISTRATION_LIMITS)).toBe(true);
  });

  it('reads the phone in the chosen country: a Brunei local number is fine in BN, refused in MY', () => {
    expect(phoneProblem('7123456', 'BN')).toBeNull();
    expect(phoneProblem('7123456', 'MY')).toEqual({
      field: 'phone',
      message: phoneErrorMessage(parsePhone('7123456', { country: 'MY' }).code),
    });
  });

  it('names the exact core/phone.js refusal for a number it cannot read', () => {
    const code = parsePhone('12', { country: 'BN' }).code;
    expect(code).toBeTruthy();
    expect(phoneProblem('12', 'BN')).toEqual({ field: 'phone', message: phoneErrorMessage(code) });
  });

  // A client just rich enough for registerEntry's find-or-create: no person yet, no entry yet.
  function client() {
    const rpc = vi.fn(async () => ({ error: null }));
    const inserts = [];
    return {
      rpc,
      inserts,
      from(table) {
        let inserted = null;
        const q = {
          select: () => q,
          eq: () => q,
          ilike: () => q,
          insert: (row) => {
            inserted = { id: `${table}-1`, ...row };
            inserts.push({ table, row });
            return q;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({
            data: inserted ?? { display_name: 'Ana', cafe: null },
            error: null,
          }),
        };
        return q;
      },
    };
  }

  it('registers by canonical phone, enters the person, then asks for the Seduh ID link', async () => {
    const c = client();
    const entry = await registerAndLink(
      'org',
      'ev',
      { displayName: 'Ana', phone: '712 3456', phoneCountry: 'BN' },
      c,
    );
    expect(c.inserts[0]).toMatchObject({ table: 'people', row: { phone: '+6737123456' } });
    expect(entry).toMatchObject({ event_id: 'ev', person_id: 'people-1' });
    expect(c.rpc).toHaveBeenCalledWith('link_person_identity', {
      p_org_id: 'org',
      p_person_id: 'people-1',
    });
  });
});

const EDIT_MESSAGES = { name: 'Name needed.', phone: 'Phone needed.' };
const EDIT_LABELS = { displayName: 'Name', cafe: 'Cafe' };
const editDraft = (over) => ({
  displayName: 'Ana',
  phone: '+6737123456',
  phoneCountry: 'BN',
  cafe: '',
  ...over,
});

describe('core/registration: the edit rules', () => {
  it('phoneProblem with storedPhone checks an unchanged value for shape only', () => {
    // E.164-shaped but not a number the library accepts (no Brunei number starts with 9)
    expect(phoneProblem('+6739999999', 'BN')).not.toBeNull();
    expect(phoneProblem('+6739999999', 'BN', '+6739999999')).toBeNull();
    // a different value is judged in full even when something is stored
    expect(phoneProblem('+6739999998', 'BN', '+6739999999')).not.toBeNull();
    // an unchanged value that fails even the shape check is still refused
    expect(phoneProblem('+673abc', 'BN', '+673abc')).not.toBeNull();
  });

  it('tooLongProblem checks only the fields the caller has, at the registration caps', () => {
    expect(
      tooLongProblem({ displayName: 'a'.repeat(200), cafe: 'b'.repeat(200) }, EDIT_LABELS),
    ).toBeNull();
    expect(tooLongProblem({ displayName: 'a', cafe: 'b'.repeat(201) }, EDIT_LABELS)).toEqual({
      field: 'cafe',
      message: 'Cafe is too long (200 characters at most).',
    });
    // a field not in `labels` is not the caller's box: an over-long email is not checked
    expect(
      tooLongProblem({ displayName: 'a', cafe: '', email: 'e'.repeat(300) }, EDIT_LABELS),
    ).toBeNull();
    // trimmed before counting, as the RPC does
    expect(tooLongProblem({ displayName: `${'a'.repeat(200)}   ` }, EDIT_LABELS)).toBeNull();
  });

  it('validateEdit asks for a name, then (for an entry with a person) a phone, then checks caps', () => {
    const where = { linked: true, messages: EDIT_MESSAGES, labels: EDIT_LABELS };
    expect(validateEdit(editDraft({ displayName: ' ' }), where)).toEqual({
      field: 'displayName',
      message: 'Name needed.',
    });
    expect(validateEdit(editDraft({ phone: ' ' }), where)).toEqual({
      field: 'phone',
      message: 'Phone needed.',
    });
    expect(validateEdit(editDraft({ phone: '12' }), where).field).toBe('phone');
    expect(validateEdit(editDraft({ cafe: 'c'.repeat(201) }), where).field).toBe('cafe');
    expect(validateEdit(editDraft(), where)).toBeNull();
  });

  it('validateEdit ignores the phone for an entry with no person', () => {
    const where = { linked: false, messages: EDIT_MESSAGES, labels: EDIT_LABELS };
    expect(validateEdit(editDraft({ phone: '' }), where)).toBeNull();
  });

  it('validateEdit leaves an unchanged stored old-shaped phone alone', () => {
    const where = {
      linked: true,
      storedPhone: '+6739999999',
      messages: EDIT_MESSAGES,
      labels: EDIT_LABELS,
    };
    expect(validateEdit(editDraft({ phone: '+6739999999' }), where)).toBeNull();
    expect(validateEdit(editDraft({ phone: '+6739999998' }), where).field).toBe('phone');
  });

  it('buildEditFields trims, turns blanks into null, and carries email and bib through', () => {
    expect(
      buildEditFields(
        editDraft({
          displayName: '  Ana ',
          phone: ' 7123456 ',
          cafe: '  ',
          email: ' a@b.co ',
          bib: '7',
        }),
        { linked: true, storedPhone: '+6737123456' },
      ),
    ).toEqual({
      displayName: 'Ana',
      phone: '7123456',
      phoneCountry: 'BN',
      storedPhone: '+6737123456',
      email: 'a@b.co',
      cafe: null,
      bib: '7',
    });
  });

  it('buildEditFields sends no phone, country or email for an entry with no person', () => {
    expect(
      buildEditFields(editDraft({ email: 'x@y.z' }), { linked: false, storedPhone: '+673' }),
    ).toMatchObject({
      phone: null,
      phoneCountry: null,
      storedPhone: null,
      email: null,
    });
  });

  it('buildEditFields copes with a draft that has no email or bib key at all', () => {
    const fields = buildEditFields(editDraft(), { linked: true });
    expect(fields.email).toBeNull();
    expect(fields.bib).toBeNull();
  });

  it('describeRegistrationEditError reads a phone refusal by its code, not its text', () => {
    const code = parsePhone('12', { country: 'BN' }).code;
    expect(describeRegistrationEditError({ hint: code, message: 'anything' })).toEqual({
      field: 'phone',
      message: phoneErrorMessage(code),
    });
    expect(describeRegistrationEditError({ hint: 'phone_invalid' }).field).toBe('phone');
  });

  it('describeRegistrationEditError names who already has a clashing phone or email', () => {
    const clash = (field) => ({
      code: 'P0002',
      details: JSON.stringify({ field, existing_display_name: 'Bima' }),
    });
    expect(describeRegistrationEditError(clash('phone'))).toEqual({
      field: 'phone',
      message: 'That phone number already belongs to Bima. Check the number.',
    });
    expect(describeRegistrationEditError(clash('email'))).toEqual({
      field: 'email',
      message: 'That email already belongs to Bima. Check the address.',
    });
    expect(describeRegistrationEditError({ code: 'P0002', details: 'not json' })).toMatchObject({
      field: null,
    });
    expect(
      describeRegistrationEditError({ code: 'P0002', detail: '{"field":null}' }).message,
    ).toContain('already belongs to another person');
  });

  it('describeRegistrationEditError describes anything else generically, with no field', () => {
    const out = describeRegistrationEditError(new Error('boom'));
    expect(out.field).toBeNull();
    expect(out.message).toBe('boom');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('isEntryInPublishedResults is true only for an entry the podium or standings name exactly', () => {
    const payload = {
      podium: [{ name: 'Ana', cafe: 'BrewLab' }],
      standings: [{ name: 'Bima', cafe: null }],
    };
    expect(isEntryInPublishedResults(payload, { display_name: ' Ana ', cafe: 'BrewLab' })).toBe(
      true,
    );
    expect(isEntryInPublishedResults(payload, { display_name: 'Bima', cafe: '' })).toBe(true);
    expect(isEntryInPublishedResults(payload, { display_name: 'Ana', cafe: 'Other' })).toBe(false);
    expect(isEntryInPublishedResults(payload, { display_name: 'Cara', cafe: null })).toBe(false);
    expect(isEntryInPublishedResults(null, { display_name: 'Ana', cafe: 'BrewLab' })).toBe(false);
    expect(isEntryInPublishedResults({ podium: 'x' }, { display_name: 'Ana' })).toBe(false);
    expect(isEntryInPublishedResults(payload, null)).toBe(false);
  });

  it('matchFieldsChanged compares name and café trimmed, and ignores everything else', () => {
    const entry = { display_name: 'Ana', cafe: 'BrewLab' };
    expect(matchFieldsChanged({ displayName: ' Ana ', cafe: 'BrewLab ' }, entry)).toBe(false);
    expect(matchFieldsChanged({ displayName: 'Ana R', cafe: 'BrewLab' }, entry)).toBe(true);
    expect(matchFieldsChanged({ displayName: 'Ana', cafe: '' }, entry)).toBe(true);
    expect(
      matchFieldsChanged({ displayName: 'Ana', cafe: '' }, { display_name: 'Ana', cafe: null }),
    ).toBe(false);
  });
});

describe('core/registration: the edit starting values and the saved sentence', () => {
  it('initialEditDraft takes name, café and bib from the entry and phone and email from the person', () => {
    expect(
      initialEditDraft(
        { display_name: 'Ana', cafe: 'BrewLab', bib: '7' },
        { phone: '+6737123456', email: 'a@b.co' },
      ),
    ).toEqual({
      displayName: 'Ana',
      phone: '+6737123456',
      phoneCountry: 'BN',
      email: 'a@b.co',
      cafe: 'BrewLab',
      bib: '7',
    });
    expect(initialEditDraft({ display_name: 'W', cafe: null, bib: null }, null)).toMatchObject({
      phone: '',
      email: '',
      cafe: '',
      bib: '',
    });
  });

  it('savedEditSentence is one wording: plain, new details, or the published result needs republishing', () => {
    expect(savedEditSentence('Ana', { detailsChanged: false, dropsPublishedResult: false })).toBe(
      'Ana updated.',
    );
    expect(savedEditSentence('Ana', { detailsChanged: true, dropsPublishedResult: false })).toBe(
      'Ana updated. The audience view and any published results show the new details the next time they are published.',
    );
    expect(savedEditSentence('Ana', { detailsChanged: true, dropsPublishedResult: true })).toBe(
      'Ana updated. Their published result still shows the old name or café, so it is not on their Seduh ID profile until you republish.',
    );
  });
});
