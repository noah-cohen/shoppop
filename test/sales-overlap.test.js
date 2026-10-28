import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, readAll, saveSale } from '../database.js';
import { InputError } from '../validation.js';
import { overlappingDays, planSaleMerge, previewSaleMerge, mergeSales, MergeConflictError } from '../sales-overlap.js';

const day = (date = '2026-10-18', open = '10:00', close = '14:00') => ({ date, open, close });
const participant = (storeId, extra = {}) => ({ storeId, payment: '', description: '', posterId: '', ...extra });
const sale = (extra = {}) => ({
  title: 'מכירה לבדיקה', venueId: 1, stores: [participant(1)], days: [day()],
  categories: ['בגדים'], audiences: ['נשים'], payment: '', description: '', notes: '', ...extra,
});
function database(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sale-overlap-test-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const id of [1, 2, 3]) db.prepare('INSERT INTO stores VALUES (?,?)').run(id, JSON.stringify({ name: `חנות ${id}`, categories: [], addresses: [] }));
  for (const id of [1, 2]) db.prepare('INSERT INTO venues VALUES (?,?)').run(id, JSON.stringify({ name: `אולם ${id}`, city: 'ירושלים', address: 'רחוב 1' }));
  return db;
}
function assertCoverage(before, after) {
  const dates = [...new Set(before.flatMap(item => item.days.map(day => day.date)))];
  for (const date of dates) {
    for (let minute = 0; minute < 1440; minute++) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const present = sales => [...new Set(sales.filter(item => item.days.some(day => day.date === date && day.open <= time && time < day.close))
        .flatMap(item => item.stores.map(store => store.storeId)))].sort();
      assert.deepEqual(present(after), present(before), `${date} ${time}`);
    }
  }
}

test('overlap requires a matching date and positive intersection, not touching endpoints', () => {
  const original = sale();
  assert.deepEqual(overlappingDays(original, sale({ days: [day(undefined, '12:00', '16:00')] })), [day(undefined, '12:00', '14:00')]);
  assert.deepEqual(overlappingDays(original, sale({ days: [day(undefined, '14:00', '18:00')] })), []);
  assert.deepEqual(overlappingDays(original, sale({ days: [day('2026-10-19')] })), []);
});

test('cancelled and postponed sales do not overlap and changed notices survive merging', async t => {
  const db = database(t);
  const original = sale({ status: 'cancelled', statusNote: 'Cancelled' });
  const id = await saveSale(db, original);
  const draft = sale({ status: 'changed', statusNote: 'New hours', stores: [participant(2)] });
  assert.deepEqual(overlappingDays(draft, original), []);
  assert.deepEqual(overlappingDays({ ...draft, status: 'postponed' }, sale()), []);
  assert.equal((await previewSaleMerge(db, { sale: draft })).overlaps.length, 0);
  await saveSale(db, { ...original, status: 'changed', statusNote: 'New entrance' }, id);
  const preview = await previewSaleMerge(db, { sale: draft });
  assert.equal(preview.overlaps.length, 1);
  const result = await mergeSales(db, { sale: draft, token: preview.token });
  const merged = (await readAll(db)).sales.find(sale => sale.id === result.mergedSaleIds[0]);
  assert.equal(merged.status, 'changed');
  assert.match(merged.statusNote, /New hours/);
  assert.match(merged.statusNote, /New entrance/);
});

test('partial overlap splits the day without assigning stores to extra times or dates', () => {
  const draft = sale({ stores: [participant(2)], days: [day(undefined, '10:00', '14:00'), day('2026-10-20')] });
  const existing = sale({ days: [day(undefined, '08:00', '12:00'), day('2026-10-19')] });
  const plan = planSaleMerge(draft, [{ id: 1, sale: existing }]);
  assertCoverage([draft, existing], plan.map(item => item.sale));
  const joint = plan.filter(item => item.shared);
  assert.equal(joint.length, 1);
  assert.deepEqual(joint[0].sale.days, [day(undefined, '10:00', '12:00')]);
  assert.deepEqual(joint[0].sale.stores.map(store => store.storeId), [2, 1]);
  assert.equal(plan.filter(item => !item.shared).length, 2);
});

test('contained and staggered overlaps preserve all source intervals and independent residuals', () => {
  const draft = sale({ stores: [participant(3)], days: [day(undefined, '10:00', '18:00')] });
  const first = sale({ days: [day(undefined, '08:00', '14:00')] });
  const second = sale({ stores: [participant(2)], days: [day(undefined, '12:00', '20:00')] });
  const plan = planSaleMerge(draft, [{ id: 1, sale: first }, { id: 2, sale: second }]);
  assertCoverage([draft, first, second], plan.map(item => item.sale));
  assert.deepEqual(plan.filter(item => item.shared).map(item => item.sale.stores.length), [2, 3, 2]);
  for (const item of plan) assert.equal(new Set(item.sale.days.map(day => day.date)).size, item.sale.days.length);
});

test('a contained existing interval leaves two valid separate draft fragments', () => {
  const draft = sale({ stores: [participant(2)], days: [day(undefined, '08:00', '20:00')] });
  const existing = sale({ days: [day(undefined, '10:00', '12:00')] });
  const plan = planSaleMerge(draft, [{ id: 1, sale: existing }]);
  assertCoverage([draft, existing], plan.map(item => item.sale));
  assert.equal(plan.filter(item => !item.shared).length, 2);
});

test('existing sales are not merged with one another outside the draft interval', () => {
  const draft = sale({ stores: [participant(3)], days: [day(undefined, '12:00', '14:00')] });
  const first = sale({ days: [day(undefined, '08:00', '16:00')] });
  const second = sale({ stores: [participant(2)], days: [day(undefined, '10:00', '18:00')] });
  const plan = planSaleMerge(draft, [{ id: 1, sale: first }, { id: 2, sale: second }]);
  assertCoverage([draft, first, second], plan.map(item => item.sale));
  assert.equal(plan.filter(item => item.shared).length, 1);
  assert.deepEqual(plan.find(item => item.shared).sale.days, draft.days);
  assert.ok(plan.filter(item => !item.shared).every(item => item.sale.stores.length === 1));
});

test('repeated store metadata is deduplicated across three sources and a poster is retained', () => {
  const first = sale({ stores: [participant(1, { payment: 'מזומן', description: 'תיאור ראשון', posterId: 'poster' })] });
  const second = sale({ stores: [participant(1, { payment: 'אשראי', description: 'תיאור שני' })] });
  const third = sale({ stores: [participant(1, { payment: 'מזומן', description: 'תיאור ראשון' })] });
  const [joint] = planSaleMerge(first, [{ id: 1, sale: second }, { id: 2, sale: third }]);
  assert.equal(joint.sale.stores.length, 1);
  assert.equal(joint.sale.stores[0].payment, 'מזומן, אשראי');
  assert.equal(joint.sale.stores[0].description, 'תיאור ראשון\n\nתיאור שני');
  assert.equal(joint.sale.stores[0].posterId, 'poster');
});

test('preview checks the venue, excludes the edited sale, and never mutates storage', async t => {
  const db = database(t);
  const original = sale();
  const id = await saveSale(db, original);
  await saveSale(db, sale({ venueId: 2 }));
  const before = await readAll(db);
  const self = await previewSaleMerge(db, { sale: original, excludeId: id });
  assert.equal(self.overlaps.length, 0);
  const preview = await previewSaleMerge(db, { sale: original });
  assert.deepEqual(preview.overlaps.map(item => item.id), [id]);
  assert.equal(preview.token.length, 64);
  assert.deepEqual(await readAll(db), before);
  for (const excludeId of [null, 0, -1, '1', 1.5]) await assert.rejects(() => previewSaleMerge(db, { sale: original, excludeId }), InputError);
});

test('atomic merge preserves residuals, store associations, titles, notes, payments and audiences', async t => {
  const db = database(t);
  const original = sale({ title: 'מקור ראשון', payment: 'מזומן', description: 'תיאור ראשון', notes: 'הערה ראשונה', days: [day(undefined, '08:00', '12:00'), day('2026-10-19')] });
  const id = await saveSale(db, original);
  const draft = sale({ title: 'מקור שני', stores: [participant(2, { payment: 'אשראי', description: 'תיאור לחנות' })], description: 'תיאור שני', notes: 'הערה שנייה', audiences: ['ילדים'] });
  const request = { sale: draft };
  const result = await mergeSales(db, { ...request, token: (await previewSaleMerge(db, request)).token });
  const saved = (await readAll(db)).sales;
  assert.equal(result.mergedSaleIds.length, 1);
  assert.equal(saved.length, 3);
  assertCoverage([original, draft], saved);
  assert.equal(saved.find(item => item.id === id).title, original.title);
  const joint = saved.find(item => item.id === result.mergedSaleIds[0]);
  assert.equal(joint.payment, '');
  assert.equal(joint.stores.find(store => store.storeId === 1).payment, 'מזומן');
  assert.equal(joint.stores.find(store => store.storeId === 2).payment, 'אשראי');
  assert.equal(joint.stores.find(store => store.storeId === 2).description, 'תיאור לחנות');
  assert.deepEqual(joint.audiences, ['ילדים', 'נשים']);
  assert.deepEqual(joint.categories, ['בגדים']);
  for (const text of ['מקור ראשון', 'מקור שני', 'תיאור ראשון', 'תיאור שני']) assert.ok(joint.description.includes(text));
  for (const text of ['הערה ראשונה', 'הערה שנייה']) assert.ok(joint.notes.includes(text));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sale_stores WHERE sale_id=?').get(joint.id).count, 2);
});

test('editing and merging reuses identifiers and does not keep an obsolete copy of the edited sale', async t => {
  const db = database(t);
  const other = sale({ days: [day(undefined, '08:00', '12:00')] });
  const otherId = await saveSale(db, other);
  const draft = sale({ stores: [participant(2)] });
  const excludeId = await saveSale(db, draft);
  const request = { sale: draft, excludeId };
  assert.deepEqual((await previewSaleMerge(db, request)).overlaps.map(item => item.id), [otherId]);
  await mergeSales(db, { ...request, token: (await previewSaleMerge(db, request)).token });
  const saved = (await readAll(db)).sales;
  assert.equal(saved.length, 3);
  assert.ok(saved.some(item => item.id === excludeId));
  assertCoverage([other, draft], saved);
});

test('complete overlap collapses consumed records and removes their obsolete associations', async t => {
  const db = database(t);
  await saveSale(db, sale());
  await saveSale(db, sale({ stores: [participant(2)] }));
  const request = { sale: sale({ stores: [participant(3)] }) };
  const result = await mergeSales(db, { ...request, token: (await previewSaleMerge(db, request)).token });
  const saved = (await readAll(db)).sales;
  assert.equal(saved.length, 1);
  assert.deepEqual(result.ids, result.mergedSaleIds);
  assert.deepEqual(saved[0].stores.map(store => store.storeId).sort(), [1, 2, 3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sale_stores').get().count, 3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('partial merging materializes outlet status per participating store without spreading it to others', async t => {
  const db = database(t);
  const original = sale({ days: [day(undefined, '08:00', '12:00')] });
  await saveSale(db, original);
  const request = { sale: sale({ isOutlet: true, stores: [participant(2)] }) };
  await mergeSales(db, { ...request, token: (await previewSaleMerge(db, request)).token });
  const saved = (await readAll(db)).sales;
  const joint = saved.find(item => item.stores.length === 2);
  assert.equal(joint.isOutlet, false);
  assert.equal(joint.stores.find(store => store.storeId === 1).isOutlet, false);
  assert.equal(joint.stores.find(store => store.storeId === 2).isOutlet, true);
  assert.equal(saved.find(item => item.stores.length === 1 && item.stores[0].storeId === 2).isOutlet, true);
  assert.equal(saved.find(item => item.stores.length === 1 && item.stores[0].storeId === 1).isOutlet, false);
});

test('merging two entirely outlet sales retains the overall outlet flag', () => {
  const draft = sale({ isOutlet: true });
  const [joint] = planSaleMerge(draft, [{ id: 1, sale: sale({ isOutlet: true, stores: [participant(2)] }) }]);
  assert.equal(joint.sale.isOutlet, true);
  assert.ok(joint.sale.stores.every(store => store.isOutlet));
});

test('a storage failure after residual writes rolls back every sale and association', async t => {
  const db = database(t);
  await saveSale(db, sale({ days: [day(undefined, '08:00', '12:00')] }));
  const request = { sale: sale({ stores: [participant(2)] }) };
  const before = await readAll(db);
  db.exec(`CREATE TRIGGER reject_joint BEFORE INSERT ON sales
    WHEN json_extract(NEW.data, '$.title') = 'מכירה משותפת'
    BEGIN SELECT RAISE(ABORT, 'test storage failure'); END`);
  const token = (await previewSaleMerge(db, request)).token;
  await assert.rejects(() => mergeSales(db, { ...request, token }), /test storage failure/);
  assert.deepEqual(await readAll(db), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sale_stores').get().count, 1);
});

test('changed or newly added overlapping records invalidate a merge preview without writes', async t => {
  const db = database(t);
  const id = await saveSale(db, sale());
  const request = { sale: sale({ stores: [participant(2)] }) };
  const token = (await previewSaleMerge(db, request)).token;
  await saveSale(db, sale({ title: 'כותרת מעודכנת' }), id);
  const changed = await readAll(db);
  await assert.rejects(() => mergeSales(db, { ...request, token }), MergeConflictError);
  assert.deepEqual(await readAll(db), changed);
  const currentToken = (await previewSaleMerge(db, request)).token;
  await saveSale(db, sale({ stores: [participant(3)] }));
  const added = await readAll(db);
  await assert.rejects(() => mergeSales(db, { ...request, token: currentToken }), MergeConflictError);
  assert.deepEqual(await readAll(db), added);
});

test('conflicting posters or excessive merged descriptions leave every record unchanged', async t => {
  const db = database(t);
  const posters = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
  for (const id of posters) db.prepare('INSERT INTO media VALUES (?,?,?,?)').run(id, 'image/png', Buffer.from('image'), Date.now());
  const original = sale({ stores: [participant(1, { posterId: posters[0] })] });
  const id = await saveSale(db, original);
  const request = { sale: sale({ stores: [participant(1, { posterId: posters[1] })] }) };
  const before = await readAll(db);
  const token = (await previewSaleMerge(db, request)).token;
  await assert.rejects(() => mergeSales(db, { ...request, token }), /מודעות שונות/);
  assert.deepEqual(await readAll(db), before);
  const longer = sale({ description: 'א'.repeat(3000) });
  await saveSale(db, longer, id);
  const longRequest = { sale: sale({ description: 'ב'.repeat(3000), stores: [participant(2)] }) };
  const snapshot = await readAll(db);
  const longToken = (await previewSaleMerge(db, longRequest)).token;
  await assert.rejects(() => mergeSales(db, { ...longRequest, token: longToken }), InputError);
  assert.deepEqual(await readAll(db), snapshot);
});
