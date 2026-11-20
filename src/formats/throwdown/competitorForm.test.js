import { describe, it, expect } from 'vitest';
import { parsePhone, phoneErrorMessage } from '../../core/phone.js';
import {
  blankCompetitorDraft,
  validateCompetitorDraft,
  buildCompetitor,
  addedWords,
  initialEditDraft,
  validateCompetitorEdit,
  editedWords,
} from './competitorForm.js';

const draft = (over) => ({ ...blankCompetitorDraft(), ...over });

describe('Throwdown competitor form', () => {
  it('starts blank with Brunei as the phone country', () => {
    expect(blankCompetitorDraft()).toEqual({
      displayName: '',
      phone: '',
      phoneCountry: 'BN',
      cafe: '',
    });
  });

  it('requires a name, then a phone (the phone is what a Seduh ID links to)', () => {
    expect(validateCompetitorDraft(draft({ phone: '7123456' }))).toEqual({
      field: 'displayName',
      message: 'Enter the competitor’s name.',
    });
    expect(validateCompetitorDraft(draft({ displayName: 'Ana', phone: '   ' }))).toEqual({
      field: 'phone',
      message: 'Enter the competitor’s phone number.',
    });
  });

  it('refuses a phone core/phone.js cannot read, pointing at the phone box', () => {
    expect(validateCompetitorDraft(draft({ displayName: 'Ana', phone: '12' }))).toEqual({
      field: 'phone',
      message: phoneErrorMessage(parsePhone('12', { country: 'BN' }).code),
    });
  });

  it('accepts a local Brunei number, and the café or team is optional', () => {
    expect(validateCompetitorDraft(draft({ displayName: 'Ana', phone: '7123456' }))).toBeNull();
  });

  it('says in plain words why the phone was refused', () => {
    expect(validateCompetitorDraft(draft({ displayName: 'Ana', phone: '12' })).message).toBe(
      'That is not a valid phone number. Check the country code and the digits.',
    );
  });

  it('reads the phone in the chosen country, not always Brunei', () => {
    expect(
      validateCompetitorDraft(draft({ displayName: 'Ana', phone: '7123456', phoneCountry: 'MY' }))
        .field,
    ).toBe('phone');
  });

  it('caps the name and the café or team at 200 characters', () => {
    const long = 'x'.repeat(201);
    expect(validateCompetitorDraft(draft({ displayName: long, phone: '7123456' })).field).toBe(
      'displayName',
    );
    expect(
      validateCompetitorDraft(draft({ displayName: 'Ana', phone: '7123456', cafe: long })).field,
    ).toBe('cafe');
    expect(
      validateCompetitorDraft(draft({ displayName: 'x'.repeat(200), phone: '7123456' })),
    ).toBeNull();
  });

  it('builds what registerEntry takes: trimmed, the phone as typed with its country, a blank café as null', () => {
    expect(
      buildCompetitor(draft({ displayName: ' Ana ', phone: ' 712 3456 ', phoneCountry: 'MY' })),
    ).toEqual({ displayName: 'Ana', phone: '712 3456', phoneCountry: 'MY', cafe: null });
    expect(
      buildCompetitor(draft({ displayName: 'Ana', phone: '7123456', cafe: ' BrewLab ' })).cafe,
    ).toBe('BrewLab');
  });

  it('names the stored competitor, and says so when the phone was already on the roster', () => {
    expect(addedWords({ display_name: 'Ana Rahman' }, false)).toBe('Ana Rahman added.');
    expect(addedWords({ display_name: 'Ana Rahman' }, true)).toBe(
      'Ana Rahman is already a competitor.',
    );
    // a withdrawn competitor is out of the draw until restored, so is not "already a competitor"
    expect(addedWords({ display_name: 'Ana Rahman', withdrawn: true }, true)).toBe(
      'Ana Rahman is already on the list, withdrawn. Use Restore to bring them back.',
    );
  });
});

describe('Throwdown competitor edit (pure)', () => {
  const entry = { id: 'eA', display_name: 'Ana', cafe: 'BrewLab', bib: '7', person_id: 'p1' };
  const person = { id: 'p1', phone: '+6737123456', email: 'a@b.co' };

  it('starts from the entry for name and café and from the person for phone and email', () => {
    expect(initialEditDraft(entry, person)).toEqual({
      displayName: 'Ana',
      phone: '+6737123456',
      phoneCountry: 'BN',
      cafe: 'BrewLab',
      email: 'a@b.co',
      bib: '7',
    });
  });

  it('starts blank on the person fields for an entry with no person', () => {
    expect(initialEditDraft({ display_name: 'W', cafe: null, bib: null }, null)).toMatchObject({
      phone: '',
      email: '',
      cafe: '',
      bib: '',
    });
  });

  it('uses the add form’s words for a missing name or phone', () => {
    const d = initialEditDraft(entry, person);
    expect(validateCompetitorEdit({ ...d, displayName: '' }, { linked: true }).message).toBe(
      'Enter the competitor’s name.',
    );
    expect(validateCompetitorEdit({ ...d, phone: '' }, { linked: true }).message).toBe(
      'Enter the competitor’s phone number.',
    );
    expect(validateCompetitorEdit(d, { linked: true, storedPhone: '+6737123456' })).toBeNull();
  });

  it('does not check the email or bib it merely carries (the form has no box for them)', () => {
    const d = { ...initialEditDraft(entry, person), email: 'e'.repeat(300), bib: 'b'.repeat(99) };
    expect(validateCompetitorEdit(d, { linked: true, storedPhone: '+6737123456' })).toBeNull();
  });

  it('says in words that a published result needs publishing again, only when it applies', () => {
    expect(editedWords('Ana', { detailsChanged: false, dropsPublishedResult: false })).toBe(
      'Ana updated.',
    );
    expect(editedWords('Ana', { detailsChanged: true, dropsPublishedResult: false })).toContain(
      'new details the next time they are published',
    );
    expect(editedWords('Ana', { detailsChanged: true, dropsPublishedResult: true })).toContain(
      'until you republish',
    );
  });
});
