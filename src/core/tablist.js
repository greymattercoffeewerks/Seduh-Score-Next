// The one tablist (Petrol Kaizen P5). A row of `.tab` buttons with role="tablist"/"tab", a roving tabindex and the
// arrow keys, so a screen never hand-rolls a view switch from pressed-buttons again. Format-agnostic (handoff §6):
// it knows nothing about what a tab shows. `tokenDrift.test.js` fails a `role="tab"` written anywhere else.
//
// Behaviour (WAI-ARIA tabs, automatic activation, because a view switch is instant):
//   - exactly one tab has aria-selected="true" and tabindex="0"; the others have tabindex="-1", so Tab leaves the
//     list in one press and the arrow keys move inside it
//   - ArrowRight/ArrowLeft move to the next/previous tab and wrap; Home/End go to the first/last
//   - moving or clicking selects (calls `onSelect(id)`) and moves focus to that tab
//
// A screen that rebuilds its DOM on every change (Brew Planner) just builds the list again with the new `selected`;
// a screen that keeps its DOM passes `panel` and the list keeps `aria-labelledby` on it current.
import { el } from './dom.js';

// Pure. The index a key moves to from `index` in a list of `count` tabs, or -1 for a key that does not move.
export function nextTabIndex(key, index, count) {
  if (count <= 0) return -1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

/**
 * @param {{
 *   idBase: string,
 *   label: string,
 *   tabs: { id: string, label: string, attrs?: Record<string, string> }[],
 *   selected: string,
 *   onSelect?: (id: string) => void,
 *   panel?: HTMLElement | null,
 * }} options `idBase` namespaces the ids (`<idBase>-tab-<id>`, `<idBase>-panel`); `label` names the tablist.
 * @returns {{ list: HTMLElement, panelAttrs: Record<string, string>, select: (id: string, focus?: boolean) => void }}
 *   `panelAttrs` are the attributes for the tabpanel the tabs control (set them on the panel element).
 */
export function buildTablist({ idBase, label, tabs, selected, onSelect, panel = null }) {
  const panelId = `${idBase}-panel`;
  const tabId = (id) => `${idBase}-tab-${id}`;
  const list = el('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': label } });
  const buttons = tabs.map((tab) => {
    const isSelected = tab.id === selected;
    return el('button', {
      className: 'tab',
      id: tabId(tab.id),
      text: tab.label,
      attrs: {
        type: 'button',
        role: 'tab',
        'aria-selected': String(isSelected),
        'aria-controls': panelId,
        tabindex: isSelected ? '0' : '-1',
        ...tab.attrs,
      },
    });
  });
  list.append(...buttons);

  const panelAttrs = (id) => ({
    role: 'tabpanel',
    id: panelId,
    'aria-labelledby': tabId(id),
    tabindex: '0',
  });
  if (panel) {
    panel.classList.add('tabpanel');
    for (const [key, value] of Object.entries(panelAttrs(selected))) panel.setAttribute(key, value);
  }

  function select(id, focus = true) {
    buttons.forEach((button, index) => {
      const on = tabs[index].id === id;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    });
    if (panel) panel.setAttribute('aria-labelledby', tabId(id));
    onSelect?.(id);
  }

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(tabs[index].id, false));
  });
  list.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = buttons.indexOf(document.activeElement);
    const target = nextTabIndex(event.key, current < 0 ? 0 : current, buttons.length);
    if (target < 0) return;
    event.preventDefault();
    select(tabs[target].id);
  });

  return { list, panelAttrs: panelAttrs(selected), select };
}
