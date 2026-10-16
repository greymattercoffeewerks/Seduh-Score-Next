// The two roles an organisation member can have, and the words for them. Role names are DATA from a server, so every
// lookup uses own properties only: a role called `constructor` is an unknown role, not a function from Object.
const LABEL = Object.freeze({ owner: 'Owner', organiser: 'Organiser' });
const OTHER = Object.freeze({ owner: 'organiser', organiser: 'owner' });

// In the order the role select offers them (the lesser role first: it is the default).
export const ROLES = Object.freeze(['organiser', 'owner']);

export const roleLabel = (role) => (Object.hasOwn(LABEL, role) ? LABEL[role] : String(role ?? ''));

// The role a member would move to, or null when this console does not know the role (it offers no change then).
export const otherRole = (role) => (Object.hasOwn(OTHER, role) ? OTHER[role] : null);
