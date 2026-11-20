// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveBracket } from './bracket.js';

const mocks = vi.hoisted(() => ({
  loadThrowdown: vi.fn(),
  findPublished: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}));
vi.mock('./data.js', () => ({ loadThrowdown: mocks.loadThrowdown }));
vi.mock('../../core/publicResults.js', () => ({
  findPublishedResultForEvent: mocks.findPublished,
  publishEventResults: mocks.publish,
  unpublishEventResults: mocks.unpublish,
}));

const { buildPublishCard } = await import('./publishCard.js');

const entries = ['Ana', 'Bima'].map((n) => ({
  id: n,
  display_name: n,
  cafe: `${n} Cafe`,
  withdrawn: false,
}));
function finished() {
  return deriveBracket({
    rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
    matches: [{ id: 'm1', round_id: 'r1', position: 1, result_kind: 'votes', confirmed_at: 't' }],
    slots: [
      { id: 'a', match_id: 'm1', position: 1, entry_id: 'Ana' },
      { id: 'b', match_id: 'm1', position: 2, entry_id: 'Bima' },
    ],
    votes: [{ match_id: 'm1', slot_id: 'a' }],
    entries,
  });
}
function unfinished() {
  return deriveBracket({
    rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
    matches: [{ id: 'm1', round_id: 'r1', position: 1, result_kind: null }],
    slots: [
      { id: 'a', match_id: 'm1', position: 1, entry_id: 'Ana' },
      { id: 'b', match_id: 'm1', position: 2, entry_id: 'Bima' },
    ],
    votes: [],
    entries,
  });
}
const realEvent = { id: 'ev1', org_id: 'org1', format: 'throwdown', name: 'Night', is_test: false };
const buttons = (card) => [...card.querySelectorAll('button')].map((b) => b.textContent);
const click = (card, text) =>
  [...card.querySelectorAll('button')].find((b) => b.textContent === text).click();
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.findPublished.mockResolvedValue(null);
  mocks.publish.mockResolvedValue(undefined);
  mocks.unpublish.mockResolvedValue(undefined);
  mocks.loadThrowdown.mockResolvedValue({ bracket: finished(), entries });
});

describe('the Public results card', () => {
  it('on a test event says so plainly, offers no button and never asks the database', async () => {
    const { card, ready } = buildPublishCard({
      event: { ...realEvent, is_test: true },
      bracket: finished(),
      client: {},
    });
    await ready;
    expect(card.textContent).toMatch(/test event/i);
    expect(card.textContent).toMatch(/cannot be published/i);
    expect(card.querySelector('button')).toBeNull();
    expect(mocks.findPublished).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('disables Publish and says why while the event has no champion', async () => {
    const { card, ready } = buildPublishCard({
      event: realEvent,
      bracket: unfinished(),
      client: {},
    });
    await ready;
    const publish = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Publish results',
    );
    expect(publish.disabled).toBe(true);
    expect(card.textContent).toContain('not finished yet');
  });

  it('publishes the full standings by default, from a fresh read, to the event’s own organisation', async () => {
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    expect(card.querySelector('#td-publish-scope-full').checked).toBe(true);
    click(card, 'Publish results');
    await settle();
    expect(mocks.loadThrowdown).toHaveBeenCalledWith('ev1', {});
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [orgId, eventId, payload] = mocks.publish.mock.calls[0];
    expect([orgId, eventId]).toEqual(['org1', 'ev1']);
    expect(payload.format).toBe('throwdown');
    expect(payload.podium.map((p) => p.name)).toEqual(['Ana', 'Bima']);
    expect(payload.standings).toHaveLength(2);
    expect(card.textContent).toContain('Published to the public results archive');
    expect(buttons(card)).toEqual(['Unpublish', 'Update published results']);
  });

  it('publishes the podium only when that is chosen', async () => {
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    document.body.append(card); // a radio only changes when it is in the document
    card.querySelector('#td-publish-scope-podium').click();
    click(card, 'Publish results');
    await settle();
    expect(mocks.publish.mock.calls[0][2].standings).toBeUndefined();
  });

  it('does not publish when the fresh read shows the event is no longer finished', async () => {
    mocks.loadThrowdown.mockResolvedValue({ bracket: unfinished(), entries });
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    click(card, 'Publish results');
    await settle();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(card.querySelector('[role="status"]').textContent).toContain('not finished yet');
  });

  it('reflects an existing publication, and offers Update and Unpublish', async () => {
    mocks.findPublished.mockResolvedValue({ payload: { podium: [{}], standings: [{}] } });
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    expect(card.textContent).toContain('published to the public archive (the full standings)');
    expect(buttons(card)).toEqual(['Unpublish', 'Update published results']);
    click(card, 'Unpublish');
    await settle();
    expect(mocks.unpublish).toHaveBeenCalledWith('org1', 'ev1', {});
    expect(card.textContent).toContain('Removed from the public results archive');
    expect(buttons(card)).toEqual(['Publish results']);
  });

  it('turns the database’s test-event refusal into a plain sentence, not a raw error', async () => {
    mocks.publish.mockRejectedValue({
      message: 'publish_event_results: refusing to publish a test event (ev1)',
      code: 'P0001',
    });
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    click(card, 'Publish results');
    await settle();
    const feedback = card.querySelector('[role="status"]');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toMatch(/test events are never published/i);
    expect(feedback.textContent).not.toContain('P0001');
    // the organiser can try again
    expect(buttons(card)).toEqual(['Publish results']);
    expect(card.querySelector('button').disabled).toBe(false);
  });

  it('offers no publish while it cannot tell whether results are already published, and rechecks on request', async () => {
    mocks.findPublished.mockRejectedValueOnce(new Error('network'));
    const { card, ready } = buildPublishCard({ event: realEvent, bracket: finished(), client: {} });
    await ready;
    expect(card.textContent).toContain('Could not check');
    expect(buttons(card)).toEqual(['Check again']);
    mocks.findPublished.mockResolvedValueOnce({ payload: { podium: [{}] } });
    click(card, 'Check again');
    await settle();
    expect(card.textContent).toContain('published to the public archive (the podium only)');
  });

  it('does not publish for a screen that was left before the fresh read came back', async () => {
    const controller = new AbortController();
    const { card, ready } = buildPublishCard({
      event: realEvent,
      bracket: finished(),
      client: {},
      signal: controller.signal,
    });
    await ready;
    click(card, 'Publish results');
    controller.abort();
    await settle();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(card.querySelector('[role="status"]').textContent).toBe('');
  });

  it('writes nothing to the card when the screen is left while the publish is in flight', async () => {
    let finish;
    mocks.publish.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const controller = new AbortController();
    const { card, ready } = buildPublishCard({
      event: realEvent,
      bracket: finished(),
      client: {},
      signal: controller.signal,
    });
    await ready;
    click(card, 'Publish results');
    await settle();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    controller.abort();
    finish();
    await settle();
    expect(card.querySelector('[role="status"]').textContent).toBe('');
    expect(card.textContent).not.toContain('Published to the public');
  });
});
