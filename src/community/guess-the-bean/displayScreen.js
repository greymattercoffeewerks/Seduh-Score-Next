// Guess the Bean Phase 5 display. This surface is intentionally read-only:
// the organiser's authenticated setup screen owns the reveal transition.
import qrcode from 'qrcode-generator';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { fetchSessionGuessFeed, fetchSessionGuesses, fetchSessionStatus } from './sessions.js';

const POLL_MS = 4000;
const COUNTDOWN_MS = 780;
const FLY_MS = 1600;
const FEED_PHRASES = [
  'locked it in',
  'went with the gut',
  'counted twice',
  'is feeling lucky',
  'went bold',
  'did the math',
  'no hesitation',
  'says trust me',
];

export function parseDisplayParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  return { demo: params.get('demo') === '1', sessionId: params.get('session') || null };
}

export function computeWinner(guesses, beanCount) {
  // Array#sort is stable: because every fetch is created_at ascending, the
  // earliest arrival wins an equal-distance tie, exactly as legacy did.
  return (
    [...guesses].sort((a, b) => Math.abs(a.guess - beanCount) - Math.abs(b.guess - beanCount))[0] ??
    null
  );
}

export function countdownValues() {
  return [3, 2, 1, 0];
}

function hashToUnit(value) {
  let h1 = 0;
  let h2 = 0;
  for (const char of String(value)) {
    h1 = (h1 * 31 + char.charCodeAt(0)) >>> 0;
    h2 = (h2 * 17 + char.charCodeAt(0)) >>> 0;
  }
  return [(h1 % 10000) / 10000, (h2 % 10000) / 10000];
}

function participantUrl(sessionId, origin = window.location.origin) {
  return `${origin}/guess-the-bean/play/?session=${encodeURIComponent(sessionId)}`;
}

function status(title, body) {
  return el('section', { className: 'gtb-display-notice' }, [
    el('h1', { text: title }),
    el('p', { text: body }),
  ]);
}

function phrase(guess) {
  return FEED_PHRASES[Math.floor(hashToUnit(`${guess.id}${guess.name}`)[0] * FEED_PHRASES.length)];
}

export async function mountDisplayScreen(
  root,
  { client = getSupabase(), search = window.location.search, origin, signal } = {},
) {
  const { demo, sessionId: querySessionId } = parseDisplayParams(search);
  const sessionId = demo ? querySessionId || 'demo' : querySessionId;
  if (!sessionId) {
    root.replaceChildren(
      status(
        'Missing session',
        'Scan the display QR code again, or add a session to this display URL.',
      ),
    );
    return { unmount() {} };
  }

  let mounted = true;
  let pollTimer = null;
  let polling = false;
  let frame = null;
  let phase = 'live';
  let session = null;
  let guesses = [];
  let winner = null;
  let revealStarted = false;
  let countdownTimer = null;
  let finishTimer = null;
  let flyStart = 0;
  let countUpStart = 0;
  let lastCount = 0;
  let renderedFeed = new Set();

  root.replaceChildren(
    el('div', {
      className: 'gtb-display-loading',
      text: 'Loading display…',
      attrs: { role: 'status' },
    }),
  );

  const shell = el('div', { className: 'gtb-display', attrs: { 'data-orientation': 'landscape' } });
  const header = el('header', { className: 'gtb-display-header' }, [
    el('span', { className: 'gtb-display-brand', text: 'SEDÛH SCORE · BOOTH' }),
    el('h1', { text: 'Guess the Bean' }),
    el('span', { className: 'gtb-display-pill', text: '● LIVE' }),
  ]);
  const canvas = el('canvas', {
    className: 'gtb-display-canvas',
    attrs: { 'aria-label': 'Guess positions' },
  });
  const stage = el('section', { className: 'gtb-display-stage' }, [canvas]);
  const center = el('div', { className: 'gtb-display-center', attrs: { 'aria-live': 'polite' } }, [
    el('strong', { className: 'gtb-display-question', text: '?' }),
    el('strong', { className: 'gtb-display-number', text: '' }),
    el('span', { className: 'gtb-display-label', text: 'beans in the jar' }),
  ]);
  stage.appendChild(center);
  const winnerBanner = el('div', {
    className: 'gtb-display-winner',
    attrs: { 'aria-live': 'polite' },
  });
  stage.appendChild(winnerBanner);
  const listTitle = el('p', {
    className: 'gtb-display-eyebrow',
    text: 'Live feed · in order of arrival',
  });
  const list = el('div', { className: 'gtb-display-list' });
  const panel = el('aside', { className: 'gtb-display-panel' }, [listTitle, list]);
  const count = el('strong', { className: 'gtb-display-count', text: '0' });
  const qr = el('div', { className: 'gtb-display-qr', attrs: { 'aria-hidden': 'true' } });
  const qrWrap = el('div', { className: 'gtb-display-qr-wrap' }, [
    qr,
    el('span', { text: 'Scan to play' }),
  ]);
  const footer = el('footer', { className: 'gtb-display-footer' }, [
    qrWrap,
    el('p', { className: 'gtb-display-tagline', text: 'Closest guess wins.' }),
    el('div', { className: 'gtb-display-count-wrap' }, [count, el('span', { text: 'players in' })]),
  ]);
  const countdown = el(
    'div',
    { className: 'gtb-display-countdown', attrs: { 'aria-live': 'assertive' } },
    [el('strong', { text: '3' })],
  );
  const confetti = el('div', {
    className: 'gtb-display-confetti',
    attrs: { 'aria-hidden': 'true' },
  });
  for (let i = 0; i < 28; i += 1)
    confetti.appendChild(el('i', { className: 'gtb-display-confetti-piece' }));
  shell.append(
    header,
    el('div', { className: 'gtb-display-content' }, [stage, panel]),
    footer,
    countdown,
    confetti,
  );
  root.replaceChildren(shell);

  const ctx = canvas.getContext('2d');
  const displayColor = (token) => getComputedStyle(shell).getPropertyValue(token).trim();
  const question = center.querySelector('.gtb-display-question');
  const number = center.querySelector('.gtb-display-number');
  const pill = header.querySelector('.gtb-display-pill');

  function resizeCanvas() {
    const size = Math.max(240, Math.min(stage.clientWidth, stage.clientHeight) - 32);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderQr() {
    qr.replaceChildren();
    if (phase === 'done') return;
    const code = qrcode(0, 'M');
    code.addData(participantUrl(sessionId, origin));
    code.make();
    qr.innerHTML = code.createSvgTag(3);
  }

  function renderList() {
    list.replaceChildren();
    if (!guesses.length) {
      list.appendChild(
        el('p', {
          className: 'gtb-display-empty',
          text: 'No guesses yet. Scan the code below to be first.',
        }),
      );
      return;
    }
    if (phase === 'done') {
      listTitle.textContent = 'Final standings';
      [...guesses]
        .sort(
          (a, b) => Math.abs(a.guess - session.beanCount) - Math.abs(b.guess - session.beanCount),
        )
        .slice(0, 8)
        .forEach((guess, index) => {
          const row = el(
            'div',
            { className: `gtb-display-result${winner?.id === guess.id ? ' is-winner' : ''}` },
            [
              el('strong', { text: winner?.id === guess.id ? '★' : String(index + 1) }),
              el('span', { text: guess.name }),
              el('em', {
                text: `${guess.guess - session.beanCount > 0 ? '+' : ''}${guess.guess - session.beanCount}`,
              }),
            ],
          );
          list.appendChild(row);
        });
      return;
    }
    listTitle.textContent = 'Live feed · in order of arrival';
    [...guesses]
      .slice(-9)
      .reverse()
      .forEach((guess) => {
        const row = el(
          'div',
          { className: `gtb-display-feed${renderedFeed.has(guess.id) ? '' : ' is-new'}` },
          [
            el('span', { text: '🫘', attrs: { 'aria-hidden': 'true' } }),
            el('strong', { text: guess.name }),
            el('em', { text: phrase(guess) }),
          ],
        );
        list.appendChild(row);
        renderedFeed.add(guess.id);
      });
  }

  function renderState() {
    const done = phase === 'done';
    shell.dataset.orientation = session.orientation === 'portrait' ? 'portrait' : 'landscape';
    question.hidden = done;
    number.hidden = !done;
    center.querySelector('.gtb-display-label').hidden = !done;
    pill.textContent = done ? '● RESULTS' : '● LIVE';
    pill.classList.toggle('is-results', done);
    qrWrap.hidden = done;
    count.textContent = String(guesses.length);
    renderList();
    renderQr();
    if (guesses.length > lastCount) count.classList.add('is-bump');
    lastCount = guesses.length;
  }

  function showWinner() {
    winner = computeWinner(guesses, session.beanCount);
    if (!winner) return;
    const delta = Math.abs(winner.guess - session.beanCount);
    winnerBanner.replaceChildren(
      el('small', { text: '★ CLOSEST GUESS' }),
      el('strong', { text: winner.name }),
      el('span', {
        text:
          delta === 0
            ? `Guessed ${winner.guess} — dead on!`
            : `Guessed ${winner.guess} · off by ${delta}`,
      }),
    );
    winnerBanner.classList.add('is-on');
  }

  function finishReveal() {
    phase = 'done';
    countUpStart = performance.now();
    showWinner();
    confetti.classList.add('is-on');
    renderState();
  }

  function startRevealSequence() {
    if (revealStarted) return;
    revealStarted = true;
    phase = 'countdown';
    let index = 0;
    const tick = () => {
      const value = countdownValues()[index];
      if (value === 0) {
        countdown.classList.remove('is-on');
        phase = 'flying';
        flyStart = performance.now();
        finishTimer = setTimeout(finishReveal, FLY_MS + 50);
        return;
      }
      // Replace the digit every tick. This restarts the CSS animation and,
      // unlike mutating a detached prior node, cannot freeze at "3".
      const digit = el('strong', { text: String(value) });
      countdown.replaceChildren(digit);
      countdown.classList.add('is-on');
      index += 1;
      countdownTimer = setTimeout(tick, COUNTDOWN_MS);
    };
    tick();
  }

  function draw(now) {
    if (!mounted) return;
    const cssSize = canvas.width / (window.devicePixelRatio || 1);
    const mid = cssSize / 2;
    const radius = mid - 12;
    ctx.clearRect(0, 0, cssSize, cssSize);
    for (let ring = 5; ring >= 1; ring -= 1) {
      ctx.beginPath();
      ctx.arc(mid, mid, (radius * ring) / 5, 0, Math.PI * 2);
      ctx.strokeStyle = displayColor('--color-border');
      ctx.stroke();
    }
    const progress = phase === 'flying' ? Math.min(1, (now - flyStart) / FLY_MS) : 1;
    guesses.forEach((guess) => {
      const [u, v] = hashToUnit(guess.id);
      const angle = u * Math.PI * 2;
      const pre = 0.15 + v * 0.8;
      const post =
        guess.guess == null ? pre : Math.min(Math.abs(guess.guess - session.beanCount), 100) / 100;
      const factor =
        phase === 'live' || phase === 'countdown'
          ? pre
          : phase === 'flying'
            ? pre + (post - pre) * progress
            : post;
      const x = mid + Math.cos(angle) * factor * radius;
      const y = mid + Math.sin(angle) * factor * radius;
      ctx.beginPath();
      ctx.arc(x, y, winner?.id === guess.id && phase === 'done' ? 10 : 7, 0, Math.PI * 2);
      ctx.fillStyle =
        winner?.id === guess.id && phase === 'done'
          ? displayColor('--color-success')
          : displayColor('--color-accent');
      ctx.fill();
    });
    if (phase === 'done' && countUpStart) {
      const t = Math.min(1, (now - countUpStart) / 1000);
      number.textContent = String(Math.round(session.beanCount * (1 - (1 - t) ** 3)));
    }
    frame = requestAnimationFrame(draw);
  }

  async function loadData() {
    const [nextSession, feed] = await Promise.all([
      fetchSessionStatus(sessionId, client),
      fetchSessionGuessFeed(sessionId, client),
    ]);
    if (!nextSession) throw new Error('No active session found.');
    if (!nextSession.guess_enabled) throw new Error('This Guess the Bean session is not active.');
    const firstLoad = !session;
    session = { ...nextSession, beanCount: session?.beanCount ?? 0 };
    if (session.revealed) {
      const revealedGuesses = await fetchSessionGuesses(sessionId, client);
      guesses = revealedGuesses;
      const beanResult = await client.rpc('session_bean_count', { p_session_id: sessionId });
      if (beanResult.error) throw beanResult.error;
      session.beanCount = beanResult.data;
      if (firstLoad) {
        phase = 'done';
        countUpStart = 0;
        number.textContent = String(session.beanCount);
        showWinner();
      } else if (phase === 'live') startRevealSequence();
      else if (phase === 'done') showWinner();
    } else {
      guesses = feed;
    }
    renderState();
  }

  async function poll() {
    if (polling || !mounted || signal?.aborted) return;
    polling = true;
    try {
      await loadData();
    } catch (error) {
      if (mounted) root.dataset.error = describeError(error);
    } finally {
      polling = false;
    }
  }

  if (demo) {
    session = { orientation: 'landscape', revealed: false, guess_enabled: true, beanCount: 428 };
    guesses = ['Aiman', 'Sarah', 'Mei Lin'].map((name, index) => ({
      id: `demo-${index}`,
      name,
      guess: 360 + index * 55,
      created_at: String(index),
    }));
    renderState();
    setTimeout(() => {
      if (mounted) {
        session.revealed = true;
        startRevealSequence();
      }
    }, 3500);
  } else {
    try {
      await loadData();
    } catch (error) {
      root.replaceChildren(status('Display unavailable', describeError(error)));
      return { unmount() {} };
    }
    pollTimer = setInterval(poll, POLL_MS);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  frame = requestAnimationFrame(draw);
  return {
    unmount() {
      mounted = false;
      clearInterval(pollTimer);
      clearTimeout(countdownTimer);
      clearTimeout(finishTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resizeCanvas);
    },
  };
}
