import { num, clamp } from '../sim.js';
const { sin, cos, tan, asin, acos, atan2, PI, sqrt, exp, log, abs, max, min, log10, ceil, floor } = Math;
const rad = d => d * PI / 180, deg = r => r * 180 / PI, TAU = 2 * PI;
const MU = 398600, RE = 6378;
const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');

// --- orbit from a tangential speed at radius r0 ---
export function orbit(v, r0 = RE + 400) {
  const en = v * v / 2 - MU / r0, h = r0 * v, e = sqrt(max(0, 1 + 2 * en * h * h / (MU * MU))), p = h * h / MU, vc = sqrt(MU / r0);
  const a = en < 0 ? -MU / (2 * en) : Infinity, peri0 = v >= vc;
  return { e, p, a, peri0, rp: p / (1 + e), ra: e < 1 ? p / (1 - e) : Infinity, T: en < 0 ? TAU * sqrt(a ** 3 / MU) : Infinity, en, r: th => p / (1 + e * cos(th - (peri0 ? 0 : PI))) };
}
const kepler = (M, e) => { let E = M; for (let i = 0; i < 12; i++) E -= (E - e * sin(E) - M) / (1 - e * cos(E)); return E; };
const earth = g => { g.circle(0, 0, RE, g.c.b, { w: 2, fill: true, fa: 0.25 }); };

// --- Hohmann transfer from 400 km to 20,200 km ---
const R1 = RE + 400, R2 = RE + 20200;
export function hoh(p) {
  const t = orbit(sqrt(MU / R1) + p.dv1, R1);
  if (!(t.e < 1)) return { t, escaped: true };
  const va = sqrt(MU * (2 / t.ra - 1 / t.a)), f = orbit(va + p.dv2, t.ra);
  return { t, f, rp: min(f.rp, f.ra), ra: max(f.rp, f.ra), ok: f.e < 1 };
}

// --- J2 nodal precession, degrees per day ---
export const nodal = (alt, inc) => { const a = RE + alt, n = sqrt(MU / a ** 3); return deg(-1.5 * n * 1.08263e-3 * (RE / a) ** 2 * cos(rad(inc))) * 86400; };

// --- downlink budget at 8 GHz, 1,500 km slant range ---
export function link(p) {
  const lam = 0.0375, fspl = 20 * log10(4 * PI * 1.5e6 / lam), gr = 10 * log10(0.6 * (PI * p.D / lam) ** 2), eirp = 10 * log10(p.P) + p.Gt;
  const cn0 = eirp - fspl + gr - 10 * log10(150) + 228.6 - 3, ebn0 = cn0 - 10 * log10(10 ** p.lr * 1e6);
  return { fspl, gr, eirp, cn0, ebn0, margin: ebn0 - 7 };
}

// --- coverage geometry ---
export const lam0 = (alt, el) => deg(acos(RE * cos(rad(el)) / (RE + alt))) - el;

// --- catalog uncertainty between observations (1-sigma along-track, meters) ---
export function sawtooth(p, hours = 48) {
  const sv = p.acc / 600, k = 0.5 * 1e-7 * exp(-(p.alt - 400) / 60), pts = []; let prior = 2000, mx = 0;
  const grow = (s0, t) => sqrt(s0 * s0 + (sv * t) ** 2 + (k * t * t) ** 2);
  let s0 = 1 / sqrt(1 / prior ** 2 + 1 / p.acc ** 2);
  for (let t0 = 0; t0 < hours; t0 += p.rev) {
    for (let i = 0; i <= 20; i++) { const dt = p.rev * i / 20; if (t0 + dt > hours) break; const s = grow(s0, dt * 3600); pts.push([t0 + dt, s]); if (t0 >= p.rev) mx = max(mx, s); }
    prior = grow(s0, p.rev * 3600); s0 = 1 / sqrt(1 / prior ** 2 + 1 / p.acc ** 2);
  }
  return { pts, max: mx || grow(s0, p.rev * 3600) };
}

// --- collision probability: isotropic Gaussian integrated over a disc ---
export function pc(d, sg, R) {
  let s = 0; const n = 24;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const r = R * sqrt((i + 0.5) / n), a = TAU * (j + 0.5) / n, x = d + r * cos(a), y = r * sin(a); s += exp(-(x * x + y * y) / (2 * sg * sg)); }
  return s / (n * n) * R * R / (2 * sg * sg);
}

export default {
  id: 'u11', title: 'Space', blurb: 'Orbits, satellites and tracking what is up there.',
  lessons: [
    {
      id: 'orbit-kepler', skill: 'orbit', title: 'Orbits: falling around the Earth', pre: ['mech-energy', 'mech-rotation', 'num-root-finding'],
      hook: 'An orbit is a fall that keeps missing the ground. One equation ties speed to position anywhere along it.',
      body: [
        'Under gravity alone, a body follows a **conic section** with Earth’s center at one focus: a circle, ellipse, parabola or hyperbola, depending on its energy. Energy and angular momentum are both conserved, and together they give the **vis-viva equation**:',
        { eq: 'v^2 = μ·(2/r − 1/a)', where: '$μ$ = 398,600 km³/s² for Earth, $r$ = distance from Earth’s center, $a$ = semi-major axis' },
        'For a circle $a = r$, so $v_c = √(μ/r)$: about 7.7 km/s at 400 km. Go faster at the same point and the far side of the orbit rises; you are now at **perigee** of an ellipse. Go slower and you are at **apogee**, with a perigee that may dip into the atmosphere. At $√2·v_c$ the orbit opens into a parabola: **escape**.',
        'The period depends only on $a$: $T = 2π√(a^3/μ)$, Kepler’s third law. Where the satellite is at a given time requires solving **Kepler’s equation**, $M = E − e·sin E$, which has no closed form. It is solved by Newton’s method, as in the code exercise below.',
      ],
      sim: {
        h: 340,
        controls: [{ k: 'v', label: 'Speed at 400 km altitude', min: 7, max: 11.2, step: 0.005, v: 7.67, unit: 'km/s' }],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt; },
        draw(g, s, p) {
          const o = orbit(p.v), R = clamp((isFinite(o.ra) ? o.ra : 50000) * 1.15, 12000, 60000);
          g.view(-R, R * 0.45, -R * 0.55, R * 0.55, { eq: true, pad: [8, 8, 8, 8] });
          g.circle(0, 0, 42164, g.c.grid, { w: 1, dash: [4, 4] });
          earth(g);
          const pts = [], lim = o.e >= 1 ? acos(-1 / o.e) - 0.05 : PI;
          for (let i = 0; i <= 240; i++) { const th = -lim + 2 * lim * i / 240 + (o.peri0 ? 0 : PI), r = o.r(th); if (r > 0 && r < 2e5) pts.push([r * cos(th), r * sin(th)]); }
          g.clip(() => g.path(pts, o.rp < RE + 100 ? g.c.bad : g.c.a, { w: 2.2 }));
          if (o.e < 1) { const E = kepler(TAU * ((s.t / 7) % 1), o.e), nu = 2 * atan2(sqrt(1 + o.e) * sin(E / 2), sqrt(1 - o.e) * cos(E / 2)) + (o.peri0 ? 0 : PI), r = o.r(nu); g.dot(r * cos(nu), r * sin(nu), g.c.ink, 5); }
          g.dot(RE + 400, 0, g.c.a, 4);
          g.note('dashed ring: geostationary altitude', 'bl', g.c.dim).note(o.e >= 1 ? 'escape trajectory' : o.rp < RE + 100 ? 're-enters' : abs(o.e) < 0.005 ? 'circular' : 'ellipse', 'tl', g.c.ink);
        },
        read: (s, p) => { const o = orbit(p.v); return [['eccentricity', num(o.e, 3)], ['perigee altitude', num(o.rp - RE, 4) + ' km'], ['apogee altitude', isFinite(o.ra) ? num(o.ra - RE, 5) + ' km' : 'none (escape)'], ['period', isFinite(o.T) ? num(o.T / 3600, 3) + ' h' : '–']]; },
        mission: 'Choose the speed that raises apogee to geostationary altitude: 35,786 km (±500 km).',
        goal: (s, p) => abs(orbit(p.v).ra - RE - 35786) < 500,
        win: { v: 10.065 },
      },
      cards: [
        { q: 'Write the vis-viva equation and the circular orbit speed.', a: '$v^2 = μ(2/r − 1/a)$. For a circle $a = r$, so $v_c = √(μ/r)$.' },
        { q: 'State Kepler’s third law as a formula for orbital period.', a: '$T = 2π√(a^3/μ)$: period depends only on the semi-major axis.' },
        { q: 'At a given point, what happens to the orbit if speed is above circular speed? Below? At $√2$ times it?', a: 'Above: the point becomes perigee of an ellipse with a higher apogee. Below: it becomes apogee, with a lower perigee. At $√2v_c$: escape (parabola).' },
      ],
      quiz: [
        { q: 'What is circular orbital speed at 400 km altitude ($r$ = 6,778 km)? Give km/s.', num: 7.67, unit: 'km/s', tol: 0.03, why: '$√(398{,}600/6778) = √58.81 ≈ 7.67$ km/s.' },
        { q: 'A satellite’s semi-major axis is quadrupled. Its period becomes:', choices: ['2 times longer', '4 times longer', '8 times longer', '16 times longer'], answer: 2, why: '$T ∝ a^{3/2}$ and $4^{1.5} = 8$.' },
      ],
      code: {
        prompt: 'Complete `ecc_anomaly(M, e)`: solve Kepler’s equation $E − e·sin E = M$ for $E$ using Newton’s method. Start from $E = M$ and iterate until the change is below $10^{−12}$.',
        starter: 'import math\n\ndef ecc_anomaly(M, e):\n    E = M\n    # Newton: E -= f(E) / f\'(E), with f(E) = E - e*sin(E) - M\n    return E\n\nprint(ecc_anomaly(1.0, 0.5))',
        solution: 'import math\n\ndef ecc_anomaly(M, e):\n    E = M\n    for _ in range(50):\n        dE = (E - e * math.sin(E) - M) / (1 - e * math.cos(E))\n        E -= dE\n        if abs(dE) < 1e-12:\n            break\n    return E\n\nprint(ecc_anomaly(1.0, 0.5))',
        tests: 'import math\nfor _M, _e in [(1.0, 0.5), (0.3, 0.1), (2.5, 0.8), (1.0, 0.0)]:\n    _E = ecc_anomaly(_M, _e)\n    assert abs(_E - _e * math.sin(_E) - _M) < 1e-9, f"E={_E} does not satisfy Kepler\'s equation for M={_M}, e={_e}"\nassert abs(ecc_anomaly(1.0, 0.5) - 1.4987011335) < 1e-8',
        hint: 'Inside a loop: `dE = (E - e*math.sin(E) - M) / (1 - e*math.cos(E))`, then `E -= dE`; stop when `abs(dE)` is tiny.',
      },
    },
    {
      id: 'orbit-hohmann', skill: 'orbit', title: 'Changing orbits: the Hohmann transfer', pre: ['orbit-kepler', 'prop-rocket-eq', 'trajopt-bang-bang'],
      hook: 'In orbit you do not steer toward where you want to go. You change your speed, and the orbit carries you there half a revolution later.',
      body: [
        'Satellites change orbit with short engine burns, each a near-instant change in velocity, $Δv$. Total $Δv$ is the currency of spaceflight: the rocket equation converts it directly into propellant.',
        'The most efficient two-burn move between circular orbits is the **Hohmann transfer**:',
        { list: ['**Burn 1**, along the direction of travel, raises apogee to the target radius. The satellite coasts up half an ellipse.', '**Burn 2**, at apogee, again along the direction of travel, raises perigee to match. The orbit is now circular at the new altitude.'] },
        { eq: 'Δv_1 = v_{p,transfer} − v_{c1},   Δv_2 = v_{c2} − v_{a,transfer}', where: 'each speed from the vis-viva equation' },
        'It feels backward: you speed up twice and end up moving slower, because higher orbits are slower. Burns are made along the velocity vector because that is where a given $Δv$ changes orbital energy the most. Changing the orbit’s **plane** is far more expensive, which is why launch sites and launch azimuths are chosen to match the target inclination.',
      ],
      sim: {
        h: 340,
        controls: [
          { k: 'dv1', label: 'Burn 1 at 400 km', min: 0, max: 3, step: 0.005, v: 1, unit: 'km/s' },
          { k: 'dv2', label: 'Burn 2 at transfer apogee', min: 0, max: 3, step: 0.005, v: 0, unit: 'km/s' },
        ],
        draw(g, s, p) {
          const k = hoh(p), R = 34000;
          g.view(-R, R, -R * 0.62, R * 0.62, { eq: true, pad: [8, 8, 8, 8] });
          g.circle(0, 0, R2, g.c.good, { w: 1.5, dash: [5, 4] }).circle(0, 0, R1, g.c.dim, { w: 1.5 });
          earth(g);
          const path = (o, from, to, flip) => { const pts = []; for (let i = 0; i <= 160; i++) { const th = from + (to - from) * i / 160, r = o.r(th); if (r > 0 && r < 3e5) pts.push([(flip ? -1 : 1) * r * cos(th), (flip ? -1 : 1) * r * sin(th)]); } return pts; };
          g.clip(() => {
            if (!k.escaped) { g.path(path(k.t, 0, PI), g.c.a, { w: 2.5 }); if (k.ok) g.path(path(k.f, 0, TAU, true), g.c.b, { w: 2 }); g.dot(-k.t.ra, 0, g.c.b, 5); }
            else g.path(path(k.t, -1.5, 1.5), g.c.bad, { w: 2 });
          });
          g.dot(R1, 0, g.c.a, 5);
          g.note('target: 20,200 km circular', 'tl', g.c.good).note('transfer', 'tl', g.c.a, 1).note('final orbit', 'tl', g.c.b, 2);
        },
        read: (s, p) => { const k = hoh(p); return k.escaped ? [['result', 'escaped Earth']] : [['transfer apogee altitude', num(k.t.ra - RE, 5) + ' km'], ['final orbit', k.ok ? `${num(k.rp - RE, 5)} × ${num(k.ra - RE, 5)} km` : 'escape'], ['total Δv', num(p.dv1 + p.dv2, 4) + ' km/s']]; },
        mission: 'Reach a 20,200 km circular orbit: perigee and apogee both within 400 km of the target.',
        goal: (s, p) => { const k = hoh(p); return !k.escaped && k.ok && abs(k.rp - R2) < 400 && abs(k.ra - R2) < 400; },
        win: { dv1: 2.01, dv2: 1.405 },
      },
      cards: [
        { q: 'Describe the two burns of a Hohmann transfer to a higher circular orbit.', a: 'Burn 1 (prograde, in the low orbit) raises apogee to the target radius. After coasting half an ellipse, burn 2 (prograde, at apogee) raises perigee to circularize.' },
        { q: 'Why are orbit-raising burns made along the velocity vector?', a: 'Energy change per unit Δv is $v·Δv$, largest when the burn is aligned with velocity. Burns in other directions mostly rotate the orbit instead of changing its size.' },
      ],
      quiz: [
        { q: 'A satellite in a 7.67 km/s circular orbit needs 9.68 km/s at perigee to reach its transfer ellipse. What is burn 1, in km/s?', num: 2.01, unit: 'km/s', tol: 0.02, why: '$9.68 − 7.67 = 2.01$ km/s.' },
        { q: 'After a Hohmann transfer to a higher circular orbit, the satellite’s speed is:', choices: ['Higher than before', 'Lower than before', 'The same', 'Zero'], answer: 1, why: 'Circular speed is $√(μ/r)$, lower at larger radius, even though both burns added speed.' },
      ],
    },
    {
      id: 'orbit-ground-track', skill: 'orbit', title: 'Ground tracks, inclination and sun-synchronous orbits', pre: ['orbit-hohmann', 'linalg-matrices'],
      hook: 'An imaging satellite that passes overhead at 10:30 local time every day is using the Earth’s bulge as a free engine.',
      body: [
        'A satellite’s **ground track** is the path of the point beneath it. The orbit plane stays roughly fixed in space while Earth turns under it, so each pass crosses the equator farther west than the last, by 360° × (orbital period ÷ one day).',
        '**Inclination** $i$ is the tilt of the orbit plane from the equator. The track reaches latitudes up to ±$i$ (or 180° − $i$ for retrograde orbits), so inclination decides what the satellite can ever see. A launch site at latitude $φ$ can reach inclinations of $φ$ or more without a costly plane change.',
        'Earth is not a sphere. Its equatorial bulge, described by the coefficient **$J_2$**, torques the orbit plane and makes it precess slowly:',
        { eq: 'Ω̇ = −(3/2)·n·J_2·(R_E/a)^2·cos i' },
        'For a slightly retrograde orbit (about 98° at 700 km) the precession is +0.9856° per day, exactly matching Earth’s motion around the Sun. The orbit plane then keeps a fixed angle to the Sun: a **sun-synchronous orbit**, with the same lighting on every pass. Most Earth-imaging satellites use one.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'alt', label: 'Altitude', min: 300, max: 1500, step: 10, v: 500, unit: 'km' },
          { k: 'inc', label: 'Inclination', min: 0, max: 110, step: 0.1, v: 51.6, unit: '°' },
        ],
        draw(g, s, p) {
          g.view(-180, 180, -90, 90).axes({ xl: 'longitude (°)', yl: 'latitude (°)', xs: 60, ys: 30 });
          g.rect(-180, -p.inc > -90 ? -min(p.inc, 180 - p.inc) : -90, 360, 2 * min(p.inc, 180 - p.inc), g.c.c, { fa: 0.08 });
          const T = TAU * sqrt((RE + p.alt) ** 3 / MU), we = 360 / 86164;
          for (let k = 0; k < 3; k++) { let seg = [], last = 0; for (let j = 0; j <= 180; j++) { const u = TAU * j / 180, t = (k + j / 180) * T, lat = deg(asin(sin(rad(p.inc)) * sin(u))); let lon = deg(atan2(cos(rad(p.inc)) * sin(u), cos(u))) - we * t - 60; lon = ((lon + 180) % 360 + 360) % 360 - 180; if (seg.length && abs(lon - last) > 180) { g.path(seg, [g.c.a, g.c.b, g.c.d][k], { w: 2 }); seg = []; } seg.push([lon, lat]); last = lon; } g.path(seg, [g.c.a, g.c.b, g.c.d][k], { w: 2 }); }
          g.note('three consecutive orbits', 'tr', g.c.dim);
        },
        read: (s, p) => { const T = TAU * sqrt((RE + p.alt) ** 3 / MU); return [['period', num(T / 60, 4) + ' min'], ['westward shift per orbit', num(360 * T / 86164, 3) + '°'], ['highest latitude reached', num(min(p.inc, 180 - p.inc), 3) + '°'], ['plane precession', num(nodal(p.alt, p.inc), 3) + '°/day']]; },
        mission: 'Design a sun-synchronous orbit between 600 and 800 km: plane precession of +0.9856°/day (±0.02).',
        goal: (s, p) => p.alt >= 600 && p.alt <= 800 && abs(nodal(p.alt, p.inc) - 0.9856) < 0.02,
        win: { alt: 700, inc: 98.2 },
      },
      cards: [
        { q: 'What does orbital inclination determine about coverage?', a: 'The ground track reaches latitudes up to ±$i$ (or 180° − $i$ if retrograde). Regions at higher latitude are never overflown.' },
        { q: 'What causes an orbit plane to precess, and how does the rate depend on inclination?', a: 'Earth’s equatorial bulge ($J_2$). The rate is proportional to $−cos i$: westward for prograde orbits, eastward for retrograde, zero for polar.' },
        { q: 'What is a sun-synchronous orbit and why is it useful?', a: 'A slightly retrograde orbit (about 98° in low Earth orbit) whose $J_2$ precession of +0.9856°/day matches the Sun’s apparent motion, giving every pass the same local solar time and lighting.' },
      ],
      quiz: [
        { q: 'A satellite has a 96-minute period. How far west does each successive equator crossing move, in degrees?', num: 24, unit: '°', tol: 0.3, why: '$360° × 96/1440 = 24°$ (using a 24-hour day).' },
        { q: 'A satellite is in a 28.5° inclination orbit. Can it ever pass over a city at 45° latitude?', choices: ['Yes, once a day', 'No: its track never exceeds 28.5° latitude', 'Only in summer', 'Only at night'], answer: 1, why: 'Maximum latitude equals inclination for a prograde orbit.' },
      ],
    },
    {
      id: 'sat-link-budget', skill: 'sat', title: 'Satellite systems and the link budget', pre: ['comms-modulation', 'rf-antennas', 'orbit-ground-track'],
      hook: 'A satellite is a set of budgets that must all close at once: power, mass, heat, pointing and data. The link budget decides how much of what it collects ever reaches the ground.',
      body: [
        'Every satellite has the same subsystems supporting its payload: **power** (solar arrays, batteries), **thermal control**, **attitude determination and control**, **propulsion**, **command and data handling**, and **communications**. Each has a budget with margin, and they trade against one another.',
        'The communications budget is a sum in decibels. Start with what is radiated, subtract what spreading takes away, add what the receiver collects:',
        { eq: 'C/N_0 = EIRP − L_{path} + G/T + 228.6 − L_{other}   (dB-Hz)', where: 'EIRP = transmit power × antenna gain; $L_{path} = 20·log_{10}(4πR/λ)$; $G/T$ = receive gain over system noise temperature; 228.6 = −10·log₁₀ of Boltzmann’s constant' },
        'Divide by the bit rate to get energy per bit: $E_b/N_0 = C/N_0 − 10·log_{10}(R_b)$. The modulation and coding lesson told you how much $E_b/N_0$ a given scheme needs. The surplus is the **link margin**; 3 dB is a common minimum.',
        'Every doubling of data rate costs 3 dB. You buy it back with transmitter power (which costs solar array and heat), antenna gain (which costs size and pointing accuracy), or a larger ground dish.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'P', label: 'Transmit power', min: 1, max: 50, step: 1, v: 5, unit: 'W' },
          { k: 'Gt', label: 'Satellite antenna gain', min: 0, max: 30, step: 1, v: 6, unit: 'dBi' },
          { k: 'D', label: 'Ground dish diameter', min: 1, max: 13, step: 0.5, v: 2, unit: 'm' },
          { k: 'lr', label: 'Data rate', min: 0, max: 3, step: 0.02, v: 2.48, fmt: v => num(10 ** v, 3) + ' Mbit/s' },
        ],
        draw(g, s, p) {
          const k = link(p), steps = [['EIRP', k.eirp], ['path loss', -k.fspl], ['dish gain', k.gr], ['noise temp', -10 * log10(150)], ['1/k', 228.6], ['losses', -3], ['bit rate', -10 * log10(10 ** p.lr * 1e6)], ['required', -7]];
          g.view(0, steps.length + 1, -180, 120).axes({ yl: 'running total (dB)', xt: false, ys: 50 });
          let acc = 0;
          steps.forEach(([n, v], i) => { g.rect(i + 0.2, min(acc, acc + v), 0.6, abs(v), v >= 0 ? g.c.c : g.c.a, { fa: 0.8 }); g.line(i + 0.8, acc + v, i + 1.2, acc + v, g.c.dim, { w: 1 }); acc += v; g.text(n, i + 0.5, -180, g.c.ink, { a: 'center', dy: -8, s: 10 }); });
          g.rect(steps.length + 0.2, min(0, acc), 0.6, abs(acc), acc >= 3 ? g.c.good : g.c.bad, { fa: 0.9 }).text('margin', steps.length + 0.5, -180, g.c.ink, { a: 'center', dy: -8, s: 10, bold: true });
        },
        read: (s, p) => { const k = link(p); return [['path loss', num(k.fspl, 4) + ' dB'], ['C/N₀', num(k.cn0, 4) + ' dB-Hz'], ['E_b/N₀', num(k.ebn0, 3) + ' dB'], ['margin', num(k.margin, 3) + ' dB']]; },
        mission: 'Close the link at 300 Mbit/s or more with at least 3 dB of margin, using no more than 20 W.',
        goal: (s, p) => 10 ** p.lr >= 299.9 && p.P <= 20 && link(p).margin >= 3,
        win: { P: 20, Gt: 12, D: 3, lr: 2.48 },
      },
      cards: [
        { q: 'Write the link budget equation for $C/N_0$ in decibels.', a: '$C/N_0 = EIRP − L_{path} + G/T + 228.6 − L_{other}$. Then $E_b/N_0 = C/N_0 − 10 log_{10}(R_b)$.' },
        { q: 'What is free-space path loss?', a: '$L = 20 log_{10}(4πR/λ)$ dB: the spreading loss between isotropic antennas. It rises 6 dB for each doubling of range or frequency.' },
        { q: 'Name the main satellite bus subsystems.', a: 'Power, thermal control, attitude determination and control, propulsion, command and data handling, communications, and structure.' },
      ],
      quiz: [
        { q: 'A link has 2 dB of margin at 50 Mbit/s. At 200 Mbit/s, with nothing else changed, the margin is:', num: -4, unit: 'dB', tol: 0.1, why: 'Four times the rate costs $10 log_{10}4 = 6$ dB: $2 − 6 = −4$ dB.' },
        { q: 'A transmitter radiates 10 W through a 20 dBi antenna. What is its EIRP in dBW?', num: 30, unit: 'dBW', tol: 0.1, why: '$10 log_{10}(10) + 20 = 10 + 20 = 30$ dBW.' },
      ],
    },
    {
      id: 'sat-constellation', skill: 'sat', title: 'Coverage and constellations', pre: ['sat-link-budget', 'orbit-ground-track'],
      hook: 'Three satellites can see most of the Earth from geostationary orbit. From low orbit it takes hundreds, and there are good reasons to choose hundreds.',
      body: [
        'From altitude $h$, a satellite sees a cap of the Earth. A user needs it at least some **minimum elevation** $ε$ above the horizon, which shrinks the usable cap to a half-angle (measured at Earth’s center) of',
        { eq: 'λ = arccos[R_E·cos ε / (R_E + h)] − ε' },
        'Low orbits see little: at 550 km with 25° elevation, $λ$ is under 9°, a footprint about 1,900 km across. A satellite also crosses the sky in minutes. Continuous coverage needs a chain of satellites in each plane, spaced no more than $2λ$ apart, and several planes.',
        'The trade against altitude:',
        { list: ['**Higher**: bigger footprint, fewer satellites, but longer path (more loss, more delay) and coarser imaging resolution.', '**Lower**: short path, low latency, sharp images, cheaper launch per satellite, natural debris clean-up by drag; but many satellites and frequent handovers.'] },
        'Large low-orbit constellations add **resilience**: losing a few satellites out of hundreds degrades service only slightly. That shift, from a few exquisite satellites to many replaceable ones, is the main architectural change in space systems this decade.',
      ],
      sim: {
        h: 380,
        controls: [
          { k: 'alt', label: 'Altitude', min: 300, max: 2000, step: 10, v: 550, unit: 'km' },
          { k: 'n', label: 'Satellites in the plane', min: 4, max: 40, step: 1, v: 12 },
          { k: 'el', label: 'Minimum elevation angle', min: 5, max: 40, step: 1, v: 25, unit: '°' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 0.08; },
        draw(g, s, p) {
          const L = rad(lam0(p.alt, p.el)), R = RE + 2400, r = RE + p.alt;
          g.view(-R, R, -R, R, { eq: true, pad: [8, 8, 8, 8] });
          g.circle(0, 0, RE, g.c.bad, { w: 5 });
          earth(g);
          for (let k = 0; k < p.n; k++) {
            const a = s.t + TAU * k / p.n, arc = []; for (let i = -10; i <= 10; i++) arc.push([RE * cos(a + L * i / 10), RE * sin(a + L * i / 10)]);
            g.path(arc, g.c.good, { w: 5 });
            g.path([[RE * cos(a - L), RE * sin(a - L)], [r * cos(a), r * sin(a)], [RE * cos(a + L), RE * sin(a + L)]], g.c.c, { w: 1, fill: true, fa: 0.12 });
            g.dot(r * cos(a), r * sin(a), g.c.ink, 3.5);
          }
          g.note('covered ground', 'tl', g.c.good).note('gap', 'tl', g.c.bad, 1);
        },
        read: (s, p) => { const L = lam0(p.alt, p.el); return [['footprint half-angle λ', num(L, 3) + '°'], ['footprint width', num(2 * rad(L) * RE, 4) + ' km'], ['in-plane coverage', num(min(100, p.n * 2 * L / 360 * 100), 3) + ' %'], ['round-trip delay overhead', num(2 * p.alt / 300, 3) + ' ms']]; },
        mission: 'With a 25° or higher elevation mask and 12 satellites or fewer, find the lowest altitude (within 50 km) that gives gap-free coverage along the plane.',
        goal: (s, p) => p.el >= 25 && p.n <= 12 && p.n * 2 * lam0(p.alt, p.el) >= 360 && 12 * 2 * lam0(p.alt - 50, 25) < 360,
        win: { alt: 1170, n: 12, el: 25 },
      },
      cards: [
        { q: 'How does altitude affect the number of satellites needed for continuous coverage?', a: 'Higher altitude gives a larger footprint, so fewer satellites per plane and fewer planes; lower altitude needs many more.' },
        { q: 'List two advantages and two disadvantages of low Earth orbit for a constellation.', a: 'Advantages: low latency and path loss, better imaging resolution, cheaper launch, natural debris removal. Disadvantages: small footprints, so many satellites and frequent handovers; atmospheric drag.' },
        { q: 'Why does a large constellation improve resilience?', a: 'Capability is spread across many replaceable satellites, so losing a few causes graceful degradation instead of mission failure.' },
      ],
      quiz: [
        { q: 'A footprint has an Earth-central half-angle of 10°. How many satellites does one plane need for gap-free coverage along the track?', num: 18, tol: 0.1, why: 'Spacing can be at most $2λ = 20°$, and $360/20 = 18$.' },
        { q: 'What is the one-way signal delay to a geostationary satellite directly overhead (35,786 km)? Give milliseconds.', num: 119, unit: 'ms', tol: 2, why: '$35{,}786/300{,}000 = 0.119$ s.' },
      ],
    },
    {
      id: 'sda-tracking', skill: 'sda', title: 'Space domain awareness: keeping custody', pre: ['kalman-tracking', 'orbit-kepler', 'radar-range-equation'],
      hook: 'Tens of thousands of objects larger than a fist are in orbit. Each is known only as well as its last observation, and that knowledge decays by the hour.',
      body: [
        '**Space domain awareness** is knowing what is in orbit, where it is going and what it is doing: detect, track, identify, characterize. Radars track objects in low orbit; telescopes track the faint, distant ones near geostationary altitude.',
        'Each object’s orbit is estimated by fitting observations with least squares or a Kalman filter. Between observations the estimate is propagated forward, and its uncertainty grows, fastest in the **along-track** direction:',
        { list: ['A small error in orbital speed is an error in period, so the position error grows steadily with time.', 'In low orbit, **atmospheric drag** is poorly known. It depends on solar activity and on the object’s shape and attitude, and its effect grows with the square of time.'] },
        'Each new observation pulls the uncertainty back down. The result is a sawtooth, and the job of a sensor network is to keep its peaks below what the mission needs: about a kilometer for collision screening, far less for rendezvous.',
        'Losing **custody** means the uncertainty has grown so large that a new detection can no longer be confidently matched to the catalog entry. Maneuvering objects make this much harder, because the model that predicts them is wrong by design.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'rev', label: 'Time between observations', min: 0.5, max: 24, step: 0.5, v: 12, unit: 'h' },
          { k: 'acc', label: 'Sensor accuracy', min: 10, max: 500, step: 10, v: 100, unit: 'm' },
          { k: 'alt', label: 'Object altitude', min: 200, max: 1000, step: 20, v: 400, unit: 'km' },
        ],
        draw(g, s, p) {
          const r = sawtooth(p);
          g.view(0, 48, 0, 4).axes({ xl: 'time (hours)', yl: 'along-track uncertainty (km, 1σ)', xs: 6 });
          g.rect(0, 1, 48, 3, g.c.bad, { fa: 0.07 }).line(0, 1, 48, 1, g.c.bad, { w: 1.5, dash: [6, 4] }).text('screening limit 1 km', 47.5, 1.15, g.c.bad, { a: 'right', s: 10.5 });
          g.clip(() => g.path(r.pts.map(([t, v]) => [t, v / 1000]), g.c.a, { w: 2.2 }));
          for (let t = 0; t <= 48; t += p.rev) g.dot(t, 0, g.c.b, 4);
          g.note('observations', 'tr', g.c.b);
        },
        read: (s, p) => { const r = sawtooth(p); return [['peak uncertainty', num(r.max / 1000, 3) + ' km'], ['observations per day', num(24 / p.rev, 3)], ['custody', r.max < 1000 ? 'held' : 'at risk']]; },
        mission: 'For an object at 400 km or lower, using a sensor no better than 50 m, find the longest gap between observations (to within 0.5 h) that keeps uncertainty under 1 km.',
        goal: (s, p) => p.alt <= 400 && p.acc >= 50 && sawtooth(p).max < 1000 && sawtooth({ ...p, rev: p.rev + 0.5 }).max >= 1000,
        win: { rev: 3, acc: 50, alt: 400 },
      },
      cards: [
        { q: 'What are the four tasks of space domain awareness?', a: 'Detect, track, identify and characterize objects in orbit (what is there, where it is going, what it is, what it is doing).' },
        { q: 'Why does orbit uncertainty grow fastest along-track?', a: 'A velocity error changes the period, so the object arrives earlier or later each revolution; in low orbit uncertain drag adds an error growing with time squared.' },
        { q: 'What does "losing custody" of a space object mean?', a: 'Its predicted position has become too uncertain to match new detections to the catalog entry with confidence.' },
      ],
      quiz: [
        { q: 'An object’s along-track velocity is uncertain by 0.05 m/s. After 6 hours with no observation, the position uncertainty from this alone is about:', num: 1080, unit: 'm', tol: 15, why: '$0.05 × 6 × 3600 = 1080$ m.' },
        { q: 'Which objects are hardest to keep in a catalog?', choices: ['Large satellites in stable high orbits', 'Small, low-altitude objects and those that maneuver', 'Geostationary satellites', 'Objects with radar reflectors'], answer: 1, why: 'Small means few detections; low means uncertain drag; maneuvers invalidate the prediction model.' },
      ],
    },
    {
      id: 'sda-conjunction', skill: 'sda', title: 'Conjunctions and collision probability', pre: ['sda-tracking', 'prob-gaussian-cov', 'prob-bayes'],
      hook: 'Two objects will pass within 500 meters at 14 km/s. Should the satellite spend fuel to move? The answer is a probability, and it behaves strangely.',
      body: [
        'When two tracked objects are predicted to pass close, operators receive a **conjunction** warning: the predicted miss distance and the combined position uncertainty at closest approach.',
        'Because the encounter lasts a fraction of a second, the problem flattens into the plane perpendicular to the relative velocity. The **probability of collision** $P_c$ is the chance that the true miss falls within the combined size of the two objects: a 2-D Gaussian integrated over a small disc of radius $R$ (the hard-body radius), centered at the predicted miss.',
        { eq: 'P_c ≈ (R^2/2σ^2)·exp(−d^2/2σ^2)', where: 'small objects, equal uncertainty $σ$ in both directions, miss distance $d$' },
        'A typical maneuver threshold is $P_c$ near $10^{−4}$. Now the strange part. As uncertainty grows from very small, $P_c$ rises, peaks at $σ = d/√2$, and then **falls**. With poor tracking the probability is low, not because the pass is safe but because the Gaussian is spread so thin. This is **probability dilution**, and it means a low $P_c$ from bad data is not reassurance. The remedy is better tracking, not comfort.',
        'Debris from one collision raises the risk for everything else at that altitude, which is why operators plan for disposal at end of life.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'd', label: 'Predicted miss distance', min: 50, max: 2000, step: 50, v: 500, unit: 'm' },
          { k: 'ls', label: 'Position uncertainty σ', min: 1, max: 3.7, step: 0.02, v: 1.6, fmt: v => num(10 ** v, 3) + ' m' },
          { k: 'R', label: 'Combined hard-body radius', min: 1, max: 30, step: 1, v: 10, unit: 'm' },
        ],
        draw(g, s, p) {
          const sg = 10 ** p.ls, split = min(g.h, g.w * 0.42), V = max(1.4 * p.d, 2.2 * sg, 300);
          g.view(-V, V, -V, V, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.heat((x, y) => exp(-((x - p.d * 0.5) ** 2 + y * y) / (2 * sg * sg)) * 0.9, 34, 34, g.ramp);
          g.circle(p.d * 0.5, 0, sg, g.c.a, { w: 1.5 }).circle(p.d * 0.5, 0, 2 * sg, g.c.a, { w: 1, dash: [4, 3] });
          g.dot(-p.d * 0.5, 0, g.c.ink, 5).dot(p.d * 0.5, 0, g.c.a, 4).line(-p.d * 0.5, 0, p.d * 0.5, 0, g.c.ink, { w: 1, dash: [3, 3] });
          g.text('our satellite', -p.d * 0.5, 0, g.c.ink, { a: 'center', dy: 14, s: 10.5, bg: true });
          g.view(1, 3.7, -9, -2, { pad: [split + 54, 12, 14, 30] }).axes({ xl: 'uncertainty σ (m)', yl: 'collision probability', xf: pw, yf: pw, xs: 1, ys: 1 });
          g.fn(l => clamp(log10(max(1e-12, pc(p.d, 10 ** l, p.R))), -9.5, -1), g.c.b, { w: 2.5, n: 120 });
          g.line(1, -4, 3.7, -4, g.c.bad, { w: 1.2, dash: [5, 4] }).text('maneuver threshold', 3.65, -3.7, g.c.bad, { a: 'right', s: 10.5 });
          g.dot(p.ls, clamp(log10(max(1e-12, pc(p.d, sg, p.R))), -9, -2), g.c.ink, 6);
        },
        read: (s, p) => { const v = pc(p.d, 10 ** p.ls, p.R); return [['collision probability', num(v, 2)], ['about 1 in', v > 1e-12 ? num(1 / v, 2) : '> 10¹²'], ['peak occurs at σ = d/√2', num(p.d / Math.SQRT2, 3) + ' m']]; },
        mission: 'Hold the miss distance at 500 m and find the uncertainty at which collision probability is highest (within 5% of the peak).',
        goal: (s, p) => p.d === 500 && pc(500, 10 ** p.ls, p.R) >= 0.95 * pc(500, 500 / Math.SQRT2, p.R),
        win: { d: 500, ls: 2.54 },
      },
      cards: [
        { q: 'How is probability of collision computed for a conjunction?', a: 'Project the encounter onto the plane perpendicular to relative velocity and integrate the combined 2-D Gaussian position uncertainty over a disc of the combined hard-body radius, centered at the predicted miss.' },
        { q: 'What is probability dilution?', a: 'When position uncertainty is large, computed $P_c$ falls because the probability is spread thin. A low $P_c$ from poor tracking does not mean the pass is safe; it means the data cannot tell.' },
      ],
      quiz: [
        { q: 'For a 600 m predicted miss, at what uncertainty σ is collision probability greatest? Give meters.', num: 424, unit: 'm', tol: 5, why: '$σ = d/√2 = 600/1.414 ≈ 424$ m.' },
        { q: 'Tracking improves so that σ shrinks from far above $d/√2$ toward it. The computed collision probability will:', choices: ['Fall', 'Rise', 'Stay the same', 'Become exactly zero'], answer: 1, why: 'Leaving the dilution region, better data concentrates the probability and $P_c$ rises toward its peak before falling again at very small σ.' },
      ],
    },
  ],
};
