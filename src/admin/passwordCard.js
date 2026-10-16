// The one-time password card as the admin console draws it: the shared card (core/oneTimePasswordCard.js) with this
// console's ids, classes and words. Used by the create-organisation panel for a login the console has just made.
// The password lives only in the node (never an attribute, a label, a log or storage) and goes when the node does.
import { oneTimePasswordCard } from '../core/oneTimePasswordCard.js';

const ONLY_TIME_WARNING = 'This is the only time this password is shown.';
const COPY_FAILED = 'Could not copy. Select the password and copy it yourself.';

// `heading` names the card; `help` is the instruction under the password; `onDone` (optional) adds a Done button
// that the caller uses to hide the card once the person says the password has been passed on.
export function adminPasswordCard({ idPrefix, heading, password, help, onDone }) {
  return oneTimePasswordCard({
    idPrefix,
    heading,
    password,
    copyFailedText: COPY_FAILED,
    paragraphs: [
      {
        id: `${idPrefix}-warning`,
        className: 'adm-warning',
        text: ONLY_TIME_WARNING,
        describes: true,
      },
      ...(help ? [{ text: help }] : []),
    ],
    onDone,
    classes: {
      card: 'adm-password-card',
      muted: 'adm-muted',
      password: 'adm-password',
      actions: 'adm-actions',
      // Copy is the main action; Done throws the only copy away, so it is the quieter button and sits apart from Copy.
      copy: 'btn btn-primary tap-target',
      done: 'btn btn-outline tap-target adm-done',
    },
  });
}
