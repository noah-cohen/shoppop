import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCityCatalog } from '../update-cities.js';
import { cityChoices } from '../public/cities.js';

test('official locality codes exclude classifications 2 and 3, retain mixed and unclassified localities', () => {
  const names = ['ירושלים', 'נצרת', 'יישוב חדש', 'חיפה', 'שבט לדוגמה'];
  const records = names.map((name, index) => ({ 'סמל_ישוב': String(index + 1), 'שם_ישוב': name }));
  const classifications = [4, 2, null, 4, 3].map((group, index) => ({ 'סמל יישוב': index + 1, 'דת יישוב': group }));
  const catalog = buildCityCatalog(records, classifications);
  assert.deepEqual(catalog.cities, ['חיפה', 'יישוב חדש', 'ירושלים']);
  assert.deepEqual(catalog.excludedCities, ['נצרת', 'שבט לדוגמה']);
  assert.deepEqual(catalog.unclassifiedCities, ['יישוב חדש']);
  assert.throws(() => buildCityCatalog(records, [{ 'סמל יישוב': 1, 'דת יישוב': 9 }]), /Unrecognized CBS/);
});
test('catalog classification uses stable codes rather than locality spelling', () => {
  const result = buildCityCatalog([
    { 'סמל_ישוב': '1', 'שם_ישוב': ' שם עדכני ' },
    { 'סמל_ישוב': '2', 'שם_ישוב': 'יישוב ללא סיווג' },
  ], [{ 'סמל יישוב': 1, 'שם יישוב': 'שם ישן', 'דת יישוב': 2 }]);
  assert.deepEqual(result.excludedCities, ['שם עדכני']);
  assert.deepEqual(result.unclassifiedCities, ['יישוב ללא סיווג']);
});
test('search choices are sorted, deduplicated, searchable and do not restore excluded legacy cities', () => {
  const cities = ['ירושלים', 'חיפה', 'אילת', 'ירושלים'];
  assert.deepEqual(cityChoices(cities, ['נצרת'], ['נצרת', 'עיר קיימת']), ['אילת', 'חיפה', 'ירושלים', 'עיר קיימת']);
  assert.deepEqual(cityChoices(cities, [], [], '', '  חיפ '), ['חיפה']);
  assert.deepEqual(cityChoices(cities, [], [], '', 'לא קיים'), []);
  assert.deepEqual(cityChoices(cities, ['נצרת'], ['נצרת'], 'נצרת', 'איל'), ['אילת', 'נצרת']);
});
test('cached city list retains mixed cities and excludes verified Arab localities', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/cities.json', import.meta.url), 'utf8'));
  for (const city of ['ירושלים', 'חיפה', 'עכו', 'לוד', 'אילת', 'בני ברק']) assert.ok(catalog.cities.includes(city), city);
  for (const city of ['נצרת', 'רהט', 'אום אל-פחם', 'אבו גוש']) {
    assert.ok(!catalog.cities.includes(city), city);
    assert.ok(catalog.excludedCities.includes(city), city);
  }
  assert.deepEqual(catalog.cities, [...new Set(catalog.cities)].sort((a, b) => a.localeCompare(b, 'he')));
  assert.equal(catalog.cities.length + catalog.excludedCities.length, catalog.sourceCount);
  assert.equal(catalog.classificationYear, 2023);
  assert.match(catalog.classificationSource, /d47a54ff/);
});
