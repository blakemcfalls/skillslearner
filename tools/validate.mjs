// Headless checks for the whole course. Run: node tools/validate.mjs
//  - schema: every lesson has the parts the app needs, ids are unique, prereqs point backwards
//  - sims: init/step/draw run without throwing or drawing NaN at default, min and max settings
//  - missions: goal() is false at the start and true after applying the lesson's `win`
//  - coverage: every skill has at least one lesson
//  - python: with --py, each code exercise's solution passes its own tests (needs python3 + numpy)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const { UNITS, LESSONS, SKILLS, byId } = await import('../js/course.js');
const { makeG, defaults } = await import('../js/sim.js');

const errors = [], warns = [];
const err = (l, m) => errors.push(`${l.id}: ${m}`);

function mockCtx(onBad) {
  const chk = (name, args) => { for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) onBad(`${name}(${[...args].map(x => (typeof x === 'number' ? +x.toFixed?.(2) : typeof x)).join(', ')})`); };
  const target = { canvas: { width: 700, height: 300 }, measureText: s => ({ width: String(s).length * 7 }) };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData' || k === 'createImageData') return (a, b, w, hh) => ({ data: new Uint8ClampedArray((w || a) * (hh || b) * 4), width: w || a, height: hh || b });
      return (...args) => { if (['moveTo', 'lineTo', 'arc', 'ellipse', 'fillRect', 'strokeRect', 'rect', 'fillText', 'quadraticCurveTo', 'bezierCurveTo'].includes(k)) chk(k, args); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const colors = { ink: '#111111', dim: '#666666', grid: '#dddddd', panel: '#ffffff', a: '#e5480f', b: '#1f5fbf', c: '#0f8a7a', d: '#7a4fd0', good: '#1a8f4c', bad: '#c8321f', dark: false };

function runSim(l, tweak, seconds = 2) {
  const spec = l.sim, p = defaults(spec);
  if (tweak) Object.assign(p, tweak);
  let bad = null;
  const g = makeG(mockCtx(m => { bad = bad || m; }), 700, spec.h || 300, colors);
  let s = spec.init ? spec.init(p) : {};
  let t = 0;
  const tick = n => { for (let i = 0; i < n; i++) { if (spec.step) { t += 1 / 60; spec.step(s, p, 1 / 60, t); } } g.clear(); spec.draw(g, s, p, t); if (spec.read) spec.read(s, p); };
  tick(1); tick(Math.round(seconds * 60));
  return { s, p, g, bad, tick, t: () => t };
}

const seen = new Set();
const skillCount = Object.fromEntries(Object.keys(SKILLS).map(k => [k, 0]));
let missions = 0, codeEx = 0;

for (const l of LESSONS) {
  if (seen.has(l.id)) err(l, 'duplicate id'); seen.add(l.id);
  if (!/^[a-z0-9-]+$/.test(l.id)) err(l, 'id must be kebab-case');
  if (!SKILLS[l.skill]) err(l, `unknown skill ${l.skill}`); else skillCount[l.skill]++;
  for (const f of ['title', 'hook']) if (!l[f]) err(l, `missing ${f}`);
  if (!Array.isArray(l.body) || l.body.length < 2) err(l, 'body needs at least 2 items');
  if (l.cards.length < 2) err(l, 'needs at least 2 recall cards');
  if (l.quiz.length < 2) err(l, 'needs at least 2 quiz questions');
  l.cards.forEach((c, i) => { if (!c.q || !c.a) err(l, `card ${i} needs q and a`); });
  l.quiz.forEach((q, i) => {
    if (!q.q || !q.why) err(l, `quiz ${i} needs q and why`);
    if (q.choices) { if (!(q.answer >= 0 && q.answer < q.choices.length)) err(l, `quiz ${i} answer index out of range`); if (q.choices.length < 3) err(l, `quiz ${i} needs 3+ choices`); }
    else if (typeof q.num !== 'number') err(l, `quiz ${i} needs choices or num`);
  });
  (l.pre || []).forEach(pid => { if (!byId[pid]) err(l, `unknown prereq ${pid}`); else if (byId[pid].index >= l.index) err(l, `prereq ${pid} comes later`); });
  if (l.index > 0 && !(l.pre || []).length) warns.push(`${l.id}: no prerequisites listed (no warm-up)`);

  const spec = l.sim;
  if (!spec || typeof spec.draw !== 'function') { err(l, 'missing sim.draw'); continue; }
  const sliders = (spec.controls || []).filter(c => c.k && !c.type);
  try {
    const base = runSim(l);
    if (base.bad) err(l, `non-finite draw call at defaults: ${base.bad}`);
    for (const c of sliders) for (const v of [c.min, c.max]) {
      const r = runSim(l, { [c.k]: v }, 1);
      if (r.bad) err(l, `non-finite draw with ${c.k}=${v}: ${r.bad}`);
    }
    for (const c of (spec.controls || []).filter(c => c.type === 'toggle')) { const r = runSim(l, { [c.k]: !c.v }, 1); if (r.bad) err(l, `non-finite draw with ${c.k} toggled`); }
    for (const c of (spec.controls || []).filter(c => c.type === 'select')) for (const [v] of c.options) { const r = runSim(l, { [c.k]: v }, 1); if (r.bad) err(l, `non-finite draw with ${c.k}=${v}`); }
    for (const c of (spec.controls || []).filter(c => c.type === 'button')) { const r = runSim(l, null, 0.2); c.on(r.s, r.p); r.tick(30); if (r.bad) err(l, `non-finite draw after button "${c.label}"`); }
    if (spec.drag) { const r = runSim(l, null, 0.2); for (const ph of ['down', 'move', 'up']) spec.drag(r.s, r.p, (r.g.x0 + r.g.x1) / 2, (r.g.y0 + r.g.y1) / 2, ph); r.tick(10); if (r.bad) err(l, 'non-finite draw after drag'); }

    if (spec.mission || spec.goal) {
      missions++;
      if (!spec.mission || !spec.goal) err(l, 'mission and goal must come together');
      else if (spec.win == null) err(l, 'mission has no `win` solution to verify');
      else {
        const start = runSim(l, null, 3);
        if (spec.goal(start.s, start.p)) err(l, 'goal is already true at default settings');
        let r;
        if (typeof spec.win === 'function') { r = runSim(l, null, 0.1); spec.win(r.s, r.p); r.tick(60 * (spec.winTime || 6)); }
        else {
          const pset = { ...defaults(spec), ...spec.win };
          for (const [k, v] of Object.entries(spec.win)) { const c = (spec.controls || []).find(c => c.k === k); if (!c) err(l, `win sets unknown control ${k}`); else if (!c.type && (v < c.min || v > c.max)) err(l, `win ${k}=${v} is outside the slider range`); else if (!c.type && Math.abs((v - c.min) / (c.step || 1e-9) - Math.round((v - c.min) / (c.step || 1e-9))) > 1e-6) err(l, `win ${k}=${v} is not reachable with step ${c.step}`); }
          r = runSim(l, pset, spec.winTime || 6);
        }
        let ok = false;
        for (let i = 0; i < 600 && !ok; i++) { ok = !!spec.goal(r.s, r.p); if (!ok) r.tick(1); }
        if (!ok) err(l, 'goal not reached with the `win` solution');
      }
    }
  } catch (e) { err(l, `sim threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }

  if (l.code) {
    codeEx++;
    for (const f of ['prompt', 'starter', 'tests', 'solution', 'hint']) if (!l.code[f]) err(l, `code.${f} missing`);
  }
}

Object.entries(skillCount).forEach(([k, n]) => { if (!n) errors.push(`skill "${k}" has no lessons`); });

if (process.argv.includes('--py')) {
  const dir = mkdtempSync(join(tmpdir(), 'dtl-'));
  for (const l of LESSONS.filter(l => l.code)) {
    const run = (src, name) => { const f = join(dir, `${l.id}-${name}.py`); writeFileSync(f, src); return execFileSync('python3', ['-I', f], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); };
    try { run(l.code.solution + '\n\n' + l.code.tests + '\nprint("PASS")\n', 'sol'); }
    catch (e) { err(l, `python solution fails its tests: ${(e.stderr || e.message).trim().split('\n').slice(-2).join(' | ')}`); }
    let starterPasses = false;
    try { run(l.code.starter + '\n\n' + l.code.tests + '\n', 'starter'); starterPasses = true; } catch { /* expected */ }
    if (starterPasses) err(l, 'python starter code already passes the tests');
  }
}

const tracks = {};
LESSONS.forEach(l => { const t = SKILLS[l.skill]?.track; tracks[t] = (tracks[t] || 0) + 1; });
console.log(`${LESSONS.length} lessons in ${UNITS.length} units | ${Object.keys(SKILLS).length} skills | ${missions} missions | ${codeEx} code exercises`);
console.log(`by track: ${JSON.stringify(tracks)}`);
console.log(`cards: ${LESSONS.reduce((n, l) => n + l.cards.length + l.quiz.length, 0)}`);
if (process.argv.includes('--warn')) warns.forEach(w => console.log('warn  ' + w));
if (errors.length) { errors.forEach(e => console.log('ERROR ' + e)); console.log(`\n${errors.length} error(s)`); process.exit(1); }
console.log('All checks passed.');
