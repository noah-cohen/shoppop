import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleStatus, saleIsActive, duplicateSale } from '../public/sale-status.js';

const sale = {
  id: 12, title: 'Sale', venueId: 2, stores: [{ storeId: 3, posterId: 'poster', payment: 'cash', isOutlet: true }],
  days: [{ date: '2026-10-18', open: '10:00', close: '18:00' }, { date: '2026-10-20', open: '12:00', close: '20:00' }],
  status: 'scheduled', statusNote: '', categories: ['clothing'], audiences: ['נשים'], isOutlet: false,
};
const at = value => saleStatus(sale, new Date(value));

test('sale status uses Israel time with exact opening and closing boundaries', () => {
  assert.equal(at('2026-10-18T06:59:59Z').label, 'נפתחת היום ב־10:00');
  assert.equal(at('2026-10-18T07:00:00Z').kind, 'open');
  assert.equal(at('2026-10-18T14:59:59Z').kind, 'open');
  assert.equal(at('2026-10-18T15:00:00Z').kind, 'closed');
  assert.equal(at('2026-10-18T15:00:00Z').nextDate, '2026-10-20');
  assert.equal(at('2026-10-19T12:00:00Z').kind, 'upcoming');
  assert.equal(at('2026-10-20T17:00:00Z').kind, 'finished');
});

test('Israel civil date and daylight saving are independent from the machine timezone', () => {
  assert.equal(at('2026-10-17T22:00:00Z').label, 'נפתחת היום ב־10:00');
  const winter = { ...sale, days: [{ date: '2026-11-01', open: '10:00', close: '18:00' }] };
  assert.equal(saleStatus(winter, new Date('2026-11-01T07:59:59Z')).kind, 'upcoming');
  assert.equal(saleStatus(winter, new Date('2026-11-01T08:00:00Z')).kind, 'open');
  assert.equal(saleStatus({ ...sale, days: [...sale.days].reverse() }, new Date('2026-10-17T12:00:00Z')).nextDate, '2026-10-18');
});

test('cancelled and postponed override dates while changed sales still have a live status', () => {
  for (const status of ['cancelled', 'postponed']) {
    const item = { ...sale, status, statusNote: 'Notice' };
    assert.equal(saleStatus(item, new Date('2026-10-18T12:00:00Z')).kind, status);
    assert.equal(saleIsActive(item), false);
  }
  assert.equal(saleStatus({ ...sale, status: 'changed' }, new Date('2026-10-18T12:00:00Z')).kind, 'open');
  assert.equal(saleIsActive({ ...sale, status: undefined }), true);
});

test('duplication preserves metadata but removes identity, original dates, and cancellation', () => {
  const original = { ...sale, status: 'cancelled', statusNote: 'Cancelled' };
  const before = structuredClone(original);
  const copy = duplicateSale(original);
  assert.equal(copy.id, undefined);
  assert.equal(copy.status, 'scheduled');
  assert.equal(copy.statusNote, '');
  assert.deepEqual(copy.days, [{ date: '', open: '10:00', close: '18:00' }]);
  assert.deepEqual(copy.stores, original.stores);
  assert.deepEqual(copy.categories, original.categories);
  assert.deepEqual(copy.audiences, original.audiences);
  copy.stores[0].payment = 'changed';
  copy.categories.push('new');
  assert.deepEqual(original, before);
});
