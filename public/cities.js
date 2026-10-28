export function cityChoices(cities, excludedCities, legacyCities = [], selected = '', query = '') {
  const excluded = new Set(excludedCities);
  const search = query.trim();
  return [...new Set([...cities, ...legacyCities.filter(city => !excluded.has(city)), selected].filter(Boolean))]
    .filter(city => city.includes(search) || city === selected)
    .sort((a, b) => a.localeCompare(b, 'he'));
}
