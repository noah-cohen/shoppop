import { AUDIENCE_OPTIONS } from './public/options.js';
import { SALE_STATUSES } from './public/sale-status.js';
import { weeklyHoursError } from './public/store-hours.js';

export class InputError extends Error {}
const fail = message => { throw new InputError(message); };
const boolean = (value, label) => {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail(`${label}: יש לבחור כן או לא`);
  return value;
};
const accessibility = value => {
  if (value === undefined) return 'unknown';
  if (!['unknown', 'yes', 'no'].includes(value)) fail('נגישות: יש לבחור אפשרות מהרשימה');
  return value;
};
const text = (value, label, required = false, max = 2000) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) fail(`${label}: ערך לא תקין או ארוך מדי`);
  value = value.trim();
  if (required && !value) fail(`יש למלא ${label}`);
  return value;
};
const list = (value, label, max = 30) => {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: רשימה לא תקינה`);
  return value;
};
const categories = value => [...new Set(list(value, 'קטגוריות').map(v => text(v, 'קטגוריה', true, 80)))];
const audiences = value => [...new Set(list(value === undefined ? [] : value, 'קהל יעד', AUDIENCE_OPTIONS.length).map(value => {
  const audience = text(value, 'קהל יעד', true, 80);
  if (!AUDIENCE_OPTIONS.includes(audience)) fail('קהל יעד: יש לבחור אפשרות מהרשימה');
  return audience;
}))];
const url = (value, label) => {
  const result = text(value, label, false, 1000);
  if (result) {
    let parsed;
    try { parsed = new URL(result); } catch { fail(`${label}: יש להזין כתובת מלאה עם https://`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail(`${label}: קישור לא תקין`);
  }
  return result;
};
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const saleDays = value => {
  const days = list(value, 'ימי מכירה', 366).map(day => {
    if (!day || !validDate(day.date) || !validTime(day.open) || !validTime(day.close) || day.close <= day.open) fail('יש להזין תאריך תקין ושעת סיום מאוחרת משעת הפתיחה (באותו יום)');
    return { date: day.date, open: day.open, close: day.close };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length || new Set(days.map(day => day.date)).size !== days.length) fail('יש להוסיף ימי מכירה ללא תאריכים כפולים');
  return days;
};
export function parseImage(value, maxBytes, label) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 23) fail(`${label}: התמונה גדולה מדי`);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail(`${label}: יש לבחור תמונה מסוג PNG, JPG או WebP`);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== match[2]) fail(`${label}: קובץ התמונה גדול מדי או לא תקין`);
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR';
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8;
  if (!({ png, jpeg, webp })[match[1]]) fail(`${label}: תוכן הקובץ אינו תואם לסוג התמונה`);
  return { mime: `image/${match[1]}`, bytes };
}
const logo = value => {
  if (value === undefined || value === '') return '';
  parseImage(value, 153_600, 'לוגו');
  return value;
};

function saleReferences(sale) {
  return [
    ['venues', sale.venueId, 'יש לבחור אולם קיים'],
    ...sale.stores.flatMap(store => [
      ['stores', store.storeId, 'יש לבחור חנות קיימת'],
      ...(store.posterId ? [['media', store.posterId, 'מודעת הפרסומת לא נמצאה. יש להעלות את התמונה מחדש.']] : []),
    ]),
  ];
}

export async function validateStoredEntity(type, data, db) {
  const result = validateEntity(type, data);
  if (type === 'sales') {
    for (const [table, id, message] of saleReferences(result)) {
      if (!await db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) fail(message);
    }
  }
  return result;
}

export function validateEntity(type, data, db) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('נתונים לא תקינים');
  if (type === 'stores') return {
    name: text(data.name, 'שם החנות', true, 150),
    phone: text(data.phone, 'טלפון', false, 80),
    website: url(data.website, 'אתר'),
    catalog: url(data.catalog, 'קטלוג'),
    logo: logo(data.logo),
    categories: categories(data.categories),
    addresses: list(data.addresses, 'כתובות', 20).map(a => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) fail('כתובת לא תקינה');
      const city = text(a.city, 'עיר', false, 100);
      const street = text(a.street, 'רחוב', false, 150);
      const buildingNumber = text(a.buildingNumber, 'מספר בניין', false, 30);
      if (Boolean(city) !== Boolean(street) || (buildingNumber && !street)) fail('יש לבחור עיר ורחוב לכתובת החנות');
      const result = {
        address: text(street ? [street, buildingNumber].filter(Boolean).join(' ') : a.address, 'כתובת', true, 300),
        hours: text(a.hours, 'שעות פתיחה', false, 2000),
        city, street, buildingNumber, arrivalNotes: text(a.arrivalNotes, 'הוראות הגעה', false, 2000),
      };
      if (a.weeklyHours !== undefined) {
        const error = weeklyHoursError(a.weeklyHours);
        if (error) fail(error);
        result.weeklyHours = a.weeklyHours.map(({ day, status, open, close, open2, close2 }) => ({
          day, status, open, close, ...(open2 !== undefined ? { open2, close2 } : {}),
        }));
      }
      return result;
    }),
  };
  if (type === 'venues') {
    const street = text(data.street, 'רחוב', false, 150);
    const buildingNumber = text(data.buildingNumber, 'מספר בניין', false, 30);
    return {
      name: text(data.name, 'שם האולם', true, 150),
      city: text(data.city, 'עיר', true, 100),
      address: text(street ? [street, buildingNumber].filter(Boolean).join(' ') : data.address, 'כתובת מדויקת', true, 300),
      street, buildingNumber,
      entrance: text(data.entrance, 'כניסה', false, 200),
      arrivalNotes: text(data.arrivalNotes, 'הערות הגעה', false, 2000),
      accessibility: accessibility(data.accessibility),
      phone: text(data.phone, 'טלפון', false, 80),
    };
  }
  if (type !== 'sales') fail('סוג רשומה לא תקין');
  if (!Number.isSafeInteger(data.venueId) || data.venueId < 1) fail('יש לבחור אולם קיים');
  const stores = list(data.stores, 'חנויות', 100).map(store => {
    if (!store || !Number.isSafeInteger(store.storeId) || store.storeId < 1) fail('יש לבחור חנות קיימת');
    const posterId = text(store.posterId, 'מודעת פרסומת', false, 36);
    if (posterId && !/^[0-9a-f-]{36}$/.test(posterId)) fail('מודעת הפרסומת לא נמצאה. יש להעלות את התמונה מחדש.');
    return {
      storeId: store.storeId, payment: text(store.payment, 'תשלום לחנות', false, 300),
      description: text(store.description, 'תיאור המכירה של החנות', false, 4000), posterId,
      isOutlet: boolean(store.isOutlet, 'אאוטלט לחנות'),
    };
  });
  if (!stores.length || new Set(stores.map(s => s.storeId)).size !== stores.length) fail('יש לבחור לפחות חנות אחת, ללא כפילויות');
  const days = saleDays(data.days);
  const status = data.status === undefined ? 'scheduled' : data.status;
  if (!SALE_STATUSES.some(([value]) => value === status)) fail('סטטוס מכירה לא תקין');
  const statusNote = text(data.statusNote, 'הודעת שינוי / ביטול', status !== 'scheduled', 2000);
  const result = {
    title: text(data.title, 'שם המכירה', true, 180),
    status, statusNote,
    venueId: data.venueId, stores, days, isOutlet: boolean(data.isOutlet, 'מכירת אאוטלט'),
    categories: categories(data.categories),
    audiences: audiences(data.audiences),
    payment: text(data.payment, 'אפשרויות תשלום', false, 300),
    notes: text(data.notes, 'הערות', false, 4000),
    description: text(data.description, 'תיאור המכירה', false, 4000),
  };
  if (db) {
    for (const [table, id, message] of saleReferences(result)) {
      if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) fail(message);
    }
  }
  return result;
}

export function validateContactMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('נתוני הודעה לא תקינים');
  const email = text(data.email, 'דוא״ל', false, 254);
  const phone = text(data.phone, 'טלפון', false, 80);
  if (!email && !phone) fail('יש להזין כתובת דוא״ל או מספר טלפון כדי שנוכל לחזור אליכם');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('יש להזין כתובת דוא״ל תקינה');
  if (phone && (!/^[+\d\s()-]{7,80}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) fail('יש להזין מספר טלפון תקין');
  return {
    name: text(data.name, 'שם מלא', true, 150), email, phone,
    subject: text(data.subject, 'נושא הפנייה', true, 180),
    message: text(data.message, 'תוכן ההודעה', true, 4000),
  };
}

export function validateSubmission(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('נתוני בקשה לא תקינים');
  const contactPhone = text(data.contactPhone, 'טלפון ליצירת קשר', true, 80);
  if (!/^[+\d\s()-]{7,80}$/.test(contactPhone) || contactPhone.replace(/\D/g, '').length < 7) fail('יש להזין טלפון תקין ליצירת קשר');
  const storeNames = [...new Set(list(data.storeNames, 'שמות החנויות', 100).map(name => text(name, 'שם חנות', true, 150)))];
  if (!storeNames.length) fail('יש להזין לפחות חנות אחת');
  const days = saleDays(data.days);
  const poster = text(data.poster, 'מודעת מכירה', false, 1_024_023);
  if (poster) parseImage(poster, 768_000, 'מודעת מכירה');
  return {
    contactName: text(data.contactName, 'שם אשת הקשר', true, 150), contactPhone,
    title: text(data.title, 'שם המכירה', storeNames.length > 1, 180) || storeNames[0],
    storeNames,
    venueName: text(data.venueName, 'שם האולם', true, 150),
    city: text(data.city, 'עיר', true, 100),
    address: text(data.address, 'כתובת האולם', true, 300),
    days, categories: categories(data.categories), audiences: audiences(data.audiences),
    payment: text(data.payment, 'אפשרויות תשלום', false, 300),
    description: text(data.description, 'תיאור המכירה', false, 4000),
    notes: text(data.notes, 'הערות', false, 4000),
    isOutlet: boolean(data.isOutlet, 'אאוטלט'), poster,
  };
}
