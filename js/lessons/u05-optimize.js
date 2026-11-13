import { num, rng, clamp } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, atan2, hypot, max, min, log10 } = Math;
const rad = d => d * PI / 180;

// --- terrain for the gradient lab ---
const hill = (x, y) => exp(-((x - 1) ** 2 + (y - 0.5) ** 2)) + 0.7 * exp(-((x + 1.2) ** 2 + (y + 0.8) ** 2) / 0.8);
const hgrad = (x, y) => { const a = exp(-((x - 1) ** 2 + (y - 0.5) ** 2)), b = 0.7 * exp(-((x + 1.2) ** 2 + (y + 0.8) ** 2) / 0.8); return [-2 * (x - 1) * a - 2.5 * (x + 1.2) * b, -2 * (y - 0.5) * a - 2.5 * (y + 0.8) * b]; };

// --- gradient descent with momentum on a ravine f = (x^2 + 20 y^2)/2 ---
export function descend(lr, beta, steps = 30) {
  let x = -4, y = 1.5, vx = 0, vy = 0; const pts = [[x, y]];
  for (let i = 0; i < steps; i++) { vx = beta * vx - lr * x; vy = beta * vy - lr * 20 * y; x = clamp(x + vx, -1e3, 1e3); y = clamp(y + vy, -1e3, 1e3); pts.push([x, y]); }
  return { pts, f: 0.5 * (x * x + 20 * y * y) };
}

// --- non-convex 1-D function ---
const nc = x => 0.05 * x ** 4 - 0.5 * x * x + 0.3 * x + 0.4 * sin(3 * x), dnc = x => 0.2 * x ** 3 - x + 0.3 + 1.2 * cos(3 * x);
const NCMIN = (() => { let b = [0, 1e9]; for (let x = -4; x <= 4; x += 0.0005) if (nc(x) < b[1]) b = [x, nc(x)]; return b; })();
export function restarts(x0, lr, n) {
  return Array.from({ length: n }, (_, k) => { let s = x0 + k * 8 / n; if (s > 4) s -= 8; let x = s; for (let i = 0; i < 300; i++) x = clamp(x - lr * dnc(x), -4.5, 4.5); return [s, x]; });
}

// --- rocket mass properties (lengths in m from the tail) ---
const CP = 2.4;
const dens = (x, f, mp) => 50 + (x >= 0.5 && x <= 0.5 + 3.5 * f ? 1200 / 3.5 : 0) + (x >= 5 ? mp : 0);
export const cgExact = (f, mp) => (900 + 1200 * f * (0.5 + 1.75 * f) + 5.5 * mp) / (300 + 1200 * f + mp);
const cgGrid = (f, mp, n) => { let M = 0, Mx = 0; for (let i = 0; i < n; i++) { const x = (i + 0.5) * 6 / n, dm = dens(x, f, mp) * 6 / n; M += dm; Mx += dm * x; } return { M, cg: Mx / M }; };
export const minMargin = mp => { let m = 9; for (let f = 0; f <= 1.0001; f += 0.01) m = min(m, cgExact(f, mp) - CP); return m; };

// --- proportional navigation engagement (point masses, constant speeds) ---
const wrap = a => atan2(sin(a), cos(a));
const emem = new Map();
export function engage(law, N, gT) {
  const key = [law, N, gT].join(); if (emem.has(key)) return emem.get(key);
  const vm = 600, vt = 300, dt = 0.004; let mx = 0, my = 0, tx = 9000, ty = 3000, hm = atan2(3000, 9000) + 0.35, ht = PI, lamP = atan2(ty, tx), amax = 0, miss = 0, time = 0;
  const pm = [], pt = [];
  for (let i = 0; i < 12000; i++) {
    const rx = tx - mx, ry = ty - my, r = hypot(rx, ry), vrx = vt * cos(ht) - vm * cos(hm), vry = vt * sin(ht) - vm * sin(hm);
    if (i % 25 === 0) { pm.push([mx, my]); pt.push([tx, ty]); }
    const tca = -(rx * vrx + ry * vry) / (vrx * vrx + vry * vry);
    if (tca <= dt) { miss = hypot(rx + vrx * max(0, tca), ry + vry * max(0, tca)); time += max(0, tca); pm.push([mx + vm * cos(hm) * max(0, tca), my + vm * sin(hm) * max(0, tca)]); pt.push([tx + vt * cos(ht) * max(0, tca), ty + vt * sin(ht) * max(0, tca)]); break; }
    const lam = atan2(ry, rx), lamdot = wrap(lam - lamP) / dt, vc = -(rx * vrx + ry * vry) / r; lamP = lam;
    let a = law === 'pn' ? (i ? N * vc * lamdot : 0) : 3 * vm * wrap(lam - hm);
    a = clamp(a, -30 * 9.81, 30 * 9.81); if (time > 0.3) amax = max(amax, abs(a));
    hm += a / vm * dt; if (time > 3) ht += gT * 9.81 / vt * dt;
    mx += vm * cos(hm) * dt; my += vm * sin(hm) * dt; tx += vt * cos(ht) * dt; ty += vt * sin(ht) * dt; time += dt; miss = r;
  }
  const res = { pm, pt, miss, g: amax / 9.81, tf: time };
  if (emem.size > 300) emem.clear(); emem.set(key, res); return res;
}

// --- finite differences of sin at x = 1 ---
export const fdErr = (m, lh) => { const h = 10 ** lh, d = m === 'fwd' ? (sin(1 + h) - sin(1)) / h : (sin(1 + h) - sin(1 - h)) / (2 * h); return abs(d - cos(1)); };

export default {
  id: 'u05', title: 'Many variables', blurb: 'Gradients, optimization and trajectories.',
  lessons: [
    {
      id: 'calc-gradient', skill: 'calc', title: 'Partial derivatives and the gradient', pre: ['calc-derivative', 'linalg-vectors'],
      hook: 'Terrain-following flight, training a neural network and tuning a design all ask the same thing: which way is uphill, and how steep?',
      body: [
        'A function of two variables is a surface. A **partial derivative** $∂f/∂x$ is the slope when you walk in the $x$ direction holding $y$ fixed. Stack the partials into a vector and you have the **gradient**:',
        { eq: '∇f = (∂f/∂x, ∂f/∂y)' },
        'The gradient points in the direction of steepest ascent and its length is the slope in that direction. The slope along any other unit direction $u$ is the dot product $∇f·u$, so it falls to zero when you walk along a contour line.',
        'At a peak, a valley floor or a saddle the gradient is zero. Finding such points is the whole business of optimization.',
      ],
      labNote: 'Drag the probe across the terrain. The orange arrow is the gradient.',
      sim: {
        h: 330,
        controls: [{ k: 'dir', label: 'Walking direction', min: 0, max: 355, step: 5, v: 0, unit: '°' }],
        init: () => ({ x: -0.5, y: -1.2 }),
        drag(s, p, x, y) { s.x = clamp(x, -3, 3); s.y = clamp(y, -2, 2); },
        draw(g, s, p) {
          g.view(-3, 3, -2, 2, { eq: true, pad: [10, 10, 10, 10] });
          g.heat((x, y) => hill(x, y), 60, 40, g.ramp);
          const [gx, gy] = hgrad(s.x, s.y), ux = cos(rad(p.dir)), uy = sin(rad(p.dir));
          g.arrow(s.x, s.y, s.x + ux * 0.6, s.y + uy * 0.6, g.c.b, { w: 2 });
          g.arrow(s.x, s.y, s.x + gx * 0.9, s.y + gy * 0.9, g.c.ink, { w: 3 });
          g.dot(s.x, s.y, g.c.ink, 6, { ring: g.c.panel });
          g.note('∇f (steepest ascent)', 'tl', g.c.ink).note('walking direction u', 'tl', g.c.b, 1);
        },
        read: (s, p) => { const [gx, gy] = hgrad(s.x, s.y); return [['height f', num(hill(s.x, s.y), 3)], ['|∇f|', num(hypot(gx, gy), 3)], ['slope along u', num(gx * cos(rad(p.dir)) + gy * sin(rad(p.dir)), 3)]]; },
        mission: 'Drag the probe to the higher summit: height above 0.95 with gradient magnitude under 0.05.',
        goal: s => hill(s.x, s.y) > 0.95 && hypot(...hgrad(s.x, s.y)) < 0.05,
        win: s => { s.x = 0.8; s.y = 0.4; for (let i = 0; i < 400; i++) { const [gx, gy] = hgrad(s.x, s.y); s.x += 0.1 * gx; s.y += 0.1 * gy; } },
      },
      cards: [
        { q: 'What is the gradient of $f(x, y)$ and what two things does it tell you?', a: '$∇f = (∂f/∂x, ∂f/∂y)$. Its direction is the direction of steepest increase; its magnitude is the slope in that direction.' },
        { q: 'How do you get the slope of $f$ in an arbitrary unit direction $u$?', a: 'The directional derivative $∇f·u$. It is zero along a contour line and largest when $u$ is parallel to $∇f$.' },
      ],
      quiz: [
        { q: 'For $f(x, y) = x^2y + 3y$, what is $∂f/∂x$ at the point (2, 5)?', num: 20, tol: 0.05, why: '$∂f/∂x = 2xy = 2 × 2 × 5 = 20$.' },
        { q: 'At a point, $∇f = (3, 4)$. The steepest slope there is:', num: 5, tol: 0.02, why: '$|∇f| = √(9 + 16) = 5$.' },
      ],
    },
    {
      id: 'opt-gradient-descent', skill: 'opt', title: 'Gradient descent and the learning rate', pre: ['calc-gradient', 'num-root-finding'],
      hook: 'Nearly every machine-learning model and many design tools are tuned by one loop: step downhill, repeat.',
      body: [
        'To minimize $f$, start somewhere and step against the gradient:',
        { eq: 'x_{k+1} = x_k − α·∇f(x_k)', where: '$α$ is the step size, or learning rate' },
        'Too small an $α$ crawls. Too large and the iterate overshoots the valley and diverges. The trouble is that the right size differs by direction: in a long narrow ravine a step that suits the steep walls is tiny along the floor, so plain gradient descent zig-zags and stalls.',
        '**Momentum** fixes much of this. Keep a running velocity $v ← βv − α∇f$ and step by $v$. Oscillations across the ravine cancel; progress along it accumulates.',
        'The ratio of steepest to shallowest curvature is the **condition number**. The lab’s bowl has a condition number of 20.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'lr', label: 'Learning rate α', min: 0.005, max: 0.15, step: 0.005, v: 0.02 },
          { k: 'beta', label: 'Momentum β', min: 0, max: 0.95, step: 0.05, v: 0 },
        ],
        draw(g, s, p) {
          g.view(-5, 5, -2.2, 2.2).axes({ xl: 'x', yl: 'y' });
          g.clip(() => {
            [0.5, 2, 6, 14, 30, 55].forEach(L => { const pts = []; for (let i = 0; i <= 80; i++) pts.push([sqrt(2 * L) * cos(i / 40 * PI), sqrt(2 * L / 20) * sin(i / 40 * PI)]); g.path(pts, g.c.dim, { w: 1, alpha: 0.6 }); });
            const r = descend(p.lr, p.beta);
            g.path(r.pts, g.c.a, { w: 2 }); r.pts.forEach((q, i) => g.dot(q[0], q[1], g.c.a, i === r.pts.length - 1 ? 5 : 2.5));
          });
          g.dot(0, 0, g.c.good, 4, { ring: g.c.good }).dot(-4, 1.5, g.c.ink, 5).text('start', -4, 1.5, g.c.ink, { dx: 8, s: 11 });
        },
        read: (s, p) => { const r = descend(p.lr, p.beta); return [['steps', 30], ['final f', r.f > 1e5 ? 'diverged' : num(r.f, 3)], ['plain-descent stability limit α <', '0.1']]; },
        mission: 'Reach f below 0.01 within the 30 steps.',
        goal: (s, p) => descend(p.lr, p.beta).f < 0.01,
        win: { lr: 0.135, beta: 0.4 },
      },
      cards: [
        { q: 'Write the gradient-descent update and explain the role of the learning rate.', a: '$x_{k+1} = x_k − α∇f(x_k)$. $α$ sets the step size: too small is slow, too large overshoots and diverges.' },
        { q: 'Why is plain gradient descent slow on a badly conditioned (ravine-shaped) function, and how does momentum help?', a: 'The step must be small enough for the steep direction, which makes progress along the shallow direction tiny. Momentum averages successive steps: cross-ravine oscillations cancel and along-ravine motion builds up.' },
      ],
      quiz: [
        { q: 'Gradient descent on $f(x) = 5x^2$ uses $α = 0.3$. Starting at $x = 1$, the next iterate is:', num: -2, tol: 0.01, why: '$f′ = 10x = 10$, so $x = 1 − 0.3 × 10 = −2$. It overshot and is now farther from 0: this step size diverges.' },
        { q: 'A training loss bounces up and down and then explodes. The first thing to try is:', choices: ['A larger learning rate', 'A smaller learning rate', 'More momentum', 'More data'], answer: 1, why: 'Growing oscillation is the signature of a step size above the stability limit.' },
      ],
      code: {
        prompt: 'Complete `descend(lr, steps)` for $f(x, y) = (x − 3)^2 + 10(y + 1)^2$. Start at (0, 0), take `steps` gradient-descent steps, and return the final `(x, y)`.',
        starter: 'def descend(lr, steps):\n    x, y = 0.0, 0.0\n    for _ in range(steps):\n        gx = 0.0  # df/dx\n        gy = 0.0  # df/dy\n        x, y = x - lr * gx, y - lr * gy\n    return x, y\n\nprint(descend(0.05, 200))',
        solution: 'def descend(lr, steps):\n    x, y = 0.0, 0.0\n    for _ in range(steps):\n        gx = 2 * (x - 3)\n        gy = 20 * (y + 1)\n        x, y = x - lr * gx, y - lr * gy\n    return x, y\n\nprint(descend(0.05, 200))',
        tests: '_x, _y = descend(0.05, 200)\nassert abs(_x - 3) < 1e-3 and abs(_y + 1) < 1e-3, f"after 200 steps expected about (3, -1), got ({_x:.4f}, {_y:.4f})"\n_x, _y = descend(0.01, 1)\nassert abs(_x - 0.06) < 1e-12 and abs(_y + 0.2) < 1e-12, "one step with lr=0.01 from (0,0) should give (0.06, -0.2)"',
        hint: 'Differentiate each term: $∂f/∂x = 2(x − 3)$ and $∂f/∂y = 20(y + 1)$.',
      },
    },
    {
      id: 'opt-lagrange', skill: 'opt', title: 'Constraints and Lagrange multipliers', pre: ['opt-gradient-descent', 'linalg-vectors'],
      hook: 'Real designs are optimized against a budget: mass, power, cost. The multiplier tells you what one more unit of budget is worth.',
      body: [
        'To maximize $f(x, y)$ while staying on a constraint curve $g(x, y) = c$, walk along the curve. As long as $f$ is still changing, keep going. You stop where the curve runs along a contour of $f$, which is where the two gradients are parallel:',
        { eq: '∇f = λ·∇g' },
        'The scalar $λ$ is the **Lagrange multiplier**. It has a practical meaning: if the constraint is relaxed by a small amount $Δc$, the best achievable $f$ improves by about $λ·Δc$. Engineers call it a sensitivity or shadow price.',
        'In the lab you maximize $f = x + 2y$ on the circle $x^2 + y^2 = 4$. Slide the point around the circle and watch the angle between the two gradient arrows.',
      ],
      sim: {
        h: 330,
        controls: [{ k: 't', label: 'Position on the constraint', min: 0, max: 360, step: 0.5, v: 150, unit: '°' }],
        draw(g, s, p) {
          g.view(-4, 4, -3, 3, { eq: true }).axes({ xl: 'x', yl: 'y' });
          const x = 2 * cos(rad(p.t)), y = 2 * sin(rad(p.t)), f = x + 2 * y;
          g.clip(() => {
            for (let c = -8; c <= 8; c += 1) g.fn(xx => (c - xx) / 2, g.c.b, { w: 1, alpha: 0.35 });
            g.fn(xx => (f - xx) / 2, g.c.b, { w: 2 });
            g.circle(0, 0, 2, g.c.ink, { w: 2.5 });
            g.arrow(x, y, x + 0.6, y + 1.2, g.c.b, { w: 3 }).arrow(x, y, x + x * 0.55, y + y * 0.55, g.c.a, { w: 3 });
          });
          g.dot(x, y, g.c.ink, 6);
          g.note('∇f  (objective)', 'tl', g.c.b).note('∇g  (constraint)', 'tl', g.c.a, 1).note('contours of f = x + 2y', 'br', g.c.b);
        },
        read: (s, p) => { const x = 2 * cos(rad(p.t)), y = 2 * sin(rad(p.t)); return [['f = x + 2y', num(x + 2 * y, 4)], ['angle between gradients', num(abs(wrap(rad(p.t) - atan2(2, 1))) * 180 / PI, 3) + '°'], ['λ if parallel', num(sqrt(5) / 4, 3)]]; },
        mission: 'Find the constrained maximum: slide until the gradients are parallel to within 1.5°.',
        goal: (s, p) => abs(wrap(rad(p.t) - atan2(2, 1))) < rad(1.5),
        win: { t: 63.5 },
      },
      cards: [
        { q: 'State the Lagrange condition for optimizing $f$ subject to $g = c$, and say why it holds.', a: '$∇f = λ∇g$. At the optimum, moving along the constraint cannot change $f$ to first order, so $∇f$ has no component along the constraint: it is parallel to $∇g$.' },
        { q: 'What does the Lagrange multiplier $λ$ mean in practice?', a: 'The sensitivity of the optimum to the constraint: relaxing the constraint by $Δc$ improves the optimal $f$ by about $λΔc$ (a shadow price).' },
      ],
      quiz: [
        { q: 'Maximize $f = xy$ subject to $x + y = 10$. The maximum value of $f$ is:', num: 25, tol: 0.1, why: '$∇f = (y, x) = λ(1, 1)$ gives $x = y = 5$, so $f = 25$.' },
        { q: 'A mass-constrained design has $λ$ = 3 km of range per kilogram. Allowing 2 kg more mass buys roughly:', choices: ['1.5 km', '3 km', '6 km', 'Nothing'], answer: 2, why: '$Δf ≈ λ·Δc = 3 × 2 = 6$ km.' },
      ],
    },
    {
      id: 'opt-nonconvex', skill: 'opt', title: 'Convexity and local minima', pre: ['opt-gradient-descent', 'linalg-least-squares'],
      hook: 'An optimizer reports a minimum. Whether it is the best one or merely the nearest depends on the shape of the problem.',
      body: [
        'A function is **convex** if the straight line between any two points on its graph lies on or above the graph: a single bowl. For convex problems every local minimum is the global minimum, so descent methods cannot be fooled. Least squares is convex, which is one reason it is trusted.',
        'Most engineering problems are **non-convex**: many valleys of different depths. Gradient descent then finds whichever valley contains the starting point.',
        { list: ['**Multi-start**: run from many initial guesses and keep the best.', '**Good initial guesses** from physics or a simpler model.', '**Reformulate** into a convex problem where possible. Powered-descent guidance for landing rockets was made reliable this way.'] },
        'The lab function has several valleys. Each run starts at an open marker and rolls to a filled one.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'x0', label: 'First starting point', min: -4, max: 4, step: 0.1, v: 3 },
          { k: 'n', label: 'Number of starts', min: 1, max: 12, step: 1, v: 1 },
          { k: 'lr', label: 'Learning rate', min: 0.005, max: 0.2, step: 0.005, v: 0.05 },
        ],
        draw(g, s, p) {
          g.view(-4.2, 4.2, -2.5, 4).axes({ xl: 'x', yl: 'f(x)' });
          g.fn(nc, g.c.ink, { w: 2.5 });
          g.dot(NCMIN[0], NCMIN[1], g.c.good, 9, { alpha: 0.25 });
          restarts(p.x0, p.lr, p.n).forEach(([a, b]) => { g.dot(a, nc(a), g.c.panel, 4, { ring: g.c.b }); g.dot(b, nc(b), abs(nc(b) - NCMIN[1]) < 0.01 ? g.c.good : g.c.a, 5); });
          g.note('global minimum', 'tr', g.c.good).note('starts (open) and results (filled)', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const r = restarts(p.x0, p.lr, p.n), best = min(...r.map(q => nc(q[1]))); return [['best f found', num(best, 4)], ['global minimum', num(NCMIN[1], 4)], ['distinct valleys found', new Set(r.map(q => Math.round(q[1] * 4))).size]]; },
        mission: 'Find the global minimum: best result within 0.01 of the lowest value.',
        goal: (s, p) => min(...restarts(p.x0, p.lr, p.n).map(q => nc(q[1]))) - NCMIN[1] < 0.01,
        win: { n: 12 },
      },
      cards: [
        { q: 'What makes a function convex, and why does it matter for optimization?', a: 'The chord between any two points on its graph lies on or above the graph. Any local minimum is then global, so descent methods reliably find the best answer.' },
        { q: 'Name two ways to cope with a non-convex optimization problem.', a: 'Multi-start (many initial guesses, keep the best), better initial guesses from physics or simpler models, or reformulating/relaxing the problem into a convex one.' },
      ],
      quiz: [
        { q: 'Which function is convex?', choices: ['$sin x$', '$x^2 + 3x$', '$x^3$', '$−x^2$'], answer: 1, why: 'A parabola opening upward is a single bowl. $sin x$ and $x^3$ change curvature; $−x^2$ is concave.' },
        { q: 'Gradient descent on a non-convex function returns a point with zero gradient. You can conclude it is:', choices: ['The global minimum', 'A stationary point: possibly a local minimum or saddle', 'A maximum', 'An error'], answer: 1, why: 'Zero gradient only certifies a stationary point. Without convexity there is no guarantee it is the best one.' },
      ],
    },
    {
      id: 'calc-multiple-integrals', skill: 'calc', title: 'Double integrals: mass and center of gravity', pre: ['calc-integral', 'mech-rotation', 'prop-rocket-eq'],
      hook: 'As a rocket burns propellant its center of gravity moves. If it slides behind the center of pressure, the vehicle swaps ends.',
      body: [
        'A double integral adds up a quantity spread over an area. With density $ρ(x, y)$, total mass and the center of gravity are',
        { eq: 'M = ∬ρ dA,   x̄ = (1/M)·∬x·ρ dA' },
        'On a computer the area is cut into cells and each cell contributes (density at its center) × (cell area). More cells, less error, exactly as with Riemann sums in one dimension.',
        'For a finned rocket to be statically stable, the **center of gravity (CG)** must stay ahead of the **center of pressure (CP)**, where the aerodynamic forces act. The distance between them is the static margin.',
        'In the lab, propellant drains from the top of the tank toward the tail. Watch the CG move as the tank empties, and see how nose ballast shifts the whole curve.',
      ],
      sim: {
        h: 340,
        controls: [
          { k: 'f', label: 'Propellant remaining', min: 0, max: 100, step: 1, v: 100, unit: '%' },
          { k: 'mp', label: 'Nose payload / ballast', min: 0, max: 600, step: 10, v: 0, unit: 'kg' },
          { k: 'n', label: 'Integration cells', min: 6, max: 120, step: 6, v: 12 },
        ],
        draw(g, s, p) {
          const f = p.f / 100, gr = cgGrid(f, p.mp, p.n);
          g.view(-0.4, 7.2, -1.4, 1.4, { pad: [10, 8, 10, 190] });
          for (let i = 0; i < p.n; i++) { const x = (i + 0.5) * 6 / p.n, d = dens(x, f, p.mp); g.rect(i * 6 / p.n, -0.5, 6 / p.n, 1, g.ramp(min(1, d / 500)), { stroke: g.c.grid }); }
          g.path([[6, -0.5], [7, 0], [6, 0.5]], g.c.dim, { fill: true, fa: 0.4, close: true, w: 1.5 }).path([[0, -0.5], [-0.3, -1.1], [0.9, -0.5]], g.c.dim, { fill: true, fa: 0.5, close: true, w: 1.5 }).path([[0, 0.5], [-0.3, 1.1], [0.9, 0.5]], g.c.dim, { fill: true, fa: 0.5, close: true, w: 1.5 });
          g.line(CP, -1.2, CP, 1.2, g.c.bad, { w: 2, dash: [5, 4] }).text('CP', CP, 1.3, g.c.bad, { a: 'center', s: 11, bold: true });
          g.dot(gr.cg, 0, g.c.ink, 8, { ring: g.c.panel }).text('CG', gr.cg, -0.85, g.c.ink, { a: 'center', s: 11, bold: true });
          g.text('tail', 0, 0.8, g.c.dim, { s: 10.5 }).text('nose →', 6.2, 0.8, g.c.dim, { s: 10.5 });
          g.view(0, 100, 1.6, 4.4, { pad: [48, g.h - 176, 14, 30] }).axes({ xl: 'propellant remaining (%)', yl: 'CG position (m from tail)' });
          g.rect(0, 1.6, 100, CP - 1.6, g.c.bad, { fa: 0.1 }).line(0, CP, 100, CP, g.c.bad, { w: 1.5, dash: [5, 4] });
          g.fn(x => cgExact(x / 100, p.mp), g.c.a, { w: 2.5 });
          g.dot(p.f, gr.cg, g.c.ink, 5);
        },
        read: (s, p) => { const f = p.f / 100, gr = cgGrid(f, p.mp, p.n); return [['mass', num(gr.M, 4) + ' kg'], ['CG from grid sum', num(gr.cg, 4) + ' m'], ['exact', num(cgExact(f, p.mp), 4) + ' m'], ['smallest margin over the burn', num(minMargin(p.mp), 3) + ' m']]; },
        mission: 'Add the least nose ballast (to within 50 kg) that keeps the CG at least 0.30 m ahead of the CP at every propellant level.',
        goal: (s, p) => minMargin(p.mp) >= 0.3 && minMargin(p.mp - 50) < 0.3,
        win: { mp: 300 },
      },
      cards: [
        { q: 'Write the double integrals for the mass and the x-coordinate of the center of gravity of a plate with density $ρ(x, y)$.', a: '$M = ∬ρ dA$ and $x̄ = (1/M)∬xρ dA$.' },
        { q: 'What is the static stability condition for a finned rocket, in terms of CG and CP?', a: 'The center of gravity must be ahead of (closer to the nose than) the center of pressure. The gap is the static margin.' },
      ],
      quiz: [
        { q: 'A 2 m rod has 3 kg concentrated at $x$ = 0 and 1 kg at $x$ = 2 m. Where is its center of gravity?', num: 0.5, unit: 'm', tol: 0.01, why: '$x̄ = (3 × 0 + 1 × 2)/4 = 0.5$ m.' },
        { q: 'Doubling the number of cells in each direction of a midpoint-rule double integral changes the cell count and the error by about:', choices: ['2× cells, ½ error', '4× cells, ¼ error', '4× cells, ½ error', '2× cells, ¼ error'], answer: 1, why: 'Cells go as $n^2$. Midpoint error goes as (cell size)$^2$, so halving the size quarters it.' },
      ],
    },
    {
      id: 'calc-vector-fields', skill: 'calc', title: 'Vector fields: divergence, curl and flux', pre: ['calc-gradient', 'calc-multiple-integrals'],
      hook: 'Maxwell’s equations and the theory of lift are written in two words: divergence and curl.',
      body: [
        'A **vector field** attaches a vector to every point: wind velocity, electric field, heat flow. Two derivatives describe its local behavior.',
        { list: ['**Divergence** $∇·F$: net outflow per unit area. Positive at a source, negative at a sink.', '**Curl** $∇×F$: rotation per unit area. A paddle wheel dropped in the flow spins where the curl is nonzero.'] },
        'Two integrals describe a region as a whole. **Flux** is the total flow out through a closed loop; **circulation** is the total flow along it. They are tied to the derivatives by two great theorems:',
        { eq: 'flux = ∬(∇·F) dA,   circulation = ∬(∇×F) dA', where: 'the divergence theorem and Stokes’ theorem, in 2-D' },
        'Lift on a wing is proportional to circulation around it. Gauss’s law says electric flux out of a surface counts the charge inside. You will use both.',
      ],
      labNote: 'Drag the loop. Particles show the flow.',
      sim: {
        h: 330,
        controls: [
          { k: 'a', label: 'Source strength', min: -1, max: 1, step: 0.1, v: 0.5 },
          { k: 'b', label: 'Vortex strength', min: -1, max: 1, step: 0.1, v: 0 },
          { k: 'c', label: 'Uniform stream', min: 0, max: 1, step: 0.1, v: 0 },
        ],
        init: () => { const r = rng(9); return { lx: 0, ly: 0, r, pt: Array.from({ length: 90 }, () => [r() * 8 - 4, r() * 6 - 3, r() * 3]) }; },
        drag(s, p, x, y) { s.lx = clamp(x, -3, 3); s.ly = clamp(y, -2, 2); },
        step(s, p, dt) { s.pt.forEach(q => { q[0] += (p.a * q[0] - p.b * q[1] + p.c) * dt; q[1] += (p.a * q[1] + p.b * q[0]) * dt; q[2] += dt; if (q[2] > 3 || abs(q[0]) > 4.2 || abs(q[1]) > 3.2) { q[0] = s.r() * 8 - 4; q[1] = s.r() * 6 - 3; q[2] = 0; } }); },
        draw(g, s, p) {
          g.view(-4, 4, -3, 3, { eq: true, pad: [10, 10, 10, 10] });
          const F = (x, y) => [p.a * x - p.b * y + p.c, p.a * y + p.b * x];
          for (let x = -3.5; x <= 3.5; x += 0.7) for (let y = -2.8; y <= 2.8; y += 0.7) { const [u, v] = F(x, y); g.arrow(x, y, x + u * 0.22, y + v * 0.22, g.c.dim, { w: 1, head: 5, alpha: 0.7 }); }
          s.pt.forEach(q => g.dot(q[0], q[1], g.c.b, 2, { alpha: min(1, q[2], 3 - q[2]) * 0.8 }));
          g.circle(s.lx, s.ly, 1.2, g.c.a, { w: 2.5 });
        },
        read: (s, p) => { const fl = flux(s, p); return [['divergence', 2 * p.a], ['curl', 2 * p.b], ['flux out of loop', num(fl[0], 3)], ['circulation', num(fl[1], 3)]]; },
        mission: 'Create a flow with zero net flux through the loop but counter-clockwise circulation greater than 5.',
        goal: (s, p) => { const fl = flux(s, p); return abs(fl[0]) < 0.05 && fl[1] > 5; },
        win: { a: 0, b: 0.8 },
      },
      cards: [
        { q: 'What do divergence and curl measure about a vector field?', a: 'Divergence: net outflow per unit area (sources and sinks). Curl: local rotation per unit area.' },
        { q: 'State the divergence theorem and Stokes’ theorem in words.', a: 'Total flux out through a closed boundary equals the integral of divergence over the region inside. Total circulation around a closed loop equals the integral of curl over the surface it bounds.' },
      ],
      quiz: [
        { q: 'The field $F = (x, y)$ has divergence:', num: 2, tol: 0.01, why: '$∂x/∂x + ∂y/∂y = 1 + 1 = 2$ everywhere: a uniform source.' },
        { q: 'A uniform wind blows straight through a closed loop. The net flux through the loop is:', choices: ['Positive', 'Negative', 'Zero', 'Depends on wind speed'], answer: 2, why: 'A uniform field has zero divergence: what enters one side leaves the other.' },
      ],
    },
    {
      id: 'trajopt-bang-bang', skill: 'trajopt', title: 'Optimal control: time against fuel', pre: ['mech-kinematics', 'opt-lagrange', 'num-root-finding'],
      hook: 'Getting there is easy. Getting there on time, with the propellant you have and inside the limits of the hardware, is trajectory optimization.',
      body: [
        'An optimal control problem asks for the control history $u(t)$ that minimizes a cost while obeying the dynamics and limits. Even the simplest case is instructive: move a vehicle from rest to rest over a fixed distance with thrust limited to $±a_{max}$.',
        { list: ['**Minimum time**: full thrust forward, then full thrust back, with one switch. This is **bang-bang** control.', '**Minimum fuel** (with a time limit): burn, **coast**, burn. Shorter burns separated by a coast cost time and save propellant.'] },
        'The answer always rides the limits. That is a general feature: optimal trajectories tend to sit on constraints, which is why real ones are checked so carefully against them.',
        'Solving for the switch times that hit the end conditions is root finding. Guess, simulate, correct: the **shooting method**. In the lab you do the shooting by hand.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 't1', label: 'End of first burn', min: 0.5, max: 10, step: 0.05, v: 5, unit: 's' },
          { k: 't2', label: 'Start of braking burn', min: 1, max: 20, step: 0.05, v: 5, unit: 's' },
        ],
        draw(g, s, p) {
          const t1 = p.t1, t2 = max(p.t1, p.t2), T = t1 + t2, X = 2 * t1 * t2;
          const x = t => (t < t1 ? t * t : t < t2 ? t1 * t1 + 2 * t1 * (t - t1) : t < T ? X - (T - t) ** 2 : X);
          g.view(0, 30, 0, 220, { pad: [44, 12, 14, 110] }).axes({ yl: 'position (m)', xt: false });
          g.line(0, 100, 30, 100, g.c.good, { w: 1.5, dash: [6, 4] }).line(20, 0, 20, 220, g.c.bad, { w: 1, dash: [4, 4] }).text('time limit', 20.3, 205, g.c.bad, { s: 10.5 }).text('target 100 m', 29.8, 110, g.c.good, { a: 'right', s: 10.5 });
          g.fn(x, g.c.a, { w: 2.5, n: 400 });
          g.view(0, 30, -2.6, 2.6, { pad: [44, g.h - 96, 14, 30] }).axes({ xl: 't (s)', yl: 'thrust accel (m/s²)', ys: 2 });
          g.rect(0, 0, t1, 2, g.c.b, { fa: 0.6 }).rect(t2, -2, t1, 2, g.c.b, { fa: 0.6 });
          if (t2 > t1 + 0.4) g.text('coast', (t1 + t2) / 2, 0.7, g.c.dim, { a: 'center', s: 11 });
        },
        read: (s, p) => { const t2 = max(p.t1, p.t2); return [['stops at', num(2 * p.t1 * t2, 4) + ' m'], ['arrival time', num(p.t1 + t2, 4) + ' s'], ['total burn time', num(2 * p.t1, 3) + ' s']]; },
        mission: 'Stop within 1 m of the 100 m target, inside 20 s, using no more than 6.2 s of total burn.',
        goal: (s, p) => { const t2 = max(p.t1, p.t2); return abs(2 * p.t1 * t2 - 100) <= 1 && p.t1 + t2 <= 20 && 2 * p.t1 <= 6.2; },
        win: { t1: 3, t2: 16.65 },
      },
      cards: [
        { q: 'What is bang-bang control and when is it optimal?', a: 'Control that sits at its limits and switches between them. It is the minimum-time solution for systems with bounded control, such as a rest-to-rest move with limited thrust.' },
        { q: 'How does a minimum-fuel trajectory with a time limit differ from a minimum-time one?', a: 'It inserts a coast: burn, coast, burn. Shorter burns use less propellant at the price of a longer transfer.' },
        { q: 'What is the shooting method?', a: 'Guess the unknown control parameters or initial conditions, simulate forward, measure the miss at the end, and correct the guess with a root finder until the end conditions are met.' },
      ],
      quiz: [
        { q: 'With $a_{max}$ = 2 m/s², what is the minimum time for a rest-to-rest move of 100 m?', num: 14.1, unit: 's', tol: 0.15, why: 'Accelerate over 50 m: $50 = ½·2·t^2$ gives $t = 7.07$ s, then mirror it to brake. Total 14.1 s.' },
        { q: 'Why do optimal trajectories usually lie on at least one constraint boundary?', choices: ['Solvers are imprecise', 'If no limit were active, the cost could still be improved by pushing harder', 'Constraints are always wrong', 'It reduces computation'], answer: 1, why: 'Slack in every limit means unused capability. The optimum uses it until something binds.' },
      ],
    },
    {
      id: 'trajopt-pronav', skill: 'trajopt', title: 'Intercept geometry and proportional navigation', pre: ['trajopt-bang-bang', 'linalg-vectors', 'control-feedback'],
      hook: 'Sailors knew it centuries ago: if another ship stays on a constant bearing while the range closes, you will collide.',
      body: [
        'Two objects are on a **collision course** when the line of sight (LOS) between them does not rotate. That turns interception into a feedback problem: measure the LOS rotation rate $λ̇$ and drive it to zero.',
        { eq: 'a_{cmd} = N·V_c·λ̇', where: '$V_c$ = closing speed, $N$ = navigation constant, typically 3 to 5' },
        'This is **proportional navigation**, the basis of most homing guidance since the 1950s. Compare it with **pure pursuit**, which simply points at the target: pursuit ends in a tail chase and demands its hardest turn at the very end, when there is no time left.',
        'Proportional navigation leads the target and does its turning early. Against a constant-velocity target it flies an almost straight line. A maneuvering target forces more acceleration; higher $N$ corrects sooner at the cost of amplifying sensor noise.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'law', type: 'select', label: 'Guidance law', v: 'pursuit', options: [['pursuit', 'Pure pursuit'], ['pn', 'Proportional navigation']] },
          { k: 'N', label: 'Navigation constant N', min: 1, max: 6, step: 0.25, v: 3 },
          { k: 'gT', label: 'Target turn', min: 0, max: 6, step: 0.5, v: 3, unit: 'g' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 2.5; },
        draw(g, s, p) {
          const r = engage(p.law, p.N, p.gT);
          g.view(-500, 9500, -2500, 6500, { eq: true }).axes({ xl: 'downrange (m)', yl: 'crossrange (m)' });
          const i = min(r.pm.length - 1, Math.floor((s.t % (r.tf + 1.5)) / 0.1));
          g.clip(() => {
            g.path(r.pt, g.c.b, { w: 1.5, dash: [5, 4] }).path(r.pm, g.c.a, { w: 1.5, dash: [5, 4] });
            g.path(r.pt.slice(0, i + 1), g.c.b, { w: 2.5 }).path(r.pm.slice(0, i + 1), g.c.a, { w: 2.5 });
            g.line(...r.pm[i], ...r.pt[i], g.c.dim, { w: 1 });
            g.dot(...r.pm[i], g.c.a, 5).dot(...r.pt[i], g.c.b, 5);
          });
          g.note('pursuer 600 m/s', 'tl', g.c.a).note('target 300 m/s', 'tl', g.c.b, 1).note('line of sight', 'tl', g.c.dim, 2);
        },
        read: (s, p) => { const r = engage(p.law, p.N, p.gT); return [['miss distance', num(r.miss, 3) + ' m'], ['peak lateral acceleration', num(r.g, 3) + ' g'], ['flight time', num(r.tf, 3) + ' s']]; },
        mission: 'Against a target turning at 3 g or more, close to within 1 m while keeping peak acceleration under 12 g.',
        goal: (s, p) => { const r = engage(p.law, p.N, p.gT); return p.gT >= 3 && r.miss < 1 && r.g < 12; },
        win: { law: 'pn', N: 4, gT: 3 },
      },
      cards: [
        { q: 'What geometric condition means two moving objects will collide?', a: 'The line of sight between them does not rotate (constant bearing) while the range decreases.' },
        { q: 'Write the proportional navigation law and define its terms.', a: '$a_{cmd} = N V_c λ̇$: commanded lateral acceleration equals the navigation constant (about 3–5) times closing speed times line-of-sight rate.' },
        { q: 'Why does pure pursuit perform worse than proportional navigation?', a: 'Pointing at the target always lags a moving one, producing a tail chase in which the required turn rate grows toward the end. PN leads the target and turns early.' },
      ],
      quiz: [
        { q: 'Closing speed is 900 m/s, the LOS rotates at 0.01 rad/s and $N$ = 4. What lateral acceleration is commanded?', num: 36, unit: 'm/s²', tol: 0.4, why: '$4 × 900 × 0.01 = 36$ m/s², about 3.7 g.' },
        { q: 'The LOS rate to a target is exactly zero and range is closing. The correct command is:', choices: ['Maximum turn toward the target', 'No lateral acceleration', 'Turn away', 'Slow down'], answer: 1, why: 'Zero LOS rate with closing range is already a collision course. Any turn would spoil it.' },
      ],
    },
    {
      id: 'num-finite-diff', skill: 'nummeth', title: 'Numerical derivatives and floating point', pre: ['calc-taylor', 'num-root-finding'],
      hook: 'A computer holds about 16 significant digits. Subtracting two nearly equal numbers can throw most of them away.',
      body: [
        'To differentiate a function you can only evaluate, use a finite difference. Taylor series give the error of each formula:',
        { list: ['**Forward**: $(f(x+h) − f(x))/h$, truncation error ∝ $h$.', '**Central**: $(f(x+h) − f(x−h))/2h$, truncation error ∝ $h^2$.'] },
        'So make $h$ tiny? No. A double-precision number carries a relative **round-off** error of about $10^{−16}$. The subtraction $f(x+h) − f(x)$ cancels the leading digits, and dividing by $h$ magnifies what is left: round-off error ∝ $10^{−16}/h$.',
        'Total error is a V on a log–log plot: truncation falls as $h$ shrinks, round-off rises. The best $h$ is near $10^{−8}$ for forward differences and $10^{−5}$ for central ones. The same cancellation hazard lurks in any formula that subtracts similar numbers.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'm', type: 'select', label: 'Formula', v: 'fwd', options: [['fwd', 'Forward difference'], ['cen', 'Central difference']] },
          { k: 'lh', label: 'Step size h', min: -15, max: 0, step: 0.25, v: -1, fmt: v => num(10 ** v, 2) },
        ],
        draw(g, s, p) {
          const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');
          g.view(-15, 0, -13, 1).axes({ xl: 'step h', yl: 'error in d/dx sin(x) at x = 1', xf: pw, yf: pw, xs: 3, ys: 2 });
          const curve = m => { const pts = []; for (let lh = -15; lh <= 0; lh += 0.1) pts.push([lh, log10(max(1e-17, fdErr(m, lh)))]); return pts; };
          g.clip(() => { g.path(curve('fwd'), g.c.b, { w: p.m === 'fwd' ? 2.5 : 1.2, alpha: p.m === 'fwd' ? 1 : 0.5 }); g.path(curve('cen'), g.c.c, { w: p.m === 'cen' ? 2.5 : 1.2, alpha: p.m === 'cen' ? 1 : 0.5 }); });
          g.dot(p.lh, clamp(log10(max(1e-17, fdErr(p.m, p.lh))), -13, 1), g.c.a, 6);
          g.note('forward', 'tr', g.c.b).note('central', 'tr', g.c.c, 1).note('round-off dominates  ←', 'bl', g.c.dim).note('→  truncation dominates', 'br', g.c.dim);
        },
        read: (s, p) => [['h', num(10 ** p.lh, 2)], ['error', num(fdErr(p.m, p.lh), 2)]],
        mission: 'Get the derivative error below 10⁻¹⁰.',
        goal: (s, p) => fdErr(p.m, p.lh) < 1e-10,
        win: { m: 'cen', lh: -5 },
      },
      cards: [
        { q: 'Give the central difference formula and its truncation error order.', a: '$f′(x) ≈ (f(x+h) − f(x−h))/2h$, with error ∝ $h^2$ (forward difference is only ∝ $h$).' },
        { q: 'Why does making $h$ extremely small ruin a finite-difference derivative?', a: 'Subtracting nearly equal values cancels the leading digits, leaving round-off of about $10^{−16}$, which dividing by $h$ magnifies. Round-off error grows like $ε/h$.' },
      ],
      quiz: [
        { q: 'Central-difference error is $10^{−6}$ at $h = 10^{−3}$ (truncation dominated). At $h = 10^{−4}$ it is about:', choices: ['10⁻⁷', '10⁻⁸', '10⁻¹⁰', '10⁻⁶'], answer: 1, why: 'Second order: ten times smaller $h$ gives a hundred times smaller error.' },
        { q: 'In double precision, $(1 + 10^{−17}) − 1$ evaluates to:', choices: ['10⁻¹⁷', '0', '10⁻¹⁶', '1'], answer: 1, why: '$10^{−17}$ is below the spacing of doubles near 1 (about $2.2 × 10^{−16}$), so the sum rounds back to exactly 1.' },
      ],
      code: {
        prompt: 'The starter uses a forward difference. Change `deriv(f, x, h)` to a central difference so it passes a tighter accuracy check.',
        starter: 'import math\n\ndef deriv(f, x, h):\n    return (f(x + h) - f(x)) / h\n\nprint(deriv(math.sin, 1.0, 1e-5), math.cos(1.0))',
        solution: 'import math\n\ndef deriv(f, x, h):\n    return (f(x + h) - f(x - h)) / (2 * h)\n\nprint(deriv(math.sin, 1.0, 1e-5), math.cos(1.0))',
        tests: 'import math\nassert abs(deriv(math.sin, 1.0, 1e-5) - math.cos(1.0)) < 1e-9, "not accurate enough: is it a central difference?"\nassert abs(deriv(lambda x: x ** 3, 2.0, 1e-3) - 12.0) < 1e-5, "d/dx x^3 at 2 should be 12 to within 1e-5"',
        hint: 'Evaluate on both sides: `(f(x + h) - f(x - h)) / (2 * h)`.',
      },
    },
  ],
};

function flux(s, p) {
  let fl = 0, ci = 0; const R = 1.2, n = 96;
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n * 2 * PI, x = s.lx + R * cos(t), y = s.ly + R * sin(t), u = p.a * x - p.b * y + p.c, v = p.a * y + p.b * x, ds = 2 * PI * R / n; fl += (u * cos(t) + v * sin(t)) * ds; ci += (-u * sin(t) + v * cos(t)) * ds; }
  return [fl, ci];
}
