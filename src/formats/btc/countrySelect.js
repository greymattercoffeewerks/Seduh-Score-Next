// The country <select> used on BTC's setup forms: "No country", then Brunei and every country by name
// (core/country.js, the same list the phone picker uses). One native select: no custom widget to make accessible.
// The ~245 <option> nodes are built once and copied per select, not rebuilt per row per render.
import { el } from '../../core/dom.js';
import { countryOptions } from '../../core/country.js';

export const NO_COUNTRY_LABEL = 'No country';

let optionNodes = null;
function choices() {
  if (!optionNodes) {
    optionNodes = [
      el('option', { text: NO_COUNTRY_LABEL, attrs: { value: '' } }),
      ...countryOptions().map((c) => el('option', { text: c.name, attrs: { value: c.iso } })),
    ];
  }
  return optionNodes.map((node) => node.cloneNode(true));
}

// `value` is an ISO code or '' / null for none. A stored code outside the list (the database checks only the
// shape) gets its own option so the select never silently shows "No country" for a row that has one.
export function countrySelect({ value, ariaLabel, dataField, onChange }) {
  const select = el('select', {
    className: 'field-input',
    attrs: { 'aria-label': ariaLabel, 'data-field': dataField },
  });
  for (const node of choices()) select.appendChild(node);
  const current = value ?? '';
  if (current && ![...select.options].some((o) => o.value === current)) {
    select.appendChild(el('option', { text: current, attrs: { value: current } }));
  }
  select.value = current;
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  return select;
}
