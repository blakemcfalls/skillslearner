import { num, rng, clamp } from '../sim.js';
const { sin, cos, tan, atan, PI, sqrt, exp, log, abs, max, min, log10 } = Math;
const rad = d => d * PI / 180, deg = r => r * 180 / PI;
const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');

// --- gas processes from state 1: 100 kPa, 1 L, 300 K ---
const GAM = 1.4;
export function proc(kind, V) {
  if (kind === 'iso') return { P: 100 / V, T: 300, W: 100 * log(V), Q: 100 * log(V), dU: 0 };
  if (kind === 'adi') { const P = 100 / V ** GAM, W = (100 - P * V) / (GAM - 1); return { P, T: 300 / V ** (GAM - 1), W, Q: 0, dU: -W }; }
  const W = 100 * (V - 1), dU = W / (GAM - 1); return { P: 100, T: 300 * V, W, Q: W + dU, dU };
}
const pcurve = (kind, V) => (kind === 'iso' ? 100 / V : kind === 'adi' ? 100 / V ** GAM : 100);

// --- cooled chamber wall ---
const MAT = { cu: ['Copper alloy', 390, 800], st: ['Steel', 20, 1100], ni: ['Nickel superalloy', 12, 1250], ce: ['Ceramic', 2, 1900] };
export function wall(p) { const k = MAT[p.mat][1], hg = 2000, hc = 10 ** p.lh, R = 1 / hg + p.L / 1000 / k + 1 / hc, q = 2700 / R; return { q, Twh: 3000 - q / hg, Twc: 300 + q / hc, lim: MAT[p.mat][2] }; }

// --- Brayton cycle ---
export function brayton(p) {
  const k = 0.2857, cp = 1005, T1 = 288, T2 = T1 + (T1 * p.r ** k - T1) / p.eta, T3 = p.tit, T4 = T3 - p.eta * (T3 - T3 / p.r ** k);
  const w = cp * ((T3 - T4) - (T2 - T1)), q = cp * (T3 - T2);
  return { T: [T1, T2, T3, T4], w, q, eff: q > 0 && w > 0 ? w / q : 0, carnot: 1 - T1 / T3 };
}

// --- wing ---
export function wing(al, AR) {
  const a = 2 * PI / (1 + 2 / AR), cl0 = x => a * rad(x + 2);
  const CL = al <= 14 ? cl0(al) : cl0(14) * max(0.3, 1 - 0.07 * (al - 14));
  const CD = 0.02 + CL * CL / (PI * 0.85 * AR) + (al > 14 ? 0.015 * (al - 14) ** 2 : 0);
  return { CL, CD, LD: CL / CD };
}
export const bestLD = AR => { let b = 0; for (let a = -2; a <= 20; a += 0.05) b = max(b, wing(a, AR).LD); return b; };

// --- isentropic flow ---
export const arat = (M, g = 1.4) => (1 / M) * ((2 / (g + 1)) * (1 + (g - 1) / 2 * M * M)) ** ((g + 1) / (2 * (g - 1)));
export function machFromArea(ar, sup, g = 1.4) { let lo = sup ? 1 : 1e-4, hi = sup ? 30 : 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if ((arat(m, g) > ar) === sup) hi = m; else lo = m; } return (lo + hi) / 2; }
const pr = (M, g = 1.4) => (1 + (g - 1) / 2 * M * M) ** (-g / (g - 1)), tr = (M, g = 1.4) => 1 / (1 + (g - 1) / 2 * M * M);

// --- oblique shock ---
const thb = (M, b) => atan(2 / tan(b) * (M * M * sin(b) ** 2 - 1) / (M * M * (GAM + cos(2 * b)) + 2));
export function shock(M, th) {
  const mu = Math.asin(1 / M); let bm = mu, tm = 0;
  for (let b = mu; b <= PI / 2; b += 0.0005) { const t = thb(M, b); if (t > tm) { tm = t; bm = b; } }
  if (rad(th) > tm) return { attached: false, thmax: deg(tm) };
  let lo = mu, hi = bm; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (thb(M, m) < rad(th)) lo = m; else hi = m; }
  const b = (lo + hi) / 2, n1 = M * sin(b), n2 = sqrt((1 + 0.2 * n1 * n1) / (1.4 * n1 * n1 - 0.2)), p = 1 + 2.8 / 2.4 * (n1 * n1 - 1), rho = 2.4 * n1 * n1 / (0.4 * n1 * n1 + 2);
  const p0 = (1.2 * n1 * n1 / (1 + 0.2 * n1 * n1)) ** 3.5 * (1 / (2.8 / 2.4 * n1 * n1 - 0.4 / 2.4)) ** 2.5;
  return { attached: true, beta: deg(b), M2: th > 0 ? n2 / sin(b - rad(th)) : M, p, T: p / rho, p0, thmax: deg(tm) };
}

// --- rocket nozzle, gamma 1.2, chamber 7 MPa ---
const pamb = h => 101325 * exp(-h / 7.4);
export function nozzle(p) {
  const g = 1.2, Me = machFromArea(p.eps, true, g), pe = 7e6 * pr(Me, g), pa = pamb(p.alt);
  const cf = sqrt(2 * g * g / (g - 1) * (2 / (g + 1)) ** ((g + 1) / (g - 1)) * (1 - (pe / 7e6) ** ((g - 1) / g))) + (pe - pa) / 7e6 * p.eps;
  return { Me, pe, pa, cf, isp: cf * 1750 / 9.81 };
}

// --- ideal ramjet and turbojet, T0 = 220 K, Tt4 = 1800 K ---
export function jets(M, pc) {
  const tr0 = 1 + 0.2 * M * M, tl = 1800 / 220, a0 = 297, tc = pc ** 0.2857, tt = 1 - tr0 * (tc - 1) / tl;
  const ram = tl > tr0 ? a0 * M * (sqrt(tl / tr0) - 1) : 0;
  const x = tl / (tr0 * tc) * (tr0 * tc * tt - 1), tj = tt > 0 && x > 0 && tl > tr0 * tc ? max(0, a0 * (sqrt(5 * x) - M)) : 0;
  const isp = (F, Tt3) => (F > 0 && 1800 > Tt3 ? F / (1005 * (1800 - Tt3) / 43e6 * 9.81) : 0);
  return { ram, tj, ispRam: isp(ram, 220 * tr0), ispTj: isp(tj, 220 * tr0 * tc) };
}

export default {
  id: 'u09', title: 'Heat and flow', blurb: 'Thermodynamics, aerodynamics and propulsion.',
  lessons: [
    {
      id: 'thermo-first-law', skill: 'thermo', title: 'Gases, work and the first law', pre: ['mech-energy', 'calc-integral'],
      hook: 'Every engine is a device for moving a gas around a loop on a pressure–volume chart. The area inside the loop is the work you get.',
      body: [
        'An ideal gas obeys $PV = nRT$. The **first law of thermodynamics** is energy conservation for it:',
        { eq: 'ΔU = Q − W', where: '$Q$ = heat added, $W$ = work done by the gas, $U$ = internal energy (∝ temperature)' },
        'Work done by a gas as it expands is $W = ∫P dV$: the area under its path on a P–V diagram. The path matters.',
        { list: ['**Isothermal** (slow, temperature held): $PV$ = constant. All heat added becomes work.', '**Adiabatic** (fast, no heat exchange): $PV^γ$ = constant with $γ$ = 1.4 for air. Compression heats the gas: $T ∝ V^{−(γ−1)}$.', '**Isobaric** (constant pressure): heat goes partly to work and partly to raising temperature.'] },
        'Adiabatic heating is everywhere in this unit: in compressors, in diesel ignition, and in the air rammed to a stop on the nose of a high-speed vehicle.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'kind', type: 'select', label: 'Process', v: 'iso', options: [['iso', 'Isothermal'], ['adi', 'Adiabatic'], ['bar', 'Isobaric']] },
          { k: 'V', label: 'Volume', min: 0.05, max: 2, step: 0.01, v: 0.5, unit: 'L' },
        ],
        draw(g, s, p) {
          const st = proc(p.kind, p.V), split = g.w * 0.3;
          g.view(0, 1, 0, 2.3, { pad: [16, 12, g.w - split, 20] });
          g.rect(0.2, 0, 0.6, 2.2, g.c.dim, { fill: false, stroke: g.c.dim, w: 2 });
          g.rect(0.2, 0, 0.6, p.V, g.hot(clamp((st.T - 200) / 900, 0, 1)), { fa: 0.9 });
          g.rect(0.17, p.V, 0.66, 0.08, g.c.ink).line(0.5, p.V + 0.08, 0.5, 2.25, g.c.ink, { w: 5 });
          g.text(num(st.T, 3) + ' K', 0.5, max(0.06, p.V / 2), g.c.ink, { a: 'center', s: 12, bold: true, bg: true });
          g.view(log10(0.04), log10(2.2), 1, 4, { pad: [split + 50, 12, 14, 30] }).axes({ xl: 'volume (L)', yl: 'pressure (kPa)', xf: v => num(10 ** v, 2), yf: pw, xs: 0.5, ys: 1 });
          ['iso', 'adi', 'bar'].forEach(k => g.fn(lv => log10(pcurve(k, 10 ** lv)), k === p.kind ? g.c.a : g.c.dim, { w: k === p.kind ? 2.5 : 1, dash: k === p.kind ? [] : [4, 4] }));
          g.dot(0, 2, g.c.ink, 4).dot(log10(p.V), clamp(log10(st.P), 1, 4), g.c.a, 6);
          g.note('log–log axes: isotherm slope −1, adiabat slope −1.4', 'tr', g.c.dim);
        },
        read: (s, p) => { const st = proc(p.kind, p.V); return [['pressure', num(st.P, 3) + ' kPa'], ['temperature', num(st.T, 3) + ' K'], ['work by gas', num(st.W, 3) + ' J'], ['heat in', num(st.Q, 3) + ' J'], ['ΔU', num(st.dU, 3) + ' J']]; },
        mission: 'Starting from 300 K, compress the air with no heat exchange until it is hotter than 800 K.',
        goal: (s, p) => p.kind === 'adi' && proc('adi', p.V).T > 800,
        win: { kind: 'adi', V: 0.08 },
      },
      cards: [
        { q: 'State the first law of thermodynamics for a gas and define each term.', a: '$ΔU = Q − W$: the change in internal energy equals heat added minus work done by the gas.' },
        { q: 'What relation holds during an adiabatic process, and what happens to temperature under compression?', a: '$PV^γ$ = constant ($γ$ = 1.4 for air), with no heat exchanged. Temperature rises: $T ∝ V^{−(γ−1)}$.' },
        { q: 'What does the area under a path on a P–V diagram represent?', a: 'The work done by the gas, $W = ∫P dV$ (negative when the gas is compressed).' },
      ],
      quiz: [
        { q: 'Air at 300 K is compressed adiabatically to one tenth of its volume. What is its temperature? ($γ$ = 1.4)', num: 754, unit: 'K', tol: 8, why: '$T_2 = 300 × 10^{0.4} = 300 × 2.512 ≈ 754$ K.' },
        { q: 'A gas absorbs 500 J of heat and does 200 J of work. Its internal energy changes by:', num: 300, unit: 'J', tol: 1, why: '$ΔU = Q − W = 500 − 200 = 300$ J.' },
      ],
    },
    {
      id: 'thermo-heat-transfer', skill: 'thermo', title: 'Heat transfer: three paths and a circuit', pre: ['thermo-first-law', 'ode-first-order', 'eoir-blackbody'],
      hook: 'Rocket chamber gas is hotter than the melting point of every metal. The wall survives because heat leaves it as fast as it arrives.',
      body: [
        'Heat moves in three ways.',
        { list: ['**Conduction** through a solid: $q = k·ΔT/L$. Conductivity $k$ runs from about 400 W/m·K for copper to about 1 for insulating ceramics.', '**Convection** between a surface and a moving fluid: $q = h·ΔT$. The coefficient $h$ depends on the flow and is the hard part to predict.', '**Radiation**: $q = εσT^4$, which you met in the infrared lesson and which dominates at very high temperature.'] },
        'In steady state the same heat flux passes through each layer in turn, exactly like current through resistors in series. Each layer has a **thermal resistance** ($1/h$ or $L/k$), the flux is the total temperature difference over the total resistance, and the temperature drop across each layer is proportional to its resistance.',
        { eq: 'q = (T_{gas} − T_{coolant}) / (1/h_g + L/k + 1/h_c)' },
        'To keep a wall cool you make everything downstream of the hot surface a good conductor: thin wall, high $k$, vigorous coolant flow. That is regenerative cooling, where the propellant itself flows behind the chamber wall.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'mat', type: 'select', label: 'Wall material', v: 'st', options: Object.entries(MAT).map(([k, v]) => [k, `${v[0]} (k = ${v[1]})`]) },
          { k: 'L', label: 'Wall thickness', min: 0.5, max: 10, step: 0.5, v: 5, unit: 'mm' },
          { k: 'lh', label: 'Coolant-side coefficient h_c', min: 3, max: 4.7, step: 0.05, v: 3.3, fmt: v => num(10 ** v, 3) + ' W/m²K' },
        ],
        draw(g, s, p) {
          const w = wall(p);
          g.view(0, 4, 0, 3300).axes({ yl: 'temperature (K)', xt: false, grid: false });
          g.rect(0, 0, 1.5, 3300, g.c.a, { fa: 0.1 }).rect(1.5, 0, 1, 3300, g.c.dim, { fa: 0.3 }).rect(2.5, 0, 1.5, 3300, g.c.b, { fa: 0.1 });
          g.text('hot gas 3000 K', 0.75, 150, g.c.a, { a: 'center', s: 11 }).text('wall', 2, 150, g.c.ink, { a: 'center', s: 11 }).text('coolant 300 K', 3.25, 150, g.c.b, { a: 'center', s: 11 });
          g.line(1.5, w.lim, 2.5, w.lim, g.c.bad, { w: 1.5, dash: [5, 4] }).text('material limit', 2.48, w.lim + 110, g.c.bad, { a: 'right', s: 10.5 });
          g.path([[0, 3000], [1.1, 3000], [1.5, w.Twh], [2.5, w.Twc], [2.9, 300], [4, 300]], g.c.ink, { w: 2.5 });
          g.dot(1.5, w.Twh, w.Twh <= w.lim ? g.c.good : g.c.bad, 6).dot(2.5, w.Twc, g.c.ink, 4);
        },
        read: (s, p) => { const w = wall(p); return [['heat flux', num(w.q / 1e6, 3) + ' MW/m²'], ['hot-side wall', num(w.Twh, 4) + ' K'], ['cold-side wall', num(w.Twc, 4) + ' K'], ['status', w.Twh <= w.lim ? 'within limit' : 'over limit']]; },
        mission: 'Keep the hot-side wall at or below its material limit.',
        goal: (s, p) => { const w = wall(p); return w.Twh <= w.lim; },
        win: { mat: 'cu', L: 1, lh: 4.5 },
      },
      cards: [
        { q: 'Give the heat flux formulas for conduction, convection and radiation.', a: 'Conduction $q = kΔT/L$; convection $q = hΔT$; radiation $q = εσT^4$.' },
        { q: 'How is steady heat flow through several layers like an electric circuit?', a: 'Each layer is a thermal resistance ($L/k$ or $1/h$) in series. Flux = total temperature difference ÷ total resistance, and each layer’s temperature drop is proportional to its resistance.' },
      ],
      quiz: [
        { q: 'A 5 mm steel plate ($k$ = 20 W/m·K) has 100 K across it. What heat flux flows, in kW/m²?', num: 400, unit: 'kW/m²', tol: 4, why: '$q = kΔT/L = 20 × 100/0.005 = 400{,}000$ W/m².' },
        { q: 'To lower the hot-side temperature of a cooled wall, you should:', choices: ['Use a thicker wall', 'Use a less conductive wall', 'Lower the thermal resistance between the hot surface and the coolant', 'Reduce coolant flow'], answer: 2, why: 'Less resistance downstream means more of the temperature drop occurs in the gas-side film and less in the wall.' },
      ],
    },
    {
      id: 'thermo-cycles', skill: 'thermo', title: 'Engine cycles and the second law', pre: ['thermo-first-law', 'thermo-heat-transfer'],
      hook: 'No engine turns all of its heat into work. The second law sets the ceiling, and turbine blade temperature decides how close a jet engine gets.',
      body: [
        'The **second law** says heat flows on its own only from hot to cold, and any engine converting heat to work must reject some heat to a cold sink. The best possible efficiency between a hot source at $T_h$ and a cold sink at $T_c$ is the **Carnot limit**:',
        { eq: 'η_{Carnot} = 1 − T_c/T_h' },
        'Gas turbines and jet engines run the **Brayton cycle**: compress the air, add heat at constant pressure, expand through a turbine, exhaust. For ideal components its efficiency depends only on the pressure ratio $r$:',
        { eq: 'η_{Brayton} = 1 − r^{−(γ−1)/γ}' },
        'Real compressors and turbines lose a little each (their isentropic efficiency is below 1), and because the turbine’s output must first pay for the compressor, small losses cut deeply into the net. Higher turbine inlet temperature widens the margin, which is why so much materials research is spent on turbine blades.',
        '**Entropy** $s$ is the bookkeeping variable for all this: ideal compression and expansion are vertical lines on a temperature–entropy chart; losses lean them to the right.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'r', label: 'Pressure ratio', min: 2, max: 40, step: 0.5, v: 6 },
          { k: 'tit', label: 'Turbine inlet temperature', min: 900, max: 1900, step: 20, v: 1300, unit: 'K' },
          { k: 'eta', label: 'Compressor and turbine efficiency', min: 0.75, max: 1, step: 0.01, v: 0.88 },
        ],
        draw(g, s, p) {
          const b = brayton(p), [T1, T2, T3, T4] = b.T, cp = 1005, R = 287;
          const s2 = cp * log(T2 / T1) - R * log(p.r), s3 = s2 + cp * log(T3 / T2), s4 = s3 + cp * log(T4 / T3) + R * log(p.r);
          g.view(-150, 1400, 150, 2000).axes({ xl: 'entropy s (J/kg·K)', yl: 'temperature (K)' });
          if (T3 > T2) {
            const hi = [], lo = []; for (let i = 0; i <= 30; i++) { const a = s2 + (s3 - s2) * i / 30; hi.push([a, T2 * exp((a - s2) / cp)]); const c = s4 * i / 30; lo.push([c, T1 * exp(c / cp)]); }
            g.clip(() => { g.path([...hi, ...lo.reverse()], g.c.a, { fill: true, fa: 0.15, w: 0, close: true }); g.path(hi, g.c.a, { w: 2.5 }); g.path(lo, g.c.b, { w: 2.5 }); g.line(0, T1, s2, T2, g.c.ink, { w: 2.5 }).line(s3, T3, s4, T4, g.c.ink, { w: 2.5 }); });
            [[0, T1, '1'], [s2, T2, '2'], [s3, T3, '3'], [s4, T4, '4']].forEach(([x, y, n]) => { g.dot(x, y, g.c.ink, 4).text(n, x, y, g.c.ink, { dx: 8, dy: -8, s: 12, bold: true }); });
          } else g.text('compressor exit is hotter than the turbine limit: no heat can be added', 625, 1000, g.c.bad, { a: 'center', s: 12, mono: false });
          g.note('heat in (2→3)', 'tl', g.c.a).note('heat out (4→1)', 'tl', g.c.b, 1);
        },
        read: (s, p) => { const b = brayton(p); return [['thermal efficiency', num(b.eff * 100, 3) + ' %'], ['Carnot limit', num(b.carnot * 100, 3) + ' %'], ['net work', num(b.w / 1000, 3) + ' kJ/kg'], ['compressor exit', num(b.T[1], 4) + ' K']]; },
        mission: 'Reach 40% thermal efficiency with component efficiency no better than 0.90 and turbine inlet no hotter than 1,700 K.',
        goal: (s, p) => p.eta <= 0.9 && p.tit <= 1700 && brayton(p).eff >= 0.4,
        win: { r: 24, tit: 1700, eta: 0.9 },
      },
      cards: [
        { q: 'State the Carnot efficiency limit.', a: '$η = 1 − T_c/T_h$ (absolute temperatures): the highest efficiency any heat engine can reach between those two temperatures.' },
        { q: 'What are the four processes of the Brayton cycle, and what sets its ideal efficiency?', a: 'Compression, constant-pressure heat addition, expansion through a turbine, constant-pressure heat rejection. Ideal efficiency is $1 − r^{−(γ−1)/γ}$, set by pressure ratio alone.' },
        { q: 'Why does raising turbine inlet temperature matter so much in a real gas turbine?', a: 'The turbine must drive the compressor before any net work appears. Hotter gas gives more turbine work per unit of compressor work, widening the margin that component losses eat into.' },
      ],
      quiz: [
        { q: 'An engine operates between 1500 K and 300 K. What is its maximum possible efficiency, in percent?', num: 80, unit: '%', tol: 0.5, why: '$1 − 300/1500 = 0.8$.' },
        { q: 'What is the ideal Brayton efficiency at a pressure ratio of 16? ($γ$ = 1.4, exponent 0.2857) Give percent.', num: 54.7, unit: '%', tol: 0.6, why: '$1 − 16^{−0.2857} = 1 − 0.453 = 0.547$.' },
      ],
    },
    {
      id: 'thermo-bernoulli', skill: 'thermo', title: 'Fluids: continuity and Bernoulli', pre: ['mech-energy', 'calc-vector-fields'],
      hook: 'An aircraft knows its airspeed from two pressure taps and one equation written in 1738.',
      body: [
        'For steady flow in a duct, mass is conserved. If density is constant, what goes in must come out:',
        { eq: 'A_1·v_1 = A_2·v_2', where: 'continuity: a narrower section means faster flow' },
        'Energy is conserved too. Along a streamline of a frictionless, incompressible fluid,',
        { eq: 'p + ½ρv^2 = constant', where: 'Bernoulli’s equation at constant height' },
        'So where the flow speeds up its pressure drops. A **venturi** uses a throat to create a measurable pressure drop; a **pitot tube** brings the flow to rest at a small opening, where the pressure rises by $½ρv^2$, the **dynamic pressure**. Dynamic pressure, usually written $q$, sets the size of every aerodynamic force.',
        'The incompressible form is good to within about 5% up to Mach 0.3. Beyond that, density changes matter and the compressible relations of the coming lessons take over.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'v1', label: 'Inlet speed', min: 5, max: 50, step: 1, v: 10, unit: 'm/s' },
          { k: 'ar', label: 'Throat area ÷ inlet area', min: 0.2, max: 1, step: 0.01, v: 0.6 },
        ],
        init: () => { const r = rng(2); return { pt: Array.from({ length: 70 }, () => [r() * 10, r() * 2 - 1]) }; },
        step(s, p, dt) { s.pt.forEach(q => { q[0] += p.v1 / ductH(q[0], p.ar) * dt * 0.12; if (q[0] > 10) q[0] -= 10; }); },
        draw(g, s, p) {
          g.view(0, 10, -2.2, 2.2, { pad: [10, 10, 10, 10] });
          const top = [], bot = []; for (let x = 0; x <= 10; x += 0.1) { top.push([x, ductH(x, p.ar)]); bot.push([x, -ductH(x, p.ar)]); }
          g.path([...top, ...bot.reverse()], g.c.b, { fill: true, fa: 0.1, w: 0, close: true }).path(top, g.c.ink, { w: 2.5 }).path(bot.reverse(), g.c.ink, { w: 2.5 });
          s.pt.forEach(q => { const h = ductH(q[0], p.ar); g.dot(q[0], q[1] * h * 0.9, g.c.b, 2.2); });
          const dp = 0.6125 * p.v1 * p.v1 * (1 / (p.ar * p.ar) - 1);
          [[2, 0], [5, dp]].forEach(([x, d]) => { const h = ductH(x, p.ar); g.line(x, h, x, 2.0, g.c.dim, { w: 6 }); g.line(x, h, x, h + max(0.05, (2.0 - h) * (1 - min(1, d / 4000))), g.c.a, { w: 6 }); });
          g.text('pressure gauges', 3.5, 2.05, g.c.dim, { a: 'center', s: 10.5 }).arrow(0.3, 0, 1.3, 0, g.c.ink, { w: 2 });
        },
        read: (s, p) => { const v2 = p.v1 / p.ar; return [['throat speed', num(v2, 3) + ' m/s'], ['pressure drop at throat', num(0.6125 * (v2 * v2 - p.v1 * p.v1), 4) + ' Pa'], ['inlet dynamic pressure', num(0.6125 * p.v1 * p.v1, 3) + ' Pa']]; },
        mission: 'With a 20 m/s inlet, size the throat for a 2,000 Pa pressure drop (±100 Pa).',
        goal: (s, p) => p.v1 === 20 && abs(0.6125 * p.v1 * p.v1 * (1 / (p.ar * p.ar) - 1) - 2000) < 100,
        win: { v1: 20, ar: 0.33 },
      },
      cards: [
        { q: 'State the continuity equation and Bernoulli’s equation for incompressible flow at constant height.', a: 'Continuity: $A_1v_1 = A_2v_2$. Bernoulli: $p + ½ρv^2$ = constant along a streamline.' },
        { q: 'What is dynamic pressure and how does a pitot tube use it?', a: '$q = ½ρv^2$. A pitot tube stops the flow at its opening, where pressure rises by $q$ above static pressure; the difference gives airspeed.' },
      ],
      quiz: [
        { q: 'Air (ρ = 1.225 kg/m³) flows at 100 m/s. What is its dynamic pressure in Pa?', num: 6125, unit: 'Pa', tol: 60, why: '$½ × 1.225 × 100^2 = 6125$ Pa.' },
        { q: 'A duct narrows to one third of its area. The flow speed in the narrow section is:', choices: ['One third', 'The same', 'Three times higher', 'Nine times higher'], answer: 2, why: 'Continuity: $v_2 = v_1A_1/A_2 = 3v_1$.' },
      ],
    },
    {
      id: 'aero-lift-drag', skill: 'aero', title: 'Lift, drag and the drag polar', pre: ['thermo-bernoulli', 'calc-vector-fields', 'opt-lagrange'],
      hook: 'Range, endurance, glide distance and turn performance all come from one curve: lift coefficient against drag coefficient.',
      body: [
        'Aerodynamic forces scale with dynamic pressure and wing area, so they are written with dimensionless coefficients:',
        { eq: 'L = ½ρv^2·S·C_L,   D = ½ρv^2·S·C_D' },
        '$C_L$ rises almost linearly with **angle of attack** until the flow separates from the upper surface and the wing **stalls**. Drag has two parts: a baseline (friction and form) and **induced drag**, the price of making lift with a finite wing:',
        { eq: 'C_D = C_{D0} + C_L^2/(π·e·AR)', where: '$AR$ = aspect ratio (span²/area), $e$ ≈ 0.85' },
        'Plot $C_L$ against $C_D$ and you get the **drag polar**. The line from the origin that just touches it marks the best **lift-to-drag ratio**, which sets glide angle and cruise range. Long slender wings (high $AR$) cut induced drag, which is why gliders and long-endurance aircraft look the way they do.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'al', label: 'Angle of attack', min: -4, max: 20, step: 0.25, v: 2, unit: '°' },
          { k: 'AR', label: 'Aspect ratio', min: 2, max: 20, step: 1, v: 8 },
        ],
        draw(g, s, p) {
          const w = wing(p.al, p.AR), split = g.w * 0.44, a = rad(-p.al);
          g.view(-1.2, 1.4, -1, 1, { eq: true, pad: [8, 8, g.w - split, 8] });
          for (let y = -0.8; y <= 0.81; y += 0.2) g.arrow(-1.2, y, -0.75, y, g.c.dim, { w: 1, head: 5, alpha: 0.6 });
          const foil = []; for (let i = 0; i <= 40; i++) { const x = i / 40, t = 0.6 * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4); foil.push([x, t]); }
          const shape = [...foil, ...foil.slice().reverse().map(([x, t]) => [x, -t * 0.7])].map(([x, y]) => { const cx = x - 0.3; return [cx * cos(a) - y * sin(a), cx * sin(a) + y * cos(a)]; });
          g.path(shape, p.al > 14 ? g.c.bad : g.c.ink, { fill: true, fa: 0.25, w: 2, close: true });
          g.arrow(0, 0, 0, clamp(w.CL * 0.55, -0.9, 0.9), g.c.b, { w: 3 }).arrow(0, 0, clamp(w.CD * 4, 0, 1.3), 0, g.c.a, { w: 3 });
          if (p.al > 14) g.text('stalled', 0.2, -0.7, g.c.bad, { a: 'center', s: 12, bold: true });
          g.view(0, 0.3, -0.4, 1.8, { pad: [split + 46, 12, 14, 30] }).axes({ xl: 'C_D', yl: 'C_L' });
          const pol = []; for (let x = -4; x <= 20; x += 0.25) { const q = wing(x, p.AR); pol.push([q.CD, q.CL]); }
          const bl = bestLD(p.AR);
          g.clip(() => { g.path(pol, g.c.ink, { w: 2 }); g.line(0, 0, 0.3, 0.3 * bl, g.c.good, { w: 1.2, dash: [5, 4] }); });
          g.dot(min(0.3, w.CD), clamp(w.CL, -0.4, 1.8), g.c.a, 6);
          g.note('lift', 'tl', g.c.b).note('drag', 'tl', g.c.a, 1).note('best L/D tangent', 'br', g.c.good);
        },
        read: (s, p) => { const w = wing(p.al, p.AR); return [['C_L', num(w.CL, 3)], ['C_D', num(w.CD, 3)], ['L/D', num(w.LD, 3)], ['best possible L/D', num(bestLD(p.AR), 3)]]; },
        mission: 'With aspect ratio 8, find the angle of attack that gives the best lift-to-drag ratio (within 0.5%).',
        goal: (s, p) => p.AR === 8 && wing(p.al, 8).LD >= 0.995 * bestLD(8),
        win: { al: 5.5, AR: 8 },
      },
      cards: [
        { q: 'Write the lift equation and say what $C_L$ depends on.', a: '$L = ½ρv^2 S C_L$. $C_L$ rises roughly linearly with angle of attack until stall, and depends on wing shape.' },
        { q: 'Write the drag polar and name its two terms.', a: '$C_D = C_{D0} + C_L^2/(πeAR)$: zero-lift (parasite) drag plus induced drag, the drag due to producing lift with a finite wing.' },
        { q: 'Why do high-endurance aircraft have long, slender wings?', a: 'High aspect ratio reduces induced drag ($∝ 1/AR$), raising the maximum lift-to-drag ratio and therefore range and endurance.' },
      ],
      quiz: [
        { q: 'An aircraft doubles its airspeed at the same altitude and angle of attack. Lift changes by a factor of:', num: 4, tol: 0.04, why: 'Lift ∝ $v^2$.' },
        { q: 'A glider has a best L/D of 40. From 1 km altitude in still air it can glide about:', num: 40, unit: 'km', tol: 0.5, why: 'Glide ratio equals L/D: 40 km forward per km of height.' },
      ],
    },
    {
      id: 'aero-compressible', skill: 'aero', title: 'Compressible flow and the Mach number', pre: ['thermo-bernoulli', 'thermo-first-law', 'num-root-finding'],
      hook: 'To make gas go supersonic you first squeeze the passage and then, against all low-speed intuition, open it up again.',
      body: [
        'Sound is how a fluid passes pressure information, at speed $a = √(γRT)$. The **Mach number** $M = v/a$ compares flow speed with it. Below about $M$ = 0.3 density is nearly constant; above it the gas compresses and Bernoulli’s simple form fails.',
        'Bring a moving gas to rest without losses and it reaches its **stagnation** (total) temperature and pressure:',
        { eq: 'T_0/T = 1 + ((γ−1)/2)·M^2,   p_0/p = (T_0/T)^{γ/(γ−1)}' },
        'Now the surprise. In subsonic flow a narrowing duct speeds the gas up. In supersonic flow it is the reverse: the gas accelerates when the duct **widens**, because density falls faster than velocity rises. The crossover, $M$ = 1, can only occur at the narrowest point.',
        'Hence the **converging–diverging nozzle** on every rocket and supersonic wind tunnel. The exit Mach number is fixed by one number: exit area over throat area, $A/A^*$.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'ar', label: 'Exit area ÷ throat area', min: 1, max: 30, step: 0.05, v: 2 },
          { k: 'sup', type: 'toggle', label: 'Supersonic branch (enough pressure to drive it)', v: true },
        ],
        draw(g, s, p) {
          const Mx = x => { const A = x < 3 ? 1 + 2.2 * ((3 - x) / 3) ** 2 : 1 + (p.ar - 1) * ((x - 3) / 7) ** 1.3; return [A, machFromArea(max(1.0001, A), x >= 3 && p.sup)]; };
          const rmax = sqrt(max(p.ar, 3.2));
          g.view(0, 10, -rmax * 1.1, rmax * 1.1, { pad: [10, 10, 10, 130] });
          for (let i = 0; i < 100; i++) { const x = i / 10 + 0.05, [A, M] = Mx(x), r = sqrt(A); g.rect(i / 10, -r, 0.105, 2 * r, g.hot(clamp(M / 5, 0, 1)), { fa: 0.95 }); }
          const top = []; for (let x = 0; x <= 10.01; x += 0.1) top.push([x, sqrt(Mx(x)[0])]);
          g.path(top, g.c.ink, { w: 2.5 }).path(top.map(([x, y]) => [x, -y]), g.c.ink, { w: 2.5 });
          g.line(3, -rmax, 3, rmax, g.c.dim, { w: 1, dash: [4, 4] }).text('throat  M = 1', 3.1, -rmax * 0.95, g.c.ink, { s: 11, bg: true });
          g.view(0, 10, 0, 1.05, { pad: [44, g.h - 116, 14, 30] }).axes({ xl: 'distance along nozzle', yl: 'ratio to chamber value', xt: false });
          g.fn(x => pr(Mx(x)[1]), g.c.b, { w: 2 }).fn(x => tr(Mx(x)[1]), g.c.a, { w: 2 });
          g.note('T/T₀', 'tr', g.c.a).note('p/p₀', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const M = machFromArea(max(1.0001, p.ar), p.sup); return [['exit Mach', num(M, 3)], ['exit p/p₀', num(pr(M), 3)], ['exit T/T₀', num(tr(M), 3)]]; },
        mission: 'Size the nozzle exit to deliver Mach 3.0 (±0.03).',
        goal: (s, p) => p.sup && abs(machFromArea(max(1.0001, p.ar), true) - 3) < 0.03,
        win: { ar: 4.25, sup: true },
      },
      cards: [
        { q: 'Give the speed of sound in a gas and define Mach number.', a: '$a = √(γRT)$; $M = v/a$.' },
        { q: 'Why does a supersonic nozzle have a converging section followed by a diverging one?', a: 'Subsonic flow accelerates in a converging passage and reaches Mach 1 at the throat. Supersonic flow accelerates in a diverging passage, because density falls faster than velocity rises.' },
        { q: 'Write the stagnation temperature relation.', a: '$T_0/T = 1 + ((γ−1)/2)M^2$. For air, $T_0/T = 1 + 0.2M^2$.' },
      ],
      quiz: [
        { q: 'Air at 220 K static temperature flows at Mach 5. What is its stagnation temperature? ($γ$ = 1.4, ideal gas)', num: 1320, unit: 'K', tol: 14, why: '$T_0 = 220 × (1 + 0.2 × 25) = 220 × 6 = 1320$ K. This is why high-Mach flight is a heating problem.' },
        { q: 'A supersonic flow enters a duct that narrows. The flow:', choices: ['Speeds up', 'Slows down', 'Is unaffected', 'Reverses'], answer: 1, why: 'For $M > 1$ the area–velocity relation flips: converging passages decelerate supersonic flow.' },
      ],
    },
    {
      id: 'aero-shocks', skill: 'aero', title: 'Shock waves', pre: ['aero-compressible', 'thermo-cycles'],
      hook: 'A supersonic vehicle arrives before its own warning. The air cannot move aside smoothly, so it adjusts in a jump a few molecules thick.',
      body: [
        'In supersonic flow, pressure signals cannot travel upstream. When the flow meets an obstacle it adjusts abruptly through a **shock wave**: a surface across which pressure, density and temperature jump up and speed drops.',
        'A **normal shock** stands square to the flow and always leaves it subsonic. A wedge or cone turning the flow by an angle $θ$ creates an **oblique shock** at an angle $β$, weaker and usually leaving the flow still supersonic. $θ$, $β$ and Mach number are tied by one relation, solved numerically in the lab.',
        'Shocks are irreversible: entropy rises and **stagnation pressure is lost**, which is lost thrust for an engine inlet. Several weak oblique shocks lose far less than one strong normal shock, which is why supersonic inlets use ramps and spikes.',
        'For each Mach number there is a largest turning angle an attached shock can manage. Beyond it the shock **detaches** and stands off as a curved bow wave with a strong, nearly normal center. Blunt noses always have detached shocks, and the next unit shows why that is sometimes exactly what you want.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'M', label: 'Upstream Mach number', min: 1.2, max: 8, step: 0.1, v: 2 },
          { k: 'th', label: 'Wedge half-angle θ', min: 0, max: 45, step: 0.5, v: 10, unit: '°' },
        ],
        draw(g, s, p) {
          const k = shock(p.M, p.th), t = rad(p.th);
          g.view(-4, 6, -3.5, 3.5, { eq: true, pad: [8, 8, 8, 8] });
          g.path([[0, 0], [6, 6 * tan(t)], [6, -6 * tan(t)]], g.c.dim, { fill: true, fa: 0.5, w: 2, close: true });
          for (let y = -3; y <= 3.01; y += 0.6) {
            if (abs(y) < 0.05) continue;
            if (k.attached) { const b = rad(k.beta), xs = abs(y) / tan(b); g.path([[-4, y], [xs, y], [6, y + Math.sign(y) * (6 - xs) * tan(t)]], g.c.b, { w: 1.2 }); }
            else { const xs = -0.9 + 0.12 * y * y; g.path([[-4, y], [xs, y], [6, y + Math.sign(y) * (0.6 + (6 - xs) * tan(t) * 0.8)]], g.c.b, { w: 1.2 }); }
          }
          if (k.attached) { const b = rad(k.beta); g.line(0, 0, 6, 6 * tan(b), g.c.a, { w: 3 }).line(0, 0, 6, -6 * tan(b), g.c.a, { w: 3 }); }
          else { const bow = []; for (let y = -3.5; y <= 3.5; y += 0.1) bow.push([-0.9 + 0.12 * y * y, y]); g.path(bow, g.c.bad, { w: 3 }); g.text('detached bow shock', -3.8, 3.1, g.c.bad, { s: 12, bold: true, bg: true }); }
          g.note('shock', 'tr', g.c.a).note('streamlines', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const k = shock(p.M, p.th); return k.attached ? [['shock angle β', num(k.beta, 3) + '°'], ['Mach behind shock', num(k.M2, 3)], ['pressure ratio', num(k.p, 3)], ['temperature ratio', num(k.T, 3)], ['stagnation pressure kept', num(k.p0 * 100, 3) + ' %']] : [['shock', 'detached'], ['largest attached angle', num(k.thmax, 3) + '°']]; },
        mission: 'At Mach 3.0, find the largest wedge half-angle (to the nearest 0.5°) that still keeps the shock attached.',
        goal: (s, p) => abs(p.M - 3) < 0.01 && shock(3, p.th).attached && !shock(3, p.th + 0.5).attached,
        win: { M: 3, th: 34 },
      },
      cards: [
        { q: 'What changes across a shock wave?', a: 'Pressure, density and temperature jump up; velocity and Mach number drop; entropy rises and stagnation pressure is lost. Stagnation temperature is unchanged.' },
        { q: 'Why do supersonic inlets use several oblique shocks instead of one normal shock?', a: 'A series of weak oblique shocks slows the flow with far less stagnation-pressure loss than a single strong normal shock, preserving thrust.' },
        { q: 'When does a shock detach from a wedge?', a: 'When the wedge angle exceeds the maximum turning angle for that Mach number. The shock then stands off as a curved bow wave with a near-normal center.' },
      ],
      quiz: [
        { q: 'After a normal shock, the flow is always:', choices: ['Supersonic', 'Subsonic', 'Sonic', 'At rest'], answer: 1, why: 'A normal shock takes any supersonic flow to subsonic. Stronger shocks give lower downstream Mach numbers.' },
        { q: 'Across any shock in an ideal gas, which quantity stays constant?', choices: ['Stagnation pressure', 'Static temperature', 'Stagnation temperature', 'Entropy'], answer: 2, why: 'No heat is added or removed, so total enthalpy and stagnation temperature are conserved. Stagnation pressure falls.' },
      ],
    },
    {
      id: 'prop-nozzle', skill: 'prop', title: 'Thrust, specific impulse and nozzle expansion', pre: ['aero-compressible', 'prop-rocket-eq', 'mech-momentum'],
      hook: 'A booster engine and a vacuum engine burn the same propellants. They look nothing alike, because the nozzle has to match the air outside.',
      body: [
        'A rocket’s thrust has a momentum part and a pressure part:',
        { eq: 'F = ṁ·v_e + (p_e − p_a)·A_e', where: '$p_e$ = exhaust pressure at the nozzle exit, $p_a$ = ambient pressure' },
        'The nozzle converts chamber pressure into exhaust velocity. A larger **expansion ratio** (exit area ÷ throat area) expands the gas further: higher $v_e$, lower $p_e$.',
        { list: ['$p_e > p_a$ **underexpanded**: energy that could have become velocity is wasted in a plume that balloons outside the nozzle.', '$p_e = p_a$ **ideally expanded**: maximum thrust for that altitude.', '$p_e < p_a$ **overexpanded**: ambient pressure squeezes the exhaust, the pressure term is negative, and the flow can separate from the wall.'] },
        'Since $p_a$ falls with altitude, one nozzle cannot be ideal everywhere. First stages use modest ratios; upper stages use enormous ones.',
        '**Specific impulse** $I_{sp} = F/(ṁ·g_0)$ is thrust per unit of propellant weight flow, in seconds. It is the exhaust-velocity term of the rocket equation.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'eps', label: 'Expansion ratio', min: 2, max: 100, step: 0.5, v: 8 },
          { k: 'alt', label: 'Altitude', min: 0, max: 50, step: 1, v: 0, unit: 'km' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt; },
        draw(g, s, p) {
          const n = nozzle(p), re = sqrt(p.eps) * 0.22, k = clamp(log(n.pe / n.pa) * 0.22, -0.5, 0.9);
          g.view(-1, 9, -3, 3, { eq: true, pad: [8, 8, 8, 8] });
          g.path([[-1, 0.9], [0.4, 0.9], [1, 0.22], [3, re], [3, -re], [1, -0.22], [0.4, -0.9], [-1, -0.9]], g.c.dim, { fill: true, fa: 0.35, w: 2.5, close: true });
          const pl = []; for (let x = 3; x <= 9; x += 0.2) pl.push([x, max(0.05, re * (1 + k * (1 - Math.exp(-(x - 3) / 1.5))) * (1 + 0.05 * sin((x - 3) * 3 - s.t * 8) * abs(k) * 2))]);
          g.path([...pl, ...pl.slice().reverse().map(([x, y]) => [x, -y])], g.c.a, { fill: true, fa: 0.3, w: 1.5, close: true });
          g.text(abs(n.pe / n.pa - 1) < 0.1 ? 'ideally expanded' : n.pe > n.pa ? 'underexpanded: plume balloons' : 'overexpanded: plume pinched', 5, 2.6, abs(n.pe / n.pa - 1) < 0.1 ? g.c.good : g.c.ink, { a: 'center', s: 12, bold: true });
          g.text('chamber 7 MPa', -0.3, 0, g.c.ink, { a: 'center', s: 10.5 });
        },
        read: (s, p) => { const n = nozzle(p); return [['exit Mach', num(n.Me, 3)], ['exit pressure', num(n.pe / 1000, 3) + ' kPa'], ['ambient pressure', num(n.pa / 1000, 3) + ' kPa'], ['specific impulse', num(n.isp, 4) + ' s']]; },
        mission: 'At 10 km altitude, choose the expansion ratio that expands the exhaust to ambient pressure (within 10%).',
        goal: (s, p) => p.alt === 10 && abs(nozzle(p).pe / nozzle(p).pa - 1) < 0.1,
        win: { eps: 25, alt: 10 },
      },
      cards: [
        { q: 'Write the rocket thrust equation with both terms.', a: '$F = ṁv_e + (p_e − p_a)A_e$: momentum thrust plus pressure thrust.' },
        { q: 'What are under-, ideally and over-expanded nozzles?', a: 'Exit pressure above, equal to, or below ambient. Ideal expansion ($p_e = p_a$) gives the most thrust at that altitude; overexpansion risks flow separation.' },
        { q: 'Define specific impulse.', a: '$I_{sp} = F/(ṁg_0)$, in seconds: thrust per unit weight flow of propellant. Effective exhaust velocity is $g_0I_{sp}$.' },
      ],
      quiz: [
        { q: 'An engine produces 500 kN while burning 170 kg/s. What is its specific impulse in seconds? ($g_0$ = 9.81)', num: 300, unit: 's', tol: 3, why: '$500{,}000/(170 × 9.81) ≈ 300$ s.' },
        { q: 'Why do upper-stage engines have much larger nozzles than first-stage engines?', choices: ['They burn more propellant', 'In near-vacuum the exhaust can be expanded much further before reaching ambient pressure', 'They need to be heavier', 'To reduce noise'], answer: 1, why: 'With ambient pressure near zero, a larger expansion ratio keeps converting pressure into velocity without overexpansion.' },
      ],
    },
    {
      id: 'prop-jets', skill: 'prop', title: 'Air-breathing engines: turbojet to ramjet', pre: ['thermo-cycles', 'aero-shocks', 'prop-nozzle'],
      hook: 'An air-breather carries only fuel and takes its oxidizer from the sky. That is worth a factor of ten in specific impulse, inside a limited band of speed.',
      body: [
        'A jet engine makes thrust by speeding up the air passing through it: $F ≈ ṁ_{air}·(v_{exit} − v_{flight})$. It must raise the air’s pressure before burning fuel, and there are two ways to do it.',
        { list: ['A **turbojet** uses a compressor driven by a turbine. It works from a standstill, but its turbine limits the gas temperature.', 'A **ramjet** has no moving parts. At high speed the inlet’s shocks compress the air (ram compression): stagnation pressure rises steeply with Mach number. It gives no static thrust and needs a booster to start.'] },
        'As flight Mach number rises, ram compression does more of the work. The compressor adds less and less, and eventually just adds heat the turbine cannot stand. Somewhere between Mach 2 and 3 the ramjet overtakes the turbojet.',
        'Above about Mach 5, slowing the air to subsonic speed for combustion would heat it past the point where fuel can add useful energy. A **scramjet** burns the fuel in a supersonic stream instead, with only milliseconds to mix and ignite.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'M', label: 'Flight Mach number', min: 0, max: 6, step: 0.05, v: 0.8 },
          { k: 'pc', label: 'Turbojet compressor pressure ratio', min: 4, max: 30, step: 1, v: 10 },
        ],
        draw(g, s, p) {
          g.view(0, 6, 0, 1250).axes({ xl: 'flight Mach number', yl: 'specific thrust (N per kg/s of air)' });
          g.fn(M => jets(M, p.pc).tj, g.c.b, { w: 2.5, n: 300 }).fn(M => jets(M, p.pc).ram, g.c.a, { w: 2.5, n: 300 });
          const j = jets(p.M, p.pc);
          g.line(p.M, 0, p.M, 1250, g.c.dim, { w: 1, dash: [4, 4] }).dot(p.M, j.tj, g.c.b, 5).dot(p.M, j.ram, g.c.a, 5);
          g.note('turbojet', 'tr', g.c.b).note('ramjet', 'tr', g.c.a, 1).note('ideal cycles, 1,800 K burner exit, 220 K air', 'bl', g.c.dim);
        },
        read: (s, p) => { const j = jets(p.M, p.pc); return [['turbojet', num(j.tj, 3) + ' N·s/kg'], ['ramjet', num(j.ram, 3) + ' N·s/kg'], ['turbojet I_sp', j.ispTj ? num(j.ispTj, 3) + ' s' : '–'], ['ramjet I_sp', j.ispRam ? num(j.ispRam, 3) + ' s' : '–']]; },
        mission: 'With a compressor pressure ratio of 10, find the Mach number where the ramjet’s specific thrust overtakes the turbojet’s (within 0.1).',
        goal: (s, p) => p.pc === 10 && p.M > 0.5 && (jets(p.M - 0.1, 10).ram - jets(p.M - 0.1, 10).tj) * (jets(p.M + 0.1, 10).ram - jets(p.M + 0.1, 10).tj) <= 0,
        win: { M: 2.3, pc: 10 },
      },
      cards: [
        { q: 'How does a ramjet compress air, and what is its main limitation?', a: 'By ram compression: the inlet slows high-speed air, raising its pressure, with no moving parts. It produces no thrust at rest and must be boosted to operating speed.' },
        { q: 'Why does a ramjet eventually outperform a turbojet as Mach number rises?', a: 'Ram compression supplies the pressure rise on its own; a compressor then adds mostly temperature, leaving less room for combustion heat below the turbine limit.' },
        { q: 'What is a scramjet and why is it needed above about Mach 5?', a: 'A ramjet whose combustion takes place in supersonic flow. Slowing hypersonic air to subsonic speed would make it too hot for combustion to add useful energy and would cause large pressure losses.' },
      ],
      quiz: [
        { q: 'An engine passes 50 kg/s of air, taking it in at 250 m/s and exhausting it at 850 m/s. What is its thrust in kN (ignoring fuel mass)?', num: 30, unit: 'kN', tol: 0.3, why: '$F = ṁ(v_e − v_0) = 50 × 600 = 30{,}000$ N.' },
        { q: 'Why do air-breathing engines have much higher specific impulse than rockets?', choices: ['They burn hotter', 'They carry only fuel and take oxidizer from the atmosphere', 'They have larger nozzles', 'They are lighter'], answer: 1, why: 'Specific impulse counts only carried propellant. Most of an air-breather’s reaction mass is free air.' },
      ],
    },
  ],
};

function ductH(x, ar) { return 1 - (1 - ar) * exp(-(((x - 5) / 1.5) ** 2)); }
