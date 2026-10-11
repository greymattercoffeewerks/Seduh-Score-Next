// How an organisation is named where a person has to tell it from another one: the header's slot, the
// list to choose from, the spoken announcement of a change, and the Team screen's heading. Format-agnostic.
//
// A name is text an owner or an operator typed, and it is placed mid-sentence, so it is cleaned first:
// surrounding space is trimmed (a name of only spaces counts as no name), and the invisible
// text-direction controls (left-to-right / right-to-left marks, embeddings, overrides and isolates) are
// removed, since an unclosed right-to-left override would make everything after the name render
// backwards. Names are not unique (two organisations may both be called "Alpha Coffee"), so when a name
// is shared the slug, which is unique, is added. An organisation with no name falls back to its slug,
// and one with neither to a plain placeholder, so a label is never blank.
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function clean(text) {
  return typeof text === 'string' ? text.replace(BIDI_CONTROLS, '').trim() : '';
}

export function orgLabel(org, orgs) {
  const baseOf = (o) => clean(o.name) || clean(o.slug);
  const base = baseOf(org) || 'Unnamed organisation';
  const slug = clean(org.slug);
  const shared = orgs.filter((other) => baseOf(other) === base).length > 1;
  return shared && slug && slug !== base ? `${base} (${slug})` : base;
}
