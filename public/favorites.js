export const FAVORITES_KEY = 'sale-calendar.favorites.v1';

export function readFavorites(storage) {
  const raw = storage.getItem(FAVORITES_KEY);
  if (raw === null) return { sales: [], stores: [] };
  const value = JSON.parse(raw);
  if (!value || !['sales', 'stores'].every(type => Array.isArray(value[type])
    && value[type].every(id => Number.isSafeInteger(id) && id > 0))) {
    throw new Error('Invalid favorites data');
  }
  return { sales: [...new Set(value.sales)], stores: [...new Set(value.stores)] };
}

export function toggleFavorite(storage, type, id) {
  if (!['sales', 'stores'].includes(type) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid favorite');
  }
  const favorites = readFavorites(storage);
  favorites[type] = favorites[type].includes(id)
    ? favorites[type].filter(value => value !== id) : [...favorites[type], id];
  storage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return favorites;
}

export function writeFavorites(storage, value) {
  const normalized = {
    sales: [...new Set(value?.sales || [])],
    stores: [...new Set(value?.stores || [])],
  };
  if (!['sales', 'stores'].every(type => Array.isArray(value?.[type])
    && normalized[type].every(id => Number.isSafeInteger(id) && id > 0))) {
    throw new Error('Invalid favorites data');
  }
  storage.setItem(FAVORITES_KEY, JSON.stringify(normalized));
  return normalized;
}
