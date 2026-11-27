// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { callDemo, describeDemoDataError, renderDemoDataCard } from './demoData.js';

describe('demo data client', () => {
  it('calls the named function with the organisation and event, and returns its reply', async () => {
    const reply = { cuppers: 8 };
    const client = { rpc: vi.fn(async () => ({ data: reply, error: null })) };
    await expect(callDemo('load_x_demo', 'org', 'ev', client)).resolves.toEqual(reply);
    expect(client.rpc).toHaveBeenCalledWith('load_x_demo', { p_org_id: 'org', p_event_id: 'ev' });
  });

  it('throws the database error unchanged', async () => {
    const err = { hint: 'demo_not_test' };
    const client = { rpc: async () => ({ data: null, error: err }) };
    await expect(callDemo('x', 'org', 'ev', client)).rejects.toBe(err);
  });

  it('words each refusal from its hint, never from the message', () => {
    expect(describeDemoDataError({ hint: 'demo_not_test', message: 'x' })).toContain('test event');
    expect(describeDemoDataError({ hint: 'demo_wrong_format' })).toContain('different format');
    expect(describeDemoDataError({ hint: 'demo_event_not_found' })).toContain('Reload');
  });

  it('renders Load and Clear, blocks both while busy and Clear when there is nothing to clear', () => {
    const onLoad = vi.fn();
    const onClear = vi.fn();
    const base = { idPrefix: 'x', intro: 'Load things.', onLoad, onClear };
    const card = renderDemoDataCard({ ...base, busy: false, hasData: true });
    const [load, clear] = card.querySelectorAll('button');
    load.click();
    clear.click();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(card.textContent).toContain('no Seduh ID');
    const empty = renderDemoDataCard({ ...base, busy: false, hasData: false });
    const [emptyLoad, emptyClear] = empty.querySelectorAll('button');
    expect(emptyLoad.getAttribute('aria-disabled')).not.toBe('true');
    expect(emptyClear.getAttribute('aria-disabled')).toBe('true');
    const busy = renderDemoDataCard({ ...base, busy: true, hasData: true });
    for (const b of busy.querySelectorAll('button'))
      expect(b.getAttribute('aria-disabled')).toBe('true');
  });
});
