import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEEKDAY_LABELS, dateDetails, dateLabel, parseDisplayDate } from '../public/dates.js';

test('dates include weekday, Hebrew letters and full Gregorian date', () => {
  assert.deepEqual(dateDetails('2026-10-17'), {
    weekday: 'מוצאי שבת', gregorian: '17/10/2026',
    hebrew: 'ו׳ בחשוון תשפ״ז', hebrewShort: 'ו׳ חשוון',
  });
  assert.equal(dateLabel('2026-10-17'), 'מוצאי שבת · ו׳ בחשוון תשפ״ז · 17/10/2026');
  assert.equal(dateLabel('2026-10-18'), 'יום ראשון · ז׳ בחשוון תשפ״ז · 18/10/2026');
  assert.equal(parseDisplayDate('17/10/2026'), '2026-10-17');
});
test('all weekdays have explicit day labels, with Saturday renamed throughout', () => {
  for (let offset = 0; offset < 7; offset++) {
    assert.equal(dateDetails(`2026-10-${18 + offset}`).weekday, WEEKDAY_LABELS[offset]);
  }
  assert.equal(WEEKDAY_LABELS[6], 'מוצאי שבת');
  assert.ok(WEEKDAY_LABELS.slice(0, 6).every(label => label.startsWith('יום ')));
});
test('Hebrew dates distinguish leap months, new years and special day numerals', () => {
  assert.equal(dateDetails('2024-03-01').hebrew, 'כ״א באדר א׳ תשפ״ד');
  assert.equal(dateDetails('2024-03-20').hebrew, 'י׳ באדר ב׳ תשפ״ד');
  assert.equal(dateDetails('2025-09-23').hebrew, 'א׳ בתשרי תשפ״ו');
  assert.equal(dateDetails('2026-10-26').hebrewShort, 'ט״ו חשוון');
  assert.equal(dateDetails('2026-10-27').hebrewShort, 'ט״ז חשוון');
});
test('date-only conversion is unchanged by the process timezone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Jerusalem', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(dateLabel('2026-10-17'), 'מוצאי שבת · ו׳ בחשוון תשפ״ז · 17/10/2026');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test('date formatting explicitly rejects invalid or ambiguous input', () => {
  for (const value of ['', '2026-02-30', '2026-13-01', '2026-10-0', '17/10/2026', '0000-01-01']) {
    assert.throws(() => dateDetails(value), RangeError);
  }
  for (const value of ['', '2026-10-17', '17.10.2026', '32/10/2026', '02/20/2009', '31/04/2026', '29/02/2025']) {
    assert.throws(() => parseDisplayDate(value), RangeError);
  }
});
