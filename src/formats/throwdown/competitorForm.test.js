import { describe, it, expect } from 'vitest';
import { parsePhone, phoneErrorMessage } from '../../core/phone.js';
import {
  blankCompetitorDraft,
  validateCompetitorDraft,
  buildCompetitor,
  addedWords,
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
