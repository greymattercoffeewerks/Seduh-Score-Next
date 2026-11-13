// Vite plugin for the Seduh ID country pages (T-CTY.3). The site is plain Cloudflare static assets with no
// single-page fallback (wrangler.jsonc), so /id/country/<iso2>/ needs a real index.html at that path. The page is one
// shell (id/country/index.html) that reads its country from the path (src/marketing/countryMain.js); this writes a copy of
// the BUILT shell to id/country/<iso2>/index.html for every ISO code the app knows (about 250 tiny files, no Worker code).
// In development it serves the same shell for those paths, as the static host will.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { countryOptions } from '../src/core/country.js';

// The app's own country list (src/core/country.js, what isCountryCode answers from), so a path has a shell exactly when
// the page accepts its code.
export const COUNTRY_CODES = countryOptions().map((row) => row.iso);
const SHELL = 'id/country/index.html';

/** Pure. The shell's path for a request path that is one country's page, else null. */
export function countryShellFor(pathname) {
  return /^\/id\/country\/[A-Za-z]{2}\/?(index\.html)?$/.test(pathname) ? `/${SHELL}` : null;
}

export function countryPagesPlugin() {
  let outDir = 'dist';
  return {
    name: 'seduh-country-pages',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const shell = countryShellFor(pathname);
        if (shell) req.url = shell;
        next();
      });
    },
    closeBundle() {
      const shell = join(outDir, SHELL);
      if (!existsSync(shell)) return;
      for (const code of COUNTRY_CODES) {
        const dir = join(outDir, 'id', 'country', code.toLowerCase());
        mkdirSync(dir, { recursive: true });
        copyFileSync(shell, join(dir, 'index.html'));
      }
    },
  };
}
