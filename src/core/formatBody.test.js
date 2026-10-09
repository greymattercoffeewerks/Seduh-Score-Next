import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFormatBody } from './formatBody.js';

function fakeBody(name) {
  return {
    name,
    hasContent: vi.fn((payload) => payload?.ok === true),
    renderBody: vi.fn(() => `cleanup:${name}`),
    destroy: vi.fn(),
  };
}

function setup() {
  const bodies = { a: [], b: [] };
  const make = (key) => () => {
    const body = fakeBody(key);
    bodies[key].push(body);
    return body;
  };
  const formatBody = createFormatBody({ a: make('a'), b: make('b') });
  return { formatBody, bodies };
}

const ok = { ok: true };
const div = () => document.createElement('div');

afterEach(() => vi.restoreAllMocks());

describe('createFormatBody', () => {
  it("hands hasContent and renderBody to the live row's own format, and returns the body's cleanup", () => {
    const { formatBody, bodies } = setup();
    const container = div();
    expect(formatBody.hasContent(ok, { format: 'a' })).toBe(true);
    expect(formatBody.hasContent({ ok: false }, { format: 'a' })).toBe(false);
    const cleanup = formatBody.renderBody(container, ok, { format: 'a', isTest: true });
    expect(cleanup).toBe('cleanup:a');
    expect(bodies.a[0].renderBody).toHaveBeenCalledWith(container, ok, {
      format: 'a',
      isTest: true,
    });
    expect(bodies.b).toHaveLength(0);
  });

  it('builds a format body once and keeps it across payloads', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.renderBody(div(), ok, { format: 'a' });
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.renderBody(div(), ok, { format: 'a' });
    expect(bodies.a).toHaveLength(1);
    expect(bodies.a[0].destroy).not.toHaveBeenCalled();
  });

  it('destroys the previous body when the format changes, and starts a returning format fresh', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.hasContent(ok, { format: 'b' });
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
    expect(bodies.b[0].destroy).not.toHaveBeenCalled();
    formatBody.hasContent(ok, { format: 'a' });
    expect(bodies.b[0].destroy).toHaveBeenCalledTimes(1);
    expect(bodies.a).toHaveLength(2);
  });

  it('renderBody on its own follows the format in its meta: it swaps bodies and renders the new one', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    const container = div();
    formatBody.renderBody(container, ok, { format: 'b' });
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
    expect(bodies.b[0].renderBody).toHaveBeenCalledTimes(1);
    expect(bodies.a[0].renderBody).not.toHaveBeenCalled();
    formatBody.renderBody(container, ok, { format: 'a' });
    expect(bodies.b[0].destroy).toHaveBeenCalledTimes(1);
    expect(bodies.a).toHaveLength(2);
    expect(bodies.a[1].renderBody).toHaveBeenCalledTimes(1);
  });

  it('has no content for a format nobody registered, and never feeds its payload to another format', () => {
    const { formatBody, bodies } = setup();
    expect(formatBody.hasContent(ok, { format: 'zzz' })).toBe(false);
    expect(formatBody.hasContent(ok)).toBe(false);
    expect(formatBody.hasContent(ok, { format: undefined })).toBe(false);
    expect(formatBody.renderBody(div(), ok, { format: 'zzz' })).toBeUndefined();
    expect(formatBody.renderBody(div(), ok)).toBeUndefined();
    expect(bodies.a).toHaveLength(0);
    expect(bodies.b).toHaveLength(0);
  });

  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty'])(
    'does not treat the inherited key "%s" as a format',
    (format) => {
      const { formatBody } = setup();
      expect(formatBody.hasContent(ok, { format })).toBe(false);
      expect(formatBody.renderBody(div(), ok, { format })).toBeUndefined();
    },
  );

  it('destroys the body of a format replaced by an unknown one, once, and a returning format is fresh', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.hasContent(ok, { format: 'zzz' });
    formatBody.hasContent(ok, { format: 'zzz' });
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
    formatBody.hasContent(ok, { format: 'a' });
    expect(bodies.a).toHaveLength(2);
    expect(bodies.a[1].destroy).not.toHaveBeenCalled();
  });

  it('destroy() ends the live body once and tolerates a body with no destroy', () => {
    const noDestroy = { hasContent: () => true, renderBody: () => undefined };
    const formatBody = createFormatBody({ a: () => noDestroy });
    formatBody.hasContent({}, { format: 'a' });
    expect(() => formatBody.destroy()).not.toThrow();

    const { formatBody: second, bodies } = setup();
    second.hasContent(ok, { format: 'a' });
    second.destroy();
    second.destroy();
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
  });

  describe("one body per event's session", () => {
    it('builds a new body, and destroys the old, when the live row moves to another event in the SAME format', () => {
      const { formatBody, bodies } = setup();
      formatBody.hasContent(ok, { format: 'a', eventId: 'ev1' });
      expect(formatBody.hasContent(ok, { format: 'a', eventId: 'ev2' })).toBe(true);
      expect(bodies.a).toHaveLength(2);
      expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
      expect(bodies.a[1].destroy).not.toHaveBeenCalled();
    });

    it('keeps the body while the same event keeps publishing', () => {
      const { formatBody, bodies } = setup();
      formatBody.hasContent(ok, { format: 'a', eventId: 'ev1' });
      formatBody.renderBody(div(), ok, { format: 'a', eventId: 'ev1' });
      formatBody.hasContent(ok, { format: 'a', eventId: 'ev1' });
      expect(bodies.a).toHaveLength(1);
      expect(bodies.a[0].destroy).not.toHaveBeenCalled();
    });

    it('the renderBody path follows a change of event too', () => {
      const { formatBody, bodies } = setup();
      formatBody.renderBody(div(), ok, { format: 'a', eventId: 'ev1' });
      formatBody.renderBody(div(), ok, { format: 'a', eventId: 'ev2' });
      expect(bodies.a).toHaveLength(2);
      expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
      expect(bodies.a[1].renderBody).toHaveBeenCalledTimes(1);
    });

    it('without an event id the body is keyed on the format alone, as before', () => {
      const { formatBody, bodies } = setup();
      formatBody.hasContent(ok, { format: 'a' });
      formatBody.hasContent(ok, { format: 'a' });
      expect(bodies.a).toHaveLength(1);
    });
  });

  it('release() destroys the live body once, and a body for the same format is then built fresh (it is not final)', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.release();
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
    formatBody.release();
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
    expect(formatBody.hasContent(ok, { format: 'a' })).toBe(true);
    expect(bodies.a).toHaveLength(2);
    expect(bodies.a[1].destroy).not.toHaveBeenCalled();
  });

  it('release() with nothing built is a no-op, and destroy() afterwards does not destroy a released body twice', () => {
    const { formatBody, bodies } = setup();
    expect(() => formatBody.release()).not.toThrow();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.release();
    formatBody.destroy();
    expect(bodies.a[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('a body whose destroy() throws is still released: logged, and the next session builds a new one', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = fakeBody('bad');
    bad.destroy.mockImplementation(() => {
      throw new Error('boom');
    });
    let built = 0;
    const formatBody = createFormatBody({
      bad: () => {
        built += 1;
        return built === 1 ? bad : fakeBody('second');
      },
    });
    formatBody.hasContent(ok, { format: 'bad' });
    expect(() => formatBody.release()).not.toThrow();
    expect(formatBody.hasContent(ok, { format: 'bad' })).toBe(true);
    expect(built).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('a late release() cannot undo destroy(): nothing is built afterwards', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.destroy();
    formatBody.release();
    expect(formatBody.hasContent(ok, { format: 'a' })).toBe(false);
    expect(formatBody.renderBody(div(), ok, { format: 'a' })).toBeUndefined();
    expect(bodies.a).toHaveLength(1);
  });

  it('after release(), renderBody builds a fresh body too, not only hasContent', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.release();
    formatBody.renderBody(div(), ok, { format: 'a' });
    expect(bodies.a).toHaveLength(2);
    expect(bodies.a[1].renderBody).toHaveBeenCalledTimes(1);
  });

  it('is final after destroy(): a late call builds nothing, so no display is left running behind an unmounted surface', () => {
    const { formatBody, bodies } = setup();
    formatBody.hasContent(ok, { format: 'a' });
    formatBody.destroy();
    expect(formatBody.hasContent(ok, { format: 'a' })).toBe(false);
    expect(formatBody.renderBody(div(), ok, { format: 'a' })).toBeUndefined();
    expect(bodies.a).toHaveLength(1);
  });

  it('a body whose destroy() throws is logged and dropped, not retried on every later call', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = fakeBody('bad');
    bad.destroy.mockImplementation(() => {
      throw new Error('boom');
    });
    const b = fakeBody('b');
    const formatBody = createFormatBody({ bad: () => bad, b: () => b });
    formatBody.hasContent(ok, { format: 'bad' });
    expect(() => formatBody.hasContent(ok, { format: 'b' })).not.toThrow();
    expect(formatBody.hasContent(ok, { format: 'b' })).toBe(true);
    expect(bad.destroy).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('a factory that throws is logged and the format has no content, and a later call tries again', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempts = 0;
    const formatBody = createFormatBody({
      a: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return fakeBody('a');
      },
    });
    expect(() => formatBody.hasContent(ok, { format: 'a' })).not.toThrow();
    expect(formatBody.hasContent(ok, { format: 'a' })).toBe(true);
    expect(attempts).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
