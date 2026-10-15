// Entry for /admin/ (admin/index.html). The whole surface is mountAdminConsole in console.js; this file only
// finds the page's root. Kept separate so a test never boots the real client by importing the console.
import { mountAdminConsole } from './console.js';

mountAdminConsole(document.getElementById('app'));
