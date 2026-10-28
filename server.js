import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readAll, mediaIsPublished, pruneUnusedMedia, saveSale } from './database.js';
import { openStorage } from './storage.js';
import { InputError, validateStoredEntity, validateSubmission, validateContactMessage, parseImage } from './validation.js';
import { previewSaleMerge, mergeSales, MergeConflictError } from './sales-overlap.js';

const root = dirname(fileURLToPath(import.meta.url));
const streetCatalog = JSON.parse(await readFile(join(root, 'streets.json'), 'utf8')).cities;
if (!streetCatalog || typeof streetCatalog !== 'object' || Array.isArray(streetCatalog)) throw new Error('The local street catalog is invalid. Run npm run update-streets.');
const storage = await openStorage({
  directory: resolve(process.env.DATA_DIR || join(root, 'data')),
  databaseUrl: process.env.DATABASE_URL,
  requirePostgres: process.env.RENDER === 'true',
});
const secureCookie = process.env.COOKIE_SECURE === 'true';
if (process.env.RENDER === 'true' && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
  throw new Error('Set RESEND_API_KEY and EMAIL_FROM privately before deploying to Render');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const passwordHash = password => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const verifyPassword = (password, stored) => {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
};
{
  const db = await storage.connect();
  try {
    await db.exec('BEGIN');
    if (!await db.prepare('SELECT id FROM admin WHERE id=1').get()) {
      if (process.env.RENDER === 'true' && !process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD privately before the first deployment');
      const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString('base64url');
      if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
      await db.prepare('INSERT INTO admin (id, hash) VALUES (1, ?)').run(passwordHash(password));
      if (!process.env.ADMIN_PASSWORD) console.log(`Initial administrator password (save securely): ${password}`);
    }
    await pruneUnusedMedia(db);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
const attempts = new Map();
const userLoginAttempts = new Map();
const codeRequestAttempts = new Map();
const submissionAttempts = new Map();
const messageAttempts = new Map();
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const isAdmin = async (db, req) => {
  const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('sale_session='))?.slice(13);
  return cookie && await db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(hash(cookie), Date.now());
};
const cookieValue = (req, name) => req.headers.cookie?.split(';').map(value => value.trim())
  .find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const userSession = async (db, req) => {
  const token = cookieValue(req, 'user_session');
  return token && await db.prepare(`SELECT user_sessions.token,user_sessions.user_id,users.email
    FROM user_sessions JOIN users ON users.id=user_sessions.user_id
    WHERE user_sessions.token=? AND user_sessions.expires>?`).get(hash(token), Date.now());
};
const normalizeEmail = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('יש להזין כתובת דוא״ל תקינה');
  return email;
};
const testEmailAuth = process.env.AUTH_TEST_CODE && process.env.NODE_ENV === 'test' && process.env.RENDER !== 'true';
const loginCode = () => testEmailAuth ? process.env.AUTH_TEST_CODE : String(randomInt(100000, 1000000));
async function sendLoginCode(email, code, purpose) {
  if (testEmailAuth) return;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email sign-in is not configured');
  const labels = {
    register: ['אימות ההרשמה', 'קוד אימות ההרשמה שלך'],
    login: ['קוד הכניסה שלך', 'קוד הכניסה החד־פעמי שלך'],
    reset: ['איפוס הסיסמה', 'קוד איפוס הסיסמה שלך'],
  };
  const [subject, description] = labels[purpose];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: `${subject} ל־ShopPop`,
      text: `${description} הוא: ${code}\n\nהקוד תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.`,
    }),
  });
  if (!response.ok) {
    console.error(`Resend rejected login email with status ${response.status}`);
    throw new Error('Could not send login email');
  }
}
const validateUserPassword = value => {
  if (typeof value !== 'string' || value.length < 10 || value.length > 1000) {
    throw new InputError('הסיסמה צריכה להכיל לפחות 10 תווים');
  }
  return value;
};
const profileValue = value => {
  const text = (field, label) => {
    const result = typeof value?.[field] === 'string' ? value[field].trim() : '';
    if (!result || result.length > 80 || /[\u0000-\u001f\u007f]/.test(result)) throw new InputError(`יש להזין ${label}`);
    return result;
  };
  const firstName = text('firstName', 'שם פרטי');
  const lastName = text('lastName', 'שם משפחה');
  const birthDate = typeof value?.birthDate === 'string' ? value.birthDate : '';
  const parsedBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(`${birthDate}T12:00:00Z`) : null;
  if (!parsedBirthDate || Number.isNaN(parsedBirthDate.valueOf()) || parsedBirthDate.toISOString().slice(0, 10) !== birthDate
    || birthDate > new Date().toISOString().slice(0, 10) || birthDate < '1900-01-01') {
    throw new InputError('יש להזין תאריך לידה תקין');
  }
  if (!['female', 'male', 'unspecified'].includes(value?.gender)) throw new InputError('יש לבחור מגדר');
  const city = text('city', 'עיר');
  if (!Object.hasOwn(streetCatalog, city)) throw new InputError('יש לבחור עיר מהרשימה');
  const boolean = field => {
    if (typeof value?.[field] !== 'boolean') throw new InputError('העדפות העדכונים אינן תקינות');
    return value[field];
  };
  return {
    firstName, lastName, birthDate, gender: value.gender, city,
    updatesCity: boolean('updatesCity'),
    updatesFavorites: boolean('updatesFavorites'),
    updatesSales: boolean('updatesSales'),
    updatesDaily: boolean('updatesDaily'),
    updatesOutlet: boolean('updatesOutlet'),
    adsConsent: boolean('adsConsent'),
  };
};
async function issueAuthCode(db, req, email, purpose) {
  const now = Date.now();
  for (const [entryKey, value] of codeRequestAttempts) if (value.until <= now) codeRequestAttempts.delete(entryKey);
  const limits = [[`ip:${req.socket.remoteAddress}`, 10], [`email:${email}`, 5]];
  if (limits.some(([key, maximum]) => (codeRequestAttempts.get(key)?.count || 0) >= maximum)) {
    throw Object.assign(new Error('נשלחו יותר מדי קודים. אפשר לנסות שוב בעוד 15 דקות.'), { status: 429 });
  }
  for (const [key] of limits) {
    const attempt = codeRequestAttempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    attempt.count++;
    codeRequestAttempts.set(key, attempt);
  }
  const code = loginCode();
  const codeHash = passwordHash(code);
  await db.prepare(`INSERT INTO auth_codes (email,purpose,hash,expires,attempts,requested) VALUES (?,?,?,?,?,?)
    ON CONFLICT(email,purpose) DO UPDATE SET hash=excluded.hash,expires=excluded.expires,attempts=0,requested=excluded.requested`)
    .run(email, purpose, codeHash, now + 10 * 60_000, 0, now);
  try {
    await sendLoginCode(email, code, purpose);
  } catch (error) {
    await db.prepare('DELETE FROM auth_codes WHERE email=? AND purpose=? AND hash=?').run(email, purpose, codeHash);
    throw error;
  }
}
async function verifyAuthCode(db, email, purpose, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new InputError('יש להזין קוד בן 6 ספרות');
  const now = Date.now();
  const saved = await db.prepare('SELECT hash,expires,attempts FROM auth_codes WHERE email=? AND purpose=?').get(email, purpose);
  if (!saved || saved.expires <= now || saved.attempts >= 5) {
    await db.prepare('DELETE FROM auth_codes WHERE email=? AND purpose=?').run(email, purpose);
    return false;
  }
  if (!verifyPassword(code, saved.hash)) {
    await db.prepare('UPDATE auth_codes SET attempts=attempts+1 WHERE email=? AND purpose=?').run(email, purpose);
    return false;
  }
  return true;
}
async function startUserSession(db, userId, now = Date.now()) {
  await db.prepare('DELETE FROM user_sessions WHERE expires<=?').run(now);
  const token = randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO user_sessions VALUES (?,?,?)').run(hash(token), userId, now + 30 * 86400_000);
  return token;
}
const favoritesValue = value => {
  if (!value || !['sales', 'stores'].every(type => Array.isArray(value[type])
    && value[type].length <= 500
    && value[type].every(id => Number.isSafeInteger(id) && id > 0))) {
    throw new InputError('רשימת המועדפים אינה תקינה');
  }
  return {
    sales: [...new Set(value.sales)],
    stores: [...new Set(value.stores)],
  };
};
async function readUserFavorites(db, userId) {
  const result = { sales: [], stores: [] };
  for (const row of await db.prepare('SELECT type,entity_id FROM user_favorites WHERE user_id=? ORDER BY entity_id').all(userId)) {
    result[row.type].push(row.entity_id);
  }
  return result;
}
async function replaceUserFavorites(db, userId, favorites) {
  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM user_favorites WHERE user_id=?').run(userId);
    for (const type of ['sales', 'stores']) {
      for (const id of favorites[type]) await db.prepare('INSERT INTO user_favorites VALUES (?,?,?)').run(userId, type, id);
    }
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function body(req, maxBytes = 256_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw new InputError('הבקשה גדולה מדי');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('תוכן הבקשה אינו JSON תקין'); }
}
const sessionCookie = (token, age) => `sale_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
const userSessionCookie = (token, age) => `user_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
const server = http.createServer(async (req, res) => {
  let db;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : 'ok');
    }
    if (path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { return json(res, 403, { error: 'מקור הבקשה חסר או לא תקין' }); }
        if (origin.host !== req.headers.host) return json(res, 403, { error: 'מקור הבקשה אינו מורשה' });
      }
      db = await storage.connect();
      if (path === '/api/data' && req.method === 'GET') return json(res, 200, await readAll(db));
      if (path === '/api/auth' && req.method === 'GET') return json(res, 200, { authenticated: Boolean(await isAdmin(db, req)) });
      if (path === '/api/account' && req.method === 'GET') {
        const session = await userSession(db, req);
        if (!session) return json(res, 200, { authenticated: false });
        const stored = await db.prepare('SELECT data FROM user_profiles WHERE user_id=?').get(session.user_id);
        return json(res, 200, {
          authenticated: true,
          email: session.email,
          profile: stored ? JSON.parse(stored.data) : null,
        });
      }
      if (path === '/api/account/register' && req.method === 'POST') {
        const data = await body(req, 32_768);
        const email = normalizeEmail(data?.email);
        const password = validateUserPassword(data?.password);
        const profile = profileValue(data?.profile);
        if (await db.prepare(`SELECT 1 FROM users JOIN user_credentials ON user_credentials.user_id=users.id
          WHERE users.email=?`).get(email)) {
          return json(res, 409, { error: 'כבר קיים חשבון עם כתובת המייל הזו. אפשר להתחבר.' });
        }
        const now = Date.now();
        await db.prepare(`INSERT INTO pending_registrations (email,password_hash,profile,expires) VALUES (?,?,?,?)
          ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,profile=excluded.profile,expires=excluded.expires`)
          .run(email, passwordHash(password), JSON.stringify(profile), now + 15 * 60_000);
        try {
          await issueAuthCode(db, req, email, 'register');
        } catch (error) {
          await db.prepare('DELETE FROM pending_registrations WHERE email=?').run(email);
          throw error;
        }
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/register/verify' && req.method === 'POST') {
        const data = await body(req, 4096);
        const email = normalizeEmail(data?.email);
        if (!await verifyAuthCode(db, email, 'register', data?.code)) {
          return json(res, 401, { error: 'הקוד שגוי או שפג תוקפו. יש לבקש קוד חדש.' });
        }
        const now = Date.now();
        const pending = await db.prepare('SELECT password_hash,profile,expires FROM pending_registrations WHERE email=?').get(email);
        if (!pending || pending.expires <= now) return json(res, 401, { error: 'ההרשמה פגה. יש למלא את הטופס מחדש.' });
        await db.exec('BEGIN');
        let token;
        try {
          const user = await db.prepare(`INSERT INTO users (email,created,last_login) VALUES (?,?,?)
            ON CONFLICT(email) DO UPDATE SET last_login=excluded.last_login RETURNING id`).get(email, now, now);
          await db.prepare(`INSERT INTO user_credentials (user_id,password_hash) VALUES (?,?)
            ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash`).run(user.id, pending.password_hash);
          await db.prepare(`INSERT INTO user_profiles (user_id,data,updated) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated`).run(user.id, pending.profile, now);
          await db.prepare('DELETE FROM pending_registrations WHERE email=?').run(email);
          await db.prepare('DELETE FROM auth_codes WHERE email=?').run(email);
          token = await startUserSession(db, user.id, now);
          await db.exec('COMMIT');
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
        res.setHeader('Set-Cookie', userSessionCookie(token, 30 * 86400));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/login' && req.method === 'POST') {
        const data = await body(req, 4096);
        const email = normalizeEmail(data?.email);
        if (typeof data?.password !== 'string' || data.password.length > 1000) throw new InputError('סיסמה לא תקינה');
        const now = Date.now();
        for (const [key, value] of userLoginAttempts) if (value.until <= now) userLoginAttempts.delete(key);
        const key = `${req.socket.remoteAddress}:${email}`;
        const attempt = userLoginAttempts.get(key) || { count: 0, until: now + 15 * 60_000 };
        if (attempt.count >= 8) return json(res, 429, { error: 'יותר מדי ניסיונות כניסה. אפשר לנסות שוב בעוד 15 דקות.' });
        const user = await db.prepare(`SELECT users.id,user_credentials.password_hash FROM users
          JOIN user_credentials ON user_credentials.user_id=users.id WHERE users.email=?`).get(email);
        if (!user || !verifyPassword(data.password, user.password_hash)) {
          attempt.count++;
          userLoginAttempts.set(key, attempt);
          return json(res, 401, { error: 'כתובת המייל או הסיסמה שגויות' });
        }
        userLoginAttempts.delete(key);
        await db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now, user.id);
        const token = await startUserSession(db, user.id, now);
        res.setHeader('Set-Cookie', userSessionCookie(token, 30 * 86400));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/request-code' && req.method === 'POST') {
        const email = normalizeEmail((await body(req, 4096))?.email);
        const user = await db.prepare(`SELECT users.id FROM users JOIN user_credentials
          ON user_credentials.user_id=users.id WHERE users.email=?`).get(email);
        if (user) await issueAuthCode(db, req, email, 'login');
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/verify' && req.method === 'POST') {
        const data = await body(req, 4096);
        const email = normalizeEmail(data?.email);
        const user = await db.prepare(`SELECT users.id FROM users JOIN user_credentials
          ON user_credentials.user_id=users.id WHERE users.email=?`).get(email);
        if (!user || !await verifyAuthCode(db, email, 'login', data?.code)) {
          return json(res, 401, { error: 'הקוד שגוי או שפג תוקפו. יש לבקש קוד חדש.' });
        }
        const now = Date.now();
        await db.prepare('DELETE FROM auth_codes WHERE email=? AND purpose=?').run(email, 'login');
        await db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now, user.id);
        const token = await startUserSession(db, user.id, now);
        res.setHeader('Set-Cookie', userSessionCookie(token, 30 * 86400));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/reset/request' && req.method === 'POST') {
        const email = normalizeEmail((await body(req, 4096))?.email);
        const user = await db.prepare(`SELECT users.id FROM users JOIN user_credentials
          ON user_credentials.user_id=users.id WHERE users.email=?`).get(email);
        if (user) await issueAuthCode(db, req, email, 'reset');
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/reset' && req.method === 'POST') {
        const data = await body(req, 4096);
        const email = normalizeEmail(data?.email);
        const password = validateUserPassword(data?.password);
        const user = await db.prepare(`SELECT users.id FROM users JOIN user_credentials
          ON user_credentials.user_id=users.id WHERE users.email=?`).get(email);
        if (!user || !await verifyAuthCode(db, email, 'reset', data?.code)) {
          return json(res, 401, { error: 'הקוד שגוי או שפג תוקפו. יש לבקש קוד חדש.' });
        }
        await db.exec('BEGIN');
        try {
          await db.prepare('UPDATE user_credentials SET password_hash=? WHERE user_id=?').run(passwordHash(password), user.id);
          await db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(user.id);
          await db.prepare('DELETE FROM auth_codes WHERE email=? AND purpose=?').run(email, 'reset');
          await db.exec('COMMIT');
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
        res.setHeader('Set-Cookie', userSessionCookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/account/profile' && req.method === 'PUT') {
        const session = await userSession(db, req);
        if (!session) return json(res, 401, { error: 'יש להתחבר לאזור האישי' });
        const profile = profileValue(await body(req, 32_768));
        await db.prepare(`INSERT INTO user_profiles (user_id,data,updated) VALUES (?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated`)
          .run(session.user_id, JSON.stringify(profile), Date.now());
        return json(res, 200, profile);
      }
      if (path === '/api/user/favorites' && req.method === 'GET') {
        const session = await userSession(db, req);
        if (!session) return json(res, 401, { error: 'יש להתחבר לאזור האישי' });
        return json(res, 200, await readUserFavorites(db, session.user_id));
      }
      if (path === '/api/user/favorites' && req.method === 'PUT') {
        const session = await userSession(db, req);
        if (!session) return json(res, 401, { error: 'יש להתחבר לאזור האישי' });
        const favorites = favoritesValue(await body(req, 64_000));
        await replaceUserFavorites(db, session.user_id, favorites);
        return json(res, 200, favorites);
      }
      if (path === '/api/user/favorites/sync' && req.method === 'POST') {
        const session = await userSession(db, req);
        if (!session) return json(res, 401, { error: 'יש להתחבר לאזור האישי' });
        const local = favoritesValue(await body(req, 64_000));
        const stored = await readUserFavorites(db, session.user_id);
        const merged = {
          sales: [...new Set([...stored.sales, ...local.sales])],
          stores: [...new Set([...stored.stores, ...local.stores])],
        };
        await replaceUserFavorites(db, session.user_id, merged);
        return json(res, 200, merged);
      }
      if (path === '/api/account/logout' && req.method === 'POST') {
        const session = await userSession(db, req);
        if (!session) return json(res, 401, { error: 'יש להתחבר לאזור האישי' });
        await db.prepare('DELETE FROM user_sessions WHERE token=?').run(session.token);
        res.setHeader('Set-Cookie', userSessionCookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/messages' && req.method === 'POST') {
        const now = Date.now(), key = req.socket.remoteAddress;
        for (const [ip, entry] of messageAttempts) if (entry.until <= now) messageAttempts.delete(ip);
        const attempt = messageAttempts.get(key) || { count: 0, until: now + 3600_000 };
        if (attempt.count >= 5) return json(res, 429, { error: 'נשלחו יותר מדי הודעות. אפשר לנסות שוב בעוד שעה.' });
        attempt.count++;
        messageAttempts.set(key, attempt);
        const data = validateContactMessage(await body(req, 32_768));
        await db.prepare('INSERT INTO messages (data,created) VALUES (?,?)').run(JSON.stringify(data), now);
        return json(res, 201, { ok: true, message: 'ההודעה התקבלה ונשמרה אצל מנהלת האתר. תודה שפניתם אלינו.' });
      }
      if (path === '/api/submissions' && req.method === 'POST') {
        const now = Date.now(), key = req.socket.remoteAddress;
        for (const [ip, entry] of submissionAttempts) if (entry.until <= now) submissionAttempts.delete(ip);
        const attempt = submissionAttempts.get(key) || { count: 0, until: now + 3600_000 };
        if (attempt.count >= 5) return json(res, 429, { error: 'נשלחו יותר מדי בקשות. אפשר לנסות שוב בעוד שעה.' });
        attempt.count++;
        submissionAttempts.set(key, attempt);
        const data = validateSubmission(await body(req, 1_100_000));
        await db.prepare('INSERT INTO submissions (data,created) VALUES (?,?)').run(JSON.stringify(data), now);
        return json(res, 201, { ok: true, message: 'הבקשה התקבלה ותפורסם רק לאחר בדיקה ואישור מנהלת.' });
      }
      const mediaMatch = /^\/api\/media\/([0-9a-f-]{36})$/.exec(path);
      if (mediaMatch && ['GET', 'HEAD'].includes(req.method)) {
        const media = await db.prepare('SELECT mime,bytes FROM media WHERE id=?').get(mediaMatch[1]);
        if (!media || (!await mediaIsPublished(db, mediaMatch[1]) && !await isAdmin(db, req))) return json(res, 404, { error: 'התמונה לא נמצאה' });
        res.writeHead(200, { 'Content-Type': media.mime, 'Cache-Control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : media.bytes);
      }
      if (path === '/api/login' && req.method === 'POST') {
        const key = req.socket.remoteAddress;
        const now = Date.now();
        for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
        const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
        if (attempt.count >= 8) return json(res, 429, { error: 'יותר מדי ניסיונות כניסה. נסי שוב בעוד 15 דקות.' });
        const data = await body(req);
        if (typeof data?.password !== 'string' || data.password.length > 1000) throw new InputError('סיסמה לא תקינה');
        if (!verifyPassword(data.password, (await db.prepare('SELECT hash FROM admin WHERE id=1').get()).hash)) {
          attempt.count++;
          attempts.set(key, attempt);
          return json(res, 401, { error: 'הסיסמה שגויה' });
        }
        attempts.delete(key);
        await db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
        const token = randomBytes(32).toString('hex');
        await db.prepare('INSERT INTO sessions VALUES (?, ?)').run(hash(token), now + 7 * 86400_000);
        res.setHeader('Set-Cookie', sessionCookie(token, 7 * 86400));
        return json(res, 200, { ok: true });
      }
      if (!await isAdmin(db, req)) return json(res, 401, { error: 'יש להתחבר כמנהלת' });
      if (path === '/api/messages' && req.method === 'GET') {
        const items = (await db.prepare('SELECT id,data,created,is_read FROM messages ORDER BY id DESC').all())
          .map(({ data, is_read, ...row }) => ({ ...JSON.parse(data), ...row, read: Boolean(is_read) }));
        return json(res, 200, items);
      }
      const messageMatch = /^\/api\/messages\/([1-9]\d*)$/.exec(path);
      if (messageMatch && req.method === 'PATCH') {
        const data = await body(req);
        if (!data || typeof data.read !== 'boolean') throw new InputError('יש לבחור אם ההודעה נקראה');
        const result = await db.prepare('UPDATE messages SET is_read=? WHERE id=?').run(Number(data.read), Number(messageMatch[1]));
        if (!result.changes) return json(res, 404, { error: 'ההודעה לא נמצאה' });
        return json(res, 200, { ok: true });
      }
      if (path === '/api/submissions' && req.method === 'GET') {
        const items = (await db.prepare('SELECT id,data,status,created,reviewed,sale_id FROM submissions ORDER BY id DESC').all())
          .map(({ data, ...row }) => ({ ...JSON.parse(data), ...row }));
        return json(res, 200, items);
      }
      const submissionMatch = /^\/api\/submissions\/([1-9]\d*)\/(approve|reject|poster)$/.exec(path);
      if (submissionMatch && req.method === 'POST') {
        const id = Number(submissionMatch[1]), action = submissionMatch[2];
        const draft = action === 'approve' ? await body(req, 1_048_576) : undefined;
        await db.exec('BEGIN IMMEDIATE');
        try {
          const submission = await db.prepare('SELECT data,status,poster_id FROM submissions WHERE id=?').get(id);
          if (!submission) { await db.exec('ROLLBACK'); return json(res, 404, { error: 'הבקשה לא נמצאה' }); }
          if (submission.status !== 'pending') throw new MergeConflictError('הבקשה כבר טופלה. יש לרענן את רשימת הבקשות.');
          if (action === 'poster') {
            let posterId = submission.poster_id;
            if (!posterId) {
              const poster = JSON.parse(submission.data).poster;
              if (!poster) throw new InputError('לא צורפה מודעה לבקשה');
              const image = parseImage(poster, 768_000, 'מודעת מכירה');
              posterId = randomUUID();
              await db.prepare('INSERT INTO media VALUES (?,?,?,?)').run(posterId, image.mime, image.bytes, Date.now());
              await db.prepare('UPDATE submissions SET poster_id=? WHERE id=?').run(posterId, id);
            }
            await db.exec('COMMIT');
            return json(res, 200, { id: posterId });
          }
          let saleId = null;
          if (action === 'approve') {
            const data = await validateStoredEntity('sales', draft, db);
            saleId = await saveSale(db, data);
          }
          await db.prepare('UPDATE submissions SET status=?,reviewed=?,sale_id=? WHERE id=?')
            .run(action === 'approve' ? 'approved' : 'rejected', Date.now(), saleId, id);
          await db.exec('COMMIT');
          return json(res, 200, { ok: true, saleId });
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/streets' && req.method === 'GET') {
        const city = new URL(req.url, 'http://localhost').searchParams.get('city');
        if (!city || city.length > 100) throw new InputError('יש לבחור עיר כדי לטעון רחובות');
        return json(res, 200, { city, streets: Object.hasOwn(streetCatalog, city) ? streetCatalog[city] : [] });
      }
      if (path === '/api/media' && req.method === 'POST') {
        const data = await body(req, 1_100_000);
        const image = parseImage(data?.image, 768_000, 'מודעת פרסומת');
        await pruneUnusedMedia(db);
        const id = randomUUID();
        await db.prepare('INSERT INTO media VALUES (?,?,?,?)').run(id, image.mime, image.bytes, Date.now());
        return json(res, 201, { id });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const session = await isAdmin(db, req);
        await db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/password' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data?.current !== 'string' || data.current.length > 1000 || !verifyPassword(data.current, (await db.prepare('SELECT hash FROM admin WHERE id=1').get()).hash)) return json(res, 400, { error: 'הסיסמה הנוכחית שגויה' });
        if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 1000) throw new InputError('הסיסמה החדשה צריכה להכיל לפחות 12 תווים');
        await db.exec('BEGIN');
        try {
          await db.prepare('UPDATE admin SET hash=? WHERE id=1').run(passwordHash(data.password));
          await db.exec('DELETE FROM sessions; COMMIT');
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (path === '/api/sales/overlaps' && req.method === 'POST') return json(res, 200, await previewSaleMerge(db, await body(req, 1_048_576)));
      if (path === '/api/sales/merge' && req.method === 'POST') return json(res, 200, await mergeSales(db, await body(req, 1_048_576)));
      const match = /^\/api\/(stores|venues|sales)(?:\/([1-9]\d*))?$/.exec(path);
      if (!match) return json(res, 404, { error: 'הכתובת לא נמצאה' });
      const [, type, rawId] = match;
      const id = Number(rawId);
      if (rawId && !await db.prepare(`SELECT id FROM ${type} WHERE id=?`).get(id)) return json(res, 404, { error: 'הרשומה לא נמצאה' });
      if (req.method === 'DELETE' && rawId) {
        await db.prepare(`DELETE FROM ${type} WHERE id=?`).run(id);
        return json(res, 200, { ok: true });
      }
      if ((req.method === 'POST' && !rawId) || (req.method === 'PUT' && rawId)) {
        const data = await validateStoredEntity(type, await body(req, type === 'sales' ? 1_048_576 : 256_000), db);
        const addresses = type === 'stores' ? data.addresses : type === 'venues' ? [data] : [];
        for (const address of addresses) {
          if (address.street && (!Object.hasOwn(streetCatalog, address.city) || !streetCatalog[address.city].includes(address.street))) {
            throw new InputError('הרחוב אינו ברשימת הרחובות של העיר שנבחרה. יש לבחור רחוב מהרשימה.');
          }
        }
        await db.exec('BEGIN');
        try {
          let savedId = id;
          if (type === 'sales') {
            savedId = await saveSale(db, data, rawId ? id : undefined);
          } else {
            if (rawId) await db.prepare(`UPDATE ${type} SET data=? WHERE id=?`).run(JSON.stringify(data), id);
            else savedId = (await db.prepare(`INSERT INTO ${type} (data) VALUES (?) RETURNING id`).get(JSON.stringify(data))).id;
          }
          await db.exec('COMMIT');
          return json(res, rawId ? 200 : 201, { ...data, id: savedId });
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
      }
      return json(res, 405, { error: 'פעולה לא נתמכת' });
    }
    const files = { '/': 'index.html', '/app.js': 'app.js', '/admin-sales.js': 'admin-sales.js', '/style.css': 'style.css', '/options.js': 'options.js', '/dates.js': 'dates.js', '/cities.js': 'cities.js', '/sale-status.js': 'sale-status.js', '/favorites.js': 'favorites.js', '/store-hours.js': 'store-hours.js', '/cities.json': 'cities.json', '/Rubik.ttf': 'Rubik.ttf', '/Rubik-LICENSE.txt': 'Rubik-LICENSE.txt', '/Heebo.ttf': 'Heebo.ttf', '/Heebo-LICENSE.txt': 'Heebo-LICENSE.txt' };
    if (!files[path] || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404); return res.end('Not found');
    }
    const content = await readFile(join(root, 'public', files[path]));
    const contentType = path.endsWith('.json') ? 'application/json; charset=utf-8' : path.endsWith('.ttf') ? 'font/ttf' : path.endsWith('.txt') ? 'text/plain; charset=utf-8' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.status === 429) return json(res, 429, { error: error.message });
    if (error instanceof MergeConflictError) return json(res, 409, { error: error.message });
    if (error instanceof InputError) return json(res, 400, { error: error.message });
    if (error.code === '23503' || (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('FOREIGN KEY'))) return json(res, 409, { error: 'אי אפשר למחוק חנות או אולם שמקושרים למכירות. יש לעדכן או למחוק קודם את המכירות המקושרות.' });
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'אירעה שגיאה בשרת. נסי שוב מאוחר יותר.' });
    else res.end();
  } finally { db?.release(); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log(`Sale calendar: http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`);
});
function shutdown() { server.close(async () => { await storage.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
