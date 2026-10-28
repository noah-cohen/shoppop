import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAdminSales } from '../public/admin-sales.js';

const venues = [{ id: 10, city: 'Jerusalem' }, { id: 20, city: 'Bnei Brak' }, { id: 30, city: 'Jerusalem' }];
const sale = (id, venueId, stores, dates, status = 'scheduled') => ({
  id, venueId, stores: stores.map(storeId => ({ storeId })), days: dates.map(date => ({ date })), status,
});
const sales = [
  sale(1, 10, [1], ['2026-10-18']),
  sale(2, 20, [2], ['2026-10-19']),
  sale(3, 10, [1, 2], ['2026-10-18', '2026-10-21']),
  sale(4, 30, [2], ['2026-10-20'], 'cancelled'),
  sale(5, 20, [1], ['2026-10-17'], 'postponed'),
];
const filter = filters => filterAdminSales(sales, filters, venues, '2026-10-19').map(sale => sale.id);

test('admin periods use all sale dates, include today and do not conceal cancelled or postponed sales', () => {
  assert.deepEqual(filter({}), [1, 2, 3, 4, 5]);
  assert.deepEqual(filter({ period: 'past' }), [1, 5]);
  assert.deepEqual(filter({ period: 'upcoming' }), [2, 3, 4]);
  const unsorted = [sale(6, 10, [1], ['2026-10-22', '2026-10-17'])];
  assert.equal(filterAdminSales(unsorted, { period: 'upcoming' }, venues, '2026-10-19').length, 1);
});

test('admin filters combine period, participant, city and exact venue without mutating sales', () => {
  const before = structuredClone(sales);
  assert.deepEqual(filter({ store: '2' }), [2, 3, 4]);
  assert.deepEqual(filter({ city: 'Jerusalem' }), [1, 3, 4]);
  assert.deepEqual(filter({ venue: '10' }), [1, 3]);
  assert.deepEqual(filter({ period: 'upcoming', store: '2', city: 'Jerusalem', venue: '10' }), [3]);
  assert.deepEqual(filter({ city: 'Bnei Brak', venue: '10' }), []);
  assert.deepEqual(filter({ store: '999' }), []);
  assert.deepEqual(sales, before);
});
