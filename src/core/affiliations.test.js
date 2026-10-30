import { describe, it, expect, vi } from 'vitest';
import {
  AFFILIATION_RELATIONSHIPS,
  AffiliationError,
  listOpenAffiliations,
  addAffiliation,
  endAffiliation,
  describeAffiliationError,
  relationshipLabel,
} from './affiliations.js';

function table(result) {
  const calls = [];
  const builder = {
    select: vi.fn((...a) => (calls.push(['select', ...a]), builder)),
    eq: vi.fn((...a) => (calls.push(['eq', ...a]), builder)),
    is: vi.fn((...a) => (calls.push(['is', ...a]), builder)),
    insert: vi.fn((p) => (calls.push(['insert', p]), Promise.resolve(result))),
    update: vi.fn((p) => (calls.push(['update', p]), builder)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return { calls, builder, from: vi.fn(() => builder) };
}

describe('vocabulary', () => {
  it('exposes exactly staff and affiliate, with words', () => {
    expect(AFFILIATION_RELATIONSHIPS).toEqual(['staff', 'affiliate']);
    expect(relationshipLabel('staff')).toBe('Staff');
    expect(relationshipLabel('affiliate')).toBe('Affiliate');
    expect(relationshipLabel('sponsor')).toBeNull();
  });
});

describe('listOpenAffiliations', () => {
  it('reads only this organisation open rows and maps them, hiding words outside the vocabulary', async () => {
    const t = table({
      data: [
        { id: 'a1', person_id: 'p1', relationship: 'staff', started_on: '2026-01-01' },
        { id: 'a2', person_id: 'p2', relationship: 'sponsor', started_on: null },
      ],
      error: null,
    });
    const rows = await listOpenAffiliations('org1', t);
    expect(rows).toEqual([
      { id: 'a1', personId: 'p1', relationship: 'staff', startedOn: '2026-01-01' },
    ]);
    expect(t.from).toHaveBeenCalledWith('org_person_affiliations');
    expect(t.calls).toContainEqual(['eq', 'org_id', 'org1']);
    expect(t.calls).toContainEqual(['is', 'ended_at', null]);
  });

  it('throws a worded error on failure', async () => {
    const t = table({ data: null, error: { code: '42501', message: 'raw db text' } });
    const err = await listOpenAffiliations('org1', t).catch((e) => e);
    expect(err).toBeInstanceOf(AffiliationError);
    expect(err.message).not.toContain('raw db text');
  });
});

describe('addAffiliation', () => {
  it('inserts organisation, person and relationship only', async () => {
    const t = table({ error: null });
    await addAffiliation('org1', 'p1', 'affiliate', t);
    expect(t.calls).toEqual([
      ['insert', { org_id: 'org1', person_id: 'p1', relationship: 'affiliate' }],
    ]);
  });

  it('refuses a word outside the vocabulary before sending anything', async () => {
    const t = table({ error: null });
    await expect(addAffiliation('org1', 'p1', 'sponsor', t)).rejects.toBeInstanceOf(
      AffiliationError,
    );
    expect(t.from).not.toHaveBeenCalled();
  });

  it('words a duplicate open row (23505) kindly, without raw database text', async () => {
    const t = table({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "org_person_affiliations_open_uq"',
      },
    });
    const err = await addAffiliation('org1', 'p1', 'staff', t).catch((e) => e);
    expect(err.duplicate).toBe(true);
    expect(describeAffiliationError(err)).toBe('This person is already marked as staff.');
    expect(err.message).not.toContain('org_person_affiliations');
  });

  it('describes any other failure generically', async () => {
    const t = table({ error: { code: '42501', message: 'row-level security' } });
    const err = await addAffiliation('org1', 'p1', 'staff', t).catch((e) => e);
    expect(err.duplicate).toBe(false);
    expect(describeAffiliationError(err)).toBe('Something went wrong saving that - try again.');
    expect(describeAffiliationError(new Error('raw'))).toBe(
      'Something went wrong saving that - try again.',
    );
  });
});

describe('endAffiliation', () => {
  it('writes only ended_at, on an open row, and never deletes', async () => {
    const t = table({ error: null });
    await endAffiliation('a1', t);
    const update = t.calls.find((c) => c[0] === 'update');
    expect(Object.keys(update[1])).toEqual(['ended_at']);
    expect(Number.isNaN(Date.parse(update[1].ended_at))).toBe(false);
    expect(t.calls).toContainEqual(['eq', 'id', 'a1']);
    expect(t.calls).toContainEqual(['is', 'ended_at', null]);
    expect(t.builder.delete).toBeUndefined();
  });

  it('throws on failure', async () => {
    const t = table({ error: { code: 'XX', message: 'x' } });
    await expect(endAffiliation('a1', t)).rejects.toBeInstanceOf(AffiliationError);
  });
});
