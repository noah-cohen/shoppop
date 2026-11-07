export const CALENDAR_FILTERS_KEY = 'sale-calendar.filters.v1';

export function emptyCalendarFilters() {
  return { query: '', city: '', category: '', venue: '', store: '', outlet: '' };
}

function validateFilters(value) {
  const filters = emptyCalendarFilters();
  if (!value || Array.isArray(value) || !Object.keys(filters).every(key => typeof value[key] === 'string')) {
    throw new Error('Invalid calendar filters');
  }
  for (const key of Object.keys(filters)) filters[key] = value[key];
  return filters;
}

export function readCalendarFilters(storage) {
  const raw = storage.getItem(CALENDAR_FILTERS_KEY);
  return raw === null ? emptyCalendarFilters() : validateFilters(JSON.parse(raw));
}

export function writeCalendarFilters(storage, value) {
  const filters = validateFilters(value);
  storage.setItem(CALENDAR_FILTERS_KEY, JSON.stringify(filters));
}
