import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = 'https://data.gov.il/api/3/action/datastore_search?resource_id=9ad3862c-8391-4b2f-84a4-2d4c68625f4b';

export function buildStreetCatalog(records) {
  const cities = new Map();
  for (const record of records) {
    if (typeof record['שם_ישוב'] !== 'string' || typeof record['שם_רחוב'] !== 'string') throw new Error('Unexpected official street fields; existing catalog was not replaced.');
    const city = record['שם_ישוב'].trim(), street = record['שם_רחוב'].trim();
    if (!city || !street) continue;
    if (!cities.has(city)) cities.set(city, new Set());
    cities.get(city).add(street);
  }
  return Object.fromEntries([...cities].sort(([a], [b]) => a.localeCompare(b, 'he'))
    .map(([city, streets]) => [city, [...streets].sort((a, b) => a.localeCompare(b, 'he'))]));
}

async function refreshStreets() {
  const records = [];
  let total;
  do {
    const response = await fetch(`${source}&limit=10000&offset=${records.length}&sort=_id&include_total=true`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Street download failed: HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload.result;
    if (!payload.success || !Array.isArray(result?.records) || !Number.isSafeInteger(result.total) || result.total < 50000
      || result.total_was_estimated || (total !== undefined && result.total !== total) || !result.records.length) {
      throw new Error('Official street response was incomplete or changed during download; existing catalog was not replaced.');
    }
    total = result.total;
    records.push(...result.records);
  } while (records.length < total);
  if (records.length !== total || new Set(records.map(row => row._id)).size !== total) throw new Error('Incomplete street download; existing catalog was not replaced.');
  const cities = buildStreetCatalog(records);
  if (Object.keys(cities).length < 1000) throw new Error('Unexpected locality count; existing catalog was not replaced.');
  await writeFile(new URL('./streets.json', import.meta.url), `${JSON.stringify({ source, sourceCount: total, fetchedAt: new Date().toISOString(), cities })}\n`, 'utf8');
  console.log(`Saved ${total} official streets for ${Object.keys(cities).length} localities.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await refreshStreets();
