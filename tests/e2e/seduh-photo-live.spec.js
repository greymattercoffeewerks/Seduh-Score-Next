import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { createLoneUser, localStack } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rpc, signInPassword } from './support/api.js';

// T-ID2.C2: a claimed person's profile PHOTO against the REAL local stack.
//   A. The Storage API itself (what pgTAP cannot reach): the bucket's own refusal of a wrong type and of more than 200 KB, who may
//      write into whose folder (the owner yes; another person, an organiser-only login and anon no), that anon and other people can read
//      a photo by its exact path but can LIST nothing, the doors (set, replace, remove), and that the public profile door only returns
//      the address while the name is public.
//   B. The real page in a real browser: sign in with the emailed code, choose a LARGE JPEG that carries camera/GPS EXIF data, and
//      check what was STORED (512 x 512, 200 KB or less, no EXIF), that the public page shows it with its alt text and a report link,
//      and that removing it brings the initials back.
// Everything is fictional (invented handles and logins; the picture is drawn in the page, not a photograph of anyone).
// PHOTO_SHOTS=<dir> also saves screenshots at 360px and desktop (local only; not committed).

const expect = baseExpect.configure({ timeout: 20000 });
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const { api, anonKey } = localStack();
const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;
const hex32 = () => randomBytes(16).toString('hex');
const shotDir = process.env.PHOTO_SHOTS;
if (shotDir) mkdirSync(shotDir, { recursive: true });

async function claimedPerson(label) {
  const handle = `${label}${unique()}`;
  const user = await createLoneUser(label);
  const [identityId, accountId] = [randomUUID(), randomUUID()];
  sqlAsOwner(
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${phone()}', ${sqlText(`Photo Proof ${label}`)}, 'organiser_roster', 'BN');` +
      `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${user.userId}', ${sqlText(handle)}, 'organiser_link', now());`,
  );
  const { token } = await signInPassword(user);
  return { handle, token, accountId, user };
}

const objectUrl = (path) => `${api}/storage/v1/object/public/seduh-avatars/${path}`;
async function upload(token, path, bytes, contentType = 'image/webp') {
  const response = await fetch(`${api}/storage/v1/object/seduh-avatars/${path}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token ?? anonKey}`,
      'content-type': contentType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function list(token, prefix = '') {
  const response = await fetch(`${api}/storage/v1/object/list/seduh-avatars`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token ?? anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefix, limit: 100 }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function remove(token, path) {
  const response = await fetch(`${api}/storage/v1/object/seduh-avatars`, {
    method: 'DELETE',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token ?? anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefixes: [path] }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const profile = async (handle) =>
  (await rpc('public_seduh_profile', { p_handle: handle }, { token: null })).body;

test.describe('the Storage bucket and the doors (real Storage API, no browser)', () => {
  test('the owner uploads; the bucket itself refuses a wrong type and more than 200 KB', async () => {
    const me = await claimedPerson('own');
    const ok = await upload(me.token, `${me.handle}/${hex32()}.webp`, randomBytes(5000));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const png = await upload(
      me.token,
      `${me.handle}/${hex32()}.webp`,
      randomBytes(5000),
      'image/png',
    );
    expect([400, 415]).toContain(png.status);
    const big = await upload(me.token, `${me.handle}/${hex32()}.webp`, randomBytes(204801));
    expect([400, 413]).toContain(big.status);
    const exactly = await upload(
      me.token,
      `${me.handle}/${hex32()}.jpg`,
      randomBytes(204800),
      'image/jpeg',
    );
    expect(exactly.status, JSON.stringify(exactly.body)).toBe(200);
  });

  test("nobody else can write into, delete from or list someone else's folder; anon can read an exact path but list nothing", async () => {
    const owner = await claimedPerson('victim');
    const other = await claimedPerson('other');
    const organiserOnly = await createLoneUser('orgonly');
    const orgToken = (await signInPassword(organiserOnly)).token;
    const path = `${owner.handle}/${hex32()}.webp`;
    const bytes = randomBytes(4000);
    expect((await upload(owner.token, path, bytes)).status).toBe(200);

    // writes into someone else's folder
    for (const [who, token] of [
      ['another claimed person', other.token],
      ['a login with no Seduh ID', orgToken],
      ['anon', null],
    ]) {
      const attempt = await upload(token, `${owner.handle}/${hex32()}.webp`, randomBytes(1000));
      expect(attempt.status, who).toBeGreaterThanOrEqual(400);
    }
    // deletes of someone else's file leave it there
    for (const token of [other.token, orgToken, null]) {
      await remove(token, path);
      const still = await fetch(objectUrl(path));
      expect(still.status).toBe(200);
    }
    // anyone can read it by its exact path (it is a public photo) and it is the same bytes
    const read = await fetch(objectUrl(path));
    expect(Buffer.from(await read.arrayBuffer()).equals(bytes)).toBe(true);
    // listing: anon, another person and a login with no Seduh ID see nothing; the owner sees their own folder only
    for (const token of [null, other.token, orgToken]) {
      const answer = await list(token, owner.handle);
      expect(answer.status === 200 ? answer.body : []).toEqual([]);
      const root = await list(token, '');
      expect(root.status === 200 ? root.body : []).toEqual([]);
    }
    const own = await list(owner.token, owner.handle);
    expect(own.status).toBe(200);
    expect(own.body.map((o) => `${owner.handle}/${o.name}`)).toEqual([path]);
    // an upload outside the fixed name shape is refused even in the owner's own folder
    expect(
      (await upload(owner.token, `${owner.handle}/me.webp`, randomBytes(1000))).status,
    ).toBeGreaterThanOrEqual(400);
  });

  test('set, replace and remove through the doors; the public door shows the address only while the name is public', async () => {
    const me = await claimedPerson('door');
    const first = `${me.handle}/${hex32()}.webp`;
    const second = `${me.handle}/${hex32()}.jpg`;
    expect((await upload(me.token, first, randomBytes(3000))).status).toBe(200);

    // refused: someone else's folder, a missing object, no login
    const elsewhere = await rpc(
      'seduh_set_my_photo',
      { p_path: `someone-else/${hex32()}.webp` },
      { token: me.token },
    );
    expect(elsewhere.body.hint).toBe('bad_path');
    const missing = await rpc(
      'seduh_set_my_photo',
      { p_path: `${me.handle}/${hex32()}.webp` },
      { token: me.token },
    );
    expect(missing.body.hint).toBe('no_object');
    expect(
      (await rpc('seduh_set_my_photo', { p_path: first }, { token: null })).status,
    ).toBeGreaterThanOrEqual(400);

    const set = await rpc('seduh_set_my_photo', { p_path: first }, { token: me.token });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await profile(me.handle)).identity.photo_url).toBe(
      `/storage/v1/object/public/seduh-avatars/${first}`,
    );
    expect((await fetch(objectUrl(first))).status).toBe(200);

    // replace: the old address stops working
    expect((await upload(me.token, second, randomBytes(3000), 'image/jpeg')).status).toBe(200);
    expect((await rpc('seduh_set_my_photo', { p_path: second }, { token: me.token })).status).toBe(
      200,
    );
    expect((await profile(me.handle)).identity.photo_url).toBe(
      `/storage/v1/object/public/seduh-avatars/${second}`,
    );
    expect((await fetch(objectUrl(first))).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(objectUrl(second))).status).toBe(200);

    // hidden name: no photo on the public door, but the person's own record still has it
    expect(
      (
        await rpc(
          'seduh_set_my_settings',
          { p_settings: { vis_identity: 'hidden' } },
          { token: me.token },
        )
      ).status,
    ).toBe(200);
    expect((await profile(me.handle)).identity.photo_url).toBeNull();
    expect(
      (await rpc('seduh_my_record', {}, { token: me.token })).body.account.photo_url,
    ).toContain(second);
    expect(
      (
        await rpc(
          'seduh_set_my_settings',
          { p_settings: { vis_identity: 'public' } },
          { token: me.token },
        )
      ).status,
    ).toBe(200);

    // remove: the address dies and the page has no photo
    const removed = await rpc('seduh_remove_my_photo', {}, { token: me.token });
    expect(removed.body.removed).toBe(true);
    expect((await fetch(objectUrl(second))).status).toBeGreaterThanOrEqual(400);
    expect((await profile(me.handle)).identity.photo_url).toBeNull();
    // nothing reached the bucket either
    expect((await list(me.token, me.handle)).body).toEqual([]);
  });
});

// ---------- B. the real page ----------

test.describe('the photo in a real browser', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  async function codeFor(email) {
    const search = async () =>
      (
        await (
          await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
        ).json()
      ).messages ?? [];
    await expect
      .poll(async () => (await search()).length, { intervals: [250, 500, 1000] })
      .toBeGreaterThan(0);
    const [newest] = await search();
    const message = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
    const match = `${message.Text ?? ''}\n${message.HTML ?? ''}`.match(/\b(\d{6})\b/);
    if (!match) throw new Error('no six-digit code in the email');
    return match[1];
  }
  async function shot(page, name) {
    if (!shotDir) return;
    await page.screenshot({ path: join(shotDir, `${name}-360.png`), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(shotDir, `${name}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 360, height: 780 });
  }

  test('a large JPEG with GPS and camera data is stored as a 512 x 512 file of 200 KB or less with none of it, shows on the public page, and comes off again', async ({
    page,
    browser,
  }) => {
    const me = await claimedPerson('browser');
    await page.goto('/id/me/');
    await page.getByLabel('Your email address').fill(me.user.email);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByLabel('6-digit code').fill(await codeFor(me.user.email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#me-record-title')).toBeVisible();

    // An invented picture, drawn in the page: a 3200 x 2400 gradient with noise (so it is several MB), with an EXIF block that
    // carries a GPS tag and a camera make spliced in after the JPEG start marker.
    const fixture = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3200;
      canvas.height = 2400;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 3200, 2400);
      gradient.addColorStop(0, '#0e5a63');
      gradient.addColorStop(1, '#d9a441');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 3200, 2400);
      ctx.fillStyle = '#f4efe4';
      ctx.beginPath();
      ctx.arc(1600, 1000, 520, 0, Math.PI * 2);
      ctx.fill();
      const data = ctx.getImageData(0, 0, 3200, 2400);
      for (let i = 0; i < data.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 70;
        data.data[i] += n;
        data.data[i + 1] += n;
        data.data[i + 2] += n;
      }
      ctx.putImageData(data, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const text = new TextEncoder().encode(
        'Exif\0\0MM\0*CameraMake=ProofCam GPSLatitude=4.8903 GPSLongitude=114.9422',
      );
      const length = text.length + 2;
      const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 255, ...text]);
      const out = new Uint8Array(jpeg.length + app1.length);
      out.set(jpeg.subarray(0, 2), 0);
      out.set(app1, 2);
      out.set(jpeg.subarray(2), 2 + app1.length);
      let binary = '';
      for (let i = 0; i < out.length; i += 0x8000)
        binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const buffer = Buffer.from(fixture, 'base64');
    expect(buffer.length).toBeGreaterThan(204800 * 5); // several MB: far over the limit, under the 10 MB the page accepts
    expect(buffer.length).toBeLessThan(10 * 1024 * 1024);
    expect(buffer.includes(Buffer.from('GPSLatitude'))).toBe(true);

    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await expect(page.locator('.me-photo-initials')).toBeVisible();
    await shot(page, 'photo-empty');
    await page
      .locator('#me-photo-file')
      .setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer });
    await expect(page.locator('#me-photo-status')).toContainText('Ready:');
    await expect(page.locator('#me-photo-save')).toBeVisible();
    await shot(page, 'photo-preview');
    await page.locator('#me-photo-save').click();
    await expect(page.locator('#me-status')).toHaveText('Photo saved.');
    await expect(page.locator('img.me-photo-img')).toBeVisible();

    // what was STORED
    const stored = (await profile(me.handle)).identity.photo_url;
    expect(stored).toMatch(
      new RegExp(
        `^/storage/v1/object/public/seduh-avatars/${me.handle}/[0-9a-f]{32}\\.(webp|jpg)$`,
      ),
    );
    const bytes = Buffer.from(await (await fetch(`${api}${stored}`)).arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.length).toBeLessThanOrEqual(204800);
    for (const marker of [
      'Exif',
      'GPSLatitude',
      'GPSLongitude',
      'CameraMake',
      'ProofCam',
      'XMP',
      'http://ns.adobe.com',
    ])
      expect(
        bytes.includes(Buffer.from(marker)),
        `the stored file must not contain ${marker}`,
      ).toBe(false);
    const dims = await page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    }, `${api}${stored}`);
    expect(dims).toEqual([512, 512]);

    // the PUBLIC page, signed out, in a fresh context
    const visitor = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const pub = await visitor.newPage();
    await pub.goto(`/id/${me.handle}/`);
    const img = pub.locator('img.profile-avatar');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'Photo of Photo Proof browser');
    await expect.poll(() => img.evaluate((i) => i.naturalWidth)).toBe(512);
    await expect(pub.getByRole('link', { name: 'Report this photo' })).toHaveAttribute(
      'href',
      new RegExp(`^mailto:.*subject=.*${me.handle}`),
    );
    await expect(pub.locator('.profile-report')).toContainText('hello@seduhscore.com');
    expect(
      await pub.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await shot(pub, 'profile-with-photo');

    // remove from My Seduh ID: the public page shows initials again and no report link
    await page.getByRole('button', { name: 'Remove my photo' }).click();
    await page.getByRole('button', { name: 'Yes, remove it' }).click();
    await expect(page.locator('#me-status')).toHaveText('Photo removed.');
    await expect(page.locator('.me-photo-initials')).toBeVisible();
    await pub.reload();
    await expect(pub.locator('span.profile-avatar')).toBeVisible();
    await expect(pub.locator('img.profile-avatar')).toHaveCount(0);
    await expect(pub.locator('.profile-report')).toHaveCount(0);
    expect((await fetch(`${api}${stored}`)).status).toBeGreaterThanOrEqual(400);
    await visitor.close();
  });

  test('a file that is not a picture is refused in words and nothing is uploaded', async ({
    page,
  }) => {
    const me = await claimedPerson('notimg');
    await page.goto('/id/me/');
    await page.getByLabel('Your email address').fill(me.user.email);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByLabel('6-digit code').fill(await codeFor(me.user.email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await page.locator('#me-photo-file').setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fictional'),
    });
    await expect(page.locator('#me-photo-status')).toContainText('not a picture');
    await expect(page.locator('#me-photo-save')).toBeHidden();
    expect((await profile(me.handle)).identity.photo_url).toBeNull();
  });
});
