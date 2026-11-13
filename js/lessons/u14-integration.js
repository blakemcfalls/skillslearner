import { num, rng, rk4, clamp } from '../sim.js';
const { sin, cos, atan2, PI, sqrt, exp, log, abs, max, min, hypot, floor, round, log10, log2 } = Math;
const rad = d => d * PI / 180;
const money = v => (v >= 1e6 ? '$' + num(v / 1e6, 3) + 'M' : '$' + num(v / 1e3, 3) + 'k');

// --- a classification game used by two lessons ---
function wrap(g, text, x, y, wpx, color, size = 13) {
  g.ctx.font = `${size}px system-ui, sans-serif`;
  const words = text.split(' '); let line = '', row = 0;
  words.forEach(w => { const t = line ? line + ' ' + w : w; if (g.ctx.measureText(t).width > wpx && line) { g.text(line, x, y + row * (size + 6), color, { px: true, s: size, mono: false }); line = w; row++; } else line = t; });
  g.text(line, x, y + row * (size + 6), color, { px: true, s: size, mono: false });
  return row + 1;
}
function classifier(items, cats, mission) {
  return {
    h: 280, resettable: true,
    controls: [
      { k: 'i', label: 'Item', min: 1, max: items.length, step: 1, v: 1, fmt: v => `${v} of ${items.length}` },
      { k: 'd', type: 'select', label: 'Your call', v: cats[0][0], options: cats },
      { type: 'button', label: 'Record my call', on: (s, p) => { s.ans[p.i - 1] = p.d; } },
    ],
    init: () => ({ ans: items.map(() => null) }),
    draw(g, s, p) {
      const it = items[p.i - 1], a = s.ans[p.i - 1];
      g.text(`ITEM ${p.i}`, 16, 22, g.c.dim, { px: true, s: 11 });
      const rows = wrap(g, it[0], 16, 50, g.w - 32, g.c.ink, 15);
      const y = 50 + rows * 21 + 14;
      if (a == null) g.text('Choose a category, then record your call.', 16, y, g.c.dim, { px: true, s: 12.5, mono: false });
      else { const ok = a === it[1]; g.text(ok ? 'Correct.' : 'Not this one. Try another category.', 16, y, ok ? g.c.good : g.c.bad, { px: true, s: 13, mono: false, bold: true }); if (ok) wrap(g, it[2], 16, y + 24, g.w - 32, g.c.dim, 12.5); }
      items.forEach((q, k) => { const st = s.ans[k]; g.ctx.fillStyle = st == null ? g.c.grid : st === q[1] ? g.c.good : g.c.bad; g.ctx.fillRect(16 + k * 30, g.h - 28, 24, 12); if (k === p.i - 1) { g.ctx.strokeStyle = g.c.ink; g.ctx.lineWidth = 2; g.ctx.strokeRect(15 + k * 30, g.h - 29, 26, 14); } });
    },
    read: s => [['correct so far', `${s.ans.filter((a, k) => a === items[k][1]).length} of ${items.length}`]],
    mission, goal: s => s.ans.every((a, k) => a === items[k][1]),
    win: s => { items.forEach((q, k) => { s.ans[k] = q[1]; }); },
  };
}

// --- trade study ---
const CONCEPTS = [['A  Exquisite', [9, 3, 4, 4]], ['B  Balanced', [7, 6, 7, 7]], ['C  Simple', [4, 9, 8, 8]]];
const trade = p => { const w = [p.wp, p.wc, p.ws, p.wr], tot = CONCEPTS.map(([, s]) => s.reduce((a, v, i) => a + v * w[i], 0)); return { w, tot }; };

// --- mass budget ---
export function budget(p) { const base = p.pay + 0.12 * p.pw + 40, c = 1 + p.cont / 100, dry = base * c / (1 - 0.22 * c), prop = dry * (exp(p.dv / 2158) - 1), wet = dry + prop; return { base, dry, prop, wet, margin: (500 - wet) / 500 * 100, growth: c / (1 - 0.22 * c) * exp(p.dv / 2158), struct: 0.22 * dry, contKg: dry - base - 0.22 * dry }; }

// --- interfaces ---
export function ifaces(p) { const n = 12, m = p.m, size = Array.from({ length: m }, (_, i) => floor(n / m) + (i < n % m ? 1 : 0)), intra = size.reduce((a, k) => a + k * (k - 1) / 2, 0), cross = m === 1 ? 0 : p.bus ? m : m * (m - 1) / 2; return { size, intra, cross, total: intra + cross }; }

// --- model fidelity ---
function shoot(o, dt) {
  const acc = (y, vx, vy) => { const rx = vx + (o.wind ? 8 : 0), v = hypot(rx, vy), k = o.drag ? 1.2e-4 * (o.dens ? exp(-y / 8000) : 1) : 0; return [-k * v * rx, -9.81 - k * v * vy]; };
  let x = 0, y = 0, vx = 300 * cos(rad(40)), vy = 300 * sin(rad(40));
  for (let i = 0; i < 2e6; i++) {
    const [a1x, a1y] = acc(y, vx, vy), mx = vx + a1x * dt / 2, my = vy + a1y * dt / 2, [a2x, a2y] = acc(y + vy * dt / 2, mx, my);
    const ny = y + my * dt; if (ny < 0) { x += mx * dt * y / (y - ny); break; }
    x += mx * dt; y = ny; vx += a2x * dt; vy += a2y * dt;
  }
  return x;
}
const TRUTH = shoot({ drag: 1, dens: 1, wind: 1 }, 0.002);
const fmem = new Map();
export function fidelity(p) { const key = [p.drag, p.dens, p.wind, p.ldt].join(); if (fmem.has(key)) return fmem.get(key); const dt = 10 ** p.ldt, r = shoot(p, dt), res = { r, err: abs(r - TRUTH) / TRUTH * 100, cost: (1 + (p.drag ? 2 : 0) + (p.drag && p.dens ? 3 : 0) + (p.drag && p.wind ? 2 : 0)) * 0.1 / dt }; fmem.set(key, res); return res; }
export const FBEST = (() => { let b = 1e9; for (const drag of [0, 1]) for (const dens of [0, 1]) for (const wind of [0, 1]) for (let l = -2; l <= 0.701; l += 0.1) { const f = fidelity({ drag: !!drag, dens: !!dens, wind: !!wind, ldt: round(l * 10) / 10 }); if (f.err < 1) b = min(b, f.cost); } return b; })();

// --- dispersion ---
const DZ = (() => { const r = rng(55); return Array.from({ length: 1500 }, () => [r.n(), r.n(), r.n(), r.n()]); })();
export function disperse(p) { const pts = DZ.map(([a, b, c, d]) => [62.5 * p.sv * a + 8 * p.sw * c, 10 * p.sa * b + 8 * p.sw * d]), rr = pts.map(q => hypot(q[0], q[1])).sort((u, v) => u - v); return { pts, cep: rr[750], parts: [(62.5 * p.sv) ** 2, (10 * p.sa) ** 2, 2 * (8 * p.sw) ** 2] }; }

// --- end-to-end homing loop with a noisy seeker ---
const emem = new Map();
export function homing(p) {
  const key = [p.noise, p.rate, p.N].join(); if (emem.has(key)) return emem.get(key);
  const r = rng(101), misses = [], T = 1 / p.rate, n = max(2, round(0.3 / T)); let sample = null;
  for (let run = 0; run < 24; run++) {
    let mx = 0, my = 0, tx = 6000, ty = 1500, hm = atan2(1500, 6000) + 0.2, t = 0, next = 0, buf = [], a = 0, miss = 0; const dt = 0.005, path = [];
    for (let i = 0; i < 4000; i++) {
      const rx = tx - mx, ry = ty - my, vrx = -250 - 600 * cos(hm), vry = -600 * sin(hm), tca = -(rx * vrx + ry * vry) / (vrx * vrx + vry * vry);
      if (run === 0 && i % 20 === 0) path.push([mx, my, tx, ty]);
      if (tca <= dt) { miss = hypot(rx + vrx * max(0, tca), ry + vry * max(0, tca)); break; }
      if (t >= next) { next += T; buf.push([t, atan2(ry, rx) + p.noise / 1000 * r.n()]); if (buf.length > n) buf.shift(); if (buf.length >= 2) { const mt = buf.reduce((s, q) => s + q[0], 0) / buf.length, ml = buf.reduce((s, q) => s + q[1], 0) / buf.length; let nu = 0, de = 0; buf.forEach(q => { nu += (q[0] - mt) * (q[1] - ml); de += (q[0] - mt) ** 2; }); a = clamp(p.N * (-(rx * vrx + ry * vry) / hypot(rx, ry)) * nu / de, -300, 300); } }
      hm += a / 600 * dt; mx += 600 * cos(hm) * dt; my += 600 * sin(hm) * dt; tx -= 250 * dt; t += dt; miss = hypot(rx, ry);
    }
    misses.push(miss); if (run === 0) sample = path;
  }
  misses.sort((u, v) => u - v);
  const res = { misses, p3: misses.filter(m => m < 0.5).length / misses.length, med: misses[12], sample };
  if (emem.size > 200) emem.clear(); emem.set(key, res); return res;
}

// --- defect removal economics ---
const EFF = [2, 3, 6, 10], FIX = [1, 3, 10, 30];
export function defects(x) {
  const d = [50, 30, 20], eff = e => 1 - exp(-0.6 * e), found = [0, 0, 0, 0];
  found[0] = d[0] * eff(x[0]); d[0] -= found[0];                       // reviews see design defects
  found[1] = d[1] * eff(x[1]); d[1] -= found[1];                       // unit tests see coding defects
  const a = d[1] * eff(x[2]), b = d[2] * eff(x[2]); found[2] = a + b; d[1] -= a; d[2] -= b; // integration sees code and interface defects
  const rest = d[0] + d[1] + d[2]; found[3] = rest * eff(x[3]); const left = rest - found[3];
  const effort = x.reduce((s, e, i) => s + e * EFF[i], 0), fixes = found.reduce((s, f, i) => s + f * FIX[i], 0);
  return { found, left, cost: effort + fixes + left * 200, parts: [effort, fixes, left * 200] };
}
export const DBEST = (() => { let b = 1e9; for (let a = 0; a <= 10; a++) for (let c = 0; c <= 10; c++) for (let d = 0; d <= 10; d++) for (let e = 0; e <= 10; e++) b = min(b, defects([a, c, d, e]).cost); return b; })();

// --- reliability demonstrated at 90% confidence ---
export function rlow(n, f) { const tail = R => { let s = 0, c = 1; for (let k = 0; k <= f; k++) { s += c * (1 - R) ** k * R ** (n - k); c = c * (n - k) / (k + 1); } return s; }; let lo = 0, hi = 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (tail(m) > 0.1) hi = m; else lo = m; } return f >= n ? 0 : (lo + hi) / 2; }

// --- engagement economics ---
export function exchange(p) { const q = 1 - p.pk, kill = 1 - q ** p.n, shots = p.sls ? (1 - q ** p.n) / (1 - q) : p.n; return { leak: (1 - kill) * 100, shots, ratio: shots * 10 ** p.li / 10 ** p.lt }; }

// --- learning curve ---
export function wright(p, Q = 10 ** p.lq) { const b = log2(p.lr / 100), rec = p.t1 * Q ** b / (1 + b); return { b, unit: p.t1 * Q ** b, rec, avg: rec + p.nre / Q }; }

// --- acquisition model ---
export const program = p => ({ years: 0.96 * (p.trl - 3) + 6 + 0.9 * max(0, 7 - p.trl) + 0.6 * p.rc - 0.03 * p.cc, growth: 4 + 13 * max(0, 7 - p.trl) + 0.35 * p.cc + 7 * p.rc });

export default {
  id: 'u14', title: 'Integration', blurb: 'Turning technology into fielded systems.',
  lessons: [
    {
      id: 'syseng-trades', skill: 'syseng', title: 'Systems engineering and the trade study', pre: ['opt-lagrange', 'sat-link-budget', 'prop-rocket-eq'],
      hook: 'The best radar bolted to the best airframe can still be a bad aircraft. Systems engineering is the discipline of making the whole thing work, on purpose.',
      body: [
        'Systems engineering manages a design from need to disposal. Its shape is the **V-model**: down the left side you decompose (stakeholder needs → system requirements → subsystem requirements → component design); across the bottom you build; up the right side you integrate and verify each level against the requirement written opposite it.',
        'At every level there are alternatives, and choosing among them is a **trade study**:',
        { list: ['Define the criteria that matter: performance, cost, schedule, risk.', 'Weight them according to stakeholder priorities.', 'Score each concept on each criterion, from analysis and test where possible.', 'Compute weighted totals, then **test the sensitivity**: does the winner survive reasonable changes in weights and scores?'] },
        'The arithmetic is trivial. The value is in forcing priorities into the open and in discovering when a decision is fragile. If a small shift in weighting changes the winner, the honest conclusion is that the concepts are close, and the choice should rest on something the matrix does not capture.',
        'Good systems engineers also keep asking the question that precedes every trade: what problem is this system actually solving?',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'wp', label: 'Weight: performance', min: 0, max: 10, step: 1, v: 8 }, { k: 'wc', label: 'Weight: cost', min: 0, max: 10, step: 1, v: 1 },
          { k: 'ws', label: 'Weight: schedule', min: 0, max: 10, step: 1, v: 1 }, { k: 'wr', label: 'Weight: low risk', min: 0, max: 10, step: 1, v: 1 },
        ],
        draw(g, s, p) {
          const t = trade(p), mx = max(1, ...t.tot), cols = [g.c.a, g.c.b, g.c.c, g.c.d], win = t.tot.indexOf(max(...t.tot));
          g.view(0, mx * 1.12, 0, 3, { pad: [110, 12, 14, 34] }).axes({ xl: 'weighted score', yt: false, grid: false });
          CONCEPTS.forEach(([name, sc], i) => { let x = 0; sc.forEach((v, k) => { g.rect(x, 2.2 - i + 0.0, v * t.w[k], 0.6, cols[k], { fa: 0.85 }); x += v * t.w[k]; }); g.text(name, 0, 2.5 - i, i === win ? g.c.ink : g.c.dim, { a: 'right', dx: -8, s: 12, mono: false, bold: i === win }); g.text(num(t.tot[i], 3), x, 2.5 - i, g.c.ink, { dx: 6, s: 11 }); });
          ['performance', 'cost', 'schedule', 'risk'].forEach((n, k) => g.note(n, 'br', cols[k], 3 - k));
        },
        read: (s, p) => { const t = trade(p), o = t.tot.slice().sort((a, b) => b - a); return [['winner', CONCEPTS[t.tot.indexOf(o[0])][0]], ['margin over runner-up', o[0] ? num((o[0] - o[1]) / o[0] * 100, 3) + ' %' : '–']]; },
        mission: 'Find a set of priorities under which the simple concept C wins by at least 5%.',
        goal: (s, p) => { const t = trade(p); return t.tot[2] > 0 && t.tot[2] >= 1.0526 * max(t.tot[0], t.tot[1]); },
        win: { wp: 2, wc: 6, ws: 3, wr: 3 },
      },
      cards: [
        { q: 'Describe the systems engineering V-model.', a: 'Left side: decompose needs into system, subsystem and component requirements. Bottom: build. Right side: integrate and verify each level against the requirements defined at the same level on the left.' },
        { q: 'What are the steps of a trade study, and which is most often skipped?', a: 'Define criteria, weight them, score the alternatives, total, then test sensitivity. Sensitivity analysis is the step that shows whether the result can be trusted, and the one most often skipped.' },
      ],
      quiz: [
        { q: 'Weights are performance 5, cost 3, risk 2. A concept scores 8, 4 and 6. What is its weighted total?', num: 64, tol: 0.1, why: '$5 × 8 + 3 × 4 + 2 × 6 = 64$.' },
        { q: 'A trade study’s winner changes when one weight moves from 5 to 6. The right conclusion is:', choices: ['The original winner is clearly best', 'The alternatives are effectively tied on these criteria', 'The study should be discarded', 'Weights should never be changed'], answer: 1, why: 'A fragile result means the matrix cannot separate the options. Look for discriminators it does not capture, or refine the scoring.' },
      ],
    },
    {
      id: 'syseng-margins', skill: 'syseng', title: 'Budgets, margins and the mass spiral', pre: ['syseng-trades', 'prop-rocket-eq', 'calc-multiple-integrals'],
      hook: 'Every program starts light and ends heavy. The ones that fly are the ones that planned for it.',
      body: [
        'A system has finite resources: mass, power, data, link margin, pointing error, timing. Each is managed as a **technical budget**: an allocation to every subsystem, summing to less than the limit.',
        'Early estimates are always low, because parts not yet designed are missing from the list. So each item carries **contingency** sized to its maturity (roughly 5% for flown hardware, 30% for a new design), and the system keeps a further **margin** against the hard limit. Margins are released deliberately as the design matures. Tracking them against a planned profile is a **technical performance measure**.',
        'Budgets are coupled, and the coupling amplifies. Add a kilogram of payload and you need more structure to carry it, more power and thermal control, and more propellant to move the lot:',
        { eq: 'Δm_{launch} = (growth factor) × Δm_{payload}' },
        'For spacecraft the factor is commonly 2 to 5; for a multi-stage launch vehicle, hundreds. This **mass spiral** is why late requirement growth is so expensive, and why saving a kilogram at the payload is worth far more than a kilogram.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'pay', label: 'Payload mass', min: 40, max: 200, step: 5, v: 150, unit: 'kg' },
          { k: 'pw', label: 'Power required', min: 100, max: 600, step: 20, v: 400, unit: 'W' },
          { k: 'cont', label: 'Contingency held', min: 0, max: 40, step: 1, v: 25, unit: '%' },
          { k: 'dv', label: 'Δv requirement', min: 0, max: 600, step: 20, v: 400, unit: 'm/s' },
        ],
        draw(g, s, p) {
          const b = budget(p), parts = [['payload', p.pay, g.c.c], ['power', 0.12 * p.pw, g.c.b], ['avionics', 40, g.c.d], ['structure', b.struct, g.c.dim], ['contingency', b.contKg, g.c.ink], ['propellant', b.prop, g.c.a]];
          g.view(0, 700, 0, 2, { pad: [14, 30, 14, 34] }).axes({ xl: 'launch mass (kg)', yt: false, grid: false });
          let x = 0; parts.forEach(([n, m, col]) => { g.rect(x, 0.6, m, 0.9, col, { fa: 0.8, stroke: g.c.panel }); if (m > 34) g.text(n, x + m / 2, 1.05, '#fff', { a: 'center', s: 10 }); x += m; });
          g.line(500, 0.2, 500, 1.9, g.c.bad, { w: 2, dash: [6, 4] }).text('launch limit 500 kg', 505, 1.8, g.c.bad, { s: 11 });
        },
        read: (s, p) => { const b = budget(p); return [['dry mass', num(b.dry, 4) + ' kg'], ['launch mass', num(b.wet, 4) + ' kg'], ['margin to limit', num(b.margin, 3) + ' %'], ['growth factor', num(b.growth, 3) + ' kg per payload kg']]; },
        mission: 'Carry at least 150 kg of payload with 10% or more launch margin, holding at least 20% contingency and 300 m/s of Δv.',
        goal: (s, p) => p.pay >= 150 && p.cont >= 20 && p.dv >= 300 && budget(p).margin >= 10,
        win: { pay: 150, pw: 200, cont: 20, dv: 300 },
      },
      cards: [
        { q: 'What is the difference between contingency and margin in a technical budget?', a: 'Contingency is added to each item’s estimate according to its design maturity. Margin is what remains between the total (with contingency) and the hard limit.' },
        { q: 'What is the mass growth factor (mass spiral)?', a: 'The total increase in system mass per unit increase in payload mass, counting the extra structure, power, thermal and propellant needed to support it. Typically 2–5 for spacecraft.' },
      ],
      quiz: [
        { q: 'A spacecraft has a growth factor of 3.5. A late instrument change adds 8 kg. Launch mass rises by about:', num: 28, unit: 'kg', tol: 0.3, why: '$3.5 × 8 = 28$ kg.' },
        { q: 'Which item should carry the largest mass contingency?', choices: ['A flight-proven battery', 'A new mechanism still at concept stage', 'A catalog star tracker', 'A rebuilt copy of a flown structure'], answer: 1, why: 'Contingency scales with uncertainty. An undesigned mechanism will almost certainly grow.' },
      ],
    },
    {
      id: 'req-writing', skill: 'req', title: 'Requirements that can be verified', pre: ['syseng-trades', 'vcs-testing'],
      hook: 'Most failed programs can be traced to a sentence written in the first month. A requirement nobody can test is a wish.',
      body: [
        'A requirement states what the system must do, in a way that someone can later prove true or false. The convention is one "**shall**" per statement. A good requirement is:',
        { list: ['**Necessary.** Removing it would leave a real need unmet.', '**Unambiguous.** Only one interpretation. No "user-friendly", "robust", "adequate" or "as appropriate".', '**Verifiable.** It has a measurable threshold and conditions, so a test, analysis, inspection or demonstration can close it.', '**Singular.** One thing per statement. "and" usually hides two requirements with two verifications.', '**Solution-free.** It states the need, not the design. "Shall use processor X" forecloses better answers unless it truly is a constraint.'] },
        'Every requirement should also be **traceable**: upward to the need that justifies it and downward to the design element and test that satisfy it. Orphan requirements cost money for no purpose; untraced needs are discovered in the field.',
        'In the lab, judge six draft requirements.',
      ],
      sim: classifier([
        ['The system shall be user-friendly.', 'vague', '"User-friendly" is subjective. State a measurable task, time and error rate.'],
        ['The radar shall detect a 1 m² target at 100 km with detection probability of at least 0.9 at a false alarm probability of 10⁻⁶.', 'good', 'Quantity, condition and threshold are all stated. It can be tested.'],
        ['The vehicle shall weigh less than 250 kg and shall operate for 8 hours.', 'compound', 'Two requirements in one sentence. Each needs its own identifier and verification.'],
        ['The flight computer shall be an ARM Cortex-R5.', 'design', 'This dictates a solution. State the processing, timing and environment needs instead, unless the part is a true constraint.'],
        ['The data link shall minimize latency.', 'open', '"Minimize" has no finish line. Give a number: for example, 50 ms or less, 95% of the time.'],
        ['The battery shall supply 28 V ± 2 V at loads from 0 to 40 A.', 'good', 'Measurable output with tolerance over a stated range.'],
      ], [['good', 'Well formed'], ['vague', 'Subjective wording'], ['compound', 'More than one requirement'], ['design', 'Dictates a design'], ['open', 'No measurable threshold']], 'Diagnose all six draft requirements correctly.'),
      cards: [
        { q: 'List five properties of a well-written requirement.', a: 'Necessary, unambiguous, verifiable (measurable threshold and conditions), singular (one "shall"), and solution-free (states the need, not the design). Also traceable.' },
        { q: 'What is requirements traceability?', a: 'Links from each requirement up to the stakeholder need that justifies it and down to the design elements and verification activities that satisfy it.' },
      ],
      quiz: [
        { q: 'Which is the best-formed requirement?', choices: ['The antenna shall have high gain.', 'The antenna shall provide at least 30 dBi of gain from 8.0 to 8.4 GHz.', 'The antenna shall be a 1.2 m carbon-fiber dish.', 'The antenna shall be lightweight and shall survive launch.'], answer: 1, why: 'It gives a measurable threshold and the conditions under which it applies, without dictating the design.' },
        { q: 'Why is "The system shall maximize range" a poor requirement?', choices: ['Range is unimportant', 'It can never be shown to be satisfied', 'It is too specific', 'It has two verbs'], answer: 1, why: 'Without a threshold no test can close it, and any design can be argued to fail it.' },
      ],
    },
    {
      id: 'req-interfaces', skill: 'req', title: 'Interfaces and modularity', pre: ['req-writing', 'swarm-consensus', 'rust-traits'],
      hook: 'Subsystems rarely fail alone. Systems fail at the seams, where one team’s assumption meets another team’s hardware.',
      body: [
        'An **interface** is any boundary across which subsystems exchange something: power, data, force, heat, fluid, timing. Each one must be defined in an **interface control document** (ICD) agreed by both sides: connectors and pinouts, voltages, message formats and units, timing, mechanical envelopes.',
        'The count grows fast. If every one of $n$ subsystems talks to every other, there are',
        { eq: 'n(n − 1)/2', where: 'possible interfaces: 66 for twelve subsystems' },
        'and each is something to document, test and keep consistent through every change. An **N² diagram** lays subsystems along the diagonal of a matrix and marks each interface off the diagonal, making the coupling visible.',
        '**Modularity** is the cure: group tightly coupled elements into modules and let modules interact only through a few well-defined interfaces, ideally a common bus and an open standard. Too few modules and each is a tangle inside; too many and the cross-module interfaces multiply. Somewhere between is a minimum.',
        'A modular open architecture also lets a sensor or processor be upgraded without redesigning the platform, which is why it is now policy for many defense programs.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'm', label: 'Number of modules', min: 1, max: 6, step: 1, v: 1 },
          { k: 'bus', type: 'toggle', label: 'Modules connect through a common bus', v: false },
        ],
        draw(g, s, p) {
          const f = ifaces(p), n = 12, mod = []; f.size.forEach((k, i) => { for (let j = 0; j < k; j++) mod.push(i); });
          const first = f.size.map((_, i) => mod.indexOf(i));
          g.view(0, n, 0, n, { eq: true, pad: [10, 10, 10, 10] });
          for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            const y = n - 1 - r, same = mod[r] === mod[c]; let col = g.c.grid, fa = 0.35;
            if (r === c) { col = g.c.ink; fa = 0.85; } else if (same) { col = g.c.b; fa = 0.75; } else if (p.m > 1 && first.includes(r) && first.includes(c) && !p.bus) { col = g.c.a; fa = 0.85; }
            g.rect(c + 0.05, y + 0.05, 0.9, 0.9, col, { fa });
          }
          if (p.bus && p.m > 1) first.forEach(r => g.dot(r + 0.5, n - 0.5 - r, g.c.a, 5, { ring: g.c.panel }));
          g.note('within a module', 'tr', g.c.b).note(p.bus ? 'bus connection' : 'between modules', 'tr', g.c.a, 1);
        },
        read: (s, p) => { const f = ifaces(p); return [['subsystems', 12], ['interfaces inside modules', f.intra], ['interfaces between modules', f.cross], ['total to define and test', f.total]]; },
        mission: 'Partition the twelve subsystems so that fewer than 20 interfaces must be defined, without using the bus.',
        goal: (s, p) => !p.bus && ifaces(p).total < 20,
        win: { m: 4, bus: false },
      },
      cards: [
        { q: 'How many interfaces are possible among $n$ fully interconnected subsystems?', a: '$n(n−1)/2$.' },
        { q: 'What is an interface control document?', a: 'The agreed, controlled definition of an interface between two subsystems: mechanical, electrical, data, timing and environmental details. Both sides design and test against it.' },
        { q: 'Why does modular open architecture matter for long-lived systems?', a: 'Components interact only through defined, published interfaces, so one can be upgraded or replaced, possibly by a different supplier, without redesigning the rest.' },
      ],
      quiz: [
        { q: 'A system has 20 subsystems, each connected to every other. How many interfaces is that?', num: 190, tol: 0.5, why: '$20 × 19/2 = 190$.' },
        { q: 'Two teams each test their own unit successfully, yet the pair fails when connected. The most likely cause is:', choices: ['A defective component', 'A mismatch in an interface assumption, such as units, polarity or timing', 'Insufficient power', 'A software virus'], answer: 1, why: 'Each unit met its own interpretation of the interface. The interpretations differed.' },
      ],
    },
    {
      id: 'modsim-fidelity', skill: 'modsim', title: 'Modeling: how much fidelity is enough?', pre: ['num-euler-rk4', 'mech-kinematics', 'syseng-margins'],
      hook: 'A model is a tool for answering a question. Too crude and the answer is wrong; too detailed and it arrives after the decision was made.',
      body: [
        'Every model leaves things out. **Fidelity** is how much physics it keeps: a point mass in vacuum, then drag, then an atmosphere that thins with height, then wind, then six degrees of freedom with flexible structure and sensor models. Each step up the ladder costs development effort, input data you may not have, and run time.',
        'The right level depends on the question. For first sizing, an equation on a whiteboard. For a requirement with a 1% tolerance, every effect larger than 1% must be included, and no more.',
        'Two checks keep a model honest, and they are different:',
        { list: ['**Verification**: are the equations solved correctly? Compare against exact solutions, shrink the time step until the answer stops changing, test conservation laws.', '**Validation**: are they the right equations? Compare against experiment or flight data, within the range where the model will be used.'] },
        'A model that has not been validated for the conditions of interest produces numbers, not evidence. Report its assumptions and its tested range along with its output.',
        'In the lab the "truth" is the most detailed model at a tiny time step. Find the cheapest model that agrees with it to 1%.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'drag', type: 'toggle', label: 'Aerodynamic drag', v: false },
          { k: 'dens', type: 'toggle', label: 'Air density falls with altitude', v: false },
          { k: 'wind', type: 'toggle', label: 'Headwind', v: false },
          { k: 'ldt', label: 'Time step', min: -2, max: 0.7, step: 0.1, v: -2, fmt: v => num(10 ** v, 2) + ' s' },
        ],
        draw(g, s, p) {
          const f = fidelity(p);
          g.view(0, 10000, 0, 3, { pad: [14, 26, 14, 34] }).axes({ xl: 'predicted range (m)', yt: false, grid: false });
          g.rect(0, 1.7, TRUTH, 0.7, g.c.good, { fa: 0.6 }).text('reference: all effects, tiny step', 60, 2.65, g.c.good, { s: 11 });
          g.rect(0, 0.5, f.r, 0.7, f.err < 1 ? g.c.b : g.c.a, { fa: 0.8 }).text('this model', 60, 0.25, g.c.ink, { s: 11 });
          g.rect(TRUTH * 0.99, 0.3, TRUTH * 0.02, 2.3, g.c.good, { fa: 0.25 });
        },
        read: (s, p) => { const f = fidelity(p); return [['range', num(f.r, 5) + ' m'], ['error', num(f.err, 3) + ' %'], ['compute cost', num(f.cost, 3)], ['cheapest that passes', num(FBEST, 3)]]; },
        mission: 'Find a model within 1% of the reference whose compute cost is no more than 1.5 times the cheapest possible.',
        goal: (s, p) => { const f = fidelity(p); return f.err < 1 && f.cost <= 1.5 * FBEST; },
        win: { drag: true, dens: true, wind: true, ldt: 0.7 },
      },
      cards: [
        { q: 'Distinguish verification from validation of a model.', a: 'Verification: the equations are solved correctly (checked against exact solutions, convergence, conservation). Validation: they are the right equations for the purpose (checked against real data in the range of use).' },
        { q: 'How do you decide what fidelity a model needs?', a: 'From the question and its required accuracy: include every effect larger than the tolerance and stop there. Higher fidelity costs data, effort and run time.' },
      ],
      quiz: [
        { q: 'A simulation gives the same answer to four digits when its time step is halved. This is evidence of:', choices: ['Validation', 'Numerical convergence (a verification check)', 'Overfitting', 'Nothing useful'], answer: 1, why: 'Step-size independence shows the equations are being solved accurately. It says nothing about whether they describe reality.' },
        { q: 'A drag model validated from Mach 0.3 to 2 is used at Mach 6. Its output there is:', choices: ['Equally trustworthy', 'An extrapolation outside the validated range', 'More accurate', 'Guaranteed conservative'], answer: 1, why: 'Different physics dominates at Mach 6. The model has no evidence behind it there.' },
      ],
    },
    {
      id: 'mc-dispersion', skill: 'mc', title: 'Dispersion analysis and error budgets', pre: ['mc-basics', 'prob-gaussian-cov', 'modsim-fidelity', 'dfm-tolerances'],
      hook: 'A system misses for many small reasons at once. Finding which one matters most tells you where the next dollar should go.',
      body: [
        'A dispersion analysis runs a simulation thousands of times, each with every uncertain input drawn from its distribution: velocity error, pointing error, wind, mass, thrust misalignment. The scatter of outcomes is the system’s predicted performance.',
        'For impact accuracy the usual summary is **CEP**, circular error probable: the radius of the circle containing half the impacts.',
        'Independent error sources add in quadrature, as tolerances did:',
        { eq: 'σ_{total}^2 = σ_1^2 + σ_2^2 + σ_3^2 + …' },
        'Squaring makes the largest contributor dominate. If one source is 30 m and another 10 m, the total is 31.6 m; eliminating the smaller one entirely buys 1.6 m. An **error budget** allocates the allowed total among sources, and a sensitivity analysis shows which allocation is binding.',
        'The practical lesson: improve the largest term first. Money spent on a non-dominant source is nearly wasted.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'sv', label: 'Burnout speed error', min: 0.05, max: 1, step: 0.05, v: 0.5, unit: 'm/s' },
          { k: 'sa', label: 'Pointing error', min: 0.1, max: 2, step: 0.1, v: 0.5, unit: 'mrad' },
          { k: 'sw', label: 'Wind uncertainty', min: 0.2, max: 3, step: 0.1, v: 1, unit: 'm/s' },
        ],
        draw(g, s, p) {
          const d = disperse(p), split = min(g.h, g.w * 0.5), tot = d.parts.reduce((a, b) => a + b);
          g.view(-90, 90, -90, 90, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.line(-90, 0, 90, 0, g.c.grid, { w: 1 }).line(0, -90, 0, 90, g.c.grid, { w: 1 });
          g.clip(() => d.pts.forEach((q, i) => { if (i % 2 === 0) g.dot(q[0], q[1], g.c.b, 1.5, { alpha: 0.5 }); }));
          g.circle(0, 0, d.cep, g.c.a, { w: 2.5 }).circle(0, 0, 15, g.c.good, { w: 1.5, dash: [5, 4] });
          g.view(0, 1, 0, 3, { pad: [split + 110, 30, 20, 40] }).axes({ xl: 'share of total variance', yt: false, grid: false, xs: 0.25 });
          [['speed', g.c.a], ['pointing', g.c.c], ['wind', g.c.d]].forEach(([n, col], i) => { g.rect(0, 2.2 - i, d.parts[i] / tot, 0.6, col, { fa: 0.85 }); g.text(n, 0, 2.5 - i, g.c.ink, { a: 'right', dx: -8, s: 12, mono: false }); });
          g.note('CEP', 'tl', g.c.a).note('15 m goal', 'tl', g.c.good, 1);
        },
        read: (s, p) => { const d = disperse(p); return [['CEP', num(d.cep, 3) + ' m'], ['downrange σ', num(sqrt(d.parts[0] + d.parts[2] / 2), 3) + ' m'], ['crossrange σ', num(sqrt(d.parts[1] + d.parts[2] / 2), 3) + ' m']]; },
        mission: 'Bring CEP under 15 m by improving only one error source, leaving the other two at their starting values.',
        goal: (s, p) => disperse(p).cep < 15 && [p.sv !== 0.5, p.sa !== 0.5, p.sw !== 1].filter(Boolean).length === 1,
        win: { sv: 0.15 },
      },
      cards: [
        { q: 'What is CEP?', a: 'Circular error probable: the radius of the circle, centered on the aim point, that contains 50% of impacts.' },
        { q: 'How do independent error sources combine, and what does that imply for improving accuracy?', a: 'Variances add: $σ_{total}^2 = Σσ_i^2$. The largest source dominates, so effort should go to it first; reducing small sources barely changes the total.' },
      ],
      quiz: [
        { q: 'Three independent error sources are 12 m, 5 m and 3 m (1σ). What is their combined 1σ error in meters?', num: 13.34, unit: 'm', tol: 0.1, why: '$√(144 + 25 + 9) = √178 ≈ 13.3$ m.' },
        { q: 'In that case, completely eliminating the 3 m source reduces the total to:', num: 13, unit: 'm', tol: 0.05, why: '$√(144 + 25) = 13.0$ m. A 0.3 m gain: hardly worth paying for.' },
      ],
    },
    {
      id: 'modsim-engagement', skill: 'modsim', title: 'End-to-end simulation: when subsystems meet', pre: ['mc-dispersion', 'trajopt-pronav', 'kalman-tracking', 'req-interfaces'],
      hook: 'The seeker met its noise specification. The autopilot met its bandwidth specification. The system still missed. Only an end-to-end simulation would have shown why.',
      body: [
        'Subsystem requirements are allocated from a system requirement on the assumption that the parts interact as modeled. An **integrated simulation** closes the loop through all of them, sensor to processing to control to physics, and runs it many times with random errors.',
        'This lab joins three earlier lessons. A homing vehicle measures the line of sight with a noisy seeker at a fixed update rate, estimates the line-of-sight rate by fitting recent measurements, and flies proportional navigation on that estimate.',
        { list: ['Seeker **noise** becomes rate noise after differentiation, and guidance multiplies it by the navigation constant.', 'A slow **update rate** leaves fewer measurements to average and adds delay.', 'A high **navigation constant** corrects errors sooner and amplifies noise more.'] },
        'No single parameter decides the outcome. The system requirement, probability of a small miss, can be met by a better seeker, a faster one, or a retuned guidance law, and each costs something different. Deciding among them with evidence is the job of the integrated simulation, later anchored by hardware-in-the-loop and flight test.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'noise', label: 'Seeker angle noise', min: 0.1, max: 5, step: 0.1, v: 3, unit: 'mrad' },
          { k: 'rate', label: 'Seeker update rate', min: 5, max: 100, step: 5, v: 10, unit: 'Hz' },
          { k: 'N', label: 'Navigation constant', min: 2, max: 6, step: 0.25, v: 4 },
        ],
        draw(g, s, p) {
          const r = homing(p), split = g.w * 0.56;
          g.view(-200, 6200, -600, 2400, { pad: [44, 12, g.w - split, 30] }).axes({ xl: 'downrange (m)', yl: 'crossrange (m)' });
          g.clip(() => { g.path(r.sample.map(q => [q[0], q[1]]), g.c.a, { w: 2 }); g.path(r.sample.map(q => [q[2], q[3]]), g.c.b, { w: 2 }); });
          g.note('one sample run', 'tl', g.c.dim);
          g.view(0, 24, 0, max(1.5, r.misses[23] * 1.1), { pad: [split + 46, 12, 14, 30] }).axes({ xl: '24 runs, sorted', yl: 'miss distance (m)', xt: false });
          r.misses.forEach((m, i) => g.rect(i + 0.1, 0, 0.8, m, m < 0.5 ? g.c.good : g.c.bad, { fa: 0.8 }));
          g.line(0, 0.5, 24, 0.5, g.c.ink, { w: 1.2, dash: [5, 4] });
        },
        read: (s, p) => { const r = homing(p); return [['runs with miss under 0.5 m', num(r.p3 * 100, 3) + ' %'], ['median miss', num(r.med, 3) + ' m'], ['worst miss', num(r.misses[23], 3) + ' m']]; },
        mission: 'A direct hit is required. Find a combination in which at least 90% of runs miss by less than 0.5 m.',
        goal: (s, p) => homing(p).p3 >= 0.9,
        win: { noise: 0.5, rate: 50, N: 4 },
      },
      cards: [
        { q: 'Why can a system fail its requirement when every subsystem meets its own?', a: 'Subsystem allocations assume a model of how the parts interact. Coupling, delays, noise amplification and interface effects not captured in that model only appear when the loop is closed end to end.' },
        { q: 'What are the roles of integrated simulation, hardware-in-the-loop and flight test?', a: 'Integrated simulation explores the full loop cheaply across many random cases; hardware-in-the-loop replaces models with real hardware to catch what the models miss; flight test anchors and validates both.' },
      ],
      quiz: [
        { q: 'In a homing loop, raising the navigation constant with a noisy seeker tends to:', choices: ['Reduce commanded acceleration noise', 'Amplify seeker noise into the acceleration command', 'Have no effect', 'Lower the update rate'], answer: 1, why: 'The command is $N V_c λ̇$. Noise in the estimated line-of-sight rate is multiplied by $N$.' },
        { q: 'A requirement says "90% of engagements shall miss by less than 0.5 m". The appropriate way to assess it during design is:', choices: ['One nominal simulation run', 'A Monte Carlo set over the uncertain inputs', 'A subsystem bench test', 'An opinion survey'], answer: 1, why: 'The requirement is a probability, so it needs a statistically meaningful set of randomized runs.' },
      ],
    },
    {
      id: 'vv-verification', skill: 'vv', title: 'Verification and validation: find it early', pre: ['req-writing', 'vcs-testing', 'modsim-fidelity'],
      hook: 'A defect caught in review costs an hour. The same defect found in flight test costs a vehicle, and found in service costs lives.',
      body: [
        'Two questions close the right side of the V. **Verification**: did we build the system right, meaning it meets its written requirements? **Validation**: did we build the right system, meaning it does what its users actually need?',
        'Each requirement is verified by one of four methods, recorded in a **verification matrix**:',
        { list: ['**Test**: operate it under controlled conditions and measure.', '**Analysis**: show compliance by calculation or simulation, where testing is impractical.', '**Inspection**: examine it (dimensions, markings, workmanship).', '**Demonstration**: operate it and observe, without detailed measurement.'] },
        'The economics are stark. The cost of removing a defect rises roughly tenfold with each phase it survives: requirements review, unit test, integration, system test, field. Effort spent early (reviews, analysis, unit tests) removes defects when they are cheap. Effort saved early is repaid later with interest.',
        'The lab models 100 latent defects: 50 in requirements and design (visible to reviews), 30 in code (visible to unit tests) and 20 at interfaces (visible only once parts are integrated). System test can find any of them, at a price. Each filter’s catch rate depends on the effort you give it.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'e0', label: 'Reviews and analysis', min: 0, max: 10, step: 1, v: 0 }, { k: 'e1', label: 'Unit test', min: 0, max: 10, step: 1, v: 0 },
          { k: 'e2', label: 'Integration test', min: 0, max: 10, step: 1, v: 2 }, { k: 'e3', label: 'System test', min: 0, max: 10, step: 1, v: 8 },
        ],
        draw(g, s, p) {
          const d = defects([p.e0, p.e1, p.e2, p.e3]), half = g.w * 0.55;
          g.view(0, 5, 0, 105, { pad: [44, 12, g.w - half, 34] }).axes({ yl: 'defects found', xt: false, grid: false });
          ['review', 'unit', 'integ.', 'system', 'FIELD'].forEach((n, i) => { const v = i < 4 ? d.found[i] : d.left; g.rect(i + 0.15, 0, 0.7, v, i < 4 ? g.c.b : g.c.bad, { fa: 0.85 }); g.text(n, i + 0.5, 0, i < 4 ? g.c.ink : g.c.bad, { a: 'center', dy: 13, s: 10.5 }); g.text(num(v, 2), i + 0.5, v + 5, g.c.ink, { a: 'center', s: 10.5 }); });
          g.view(0, 3, 0, max(1200, d.cost * 1.1), { pad: [half + 56, 12, 14, 34] }).axes({ yl: 'cost', xt: false, grid: false });
          [['effort', g.c.dim], ['fixes', g.c.b], ['field', g.c.bad]].forEach(([n, col], i) => { g.rect(i + 0.15, 0, 0.7, d.parts[i], col, { fa: 0.85 }); g.text(n, i + 0.5, 0, col, { a: 'center', dy: 13, s: 10.5 }); });
        },
        read: (s, p) => { const d = defects([p.e0, p.e1, p.e2, p.e3]); return [['total cost', num(d.cost, 4)], ['lowest achievable', num(DBEST, 4)], ['defects reaching the field', num(d.left, 2)]]; },
        mission: 'Reallocate effort to bring total cost within 10% of the lowest achievable.',
        goal: (s, p) => defects([p.e0, p.e1, p.e2, p.e3]).cost <= 1.1 * DBEST,
        win: { e0: 8, e1: 7, e2: 6, e3: 5 },
      },
      cards: [
        { q: 'Distinguish verification from validation of a system.', a: 'Verification: it meets its specified requirements ("built it right"). Validation: it fulfils the users’ actual need in its intended environment ("built the right thing").' },
        { q: 'Name the four verification methods.', a: 'Test, analysis, inspection and demonstration.' },
        { q: 'Why does early defect removal dominate program cost?', a: 'The cost to fix a defect grows roughly tenfold for each phase it escapes. Reviews and unit tests remove defects at the cheapest point.' },
      ],
      quiz: [
        { q: 'A defect costs 1 unit to fix in review and ten times more for each of the next three phases it survives. What does it cost at system test (three phases later)?', num: 1000, tol: 1, why: '$1 × 10^3 = 1000$ units.' },
        { q: 'A requirement states that a part number shall be engraved on the housing. The natural verification method is:', choices: ['Test', 'Analysis', 'Inspection', 'Demonstration'], answer: 2, why: 'A visual or dimensional check of a physical feature is an inspection.' },
      ],
    },
    {
      id: 'vv-reliability', skill: 'vv', title: 'How many tests prove reliability?', pre: ['prob-estimation', 'vv-verification'],
      hook: 'Ten successes in ten tries sounds convincing. It supports a claim of only 79% reliability.',
      body: [
        'Reliability is the probability that an item performs as required. Demonstrating a high reliability by test takes far more trials than intuition suggests.',
        'Suppose the true reliability is $R$. The chance of $n$ successes in a row is $R^n$. If you observe $n$ straight successes, you can claim with confidence $C$ that reliability is at least $R$ when',
        { eq: 'R^n = 1 − C   ⇒   n = ln(1 − C)/ln R', where: 'the zero-failure success-run formula' },
        'For 90% reliability at 90% confidence that is 22 consecutive successes; for 99%, about 230. Each observed failure pushes the number higher.',
        'This is why reliability of expensive systems is rarely proven by system-level test alone. Programs build the case from component data, analysis, accelerated life testing and design margin, and use the few full-scale tests to confirm the models.',
        'Two more facts. In a **series** system every part must work, so reliabilities multiply: a hundred parts at 99.9% give 90.5%. **Redundancy** inverts that: two independent 90% units in parallel give 99%.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'n', label: 'Tests run', min: 1, max: 300, step: 1, v: 10 },
          { k: 'f', label: 'Failures observed', min: 0, max: 5, step: 1, v: 0 },
        ],
        draw(g, s, p) {
          g.view(0, 300, 0.5, 1).axes({ xl: 'number of tests', yl: 'reliability demonstrated at 90% confidence' });
          [0, 1, 2].forEach(f => g.fn(n => (n < f + 1 ? NaN : rlow(round(n), f)), f === p.f ? g.c.a : g.c.dim, { w: f === p.f ? 2.5 : 1.2, n: 150, from: 1 }));
          if (p.f > 2) g.fn(n => (n < p.f + 1 ? NaN : rlow(round(n), p.f)), g.c.a, { w: 2.5, n: 150, from: 1 });
          g.line(0, 0.95, 300, 0.95, g.c.good, { w: 1.5, dash: [5, 4] }).text('0.95 goal', 296, 0.965, g.c.good, { a: 'right', s: 10.5 });
          g.dot(p.n, clamp(rlow(p.n, p.f), 0.5, 1), g.c.ink, 6);
          g.note('curves: 0, 1, 2 failures', 'br', g.c.dim);
        },
        read: (s, p) => [['observed success rate', num((p.n - min(p.f, p.n)) / p.n * 100, 4) + ' %'], ['demonstrated reliability (90% confidence)', num(rlow(p.n, p.f), 4)]],
        mission: 'With zero failures, find the smallest number of tests that demonstrates 0.95 reliability at 90% confidence.',
        goal: (s, p) => p.f === 0 && rlow(p.n, 0) >= 0.95 && rlow(p.n - 1, 0) < 0.95,
        win: { n: 45, f: 0 },
      },
      cards: [
        { q: 'Give the zero-failure formula for the number of tests needed to demonstrate reliability $R$ with confidence $C$.', a: '$n = ln(1 − C)/ln R$, from $R^n = 1 − C$.' },
        { q: 'How do reliabilities combine in series and in parallel?', a: 'Series (all must work): multiply the reliabilities. Parallel redundancy (any one suffices): multiply the failure probabilities, $R = 1 − Π(1 − R_i)$.' },
      ],
      quiz: [
        { q: 'How many consecutive successes demonstrate 90% reliability with 90% confidence?', num: 22, tol: 0.5, why: '$ln(0.1)/ln(0.9) = 21.9$, so 22.' },
        { q: 'A system has 50 parts in series, each 99.8% reliable. What is the system reliability, as a percentage?', num: 90.5, unit: '%', tol: 0.3, why: '$0.998^{50} ≈ 0.905$.' },
      ],
    },
    {
      id: 'cost-exchange', skill: 'cost', title: 'Cost-exchange analysis', pre: ['prob-bayes', 'detect-threshold', 'syseng-trades'],
      hook: 'Stopping a twenty-thousand-dollar threat with a two-million-dollar interceptor works every time, until the magazine or the budget runs out.',
      body: [
        'A defense is judged by whether it works and by what it costs to work, compared with what the attack costs. The **cost-exchange ratio** is',
        { eq: 'defender’s cost per threat defeated ÷ attacker’s cost per threat' },
        'A ratio well above 1 means the attacker can win by spending: saturate the defense, exhaust its magazine, and let the remainder through.',
        'The defender’s cost depends on **single-shot kill probability** $P_k$ and on doctrine. Firing $n$ interceptors at one threat gives a kill probability of $1 − (1 − P_k)^n$, so the fraction leaking through is $(1 − P_k)^n$. A salvo spends $n$ shots every time. **Shoot-look-shoot** fires again only after a miss, spending on average far fewer, but needs time and range for the second look.',
        'The levers follow: cheaper effectors (guns, directed energy, electronic attack, low-cost interceptors) for cheap threats; better $P_k$ to cut shots per kill; a layered defense matching each threat to the cheapest thing that can stop it; and counting what is defended, since the value protected, not just the price of the threat, sets what is worth spending.',
        'Magazine depth is the other constraint: a defense that runs out is beaten regardless of price.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'pk', label: 'Single-shot kill probability', min: 0.3, max: 0.95, step: 0.05, v: 0.7 },
          { k: 'n', label: 'Shots allowed per threat', min: 1, max: 4, step: 1, v: 2 },
          { k: 'sls', type: 'toggle', label: 'Shoot-look-shoot (fire again only after a miss)', v: false },
          { k: 'li', label: 'Interceptor unit cost', min: 4, max: 7, step: 0.05, v: 6.3, fmt: v => money(10 ** v) },
          { k: 'lt', label: 'Threat unit cost', min: 4, max: 7, step: 0.05, v: 5, fmt: v => money(10 ** v) },
        ],
        draw(g, s, p) {
          const e = exchange(p), a = 10 ** p.lt, d = e.shots * 10 ** p.li, mx = max(a, d) * 1.15;
          g.view(0, mx, 0, 2.6, { pad: [150, 12, 16, 34] }).axes({ xl: 'cost per threat engaged', yt: false, grid: false, xf: v => money(v), xs: mx / 4 });
          g.rect(0, 1.5, a, 0.7, g.c.a, { fa: 0.85 }).text('attacker spends', 0, 1.85, g.c.ink, { a: 'right', dx: -8, s: 12, mono: false });
          g.rect(0, 0.4, d, 0.7, e.ratio <= 1 ? g.c.good : g.c.b, { fa: 0.85 }).text('defender spends', 0, 0.75, g.c.ink, { a: 'right', dx: -8, s: 12, mono: false });
          g.note(`of 100 threats, ${num(e.leak, 2)} leak through`, 'tr', e.leak <= 2 ? g.c.good : g.c.bad);
        },
        read: (s, p) => { const e = exchange(p); return [['leakage', num(e.leak, 3) + ' %'], ['average shots per threat', num(e.shots, 3)], ['cost-exchange ratio', num(e.ratio, 3) + ' : 1']]; },
        mission: 'Against a threat costing $500k or less, hold leakage to 2% or below with a cost-exchange ratio no worse than 1 : 1.',
        goal: (s, p) => { const e = exchange(p); return 10 ** p.lt <= 501000 && e.leak <= 2 && e.ratio <= 1; },
        win: { pk: 0.9, n: 2, sls: true, li: 5.6, lt: 5.65 },
      },
      cards: [
        { q: 'Define the cost-exchange ratio.', a: 'The defender’s cost to defeat one threat divided by the attacker’s cost to field it. Above 1, the attacker gains by adding more threats.' },
        { q: 'If $n$ shots with single-shot kill probability $P_k$ are fired at a threat, what fraction leaks through?', a: '$(1 − P_k)^n$.' },
        { q: 'How does shoot-look-shoot differ from a salvo in cost and constraints?', a: 'It fires a second shot only after assessing a miss, so the average number of shots is much lower for the same kill probability; it needs enough time and battlespace for the assessment and second engagement.' },
      ],
      quiz: [
        { q: 'Interceptors have $P_k$ = 0.8. Two are fired at each threat. What percentage of threats leak through?', num: 4, unit: '%', tol: 0.1, why: '$(1 − 0.8)^2 = 0.04$.' },
        { q: 'With $P_k$ = 0.8 and shoot-look-shoot limited to two shots, the average number of interceptors used per threat is:', num: 1.2, tol: 0.02, why: 'One shot always, plus a second 20% of the time: $1 + 0.2 = 1.2$.' },
      ],
    },
    {
      id: 'cost-learning-curve', skill: 'cost', title: 'Learning curves and the price of quantity', pre: ['cost-exchange', 'dfm-tolerances', 'calc-integral'],
      hook: 'The hundredth unit off a production line costs a fraction of the first. Whether a system is affordable is often a question of how many get built.',
      body: [
        'In 1936 T. P. Wright observed that each time cumulative aircraft production doubled, the labor per aircraft fell by a constant percentage. The **learning curve**:',
        { eq: 'cost of unit n = T_1·n^b,   b = log_2(learning rate)' },
        'An "85% curve" means every doubling of quantity brings unit cost to 85% of what it was; $b$ is then −0.234. Hand-built aerospace hardware typically runs 80–90%; highly automated lines sit nearer 95%, because there is less for people to learn.',
        'Then there is everything spent before the first unit: design, tooling, test, software. That **non-recurring** cost is spread over the production run, so',
        { eq: 'average unit cost ≈ T_1·Q^b/(1 + b) + NRE/Q' },
        'Both terms fall with quantity $Q$. Small buys of exquisite systems are expensive for both reasons, and cutting a planned quantity raises the unit cost of what remains, which invites further cuts. The reverse logic drives "affordable mass": designs meant to be built in thousands, with simple manufacturing, commercial parts and stable requirements, so the curve can do its work.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 't1', label: 'First unit cost', min: 0.5, max: 10, step: 0.5, v: 3, unit: '$M' },
          { k: 'lr', label: 'Learning rate', min: 70, max: 100, step: 1, v: 85, unit: '%' },
          { k: 'nre', label: 'Development (non-recurring) cost', min: 0, max: 1000, step: 20, v: 200, unit: '$M' },
          { k: 'lq', label: 'Quantity built', min: 0, max: 4, step: 0.05, v: 1.5, fmt: v => num(round(10 ** v), 5) },
        ],
        draw(g, s, p) {
          g.view(0, 4, -1.5, 2.7).axes({ xl: 'quantity built', yl: 'cost per unit ($M)', xf: v => num(10 ** v, 2), yf: v => num(10 ** v, 2), xs: 1, ys: 1 });
          g.fn(l => log10(wright(p, 10 ** l).unit), g.c.b, { w: 2 }).fn(l => clamp(log10(wright(p, 10 ** l).avg), -1.5, 2.7), g.c.a, { w: 2.5 });
          g.line(0, log10(1.5), 4, log10(1.5), g.c.good, { w: 1.2, dash: [5, 4] }).text('$1.5M goal', 3.95, log10(1.5) + 0.15, g.c.good, { a: 'right', s: 10.5 });
          g.dot(p.lq, clamp(log10(wright(p).avg), -1.5, 2.7), g.c.ink, 6);
          g.note('average cost including development', 'tr', g.c.a).note('cost of the latest unit', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const w = wright(p); return [['latest unit', '$' + num(w.unit, 3) + 'M'], ['average with development', '$' + num(w.avg, 3) + 'M'], ['development share', num(p.nre / 10 ** p.lq / w.avg * 100, 3) + ' %']]; },
        mission: 'With a $3M first unit, an 85% curve and $200M of development (or worse on any of them), find a quantity that brings average unit cost under $1.5M.',
        goal: (s, p) => p.t1 >= 3 && p.lr >= 85 && p.nre >= 200 && wright(p).avg < 1.5,
        win: { t1: 3, lr: 85, nre: 200, lq: 2.8 },
      },
      cards: [
        { q: 'State Wright’s learning curve.', a: 'Cost of unit $n$ = $T_1 n^b$ with $b = log_2$(learning rate). Each doubling of cumulative quantity multiplies unit cost by the learning rate (for example 0.85).' },
        { q: 'Why does cutting a planned production quantity raise unit cost?', a: 'Non-recurring cost is spread over fewer units, and production stops earlier on the learning curve, so the average recurring cost is higher too.' },
      ],
      quiz: [
        { q: 'On an 80% learning curve the first unit costs $10M. What does the fourth unit cost, in $M?', num: 6.4, unit: '$M', tol: 0.05, why: 'Two doublings: $10 × 0.8 × 0.8 = 6.4$.' },
        { q: 'A program spent $400M on development and builds 200 units. Development adds how much to each unit, in $M?', num: 2, unit: '$M', tol: 0.02, why: '$400/200 = 2$.' },
      ],
    },
    {
      id: 'acq-lifecycle', skill: 'acq', title: 'Defense acquisition: from lab to field', pre: ['syseng-margins', 'vv-verification', 'cost-learning-curve'],
      hook: 'Plenty of technologies work in the laboratory and never reach the people who need them. The gap between the two has a name: the valley of death.',
      body: [
        'Acquisition is how a government turns a need into fielded, supported equipment. In the United States the traditional path runs through phases separated by decision points called **milestones**: analysis of alternatives; technology maturation and risk reduction (Milestone A to B); engineering and manufacturing development (B to C); production and deployment; then decades of operations and support, which usually cost more than everything before.',
        'Technology maturity is tracked on the **Technology Readiness Level** scale, from 1 (basic principles observed) through 6 (prototype demonstrated in a relevant environment) to 9 (proven in operations). A consistent finding of program reviews is that committing to full development with immature technology, below about TRL 6–7, leads to large cost growth and delay.',
        'Three pressures pull against each other: **cost, schedule and performance**. Requirements that change mid-program disturb all three. **Concurrency**, starting production before development testing is done, saves calendar time and risks expensive retrofits.',
        'The **valley of death** lies between a successful prototype and a funded program: research money has ended and procurement money, planned years ahead, has not begun. Faster pathways (rapid prototyping authorities, other-transaction agreements, small-business innovation contracts, software-specific pathways) exist to bridge it.',
        'The lab is a stylized model of those pressures, not a forecast.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'trl', label: 'Technology readiness at commitment', min: 3, max: 9, step: 1, v: 4, fmt: v => 'TRL ' + v },
          { k: 'cc', label: 'Concurrency: production overlapping test', min: 0, max: 60, step: 5, v: 40, unit: '%' },
          { k: 'rc', label: 'Major requirement changes', min: 0, max: 5, step: 1, v: 2 },
        ],
        draw(g, s, p) {
          const r = program(p), mat = 0.96 * (p.trl - 3);
          g.view(0, 16, 0, 3, { pad: [14, 26, 14, 34] }).axes({ xl: 'years from start', yt: false, grid: false, xs: 2 });
          g.rect(0, 1.7, mat, 0.7, g.c.c, { fa: 0.8 }).rect(mat, 1.7, max(0, r.years - mat), 0.7, g.c.b, { fa: 0.8 });
          if (mat > 1.2) g.text('mature the technology', mat / 2, 2.05, '#fff', { a: 'center', s: 10 });
          g.text('develop, test, produce', mat + max(0, r.years - mat) / 2, 2.05, '#fff', { a: 'center', s: 10 });
          g.line(9, 0.2, 9, 2.8, g.c.good, { w: 1.5, dash: [5, 4] }).text('needed by year 9', 9.1, 2.75, g.c.good, { s: 10.5 });
          g.rect(0, 0.5, min(16, 16 * r.growth / 100), 0.5, r.growth <= 15 ? g.c.good : g.c.bad, { fa: 0.85 }).text(`predicted cost growth ${num(r.growth, 3)} %`, 0.1, 1.25, g.c.ink, { s: 11 });
        },
        read: (s, p) => { const r = program(p); return [['time to field', num(r.years, 3) + ' years'], ['predicted cost growth', num(r.growth, 3) + ' %']]; },
        mission: 'Field the system within 9 years while holding predicted cost growth to 15% or less.',
        goal: (s, p) => { const r = program(p); return r.years <= 9 && r.growth <= 15; },
        win: { trl: 7, cc: 30, rc: 0 },
      },
      cards: [
        { q: 'What is the Technology Readiness Level scale, and what level is usually wanted before full development begins?', a: 'A 1–9 scale of maturity from basic principles (1) to proven in operations (9). TRL 6–7, a prototype demonstrated in a relevant or operational environment, is the usual threshold for committing to development.' },
        { q: 'What is the "valley of death" in acquisition?', a: 'The funding and ownership gap between a successful technology demonstration and a procurement program, where many prototypes stall.' },
        { q: 'What is concurrency and what is its risk?', a: 'Overlapping production with development testing. It saves schedule, but problems found late must be retrofitted into units already built.' },
      ],
      quiz: [
        { q: 'Over a system’s whole life, which phase usually costs the most?', choices: ['Technology maturation', 'Engineering development', 'Production', 'Operations and support'], answer: 3, why: 'Decades of maintenance, spares, personnel, fuel and upgrades typically exceed the acquisition cost.' },
        { q: 'A technology has been demonstrated as a laboratory breadboard only. It is at about:', choices: ['TRL 1–2', 'TRL 4', 'TRL 7', 'TRL 9'], answer: 1, why: 'Component validation in a laboratory environment is TRL 4. TRL 6–7 requires a prototype in a relevant or operational environment.' },
      ],
    },
    {
      id: 'arms-control', skill: 'arms', title: 'Arms control and strategic stability', pre: ['ode-state-space', 'linalg-eigen', 'cost-exchange', 'sda-tracking'],
      hook: 'Two rivals each build because the other is building. Whether that spiral levels off or runs away is a stability question, the kind you already know how to answer.',
      body: [
        'Arms control is agreement between rivals to limit the numbers, types, testing or deployment of weapons. Its aims are to reduce the risk of war, limit damage if war occurs, and cut the cost of preparing for it. It works only when each side judges it is safer inside the agreement than outside.',
        '**Strategic stability** has two parts. **Crisis stability**: neither side gains by striking first, so neither is tempted to in a crisis. **Arms-race stability**: neither side gains lasting advantage by building more.',
        'In the 1930s the physicist Lewis Fry Richardson wrote arms races as differential equations. Each side builds in response to the other, is restrained by cost, and has a standing grievance:',
        { eq: 'dx/dt = k·y − m·x + g,   dy/dt = k·x − m·y + g' },
        'This is the linear state-space system from the feedback unit. If restraint exceeds reaction ($m > k$), both eigenvalues are negative and the race settles at $x = y = g/(m − k)$. If reaction dominates, one eigenvalue is positive and the race runs away. The model is crude, but it captures why limits and transparency matter: they lower the reaction term.',
        'No agreement survives without **verification**: counting rules, data exchanges, on-site inspection, and "national technical means" such as satellites and other remote sensors. Much of the sensing and space-tracking technology in this course exists partly for that purpose.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'k', label: 'Reaction to the rival k', min: 0, max: 1, step: 0.02, v: 0.6 },
          { k: 'm', label: 'Restraint from cost m', min: 0, max: 1, step: 0.02, v: 0.5 },
          { k: 'g', label: 'Standing grievance g', min: 0, max: 10, step: 0.5, v: 5 },
        ],
        draw(g, s, p) {
          g.view(0, 100, 0, 100, { eq: true }).axes({ xl: 'side X arsenal', yl: 'side Y arsenal' });
          const f = y => [p.k * y[1] - p.m * y[0] + p.g, p.k * y[0] - p.m * y[1] + p.g];
          g.clip(() => {
            for (let x = 8; x < 100; x += 12) for (let y = 8; y < 100; y += 12) { const [u, v] = f([x, y]), n = hypot(u, v) || 1; g.arrow(x - u / n * 3, y - v / n * 3, x + u / n * 3, y + v / n * 3, g.c.dim, { w: 1, head: 5, alpha: 0.55 }); }
            [[5, 5], [90, 10], [10, 90], [60, 95], [95, 60], [30, 2]].forEach((y0, i) => { let y = y0; const pts = [y]; for (let j = 0; j < 400 && max(y[0], y[1]) < 400 && min(y[0], y[1]) > -50; j++) { y = rk4(f, y, 0, 0.1); pts.push(y); } g.path(pts, [g.c.a, g.c.b, g.c.c][i % 3], { w: 1.8 }); g.dot(y0[0], y0[1], g.c.ink, 3); });
            if (p.m > p.k) g.dot(p.g / (p.m - p.k), p.g / (p.m - p.k), g.c.good, 7, { ring: g.c.panel });
          });
          g.note(p.m > p.k ? 'stable: settles at the green point' : 'unstable: runaway race', 'tl', p.m > p.k ? g.c.good : g.c.bad);
        },
        read: (s, p) => [['eigenvalues', `${num(-p.m + p.k, 3)}, ${num(-p.m - p.k, 3)}`], ['equilibrium', p.m > p.k ? num(p.g / (p.m - p.k), 3) + ' each' : 'none (grows without limit)']],
        mission: 'With a grievance of 5 or more, find coefficients for which the race settles below 50 on each side.',
        goal: (s, p) => p.g >= 5 && p.m > p.k && p.g / (p.m - p.k) < 50,
        win: { k: 0.4, m: 0.6, g: 5 },
      },
      cards: [
        { q: 'What are crisis stability and arms-race stability?', a: 'Crisis stability: neither side gains by striking first. Arms-race stability: neither side can gain a lasting advantage by building more, so there is no incentive to race.' },
        { q: 'In Richardson’s arms-race model, what condition gives a stable outcome?', a: 'Restraint must exceed reaction ($m > k$, or $mn > ab$ in general). Then both eigenvalues are negative and arsenals settle at an equilibrium; otherwise they grow without limit.' },
        { q: 'How are arms control agreements verified?', a: 'By agreed counting rules and data exchanges, notifications, on-site inspections, and national technical means: satellites and other remote sensors operated by each party.' },
      ],
      quiz: [
        { q: 'In the symmetric Richardson model with $k$ = 0.3, $m$ = 0.5 and $g$ = 4, at what level does each arsenal settle?', num: 20, tol: 0.2, why: '$g/(m − k) = 4/0.2 = 20$.' },
        { q: 'Why is verification essential to arms control?', choices: ['It makes weapons cheaper', 'Without confidence that the other side is complying, neither can safely restrain itself', 'It is required by physics', 'It replaces the need for agreements'], answer: 1, why: 'An agreement that cannot be checked invites cheating and worst-case assumptions, which restore the reaction term the agreement was meant to reduce.' },
      ],
    },
    {
      id: 'export-controls', skill: 'export', title: 'Export controls: what you can share, and with whom', pre: ['acq-lifecycle', 'arms-control', 'crypto-hashes'],
      hook: 'An engineer can break federal law by sending an email, giving a tour or pushing code to a public repository. Knowing the outline of the rules is part of the job.',
      body: [
        'Export controls restrict the transfer of sensitive items, software and know-how to foreign countries and foreign persons. This lesson outlines the United States system; other countries have their own, many coordinated through multilateral regimes. It is orientation, not legal advice: real decisions go to your organization’s export compliance office.',
        { list: ['**ITAR** (International Traffic in Arms Regulations, State Department) covers defense articles, services and related technical data on the **U.S. Munitions List**: items designed for military use. Almost every export needs authorization.', '**EAR** (Export Administration Regulations, Commerce Department) covers **dual-use** and commercial items. Those on the **Commerce Control List** may need a license depending on the item, destination, end user and end use; most other commercial goods ("EAR99") ship to most places without one.'] },
        'Three ideas surprise newcomers. **Technical data counts**: drawings, test results and source code are controlled as much as hardware. **A deemed export** is releasing controlled technology to a foreign person inside the country, in a lab, a meeting or a shared drive; it is treated as an export to that person’s country. And information already **published**, or arising from **fundamental research** intended for open publication, is generally outside the controls, which is why textbook material like this course can be shared freely.',
        'When unsure: stop, ask, and do not send.',
      ],
      sim: classifier([
        ['Detailed design drawings for a missile guidance section are emailed to a colleague at a company overseas.', 'itar', 'Technical data for a defense article on the Munitions List. Sending it abroad is an export that needs State Department authorization.'],
        ['A published university textbook on orbital mechanics is mailed to a student abroad.', 'public', 'Published, generally available information is not controlled technical data.'],
        ['A company sells a high-performance commercial thermal imaging camera to a foreign customer.', 'ear', 'A dual-use item. It falls under the Commerce regulations and may need a license depending on performance, destination and end user.'],
        ['In a U.S. lab, an engineer walks a visiting foreign-national researcher through controlled design data on a screen.', 'deemed', 'Releasing controlled technology to a foreign person inside the country is a deemed export to that person’s home country.'],
        ['A university group publishes basic research results in an open journal, with no restrictions on publication or participation.', 'public', 'Fundamental research intended for open publication is generally excluded from the controls.'],
        ['A firm ships ordinary laptops with standard commercial encryption to a distributor in an allied country.', 'ear', 'Commercial goods are subject to the Commerce regulations. Mass-market items like this usually ship without a license to most destinations, but the rules still apply.'],
      ], [['itar', 'Defense article or data (ITAR)'], ['ear', 'Dual-use or commercial (EAR)'], ['deemed', 'Deemed export'], ['public', 'Public domain or fundamental research']], 'Classify all six scenarios correctly.'),
      cards: [
        { q: 'What do ITAR and EAR each cover, and who administers them?', a: 'ITAR (State Department): defense articles, services and technical data on the U.S. Munitions List. EAR (Commerce Department): dual-use and commercial items, with licensing depending on item, destination, end user and end use.' },
        { q: 'What is a deemed export?', a: 'Release of controlled technology or technical data to a foreign person inside the country. It is treated as an export to that person’s country.' },
        { q: 'Why is textbook and openly published research generally not export controlled?', a: 'Information that is published and generally available, or that results from fundamental research intended for open publication, falls outside the definition of controlled technical data.' },
      ],
      quiz: [
        { q: 'Which of these can be an export requiring authorization?', choices: ['Only shipping hardware overseas', 'Shipping hardware, emailing controlled technical data, or showing it to a foreign person', 'Only selling weapons', 'Only transfers to embargoed countries'], answer: 1, why: 'Controls apply to items, software and technical data, and to transfers by any means, including visual disclosure.' },
        { q: 'You are unsure whether a test report can be sent to a foreign partner. The right first step is:', choices: ['Send it and report afterward', 'Remove the company logo and send it', 'Ask your export compliance office before sending anything', 'Post it publicly so it becomes public domain'], answer: 2, why: 'Classification and licensing are determinations for trained compliance staff. Publishing controlled data to "make it public" is itself a violation.' },
      ],
    },
  ],
};
