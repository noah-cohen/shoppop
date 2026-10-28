import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveSale } from './database.js';
import { openStorage, isHosted } from './storage.js';

export async function seedDemo(db) {
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const type of ['stores', 'venues', 'sales']) {
      if (Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${type}`).get()).n)) {
        throw new Error('Example data can only be added to an empty database. Existing records were not changed.');
      }
    }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const offset = amount => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  const stores = [
    { name: 'סטודיו נעמי · דוגמה', categories: ['בגדי נשים', 'אופנה'], addresses: [{ address: 'כתובת לדוגמה בלבד — לא חנות אמיתית', hours: 'א׳–ה׳ 10:00–18:00' }] },
    { name: 'בית יפה · דוגמה', categories: ['כלי בית', 'עיצוב הבית'], addresses: [] },
    { name: 'קטנטנים · דוגמה', categories: ['ילדים', 'תינוקות'], addresses: [] },
    { name: 'בין הדפים · דוגמה', categories: ['ספרים', 'ילדים'], addresses: [] },
  ];
  const venues = [
    { name: 'אולם הגפן · דוגמה', city: 'ירושלים', address: 'רחוב לדוגמה 12 — אין אירוע אמיתי בכתובת' },
    { name: 'בית הקהילה · דוגמה', city: 'בני ברק', address: 'רחוב לדוגמה 8 — אין אירוע אמיתי בכתובת' },
    { name: 'מרכז הרימון · דוגמה', city: 'בית שמש', address: 'רחוב לדוגמה 3 — אין אירוע אמיתי בכתובת' },
  ];
    const storeIds = [];
    for (const s of stores) storeIds.push((await db.prepare('INSERT INTO stores (data) VALUES (?) RETURNING id').get(JSON.stringify({ ...s, phone: '', website: '', catalog: '' }))).id);
    const venueIds = [];
    for (const v of venues) venueIds.push((await db.prepare('INSERT INTO venues (data) VALUES (?) RETURNING id').get(JSON.stringify({ ...v, phone: '' }))).id);
    const examples = [
      { title: 'מתחדשות לעונה החדשה · דוגמה', venue: 0, stores: [0], days: [0], categories: ['בגדי נשים'], payment: 'מזומן, אשראי וביט' },
      { title: 'כל מה שהבית אוהב · דוגמה', venue: 1, stores: [1], days: [0, 1, 2, 3], categories: ['כלי בית'], payment: 'מזומן ואשראי' },
      { title: 'דברים קטנים, שמחה גדולה · דוגמה', venue: 2, stores: [2, 3], days: [0, 2, 4], categories: ['ילדים'], payment: 'אשראי וביט' },
      { title: 'נפגשים בשוק המעצבות · דוגמה', venue: 0, stores: [0, 1, 2], days: [0, 1], categories: ['אופנה', 'עיצוב הבית'], payment: 'מזומן ואשראי' },
      { title: 'סיפורים לסוף השבוע · דוגמה', venue: 1, stores: [3], days: [0], categories: ['ספרים'], payment: 'מזומן' },
      { title: 'בוקר של מציאות · דוגמה', venue: 2, stores: [0, 2], days: [0, 1, 5], categories: ['בגדי נשים', 'ילדים'], payment: 'מזומן, אשראי' },
      { title: 'מכירת החודש הבא · דוגמה', venue: 0, stores: [1, 3], days: [7, 8, 14], categories: ['כלי בית', 'ספרים'], payment: 'אשראי' },
      { title: 'מכירה שכבר הייתה · דוגמה', venue: 2, stores: [0, 1], days: [-8, -7], categories: ['אופנה'], payment: 'מזומן' },
    ];
    for (const example of examples) {
      const sale = {
        title: example.title, venueId: venueIds[example.venue],
        stores: example.stores.map((index, position) => ({ storeId: storeIds[index], payment: position ? 'מזומן בלבד (דוגמה)' : '' })),
        days: example.days.map(d => ({ date: offset(d), open: '10:00', close: d === 1 ? '18:00' : '20:00' })),
        categories: example.categories, payment: example.payment,
        notes: 'נתוני הדגמה בלבד. זו אינה מכירה אמיתית ואין להגיע לכתובת. השעות והמחירים להמחשה בלבד.',
      };
      await saveSale(db, sale);
    }
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if ((process.env.DATABASE_URL || isHosted()) && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_DEMO_SEED=true explicitly to seed an empty cloud/demo database.');
  }
  const root = dirname(fileURLToPath(import.meta.url));
  const storage = await openStorage({ directory: resolve(process.env.DATA_DIR || join(root, 'data')), databaseUrl: process.env.DATABASE_URL });
  try {
    const db = await storage.connect();
    try { await seedDemo(db); }
    finally { db.release(); }
    console.log('Created clearly labeled example data: 4 stores, 3 venues, 8 sales.');
  } finally { await storage.close(); }
}
