import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStreetCatalog } from '../update-streets.js';

test('street choices are grouped by city, trimmed, deduplicated and sorted in Hebrew', () => {
  const row = (city, street) => ({ 'שם_ישוב': city, 'שם_רחוב': street });
  assert.deepEqual(buildStreetCatalog([
    row(' ירושלים ', ' יפו '), row('ירושלים', 'אגריפס'), row('ירושלים', 'יפו'), row('בני ברק', 'יפו'), row('', 'רחוב'),
  ]), { 'בני ברק': ['יפו'], 'ירושלים': ['אגריפס', 'יפו'] });
  assert.throws(() => buildStreetCatalog([{ city: 'ירושלים', street: 'יפו' }]), /Unexpected official street fields/);
});

test('the local official street cache includes complete city-dependent choices', async () => {
  const catalog = JSON.parse(await readFile(new URL('../streets.json', import.meta.url), 'utf8'));
  assert.match(catalog.source, /^https:\/\/data\.gov\.il\//);
  assert.ok(catalog.sourceCount >= 50000);
  assert.ok(Object.keys(catalog.cities).length > 1000);
  for (const city of ['ירושלים', 'בני ברק', 'בית שמש', 'חיפה']) assert.ok(catalog.cities[city].length > 100);
  assert.ok(catalog.cities['ירושלים'].includes('יפו'));
  for (const streets of Object.values(catalog.cities)) {
    assert.equal(new Set(streets).size, streets.length);
    assert.deepEqual(streets, [...streets].sort((a, b) => a.localeCompare(b, 'he')));
  }
});
