// Entry for the Seduh ID country pages. ONE HTML shell serves every path: the build copies id/country/index.html to
// id/country/<iso2>/index.html for every ISO code (tools/countryPagesPlugin.js), and this reads which page it is from
// the path, so a printed or QR link works on plain static hosting with no Worker and no single-page fallback.
import { parseCountryPath } from '../core/countryPages.js';
import { mountCountryHub, mountCountryPage } from './countryScreen.js';

const root = document.querySelector('#app');
const target = parseCountryPath(window.location.pathname);

if (target.kind === 'country') mountCountryPage(root, target.code);
else mountCountryHub(root);
