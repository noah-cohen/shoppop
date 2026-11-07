import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subscriberAge, subscriberAgeGroup, filterSubscribers, groupSubscribers, emailDirectory, renderSubscribers,
  SUBSCRIBER_PREFERENCES, SUBSCRIBER_AGES,
} from '../public/admin-subscribers.js';

const today = '2026-11-07';
const records = [
  { email: 'a@example.com', created: 1, profile: { firstName: 'Alpha', lastName: 'One', city: 'City A', gender: 'female', birthDate: '2002-11-08', updatesCity: false, updatesDaily: true, adsConsent: false } },
  { email: 'b@example.com', created: 2, profile: { firstName: 'Beta', lastName: 'Two', city: 'City A', gender: 'male', birthDate: '2002-11-07', updatesCity: true, updatesDaily: false, adsConsent: true } },
  { email: 'c@example.com', created: 3, profile: { firstName: 'Gamma', lastName: 'Three', city: 'City B', gender: 'unspecified', birthDate: '', updatesCity: true, adsConsent: false } },
  { email: 'legacy@example.com', created: 4, profile: null },
];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
test('subscriber ages respect birthdays, leap days, missing and invalid dates and every band boundary', () => {
  assert.equal(subscriberAge('2002-11-08', today), 23);
  assert.equal(subscriberAge('2002-11-07', today), 24);
  assert.equal(subscriberAge('2000-02-29', '2026-02-28'), 25);
  assert.equal(subscriberAge('2000-02-29', '2026-03-01'), 26);
  for (const value of ['', undefined, '2000-02-30', 'invalid', '2027-01-01']) assert.equal(subscriberAge(value, today), null);
  for (const [age, expected] of [[0, 0], [17, 0], [18, 1], [24, 1], [25, 2], [34, 2], [35, 3], [44, 3], [45, 4], [54, 4], [55, 5], [64, 5], [65, 6], [100, 6]]) {
    assert.equal(subscriberAgeGroup({ birthDate: `${2026 - age}-11-07` }, today), SUBSCRIBER_AGES[expected]);
  }
  assert.equal(subscriberAgeGroup(null, today), 'לא צוין');
});
test('filters combine all demographics and preferences without hiding opt-outs from city totals', () => {
  const before = structuredClone(records);
  assert.deepEqual(filterSubscribers(records, {}, today), records);
  assert.equal(filterSubscribers(records, { city: 'City A' }, today).length, 2);
  assert.deepEqual(filterSubscribers(records, { city: 'City A', gender: 'female', age: '18–24', preference: 'updatesDaily', query: 'ALPHA' }, today), [records[0]]);
  assert.deepEqual(filterSubscribers(records, { preference: 'adsConsent' }, today), [records[1]]);
  assert.deepEqual(filterSubscribers(records, { gender: 'unknown', age: 'לא צוין' }, today), [records[3]]);
  assert.deepEqual(filterSubscribers(records, { city: 'missing' }, today), []);
  assert.deepEqual(groupSubscribers(records, item => item.profile?.city || 'unknown').map(([city, members]) => [city, members.length]), [['City A', 2], ['City B', 1], ['unknown', 1]]);
  assert.deepEqual(records, before);
});
test('all-email directory deduplicates contact and account sources without implying consent', () => {
  const directory = emailDirectory(records, [{ email: ' A@EXAMPLE.COM ' }, { email: 'contact@example.com' }, { email: '' }, { email: 'contact@example.com' }]);
  assert.equal(directory.length, 5);
  assert.deepEqual(directory.find(item => item.email === 'a@example.com').sources, ['חשבון רשום', 'פניית יצירת קשר']);
  assert.deepEqual(directory.find(item => item.email === 'contact@example.com').sources, ['פניית יצירת קשר']);
  assert.equal(directory.find(item => item.email === 'contact@example.com').profile, undefined);
});
test('rendering has complete copy lists, all preference choices, escaped data and empty states', () => {
  const { html, emailLists } = renderSubscribers(records, [{ email: 'contact@example.com' }], { city: 'City A' }, today, esc);
  const listsByLabel = new Map([...html.matchAll(/data-email-list="(\d+)" aria-label="([^"]+)"/g)].map(([, index, label]) => [label, emailLists[Number(index)]]));
  assert.deepEqual(listsByLabel.get('העתקת מיילים — כל הנרשמים — החתך הנבחר'), ['a@example.com', 'b@example.com']);
  assert.deepEqual(listsByLabel.get('העתקת מיילים — כל המיילים'), ['a@example.com', 'b@example.com', 'c@example.com', 'contact@example.com', 'legacy@example.com']);
  assert.equal(listsByLabel.size > 0, true);
  assert([...listsByLabel.values()].every(list => Array.isArray(list)));
  for (const [, label] of SUBSCRIBER_PREFERENCES) assert(html.includes(label));
  for (const age of SUBSCRIBER_AGES) assert(html.includes(age));
  assert(html.includes('<details') && html.includes('<caption>') && html.includes('2 מתוך 4'));
  assert(!renderSubscribers([{ ...records[0], email: '<img onerror="bad">' }], [], {}, today, esc).html.includes('<img'));
  const empty = renderSubscribers([], [], {}, today, esc);
  assert(empty.html.includes('0 מתוך 0'));
  assert(empty.emailLists.every(list => list.length === 0));
});
