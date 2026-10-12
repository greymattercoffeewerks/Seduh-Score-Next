import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAudienceLinksCard } from './audienceLinksCard.js';

const URLS = {
  phone: 'https://seduh.example/app/#/live/alpha-coffee/phone',
  projector: 'https://seduh.example/app/#/live/alpha-coffee/projector',
  splash: 'https://seduh.example/app/#/live/alpha-coffee/splash',
};

// A stand-in for the QR library: records what it was asked to encode and returns a recognisable picture.
function fakeQr() {
  const encoded = [];
  const factory = () => {
    let data = '';
    return {
      addData: (text) => {
        data = text;
      },
      make: () => {
        encoded.push(data);
      },
      createSvgTag: () => `<svg data-encodes="${encoded.at(-1)}"></svg>`,
    };
  };
  return { factory, encoded };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function build(options = {}) {
  const qr = fakeQr();
  const card = buildAudienceLinksCard(URLS, {
    loadQr: () => Promise.resolve(qr.factory),
    ...options,
  });
  document.body.appendChild(card);
  return { card, qr };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('buildAudienceLinksCard (T-TEN.D4)', () => {
  it('has a heading, and one row for each of the phone, projector and splash views', () => {
    const { card } = build();
    expect(card.querySelector('h2').textContent).toBe('Share with your audience');
    expect([...card.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Phone view',
      'Projector view',
      'Splash screen',
    ]);
  });

  it('is a list a screen reader announces as one, even where list-style: none removes the default', () => {
    const { card } = build();
    const list = card.querySelector('ul');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.querySelectorAll(':scope > li')).toHaveLength(3);
  });

  it('shows each link as selectable text, as text and never as markup', () => {
    const hostile = {
      ...URLS,
      phone: 'https://seduh.example/app/#/live/<img src=x onerror=alert(1)>/phone',
    };
    const card = buildAudienceLinksCard(hostile, { loadQr: () => new Promise(() => {}) });
    document.body.appendChild(card);
    expect([...card.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      hostile.phone,
      URLS.projector,
      URLS.splash,
    ]);
    expect(card.querySelector('img')).toBeNull();
  });

  it('offers Open in a new tab for each link, with the warning a screen reader would not otherwise get', () => {
    const { card } = build();
    const opens = [...card.querySelectorAll('a')];
    expect(opens.map((a) => a.getAttribute('href'))).toEqual([
      URLS.phone,
      URLS.projector,
      URLS.splash,
    ]);
    for (const a of opens) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.querySelector('.sr-only').textContent).toBe(' (opens in a new tab)');
    }
  });

  it("names which link each button is for ('Copy link' alone would be ambiguous)", () => {
    const { card } = build();
    const labelIds = [...card.querySelectorAll('h3')].map((h) => h.id);
    const describedBy = [...card.querySelectorAll('button, a')].map((el) =>
      el.getAttribute('aria-describedby'),
    );
    expect(describedBy).toEqual([
      labelIds[0],
      labelIds[0],
      labelIds[1],
      labelIds[1],
      labelIds[2],
      labelIds[2],
    ]);
    expect(new Set(labelIds).size).toBe(3);
  });

  it('says whose displays these are, when it knows', () => {
    const named = build({ orgName: 'Alpha Coffee' }).card;
    expect(named.querySelector('.audience-links-intro').textContent).toContain(
      'These open Alpha Coffee’s displays.',
    );
    document.body.innerHTML = '';
    const anonymous = build().card;
    expect(anonymous.querySelector('.audience-links-intro').textContent).not.toContain(
      'These open',
    );
    expect(anonymous.querySelector('.audience-links-intro').textContent).toContain(
      'nobody needs to sign in',
    );
  });

  describe('the QR code', () => {
    it('encodes the PHONE link, once the library has arrived, and only on the phone row', async () => {
      const { card, qr } = build();
      await settle();
      expect(qr.encoded).toEqual([URLS.phone]);
      const hosts = card.querySelectorAll('.audience-links-qr');
      expect(hosts).toHaveLength(1);
      expect(hosts[0].closest('.audience-links-item').querySelector('h3').textContent).toBe(
        'Phone view',
      );
      expect(hosts[0].querySelector('svg').getAttribute('data-encodes')).toBe(URLS.phone);
    });

    it('is hidden from assistive technology: the link beside it says the same thing', async () => {
      const { card } = build();
      await settle();
      expect(card.querySelector('.audience-links-qr').getAttribute('aria-hidden')).toBe('true');
    });

    it('is drawn with the real library: a real SVG for a real link', async () => {
      const card = buildAudienceLinksCard(URLS);
      document.body.appendChild(card);
      await vi.waitFor(() => expect(card.querySelector('.audience-links-qr svg')).not.toBeNull());
      expect(
        card.querySelector('.audience-links-qr svg path, .audience-links-qr svg rect'),
      ).not.toBeNull();
    });

    it('leaves the links on screen, and hides the empty frame, when the library cannot be loaded', async () => {
      const { card } = build({ loadQr: () => Promise.reject(new Error('chunk failed')) });
      await settle();
      expect(card.querySelector('.audience-links-qr').hidden).toBe(true);
      expect(card.querySelectorAll('code')).toHaveLength(3);
    });

    it('hides the frame when no code can be made for the link (too long for any size)', async () => {
      const throwing = () => ({
        addData: () => {},
        make: () => {
          throw new Error('code length overflow');
        },
        createSvgTag: () => '',
      });
      const { card } = build({ loadQr: () => Promise.resolve(throwing) });
      await settle();
      expect(card.querySelector('.audience-links-qr').hidden).toBe(true);
    });

    it('is never drawn before the card is on screen with its links', () => {
      const card = buildAudienceLinksCard(URLS, { loadQr: () => new Promise(() => {}) });
      expect(card.querySelectorAll('code')).toHaveLength(3);
      expect(card.querySelector('.audience-links-qr svg')).toBeNull();
    });
  });

  describe('Copy link', () => {
    const copyButtons = (card) => [...card.querySelectorAll('button')];

    it('copies that row’s link, and says which one in a polite status line', async () => {
      const copy = vi.fn(() => Promise.resolve());
      const { card } = build({ copy });
      const status = card.querySelector('[role="status"]');
      expect(status.getAttribute('aria-live')).toBe('polite');
      copyButtons(card)[1].click();
      await settle();
      expect(copy).toHaveBeenCalledWith(URLS.projector);
      expect(status.textContent).toBe('Projector view link copied.');
      copyButtons(card)[0].click();
      await settle();
      expect(copy).toHaveBeenLastCalledWith(URLS.phone);
      expect(status.textContent).toBe('Phone view link copied.');
    });

    it('says so, and what to do, when the browser will not copy', async () => {
      const { card } = build({ copy: () => Promise.reject(new Error('denied')) });
      copyButtons(card)[0].click();
      await settle();
      expect(card.querySelector('[role="status"]').textContent).toBe(
        'Could not copy the link. Select it and copy it by hand.',
      );
    });

    it('says so when there is no clipboard at all', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      try {
        const { card } = build();
        copyButtons(card)[0].click();
        await settle();
        expect(card.querySelector('[role="status"]').textContent).toContain('Could not copy');
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else delete navigator.clipboard;
      }
    });

    it('clears the message after a few seconds, so a stale "copied" does not stay up', async () => {
      vi.useFakeTimers();
      const { card } = build({ copy: () => Promise.resolve() });
      copyButtons(card)[0].click();
      await vi.advanceTimersByTimeAsync(5);
      const status = card.querySelector('[role="status"]');
      expect(status.textContent).not.toBe('');
      await vi.advanceTimersByTimeAsync(6000);
      expect(status.textContent).toBe('');
    });

    it('keeps one status node for the card’s life (a live region that is replaced is not reliably announced)', async () => {
      const { card } = build({ copy: () => Promise.resolve() });
      const status = card.querySelector('[role="status"]');
      copyButtons(card)[0].click();
      await settle();
      copyButtons(card)[1].click();
      await settle();
      expect(card.querySelector('[role="status"]')).toBe(status);
    });
  });
});
