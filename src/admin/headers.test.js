import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// public/_headers is read by Cloudflare Workers Static Assets, not by the Vite dev server, so no browser test
// here can see it. This parses the file and holds it to what src/admin/CLAUDE.md and CONVENTIONS.md say.

const text = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');

// { '/admin': { 'X-Robots-Tag': 'noindex, nofollow', ... }, '/admin/*': { ... } }
function parse(source) {
  const rules = {};
  let current = null;
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = raw.trim();
      rules[current] = {};
    } else {
      const index = raw.indexOf(':');
      rules[current][raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
    }
  }
  return rules;
}

const rules = parse(text);

describe('public/_headers', () => {
  it('has rules for the admin console and for nothing else', () => {
    // A rule for a path other pages share (the hashed /assets/ files serve every entry) would change them too.
    expect(Object.keys(rules).sort()).toEqual(['/admin', '/admin/*']);
  });

  it('gives /admin and /admin/* exactly the same headers', () => {
    expect(rules['/admin']).toEqual(rules['/admin/*']);
  });

  it('keeps the page out of search, caches, frames and referrers', () => {
    for (const headers of Object.values(rules)) {
      expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
      expect(headers['Cache-Control']).toBe('no-store');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Referrer-Policy']).toBe('no-referrer');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    }
  });

  it('the content security policy lets scripts come only from this site and runs no inline code', () => {
    const policy = Object.fromEntries(
      rules['/admin']['Content-Security-Policy']
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources]),
    );
    expect(policy['default-src']).toEqual(["'none'"]);
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'none'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    // The only place the page may talk to besides itself is the Supabase project, and the QR code is a data: image.
    expect(policy['connect-src']).toEqual(["'self'", 'https://*.supabase.co']);
    expect(policy['img-src']).toEqual(["'self'", 'data:']);
    for (const sources of Object.values(policy)) {
      expect(sources).not.toContain("'unsafe-inline'");
      expect(sources).not.toContain("'unsafe-eval'");
      expect(sources).not.toContain('*');
    }
  });

  it('the page itself loads nothing the policy would block', () => {
    const html = readFileSync(join(process.cwd(), 'admin', 'index.html'), 'utf8');
    // No inline script or style, no off-site resource.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\bstyle\s*=/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i);
  });
});
