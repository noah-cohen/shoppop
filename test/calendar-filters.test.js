import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_FILTERS_KEY, emptyCalendarFilters, readCalendarFilters, writeCalendarFilters } from '../public/calendar-filters.js';

function storage(raw = null) {
  const entries = new Map(raw === null ? [] : [[CALENDAR_FILTERS_KEY, raw]]);
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}

test('first visit shows all cities and all other filters, with independent defaults', () => {
  const saved = storage();
  assert.deepEqual(readCalendarFilters(saved), { query: '', city: '', category: '', venue: '', store: '', outlet: '' });
  const filters = emptyCalendarFilters();
  filters.city = 'Test city';
  assert.equal(emptyCalendarFilters().city, '');
  assert.equal(saved.getItem(CALENDAR_FILTERS_KEY), null);
});

test('all manually selected filters survive a new visit and clearing stays cleared', () => {
  const saved = storage();
  const selected = { query: 'Shop', city: 'Test city', category: 'Clothes', venue: '12', store: '34', outlet: 'outlet' };
  writeCalendarFilters(saved, selected);
  assert.deepEqual(readCalendarFilters(saved), selected);
  writeCalendarFilters(saved, emptyCalendarFilters());
  assert.deepEqual(readCalendarFilters(saved), emptyCalendarFilters());
  assert.equal(readCalendarFilters(saved).city, '');
});

test('malformed saved values and nonstring fields are rejected without overwriting', () => {
  for (const raw of ['{', 'null', '[]', '{}', JSON.stringify({ ...emptyCalendarFilters(), city: 42 })]) {
    const saved = storage(raw);
    assert.throws(() => readCalendarFilters(saved));
    assert.equal(saved.getItem(CALENDAR_FILTERS_KEY), raw);
  }
  const saved = storage();
  assert.throws(() => writeCalendarFilters(saved, { ...emptyCalendarFilters(), venue: null }));
  assert.equal(saved.getItem(CALENDAR_FILTERS_KEY), null);
});

test('blocked storage and failed writes propagate errors and preserve the previous selection', () => {
  assert.throws(() => readCalendarFilters({ getItem() { throw new Error('blocked'); } }), /blocked/);
  const saved = storage();
  writeCalendarFilters(saved, { ...emptyCalendarFilters(), city: 'Previous city' });
  assert.throws(() => writeCalendarFilters({ ...saved, setItem() { throw new Error('quota'); } }, emptyCalendarFilters()), /quota/);
  assert.equal(readCalendarFilters(saved).city, 'Previous city');
});
