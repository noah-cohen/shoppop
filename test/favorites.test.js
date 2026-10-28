import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITES_KEY, readFavorites, toggleFavorite, writeFavorites } from '../public/favorites.js';

function storage(initial = null) {
  const entries = new Map(initial === null ? [] : [[FAVORITES_KEY, initial]]);
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}

test('favorites start empty and persist independently for stores and sales', () => {
  const saved = storage();
  assert.deepEqual(readFavorites(saved), { sales: [], stores: [] });
  assert.deepEqual(toggleFavorite(saved, 'sales', 12), { sales: [12], stores: [] });
  assert.deepEqual(toggleFavorite(saved, 'stores', 12), { sales: [12], stores: [12] });
  assert.deepEqual(readFavorites(saved), { sales: [12], stores: [12] });
  assert.deepEqual(toggleFavorite(saved, 'sales', 12), { sales: [], stores: [12] });
  assert.deepEqual(toggleFavorite(saved, 'stores', 12), { sales: [], stores: [] });
});

test('each toggle reads the latest stored favorites without losing changes from other tabs', () => {
  const saved = storage();
  toggleFavorite(saved, 'sales', 1);
  saved.setItem(FAVORITES_KEY, JSON.stringify({ sales: [1, 2], stores: [3] }));
  assert.deepEqual(toggleFavorite(saved, 'sales', 1), { sales: [2], stores: [3] });
});

test('duplicate identifiers are normalized', () => {
  assert.deepEqual(readFavorites(storage('{"sales":[1,1],"stores":[2,2]}')), { sales: [1], stores: [2] });
});

test('corrupt favorites are rejected without overwriting saved data', () => {
  for (const raw of ['{', 'null', '{}', '[]', '{"sales":[0],"stores":[]}', '{"sales":["1"],"stores":[]}', '{"sales":[-1],"stores":[]}', '{"sales":[],"stores":null}']) {
    const saved = storage(raw);
    assert.throws(() => readFavorites(saved));
    assert.throws(() => toggleFavorite(saved, 'sales', 1));
    assert.equal(saved.getItem(FAVORITES_KEY), raw);
  }
});

test('invalid types and identifiers cannot be saved', () => {
  const saved = storage();
  for (const [type, id] of [['venues', 1], ['sales', 0], ['stores', 1.5], ['sales', '1'], ['stores', Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => toggleFavorite(saved, type, id));
  }
  assert.equal(saved.getItem(FAVORITES_KEY), null);
});

test('blocked reads and failed writes propagate instead of reporting success', () => {
  assert.throws(() => readFavorites({ getItem() { throw new Error('blocked'); } }), /blocked/);
  const saved = storage('{"sales":[1],"stores":[]}');
  const unavailable = { ...saved, setItem() { throw new Error('quota exceeded'); } };
  assert.throws(() => toggleFavorite(unavailable, 'sales', 2), /quota exceeded/);
  assert.deepEqual(readFavorites(saved), { sales: [1], stores: [] });
});

test('server favorites can replace the local cache with normalized values', () => {
  const saved = storage();
  assert.deepEqual(writeFavorites(saved, { sales: [3, 3, 4], stores: [8] }), { sales: [3, 4], stores: [8] });
  assert.deepEqual(readFavorites(saved), { sales: [3, 4], stores: [8] });
  for (const invalid of [null, {}, { sales: '3', stores: [] }, { sales: [0], stores: [] }]) {
    assert.throws(() => writeFavorites(saved, invalid));
  }
});
