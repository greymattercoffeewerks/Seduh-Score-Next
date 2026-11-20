// The phone box with the country a number typed without + is read in, as ONE labelled field. Shared by every
// format's registration form (Cup Taster's roster, Throwdown's competitors) so a phone, and so the Seduh ID link
// that hangs off it, is asked for the same way everywhere. Lifted from Cup Taster's rosterScreen.js (2026-11-20).
//
// Brunei first, then every country by name (core/phone.js phoneCountryOptions). One native select: no custom widget
// to make accessible, and the phone's own aria-label stays "Phone". Styled by phoneField.css.
import { el, setBusyDisabled } from './dom.js';
import { phoneCountryOptions, DEFAULT_COUNTRY } from './phone.js';

// Built once, copied per use.
let countryOptionNodes = null;
function countryChoices() {
  if (!countryOptionNodes) {
    countryOptionNodes = phoneCountryOptions().map((c) =>
      el('option', { text: `+${c.callingCode} ${c.name}`, attrs: { value: c.iso } }),
    );
  }
  return countryOptionNodes.map((node) => node.cloneNode(true));
}

// `disabled` is native (out of the focus order); `busy` is aria-disabled only (core/dom.js setBusyDisabled), for a
// form that stays focusable while it saves. A `busy` caller ignores onChange itself while it is busy.
export function phoneCountrySelect({ label, value, disabled, busy, id, onChange, focusKey }) {
  const attrs = { 'aria-label': label, 'data-field': 'phoneCountry' };
  if (focusKey) attrs['data-focus-key'] = focusKey;
  const select = el('select', { className: 'field-input phone-country', id, attrs });
  select.append(...countryChoices());
  select.value = value ?? DEFAULT_COUNTRY;
  select.disabled = Boolean(disabled);
  setBusyDisabled(select, Boolean(busy));
  // `input` and `change` both fire for a select in current browsers; either one records the choice.
  for (const type of ['input', 'change']) {
    select.addEventListener(type, () => onChange(select.value));
  }
  return select;
}

export function phoneRow(countrySelect, phoneInput) {
  return el('div', { className: 'phone-row' }, [countrySelect, phoneInput]);
}
