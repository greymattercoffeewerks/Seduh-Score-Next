import { describe, it, expect, vi } from 'vitest';
import { describeLive, liveLinks, buildLiveCard } from './liveCard.js';

const URLS = {
  phone: 'https://seduh.example/app/#/live/alpha/phone',
  projector: 'https://seduh.example/app/#/live/alpha/projector',
  splash: 'https://seduh.example/app/#/live/alpha/splash',
};

function fakeQr() {
  return () => {
    let data = '';
    return {
      addData: (text) => {
        data = text;
      },
      make: () => {},
      createSvgTag: () => `<svg data-encodes="${data}"></svg>`,
    };
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function build(input = {}, options = {}) {
  const result = buildLiveCard(
    { isLive: false, urls: URLS, ...input },
    { loadQr: () => Promise.resolve(fakeQr()), copy: vi.fn().mockResolvedValue(), ...options },
  );
  document.body.appendChild(result.element);
  return result;
}

describe('describeLive / liveLinks', () => {
  it('says live, not showing, or could not check, each in its own words', () => {
    expect(describeLive(true)).toEqual({
      state: 'live',
      headline: 'Live now on Projector / Phone',
    });
    expect(describeLive(true, ['Phone']).headline).toBe('Live now on Phone');
    expect(describeLive(true, []).headline).toBe('Live now');
    expect(describeLive(false)).toEqual({ state: 'not_showing', headline: 'Not showing' });
    expect(describeLive(null)).toEqual({ state: 'unknown', headline: 'Live status unavailable' });
    expect(describeLive(undefined).state).toBe('unknown');
  });

  it('lists only the links supplied, phone first', () => {
    expect(liveLinks(URLS).map((l) => l.key)).toEqual(['phone', 'projector', 'splash']);
    expect(liveLinks({ projector: 'https://x.test/p' }).map((l) => l.key)).toEqual(['projector']);
    expect(liveLinks({ phone: '', splash: 5, projector: 'javascript:alert(1)' })).toEqual([]);
    expect(liveLinks(undefined)).toEqual([]);
  });
});

describe('buildLiveCard', () => {
  it('shows "Live now on Projector / Phone" for a live event and offers no take-over', () => {
    const { element } = build({ isLive: true, takeOver: vi.fn() });
    expect(element.querySelector('.ok-live-headline').textContent).toBe(
      'Live now on Projector / Phone',
    );
    expect(element.dataset.state).toBe('live');
    expect(element.querySelector('.ok-live-show').hidden).toBe(true);
  });

  it('shows "Not showing" and the Show this event control when a take-over exists', () => {
    const { element } = build({ isLive: false, takeOver: vi.fn() });
    expect(element.querySelector('.ok-live-headline').textContent).toBe('Not showing');
    const button = element.querySelector('.ok-live-show');
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Show this event');
  });

  it('offers no take-over control when the format supplies none, and claims nothing when unchecked', () => {
    const { element } = build({ isLive: null });
    expect(element.querySelector('.ok-live-show').hidden).toBe(true);
    expect(element.querySelector('.ok-live-headline').textContent).toBe('Live status unavailable');
  });

  it('runs the format takeOver on click, is busy meanwhile, then moves to live', async () => {
    let release;
    const takeOver = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { element } = build({ isLive: false, takeOver });
    const button = element.querySelector('.ok-live-show');
    button.click();
    await settle();
    expect(takeOver).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    await settle();
    expect(takeOver).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await settle();
    await settle();
    expect(element.dataset.state).toBe('live');
    expect(button.hidden).toBe(true);
    expect(element.querySelector('.ok-live-status').textContent).toBe(
      'This event is now on the displays.',
    );
  });

  it('shows a refusal the format worded, and keeps the control for a retry', async () => {
    const takeOver = vi.fn().mockResolvedValue({ ok: false, message: 'Another event is live.' });
    const { element } = build({ isLive: false, takeOver });
    element.querySelector('.ok-live-show').click();
    await settle();
    await settle();
    const status = element.querySelector('.ok-live-status');
    expect(status.textContent).toBe('Another event is live.');
    expect(status.dataset.tone).toBe('error');
    expect(element.dataset.state).toBe('not_showing');
    expect(element.querySelector('.ok-live-show').hidden).toBe(false);
  });

  it('shows a worded failure when takeOver throws', async () => {
    const takeOver = vi.fn().mockRejectedValue(new Error('network'));
    const { element } = build({ isLive: false, takeOver });
    element.querySelector('.ok-live-show').click();
    await settle();
    await settle();
    expect(element.querySelector('.ok-live-status').textContent).toMatch(
      /Could not show this event/,
    );
    expect(element.querySelector('.ok-live-show').hasAttribute('aria-busy')).toBe(false);
  });

  it('can be told the live state from outside (setLive)', () => {
    const { element, setLive } = build({ isLive: false, takeOver: vi.fn() });
    setLive(true);
    expect(element.dataset.state).toBe('live');
    setLive(null);
    expect(element.dataset.state).toBe('unknown');
  });

  it('shows the links with copy and open, and a QR made from the phone link only', async () => {
    const copy = vi.fn().mockResolvedValue();
    const { element } = build({}, { copy });
    expect([...element.querySelectorAll('.ok-live-url')].map((c) => c.textContent)).toEqual([
      URLS.phone,
      URLS.projector,
      URLS.splash,
    ]);
    const open = element.querySelector('a[href="' + URLS.projector + '"]');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    await settle();
    await settle();
    expect(element.querySelector('.ok-live-qr').innerHTML).toContain(
      `data-encodes="${URLS.phone}"`,
    );
    expect(element.querySelector('.ok-live-qr').getAttribute('aria-hidden')).toBe('true');
    element.querySelectorAll('.ok-live-link-actions button')[1].click();
    await settle();
    expect(copy).toHaveBeenCalledWith(URLS.projector);
    expect(element.querySelector('.ok-live-status').textContent).toBe('Projector link copied.');
  });

  it('says so, in words, when a link cannot be copied', async () => {
    const { element } = build({}, { copy: vi.fn().mockRejectedValue(new Error('denied')) });
    element.querySelector('.ok-live-link-actions button').click();
    await settle();
    expect(element.querySelector('.ok-live-status').textContent).toMatch(/Could not copy the link/);
  });

  it('hides the QR when its library cannot load; the link stays', async () => {
    const { element } = build({}, { loadQr: () => Promise.reject(new Error('chunk failed')) });
    await settle();
    await settle();
    expect(element.querySelector('.ok-live-qr').hidden).toBe(true);
    expect(element.querySelector('.ok-live-url').textContent).toBe(URLS.phone);
  });

  it('keeps keyboard focus on the card when the take-over succeeds and the button hides', async () => {
    const { element } = build({ isLive: false, takeOver: vi.fn().mockResolvedValue({ ok: true }) });
    const button = element.querySelector('.ok-live-show');
    button.focus();
    button.click();
    await settle();
    await settle();
    expect(button.hidden).toBe(true);
    expect(document.activeElement).toBe(element.querySelector('.ok-live-headline'));
  });

  it('reports a take-over that never answers as a failure and offers the retry', async () => {
    vi.useFakeTimers();
    try {
      const { element } = build({ isLive: false, takeOver: () => new Promise(() => {}) });
      element.querySelector('.ok-live-show').click();
      await vi.advanceTimersByTimeAsync(10500);
      expect(element.querySelector('.ok-live-status').dataset.tone).toBe('error');
      expect(element.querySelector('.ok-live-show').hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stale copy timer erase a later message', async () => {
    vi.useFakeTimers();
    try {
      const takeOver = vi.fn().mockResolvedValue({ ok: false, message: 'Another event is live.' });
      const { element } = build({ isLive: false, takeOver });
      element.querySelector('.ok-live-link-actions button').click();
      await vi.advanceTimersByTimeAsync(10);
      element.querySelector('.ok-live-show').click();
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(7000);
      expect(element.querySelector('.ok-live-status').textContent).toBe('Another event is live.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be retried after a refusal and after a failure', async () => {
    const takeOver = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'Another event is live.' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true });
    const { element } = build({ isLive: false, takeOver });
    const button = element.querySelector('.ok-live-show');
    for (let i = 0; i < 3; i += 1) {
      button.click();
      await settle();
      await settle();
    }
    expect(takeOver).toHaveBeenCalledTimes(3);
    expect(element.dataset.state).toBe('live');
  });
});
