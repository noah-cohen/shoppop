import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWeek, copySundayHours, weeklyHoursError } from '../public/store-hours.js';
import { validateEntity, InputError } from '../validation.js';

test('new weekly hours have seven independent unspecified days', () => {
  const week = emptyWeek();
  assert.equal(weeklyHoursError(week), '');
  assert.deepEqual(week.map(day => day.day), [0, 1, 2, 3, 4, 5, 6]);
  week[0].status = 'closed';
  assert.equal(week[1].status, 'unknown');
});

test('Sunday hours copy only to Sunday through Thursday and remain individually editable', () => {
  const week = emptyWeek();
  week[0] = { day: 0, status: 'open', open: '10:00', close: '19:00' };
  week[5] = { day: 5, status: 'open', open: '09:00', close: '12:00' };
  week[6].status = 'closed';
  const before = structuredClone(week);
  const copied = copySundayHours(week);
  assert.deepEqual(week, before);
  for (let day = 0; day < 5; day++) assert.deepEqual(copied[day], { ...week[0], day });
  assert.deepEqual(copied.slice(5), week.slice(5));
  copied[2].close = '16:00';
  assert.equal(copied[0].close, '19:00');
  assert.equal(copied[3].close, '19:00');
  assert.equal(weeklyHoursError(copied), '');
});

test('closed Sunday can be copied, but missing or invalid Sunday hours cannot', () => {
  const week = emptyWeek();
  assert.throws(() => copySundayHours(week), /יום ראשון/);
  week[0].status = 'closed';
  assert.ok(copySundayHours(week).slice(0, 5).every(day => day.status === 'closed'));
  week[0] = { day: 0, status: 'open', open: '19:00', close: '10:00' };
  assert.throws(() => copySundayHours(week), /סגירה/);
});

test('two daily ranges copy independently and survive store validation without changing legacy days', () => {
  const week = emptyWeek();
  week[0] = { day: 0, status: 'open', open: '08:00', close: '13:00', open2: '16:00', close2: '22:00' };
  week[5] = { day: 5, status: 'open', open: '09:00', close: '12:00' };
  const copied = copySundayHours(week);
  assert.equal(weeklyHoursError(copied), '');
  for (let day = 0; day < 5; day++) assert.deepEqual(copied[day], { ...week[0], day });
  copied[2].close2 = '21:00';
  assert.equal(copied[0].close2, '22:00');
  assert.equal(week[0].close2, '22:00');
  assert.deepEqual(copied.slice(5), week.slice(5));
  const store = validateEntity('stores', {
    name: 'Test', categories: [], addresses: [{ address: 'Legacy address', weeklyHours: copied }],
  });
  assert.deepEqual(store.addresses[0].weeklyHours, copied);
  assert.equal(store.addresses[0].weeklyHours[5].open2, undefined);
});

test('second range rejects incomplete, invalid, overlapping, reversed, overnight and non-open hours', () => {
  const first = { day: 0, status: 'open', open: '08:00', close: '13:00' };
  for (const second of [
    { open2: '16:00' }, { close2: '22:00' }, { open2: '', close2: '' },
    { open2: null, close2: '22:00' }, { open2: '4:00', close2: '22:00' },
    { open2: '16:00', close2: '24:00' }, { open2: '16:60', close2: '22:00' },
    { open2: '12:59', close2: '22:00' }, { open2: '16:00', close2: '16:00' },
    { open2: '22:00', close2: '02:00' },
    { status: 'closed', open: '', close: '', open2: '16:00', close2: '22:00' },
    { status: 'unknown', open: '', close: '', open2: '16:00', close2: '22:00' },
  ]) {
    const week = emptyWeek();
    week[0] = { ...first, ...second };
    assert.ok(weeklyHoursError(week), JSON.stringify(second));
    assert.throws(() => copySundayHours(week));
    assert.throws(() => validateEntity('stores', {
      name: 'Test', categories: [], addresses: [{ address: 'Test address', weeklyHours: week }],
    }), InputError);
  }
  const touching = emptyWeek();
  touching[0] = { ...first, open2: '13:00', close2: '22:00' };
  assert.equal(weeklyHoursError(touching), '');
});

test('weekly validation rejects malformed, duplicate, overnight, and inconsistent entries', () => {
  for (const value of [null, {}, [], emptyWeek().slice(1), Array(7).fill(null)]) assert.ok(weeklyHoursError(value));
  for (const invalid of [
    { day: 1, status: 'unknown', open: '', close: '' },
    { day: 0, status: 'invalid', open: '', close: '' },
    { day: 0, status: 'closed', open: '10:00', close: '' },
    { day: 0, status: 'open', open: '10:00', close: '10:00' },
    { day: 0, status: 'open', open: '22:00', close: '02:00' },
    { day: 0, status: 'open', open: '25:00', close: '26:00' },
  ]) {
    const week = emptyWeek();
    week[0] = invalid;
    assert.ok(weeklyHoursError(week));
  }
});

test('store validation preserves legacy text and normalizes structured addresses and weekly hours', () => {
  const store = { name: 'Test', categories: [], addresses: [{ address: 'Old address', hours: 'Unstructured hours\nExceptions' }] };
  const legacy = validateEntity('stores', store);
  assert.equal(legacy.addresses[0].address, 'Old address');
  assert.equal(legacy.addresses[0].hours, store.addresses[0].hours);
  assert.equal(legacy.addresses[0].weeklyHours, undefined);
  const address = { city: 'ירושלים', street: 'יפו', buildingNumber: '12א', arrivalNotes: 'כניסה מהחצר\nקומה 2', hours: 'חריגים', weeklyHours: emptyWeek() };
  const result = validateEntity('stores', { ...store, addresses: [address] });
  assert.equal(result.addresses[0].address, 'יפו 12א');
  assert.equal(result.addresses[0].city, 'ירושלים');
  assert.deepEqual(result.addresses[0].weeklyHours, address.weeklyHours);
  for (const fields of [{ city: '' }, { street: '' }, { arrivalNotes: 'x'.repeat(2001) }, { weeklyHours: null }]) {
    assert.throws(() => validateEntity('stores', { ...store, addresses: [{ ...address, ...fields }] }), InputError);
  }
});
