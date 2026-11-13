// Unit tests for the spaced-repetition scheduler. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const store = await import('../js/store.js');
const fresh = { ef: 2.5, ivl: 0, due: 0, reps: 0, lapses: 0 };

test('a new card rated "got it" returns after 1 day, then 3, then grows by its ease', () => {
  let c = store.schedule(fresh, 2, 100);
  assert.equal(c.ivl, 1); assert.equal(c.due, 101);
  c = store.schedule(c, 2, 101); assert.equal(c.ivl, 3);
  c = store.schedule(c, 2, 104); assert.equal(c.ivl, 8);       // round(3 * 2.5)
  c = store.schedule(c, 2, 112); assert.equal(c.ivl, 20);
});

test('intervals always widen on success, even when rated "hard"', () => {
  let c = { ...fresh };
  let last = 0;
  for (let i = 0, d = 0; i < 8; i++) { c = store.schedule(c, 1, d); d = c.due; assert.ok(c.ivl >= last, `interval shrank at review ${i}`); last = c.ivl; }
  assert.ok(c.ef >= 1.3, 'ease never drops below 1.3');
});

test('a miss resets the card to tomorrow and lowers its ease', () => {
  let c = store.schedule(store.schedule(store.schedule(fresh, 2, 0), 2, 1), 2, 4);
  const before = c.ef;
  c = store.schedule(c, 0, 12);
  assert.equal(c.ivl, 1); assert.equal(c.reps, 0); assert.equal(c.lapses, 1); assert.ok(c.ef < before);
});

test('"easy" grows faster than "got it"', () => {
  const base = store.schedule(store.schedule(fresh, 2, 0), 2, 1);
  assert.ok(store.schedule(base, 3, 4).ivl > store.schedule(base, 2, 4).ivl);
});

test('intervals are capped at one year', () => {
  let c = { ...fresh };
  for (let i = 0, d = 0; i < 30; i++) { c = store.schedule(c, 3, d); d = c.due; }
  assert.equal(c.ivl, 365);
});

test('completing a lesson schedules its cards for tomorrow and counts the day', () => {
  store.reset();
  const d = store.today();
  store.completeLesson('x', ['x:c0', 'x:q0']);
  assert.ok(store.isDone('x'));
  assert.equal(store.dueCards(d).length, 0);
  assert.deepEqual(store.dueCards(d + 1).sort(), ['x:c0', 'x:q0']);
  assert.equal(store.lessonsDoneOn(d), 1);
  assert.equal(store.streak(), 1);
  store.completeLesson('x', ['x:c0', 'x:q0']);                 // completing twice changes nothing
  assert.equal(store.load().days[d].l, 1);
});

test('progress survives export and import, and bad files are rejected', () => {
  store.reset(); store.completeLesson('y', ['y:c0']);
  const text = store.exportJSON();
  store.reset(); assert.equal(store.isDone('y'), false);
  store.importJSON(text); assert.ok(store.isDone('y'));
  assert.throws(() => store.importJSON('{"hello":1}'));
});

test('due cards come back most overdue first', () => {
  store.reset();
  const st = store.load(), d = store.today();
  st.cards = { a: { ...fresh, due: d - 1, ivl: 5 }, b: { ...fresh, due: d - 4, ivl: 2 }, c: { ...fresh, due: d + 2, ivl: 1 } };
  assert.deepEqual(store.dueCards(d), ['b', 'a']);
});
