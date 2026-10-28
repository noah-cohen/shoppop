import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = 'https://data.gov.il/api/3/action/datastore_search?resource_id=5c78e9fa-c2e2-4771-93ff-7f400a12f7ba&limit=10000';
const classificationSource = 'https://data.gov.il/api/3/action/datastore_search?resource_id=d47a54ff-87f0-44b3-b33a-f284c0c38e5a&limit=10000';

export function buildCityCatalog(records, classifications) {
  const byCode = new Map();
  for (const record of classifications) {
    const classification = record['דת יישוב'];
    if (classification !== null && ![1, 2, 3, 4].includes(classification)) {
      throw new Error('Unrecognized CBS locality classification; existing data was not replaced.');
    }
    byCode.set(Number(record['סמל יישוב']), classification);
  }
  const cities = [], excludedCities = [], unclassifiedCities = [];
  for (const record of records) {
    if (!(Number(record['סמל_ישוב']) > 0) || typeof record['שם_ישוב'] !== 'string') continue;
    const name = record['שם_ישוב'].trim();
    if (!name) continue;
    const classification = byCode.get(Number(record['סמל_ישוב']));
    if (classification === 2 || classification === 3) excludedCities.push(name);
    else {
      cities.push(name);
      if (classification === null || classification === undefined) unclassifiedCities.push(name);
    }
  }
  const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'he'));
  return { cities: sorted(cities), excludedCities: sorted(excludedCities), unclassifiedCities: sorted(unclassifiedCities) };
}
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Locality download failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success || !Array.isArray(payload.result?.records) || payload.result.records.length !== payload.result.total || payload.result.total < 1000) {
    throw new Error('Official locality response was incomplete; existing data was not replaced.');
  }
  return payload.result.records;
}
async function refreshCities() {
  const [records, classifications] = await Promise.all([download(source), download(classificationSource)]);
  const catalog = buildCityCatalog(records, classifications);
  if (catalog.cities.length < 1000 || catalog.excludedCities.length < 100) throw new Error('Unexpected locality counts; existing data was not replaced.');
  await writeFile(new URL('./public/cities.json', import.meta.url), `${JSON.stringify({
    source, sourceCount: records.length, classificationSource, classificationYear: 2023, fetchedAt: new Date().toISOString(),
    ...catalog,
  }, null, 2)}\n`, 'utf8');
  console.log(`Saved ${catalog.cities.length} localities; excluded ${catalog.excludedCities.length} CBS-classified Arab/Bedouin localities. Retained mixed localities and ${catalog.unclassifiedCities.length} unclassified current localities.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await refreshCities();
