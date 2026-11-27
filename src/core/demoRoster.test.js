// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  DEMO_ROSTER_SIZE,
  loadDemoRoster,
  describeDemoRosterError,
  describeDemoRosterLoaded,
  renderDemoRosterCard,
} from './demoRoster.js';

describe('demo roster client', () => {
  it('calls the database function with the organisation and event, and returns its reply', async () => {
    const reply = { people: 8, added: 8, reinstated: 0 };
    const client = { rpc: vi.fn(async () => ({ data: reply, error: null })) };
    await expect(loadDemoRoster('org', 'ev', client)).resolves.toEqual(reply);
    expect(client.rpc).toHaveBeenCalledWith('load_demo_roster', {
      p_org_id: 'org',
      p_event_id: 'ev',
    });
  });

  it('throws the database error unchanged', async () => {
    const err = { hint: 'demo_not_test' };
    const client = { rpc: async () => ({ data: null, error: err }) };
    await expect(loadDemoRoster('org', 'ev', client)).rejects.toBe(err);
  });

  it('words each refusal from its hint, never from the message', () => {
    expect(describeDemoRosterError({ hint: 'demo_not_test', message: 'x' })).toContain(
      'test event',
    );
    expect(describeDemoRosterError({ hint: 'demo_roster_format' })).toContain('BTC');
    expect(describeDemoRosterError({ hint: 'demo_event_not_found' })).toContain('Reload');
  });

  it('says what a load did', () => {
    expect(describeDemoRosterLoaded({ added: 8, reinstated: 0 })).toBe(
      'Demo people loaded: 8 added.',
    );
    expect(describeDemoRosterLoaded({ added: 0, reinstated: 1 })).toBe(
      'Demo people loaded: 1 reinstated.',
    );
    expect(describeDemoRosterLoaded({ added: 0, reinstated: 0 })).toContain(
      `${DEMO_ROSTER_SIZE} demo people`,
    );
  });

  it('renders a card with one button that calls onLoad, and blocks it while busy', () => {
    const onLoad = vi.fn();
    const card = renderDemoRosterCard({ idPrefix: 'x', noun: 'cuppers', busy: false, onLoad });
    card.querySelector('button').click();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(card.textContent).toContain('no Seduh ID');
    const busy = renderDemoRosterCard({ idPrefix: 'x', noun: 'cuppers', busy: true, onLoad });
    expect(busy.querySelector('button').getAttribute('aria-disabled')).toBe('true');
  });
});
