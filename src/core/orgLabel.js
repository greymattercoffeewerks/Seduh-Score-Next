// How an organisation is named where a person has to tell it from another one: the header's slot, the
// list to choose from, and the spoken announcement of a change. Format-agnostic.
//
// Names are not unique (two organisations may both be called "Alpha Coffee"), so when a name is shared
// the slug, which is unique, is added. An organisation with no name falls back to its slug, and one with
// neither to a plain placeholder, so a label is never blank.
export function orgLabel(org, orgs) {
  const base = org.name || org.slug || 'Unnamed organisation';
  const shared = orgs.filter((other) => (other.name || other.slug) === base).length > 1;
  return shared && org.slug && org.slug !== base ? `${base} (${org.slug})` : base;
}
