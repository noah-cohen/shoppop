import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleDateRange, isUniformSaleRange } from '../public/dates.js';

test('single day and inclusive ranges produce the API day structure', () => {
  assert.deepEqual(saleDateRange('2026-10-19', '2026-10-19', '10:00', '20:00'), [
    { date: '2026-10-19', open: '10:00', close: '20:00' },
  ]);
  const days = saleDateRange('2026-10-24', '2026-10-26', '09:00', '18:00');
  assert.deepEqual(days.map(day => day.date), ['2026-10-24', '2026-10-25', '2026-10-26']);
  assert.ok(days.every(day => day.open === '09:00' && day.close === '18:00'));
  assert.equal(saleDateRange('2024-02-28', '2024-03-01', '10:00', '20:00').length, 3);
  assert.equal(saleDateRange('9999-12-31', '9999-12-31', '10:00', '20:00').length, 1);
});

test('ranges enforce exact 366-day limit and reject invalid dates and hours', () => {
  assert.equal(saleDateRange('2024-01-01', '2024-12-31', '10:00', '20:00').length, 366);
  assert.throws(() => saleDateRange('2024-01-01', '2025-01-01', '10:00', '20:00'), /366/);
  for (const [start, end, open, close] of [
    ['', '', '10:00', '20:00'],
    ['2026-02-30', '2026-03-01', '10:00', '20:00'],
    ['2026-10-20', '2026-10-19', '10:00', '20:00'],
    ['2026-10-19', '2026-10-19', '22:00', '02:00'],
    ['2026-10-19', '2026-10-19', '10:00', '10:00'],
    ['2026-10-19', '2026-10-19', '25:00', '26:00'],
  ]) assert.throws(() => saleDateRange(start, end, open, close));
});

test('custom schedules are recognized without changing nonconsecutive dates or individual hours', () => {
  const days = saleDateRange('2026-10-19', '2026-10-21', '10:00', '20:00');
  assert.equal(isUniformSaleRange([...days].reverse()), true);
  assert.equal(isUniformSaleRange([days[0], days[2]]), false);
  assert.equal(isUniformSaleRange([days[0], { ...days[1], close: '16:00' }, days[2]]), false);
  assert.equal(isUniformSaleRange([days[0], { ...days[1], date: '2028-01-01' }]), false);
  assert.equal(isUniformSaleRange([]), false);
});
