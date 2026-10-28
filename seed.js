import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';

const root = dirname(fileURLToPath(import.meta.url));
if (process.env.DATABASE_URL || process.env.RENDER === 'true') throw new Error('Demo seeding is local-only. Do not run it against the published site.');
const db = openDatabase(resolve(process.env.DATA_DIR || join(root, 'data')));
if (['stores', 'venues', 'sales'].some(type => db.prepare(`SELECT COUNT(*) AS n FROM ${type}`).get().n)) {
  console.error('Example data can only be added to an empty database. Existing records were not changed.');
  db.close();
  process.exitCode = 1;
} else {
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
  db.exec('BEGIN');
  try {
    const storeIds = stores.map(s => Number(db.prepare('INSERT INTO stores (data) VALUES (?)').run(JSON.stringify({ ...s, phone: '', website: '', catalog: '' })).lastInsertRowid));
    const venueIds = venues.map(v => Number(db.prepare('INSERT INTO venues (data) VALUES (?)').run(JSON.stringify({ ...v, phone: '' })).lastInsertRowid));
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
      const id = Number(db.prepare('INSERT INTO sales (venue_id,data) VALUES (?,?)').run(sale.venueId, JSON.stringify(sale)).lastInsertRowid);
      for (const store of sale.stores) db.prepare('INSERT INTO sale_stores VALUES (?,?)').run(id, store.storeId);
    }
    db.exec('COMMIT');
    console.log('Created clearly labeled example data: 4 stores, 3 venues, 8 sales.');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
