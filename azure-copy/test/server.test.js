import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { openDatabase, pruneUnusedMedia } from '../database.js';
import { openStorage } from '../storage.js';
import { validateEntity, validateSubmission, InputError } from '../validation.js';
import { CATEGORY_OPTIONS, PAYMENT_OPTIONS, AUDIENCE_OPTIONS } from '../public/options.js';
import { emptyWeek, copySundayHours } from '../public/store-hours.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logoPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
test('persistent calendar API and administrator flows', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sale-calendar-test-'));
  const databaseUrl = process.env.TEST_DATABASE_URL || '';
  if (databaseUrl && new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('API tests only accept a local PostgreSQL test database');
  t.diagnostic(databaseUrl ? 'Backend: PostgreSQL' : 'Backend: SQLite');
  let child, base, cookie = '';
  let userCookie = '';
  let contactMessageId;
  const password = 'Test-password-123456!';
  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl, RENDER: '', DATA_DIR: directory, ADMIN_PASSWORD: password, PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test', AUTH_TEST_CODE: '123456' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = /Sale calendar: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, 'exit');
    child.kill();
    await exit;
  }
  async function request(path, method = 'GET', data, authenticated = true, origin = base) {
    const response = await fetch(`${base}/api/${path}`, {
      method, headers: { Origin: origin, ...(authenticated && cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  async function accountRequest(path, method = 'GET', data, authenticated = true) {
    const response = await fetch(`${base}/api/${path}`, {
      method,
      headers: { Origin: base, ...(authenticated && userCookie ? { Cookie: userCookie } : {}), 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  await t.test('serves the RTL website and denies untrusted writes', async () => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const pageHTML = await page.text();
    assert.match(pageHTML, /lang="he" dir="rtl"/);
    assert.doesNotMatch(pageHTML, /data-tab="favorites"/);
    assert.match(pageHTML, /class="account-link" href="#account" data-tab="account"/);
    assert.match(pageHTML, /data-account-label>האזור האישי/);
    assert.doesNotMatch(pageHTML, /href="#admin"/);
    assert.doesNotMatch(pageHTML, /כניסת מנהלת/);
    assert.match(pageHTML, /href="#contact"/);
    assert.match(pageHTML, /href="#contact" data-tab="contact"/);
    const adminFilters = await fetch(`${base}/admin-sales.js`);
    assert.equal(adminFilters.status, 200);
    assert.match(await adminFilters.text(), /export function filterAdminSales/);
    const favoritesModule = await fetch(`${base}/favorites.js`);
    assert.equal(favoritesModule.status, 200);
    assert.match(favoritesModule.headers.get('content-type'), /text\/javascript/);
    assert.match(await favoritesModule.text(), /export function toggleFavorite/);
    assert.match(pageHTML, /ShopPop — כל המכירות\. לדעת איפה\. לדעת מתי\./);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');
    const font = await fetch(`${base}/Rubik.ttf`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/ttf');
    assert.ok((await font.arrayBuffer()).byteLength > 10000);
    const license = await fetch(`${base}/Rubik-LICENSE.txt`);
    assert.equal(license.status, 200);
    assert.match(await license.text(), /SIL OPEN FONT LICENSE/);
    const headingFont = await fetch(`${base}/Heebo.ttf`);
    assert.equal(headingFont.status, 200);
    assert.equal(headingFont.headers.get('content-type'), 'font/ttf');
    assert.ok((await headingFont.arrayBuffer()).byteLength > 10000);
    const headingLicense = await fetch(`${base}/Heebo-LICENSE.txt`);
    assert.equal(headingLicense.status, 200);
    assert.match(await headingLicense.text(), /SIL OPEN FONT LICENSE/);
    const cities = await fetch(`${base}/cities.json`);
    assert.equal(cities.status, 200);
    assert.equal(cities.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.ok((await cities.json()).cities.length > 1000);
    assert.equal((await fetch(`${base}/options.js`)).status, 200);
    const dates = await fetch(`${base}/dates.js`);
    assert.equal(dates.status, 200);
    assert.match(dates.headers.get('content-type'), /javascript/);
    assert.match(await dates.text(), /export function dateDetails/);
    const cityHelpers = await fetch(`${base}/cities.js`);
    assert.equal(cityHelpers.status, 200);
    assert.match(cityHelpers.headers.get('content-type'), /javascript/);
    assert.equal((await request('stores', 'POST', {}, false)).status, 401);
    assert.equal((await request('sales/overlaps', 'POST', {}, false)).status, 401);
    assert.equal((await request('sales/merge', 'POST', {}, false)).status, 401);
    assert.equal((await request('login', 'POST', { password }, false, 'https://wrong.example')).status, 403);
    assert.equal((await fetch(`${base}/data/calendar.sqlite`)).status, 404);
    assert.deepEqual((await request('data')).data, { stores: [], venues: [], sales: [] });
  });
  await t.test('logs in using an HttpOnly session', async () => {
    assert.equal((await request('login', 'POST', { password: 'wrong' })).status, 401);
    const login = await request('login', 'POST', { password });
    assert.equal(login.status, 200);
    assert.match(login.cookie, /HttpOnly/);
    assert.match(login.cookie, /SameSite=Strict/);
    cookie = login.cookie.split(';')[0];
    assert.equal((await request('auth')).data.authenticated, true);
  });
  await t.test('registers profiles, supports password and code login, resets passwords and synchronizes favorites', async () => {
    const email = 'user@example.com';
    const userPassword = 'User-password-123!';
    const newPassword = 'New-user-password-456!';
    const profile = {
      firstName: 'שרה', lastName: 'כהן', birthDate: '2000-05-12', gender: 'female', city: 'ירושלים',
      updatesCity: true, updatesFavorites: true, updatesSales: false, updatesDaily: false, updatesOutlet: true, adsConsent: false,
    };
    assert.deepEqual((await accountRequest('account')).data, { authenticated: false });
    assert.equal((await accountRequest('user/favorites', 'GET', undefined, false)).status, 401);
    assert.equal((await accountRequest('account/request-code', 'POST', { email: 'invalid' }, false)).status, 400);
    assert.equal((await accountRequest('account/register', 'POST', { email, password: 'short', profile }, false)).status, 400);
    assert.equal((await accountRequest('account/register', 'POST', { email, password: userPassword, profile: { ...profile, city: 'לא קיימת' } }, false)).status, 400);
    assert.equal((await accountRequest('account/register', 'POST', { email: 'User@Example.com', password: userPassword, profile }, false)).status, 200);
    assert.equal((await accountRequest('account/register/verify', 'POST', { email, code: '000000' }, false)).status, 401);
    const registration = await accountRequest('account/register/verify', 'POST', { email, code: '123456' }, false);
    assert.equal(registration.status, 200);
    assert.match(registration.cookie, /user_session=/);
    assert.match(registration.cookie, /HttpOnly/);
    assert.match(registration.cookie, /SameSite=Strict/);
    userCookie = registration.cookie.split(';')[0];
    assert.deepEqual((await accountRequest('account')).data, { authenticated: true, email, profile });
    assert.deepEqual((await accountRequest('user/favorites')).data, { sales: [], stores: [] });
    assert.deepEqual((await accountRequest('user/favorites', 'PUT', { sales: [4, 4], stores: [2] })).data, { sales: [4], stores: [2] });
    assert.deepEqual((await accountRequest('user/favorites/sync', 'POST', { sales: [5], stores: [2, 3] })).data, { sales: [4, 5], stores: [2, 3] });
    assert.equal((await accountRequest('user/favorites', 'PUT', { sales: [0], stores: [] })).status, 400);
    const updatedProfile = { ...profile, city: 'בני ברק', updatesDaily: true, updatesOutlet: false, adsConsent: true };
    assert.deepEqual((await accountRequest('account/profile', 'PUT', updatedProfile)).data, updatedProfile);
    assert.deepEqual((await accountRequest('account')).data.profile, updatedProfile);
    assert.equal((await accountRequest('account/logout', 'POST', {})).status, 200);
    assert.equal((await accountRequest('account')).data.authenticated, false);
    userCookie = '';
    assert.equal((await accountRequest('account/login', 'POST', { email, password: 'wrong-password' }, false)).status, 401);
    const passwordLogin = await accountRequest('account/login', 'POST', { email, password: userPassword }, false);
    assert.equal(passwordLogin.status, 200);
    userCookie = passwordLogin.cookie.split(';')[0];
    assert.equal((await accountRequest('account/logout', 'POST', {})).status, 200);
    userCookie = '';
    assert.equal((await accountRequest('account/request-code', 'POST', { email }, false)).status, 200);
    const codeLogin = await accountRequest('account/verify', 'POST', { email, code: '123456' }, false);
    assert.equal(codeLogin.status, 200);
    userCookie = codeLogin.cookie.split(';')[0];
    assert.equal((await accountRequest('account/logout', 'POST', {})).status, 200);
    userCookie = '';
    assert.equal((await accountRequest('account/reset/request', 'POST', { email }, false)).status, 200);
    assert.equal((await accountRequest('account/reset', 'POST', { email, code: '000000', password: newPassword }, false)).status, 401);
    assert.equal((await accountRequest('account/reset', 'POST', { email, code: '123456', password: newPassword }, false)).status, 200);
    assert.equal((await accountRequest('account/login', 'POST', { email, password: userPassword }, false)).status, 401);
    const finalLogin = await accountRequest('account/login', 'POST', { email, password: newPassword }, false);
    assert.equal(finalLogin.status, 200);
    userCookie = finalLogin.cookie.split(';')[0];
  });
  await t.test('contact messages stay private, support read state and limit public submissions', async () => {
    const data = { name: 'Private message sender', email: 'sender@example.com', phone: '', subject: 'Private subject', message: '<b>Private message</b>\nSecond line', read: true };
    assert.equal((await request('messages', 'POST', data, false, 'https://wrong.example')).status, 403);
    const created = await request('messages', 'POST', data, false);
    assert.equal(created.status, 201);
    assert.equal(created.data.ok, true);
    assert.equal(created.data.email, undefined);
    assert.equal((await request('messages', 'GET', undefined, false)).status, 401);
    const items = (await request('messages')).data;
    assert.equal(items.length, 1);
    contactMessageId = items[0].id;
    assert.equal(items[0].name, data.name);
    assert.equal(items[0].message, data.message);
    assert.equal(items[0].read, false);
    assert.ok(Number.isSafeInteger(items[0].created));
    assert.equal((await request(`messages/${contactMessageId}`, 'PATCH', { read: true }, false)).status, 401);
    for (const invalid of [null, {}, { read: 'yes' }, { read: 1 }]) {
      assert.equal((await request(`messages/${contactMessageId}`, 'PATCH', invalid)).status, 400);
    }
    assert.equal((await request('messages/999999', 'PATCH', { read: true })).status, 404);
    assert.equal((await request(`messages/${contactMessageId}`, 'PATCH', { read: true })).status, 200);
    assert.equal((await request('messages')).data[0].read, true);
    assert.equal((await request(`messages/${contactMessageId}`, 'PATCH', { read: false })).status, 200);
    assert.equal((await request('messages')).data[0].read, false);
    assert.equal((await request(`messages/${contactMessageId}`, 'PATCH', { read: true })).status, 200);
    const publicData = JSON.stringify((await request('data', 'GET', undefined, false)).data);
    assert.ok(!publicData.includes(data.name) && !publicData.includes(data.email) && !publicData.includes(data.message));
    assert.equal((await request('messages', 'POST', { ...data, email: '', phone: '050-1234567' }, false)).status, 201);
    assert.equal((await request('messages')).data[0].phone, '050-1234567');
    assert.equal((await request('messages', 'POST', { ...data, message: '' }, false)).status, 400);
    const malformed = await fetch(`${base}/api/messages`, { method: 'POST', headers: { Origin: base }, body: '{' });
    assert.equal(malformed.status, 400);
    const oversized = await fetch(`${base}/api/messages`, { method: 'POST', headers: { Origin: base }, body: 'x'.repeat(32_769) });
    assert.equal(oversized.status, 400);
    assert.equal((await request('messages', 'POST', data, false)).status, 429);
    assert.equal((await request('messages')).data.length, 2);
  });
  let first, second, venue, sale, firstPoster, secondPoster;
  const store = { name: 'חנות לבדיקה', phone: '', website: '', catalog: '', categories: ['אופנה', 'ילדים'], addresses: [{ address: 'כתובת קבועה', hours: '10:00–19:00' }] };
  await t.test('creates optional store details and an exact venue address', async () => {
    const created = await request('stores', 'POST', store);
    assert.equal(created.status, 201);
    first = created.data;
    assert.equal(first.logo, '');
    second = (await request('stores', 'POST', { ...store, name: 'חנות שנייה', addresses: [] })).data;
    const createdVenue = await request('venues', 'POST', { name: 'האולם', city: 'ירושלים', address: 'רחוב בדיקה 12', phone: '' });
    assert.equal(createdVenue.status, 201);
    venue = createdVenue.data;
    assert.equal((await request('venues', 'POST', { name: 'ללא עיר', address: 'רחוב' })).status, 400);
    assert.equal((await request('stores', 'POST', { ...store, website: 'javascript:alert(1)' })).status, 400);
    assert.equal((await request('stores', 'POST', { ...store, addresses: [null] })).status, 400);
  });
  await t.test('stores nonuniform opening hours and structured accessible venue details', async () => {
    const hours = 'א׳–ה׳ 10:00–19:00\nיום ג׳ 12:00–20:00\nיום ו׳ 09:00–13:00\n18.10: סגור';
    const savedStore = await request(`stores/${second.id}`, 'PUT', { ...second, addresses: [{ address: 'כתובת קבועה 2', hours }] });
    assert.equal(savedStore.status, 200);
    second = savedStore.data;
    assert.equal(second.addresses[0].hours, hours);
    assert.equal((await request('streets?city=' + encodeURIComponent('ירושלים'), 'GET', undefined, false)).status, 401);
    assert.equal((await request('streets')).status, 400);
    const result = await request('streets?city=' + encodeURIComponent('ירושלים'));
    assert.equal(result.status, 200);
    assert.ok(result.data.streets.includes('יפו'));
    assert.deepEqual(result.data.streets, [...new Set(result.data.streets)].sort((a, b) => a.localeCompare(b, 'he')));
    assert.deepEqual((await request('streets?city=__proto__')).data.streets, []);
    const savedVenue = await request(`venues/${venue.id}`, 'PUT', {
      ...venue, street: 'יפו', buildingNumber: '12א', address: 'כתובת ישנה שלא צריכה להישמר',
      entrance: 'כניסה ב׳, קומה 2', arrivalNotes: 'הכניסה מהחצר\nמעלית בצד שמאל', accessibility: 'yes',
    });
    assert.equal(savedVenue.status, 200);
    venue = savedVenue.data;
    assert.equal(venue.address, 'יפו 12א');
    assert.equal(venue.accessibility, 'yes');
    assert.equal((await request(`venues/${venue.id}`, 'PUT', { ...venue, street: 'רחוב שלא קיים במאגר' })).status, 400);
    assert.equal((await request(`venues/${venue.id}`, 'PUT', { ...venue, city: 'עיר לא קיימת' })).status, 400);
    for (const accessibility of [true, false, null, 'maybe']) assert.equal((await request(`venues/${venue.id}`, 'PUT', { ...venue, accessibility })).status, 400);
  });
  await t.test('saves multiple structured store addresses and validates their streets and weekly hours', async () => {
    const module = await fetch(`${base}/store-hours.js`);
    assert.equal(module.status, 200);
    const week = emptyWeek();
    week[0] = { day: 0, status: 'open', open: '10:00', close: '19:00' };
    week[6] = { day: 6, status: 'open', open: '08:00', close: '13:00', open2: '16:00', close2: '22:00' };
    week[5].status = 'closed';
    const address = { city: 'ירושלים', street: 'יפו', buildingNumber: '14א', arrivalNotes: 'כניסה מהחצר\nקומה 2', hours: 'בחגים יש לברר מראש', weeklyHours: copySundayHours(week) };
    const saved = await request(`stores/${second.id}`, 'PUT', { ...second, addresses: [second.addresses[0], address] });
    assert.equal(saved.status, 200);
    second = saved.data;
    assert.equal(second.addresses[1].address, 'יפו 14א');
    assert.deepEqual(second.addresses[1].weeklyHours, address.weeklyHours);
    assert.equal(second.addresses[1].arrivalNotes, address.arrivalNotes);
    for (const fields of [{ city: 'עיר לא קיימת' }, { street: 'רחוב שלא קיים' }, { city: '' }, { street: '' }, { weeklyHours: [] }]) {
      assert.equal((await request(`stores/${second.id}`, 'PUT', { ...second, addresses: [{ ...address, ...fields }] })).status, 400);
    }
    const badWeek = structuredClone(address.weeklyHours);
    badWeek[1].close = '09:00';
    assert.equal((await request(`stores/${second.id}`, 'PUT', { ...second, addresses: [{ ...address, weeklyHours: badWeek }] })).status, 400);
    for (const fields of [{ open2: '12:00' }, { close2: '02:00' }, { open2: '25:00' }, { status: 'closed', open: '', close: '' }]) {
      const invalid = structuredClone(address.weeklyHours);
      Object.assign(invalid[6], fields);
      assert.equal((await request(`stores/${second.id}`, 'PUT', { ...second, addresses: [{ ...address, weeklyHours: invalid }] })).status, 400);
    }
    const data = (await request('data')).data.stores.find(store => store.id === second.id);
    assert.equal(data.addresses.length, 2);
    assert.equal(data.addresses[0].hours, second.addresses[0].hours);
    assert.deepEqual(data.addresses[1], second.addresses[1]);
  });
  await t.test('uploads, replaces, removes and validates persistent store logos', async () => {
    assert.equal((await request('stores', 'POST', { ...store, logo: logoPNG }, false)).status, 401);
    const uploaded = await request(`stores/${first.id}`, 'PUT', { ...first, logo: logoPNG });
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.data.logo, logoPNG);
    assert.equal((await request('data')).data.stores.find(s => s.id === first.id).logo, logoPNG);
    const removed = await request(`stores/${first.id}`, 'PUT', { ...first, logo: '' });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.logo, '');
    const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z';
    const webp = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=';
    for (const logo of [jpeg, webp, logoPNG]) {
      const replaced = await request(`stores/${second.id}`, 'PUT', { ...second, logo });
      assert.equal(replaced.status, 200);
      assert.equal(replaced.data.logo, logo);
    }
    for (const logo of [
      'https://example.com/logo.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,aGVsbG8=',
      logoPNG.replace('image/png', 'image/jpeg'),
      null, 42,
    ]) {
      assert.equal((await request(`stores/${second.id}`, 'PUT', { ...second, logo })).status, 400);
    }
    const maxPNG = Buffer.alloc(153_600);
    Buffer.from(logoPNG.split(',')[1], 'base64').copy(maxPNG);
    assert.equal((await request(`stores/${first.id}`, 'PUT', { ...first, logo: `data:image/png;base64,${maxPNG.toString('base64')}` })).status, 200);
    const tooLarge = Buffer.concat([maxPNG, Buffer.alloc(1)]);
    assert.equal((await request(`stores/${first.id}`, 'PUT', { ...first, logo: `data:image/png;base64,${tooLarge.toString('base64')}` })).status, 400);
    assert.equal((await request('data')).data.stores.find(s => s.id === second.id).logo, logoPNG);
  });
  await t.test('uploads bounded advertisement images and keeps drafts private', async () => {
    assert.equal((await request('media', 'POST', { image: logoPNG }, false)).status, 401);
    assert.equal((await request('media', 'POST', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
    assert.equal((await request('media', 'POST', { image: 'data:image/png;base64,aGVsbG8=' })).status, 400);
    const firstUpload = await request('media', 'POST', { image: logoPNG });
    assert.equal(firstUpload.status, 201);
    firstPoster = firstUpload.data.id;
    secondPoster = (await request('media', 'POST', { image: logoPNG })).data.id;
    assert.notEqual(firstPoster, secondPoster);
    assert.equal((await fetch(`${base}/api/media/${firstPoster}`)).status, 404);
    const privateImage = await fetch(`${base}/api/media/${firstPoster}`, { headers: { Cookie: cookie } });
    assert.equal(privateImage.status, 200);
    assert.equal(privateImage.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()), Buffer.from(logoPNG.split(',')[1], 'base64'));
    const maxImage = Buffer.alloc(768_000);
    Buffer.from(logoPNG.split(',')[1], 'base64').copy(maxImage);
    assert.equal((await request('media', 'POST', { image: `data:image/png;base64,${maxImage.toString('base64')}` })).status, 201);
    const tooLarge = Buffer.concat([maxImage, Buffer.alloc(1)]);
    assert.equal((await request('media', 'POST', { image: `data:image/png;base64,${tooLarge.toString('base64')}` })).status, 400);
  });
  await t.test('creates multi-store nonconsecutive days and individual payment overrides', async () => {
    const data = {
      title: 'מכירה לבדיקה', venueId: venue.id,
      stores: [{ storeId: first.id, payment: '', description: 'תיאור החנות במכירה הראשונה', posterId: firstPoster }, { storeId: second.id, payment: 'מזומן בלבד' }],
      days: [{ date: '2026-10-20', open: '09:00', close: '18:00' }, { date: '2026-10-17', open: '10:00', close: '20:00' }],
      categories: ['מבצעים', 'כלי בית'], audiences: ['נשים', 'ילדים', 'נשים'], payment: 'אשראי, ביט', notes: 'הערה מיוחדת', description: 'תיאור כללי של המכירה',
    };
    const created = await request('sales', 'POST', data);
    assert.equal(created.status, 201);
    sale = created.data;
    assert.equal(sale.days[0].date, '2026-10-17');
    assert.equal(sale.stores[1].payment, 'מזומן בלבד');
    assert.equal(sale.description, data.description);
    assert.deepEqual(sale.audiences, ['נשים', 'ילדים']);
    assert.equal(sale.stores[0].description, data.stores[0].description);
    assert.equal(sale.stores[0].posterId, firstPoster);
    assert.equal(sale.stores[1].posterId, '');
    assert.equal((await fetch(`${base}/api/media/${firstPoster}`)).status, 200);
    assert.equal((await request('sales', 'POST', { ...data, description: 'x'.repeat(4001) })).status, 400);
    assert.equal((await request('sales', 'POST', { ...data, stores: [{ ...data.stores[0], description: 'x'.repeat(4001) }] })).status, 400);
    assert.equal((await request('sales', 'POST', { ...data, stores: [{ ...data.stores[0], posterId: '00000000-0000-0000-0000-000000000000' }] })).status, 400);
    assert.equal((await request('sales', 'POST', { ...data, stores: [] })).status, 400);
    assert.equal((await request('sales', 'POST', { ...data, stores: [{ storeId: 999999, payment: '' }] })).status, 400);
    assert.equal((await request('sales', 'POST', { ...data, stores: [data.stores[0], data.stores[0]] })).status, 400);
    for (const days of [[], [{ date: '2026-02-30', open: '10:00', close: '20:00' }], [data.days[0], data.days[0]], [{ date: '2026-10-18', open: '20:00', close: '10:00' }]]) {
      assert.equal((await request('sales', 'POST', { ...data, days })).status, 400);
    }
    assert.equal((await request(`stores/${first.id}`, 'DELETE')).status, 409);
    assert.equal((await request(`venues/${venue.id}`, 'DELETE')).status, 409);
    assert.equal((await request('data')).data.sales.length, 1);
  });
  let submissionId;
  await t.test('validates sale notices and preserves legacy scheduled behavior', async () => {
    assert.equal(sale.status, 'scheduled');
    for (const status of [null, '', 'invalid', true]) assert.equal((await request(`sales/${sale.id}`, 'PUT', { ...sale, status })).status, 400);
    for (const status of ['cancelled', 'postponed', 'changed']) {
      assert.equal((await request(`sales/${sale.id}`, 'PUT', { ...sale, status, statusNote: ' ' })).status, 400);
      const updated = await request(`sales/${sale.id}`, 'PUT', { ...sale, status, statusNote: 'שעות / מועד השתנו' });
      assert.equal(updated.status, 200);
      assert.equal((await request('data', 'GET', undefined, false)).data.sales.find(item => item.id === sale.id).status, status);
    }
    const { status, statusNote, ...legacy } = sale;
    assert.equal((await request(`sales/${sale.id}`, 'PUT', legacy)).data.status, 'scheduled');
    assert.equal((await request(`sales/${sale.id}`, 'PUT', { ...sale, statusNote: 'x'.repeat(2001) })).status, 400);
  });
  await t.test('public submissions remain private until atomic administrator approval', async () => {
    const submission = {
      contactName: 'Private contact', contactPhone: '050-1234567',
      storeNames: [first.name, second.name], title: 'Requested sale', venueName: venue.name, city: venue.city, address: venue.address,
      days: sale.days, categories: ['כלי בית'], audiences: ['נשים'], description: 'Submitted description',
      notes: 'Submitted notes', payment: 'מזומן', isOutlet: true, poster: logoPNG,
    };
    assert.equal((await request('submissions', 'POST', submission, false, 'https://wrong.example')).status, 403);
    assert.equal((await request('submissions', 'POST', { ...submission, contactPhone: 'bad' }, false)).status, 400);
    assert.equal((await request('submissions', 'POST', { ...submission, poster: 'data:image/svg+xml;base64,PHN2Zz4=' }, false)).status, 400);
    const before = (await request('data')).data;
    const created = await request('submissions', 'POST', submission, false);
    assert.equal(created.status, 201);
    assert.equal(created.data.id, undefined);
    assert.deepEqual((await request('data')).data, before);
    assert.equal((await request('submissions', 'GET', undefined, false)).status, 401);
    const items = (await request('submissions')).data;
    submissionId = items[0].id;
    assert.equal(items[0].status, 'pending');
    assert.equal(items[0].contactName, submission.contactName);
    assert.equal(items[0].poster, logoPNG);
    assert.equal((await request(`submissions/${submissionId}/approve`, 'POST', sale, false)).status, 401);
    assert.equal((await request(`submissions/${submissionId}/reject`, 'POST', {}, false)).status, 401);
    assert.equal((await request(`submissions/${submissionId}/poster`, 'POST', {}, false)).status, 401);
    const poster = (await request(`submissions/${submissionId}/poster`, 'POST', {})).data.id;
    assert.equal((await request(`submissions/${submissionId}/poster`, 'POST', {})).data.id, poster);
    assert.equal((await fetch(`${base}/api/media/${poster}`)).status, 404);
    const provider = databaseUrl ? await openStorage({ databaseUrl }) : null;
    const storage = provider ? await provider.connect() : openDatabase(directory);
    try {
      await storage.prepare('UPDATE media SET created=? WHERE id=?').run(Date.now() - 2 * 86400_000, poster);
      await pruneUnusedMedia(storage);
      assert.ok(await storage.prepare('SELECT id FROM media WHERE id=?').get(poster));
      await storage.exec(provider
        ? `CREATE FUNCTION reject_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced approval failure'; END $$;
           CREATE TRIGGER fail_approval BEFORE UPDATE OF status ON submissions FOR EACH ROW WHEN (NEW.status='approved') EXECUTE FUNCTION reject_approval()`
        : `CREATE TRIGGER fail_approval BEFORE UPDATE OF status ON submissions
           WHEN NEW.status='approved' BEGIN SELECT RAISE(ABORT, 'forced approval failure'); END;`);
      assert.equal((await request(`submissions/${submissionId}/approve`, 'POST', sale)).status, 500);
      assert.deepEqual((await request('data')).data, before);
      assert.equal((await request('submissions')).data[0].status, 'pending');
      await storage.exec(provider ? 'DROP TRIGGER fail_approval ON submissions; DROP FUNCTION reject_approval()' : 'DROP TRIGGER fail_approval');
    } finally {
      if (provider) { storage.release(); await provider.close(); } else storage.close();
    }
    assert.equal((await request(`submissions/${submissionId}/approve`, 'POST', { ...sale, stores: [] })).status, 400);
    assert.equal((await request('submissions')).data[0].status, 'pending');
    assert.deepEqual((await request('data')).data, before);
    const approved = await request(`submissions/${submissionId}/approve`, 'POST', { ...sale, title: 'Reviewed title', stores: [{ storeId: first.id, posterId: poster }] });
    assert.equal(approved.status, 200);
    const publicData = (await request('data', 'GET', undefined, false)).data;
    assert.equal(publicData.sales.length, before.sales.length + 1);
    assert.equal(publicData.sales.find(item => item.id === approved.data.saleId).title, 'Reviewed title');
    assert.equal(JSON.stringify(publicData).includes(submission.contactName), false);
    assert.equal(JSON.stringify(publicData).includes(submission.contactPhone), false);
    assert.equal((await fetch(`${base}/api/media/${poster}`)).status, 200);
    const double = await Promise.all([request(`submissions/${submissionId}/approve`, 'POST', sale), request(`submissions/${submissionId}/reject`, 'POST', {})]);
    assert.deepEqual(double.map(result => result.status), [409, 409]);
    assert.equal((await request('data')).data.sales.length, publicData.sales.length);
    assert.equal((await request(`sales/${approved.data.saleId}`, 'DELETE')).status, 200);
    assert.equal((await request('submissions')).data[0].sale_id, null);
    assert.equal((await request('submissions', 'POST', submission, false)).status, 201);
    const rejectedId = (await request('submissions')).data[0].id;
    assert.equal((await request(`submissions/${rejectedId}/reject`, 'POST', {})).status, 200);
    assert.equal((await request(`submissions/${rejectedId}/approve`, 'POST', sale)).status, 409);
    assert.equal((await request('submissions', 'POST', submission, false)).status, 201);
    assert.equal((await request('submissions', 'POST', submission, false)).status, 429);
  });
  await t.test('validates, updates and clears multiple audiences while accepting legacy sales', async () => {
    for (const audiences of [null, 'נשים', ['לא ברשימה'], [123], Array(10).fill('נשים')]) {
      const result = await request('sales', 'POST', { ...sale, audiences });
      assert.equal(result.status, 400);
      assert.match(result.data.error, /קהל יעד/);
    }
    const updated = await request(`sales/${sale.id}`, 'PUT', { ...sale, audiences: AUDIENCE_OPTIONS });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.data.audiences, AUDIENCE_OPTIONS);
    const cleared = await request(`sales/${sale.id}`, 'PUT', { ...sale, audiences: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.data.audiences, []);
    const { audiences, ...legacySale } = sale;
    const legacy = await request('sales', 'POST', legacySale);
    assert.equal(legacy.status, 201);
    assert.deepEqual(legacy.data.audiences, []);
    assert.equal((await request(`sales/${legacy.data.id}`, 'DELETE')).status, 200);
    const saved = await request(`sales/${sale.id}`, 'PUT', { ...sale, audiences: ['לכל המשפחה', 'תינוקות (בנות)'] });
    assert.equal(saved.status, 200);
    sale = saved.data;
  });
  await t.test('persists, edits and clears overall and per-store outlet flags', async () => {
    const updated = await request(`sales/${sale.id}`, 'PUT', { ...sale, isOutlet: true, stores: sale.stores.map((store, index) => ({ ...store, isOutlet: index === 0 })) });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.isOutlet, true);
    assert.equal(updated.data.stores[0].isOutlet, true);
    assert.equal(updated.data.stores[1].isOutlet, false);
    assert.equal((await request('data')).data.sales.find(item => item.id === sale.id).isOutlet, true);
    for (const isOutlet of ['true', 1, null]) {
      assert.equal((await request(`sales/${sale.id}`, 'PUT', { ...sale, isOutlet })).status, 400);
      assert.equal((await request(`sales/${sale.id}`, 'PUT', { ...sale, stores: sale.stores.map(store => ({ ...store, isOutlet })) })).status, 400);
    }
    const cleared = await request(`sales/${sale.id}`, 'PUT', { ...sale, isOutlet: false, stores: sale.stores.map(store => ({ ...store, isOutlet: false })) });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.isOutlet, false);
    assert.ok(cleared.data.stores.every(store => !store.isOutlet));
    sale = cleared.data;
  });
  await t.test('keeps advertisements and descriptions specific to each sale', async () => {
    const other = await request('sales', 'POST', { ...sale, title: 'מכירה נוספת', stores: [{ storeId: first.id, payment: 'מזומן', description: 'תיאור שונה לאותה חנות', posterId: secondPoster }] });
    assert.equal(other.status, 201);
    const data = (await request('data')).data;
    assert.equal(data.sales.find(s => s.id === sale.id).stores[0].posterId, firstPoster);
    assert.equal(data.sales.find(s => s.id === other.data.id).stores[0].posterId, secondPoster);
    const removed = await request(`sales/${other.data.id}`, 'PUT', { ...other.data, stores: [{ storeId: first.id, payment: '', description: '', posterId: '' }] });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.stores[0].posterId, '');
    assert.equal((await fetch(`${base}/api/media/${secondPoster}`)).status, 404);
    assert.equal((await fetch(`${base}/api/media/${firstPoster}`)).status, 200);
    assert.equal((await request(`sales/${other.data.id}`, 'DELETE')).status, 200);
  });
  await t.test('previews and confirms partial sale merges without affecting independent sales', async () => {
    const isolatedVenue = await request('venues', 'POST', { name: 'אולם לבדיקת איחוד', city: 'ירושלים', address: 'רחוב בדיקה 2', phone: '' });
    assert.equal(isolatedVenue.status, 201);
    const venueId = isolatedVenue.data.id;
    const original = {
      title: 'מכירה מקורית', venueId, stores: [{ storeId: first.id, payment: 'מזומן' }],
      days: [{ date: '2026-10-18', open: '08:00', close: '12:00' }], categories: ['אופנה'], audiences: ['נשים'],
    };
    const draft = { ...original, title: 'מכירה חדשה', stores: [{ storeId: second.id, payment: 'אשראי' }], days: [{ date: '2026-10-18', open: '10:00', close: '14:00' }] };
    try {
      const created = await request('sales', 'POST', original);
      assert.equal(created.status, 201);
      const before = (await request('data')).data;
      const preview = await request('sales/overlaps', 'POST', { sale: draft });
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.data.overlaps, [{ id: created.data.id, title: original.title, days: [{ date: '2026-10-18', open: '10:00', close: '12:00' }] }]);
      assert.deepEqual((await request('data')).data, before);
      assert.equal((await request('sales/merge', 'POST', { sale: draft, token: preview.data.token }, true, 'https://wrong.example')).status, 403);
      assert.equal((await request('sales/merge', 'POST', { sale: draft, token: 'stale' })).status, 409);
      assert.deepEqual((await request('data')).data, before);
      assert.equal((await request('sales/overlaps', 'POST', { sale: draft, excludeId: null })).status, 400);
      const merged = await request('sales/merge', 'POST', { sale: draft, token: preview.data.token });
      assert.equal(merged.status, 200);
      assert.equal(merged.data.ids.length, 3);
      assert.equal(merged.data.mergedSaleIds.length, 1);
      const records = (await request('data')).data.sales.filter(item => item.venueId === venueId);
      assert.equal(records.length, 3);
      const joint = records.find(item => item.id === merged.data.mergedSaleIds[0]);
      assert.deepEqual(joint.days, preview.data.overlaps[0].days);
      assert.deepEqual(joint.stores.map(item => item.storeId).sort(), [first.id, second.id].sort());
      const self = await request('sales/overlaps', 'POST', { sale: joint, excludeId: joint.id });
      assert.equal(self.status, 200);
      assert.equal(self.data.overlaps.length, 0);
      assert.equal((await request('sales', 'POST', draft)).status, 201);
      assert.equal((await request('data')).data.sales.filter(item => item.venueId === venueId).length, 4);
    } finally {
      for (const item of (await request('data')).data.sales.filter(item => item.venueId === venueId)) {
        assert.equal((await request(`sales/${item.id}`, 'DELETE')).status, 200);
      }
      assert.equal((await request(`venues/${venueId}`, 'DELETE')).status, 200);
    }
  });
  await t.test('updates all associations and persists data and sessions across restart', async () => {
    const updated = await request(`sales/${sale.id}`, 'PUT', { ...sale, title: 'מכירה מעודכנת', stores: [{ storeId: second.id, isOutlet: true, payment: 'ביט', posterId: secondPoster, description: 'תיאור שנשמר לאחר הפעלה מחדש' }] });
    assert.equal(updated.status, 200);
    assert.equal((await request(`stores/${first.id}`, 'DELETE')).status, 200);
    await stop();
    await start();
    const all = (await request('data')).data;
    assert.equal(all.sales[0].title, 'מכירה מעודכנת');
    assert.equal(all.stores.length, 1);
    assert.equal(all.sales[0].stores[0].payment, 'ביט');
    assert.equal(all.stores[0].logo, logoPNG);
    assert.match(all.stores[0].addresses[0].hours, /יום ג׳ 12:00–20:00/);
    assert.equal(all.stores[0].addresses[1].city, 'ירושלים');
    assert.equal(all.stores[0].addresses[1].address, 'יפו 14א');
    assert.equal(all.stores[0].addresses[1].weeklyHours[4].close, '19:00');
    assert.equal(all.stores[0].addresses[1].weeklyHours[5].status, 'closed');
    assert.equal(all.stores[0].addresses[1].weeklyHours[6].open2, '16:00');
    assert.equal(all.stores[0].addresses[1].weeklyHours[6].close2, '22:00');
    assert.equal(all.sales[0].isOutlet, false);
    assert.equal(all.sales[0].stores[0].isOutlet, true);
    assert.equal(all.venues[0].street, 'יפו');
    assert.equal(all.venues[0].address, 'יפו 12א');
    assert.equal(all.venues[0].entrance, 'כניסה ב׳, קומה 2');
    assert.equal(all.venues[0].accessibility, 'yes');
    assert.match(all.venues[0].arrivalNotes, /מעלית בצד שמאל/);
    assert.equal(all.sales[0].description, 'תיאור כללי של המכירה');
    assert.deepEqual(all.sales[0].audiences, ['לכל המשפחה', 'תינוקות (בנות)']);
    assert.equal(all.sales[0].stores[0].posterId, secondPoster);
    assert.equal(all.sales[0].stores[0].description, 'תיאור שנשמר לאחר הפעלה מחדש');
    assert.equal((await fetch(`${base}/api/media/${secondPoster}`)).status, 200);
    assert.equal((await fetch(`${base}/api/media/${firstPoster}`)).status, 404);
    assert.equal((await request('auth')).data.authenticated, true);
    const persistedMessage = (await request('messages')).data.find(item => item.id === contactMessageId);
    assert.equal(persistedMessage.name, 'Private message sender');
    assert.equal(persistedMessage.message, '<b>Private message</b>\nSecond line');
    assert.equal(persistedMessage.read, true);
    const persistedSubmissions = (await request('submissions')).data;
    assert.equal(persistedSubmissions.find(item => item.id === submissionId).status, 'approved');
    assert.equal(persistedSubmissions.find(item => item.id === submissionId).contactName, 'Private contact');
    assert.ok(persistedSubmissions.some(item => item.status === 'pending'));
    assert.ok(persistedSubmissions.some(item => item.status === 'rejected'));
    assert.equal((await request('sales/999999', 'PUT', sale)).status, 404);
  });
  await t.test('changes password, invalidates existing sessions, and logs out', async () => {
    assert.equal((await request('password', 'POST', { current: 'wrong', password: 'new-password-long' })).status, 400);
    assert.equal((await request('password', 'POST', { current: password, password: 'short' })).status, 400);
    assert.equal((await request('password', 'POST', { current: password, password: 'new-password-long' })).status, 200);
    assert.equal((await request('auth')).data.authenticated, false);
    assert.equal((await request('sales', 'POST', sale)).status, 401);
    const login = await request('login', 'POST', { password: 'new-password-long' });
    assert.equal(login.status, 200);
    cookie = login.cookie.split(';')[0];
    assert.equal((await request(`sales/${sale.id}`, 'DELETE')).status, 200);
    assert.equal((await fetch(`${base}/api/media/${secondPoster}`)).status, 404);
    assert.equal((await request(`stores/${second.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`venues/${venue.id}`, 'DELETE')).status, 200);
    assert.equal((await request('logout', 'POST', {})).status, 200);
    assert.equal((await request('auth')).data.authenticated, false);
  });

  test('local selection lists include official cities and common categories and payment methods', async () => {
    const data = JSON.parse(await readFile(join(root, 'public', 'cities.json'), 'utf8'));
    assert.ok(data.cities.length > 1000);
    assert.equal(data.cities.length, new Set(data.cities).size);
    for (const city of ['ירושלים', 'בני ברק', 'בית שמש', 'חיפה']) assert.ok(data.cities.includes(city));
    assert.match(data.source, /^https:\/\/data\.gov\.il\//);
    assert.ok(CATEGORY_OPTIONS.length >= 60);
    for (const category of ['בגדי נשים', 'ילדים', 'כלי בית', 'ספרים', 'בגדי ילדים', 'בגדי נערות', 'בגדי תינוקות', 'נעלי נשים', 'שונות']) assert.ok(CATEGORY_OPTIONS.includes(category));
    assert.equal(CATEGORY_OPTIONS.length, new Set(CATEGORY_OPTIONS).size);
    assert.deepEqual(AUDIENCE_OPTIONS, ['גברים', 'נשים', 'בחורים', 'בחורות', 'ילדים', 'ילדות', 'תינוקות (בנים)', 'תינוקות (בנות)', 'לכל המשפחה']);
    for (const payment of ['מזומן', 'אשראי', 'ביט', 'PayBox', 'העברה בנקאית']) assert.ok(PAYMENT_OPTIONS.includes(payment));
  });

  test('unused media cleanup preserves referenced images and recent drafts', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'sale-media-cleanup-'));
    const db = openDatabase(directory);
    t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
    const published = '11111111-1111-1111-1111-111111111111';
    const stale = '22222222-2222-2222-2222-222222222222';
    const recent = '33333333-3333-3333-3333-333333333333';
    const pending = '44444444-4444-4444-4444-444444444444';
    db.prepare('INSERT INTO media VALUES (?,?,?,?)').run(pending, 'image/png', Buffer.from('image'), Date.now() - 2 * 86400_000);
    db.prepare('INSERT INTO submissions (data,created,poster_id) VALUES (?,?,?)').run('{}', Date.now(), pending);
    for (const id of [published, stale, recent]) db.prepare('INSERT INTO media VALUES (?,?,?,?)').run(id, 'image/png', Buffer.from('image'), Date.now() - (id === recent ? 0 : 2 * 86400_000));
    const venueId = Number(db.prepare('INSERT INTO venues (data) VALUES (?)').run('{}').lastInsertRowid);
    const saleId = Number(db.prepare('INSERT INTO sales (venue_id,data) VALUES (?,?)').run(venueId, JSON.stringify({ stores: [{ posterId: published }] })).lastInsertRowid);
    await pruneUnusedMedia(db);
    assert.ok(db.prepare('SELECT id FROM media WHERE id=?').get(published));
    assert.ok(db.prepare('SELECT id FROM media WHERE id=?').get(recent));
    assert.equal(db.prepare('SELECT id FROM media WHERE id=?').get(stale), undefined);
    assert.ok(db.prepare('SELECT id FROM media WHERE id=?').get(pending));
    db.exec("UPDATE submissions SET status='rejected'");
    db.prepare('DELETE FROM sales WHERE id=?').run(saleId);
    await pruneUnusedMedia(db);
    assert.equal(db.prepare('SELECT id FROM media WHERE id=?').get(published), undefined);
    assert.equal(db.prepare('SELECT id FROM media WHERE id=?').get(pending), undefined);
    assert.equal(db.prepare('SELECT poster_id FROM submissions').get().poster_id, null);
  });
  await t.test('rate limits repeated invalid passwords', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await request('login', 'POST', { password: 'incorrect' })).status, 401);
    assert.equal((await request('login', 'POST', { password: 'incorrect' })).status, 429);
  });
});

test('validation rejects oversized ranges and malformed structures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sale-validation-'));
  const db = openDatabase(directory);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  assert.throws(() => validateEntity('stores', null, db), InputError);
  assert.throws(() => validateEntity('stores', { name: 'a', categories: 'not array', addresses: [] }, db), InputError);
  assert.throws(() => validateEntity('venues', { name: 'a', city: 'x', address: 'a'.repeat(301) }, db), InputError);
  const legacyVenue = { name: 'אולם', city: 'ירושלים', address: 'כתובת ישנה' };
  assert.equal(validateEntity('venues', legacyVenue, db).accessibility, 'unknown');
  for (const [field, value] of [['street', 'א'.repeat(151)], ['buildingNumber', '1'.repeat(31)], ['entrance', 'א'.repeat(201)], ['arrivalNotes', 'א'.repeat(2001)], ['accessibility', null]]) {
    assert.throws(() => validateEntity('venues', { ...legacyVenue, [field]: value }, db), InputError);
  }
  assert.throws(() => validateEntity('stores', { name: 'חנות', categories: [], addresses: [{ address: 'כתובת', hours: 'א'.repeat(2001) }] }, db), InputError);
  const storeId = Number(db.prepare('INSERT INTO stores (data) VALUES (?)').run('{}').lastInsertRowid);
  const venueId = Number(db.prepare('INSERT INTO venues (data) VALUES (?)').run('{}').lastInsertRowid);
  const days = Array.from({ length: 367 }, (_, index) => {
    const date = new Date('2026-01-01T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), open: '10:00', close: '20:00' };
  });

  test('public submission validation rejects invalid contacts, dates, images and unbounded lists', () => {
    const draft = {
      contactName: 'Contact', contactPhone: '0501234567', storeNames: ['Store'],
      venueName: 'Venue', city: 'City', address: 'Street 1',
      days: [{ date: '2026-10-18', open: '10:00', close: '18:00' }], categories: [],
    };
    assert.equal(validateSubmission(draft).title, 'Store');
    assert.deepEqual(validateSubmission(draft).audiences, []);
    for (const patch of [
      { contactName: '' }, { contactPhone: '' }, { contactPhone: 'abcdefg' },
      { storeNames: [] }, { storeNames: Array(101).fill('Store') }, { storeNames: ['x'.repeat(151)] },
      { storeNames: ['First', 'Second'], title: '' },
      { days: [] }, { days: [draft.days[0], draft.days[0]] },
      { days: [{ date: '2026-02-30', open: '10:00', close: '18:00' }] },
      { days: [{ ...draft.days[0], close: '09:00' }] },
      { poster: 'data:image/svg+xml;base64,PHN2Zz4=' }, { poster: 'x'.repeat(1_024_024) },
      { audiences: ['unknown'] }, { isOutlet: 'true' }, { categories: null },
    ]) assert.throws(() => validateSubmission({ ...draft, ...patch }), InputError);
    for (const value of [null, [], 'text']) assert.throws(() => validateSubmission(value), InputError);
  });
  const sale = { title: 'Maximum range', venueId, stores: [{ storeId, payment: '' }], days: days.slice(0, 366), categories: [], notes: '', payment: '' };
  assert.equal(validateEntity('sales', sale, db).days.length, 366);
  assert.deepEqual(validateEntity('sales', sale, db).audiences, []);
  assert.equal(validateEntity('sales', sale, db).isOutlet, false);
  assert.equal(validateEntity('sales', sale, db).stores[0].isOutlet, false);
  assert.throws(() => validateEntity('sales', { ...sale, days }, db), InputError);
});
