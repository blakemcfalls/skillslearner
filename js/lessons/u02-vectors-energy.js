import { tracer, num, clamp } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, log, sign, cbrt } = Math;
const rad = d => d * PI / 180;

// --- energy track: a double well with a 5 m hill in the middle ---
const B = 3.5, A = 5 / B ** 4, G = 9.81;
const ty = x => A * (x * x - B * B) ** 2, tdy = x => 4 * A * x * (x * x - B * B);
export function trackStep(s, mu, dt) {
  const n = 12, h = dt / n;
  for (let i = 0; i < n; i++) {
    const m = tdy(s.x), c = 1 / sqrt(1 + m * m), sn = m * c;
    let a = -G * sn;
    if (abs(s.v) < 0.02 && abs(G * sn) <= mu * G * c) { s.v = 0; continue; }
    a -= mu * G * c * sign(s.v || -sn);
    const v2 = s.v + a * h;
    if (s.v !== 0 && sign(v2) !== sign(s.v) && abs(G * sn) <= mu * G * c) { s.v = 0; continue; }
    s.heat += mu * G * c * abs(s.v) * h;
    s.v = v2; s.x += s.v * c * h;
  }
}
const trackE = s => G * ty(s.x) + 0.5 * s.v * s.v;

// --- Taylor coefficients ---
const fact = k => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
const TAY = {
  sin: { f: sin, c: k => [0, 1, 0, -1][k % 4] / fact(k), label: 'sin x' },
  cos: { f: cos, c: k => [1, 0, -1, 0][k % 4] / fact(k), label: 'cos x' },
  exp: { f: exp, c: k => 1 / fact(k), label: 'eˣ' },
  ln: { f: x => (x > -1 ? log(1 + x) : NaN), c: k => (k === 0 ? 0 : (k % 2 ? 1 : -1) / k), label: 'ln(1 + x)', R: 1 },
  geo: { f: x => (abs(x - 1) < 1e-9 ? NaN : 1 / (1 - x)), c: () => 1, label: '1/(1 − x)', R: 1 },
};
const taylor = (key, n, x) => { let s = 0; for (let k = n; k >= 0; k--) s = s * x + TAY[key].c(k); return s; };
export function taylorErr(key, n) {
  let e = 0;
  for (let i = 0; i <= 200; i++) { const x = -PI + 2 * PI * i / 200, d = abs(taylor(key, n, x) - TAY[key].f(x)); if (!(d <= 1e9)) return Infinity; e = Math.max(e, d); }
  return e;
}

// --- root finding on f(x) = x^3 - 2x + 2 ---
const rf = x => x ** 3 - 2 * x + 2, rdf = x => 3 * x * x - 2;
export function iterate(method, x0, k) {
  const xs = [];
  if (method === 'newton') { let x = x0; xs.push(x); for (let i = 0; i < k; i++) { const d = rdf(x); x = abs(d) < 1e-9 ? x + 0.1 : x - rf(x) / d; xs.push(x); } }
  else { let a = -3, b = 3; xs.push([a, b]); for (let i = 0; i < k; i++) { const m = (a + b) / 2; if (rf(a) * rf(m) <= 0) b = m; else a = m; xs.push([a, b]); } }
  return xs;
}
const lastX = (m, xs) => (m === 'newton' ? xs[xs.length - 1] : (xs[xs.length - 1][0] + xs[xs.length - 1][1]) / 2);

// --- testing lab: saturation function, mutants and candidate tests ---
const TESTS = [[0.5, 1, 0.5], [5, 1, 1], [-5, 1, -1], [0, 1, 0], [3, 2, 2], [-0.2, 2, -0.2]];
const MUT = [
  ['no lower limit', (u, L) => Math.min(L, u)],
  ['no upper limit', (u, L) => Math.max(-L, u)],
  ['any positive input → limit', (u, L) => (u > 0 ? L : Math.max(-L, u))],
  ['limit hard-coded to 1', u => Math.max(-1, Math.min(1, u))],
];
const caught = p => MUT.map(([, f]) => TESTS.some(([u, L, want], i) => p['t' + i] && f(u, L) !== want));

export default {
  id: 'u02', title: 'Vectors and energy', blurb: 'Linear algebra, conservation laws and the rocket equation.',
  lessons: [
    {
      id: 'linalg-vectors', skill: 'linalg', title: 'Vectors, dot products and projection', pre: ['mech-kinematics'],
      hook: 'A Doppler radar measures only the part of a target’s velocity that points along the line of sight. That part is a dot product.',
      body: [
        'A vector carries magnitude and direction. The **dot product** measures how much of one vector lies along another: $a·b = |a||b|cos θ = a_x b_x + a_y b_y$.',
        'Dividing by $|b|$ gives the **projection**: the length of $a$’s shadow on the direction of $b$. With a unit vector $r̂$ the projection is simply $a·r̂$. Perpendicular vectors have a dot product of zero.',
        'In the lab, a radar at the origin looks along the line of sight $r̂$ to a target. The radar’s Doppler shift reveals $v·r̂$ only. The cross-range part of the velocity is invisible to it, which is why an aircraft flying perpendicular to the beam can drop out of a Doppler filter.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'hdg', label: 'Target heading', min: 0, max: 359, step: 1, v: 200, unit: '°' },
          { k: 'spd', label: 'Target speed', min: 0, max: 300, step: 5, v: 250, unit: 'm/s' },
        ],
        draw(g, s, p) {
          g.view(-1, 11, -1.5, 7.5, { eq: true, pad: [10, 10, 10, 10] });
          const rx = cos(rad(30)), ry = sin(rad(30)), tx = 8 * rx, ty2 = 8 * ry;
          const vx = p.spd / 100 * cos(rad(p.hdg)), vy = p.spd / 100 * sin(rad(p.hdg));
          const vr = vx * rx + vy * ry;
          g.line(0, 0, 11 * rx, 11 * ry, g.c.dim, { w: 1, dash: [6, 5] });
          g.path([[0, 0], [0.5, -0.35], [0.5, 0.35]], g.c.ink, { fill: true, fa: 1, close: true }).text('radar', 0.1, -0.7, g.c.dim, { s: 11 });
          g.arrow(0, 0, 1.6 * rx, 1.6 * ry, g.c.ink, { w: 2 }).text('r̂', 1.7 * rx, 1.7 * ry + 0.35, g.c.ink, { s: 12 });
          g.arrow(tx, ty2, tx + vr * rx, ty2 + vr * ry, g.c.a, { w: 4 });
          g.arrow(tx + vr * rx, ty2 + vr * ry, tx + vx, ty2 + vy, g.c.b, { w: 2, dash: [4, 3] });
          g.arrow(tx, ty2, tx + vx, ty2 + vy, g.c.ink, { w: 2 });
          g.dot(tx, ty2, g.c.ink, 5);
          g.note('v  target velocity', 'tl', g.c.ink).note('v·r̂  radial part (radar sees this)', 'tl', g.c.a, 1).note('cross-range part (hidden)', 'tl', g.c.b, 2);
        },
        read: (s, p) => { const th = rad(p.hdg - 30); return [['radial velocity v·r̂', num(p.spd * cos(th)) + ' m/s'], ['cross-range', num(abs(p.spd * sin(th))) + ' m/s'], ['angle to line of sight', num(Math.acos(cos(th)) * 180 / PI) + '°']]; },
        mission: 'Fly at 200 m/s or faster while showing the radar less than 5 m/s of radial velocity.',
        goal: (s, p) => p.spd >= 200 && abs(p.spd * cos(rad(p.hdg - 30))) < 5,
        win: { hdg: 120, spd: 250 },
      },
      cards: [
        { q: 'Give two formulas for the dot product $a·b$ and say what it measures.', a: '$a·b = |a||b|cosθ = a_x b_x + a_y b_y$. It measures how much of one vector lies along the other; it is zero when they are perpendicular.' },
        { q: 'A target moves with velocity $v$. What does a Doppler radar with line-of-sight unit vector $r̂$ measure?', a: 'Only the radial component $v·r̂$. Motion perpendicular to the line of sight produces no Doppler shift.' },
      ],
      quiz: [
        { q: '$a = (3, 4)$ and $b = (4, -3)$. The vectors are:', choices: ['Parallel', 'Perpendicular', 'At 45°', 'Opposite'], answer: 1, why: '$a·b = 12 − 12 = 0$, so they are perpendicular.' },
        { q: 'A target flies at 300 m/s, 60° off the radar line of sight. What radial speed does the radar measure?', num: 150, unit: 'm/s', why: '$300 × cos 60° = 150$ m/s.' },
      ],
    },
    {
      id: 'linalg-matrices', skill: 'linalg', title: 'A matrix is a transformation', pre: ['linalg-vectors'],
      hook: 'Rotating from body axes to Earth axes, scaling a sensor reading, projecting onto a camera: each one is a matrix acting on a vector.',
      body: [
        'Multiplying a vector by a matrix moves it. The whole action is fixed by where the basis vectors go: the **columns** of the matrix are the images of $î$ and $ĵ$.',
        { eq: 'M = [a b; c d]   sends   î → (a, c),   ĵ → (b, d)' },
        'The **determinant** $ad − bc$ is the factor by which areas scale. If it is zero the plane is squashed onto a line and the transformation cannot be undone. A rotation by angle $θ$ is $[cosθ −sinθ; sinθ cosθ]$, with determinant 1.',
        'Multiplying two matrices chains two transformations, which is why order matters: rotating then stretching differs from stretching then rotating.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'a', label: 'a  (î → x)', min: -2, max: 2, step: 0.1, v: 1 }, { k: 'b', label: 'b  (ĵ → x)', min: -2, max: 2, step: 0.1, v: 0.5 },
          { k: 'c', label: 'c  (î → y)', min: -2, max: 2, step: 0.1, v: 0 }, { k: 'd', label: 'd  (ĵ → y)', min: -2, max: 2, step: 0.1, v: 1 },
        ],
        draw(g, s, p) {
          g.view(-4, 4, -3, 3, { eq: true, pad: [10, 10, 10, 10] }).axes({ xt: false, yt: false });
          const T = (x, y) => [p.a * x + p.b * y, p.c * x + p.d * y];
          g.clip(() => {
            for (let i = -6; i <= 6; i++) { g.path([T(i, -6), T(i, 6)], g.c.b, { w: 1, alpha: 0.35 }); g.path([T(-6, i), T(6, i)], g.c.b, { w: 1, alpha: 0.35 }); }
            g.path([[0, 0], [1, 0], [1, 1], [0, 1]], g.c.dim, { w: 1, dash: [4, 3], close: true });
            g.path([T(0, 0), T(1, 0), T(1, 1), T(0, 1)], g.c.d, { w: 1.5, fill: true, close: true, fa: 0.25 });
            g.path([[0.25, 0.2], [0.25, 0.8], [0.7, 0.8], [0.25, 0.8], [0.25, 0.5], [0.6, 0.5]].map(q => T(...q)), g.c.ink, { w: 2 });
            g.arrow(0, 0, ...T(1, 0), g.c.a, { w: 3 }).arrow(0, 0, ...T(0, 1), g.c.c, { w: 3 });
          });
          g.note('image of î', 'tl', g.c.a).note('image of ĵ', 'tl', g.c.c, 1);
        },
        read: (s, p) => [['matrix', `[${num(p.a)} ${num(p.b)}; ${num(p.c)} ${num(p.d)}]`], ['determinant', p.a * p.d - p.b * p.c], ['invertible', abs(p.a * p.d - p.b * p.c) > 1e-9 ? 'yes' : 'no: plane collapsed']],
        mission: 'Build the matrix that rotates everything 90° counter-clockwise.',
        goal: (s, p) => abs(p.a) < 0.05 && abs(p.b + 1) < 0.05 && abs(p.c - 1) < 0.05 && abs(p.d) < 0.05,
        win: { a: 0, b: -1, c: 1, d: 0 },
      },
      cards: [
        { q: 'What do the columns of a matrix tell you about the transformation it performs?', a: 'They are where the basis vectors land: column 1 is the image of $î$, column 2 the image of $ĵ$.' },
        { q: 'What does the determinant of a 2×2 matrix mean geometrically, and what happens when it is zero?', a: 'It is the area scale factor (negative means a flip). Zero means the plane is collapsed to a line or point, so the matrix has no inverse.' },
      ],
      quiz: [
        { q: 'What is the determinant of $[2 1; 0 3]$?', num: 6, tol: 0.01, why: '$ad − bc = 2·3 − 1·0 = 6$. Areas grow sixfold.' },
        { q: 'Which matrix rotates vectors by 180°?', choices: ['[1 0; 0 1]', '[−1 0; 0 −1]', '[0 1; 1 0]', '[0 −1; 1 0]'], answer: 1, why: 'Both basis vectors reverse: $î → (−1, 0)$ and $ĵ → (0, −1)$.' },
      ],
    },
    {
      id: 'mech-energy', skill: 'mech', title: 'Work, energy and potential wells', pre: ['mech-spring', 'calc-integral'],
      hook: 'Pilots and orbit designers think in energy because it answers "can I get there?" without solving the whole trajectory.',
      body: [
        'Work is force accumulated over distance, $W = ∫F·dx$, and it changes kinetic energy: $W_{net} = Δ(½mv^2)$. For gravity near the ground the stored (potential) energy is $U = mgh$.',
        'With no friction, $½mv^2 + U$ stays constant. That makes hard questions easy: an object released from height $h$ can cross a hill only if the hill is lower than $h$, whatever the shape of the path.',
        'Friction converts mechanical energy to heat along the way. The object then needs extra starting height, and it eventually comes to rest at the bottom of a **potential well**. Stable equilibria sit at the minima of $U$.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'x0', label: 'Release point', min: -6, max: -3.6, step: 0.05, v: -4.4, unit: 'm', re: true },
          { k: 'mu', label: 'Friction μ', min: 0, max: 0.3, step: 0.01, v: 0, re: true },
        ],
        init: p => ({ x: p.x0, v: 0, heat: 0, E0: G * ty(p.x0) }),
        step(s, p, dt) { trackStep(s, p.mu, dt); },
        draw(g, s, p) {
          g.view(-6.6, 6.6, -1, 20, { pad: [44, 12, 120, 30] }).axes({ xl: 'x (m)', yl: 'height (m)' });
          const pts = []; for (let x = -6.3; x <= 6.3; x += 0.05) pts.push([x, ty(x)]);
          g.clip(() => {
            g.path([[-6.3, -1], ...pts, [6.3, -1]], g.c.dim, { fill: true, fa: 0.15, w: 2, close: true });
            g.line(-6.6, s.E0 / G, 6.6, s.E0 / G, g.c.c, { w: 1, dash: [5, 4] });
            g.dot(s.x, ty(s.x), g.c.a, 8);
          });
          g.text('release height', -6.4, s.E0 / G + 0.8, g.c.c, { s: 10.5 }).text('hill 5 m', 0, 6, g.c.dim, { a: 'center', s: 10.5 });
          const pe = G * ty(s.x) / s.E0, ke = 0.5 * s.v * s.v / s.E0, ht = s.heat / s.E0;
          g.view(0, 3, 0, 1.05, { pad: [g.w - 104, 12, 12, 30] });
          [[pe, g.c.b, 'PE'], [ke, g.c.a, 'KE'], [ht, g.c.dim, 'heat']].forEach(([v, col, lab], i) => { g.rect(i + 0.15, 0, 0.7, clamp(v, 0, 1.05), col, { fa: 0.85 }); g.text(lab, i + 0.5, 0, col, { a: 'center', dy: 12, s: 10.5 }); });
        },
        read: (s, p) => [['speed', num(abs(s.v)) + ' m/s'], ['height', num(ty(s.x)) + ' m'], ['mechanical energy left', num(trackE(s) / s.E0 * 100) + ' %']],
        mission: 'With friction of at least 0.05, release the ball so it crosses the hill and ends up trapped in the right-hand well.',
        goal: (s, p) => p.mu >= 0.05 && s.x > 0.3 && trackE(s) < G * 5 - 0.5,
        win: { mu: 0.05, x0: -5.3 }, winTime: 30,
      },
      cards: [
        { q: 'State the work–energy theorem and the condition for mechanical energy to be conserved.', a: 'Net work equals the change in kinetic energy: $W_{net} = Δ(½mv^2)$. Mechanical energy $½mv^2 + U$ is conserved when only conservative forces (no friction or drag) do work.' },
        { q: 'On a plot of potential energy versus position, where are the stable equilibria and why?', a: 'At the minima (bottoms of wells). A small push raises $U$, and the force $F = −dU/dx$ points back toward the minimum.' },
      ],
      quiz: [
        { q: 'A frictionless ball is released from rest at 7 m. How fast is it moving when it passes a point 2 m high? ($g = 9.81$ m/s²)', num: 9.9, unit: 'm/s', tol: 0.15, why: '$v = √(2g·Δh) = √(2 × 9.81 × 5) ≈ 9.9$ m/s. The path shape does not matter.' },
        { q: 'With friction present, a ball released at exactly the hill’s height will:', choices: ['Just reach the top', 'Fall short of the top', 'Clear it easily', 'Oscillate forever'], answer: 1, why: 'Friction removes some mechanical energy on the way, so it arrives with less than it needs.' },
      ],
    },
    {
      id: 'mech-momentum', skill: 'mech', title: 'Momentum and impulse', pre: ['mech-energy', 'linalg-vectors'],
      hook: 'Thrust, recoil and a hit-to-kill intercept are all momentum exchange. Energy tells you what is possible; momentum tells you what must happen.',
      body: [
        'Momentum is $p = mv$. A force acting for a time delivers an **impulse** $J = ∫F dt = Δp$. When no external force acts on a system its total momentum cannot change, whatever happens inside.',
        'Collisions conserve momentum always, and kinetic energy only if they are perfectly elastic. The **coefficient of restitution** $e$ (1 = elastic, 0 = stick together) sets how much relative speed survives.',
        { eq: 'v_2′ = (1 + e)·m_1/(m_1 + m_2) · v_1', where: 'speed given to a target at rest by a striker of mass $m_1$ and speed $v_1$' },
        'A heavy striker can fling a light target at nearly twice its own speed. The same exchange, run continuously with exhaust gas as the "target", is how a rocket works. That is the next lesson.',
      ],
      sim: {
        h: 250,
        controls: [
          { k: 'm1', label: 'Striker mass m₁', min: 1, max: 20, step: 1, v: 4, unit: 'kg', re: true },
          { k: 'm2', label: 'Target mass m₂', min: 1, max: 20, step: 1, v: 4, unit: 'kg', re: true },
          { k: 'e', label: 'Restitution e', min: 0, max: 1, step: 0.05, v: 0.5, re: true },
        ],
        init: () => ({ x1: 1, x2: 6, hit: false, t: 0 }),
        step(s, p, dt) {
          const w1 = 0.35 * cbrt(p.m1), w2 = 0.35 * cbrt(p.m2), v1 = 3;
          const a1 = (p.m1 - p.e * p.m2) / (p.m1 + p.m2) * v1, a2 = (1 + p.e) * p.m1 / (p.m1 + p.m2) * v1;
          s.t += dt;
          if (!s.hit) { s.x1 += v1 * dt; if (s.x1 + w1 >= s.x2 - w2) s.hit = true; } else { s.x1 += a1 * dt; s.x2 += a2 * dt; }
          if (s.t > 5.5) Object.assign(s, { x1: 1, x2: 6, hit: false, t: 0 });
        },
        draw(g, s, p) {
          g.view(0, 12, -0.6, 2.6, { pad: [10, 10, 10, 10] });
          g.line(0, 0, 12, 0, g.c.dim, { w: 2 });
          const v1 = 3, a1 = (p.m1 - p.e * p.m2) / (p.m1 + p.m2) * v1, a2 = (1 + p.e) * p.m1 / (p.m1 + p.m2) * v1;
          [[s.x1, p.m1, g.c.a, s.hit ? a1 : v1], [s.x2, p.m2, g.c.b, s.hit ? a2 : 0]].forEach(([x, m, col, v]) => {
            const w = 0.35 * cbrt(m);
            g.clip(() => { g.rect(x - w, 0, 2 * w, 1.6 * w, col, { fa: 0.9 }); g.arrow(x, 1.6 * w + 0.3, x + v * 0.45, 1.6 * w + 0.3, col, { w: 2.5 }); });
            g.text(m + ' kg', x, -0.3, col, { a: 'center', s: 11 });
          });
          g.note(s.hit ? 'after impact' : 'before impact', 'tr', g.c.dim);
        },
        read: (s, p) => { const v1 = 3, a1 = (p.m1 - p.e * p.m2) / (p.m1 + p.m2) * v1, a2 = (1 + p.e) * p.m1 / (p.m1 + p.m2) * v1; const k0 = 0.5 * p.m1 * 9, k1 = 0.5 * p.m1 * a1 * a1 + 0.5 * p.m2 * a2 * a2; return [['momentum before', num(p.m1 * v1) + ' kg·m/s'], ['after', num(p.m1 * a1 + p.m2 * a2) + ' kg·m/s'], ['target speed ÷ striker speed', num(a2 / v1)], ['kinetic energy kept', num(k1 / k0 * 100) + ' %']]; },
        mission: 'Make the target leave at more than 1.8 times the striker’s incoming speed.',
        goal: (s, p) => (1 + p.e) * p.m1 / (p.m1 + p.m2) > 1.8,
        win: { m1: 20, m2: 1, e: 1 },
      },
      cards: [
        { q: 'Define impulse and relate it to momentum.', a: 'Impulse is force accumulated over time, $J = ∫F dt$, and it equals the change in momentum $Δp$.' },
        { q: 'In a collision, which is always conserved: momentum or kinetic energy? What does the coefficient of restitution describe?', a: 'Momentum is always conserved (no external force). Kinetic energy is conserved only if $e = 1$. $e$ is the ratio of separation speed to approach speed.' },
      ],
      quiz: [
        { q: 'A 2 kg cart at 6 m/s hits and sticks to a 4 kg cart at rest. What is their shared speed?', num: 2, unit: 'm/s', tol: 0.02, why: 'Momentum: $2 × 6 = (2 + 4)v$, so $v = 2$ m/s.' },
        { q: 'A very heavy object strikes a very light one at rest, elastically. The light object leaves at about:', choices: ['The striker’s speed', 'Twice the striker’s speed', 'Half the striker’s speed', 'Zero'], answer: 1, why: 'With $m_1 ≫ m_2$ and $e = 1$, $v_2′ → 2v_1$. In the striker’s frame the light object simply bounces off a wall.' },
      ],
    },
    {
      id: 'prop-rocket-eq', skill: 'prop', title: 'The rocket equation and staging', pre: ['mech-momentum', 'calc-integral'],
      hook: 'One logarithm explains why rockets are mostly propellant, why they drop stages, and why a little more payload costs so much.',
      body: [
        'A rocket gains speed by throwing mass backward. Integrating the momentum exchange over the burn gives the **Tsiolkovsky rocket equation**:',
        { eq: 'Δv = g_0·I_{sp}·ln(m_0/m_f)', where: '$I_{sp}$ = specific impulse (s), $m_0/m_f$ = mass before ÷ after the burn' },
        'The logarithm is unforgiving. Reaching low Earth orbit takes about 9.4 km/s including losses. With $I_{sp}$ = 350 s that needs a mass ratio near 15, so more than 93% of liftoff mass must be propellant, leaving almost nothing for tanks, engines and payload.',
        '**Staging** is the way out: drop empty tanks and engines so later burns push less dead weight. Each stage contributes its own $Δv$, and they add.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'isp', label: 'Specific impulse', min: 250, max: 460, step: 5, v: 300, unit: 's' },
          { k: 'pf', label: 'Payload fraction', min: 0.5, max: 10, step: 0.5, v: 1, unit: '%' },
          { k: 'eps', label: 'Structure fraction per stage', min: 5, max: 20, step: 1, v: 10, unit: '%' },
          { k: 'n', type: 'select', label: 'Stages', v: 1, options: [[1, '1 stage'], [2, '2 stages'], [3, '3 stages']] },
        ],
        draw(g, s, p) {
          const { dv, pi } = rocket(p);
          g.view(0, 4, 0, 1.02, { pad: [20, 14, g.w * 0.62, 30] });
          let y = 0;
          for (let k = 0; k < p.n; k++) {
            const mk = pi ** k * (1 - pi), st = p.eps / 100 * mk;
            g.rect(1, y, 2, mk - st, g.c.a, { fa: 0.75, stroke: g.c.ink }).rect(1, y + mk - st, 2, st, g.c.dim, { fa: 0.9, stroke: g.c.ink });
            if (mk > 0.08) g.text('stage ' + (k + 1), 2, y + (mk - st) / 2, g.c.ink, { a: 'center', s: 11 });
            y += mk;
          }
          g.path([[1, y], [3, y], [2, Math.min(1.02, y + Math.max(0.04, 1 - y))]], g.c.c, { fill: true, fa: 0.9, close: true, w: 1 });
          g.text('liftoff mass', 2, 0, g.c.dim, { a: 'center', dy: 14, s: 10.5 });
          g.view(0, 4, 0, 14, { pad: [g.w * 0.48, 14, 14, 30] }).axes({ xt: false, yl: 'Δv (km/s)', grid: false });
          let acc = 0;
          dv.forEach((d, k) => { g.rect(0.8, acc, 1.4, d, [g.c.a, g.c.b, g.c.d][k], { fa: 0.8 }); g.text('stage ' + (k + 1), 2.35, acc + d / 2, g.c.dim, { s: 10.5 }); acc += d; });
          g.line(0, 9.4, 4, 9.4, g.c.good, { w: 2, dash: [6, 4] }).text('low Earth orbit ≈ 9.4', 3.9, 9.9, g.c.good, { a: 'right', s: 11 });
          g.note('propellant', 'tl', g.c.a).note('structure', 'tl', g.c.dim, 1).note('payload', 'tl', g.c.c, 2);
        },
        read: (s, p) => { const r = rocket(p); return [['total Δv', num(r.total, 4) + ' km/s'], ['mass ratio per stage', num(r.R, 3)], ['propellant share of liftoff', num((1 - p.pf / 100) * (1 - p.eps / 100) * 100, 3) + ' %']]; },
        mission: 'Reach 9.4 km/s carrying at least 3% payload, with specific impulse no higher than 350 s.',
        goal: (s, p) => p.isp <= 350 && p.pf >= 3 && rocket(p).total >= 9.4,
        win: { isp: 350, pf: 3, n: 3, eps: 10 },
      },
      cards: [
        { q: 'Write the rocket equation and name each term.', a: '$Δv = g_0 I_{sp} ln(m_0/m_f)$: $g_0$ = 9.81 m/s², $I_{sp}$ = specific impulse in seconds (so $g_0I_{sp}$ is exhaust velocity), $m_0/m_f$ = initial over final mass.' },
        { q: 'Why does staging raise a rocket’s total Δv?', a: 'Dropping empty tanks and engines removes dead mass, so each later burn has a higher mass ratio than it would carrying that structure. Stage Δv values add.' },
      ],
      quiz: [
        { q: 'A stage has $I_{sp}$ = 300 s and mass ratio $e^2 ≈ 7.39$. What Δv does it deliver? ($g_0$ = 9.81 m/s²)', num: 5886, unit: 'm/s', tol: 60, why: '$Δv = 9.81 × 300 × ln(e^2) = 2943 × 2 ≈ 5886$ m/s.' },
        { q: 'Doubling a rocket’s mass ratio from 4 to 8 changes its Δv by a factor of:', choices: ['2', '1.5', '4', '1.26'], answer: 1, why: '$ln 8/ln 4 = 3/2$. The logarithm means mass ratio buys Δv slowly.' },
      ],
    },
    {
      id: 'calc-taylor', skill: 'calc', title: 'Taylor series: polynomials that imitate', pre: ['calc-derivative'],
      hook: 'Small-angle formulas, linearized dynamics and the trig routines in a flight computer are all truncated Taylor series.',
      body: [
        'The linear approximation uses one derivative. Use more and you get the **Taylor series**, a polynomial that matches the function’s value, slope, curvature and so on at one point:',
        { eq: 'f(x) = f(0) + f′(0)x + f″(0)x^2/2! + f‴(0)x^3/3! + …' },
        'Truncating gives a workable approximation near the expansion point. $sin x ≈ x$ and $cos x ≈ 1 − x^2/2$ are the first terms, good to about 1% out to 14° and 37° respectively.',
        'Some series converge everywhere (sin, cos, exp). Others only inside a **radius of convergence**: the series for $1/(1 − x)$ and $ln(1 + x)$ fail beyond $|x| = 1$ however many terms you add. Try them in the lab.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'f', type: 'select', label: 'Function', v: 'sin', options: Object.entries(TAY).map(([k, v]) => [k, v.label]) },
          { k: 'n', label: 'Highest power kept', min: 0, max: 15, step: 1, v: 1 },
        ],
        draw(g, s, p) {
          g.view(-7, 7, -3, 3).axes({ xl: 'x' });
          const T = TAY[p.f];
          if (T.R) g.rect(-T.R, -3, 2 * T.R, 6, g.c.c, { fa: 0.1 });
          else g.rect(-PI, -3, 2 * PI, 6, g.c.c, { fa: 0.07 });
          g.fn(T.f, g.c.ink, { w: 2.5, n: 700 });
          g.fn(x => taylor(p.f, p.n, x), g.c.a, { w: 2, n: 700 });
          g.note(T.label, 'tr', g.c.ink).note(`Taylor polynomial, degree ${p.n}`, 'tr', g.c.a, 1);
          if (T.R) g.note('converges only for |x| < 1', 'bl', g.c.c);
        },
        read: (s, p) => { const e = taylorErr(p.f, p.n); return [['largest error on −π ≤ x ≤ π', isFinite(e) ? num(e, 3) : 'diverges']]; },
        mission: 'Approximate sin x to within 0.01 everywhere on −π ≤ x ≤ π using the lowest degree that works.',
        goal: (s, p) => p.f === 'sin' && taylorErr('sin', p.n) < 0.01 && p.n <= 10,
        win: { f: 'sin', n: 9 },
      },
      cards: [
        { q: 'Write the Taylor series of $f$ about 0 through the cubic term.', a: '$f(0) + f′(0)x + f″(0)x^2/2! + f‴(0)x^3/3!$' },
        { q: 'Give the small-angle approximations for $sin x$ and $cos x$ ($x$ in radians).', a: '$sin x ≈ x$ and $cos x ≈ 1 − x^2/2$.' },
        { q: 'What is a radius of convergence? Give one function with a finite one.', a: 'The distance from the expansion point within which the Taylor series converges to the function. $1/(1−x)$ and $ln(1+x)$ about 0 both have radius 1.' },
      ],
      quiz: [
        { q: 'Using $cos x ≈ 1 − x^2/2$, estimate $cos(0.2)$.', num: 0.98, tol: 0.001, why: '$1 − 0.04/2 = 0.98$. The true value is 0.98007.' },
        { q: 'Adding more terms to the series for $1/(1 − x)$ at $x = 2$:', choices: ['Slowly improves the estimate', 'Makes the estimate worse without limit', 'Gives exactly −1', 'Has no effect'], answer: 1, why: '$x = 2$ is outside the radius of convergence, so the partial sums $1 + 2 + 4 + …$ grow without bound.' },
      ],
    },
    {
      id: 'num-root-finding', skill: 'nummeth', title: 'Root finding: bisection and Newton', pre: ['calc-derivative', 'num-euler-rk4'],
      hook: 'Where does the trajectory meet the ground? When does the satellite cross the equator? Each question is "solve f(x) = 0", and it rarely has a formula.',
      body: [
        '**Bisection** keeps a bracket $[a, b]$ where $f$ changes sign and halves it each step. It cannot fail, but it gains only one binary digit per iteration.',
        '**Newton’s method** uses the linear approximation: follow the tangent line to where it crosses zero.',
        { eq: 'x_{n+1} = x_n − f(x_n)/f′(x_n)' },
        'Near a root Newton roughly doubles the number of correct digits every step. Far from one it can overshoot, cycle or run away, so real solvers pair it with a bracket as a safety net. The lab’s function $x^3 − 2x + 2$ contains a famous trap: start at 0 and watch.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'm', type: 'select', label: 'Method', v: 'newton', options: [['newton', 'Newton'], ['bisect', 'Bisection on [−3, 3]']] },
          { k: 'x0', label: 'Newton starting guess', min: -3, max: 3, step: 0.1, v: 0 },
          { k: 'k', label: 'Iterations', min: 0, max: 12, step: 1, v: 5 },
        ],
        draw(g, s, p) {
          g.view(-3.2, 3.2, -10, 12).axes({ xl: 'x', yl: 'f(x) = x³ − 2x + 2' });
          g.fn(rf, g.c.ink, { w: 2.5 });
          const xs = iterate(p.m, p.x0, p.k);
          g.clip(() => {
            if (p.m === 'newton') xs.forEach((x, i) => { if (i < xs.length - 1) { g.line(x, 0, x, rf(x), g.c.dim, { w: 1, dash: [3, 3] }); g.line(x, rf(x), xs[i + 1], 0, g.c.b, { w: 1.5, alpha: 0.4 + 0.6 * (i + 1) / xs.length }); } g.dot(x, 0, i === xs.length - 1 ? g.c.a : g.c.b, i === xs.length - 1 ? 6 : 3.5); });
            else xs.forEach(([a, b], i) => g.line(a, -9.5 + i * 0.75, b, -9.5 + i * 0.75, i === xs.length - 1 ? g.c.a : g.c.b, { w: 3 }));
          });
          g.dot(-1.7693, 0, g.c.good, 4, { ring: g.c.good }).text('root', -1.7693, 1.2, g.c.good, { a: 'center', s: 11 });
        },
        read: (s, p) => { const xs = iterate(p.m, p.x0, p.k), x = lastX(p.m, xs); return [['current x', num(x, 7)], ['|f(x)|', num(abs(rf(x)), 3)], ['error', num(abs(x + 1.7692923542), 3)]]; },
        mission: 'Get |f(x)| below 10⁻⁶ in five iterations or fewer.',
        goal: (s, p) => p.k <= 5 && abs(rf(lastX(p.m, iterate(p.m, p.x0, p.k)))) < 1e-6,
        win: { m: 'newton', x0: -2, k: 5 },
      },
      cards: [
        { q: 'Write the Newton iteration for solving $f(x) = 0$ and describe its convergence near a root.', a: '$x_{n+1} = x_n − f(x_n)/f′(x_n)$. Quadratic convergence: the number of correct digits roughly doubles each step.' },
        { q: 'Compare bisection with Newton’s method: one strength and one weakness of each.', a: 'Bisection always converges given a sign-change bracket but is slow (one bit per step). Newton is very fast near the root but can diverge or cycle from a poor starting guess and needs the derivative.' },
      ],
      quiz: [
        { q: 'Bisection starts with a bracket 6 units wide. How many iterations until the bracket is narrower than 0.01?', num: 10, tol: 0.01, why: '$6/2^n < 0.01$ needs $2^n > 600$, so $n = 10$ ($2^{10} = 1024$).' },
        { q: 'A Newton iteration has errors 0.1, then 0.01, then 0.0001. The next error is about:', choices: ['10⁻⁵', '10⁻⁶', '10⁻⁸', '10⁻¹⁰'], answer: 2, why: 'Quadratic convergence squares the error each step: $(10^{−4})^2 = 10^{−8}$.' },
      ],
    },
    {
      id: 'py-numpy', skill: 'python', title: 'NumPy: whole arrays at once', pre: ['py-basics', 'linalg-vectors'],
      hook: 'Telemetry arrives as millions of samples. Array operations run them through compiled code and read like the math.',
      body: [
        'NumPy gives Python the array. Arithmetic on arrays is **element-wise**: `v * 2` doubles every entry and `a + b` adds matching entries. No loop is written, and the work runs in compiled C.',
        { code: 'import numpy as np\nt = np.linspace(0, 4, 5)     # [0. 1. 2. 3. 4.]\nv = 20 - 9.8 * t             # one line, five results\nfast = v[v > 10]             # boolean mask selects entries', lang: 'python' },
        'A comparison such as `v > 10` returns an array of booleans, and indexing with it keeps only the `True` positions. Reductions like `.sum()`, `.max()` and `.mean()` collapse an array to a number. `np.diff` gives differences between neighbors; `np.cumsum` gives running totals: discrete versions of the derivative and the integral.',
      ],
      sim: tracer(
        ['import numpy as np', 't = np.linspace(0, 4, 5)', 'v = 20 - 9.8 * t', 'x = np.cumsum(v) * 1.0', 'up = v > 0', 'print(x[up].max())'],
        [
          { line: 0, vars: {}, note: 'np is the conventional alias' },
          { line: 1, vars: { t: '[0. 1. 2. 3. 4.]' }, note: '5 evenly spaced points' },
          { line: 2, vars: { t: '[0. 1. 2. 3. 4.]', v: '[20. 10.2 0.4 -9.4 -19.2]' }, note: 'applied to every element' },
          { line: 3, vars: { t: '[0. 1. 2. 3. 4.]', v: '[20. 10.2 0.4 -9.4 -19.2]', x: '[20. 30.2 30.6 21.2 2.]' }, note: 'running total = integral' },
          { line: 4, vars: { v: '[20. 10.2 0.4 -9.4 -19.2]', x: '[20. 30.2 30.6 21.2 2.]', up: '[T T T F F]' }, note: 'boolean mask' },
          { line: 5, vars: { x: '[20. 30.2 30.6 21.2 2.]', up: '[T T T F F]', 'x[up]': '[20. 30.2 30.6]' }, note: 'prints 30.6' },
        ],
        { h: 230, mission: 'Step to the end, predicting each array before you reveal it.', goal: (s, p) => p.i === 5, win: { i: 5 } },
      ),
      cards: [
        { q: 'What does `v[v > 10]` do when `v` is a NumPy array?', a: '`v > 10` makes a boolean array; indexing with it returns only the elements of `v` where the condition is true.' },
        { q: 'Which NumPy functions are the discrete versions of the derivative and the integral?', a: '`np.diff` (differences between neighbors; divide by dt for a derivative) and `np.cumsum` (running total; multiply by dt for an integral).' },
      ],
      quiz: [
        { q: 'What does this print?', code: 'import numpy as np\na = np.array([1, 2, 3, 4])\nprint((a * a)[a > 2].sum())', lang: 'python', choices: ['7', '25', '30', '16'], answer: 1, why: '`a * a` is [1, 4, 9, 16]. The mask keeps the entries where `a > 2`: 9 + 16 = 25.' },
        { q: '`x` holds 1000 position samples. `np.diff(x)` has how many elements?', num: 999, tol: 0.01, why: 'Differences between neighbors: one fewer than the number of samples.' },
      ],
      code: {
        prompt: 'Without writing a loop, complete `velocity(x, dt)` (finite-difference velocity between neighboring samples) and `rms(v)` (root-mean-square: the square root of the mean of the squares).',
        starter: 'import numpy as np\n\ndef velocity(x, dt):\n    return x  # replace: differences between neighbors, divided by dt\n\ndef rms(v):\n    return 0.0  # replace\n\nx = np.array([0.0, 1.0, 4.0, 9.0])\nprint(velocity(x, 0.5), rms(np.array([3.0, 4.0])))',
        solution: 'import numpy as np\n\ndef velocity(x, dt):\n    return np.diff(x) / dt\n\ndef rms(v):\n    return np.sqrt(np.mean(v ** 2))\n\nx = np.array([0.0, 1.0, 4.0, 9.0])\nprint(velocity(x, 0.5), rms(np.array([3.0, 4.0])))',
        tests: 'import numpy as np\n_v = velocity(np.array([0.0, 1.0, 4.0, 9.0]), 0.5)\nassert np.allclose(_v, [2.0, 6.0, 10.0]), f"velocity gave {_v}, expected [2. 6. 10.]"\nassert abs(rms(np.array([3.0, 4.0])) - 3.5355339) < 1e-6, "rms([3, 4]) should be 3.5355"\nassert abs(rms(np.array([-2.0, 2.0, -2.0, 2.0])) - 2.0) < 1e-9',
        hint: '`np.diff(x)` gives neighbor differences. For RMS: `v ** 2`, then `np.mean(...)`, then `np.sqrt(...)`.',
      },
    },
    {
      id: 'vcs-testing', skill: 'vcs', title: 'Tests that catch bugs', pre: ['vcs-git', 'py-numpy'],
      hook: 'An actuator-limit function with a sign error has crashed real vehicles. A test suite is only as good as the bugs it can catch.',
      body: [
        'A **unit test** runs a small piece of code with known inputs and asserts the output. Tests are run automatically on every commit (continuous integration), so a regression is caught minutes after it is written.',
        { code: 'def sat(u, limit):\n    """Clamp command u to the range [-limit, +limit]."""\n    return max(-limit, min(limit, u))\n\ndef test_sat_clamps_high():\n    assert sat(5.0, 1.0) == 1.0', lang: 'python' },
        'Good tests probe **boundaries and distinct behaviors**: inside the range, above it, below it, and with a different limit. One way to judge a suite is **mutation testing**: inject plausible bugs and see whether any test fails. A bug that no test notices is a gap.',
        'The lab shows four buggy versions of `sat` and six candidate tests. A green cell means that test exposes that bug.',
      ],
      sim: {
        h: 250,
        controls: TESTS.map(([u, L, w], i) => ({ k: 't' + i, type: 'toggle', label: `sat(${u}, ${L}) == ${w}`, v: i === 1 || i === 3 })),
        draw(g, s, p) {
          g.view(0, 10, 0, 5.2, { pad: [10, 10, 10, 10] });
          const c = caught(p);
          TESTS.forEach(([u, L], i) => g.text(`T${i + 1}`, 4.55 + i * 0.75, 4.7, p['t' + i] ? g.c.ink : g.c.dim, { a: 'center', s: 12, bold: p['t' + i] }));
          MUT.forEach(([name, f], r) => {
            const y = 3.7 - r;
            g.text(name, 0.1, y, g.c.ink, { s: 12, mono: false });
            TESTS.forEach(([u, L, want], i) => { const kills = f(u, L) !== want; g.rect(4.25 + i * 0.75, y - 0.32, 0.6, 0.64, kills ? g.c.good : g.c.dim, { fa: p['t' + i] ? (kills ? 0.9 : 0.25) : 0.08, stroke: p['t' + i] ? g.c.ink : g.c.grid }); });
            g.text(c[r] ? 'caught' : 'ESCAPES', 9.95, y, c[r] ? g.c.good : g.c.bad, { a: 'right', s: 11, bold: true });
          });
        },
        read: (s, p) => { const c = caught(p); return [['tests selected', TESTS.filter((_, i) => p['t' + i]).length], ['bugs caught', `${c.filter(Boolean).length} of 4`]]; },
        mission: 'Catch all four bugs using only three tests.',
        goal: (s, p) => caught(p).every(Boolean) && TESTS.filter((_, i) => p['t' + i]).length <= 3,
        win: { t0: true, t1: false, t2: true, t3: false, t4: true, t5: false },
      },
      cards: [
        { q: 'What is a unit test, and what does continuous integration do with it?', a: 'A small automated check that calls code with known inputs and asserts the expected result. Continuous integration runs every test on every commit so regressions surface immediately.' },
        { q: 'What is mutation testing and what does a surviving mutant tell you?', a: 'Deliberately injecting small bugs to see whether the test suite fails. A mutant that survives reveals behavior that no test checks.' },
      ],
      quiz: [
        { q: 'A suite for `sat(u, limit)` only uses `limit = 1`. Which bug can it never catch?', choices: ['Missing lower clamp', 'Missing upper clamp', 'The limit being hard-coded to 1', 'Returning the limit for all positive inputs'], answer: 2, why: 'If every test uses a limit of 1, code that ignores the parameter and uses 1 gives identical answers.' },
        { q: 'Which set of inputs best tests a clamp to [−L, L]?', choices: ['Three values inside the range', 'One inside, one above, one below, with more than one L', 'Only the value 0', 'Very large positive values'], answer: 1, why: 'Each distinct behavior (pass-through, upper clamp, lower clamp, parameter use) needs at least one test.' },
      ],
      code: {
        prompt: 'Write `passes(f)`. It receives a saturation function `f(u, limit)` and must return `True` only if `f` is correct. It will be run against one correct version and four buggy ones.',
        starter: 'def passes(f):\n    # f(u, limit) should clamp u to [-limit, +limit]\n    return f(0.5, 1) == 0.5\n\ndef good(u, limit):\n    return max(-limit, min(limit, u))\n\nprint(passes(good))',
        solution: 'def passes(f):\n    return (f(0.5, 1) == 0.5 and f(5, 1) == 1 and f(-5, 1) == -1\n            and f(3, 2) == 2 and f(-3, 2) == -2)\n\ndef good(u, limit):\n    return max(-limit, min(limit, u))\n\nprint(passes(good))',
        tests: '_good = lambda u, L: max(-L, min(L, u))\n_bugs = {\n  "no lower limit": lambda u, L: min(L, u),\n  "no upper limit": lambda u, L: max(-L, u),\n  "positive input returns limit": lambda u, L: L if u > 0 else max(-L, u),\n  "limit hard-coded to 1": lambda u, L: max(-1, min(1, u)),\n}\nassert passes(_good) is True, "passes() rejected a correct function"\nfor _name, _f in _bugs.items():\n    assert passes(_f) is False, f"passes() missed the bug: {_name}"',
        hint: 'Combine several checks with `and`: a value inside the range, one above, one below, and at least one with a limit other than 1.',
      },
    },
  ],
};

function rocket(p) {
  const pi = (p.pf / 100) ** (1 / p.n), R = 1 / (p.eps / 100 + (1 - p.eps / 100) * pi);
  const each = 9.81 * p.isp * log(R) / 1000;
  return { pi, R, dv: Array(p.n).fill(each), total: each * p.n };
}
