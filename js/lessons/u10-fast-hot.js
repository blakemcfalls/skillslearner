import { num, rk4, clamp, Q, gauss } from '../sim.js';
const { sin, cos, tan, PI, sqrt, exp, log, abs, max, min, log10, atan2 } = Math;
const rad = d => d * PI / 180;
const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');
const SB = 5.67e-8;

// --- stagnation heating (Sutton-Graves form) ---
const rhoAt = h => 1.225 * exp(-h / 7.2);
export const heat = p => { const q = 1.74e-4 * sqrt(rhoAt(p.alt) / p.rn) * (p.v * 1000) ** 3; return { q: q / 1e4, Tw: (q / (0.85 * SB)) ** 0.25, M: p.v * 1000 / 300, T0: 230 * (1 + 0.2 * (p.v * 1000 / 300) ** 2) }; };

// --- planar entry/glide trajectory over a round Earth ---
const fmem = new Map();
export function fly(v0, g0, LD) {
  const key = [v0, g0, LD].join(); if (fmem.has(key)) return fmem.get(key);
  const Re = 6371e3, mu = 3.986e14, beta = 5000;
  let y = [Re + 60e3, 0, v0 * 1000, rad(g0)], t = 0, qmax = 0, load = 0, hmax = 60; const pts = [[0, 60]];
  const f = ([r, th, V, gam]) => { const rho = 1.225 * exp(-(r - Re) / 7200), g = mu / (r * r), D = rho * V * V / (2 * beta); return [V * sin(gam), V * cos(gam) / r, -D - g * sin(gam), LD * D / V - (g / V - V / r) * cos(gam)]; };
  for (let i = 0; i < 20000; i++) {
    const h = y[0] - Re, dt = h < 90e3 ? 0.5 : 2;
    y = rk4(f, y, 0, dt); t += dt;
    const h2 = y[0] - Re, q = 1.74e-4 * sqrt(1.225 * exp(-h2 / 7200) / 0.1) * y[2] ** 3 / 1e4;
    qmax = max(qmax, q); load += q * dt; hmax = max(hmax, h2 / 1000);
    if (i % 8 === 0) pts.push([y[1] * Re / 1000, h2 / 1000]);
    if (h2 <= 0 || y[2] < 250 || t > 9000) break;
  }
  pts.push([y[1] * Re / 1000, max(0, (y[0] - Re) / 1000)]);
  const res = { pts, range: y[1] * Re / 1000, t, qmax, load: load / 1000, hmax };
  if (fmem.size > 300) fmem.clear(); fmem.set(key, res); return res;
}

// --- TPS concept comparison: areal mass (kg/m^2) or Infinity if it cannot survive ---
export function tps(lq, lt) {
  const q = 10 ** lq * 1e4, t = 10 ** lt, Teq = (q / (0.85 * SB)) ** 0.25;
  const sinkT = q * t / (8960 * 385 * 1050);
  return { Teq, sink: sinkT <= 0.05 ? 8960 * max(0.0005, sinkT) : Infinity, rerad: Teq <= 2000 ? 8 + 0.004 * t : Infinity, abl: 10 + q * t / 20e6 + 0.012 * t };
}
const best = r => (['sink', 'rerad', 'abl'].sort((a, b) => r[a] - r[b])[0]);

// --- transient conduction through an insulated-back slab ---
const ALPHA = { tile: ['Silica tile', 4.3e-7], abl: ['Charring ablator', 2.5e-7], cc: ['Carbon–carbon', 8e-6], al: ['Aluminum', 9.7e-5] };
export function soak(mat, Lcm, tEnd = 600) {
  const a = ALPHA[mat][1], N = 30, dx = Lcm / 100 / N, dt = 0.4 * dx * dx / a, r = 0.4, steps = Math.ceil(tEnd / dt);
  let T = new Array(N + 1).fill(300); T[0] = 1500; const back = [[0, 300]];
  for (let s = 1; s <= steps; s++) { const n = T.slice(); for (let i = 1; i < N; i++) n[i] = T[i] + r * (T[i - 1] - 2 * T[i] + T[i + 1]); n[N] = T[N] + 2 * r * (T[N - 1] - T[N]); T = n; if (s % Math.max(1, Math.floor(steps / 120)) === 0 || s === steps) back.push([min(tEnd, s * dt), T[N]]); }
  return { T, back, Tb: T[N] };
}

// --- classical lamination: in-plane modulus of a 0/±45/90 laminate versus direction ---
export function laminate(p) {
  const Vf = p.vf / 100, E1 = Vf * 230 + (1 - Vf) * 3.5, E2 = 1 / (Vf / 15 + (1 - Vf) / 3.5), G = 1 / (Vf / 15 + (1 - Vf) / 1.3), nu = 0.3, d = 1 - nu * nu * E2 / E1;
  const Q11 = E1 / d, Q22 = E2 / d, Q12 = nu * E2 / d, Q66 = G, A = [0, 0, 0, 0, 0, 0];
  const p90 = max(0, 100 - p.p0 - p.p45);
  [[0, p.p0], [45, p.p45 / 2], [-45, p.p45 / 2], [90, p90]].forEach(([ang, w]) => {
    const c = cos(rad(ang)), s = sin(rad(ang)), c2 = c * c, s2 = s * s;
    const q = [Q11 * c2 * c2 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * s2 * s2, (Q11 + Q22 - 4 * Q66) * s2 * c2 + Q12 * (s2 * s2 + c2 * c2), Q11 * s2 * s2 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * c2 * c2, (Q11 - Q12 - 2 * Q66) * s * c2 * c + (Q12 - Q22 + 2 * Q66) * s2 * s * c, (Q11 - Q12 - 2 * Q66) * s2 * s * c + (Q12 - Q22 + 2 * Q66) * s * c2 * c, (Q11 + Q22 - 2 * Q12 - 2 * Q66) * s2 * c2 + Q66 * (s2 * s2 + c2 * c2)];
    q.forEach((v, i) => { A[i] += v * w / 100; });
  });
  const [a11, a12, a22, a16, a26, a66] = A, det = a11 * (a22 * a66 - a26 * a26) - a12 * (a12 * a66 - a26 * a16) + a16 * (a12 * a26 - a22 * a16);
  const S = [(a22 * a66 - a26 * a26) / det, (a16 * a26 - a12 * a66) / det, (a11 * a66 - a16 * a16) / det, (a12 * a26 - a16 * a22) / det, (a12 * a16 - a11 * a26) / det, (a11 * a22 - a12 * a12) / det];
  const E = phi => { const c = cos(phi), s = sin(phi); return 1 / (S[0] * c ** 4 + (2 * S[1] + S[5]) * s * s * c * c + S[2] * s ** 4 + 2 * S[3] * c ** 3 * s + 2 * S[4] * c * s ** 3); };
  let lo = 1e9, hi = 0; for (let i = 0; i < 180; i += 3) { const e = E(rad(i)); lo = min(lo, e); hi = max(hi, e); }
  return { E, lo, hi, E1, E2, p90 };
}

// --- creep rupture of a nickel superalloy (Larson-Miller) ---
export const life = (T, sig) => 10 ** ((30.5 - 4.5 * log10(sig / 100)) * 1000 / T - 20);

// --- brittle strength ---
const KIC = { al2o3: ['Alumina', 4], sic: ['Silicon carbide', 3.5], si3n4: ['Silicon nitride', 6], zro2: ['Toughened zirconia', 9], cmc: ['SiC/SiC composite', 25] };
export const sig0 = p => KIC[p.mat][1] / (1.12 * sqrt(PI * 10 ** p.la * 1e-6));
export const pfail = p => 1 - exp(-((200 / sig0(p)) ** p.m));

// --- laser powder bed fusion ---
export const lpbf = p => { const E = p.P / (p.v * p.h / 1000 * p.t / 1000), por = 0.05 + (E < 55 ? 0.35 * (55 - E) : 0) + (E > 85 ? 0.12 * (E - 85) : 0); return { E, por: min(40, por), rate: p.v * p.h / 1000 * p.t / 1000 * 3.6 }; };

// --- overhang analysis of a T-shaped part ---
const TEE = [[-0.5, 0], [0.5, 0], [0.5, 3], [2, 3], [2, 4], [-2, 4], [-2, 3], [-0.5, 3]];
export function supports(degAng) {
  const a = rad(degAng), pts = TEE.map(([x, y]) => [x * cos(a) - (y - 2) * sin(a), x * sin(a) + (y - 2) * cos(a)]);
  const y0 = min(...pts.map(q => q[1])), P = pts.map(([x, y]) => [x, y - y0]), n = P.length, cols = [];
  let area = 0; const x0 = min(...P.map(q => q[0])), x1 = max(...P.map(q => q[0])), dx = (x1 - x0) / 240;
  for (let i = 0; i < 240; i++) {
    const x = x0 + (i + 0.5) * dx, hits = [];
    for (let k = 0; k < n; k++) { const [ax, ay] = P[k], [bx, by] = P[(k + 1) % n]; if ((ax - x) * (bx - x) < 0) { const y = ay + (by - ay) * (x - ax) / (bx - ax), slope = abs(atan2(by - ay, bx - ax) * 180 / PI), ang = min(slope, 180 - slope); hits.push([y, ang]); } }
    hits.sort((u, v) => u[0] - v[0]);
    for (let k = 0; k < hits.length; k += 2) { const below = k === 0 ? 0 : hits[k - 1][0], gap = hits[k][0] - below; if (gap > 0.02 && hits[k][1] < 45) { area += gap * dx; cols.push([x, below, hits[k][0]]); } }
  }
  return { P, area, cols, height: max(...P.map(q => q[1])) };
}

// --- solid rocket grain: tube with burning ends ---
export function grain(p) {
  const R = 1, ri = 0.4, web = R - ri, pts = []; let lo = 1e9, hi = 0;
  for (let i = 0; i <= 60; i++) { const w = i / 60 * web, r = ri + w, L = p.kind === 'bates' ? max(0, p.L - 2 * w) : p.L, Ab = p.kind === 'end' ? PI * R * R : 2 * PI * r * L + (p.kind === 'bates' ? 2 * PI * (R * R - r * r) : 0), Pc = (Ab / (p.kind === 'end' ? 1.2 : 12)) ** (1 / (1 - p.n)); pts.push([i / 60, Pc]); if (i > 0 && i < 60) { lo = min(lo, Pc); hi = max(hi, Pc); } }
  return { pts, ratio: hi / lo, hi };
}

// --- tolerance stack ---
export const yieldOf = (t, n) => 1 - 2 * Q(0.2 / (sqrt(n) * t / 3));

export default {
  id: 'u10', title: 'Fast and hot', blurb: 'Hypersonics, thermal protection and materials.',
  lessons: [
    {
      id: 'hyper-heating', skill: 'hyper', title: 'Hypersonic heating and the blunt body', pre: ['aero-shocks', 'aero-compressible', 'thermo-heat-transfer'],
      hook: 'At Mach 15 the air ahead of a vehicle is hotter than the surface of the Sun. The first design question is where that energy goes.',
      body: [
        '**Hypersonic** flight, loosely above Mach 5, is where heating takes over from drag as the governing problem. A vehicle’s kinetic energy per kilogram grows as $v^2$; at 6 km/s it is 18 MJ/kg, several times what it takes to vaporize any material.',
        'Heat flux at the stagnation point follows a compact correlation:',
        { eq: 'q ≈ k·√(ρ/R_n)·v^3', where: '$ρ$ = air density, $R_n$ = nose radius, $k ≈ 1.74 × 10^{−4}$ in SI units for Earth' },
        'The cube of velocity dominates, but look at the nose radius. A **blunt** nose is heated less than a sharp one. A blunt body pushes a strong detached shock out in front, and most of the energy goes into heating the air that flows around the vehicle and away. This was H. Julian Allen’s counter-intuitive discovery in the 1950s, and it is why capsules and early warheads were blunt.',
        'A surface that can only radiate reaches **radiative equilibrium** when $εσT^4 = q$. The catch for gliding and cruising vehicles is that lift and low drag need thin wings and sharp leading edges, exactly the shapes that heat most. Above roughly Mach 10 the air also dissociates and ionizes, so ideal-gas temperatures overstate reality.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'v', label: 'Speed', min: 1, max: 8, step: 0.1, v: 6, unit: 'km/s' },
          { k: 'alt', label: 'Altitude', min: 20, max: 80, step: 1, v: 50, unit: 'km' },
          { k: 'rn', label: 'Nose radius', min: 0.01, max: 2, step: 0.01, v: 0.05, unit: 'm' },
        ],
        draw(g, s, p) {
          const k = heat(p), R = 0.25 + 1.3 * sqrt(p.rn / 2), so = 0.12 + R * 0.28;
          g.view(-3, 5, -2.6, 2.6, { eq: true, pad: [8, 8, 8, 8] });
          for (let y = -2.2; y <= 2.21; y += 0.44) g.arrow(-3, y, -2.3, y, g.c.dim, { w: 1, head: 5, alpha: 0.6 });
          const body = []; for (let a = 90; a <= 270; a += 5) body.push([R + R * cos(rad(a)), R * sin(rad(a))]);
          g.path([...body, [5, -R - 0.9], [5, R + 0.9]], g.c.dim, { fill: true, fa: 0.35, w: 2, close: true });
          for (let i = 0; i < 12; i++) { const a = rad(110 + i * 12); g.dot(R + R * cos(a), R * sin(a), g.hot(clamp(k.Tw / 3500 * (0.45 + 0.55 * abs(cos(a - PI))), 0, 1)), 7); }
          const bow = []; for (let y = -2.6; y <= 2.6; y += 0.1) bow.push([-so + 0.42 * y * y / (R + 0.6), y]);
          g.clip(() => g.path(bow, g.c.a, { w: 3 }));
          g.note('bow shock', 'tl', g.c.a).note(p.rn < 0.1 ? 'sharp nose: shock hugs the surface' : 'blunt nose: shock stands off', 'bl', g.c.dim);
        },
        read: (s, p) => { const k = heat(p); return [['Mach number', num(k.M, 3)], ['stagnation heat flux', num(k.q, 3) + ' W/cm²'], ['radiative equilibrium wall', num(k.Tw, 4) + ' K'], ['kinetic energy', num(p.v * p.v / 2, 3) + ' MJ/kg']]; },
        mission: 'At 5 km/s or faster and at 55 km or lower, keep the radiative-equilibrium nose temperature under 2,000 K.',
        goal: (s, p) => p.v >= 5 && p.alt <= 55 && heat(p).Tw < 2000,
        win: { v: 5, alt: 55, rn: 0.5 },
      },
      cards: [
        { q: 'Give the scaling of stagnation-point heat flux with density, nose radius and velocity.', a: '$q ∝ √(ρ/R_n)·v^3$. Heating rises with the cube of speed and falls as the nose gets blunter.' },
        { q: 'Why does a blunt nose run cooler than a sharp one at hypersonic speed?', a: 'It forces a strong detached bow shock that stands off from the surface. Most of the dissipated energy heats air that flows around and away from the vehicle instead of the wall.' },
        { q: 'What is radiative equilibrium temperature?', a: 'The surface temperature at which re-radiated power equals incoming heat flux: $εσT^4 = q$.' },
      ],
      quiz: [
        { q: 'A vehicle’s speed rises from 4 to 6 km/s at the same altitude. Stagnation heat flux rises by a factor of:', num: 3.375, tol: 0.05, why: '$(6/4)^3 = 3.375$.' },
        { q: 'A nose radius is reduced from 40 cm to 10 cm. Stagnation heat flux:', choices: ['Halves', 'Doubles', 'Quadruples', 'Is unchanged'], answer: 1, why: '$q ∝ 1/√R_n$: one quarter the radius gives twice the heat flux.' },
      ],
    },
    {
      id: 'hyper-glide', skill: 'hyper', title: 'Ballistic arcs and lifting glides', pre: ['hyper-heating', 'aero-lift-drag', 'num-euler-rk4', 'trajopt-bang-bang'],
      hook: 'Two vehicles leave a booster at the same speed. One follows a predictable arc through space. The other stays in the upper atmosphere and can go half again as far.',
      body: [
        'After its engine cuts off, a body with no lift follows a **ballistic** trajectory: a section of an ellipse about Earth’s center. Its range is set almost entirely by burnout speed and angle, it spends most of the flight in vacuum, and it re-enters steeply with a short, intense pulse of heating.',
        'A body with a good **lift-to-drag ratio** can instead re-enter shallowly and **glide**. Lift, plus the centrifugal effect of moving fast around a curved Earth, holds it up. In equilibrium glide the range is roughly',
        { eq: 'R ≈ (R_E/2)·(L/D)·ln[1/(1 − v^2/v_c^2)]', where: '$v_c$ ≈ 7.9 km/s, circular orbital speed' },
        'Range scales directly with $L/D$. The costs are thermal and structural: the glider flies for many minutes at hypersonic speed inside the atmosphere, so its peak heat flux may be lower than a ballistic entry’s but its **total heat load** is far higher, and its sharp, slender shape is the hardest kind to keep cool.',
        'Too steep an entry with lift produces a **skip**: the vehicle bounces off the denser air and back up, trading speed for altitude each time.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'v0', label: 'Burnout speed', min: 3, max: 7, step: 0.1, v: 5, unit: 'km/s' },
          { k: 'g0', label: 'Burnout flight-path angle', min: -5, max: 45, step: 1, v: 30, unit: '°' },
          { k: 'ld', label: 'Lift-to-drag ratio', min: 0, max: 4, step: 0.1, v: 0 },
        ],
        draw(g, s, p) {
          const r = fly(p.v0, p.g0, p.ld), ref = fly(p.v0, 30, 0);
          g.view(0, max(2000, r.range, ref.range) * 1.05, 0, max(120, r.hmax, ref.hmax) * 1.1).axes({ xl: 'downrange (km)', yl: 'altitude (km)' });
          g.rect(0, 0, 1e5, 100, g.c.b, { fa: 0.07 }).text('sensible atmosphere', 40, 92, g.c.b, { s: 10.5 });
          g.clip(() => { g.path(ref.pts, g.c.dim, { w: 1.5, dash: [5, 4] }); g.path(r.pts, g.c.a, { w: 2.5 }); });
          g.note('this vehicle', 'tr', g.c.a).note('ballistic reference, 30°', 'tr', g.c.dim, 1);
        },
        read: (s, p) => { const r = fly(p.v0, p.g0, p.ld); return [['range', num(r.range, 4) + ' km'], ['flight time', num(r.t / 60, 3) + ' min'], ['peak heat flux', num(r.qmax, 3) + ' W/cm²'], ['total heat load', num(r.load, 3) + ' kJ/cm²']]; },
        mission: 'Reach at least 5,000 km of range with a burnout speed of 5 km/s or less.',
        goal: (s, p) => p.v0 <= 5 && fly(p.v0, p.g0, p.ld).range >= 5000,
        win: { v0: 5, g0: 5, ld: 3 },
      },
      cards: [
        { q: 'What sets the range of a ballistic (non-lifting) trajectory, and what is its heating like?', a: 'Burnout speed and angle. It re-enters steeply, giving a short, very intense heating pulse.' },
        { q: 'How does glide range depend on lift-to-drag ratio?', a: 'Roughly in direct proportion: $R ≈ (R_E/2)(L/D) ln[1/(1 − v^2/v_c^2)]$.' },
        { q: 'Compare the thermal problem of a glide vehicle with a ballistic one.', a: 'The glider usually sees lower peak heat flux but for far longer, so its total heat load is much larger, and its sharp leading edges concentrate heating.' },
      ],
      quiz: [
        { q: 'Using the glide-range formula with $R_E$ = 6,371 km, $L/D$ = 2 and $v/v_c$ = 0.6, what is the range in km?', num: 2843, unit: 'km', tol: 40, why: '$6371 × ln(1/(1 − 0.36)) = 6371 × 0.4463 ≈ 2843$ km.' },
        { q: 'A lifting vehicle that enters too steeply tends to:', choices: ['Stop immediately', 'Skip: pull up out of the dense air and climb again', 'Follow a ballistic arc exactly', 'Lose all lift'], answer: 1, why: 'Lift grows quickly as density rises, turning the flight path upward and producing an oscillating skip-glide.' },
      ],
    },
    {
      id: 'tps-concepts', skill: 'tps', title: 'Thermal protection: sink, radiate or ablate', pre: ['hyper-heating', 'eoir-blackbody', 'thermo-heat-transfer'],
      hook: 'There are only three things to do with heat you cannot avoid: store it, send it back, or let it carry material away.',
      body: [
        'A thermal protection system (TPS) manages the surface energy balance. Each concept handles the incoming flux differently, and each has a regime where it wins.',
        { list: ['**Heat sink.** A thick slab of conductive metal absorbs the pulse. Simple and reusable, but mass grows with total heat load, and the slab must not reach its melting point.', '**Re-radiation.** A hot outer surface radiates most of the flux away as $εσT^4$, with insulation beneath (shuttle tiles, carbon–carbon). Light and reusable, but limited by the temperature the surface can survive, which caps the heat flux at roughly 80–100 W/cm².', '**Ablation.** The surface chars, melts or vaporizes on purpose. Phase change absorbs energy and the gas blown off thickens the boundary layer and blocks incoming heat. It tolerates the highest fluxes; the price is that the material is consumed and the shape changes.'] },
        'So brief, extreme heating (steep ballistic entry) favors ablators; long, moderate heating (gliders, reusable vehicles) favors re-radiating systems; and short mild pulses can use a simple sink.',
        'The lab’s map shows which concept is lightest at each combination of heat flux and duration, using simplified sizing rules.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'lq', label: 'Heat flux', min: 0.5, max: 3, step: 0.05, v: 1.3, fmt: v => num(10 ** v, 3) + ' W/cm²' },
          { k: 'lt', label: 'Duration', min: 0.7, max: 3.3, step: 0.05, v: 2, fmt: v => num(10 ** v, 3) + ' s' },
        ],
        draw(g, s, p) {
          const col = { sink: g.c.b, rerad: g.c.c, abl: g.c.a };
          g.view(0.5, 3, 0.7, 3.3, { pad: [48, 12, 150, 30] }).axes({ xl: 'heat flux (W/cm²)', yl: 'duration (s)', xf: v => num(10 ** v, 2), yf: v => num(10 ** v, 2), xs: 0.5, ys: 0.5, grid: false });
          const nx = 50, ny = 40;
          for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const lq = 0.5 + (i + 0.5) / nx * 2.5, lt = 0.7 + (j + 0.5) / ny * 2.6; g.rect(0.5 + i / nx * 2.5, 0.7 + j / ny * 2.6, 2.5 / nx + 0.003, 2.6 / ny + 0.003, col[best(tps(lq, lt))], { fa: 0.5 }); }
          g.dot(p.lq, p.lt, g.c.ink, 7, { ring: g.c.panel });
          const r = tps(p.lq, p.lt);
          g.view(0, 3, 0, 60, { pad: [g.w - 132, 12, 12, 30] }).axes({ yl: 'kg/m²', xt: false, grid: false });
          [['sink', 'sink'], ['rerad', 'radiate'], ['abl', 'ablate']].forEach(([k, lab], i) => { if (isFinite(r[k])) g.rect(i + 0.15, 0, 0.7, min(60, r[k]), col[k], { fa: 0.85 }); else g.text('✗', i + 0.5, 6, g.c.bad, { a: 'center', s: 16, bold: true }); g.text(lab, i + 0.5, 0, col[k], { a: 'center', dy: 12, s: 10 }); });
        },
        read: (s, p) => { const r = tps(p.lq, p.lt); return [['lightest', { sink: 'heat sink', rerad: 're-radiating', abl: 'ablator' }[best(r)]], ['radiative equilibrium', num(r.Teq, 4) + ' K'], ['heat load', num(10 ** p.lq * 10 ** p.lt / 1000, 3) + ' kJ/cm²']]; },
        mission: 'Find a condition of 100 W/cm² or more where the ablator is the only concept that survives.',
        goal: (s, p) => { const r = tps(p.lq, p.lt); return p.lq >= 2 && !isFinite(r.sink) && !isFinite(r.rerad); },
        win: { lq: 2.5, lt: 2 },
      },
      cards: [
        { q: 'Name the three basic thermal protection strategies.', a: 'Heat sink (absorb into mass), re-radiation (hot surface radiates the flux away, insulation below), and ablation (material is consumed, absorbing and blocking heat).' },
        { q: 'What limits a re-radiating TPS, and what limits a heat sink?', a: 'Re-radiating: the maximum surface temperature, which caps heat flux via $εσT^4$. Heat sink: total heat load, since its mass must absorb the energy without melting.' },
        { q: 'How does an ablator protect the structure?', a: 'Energy is absorbed by pyrolysis, melting and vaporization, and the gases injected into the boundary layer block convective heating. The char layer also insulates and re-radiates.' },
      ],
      quiz: [
        { q: 'A surface with emissivity 0.85 can survive 1,900 K. What heat flux can it re-radiate, in W/cm²?', num: 62.8, unit: 'W/cm²', tol: 1.5, why: '$0.85 × 5.67 × 10^{−8} × 1900^4 = 6.28 × 10^5$ W/m² = 62.8 W/cm².' },
        { q: 'Which mission most favors an ablative heat shield?', choices: ['A reusable vehicle with 20 minutes of mild heating', 'A capsule with one minute of very intense heating', 'A subsonic aircraft', 'A satellite in orbit'], answer: 1, why: 'Short and intense: beyond what a surface can re-radiate, with a small enough total load that little material is consumed.' },
      ],
    },
    {
      id: 'tps-conduction', skill: 'tps', title: 'Heat soak: conduction through the shield', pre: ['tps-concepts', 'calc-gradient', 'num-finite-diff'],
      hook: 'The outside of a shuttle tile could glow at 1,500 K while the aluminum 5 cm beneath stayed cool. The peak at the bond line arrives minutes after the heating ends.',
      body: [
        'Inside a solid, temperature obeys the **heat equation**:',
        { eq: '∂T/∂t = α·∂^2T/∂x^2', where: '$α = k/(ρc)$ is thermal diffusivity' },
        'It says temperature at a point moves toward the average of its neighbors. Heat therefore diffuses, and the depth it reaches grows as',
        { eq: 'δ ≈ √(α·t)' },
        'To protect for four times as long you need twice the thickness. Insulators have tiny $α$ (silica tile is about 200 times lower than aluminum), which is what buys time.',
        'On a computer the slab is cut into nodes and stepped in time: each node takes a fraction $r = αΔt/Δx^2$ of the difference between its neighbors’ average and itself. This explicit scheme is stable only if $r ≤ ½$, a limit worth remembering whenever a thermal simulation blows up.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'mat', type: 'select', label: 'Material', v: 'tile', options: Object.entries(ALPHA).map(([k, v]) => [k, v[0]]) },
          { k: 'L', label: 'Thickness', min: 1, max: 10, step: 0.5, v: 2, unit: 'cm' },
          { k: 't', label: 'Time since heating began', min: 10, max: 600, step: 10, v: 600, unit: 's' },
        ],
        draw(g, s, p) {
          const now = soak(p.mat, p.L, p.t), end = soak(p.mat, p.L, 600), half = (g.w - 20) / 2;
          g.view(0, p.L, 250, 1600, { pad: [48, 12, g.w - half, 30] }).axes({ xl: 'depth (cm)', yl: 'temperature (K)' });
          for (let i = 0; i < 30; i++) g.rect(i * p.L / 30, 250, p.L / 30 + 0.01, 1350, g.hot(clamp((now.T[i] - 300) / 1200, 0, 1)), { fa: 0.5 });
          g.path(now.T.map((T, i) => [i * p.L / 30, T]), g.c.ink, { w: 2.5 });
          g.text('hot face 1,500 K', 0, 1560, g.c.ink, { dx: 5, s: 10.5 }).text('back', p.L, 300, g.c.ink, { a: 'right', dx: -4, dy: -10, s: 10.5 });
          g.view(0, 600, 250, 1600, { pad: [half + 64, 12, 14, 30] }).axes({ xl: 'time (s)', yl: 'back-face temperature (K)' });
          g.line(0, 450, 600, 450, g.c.bad, { w: 1.5, dash: [5, 4] }).text('bond-line limit 450 K', 590, 500, g.c.bad, { a: 'right', s: 10.5 });
          g.clip(() => g.path(end.back, g.c.a, { w: 2.5 }));
          g.line(p.t, 250, p.t, 1600, g.c.dim, { w: 1, dash: [3, 3] });
        },
        read: (s, p) => [['back face now', num(soak(p.mat, p.L, p.t).Tb, 4) + ' K'], ['back face at 600 s', num(soak(p.mat, p.L, 600).Tb, 4) + ' K'], ['diffusion depth √(αt)', num(sqrt(ALPHA[p.mat][1] * p.t) * 100, 3) + ' cm']],
        mission: 'Using silica tile, find the thinnest layer (to the nearest 0.5 cm) that keeps the back face under 450 K for the full 600 s.',
        goal: (s, p) => p.mat === 'tile' && soak('tile', p.L, 600).Tb < 450 && soak('tile', p.L - 0.5, 600).Tb >= 450,
        win: { mat: 'tile', L: 4.5, t: 600 },
      },
      cards: [
        { q: 'Write the one-dimensional heat equation and define thermal diffusivity.', a: '$∂T/∂t = α∂^2T/∂x^2$ with $α = k/(ρc)$: conductivity over volumetric heat capacity.' },
        { q: 'How does the depth reached by heat grow with time?', a: 'As $δ ≈ √(αt)$. Doubling the protection time needs only about 1.4 times the thickness; four times the time needs twice the thickness.' },
        { q: 'What is the stability limit of the explicit finite-difference heat equation?', a: '$r = αΔt/Δx^2 ≤ ½$. A larger time step makes the solution oscillate and blow up.' },
      ],
      quiz: [
        { q: 'A tile with $α = 4 × 10^{−7}$ m²/s is heated for 900 s. Roughly how deep does the heat penetrate, in cm?', num: 1.9, unit: 'cm', tol: 0.1, why: '$√(4 × 10^{−7} × 900) = √(3.6 × 10^{−4}) = 0.019$ m.' },
        { q: 'An explicit heat simulation uses $Δx$ = 1 mm and is stable at $Δt$ = 1 s. Refining to $Δx$ = 0.5 mm requires $Δt$ of at most:', choices: ['1 s', '0.5 s', '0.25 s', '2 s'], answer: 2, why: 'The limit scales with $Δx^2$: half the spacing needs a quarter of the time step.' },
      ],
      code: {
        prompt: 'Complete `step(T, r)`: one explicit time step of the heat equation on NumPy array `T`. Interior nodes follow $T_i + r(T_{i−1} − 2T_i + T_{i+1})$; the two end nodes keep their values. Return a new array without loops.',
        starter: 'import numpy as np\n\ndef step(T, r):\n    new = T.copy()\n    # update new[1:-1] using slices of T\n    return new\n\nT = np.array([1500.0, 300.0, 300.0, 300.0, 300.0])\nfor _ in range(3):\n    T = step(T, 0.4)\nprint(T)',
        solution: 'import numpy as np\n\ndef step(T, r):\n    new = T.copy()\n    new[1:-1] = T[1:-1] + r * (T[:-2] - 2 * T[1:-1] + T[2:])\n    return new\n\nT = np.array([1500.0, 300.0, 300.0, 300.0, 300.0])\nfor _ in range(3):\n    T = step(T, 0.4)\nprint(T)',
        tests: 'import numpy as np\n_T = np.array([1500.0, 300.0, 300.0, 300.0, 300.0])\n_n = step(_T, 0.4)\nassert np.allclose(_n, [1500.0, 780.0, 300.0, 300.0, 300.0]), f"after one step got {_n}"\nassert np.allclose(_T, [1500.0, 300.0, 300.0, 300.0, 300.0]), "do not modify the input array"\n_lin = np.linspace(0.0, 100.0, 11)\nassert np.allclose(step(_lin, 0.3), _lin), "a straight-line profile is already in steady state"',
        hint: '`new[1:-1] = T[1:-1] + r * (T[:-2] - 2 * T[1:-1] + T[2:])`',
      },
    },
    {
      id: 'composites-laminate', skill: 'composites', title: 'Composites: stiffness you can aim', pre: ['linalg-matrices', 'mech-spring', 'linalg-eigen'],
      hook: 'A metal is equally stiff in every direction whether you need it or not. A composite puts the stiffness where the load is and saves the weight elsewhere.',
      body: [
        'A fiber composite embeds stiff, strong fibers (carbon, glass) in a matrix (epoxy) that holds them and shares load between them. Along the fibers the two act in parallel, and stiffness follows the **rule of mixtures**:',
        { eq: 'E_1 = V_f·E_f + (1 − V_f)·E_m', where: '$V_f$ = fiber volume fraction' },
        'Across the fibers they act in series and the soft matrix dominates: $1/E_2 = V_f/E_f + (1 − V_f)/E_m$. A single ply of carbon/epoxy can be 15 times stiffer along the fibers than across them. That is **anisotropy**.',
        'Structures stack plies at different angles into a **laminate**. Plies at 0° carry axial load, ±45° plies carry shear and torsion, and 90° plies carry transverse load. A balanced mix of 25% 0°, 50% ±45° and 25% 90° is **quasi-isotropic**: equally stiff in every in-plane direction, like a metal at a fraction of the weight.',
        'The polar plot shows the laminate’s stiffness in each direction.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'p0', label: '0° plies', min: 0, max: 100, step: 5, v: 100, unit: '%' },
          { k: 'p45', label: '±45° plies', min: 0, max: 100, step: 5, v: 0, unit: '%' },
          { k: 'vf', label: 'Fiber volume fraction', min: 30, max: 70, step: 5, v: 60, unit: '%' },
        ],
        draw(g, s, p) {
          const L = laminate(p), R = 150;
          g.view(-R, R, -R * 0.8, R * 0.8, { eq: true, pad: [8, 8, 8, 8] });
          [50, 100, 150].forEach(r => { g.circle(0, 0, r, g.c.grid, { w: 1 }); g.text(r + ' GPa', r * 0.71, r * 0.71, g.c.dim, { s: 10, dx: 3 }); });
          g.line(-R, 0, R, 0, g.c.grid, { w: 1 }).line(0, -R, 0, R, g.c.grid, { w: 1 });
          const pts = []; for (let i = 0; i <= 120; i++) { const a = i / 60 * PI, e = L.E(a); pts.push([e * cos(a), e * sin(a)]); }
          g.clip(() => g.path(pts, g.c.a, { w: 2.5, fill: true, fa: 0.2, close: true }));
          g.text('0°', R * 0.93, 8, g.c.dim, { s: 11 }).text('90°', 6, R * 0.72, g.c.dim, { s: 11 });
          g.note(`lay-up: ${p.p0}% 0°, ${min(p.p45, 100 - p.p0)}% ±45°, ${L.p90}% 90°`, 'tl', g.c.ink);
        },
        read: (s, p) => { const L = laminate(p); return [['ply E₁ / E₂', `${num(L.E1, 3)} / ${num(L.E2, 3)} GPa`], ['laminate stiffest', num(L.hi, 3) + ' GPa'], ['least stiff', num(L.lo, 3) + ' GPa'], ['variation with direction', num((L.hi / L.lo - 1) * 100, 3) + ' %']]; },
        mission: 'Design a quasi-isotropic laminate: stiffness varying by less than 5% with direction.',
        goal: (s, p) => { const L = laminate(p); return p.p0 + p.p45 <= 100 && L.hi / L.lo < 1.05; },
        win: { p0: 25, p45: 50, vf: 60 },
      },
      cards: [
        { q: 'State the rule of mixtures for stiffness along the fibers of a composite.', a: '$E_1 = V_fE_f + (1−V_f)E_m$. Across the fibers the matrix dominates: $1/E_2 = V_f/E_f + (1−V_f)/E_m$.' },
        { q: 'What does each ply angle in a 0/±45/90 laminate contribute?', a: '0° plies carry axial load, ±45° plies carry shear and torsion, 90° plies carry transverse load.' },
        { q: 'What is a quasi-isotropic laminate?', a: 'A lay-up (for example 25% 0°, 50% ±45°, 25% 90°) whose in-plane stiffness is the same in every direction.' },
      ],
      quiz: [
        { q: 'Carbon fibers ($E_f$ = 230 GPa) at 60% volume in epoxy ($E_m$ = 3.5 GPa). What is the ply stiffness along the fibers, in GPa?', num: 139.4, unit: 'GPa', tol: 1.5, why: '$0.6 × 230 + 0.4 × 3.5 = 139.4$ GPa.' },
        { q: 'A tube must resist twisting. Which plies matter most?', choices: ['0° plies', '90° plies', '±45° plies', 'It makes no difference'], answer: 2, why: 'Torsion puts the wall in shear, which is tension and compression along ±45°.' },
      ],
    },
    {
      id: 'composites-alloys', skill: 'composites', title: 'High-temperature alloys and creep', pre: ['thermo-cycles', 'composites-laminate'],
      hook: 'A turbine blade spins in gas hotter than its own melting point, pulling with the force of a truck. It lasts thousands of hours because of how its atoms are arranged.',
      body: [
        'Metals weaken as they heat. Worse, under steady load at high temperature they **creep**: they stretch slowly and permanently, and eventually rupture, at stresses far below their short-term strength. Creep matters above roughly half the absolute melting temperature.',
        'Creep life is extremely sensitive to temperature. The **Larson–Miller parameter** captures the trade between temperature and time in one number:',
        { eq: 'P = T·(C + log_{10} t)', where: '$T$ in kelvin, $t$ = rupture life in hours, $C$ ≈ 20' },
        'Each stress level corresponds to one value of $P$. So a few hours of testing at high temperature predict years of life at a lower one. A rough rule that falls out: every 15–20 K hotter halves the life.',
        '**Nickel superalloys** hold strength to about 85% of their melting point thanks to a dense array of ordered precipitates that block dislocation motion. Casting blades as **single crystals** removes grain boundaries, where creep damage starts. Internal air cooling and ceramic **thermal barrier coatings** then let the gas run hundreds of kelvin hotter than the metal. Refractory metals (niobium, tungsten) go hotter still but oxidize badly without coatings.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'T', label: 'Metal temperature', min: 800, max: 1400, step: 5, v: 1300, unit: 'K' },
          { k: 'sig', label: 'Stress', min: 50, max: 600, step: 10, v: 250, unit: 'MPa' },
        ],
        draw(g, s, p) {
          g.view(800, 1400, 0, 8).axes({ xl: 'metal temperature (K)', yl: 'rupture life (hours)', yf: pw, ys: 2 });
          [100, 250, 500].forEach(sg => g.fn(T => clamp(log10(life(T, sg)), -1, 9), g.c.dim, { w: 1.2, dash: [4, 4] }));
          g.fn(T => clamp(log10(life(T, p.sig)), -1, 9), g.c.a, { w: 2.5 });
          g.line(800, 4, 1400, 4, g.c.good, { w: 1.5, dash: [6, 4] }).text('10,000 h target', 805, 4.35, g.c.good, { s: 10.5 });
          g.dot(p.T, clamp(log10(life(p.T, p.sig)), 0, 8), g.c.ink, 6);
          g.note('dashed: 100, 250, 500 MPa', 'tr', g.c.dim);
        },
        read: (s, p) => [['rupture life', num(life(p.T, p.sig), 3) + ' h'], ['Larson–Miller P', num(p.T * (20 + log10(life(p.T, p.sig))), 5)], ['life if 20 K hotter', num(life(p.T + 20, p.sig) / life(p.T, p.sig) * 100, 3) + ' %']],
        mission: 'A blade carries 250 MPa or more and must last 10,000 hours. Find the hottest metal temperature that allows it (within 10 K).',
        goal: (s, p) => p.sig >= 250 && life(p.T, p.sig) >= 1e4 && life(p.T + 10, 250) < 1e4,
        win: { T: 1195, sig: 250 },
      },
      cards: [
        { q: 'What is creep and when does it matter?', a: 'Slow, permanent deformation under steady load, leading to rupture at stresses below the short-term strength. It becomes important above roughly half the absolute melting temperature.' },
        { q: 'Write the Larson–Miller parameter and say what it is used for.', a: '$P = T(C + log_{10}t)$ with $C ≈ 20$. For a given stress, $P$ at rupture is constant, so short hot tests predict long life at lower temperature.' },
        { q: 'Name three things that let turbine blades survive gas hotter than their melting point.', a: 'Nickel superalloy chemistry with strengthening precipitates, single-crystal casting (no grain boundaries), internal air cooling, and ceramic thermal barrier coatings.' },
      ],
      quiz: [
        { q: 'A part ruptures in 1,000 h at 1,100 K. With $C$ = 20, at what temperature would it rupture in 10 h under the same stress? Give K.', num: 1205, unit: 'K', tol: 6, why: '$P = 1100 × 23 = 25{,}300$. Then $T = 25{,}300/(20 + 1) ≈ 1205$ K.' },
        { q: 'Why are single-crystal turbine blades more creep-resistant than ordinary castings?', choices: ['They are lighter', 'They have no grain boundaries, where creep damage begins', 'They conduct heat better', 'They are cheaper to make'], answer: 1, why: 'Grain boundaries slide and form voids at high temperature. Removing them removes the weakest path.' },
      ],
    },
    {
      id: 'ceramics-fracture', skill: 'ceramics', title: 'Ceramics: strong, hot and unforgiving', pre: ['composites-alloys', 'prob-distributions', 'prob-estimation'],
      hook: 'Ceramics keep their strength at temperatures where every metal has turned soft. They also shatter from a scratch too small to see.',
      body: [
        'Ceramics (oxides, carbides, nitrides) have strong ionic and covalent bonds: high melting points, high stiffness, low density, and resistance to oxidation. The same bonds prevent dislocations from moving, so a ceramic cannot yield to relieve stress at a crack tip. It is **brittle**.',
        'Strength is then controlled by the largest flaw. For a crack of depth $a$ the failure stress is',
        { eq: 'σ_f = K_{Ic} / (Y·√(π·a))', where: '$K_{Ic}$ = fracture toughness, $Y$ ≈ 1.12 for a surface crack' },
        'Because flaws vary from part to part, so does strength. The scatter follows a **Weibull distribution**:',
        { eq: 'P_f = 1 − exp[−(σ/σ_0)^m]' },
        'The **Weibull modulus** $m$ measures consistency. Metals behave like $m$ ≈ 100; ordinary ceramics are 5 to 15. A low $m$ means the design stress must sit far below the average strength for failures to be rare.',
        '**Ceramic matrix composites** (CMCs) embed ceramic fibers in a ceramic matrix with a weak interface, so cracks deflect and fibers bridge them. Toughness rises several-fold, and failure becomes gradual. Ultra-high-temperature ceramics such as hafnium and zirconium diboride are candidates for sharp leading edges above 2,300 K.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'mat', type: 'select', label: 'Material', v: 'al2o3', options: Object.entries(KIC).map(([k, v]) => [k, `${v[0]} (K_Ic = ${v[1]})`]) },
          { k: 'la', label: 'Largest flaw size', min: 0.7, max: 2.7, step: 0.05, v: 2, fmt: v => num(10 ** v, 3) + ' µm' },
          { k: 'm', label: 'Weibull modulus m', min: 3, max: 30, step: 1, v: 8 },
        ],
        draw(g, s, p) {
          const s0 = sig0(p);
          g.view(0, 1000, 0, 1.05).axes({ xl: 'applied stress (MPa)', yl: 'probability of failure' });
          g.fn(x => 1 - exp(-((x / s0) ** p.m)), g.c.a, { w: 2.5, n: 500 });
          g.line(200, 0, 200, 1.05, g.c.b, { w: 1.5, dash: [5, 4] }).text('design stress 200 MPa', 206, 1.0, g.c.b, { s: 10.5 });
          if (s0 < 1000) g.line(s0, 0, s0, 0.632, g.c.dim, { w: 1, dash: [3, 3] }).text('σ₀', s0, 0.67, g.c.dim, { a: 'center', s: 11 });
          g.dot(200, pfail(p), g.c.ink, 6);
        },
        read: (s, p) => [['characteristic strength σ₀', num(sig0(p), 3) + ' MPa'], ['failure probability at 200 MPa', num(pfail(p), 2)], ['about 1 part in', pfail(p) > 0 ? num(1 / pfail(p), 2) : '∞']],
        mission: 'Bring the failure probability at 200 MPa below 1 in 10,000.',
        goal: (s, p) => pfail(p) < 1e-4,
        win: { mat: 'si3n4', la: 1.5, m: 12 },
      },
      cards: [
        { q: 'Why are ceramics brittle, and what controls their strength?', a: 'Their bonding prevents dislocation motion, so stress at a crack tip cannot be relieved by yielding. Strength is set by the largest flaw: $σ_f = K_{Ic}/(Y√(πa))$.' },
        { q: 'What does the Weibull modulus describe?', a: 'The scatter in strength. High $m$ means consistent strength; low $m$ (typical ceramics 5–15) means wide scatter and a design stress far below the mean.' },
        { q: 'How do ceramic matrix composites gain toughness?', a: 'A weak fiber–matrix interface deflects cracks, and intact fibers bridge them, absorbing energy. Failure becomes gradual instead of sudden.' },
      ],
      quiz: [
        { q: 'A ceramic has $K_{Ic}$ = 5 MPa·√m and a 100 µm surface flaw ($Y$ = 1.12). What is its failure stress in MPa?', num: 252, unit: 'MPa', tol: 4, why: '$5/(1.12 × √(π × 10^{−4})) = 5/(1.12 × 0.01772) ≈ 252$ MPa.' },
        { q: 'Halving the largest flaw size in a ceramic raises its strength by about:', choices: ['41%', '100%', '25%', '0%'], answer: 0, why: 'Strength ∝ $1/√a$: $√2 ≈ 1.41$.' },
      ],
    },
    {
      id: 'am-process-window', skill: 'am', title: 'Additive manufacturing: the process window', pre: ['thermo-heat-transfer', 'ceramics-fracture'],
      hook: 'A printed rocket injector replaces hundreds of brazed parts with one. Whether it survives depends on four machine settings.',
      body: [
        '**Laser powder bed fusion** builds metal parts by spreading a thin layer of powder and melting selected regions with a scanning laser, layer after layer. It makes shapes no machining process can: internal cooling channels, lattices, consolidated assemblies.',
        'Part quality turns on how much energy each unit of volume receives:',
        { eq: 'E = P / (v·h·t)   (J/mm³)', where: '$P$ = laser power, $v$ = scan speed, $h$ = hatch spacing, $t$ = layer thickness' },
        { list: ['Too little energy: powder does not fully melt, leaving **lack-of-fusion** voids, irregular and crack-like, the most damaging to fatigue life.', 'Too much: the melt pool boils into a deep narrow **keyhole** that collapses and traps gas bubbles.', 'In between is the **process window** where density exceeds 99.5%.'] },
        'Build rate is $v·h·t$, so productivity pushes toward the low-energy edge of the window, right next to lack of fusion. That tension is why printed flight hardware is qualified with fixed parameters, witness coupons and CT scans.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'P', label: 'Laser power', min: 100, max: 400, step: 10, v: 200, unit: 'W' },
          { k: 'v', label: 'Scan speed', min: 200, max: 2500, step: 10, v: 1500, unit: 'mm/s' },
          { k: 'h', label: 'Hatch spacing', min: 60, max: 160, step: 10, v: 120, unit: 'µm' },
          { k: 't', label: 'Layer thickness', min: 20, max: 80, step: 10, v: 40, unit: 'µm' },
        ],
        draw(g, s, p) {
          g.view(200, 2500, 100, 400).axes({ xl: 'scan speed (mm/s)', yl: 'laser power (W)', grid: false });
          g.heat((v, P) => { const r = lpbf({ P, v, h: p.h, t: p.t }); return r.E < 55 ? -min(1, r.por / 12) : r.E > 85 ? min(1, r.por / 8) : 0; }, 60, 36, x => (abs(x) < 1e-6 ? g.c.good : g.div(x)));
          g.dot(p.v, p.P, g.c.ink, 7, { ring: g.c.panel });
          g.note('lack of fusion', 'br', g.c.b).note('keyholing', 'tl', g.c.a).note('dense', 'tr', g.c.good);
        },
        read: (s, p) => { const r = lpbf(p); return [['energy density', num(r.E, 3) + ' J/mm³'], ['porosity', num(r.por, 2) + ' %'], ['build rate', num(r.rate, 3) + ' cm³/h'], ['regime', r.E < 55 ? 'lack of fusion' : r.E > 85 ? 'keyholing' : 'dense']]; },
        mission: 'Find settings that build at 25 cm³/h or faster with porosity under 0.5%.',
        goal: (s, p) => { const r = lpbf(p); return r.rate >= 25 && r.por < 0.5; },
        win: { P: 400, v: 1210, h: 120, t: 50 },
      },
      cards: [
        { q: 'Write the volumetric energy density used in laser powder bed fusion.', a: '$E = P/(v·h·t)$: laser power over scan speed × hatch spacing × layer thickness, in J/mm³.' },
        { q: 'What defects appear on each side of the process window?', a: 'Too little energy: lack-of-fusion voids (irregular, crack-like, worst for fatigue). Too much: keyhole porosity (trapped gas bubbles).' },
      ],
      quiz: [
        { q: 'A machine runs 300 W at 1,000 mm/s with 0.1 mm hatch and 0.05 mm layers. What is the energy density in J/mm³?', num: 60, unit: 'J/mm³', tol: 0.6, why: '$300/(1000 × 0.1 × 0.05) = 300/5 = 60$ J/mm³.' },
        { q: 'To build faster while staying in the process window you should raise scan speed and also:', choices: ['Lower laser power', 'Raise laser power in proportion', 'Reduce hatch spacing', 'Use thinner layers'], answer: 1, why: 'Energy density must stay constant, so power must rise with $v·h·t$.' },
      ],
    },
    {
      id: 'am-design', skill: 'am', title: 'Designing for additive manufacturing', pre: ['am-process-window', 'calc-multiple-integrals'],
      hook: 'Printing removes many old manufacturing rules and adds a new one: every layer needs something underneath it.',
      body: [
        'Each new layer is melted on top of the previous one. A surface that leans out too far has only loose powder beneath it and sags or curls. The usual limit is about **45° from horizontal**; flatter down-facing surfaces need **support structures**, sacrificial scaffolding that also conducts heat away and anchors the part against warping.',
        'Supports cost material, build time and post-processing, and they cannot be removed from enclosed internal passages at all. So the first design decision is **build orientation**: turn the part until its overhangs disappear or move somewhere accessible.',
        { list: ['Replace horizontal ceilings with arches, teardrops or 45° chamfers. A round horizontal hole becomes a teardrop.', 'Build height sets the number of layers and so the time; a taller orientation takes longer.', 'Properties differ along the build direction, and surface finish is roughest on down-facing faces.', 'Residual stress from repeated melting can distort thin sections; orientation and supports manage it.'] },
        'With these rules respected, **topology optimization** can remove every gram that carries no load, producing the organic shapes typical of printed brackets.',
      ],
      labNote: 'Orange columns are supports. The part is built upward from the plate.',
      sim: {
        h: 320,
        controls: [{ k: 'ang', label: 'Build orientation', min: 0, max: 355, step: 5, v: 0, unit: '°' }],
        draw(g, s, p) {
          const r = supports(p.ang);
          g.view(-3.4, 3.4, -0.5, 5, { eq: true, pad: [8, 8, 8, 8] });
          g.rect(-3.4, -0.3, 6.8, 0.3, g.c.dim, { fa: 0.6 }).text('build plate', -3.3, -0.4, g.c.dim, { s: 10.5 });
          r.cols.forEach(([x, a, b]) => g.line(x, a, x, b, g.c.a, { w: 1.5, alpha: 0.7 }));
          g.path(r.P, g.c.b, { fill: true, fa: 0.5, w: 2, close: true });
          g.arrow(3, 0.2, 3, 1.4, g.c.ink, { w: 2 }).text('build', 3, 1.7, g.c.ink, { a: 'center', s: 10.5 });
        },
        read: (s, p) => { const r = supports(p.ang); return [['support volume', num(r.area, 3) + ' (relative)'], ['build height', num(r.height, 3)], ['layers at 40 µm (unit = 1 cm)', num(r.height * 250, 4)]]; },
        mission: 'Find an orientation that needs no supports at all.',
        goal: (s, p) => supports(p.ang).area < 0.02,
        win: { ang: 180 },
      },
      cards: [
        { q: 'What is the overhang rule in powder bed fusion and why does it exist?', a: 'Down-facing surfaces flatter than about 45° from horizontal need supports, because a new layer has only loose powder under it and will sag, curl or overheat.' },
        { q: 'Why is build orientation the first design-for-AM decision?', a: 'It determines which surfaces overhang, how much support is needed and whether it can be removed, the build height (time), and the direction of weakest properties and roughest finish.' },
      ],
      quiz: [
        { q: 'A horizontal cooling channel must be printed without internal supports. The best cross-section is:', choices: ['A large circle', 'A square', 'A teardrop or diamond', 'A wide flat slot'], answer: 2, why: 'A teardrop’s roof rises at 45° or steeper, so every layer is supported by the one below.' },
        { q: 'Supports inside a sealed internal passage are a problem mainly because:', choices: ['They add weight', 'They cannot be removed after the build', 'They improve cooling', 'They reduce stress'], answer: 1, why: 'With no tool access they stay in place, blocking flow and adding mass.' },
      ],
    },
    {
      id: 'energetics-basics', skill: 'energetics', title: 'Energetic materials: energy is not the point', pre: ['thermo-first-law', 'aero-shocks', 'mech-energy'],
      hook: 'A kilogram of jet fuel holds ten times the energy of a kilogram of high explosive. What separates them is how fast the energy comes out.',
      body: [
        'An **energetic material** carries its fuel and its oxidizer together, so it needs no air and can react as fast as its chemistry allows. Its energy per kilogram is modest. Its **power** is not.',
        'The reaction travels through the material as a front, in one of two regimes.',
        { list: ['**Deflagration**: the front moves by heat conduction, slower than sound in the material, from millimeters to meters per second. This is how propellants burn, and the rate is controllable.', '**Detonation**: the front is a shock wave that compresses and ignites the material as it passes, sustained by the energy released behind it. It is supersonic, several kilometers per second, and produces pressures of tens of gigapascals.'] },
        'Propellants and explosives are therefore engineered for opposite goals: one for steady, predictable burning; the other for a stable detonation.',
        'The dominant engineering concern is **safety**. Sensitivity to impact, friction, heat and static discharge is measured and controlled, and modern **insensitive munitions** are formulated and packaged so that fire, fragment impact or a nearby explosion produces at worst burning, not detonation. Handling of these materials is restricted to trained, licensed organizations; this course treats them at the level of physics only.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'ls', label: 'Reaction front speed', min: -3, max: 4, step: 0.05, v: -2, fmt: v => num(10 ** v, 3) + ' m/s' }],
        draw(g, s, p) {
          const sp = 10 ** p.ls, tt = 0.1 / sp;
          g.view(-3, 4, 0, 1, { pad: [14, 26, 14, 190] });
          g.text('Front speed through a 10 cm charge', -3, 1, g.c.dim, { s: 11, mono: false, b: 'bottom', dy: -4 });
          g.rect(-3, 0.25, 3, 0.5, g.c.b, { fa: 0.25 }).rect(0, 0.25, 3.4, 0.5, g.c.c, { fa: 0.25 }).rect(3.4, 0.25, 0.6, 0.5, g.c.a, { fa: 0.35 });
          g.text('surface burning', -1.5, 0.5, g.c.b, { a: 'center', s: 11 }).text('deflagration (subsonic)', 1.7, 0.5, g.c.c, { a: 'center', s: 11 }).text('detonation', 3.7, 0.12, g.c.a, { a: 'center', s: 11 });
          g.line(3.4, 0.2, 3.4, 0.8, g.c.ink, { w: 1.5, dash: [4, 3] }).text('sound speed in the solid', 3.36, 0.9, g.c.ink, { a: 'right', s: 10.5 });
          g.dot(p.ls, 0.5, g.c.ink, 8, { ring: g.c.panel });
          const items = [['jet fuel (needs air)', 43], ['propellant', 5], ['high explosive', 4.5], ['lithium-ion cell', 0.9]];
          g.view(0, 46, 0, 4, { pad: [150, g.h - 160, 14, 30] }).axes({ xl: 'stored energy (MJ/kg)', yt: false, grid: false });
          items.forEach(([n, e], i) => { g.rect(0, 3.1 - i, e, 0.7, i === 2 ? g.c.a : g.c.dim, { fa: 0.8 }); g.text(n, 0, 3.45 - i, g.c.ink, { a: 'right', dx: -6, s: 11, mono: false }); });
        },
        read: (s, p) => { const sp = 10 ** p.ls, tt = 0.1 / sp; return [['regime', sp >= 2500 ? 'detonation' : sp >= 1 ? 'deflagration' : 'surface burning'], ['time to consume 10 cm', num(tt, 3) + ' s'], ['power from 4.5 MJ/kg', num(4.5e6 / tt, 3) + ' W/kg']]; },
        mission: 'Set a front speed at which the 10 cm charge is consumed in under 50 microseconds, and note the regime.',
        goal: (s, p) => 0.1 / 10 ** p.ls < 50e-6,
        win: { ls: 3.5 },
      },
      cards: [
        { q: 'What distinguishes an energetic material from an ordinary fuel?', a: 'It contains both fuel and oxidizer, so it needs no outside air and can release its (modest) energy extremely fast: high power, not high energy density.' },
        { q: 'Distinguish deflagration from detonation.', a: 'Deflagration: subsonic front driven by heat conduction (mm/s to m/s), as in propellants. Detonation: supersonic shock-driven front (km/s) producing extreme pressure.' },
        { q: 'What is the goal of insensitive munitions design?', a: 'That accidental stimuli (fire, impact, nearby explosion) cause at worst burning, not detonation, protecting crews and platforms.' },
      ],
      quiz: [
        { q: 'A reaction front crosses a 0.2 m charge at 8,000 m/s. How long does it take, in microseconds?', num: 25, unit: 'µs', tol: 0.3, why: '$0.2/8000 = 2.5 × 10^{−5}$ s = 25 µs.' },
        { q: 'Compared with jet fuel, a high explosive has:', choices: ['More energy per kilogram', 'Less energy per kilogram but far higher power', 'The same energy and power', 'No oxidizer'], answer: 1, why: 'About a tenth of the energy per kilogram, released millions of times faster because the oxidizer is built in.' },
      ],
    },
    {
      id: 'energetics-grain', skill: 'energetics', title: 'Solid propellant: burn rate and grain shape', pre: ['energetics-basics', 'prop-nozzle', 'ode-first-order'],
      hook: 'A solid rocket motor has no valves and no throttle. Its thrust profile is decided on the drawing board, by the shape of a hole.',
      body: [
        'A solid propellant burns on its exposed surface, which recedes at a rate that rises with pressure:',
        { eq: 'r = a·P^n', where: 'Saint-Robert’s law; $n$ is the pressure exponent' },
        'Chamber pressure settles where the gas generated by the burning surface equals the gas leaving through the throat. That balance gives',
        { eq: 'P_c ∝ (A_b/A_t)^{1/(1−n)}', where: '$A_b$ = burning area, $A_t$ = throat area' },
        'Two things follow. First, pressure (and thrust) track the **burning area** as the surface recedes, so the grain’s geometry is the thrust program. A cylinder burning from a central hole outward exposes more area as it goes: **progressive**. Burning the ends too shortens it as the hole widens, and the right length makes the two effects cancel: **neutral**.',
        'Second, the exponent matters enormously. As $n$ approaches 1 the power $1/(1−n)$ blows up: a small crack that adds burning area sends pressure soaring. Practical propellants keep $n$ between about 0.2 and 0.6, and cracks and debonds in the grain are the classic cause of motor failure.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'kind', type: 'select', label: 'Grain', v: 'tube', options: [['tube', 'Tube, ends inhibited'], ['bates', 'Tube, ends burning'], ['end', 'End burner']] },
          { k: 'L', label: 'Grain length ÷ outer radius', min: 1, max: 6, step: 0.1, v: 5 },
          { k: 'n', label: 'Pressure exponent n', min: 0.2, max: 0.85, step: 0.05, v: 0.4 },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t = (s.t + dt * 0.25) % 1.2; },
        draw(g, s, p) {
          const r = grain(p), w = min(1, s.t), split = min(g.h, g.w * 0.36);
          g.view(-1.2, 1.2, -1.2, 1.2, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.circle(0, 0, 1, g.c.ink, { w: 2.5, fill: g.c.dim, fa: 0.4 });
          if (p.kind === 'end') g.text('burns from the end face', 0, 0, g.c.ink, { a: 'center', s: 10.5 });
          else { g.circle(0, 0, 0.4 + 0.6 * w, g.c.a, { w: 2.5, fill: g.c.panel, fa: 1 }); g.circle(0, 0, 0.4, g.c.dim, { w: 1, dash: [3, 3] }); }
          g.view(0, 1, 0, max(1.2 * r.hi, 0.1), { pad: [split + 50, 12, 14, 30] }).axes({ xl: 'fraction of web burned', yl: 'chamber pressure (relative)' });
          g.clip(() => g.path(r.pts, g.c.a, { w: 2.5 }));
          if (p.kind !== 'end') g.line(w, 0, w, 1.2 * r.hi, g.c.dim, { w: 1, dash: [3, 3] });
          g.note(r.ratio < 1.25 ? 'neutral' : r.pts[50][1] > r.pts[10][1] ? 'progressive' : 'regressive', 'tr', g.c.ink);
        },
        read: (s, p) => { const r = grain(p); return [['peak ÷ minimum pressure', num(r.ratio, 3)], ['sensitivity 1/(1−n)', num(1 / (1 - p.n), 3)], ['10% more burning area raises pressure by', num((1.1 ** (1 / (1 - p.n)) - 1) * 100, 3) + ' %']]; },
        mission: 'Using the tube with burning ends and an exponent of 0.4 or more, choose a length that keeps peak pressure within 25% of the minimum.',
        goal: (s, p) => p.kind === 'bates' && p.n >= 0.4 && grain(p).ratio < 1.25,
        win: { kind: 'bates', L: 3.4, n: 0.4 },
      },
      cards: [
        { q: 'State the burn-rate law for a solid propellant.', a: '$r = aP^n$ (Saint-Robert’s law): surface regression rate rises with chamber pressure to the power $n$.' },
        { q: 'How does chamber pressure depend on burning area, and why must $n$ be well below 1?', a: '$P_c ∝ (A_b/A_t)^{1/(1−n)}$. As $n → 1$ the exponent diverges, so a small increase in burning area (a crack) causes a runaway pressure rise.' },
        { q: 'What do progressive, neutral and regressive mean for a solid grain?', a: 'Burning area, and so thrust, rises, stays constant, or falls as the grain burns. Grain geometry sets which.' },
      ],
      quiz: [
        { q: 'A propellant has $n$ = 0.5. A crack increases the burning area by 20%. Chamber pressure rises by about:', num: 44, unit: '%', tol: 1.5, why: '$1.2^{1/(1−0.5)} = 1.2^2 = 1.44$: a 44% rise.' },
        { q: 'A hollow cylindrical grain burns only on its inner bore. Its thrust-time curve is:', choices: ['Regressive', 'Neutral', 'Progressive', 'Zero'], answer: 2, why: 'The bore’s circumference grows as it burns outward, so the burning area and thrust increase.' },
      ],
    },
    {
      id: 'dfm-tolerances', skill: 'dfm', title: 'Design for manufacturing: tolerance stacks', pre: ['prob-distributions', 'mc-basics', 'am-design'],
      hook: 'A design that only works when every part is perfect is not finished. Tolerances are where the drawing meets the factory, and where the cost is set.',
      body: [
        'No part is made exactly to size. A drawing gives each dimension a **tolerance**, and when parts are assembled their variations add up: a **tolerance stack**.',
        { list: ['**Worst-case analysis** assumes every part sits at its limit in the bad direction. The assembly variation is the plain sum, $n·t$. It guarantees fit and demands very tight parts.', '**Statistical (RSS) analysis** recognizes that independent variations rarely line up. Standard deviations add in quadrature, so the stack grows only as $√n·t$.'] },
        { eq: 'σ_{stack} = √(σ_1^2 + σ_2^2 + … + σ_n^2)' },
        'The difference is money. Halving a tolerance can double or quadruple the cost of a part: slower machining, more inspection, more scrap. Statistical tolerancing accepts a tiny predicted failure rate in exchange for much looser, cheaper parts, provided the processes are in control and centered.',
        'Other levers reduce the stack itself: fewer parts in the chain, datum schemes that locate from one feature, and adjustment or shimming at assembly. Design for manufacturing is choosing these before the drawing is released.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 't', label: 'Tolerance on each part (±)', min: 0.01, max: 0.2, step: 0.005, v: 0.15, unit: 'mm' },
          { k: 'n', label: 'Parts in the stack', min: 2, max: 10, step: 1, v: 6 },
        ],
        draw(g, s, p) {
          const sg = sqrt(p.n) * p.t / 3, wc = p.n * p.t;
          g.view(-0.8, 0.8, 0, 1.25 / (sg * 2.5066)).axes({ xl: 'assembly gap error (mm)', yt: false });
          g.rect(-0.2, 0, 0.4, 1e3, g.c.good, { fa: 0.12 });
          g.fn(x => gauss(x, 0, sg), g.c.a, { w: 2.5, n: 500 });
          g.line(-0.2, 0, -0.2, 1e3, g.c.good, { w: 1.5 }).line(0.2, 0, 0.2, 1e3, g.c.good, { w: 1.5 });
          g.clip(() => { g.line(-wc, 0, -wc, 1e3, g.c.bad, { w: 1.5, dash: [5, 4] }); g.line(wc, 0, wc, 1e3, g.c.bad, { w: 1.5, dash: [5, 4] }); });
          g.note('spec ±0.20 mm', 'tl', g.c.good).note('worst-case limits', 'tl', g.c.bad, 1).note('statistical prediction', 'tr', g.c.a);
        },
        read: (s, p) => [['worst-case stack', '±' + num(p.n * p.t, 3) + ' mm'], ['statistical 3σ', '±' + num(sqrt(p.n) * p.t, 3) + ' mm'], ['predicted yield', num(yieldOf(p.t, p.n) * 100, 5) + ' %'], ['relative part cost', num(0.1 / p.t, 3)]],
        mission: 'With six parts, find the loosest tolerance (to within 0.01 mm) that still gives 99.7% yield.',
        goal: (s, p) => p.n === 6 && yieldOf(p.t, 6) >= 0.997 && yieldOf(p.t + 0.01, 6) < 0.997,
        win: { t: 0.08, n: 6 },
      },
      cards: [
        { q: 'Contrast worst-case and statistical (RSS) tolerance analysis.', a: 'Worst case adds tolerances linearly ($n·t$), guaranteeing fit but forcing tight, costly parts. RSS adds standard deviations in quadrature (∝ $√n$), allowing looser parts at a small predicted failure rate.' },
        { q: 'Name three ways to reduce a tolerance stack other than tightening tolerances.', a: 'Fewer parts in the chain, better datum schemes (locate from one feature), and adjustment or shimming at assembly.' },
      ],
      quiz: [
        { q: 'Four parts each have σ = 0.02 mm. What is the standard deviation of their stack, in mm?', num: 0.04, unit: 'mm', tol: 0.001, why: '$√(4 × 0.02^2) = 0.04$ mm, not 0.08.' },
        { q: 'Nine parts are each toleranced ±0.03 mm. The worst-case stack is ±0.27 mm. The statistical (RSS) stack is:', num: 0.09, unit: 'mm', tol: 0.002, why: '$√9 × 0.03 = 0.09$ mm: one third of the worst case.' },
      ],
    },
  ],
};
