// Staff / affiliate roster for the active organisation (T-ID.B3 table `org_person_affiliations`, plain
// table access under RLS). Format-agnostic, no business logic: the database refuses another
// organisation's rows, a person from another organisation, and a second OPEN row for the same
// organisation, person and relationship (23505). The UI vocabulary is the two words below; the column is
// free text in the database, but nothing here lets a screen send any other value. Leaving a role ENDS the
// row (`ended_at`), it never deletes history.
import { getSupabase } from './supabaseClient.js';
import { UNIQUE_VIOLATION } from './errors.js';

export const AFFILIATION_RELATIONSHIPS = ['staff', 'affiliate'];

const LABELS = { staff: 'Staff', affiliate: 'Affiliate' };

export function relationshipLabel(relationship) {
  return LABELS[relationship] ?? null;
}

export class AffiliationError extends Error {
  constructor(message, { duplicate = false } = {}) {
    super(message);
    this.name = 'AffiliationError';
    this.duplicate = duplicate;
  }
}

const GENERIC_MESSAGE = 'Something went wrong saving that - try again.';

function failure(error, { relationship } = {}) {
  if (error?.code === UNIQUE_VIOLATION) {
    const word = relationshipLabel(relationship)?.toLowerCase() ?? 'that role';
    return new AffiliationError(`This person is already marked as ${word}.`, { duplicate: true });
  }
  return new AffiliationError(GENERIC_MESSAGE);
}

// The OPEN roles of the organisation's people, as { id, personId, relationship, startedOn }. Only the two
// UI words are returned: a row another tool wrote with a different word is not shown here.
export async function listOpenAffiliations(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('org_person_affiliations')
    .select('id, person_id, relationship, started_on')
    .eq('org_id', orgId)
    .is('ended_at', null);
  if (error) throw failure(error);
  return (data ?? [])
    .filter((row) => AFFILIATION_RELATIONSHIPS.includes(row.relationship))
    .map((row) => ({
      id: row.id,
      personId: row.person_id,
      relationship: row.relationship,
      startedOn: row.started_on ?? null,
    }));
}

export async function addAffiliation(orgId, personId, relationship, client = getSupabase()) {
  if (!AFFILIATION_RELATIONSHIPS.includes(relationship))
    throw new AffiliationError(GENERIC_MESSAGE);
  const { error } = await client
    .from('org_person_affiliations')
    .insert({ org_id: orgId, person_id: personId, relationship });
  if (error) throw failure(error, { relationship });
}

// Ends an open role. Only `ended_at` is written (the database freezes org_id and person_id).
export async function endAffiliation(affiliationId, client = getSupabase()) {
  const { error } = await client
    .from('org_person_affiliations')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', affiliationId)
    .is('ended_at', null);
  if (error) throw failure(error);
}

export function describeAffiliationError(error) {
  return error instanceof AffiliationError ? error.message : GENERIC_MESSAGE;
}
