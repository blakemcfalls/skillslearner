// Progress storage and the spaced-repetition scheduler (an SM-2 variant).
const KEY = 'dtl.progress.v1';

const fresh = () => ({
  v: 1, started: null, lessons: {}, cards: {}, days: {},
  settings: { newPerDay: 1, reviewCap: 20, freeRoam: false, theme: 'auto' },
});

let mem = null;
let storageOk = true;

export function today(d = new Date()) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
export const dayToDate = n => new Date(n * 864e5 + new Date().getTimezoneOffset() * 6e4);

export function load() {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    mem = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
    mem.settings = { ...fresh().settings, ...(mem.settings || {}) };
  } catch { mem = fresh(); storageOk = false; }
  return mem;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); storageOk = true; }
  catch { storageOk = false; }
  return storageOk;
}
export const canPersist = () => storageOk;

export function reset() { mem = fresh(); save(); }
export function exportJSON() { return JSON.stringify(load(), null, 1); }
export function importJSON(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.v !== 1 || typeof obj.lessons !== 'object' || typeof obj.cards !== 'object') throw new Error('Not a progress file from this app');
  mem = { ...fresh(), ...obj, settings: { ...fresh().settings, ...(obj.settings || {}) } };
  save();
}

function bump(kind, n = 1) {
  const st = load(), d = today();
  st.days[d] = st.days[d] || { r: 0, l: 0 };
  st.days[d][kind] += n;
  if (!st.started) st.started = d;
}

// ---- lessons -----------------------------------------------------------------
export const isDone = id => !!load().lessons[id]?.done;
export function lessonState(id) { return load().lessons[id] || {}; }
export function patchLesson(id, patch) {
  const st = load();
  st.lessons[id] = { ...(st.lessons[id] || {}), ...patch };
  save();
}
export function completeLesson(id, cardIds) {
  const st = load(), d = today();
  if (!st.lessons[id]?.done) bump('l');
  st.lessons[id] = { ...(st.lessons[id] || {}), done: d };
  cardIds.forEach(cid => { if (!st.cards[cid]) st.cards[cid] = { ef: 2.5, ivl: 0, due: d + 1, reps: 0, lapses: 0 }; });
  save();
}
export const lessonsDoneOn = d => Object.values(load().lessons).filter(l => l.done === d).length;

// ---- cards -------------------------------------------------------------------
// rating: 0 again, 1 hard, 2 good, 3 easy
export function schedule(card, rating, d = today()) {
  const c = { ...card };
  if (rating === 0) {
    c.reps = 0; c.lapses = (c.lapses || 0) + 1; c.ef = Math.max(1.3, c.ef - 0.2); c.ivl = 1;
  } else {
    if (c.reps === 0) c.ivl = rating === 3 ? 3 : 1;
    else if (c.reps === 1) c.ivl = rating === 1 ? 2 : rating === 3 ? 6 : 3;
    else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * (rating === 1 ? 1.2 : rating === 3 ? c.ef * 1.3 : c.ef)));
    c.ef = Math.max(1.3, Math.min(3.0, c.ef + (rating === 1 ? -0.15 : rating === 3 ? 0.15 : 0)));
    c.reps += 1;
  }
  c.ivl = Math.min(c.ivl, 365);
  c.due = d + c.ivl; c.last = d;
  return c;
}

export function rate(cardId, rating) {
  const st = load();
  const cur = st.cards[cardId] || { ef: 2.5, ivl: 0, due: today(), reps: 0, lapses: 0 };
  st.cards[cardId] = schedule(cur, rating);
  bump('r');
  save();
  return st.cards[cardId];
}

export function dueCards(d = today()) {
  const st = load();
  return Object.entries(st.cards).filter(([, c]) => c.due <= d)
    .sort((a, b) => (a[1].due - b[1].due) || (a[1].ivl - b[1].ivl)).map(([id]) => id);
}
export const cardState = id => load().cards[id];

export function forecast(days = 14) {
  const st = load(), d = today(), out = new Array(days).fill(0);
  Object.values(st.cards).forEach(c => { const k = Math.max(0, c.due - d); if (k < days) out[k]++; });
  return out;
}

export function streak() {
  const st = load();
  let d = today(), n = 0;
  const active = k => st.days[k] && (st.days[k].r + st.days[k].l) > 0;
  if (!active(d)) d -= 1;
  while (active(d)) { n++; d--; }
  return n;
}

// A card is "mature" once its interval reaches three weeks.
export function maturity(cardIds) {
  const st = load();
  let seen = 0, mature = 0;
  cardIds.forEach(id => { const c = st.cards[id]; if (c) { seen++; if (c.ivl >= 21) mature++; } });
  return { seen, mature, total: cardIds.length };
}
