import { createHash } from 'node:crypto';
import { saveSale } from './database.js';
import { InputError, validateStoredEntity } from './validation.js';
import { saleIsActive } from './public/sale-status.js';

export class MergeConflictError extends Error {}
const intersects = (a, b) => a.date === b.date && a.open < b.close && b.open < a.close;
const unique = values => [...new Set(values)];

export function overlappingDays(a, b) {
  if (!saleIsActive(a) || !saleIsActive(b)) return [];
  return a.days.flatMap(day => {
    const other = b.days.find(candidate => intersects(day, candidate));
    return other ? [{ date: day.date, open: day.open > other.open ? day.open : other.open, close: day.close < other.close ? day.close : other.close }] : [];
  });
}

async function prepare(db, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new InputError('נתוני בדיקת החפיפה אינם תקינים');
  const excludeId = request.excludeId === undefined ? null : request.excludeId;
  let original;
  if (excludeId !== null) {
    if (!Number.isSafeInteger(excludeId) || excludeId < 1) throw new InputError('מזהה המכירה לעריכה אינו תקין');
    original = await db.prepare('SELECT id,data FROM sales WHERE id=?').get(excludeId);
    if (!original) throw new MergeConflictError('המכירה לעריכה כבר אינה קיימת. יש לטעון מחדש את הנתונים.');
  } else if (request.excludeId === null) {
    throw new InputError('מזהה המכירה לעריכה אינו תקין');
  }
  const sale = await validateStoredEntity('sales', request.sale, db);
  const overlaps = (await db.prepare('SELECT id,data FROM sales WHERE venue_id=? AND id<>? ORDER BY id').all(sale.venueId, excludeId || 0))
    .map(row => ({ ...row, sale: JSON.parse(row.data) }))
    .map(row => ({ ...row, days: overlappingDays(sale, row.sale) }))
    .filter(row => row.days.length);
  const token = createHash('sha256').update(JSON.stringify({ sale, original, records: overlaps.map(row => [row.id, row.data]) })).digest('hex');
  return { sale, excludeId, overlaps, token };
}

export async function previewSaleMerge(db, request) {
  const { overlaps, token } = await prepare(db, request);
  return { token, overlaps: overlaps.map(row => ({ id: row.id, title: row.sale.title, days: row.days })) };
}

function combine(records) {
  if (records.length === 1) return { ...records[0].data };
  const participants = new Map();
  for (const record of records) {
    for (const store of record.data.stores) {
      const entries = participants.get(store.storeId) || [];
      entries.push({ ...store, payment: store.payment || record.data.payment || '', isOutlet: record.data.isOutlet === true || store.isOutlet === true });
      participants.set(store.storeId, entries);
    }
  }
  const stores = [...participants.values()].map(entries => {
    const posters = unique(entries.map(store => store.posterId).filter(Boolean));
    if (posters.length > 1) throw new InputError('לא ניתן לאחד אוטומטית: לאותה חנות יש מודעות שונות במכירות החופפות. יש לבחור מודעה אחת בעריכה, או לשמור את המכירות בנפרד.');
    return {
      ...entries[0],
      payment: unique(entries.map(store => store.payment).filter(Boolean)).join(', '),
      description: unique(entries.map(store => store.description).filter(Boolean)).join('\n\n'),
      posterId: posters[0] || '',
      isOutlet: entries.some(store => store.isOutlet),
    };
  });
  const sources = records.map(record => record.data);
  return {
    title: stores.length > 1 ? 'מכירה משותפת' : sources[0].title,
    status: sources.some(sale => sale.status === 'changed') ? 'changed' : 'scheduled',
    statusNote: unique(sources.map(sale => sale.statusNote).filter(Boolean)).join('\n\n'),
    venueId: sources[0].venueId, stores, payment: '', isOutlet: sources.every(sale => sale.isOutlet === true),
    categories: unique(sources.flatMap(sale => sale.categories)),
    audiences: unique(sources.flatMap(sale => sale.audiences || [])),
    description: unique(sources.map(sale => [sale.title, sale.description].filter(Boolean).join('\n'))).join('\n\n'),
    notes: unique(sources.filter(sale => sale.notes).map(sale => `${sale.title}\n${sale.notes}`)).join('\n\n'),
  };
}

export function planSaleMerge(sale, existing, excludeId = null) {
  const draft = { key: 0, id: excludeId, data: sale };
  const others = existing.map((item, index) => ({ key: index + 1, id: item.id, data: item.sale }));
  const groups = [];
  const add = (records, day) => {
    const key = records.map(record => record.key).join(',');
    let group = groups.find(group => group.key === key && !group.days.some(item => item.date === day.date));
    if (!group) { group = { key, records, days: [] }; groups.push(group); }
    group.days.push({ ...day });
  };
  for (const record of others) {
    for (const day of record.data.days) {
      const overlap = sale.days.find(candidate => intersects(day, candidate));
      if (!overlap) add([record], day);
      else {
        if (day.open < overlap.open) add([record], { ...day, close: overlap.open });
        if (day.close > overlap.close) add([record], { ...day, open: overlap.close });
      }
    }
  }
  for (const day of sale.days) {
    const windows = others.flatMap(record => {
      const other = record.data.days.find(candidate => intersects(day, candidate));
      return other ? [{ record, open: other.open > day.open ? other.open : day.open, close: other.close < day.close ? other.close : day.close }] : [];
    });
    const boundaries = unique([day.open, day.close, ...windows.flatMap(window => [window.open, window.close])]).sort();
    const segments = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const open = boundaries[i], close = boundaries[i + 1];
      const records = [draft, ...windows.filter(window => window.open < close && open < window.close).map(window => window.record)];
      const previous = segments.at(-1);
      if (previous && previous.records.map(record => record.key).join(',') === records.map(record => record.key).join(',')) previous.day.close = close;
      else segments.push({ records, day: { date: day.date, open, close } });
    }
    for (const segment of segments) add(segment.records, segment.day);
  }
  return groups.map(group => ({
    sale: { ...combine(group.records), days: group.days.sort((a, b) => a.date.localeCompare(b.date)) },
    sourceIds: group.records.map(record => record.id).filter(id => id !== null),
    shared: group.records.length > 1,
  }));
}

export async function mergeSales(db, request) {
  await db.exec('BEGIN IMMEDIATE');
  try {
    const prepared = await prepare(db, request);
    if (typeof request.token !== 'string' || request.token !== prepared.token) {
      throw new MergeConflictError('המכירות השתנו מאז בדיקת החפיפה. יש ללחוץ שוב על שמירה ולבדוק את ההצעה המעודכנת.');
    }
    if (!prepared.overlaps.length) throw new InputError('אין מכירות חופפות לאיחוד');
    const plan = planSaleMerge(prepared.sale, prepared.overlaps, prepared.excludeId)
      .sort((a, b) => Number(a.shared) - Number(b.shared));
    for (const item of plan) item.sale = await validateStoredEntity('sales', item.sale, db);
    const used = new Set();
    const ids = [], mergedSaleIds = [];
    for (const item of plan) {
      const reuse = item.sourceIds.find(id => !used.has(id));
      if (reuse !== undefined) used.add(reuse);
      const id = await saveSale(db, item.sale, reuse);
      ids.push(id);
      if (item.shared) mergedSaleIds.push(id);
    }
    const originals = [...prepared.overlaps.map(row => row.id), ...(prepared.excludeId === null ? [] : [prepared.excludeId])];
    for (const id of originals) if (!used.has(id)) await db.prepare('DELETE FROM sales WHERE id=?').run(id);
    await db.exec('COMMIT');
    return { ids, mergedSaleIds };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
