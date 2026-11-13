import { tracer, rk4, num } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, hypot, log } = Math;

// --- helpers used by the sims in this unit ---
const f1 = x => sin(x) + 0.3 * x, df1 = x => cos(x) + 0.3;

export function shot(v0, deg, k) {
  let x = 0, y = 0, vx = v0 * cos(deg * PI / 180), vy = v0 * sin(deg * PI / 180), t = 0, apex = 0;
  const pts = [[0, 0, vx, vy]], dt = 0.01;
  while (y >= 0 && t < 60) {
    const v = hypot(vx, vy);
    vx += -k * v * vx * dt; vy += (-9.81 - k * v * vy) * dt;
    x += vx * dt; y += vy * dt; t += dt; apex = Math.max(apex, y);
    pts.push([x, y, vx, vy]);
  }
  return { pts, range: x, apex, t };
}

const vel = t => 20 + 15 * sin(0.8 * t);
const velExact = T => 20 * T + 15 * (1 - cos(0.8 * T)) / 0.8;
export function riemann(n, method, T = 8) {
  const h = T / n; let s = 0;
  for (let i = 0; i < n; i++) {
    const a = i * h, b = a + h;
    s += h * (method === 'left' ? vel(a) : method === 'right' ? vel(b) : method === 'mid' ? vel((a + b) / 2) : (vel(a) + vel(b)) / 2);
  }
  return s;
}

export function stepResponse(z, wn, T = 4, n = 800) {
  let y = [0, 0]; const h = T / n, pts = [[0, 0]];
  let peak = 0, settle = 0;
  for (let i = 1; i <= n; i++) {
    y = rk4(s => [s[1], wn * wn * (1 - s[0]) - 2 * z * wn * s[1]], y, 0, h);
    pts.push([i * h, y[0]]); peak = Math.max(peak, y[0]);
    if (abs(y[0] - 1) > 0.02) settle = i * h;
  }
  return { pts, overshoot: Math.max(0, (peak - 1) * 100), settle };
}

export function integrate(method, dt, T = 10) {
  const w = 2 * PI; let x = 1, v = 0; const pts = [[0, 1]];
  const n = Math.round(T / dt);
  for (let i = 1; i <= n; i++) {
    if (method === 'euler') { const a = -w * w * x; x += v * dt; v += a * dt; }
    else if (method === 'symp') { v += -w * w * x * dt; x += v * dt; }
    else { [x, v] = rk4(s => [s[1], -w * w * s[0]], [x, v], 0, dt); }
    pts.push([i * dt, x]);
    if (abs(x) > 1e6) break;
  }
  const E = 0.5 * v * v + 0.5 * w * w * x * x, E0 = 0.5 * w * w;
  return { pts, err: (E - E0) / E0 * 100 };
}

const git = {
  isAnc(s, a, b) { const st = [b], seen = new Set(); while (st.length) { const c = st.pop(); if (c === a) return true; if (seen.has(c)) continue; seen.add(c); st.push(...s.commits[c].parents); } return false; },
  commit(s) { if (s.commits.length >= 14) { s.msg = 'Graph is full. Restart to try again.'; return; } const id = s.commits.length; s.commits.push({ id, parents: [s.br[s.head]], lane: s.head === 'main' ? 0 : 1 }); s.br[s.head] = id; s.msg = `commit on ${s.head}`; },
  branch(s) { if (s.br.feature != null) { s.msg = 'feature already exists'; return; } s.br.feature = s.br[s.head]; s.head = 'feature'; s.msg = 'created feature and switched to it'; },
  sw(s) { if (s.br.feature == null) { s.msg = 'only one branch so far'; return; } s.head = s.head === 'main' ? 'feature' : 'main'; s.msg = `switched to ${s.head}`; },
  merge(s) {
    const other = s.head === 'main' ? 'feature' : 'main';
    if (s.br[other] == null) { s.msg = 'nothing to merge yet'; return; }
    const a = s.br[s.head], b = s.br[other];
    if (a === b || git.isAnc(s, b, a)) { s.msg = 'already up to date'; return; }
    if (git.isAnc(s, a, b)) { s.br[s.head] = b; s.msg = `fast-forward: ${s.head} just moved its pointer`; return; }
    if (s.commits.length >= 14) { s.msg = 'Graph is full. Restart to try again.'; return; }
    const id = s.commits.length; s.commits.push({ id, parents: [a, b], lane: s.head === 'main' ? 0 : 1 }); s.br[s.head] = id; s.msg = `merge commit: two parents`;
  },
};

export default {
  id: 'u01', title: 'Motion', blurb: 'Rates, accumulation, springs and the first simulations.',
  lessons: [
    {
      id: 'calc-derivative', skill: 'calc', title: 'The derivative is a local straight line',
      hook: 'Every guidance law, filter and simulator in this course works by pretending a curve is a line for a very short step.',
      body: [
        'You already compute derivatives. The engineering habit is to read $f′(x_0)$ as a **replacement**: near $x_0$, swap the real curve for the line through $(x_0, f(x_0))$ with slope $f′(x_0)$.',
        { eq: 'f(x_0 + h) ≈ f(x_0) + f′(x_0)·h', where: 'the linear approximation; the error shrinks like $h^2$' },
        'A secant through two samples is what a computer or a sensor can measure. As the spacing $h$ shrinks, the secant slope converges on the tangent slope. The gap between them is about $½·f″(x_0)·h$, so halving $h$ halves the error.',
        'This is why a flight computer running at 1 kHz can treat nonlinear aerodynamics as linear between ticks, and why the same trick fails when $h$ is large or the curve bends sharply.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'x0', label: 'Point x₀', min: -3, max: 3, step: 0.05, v: 0.5 },
          { k: 'h', label: 'Sample spacing h', min: 0.01, max: 2, step: 0.01, v: 1.5 },
        ],
        draw(g, s, p) {
          g.view(-4, 5, -2.5, 3).axes({ xl: 'x', yl: 'f(x) = sin x + 0.3x' });
          g.fn(f1, g.c.ink, { w: 2.5 });
          const m = df1(p.x0), ms = (f1(p.x0 + p.h) - f1(p.x0)) / p.h;
          g.fn(x => f1(p.x0) + m * (x - p.x0), g.c.a, { w: 1.5 });
          g.fn(x => f1(p.x0) + ms * (x - p.x0), g.c.b, { w: 1.5, dash: [6, 4] });
          g.dot(p.x0, f1(p.x0), g.c.a, 5).dot(p.x0 + p.h, f1(p.x0 + p.h), g.c.b, 5);
          g.note('tangent (true slope)', 'tr', g.c.a).note('secant (measured slope)', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const m = df1(p.x0), ms = (f1(p.x0 + p.h) - f1(p.x0)) / p.h; return [['tangent slope', m], ['secant slope', ms], ['error', abs(ms - m)]]; },
        mission: 'Find a point where the curve is falling, then shrink h until the secant slope is within 0.01 of the tangent slope.',
        goal: (s, p) => df1(p.x0) < -0.05 && abs((f1(p.x0 + p.h) - f1(p.x0)) / p.h - df1(p.x0)) < 0.01,
        win: { x0: 2.5, h: 0.01 },
      },
      cards: [
        { q: 'State the linear approximation of $f$ near $x_0$, and say how its error scales with the step $h$.', a: '$f(x_0+h) ≈ f(x_0) + f′(x_0)·h$. The error is about $½f″(x_0)h^2$, so it shrinks with the square of the step.' },
        { q: 'A secant slope uses two samples a distance $h$ apart. How wrong is it compared with the true derivative?', a: 'By about $½·f″·h$: proportional to the spacing and to how sharply the curve bends.' },
      ],
      quiz: [
        { q: 'A velocity estimate from two position samples 0.1 s apart has error 0.4 m/s. Sampling 0.025 s apart should give an error near:', choices: ['0.4 m/s', '0.1 m/s', '0.025 m/s', '0.2 m/s'], answer: 1, why: 'Secant error is proportional to $h$. A quarter of the spacing gives a quarter of the error.' },
        { q: '$f(2) = 10$ and $f′(2) = -3$. Use the linear approximation to estimate $f(2.1)$.', num: 9.7, tol: 0.01, why: '$10 + (-3)(0.1) = 9.7$.' },
      ],
    },
    {
      id: 'mech-kinematics', skill: 'mech', title: 'Position, velocity, acceleration: one chain', pre: ['calc-derivative'],
      hook: 'Ballistics is calculus applied twice: forces set acceleration, and integrating twice gives where the object lands.',
      body: [
        'In AP Physics 1 the kinematic equations arrive as formulas. With calculus they are one idea: $v = dx/dt$ and $a = dv/dt$. Constant $a$ integrates to $v = v_0 + at$ and $x = x_0 + v_0t + ½at^2$.',
        'In two dimensions the axes are independent. Without air, horizontal velocity stays constant and vertical velocity falls at $g$, giving a parabola with range $R = v_0^2·sin(2θ)/g$.',
        'Real projectiles feel drag, roughly $a_{drag} = -k·|v|·v$. Now acceleration depends on velocity, the equations no longer integrate by hand, and the path is found by stepping forward in small time increments. The lab does exactly that.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'v0', label: 'Launch speed', min: 20, max: 80, step: 0.5, v: 50, unit: 'm/s' },
          { k: 'ang', label: 'Elevation', min: 5, max: 85, step: 0.5, v: 30, unit: '°' },
          { k: 'drag', type: 'toggle', label: 'Air drag', v: false },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 1.5; },
        draw(g, s, p) {
          g.view(0, 520, 0, 260, { eq: true }).axes({ xl: 'range (m)', yl: 'height (m)' });
          const vac = shot(p.v0, p.ang, 0), real = shot(p.v0, p.ang, p.drag ? 0.0015 : 0);
          g.clip(() => {
            if (p.drag) g.path(vac.pts, g.c.dim, { w: 1.5, dash: [5, 5] });
            g.path(real.pts, g.c.a, { w: 2.5 });
            const i = Math.min(real.pts.length - 1, Math.floor((s.t % (real.t + 0.6)) / 0.01));
            const [x, y, vx, vy] = real.pts[i];
            g.arrow(x, y, x + vx * 0.8, y, g.c.b, { w: 1.5 }).arrow(x, y, x, y + vy * 0.8, g.c.c, { w: 1.5 });
            g.dot(x, y, g.c.ink, 5);
          });
          g.line(300, 0, 300, 14, g.c.good, { w: 4 }).text('target 300 m', 300, 26, g.c.good, { a: 'center', s: 11 });
          g.note('vₓ', 'tr', g.c.b).note('v_y', 'tr', g.c.c, 1);
        },
        read: (s, p) => { const r = shot(p.v0, p.ang, p.drag ? 0.0015 : 0); return [['range', num(r.range, 4) + ' m'], ['apex', num(r.apex) + ' m'], ['flight time', num(r.t) + ' s']]; },
        mission: 'Turn air drag on and land within 3 m of the 300 m target.',
        goal: (s, p) => p.drag && abs(shot(p.v0, p.ang, 0.0015).range - 300) < 3,
        win: { drag: true, v0: 66, ang: 44.5 },
      },
      cards: [
        { q: 'How are position, velocity and acceleration related by calculus?', a: '$v = dx/dt$ and $a = dv/dt$. Going the other way, velocity is the integral of acceleration and position is the integral of velocity.' },
        { q: 'Why can a drag-free trajectory be solved by hand while one with drag usually cannot?', a: 'Without drag, acceleration is constant so it integrates directly. With drag, acceleration depends on velocity ($-k|v|v$), which couples the equations; you step them numerically.' },
      ],
      quiz: [
        { q: 'With drag on, the launch angle for maximum range is:', choices: ['Exactly 45°', 'Below 45°', 'Above 45°', 'Independent of drag'], answer: 1, why: 'Drag punishes time in the air and high speeds, so a flatter shot than 45° goes farthest. Try it in the lab.' },
        { q: 'No drag, $g = 9.81$ m/s². A projectile leaves at 60 m/s and 45°. What is its range?', num: 367, unit: 'm', tol: 4, why: '$R = v_0^2 sin(2θ)/g = 3600/9.81 ≈ 367$ m.' },
      ],
    },
    {
      id: 'py-basics', skill: 'python', title: 'Python: state, loops, functions', pre: ['mech-kinematics'],
      hook: 'Simulation code is a loop that updates a few numbers. Read it the way the machine does: one line, one change.',
      body: [
        'Python is the working language for analysis, simulation and test scripts across aerospace. Three ideas carry most of it: **names** bind to values, a **loop** repeats a block, and a **function** packages a block behind a name.',
        { code: 'def kinetic_energy(m, v):\n    return 0.5 * m * v ** 2\n\nfor v in [10, 20, 30]:\n    print(v, kinetic_energy(2.0, v))', lang: 'python' },
        'Indentation is the block structure. `range(3)` yields 0, 1, 2. `**` is a power. A function with no `return` gives back `None`, which is a common source of bugs.',
        'The lab traces a falling object one line at a time. Before each step, predict the next value of `v` and `x`. Predicting first, then checking, is the fastest way to learn to read code.',
      ],
      sim: tracer(
        ['dt = 0.5', 'v = 0.0', 'x = 100.0', 'for step in range(3):', '    v = v - 9.8 * dt', '    x = x + v * dt', 'print(x)'],
        [
          { line: 0, vars: { dt: 0.5 } }, { line: 1, vars: { dt: 0.5, v: '0.0' } }, { line: 2, vars: { dt: 0.5, v: '0.0', x: '100.0' } },
          { line: 3, vars: { dt: 0.5, v: '0.0', x: '100.0', step: 0 }, note: 'range(3) gives 0, 1, 2' },
          { line: 4, vars: { dt: 0.5, v: -4.9, x: '100.0', step: 0 } }, { line: 5, vars: { dt: 0.5, v: -4.9, x: 97.55, step: 0 } },
          { line: 3, vars: { dt: 0.5, v: -4.9, x: 97.55, step: 1 } },
          { line: 4, vars: { dt: 0.5, v: -9.8, x: 97.55, step: 1 } }, { line: 5, vars: { dt: 0.5, v: -9.8, x: 92.65, step: 1 } },
          { line: 3, vars: { dt: 0.5, v: -9.8, x: 92.65, step: 2 } },
          { line: 4, vars: { dt: 0.5, v: -14.7, x: 92.65, step: 2 } }, { line: 5, vars: { dt: 0.5, v: -14.7, x: 85.3, step: 2 } },
          { line: 6, vars: { dt: 0.5, v: -14.7, x: 85.3, step: 2 }, note: 'prints 85.3' },
        ],
        { mission: 'Step to the last line, predicting v and x before each move.', goal: (s, p) => p.i === 12, win: { i: 12 } },
      ),
      cards: [
        { q: 'In Python, what does `range(4)` produce, and what marks the body of a `for` loop?', a: 'The integers 0, 1, 2, 3. The body is every line indented under the `for` line.' },
        { q: 'A Python function reaches its end without a `return`. What does the caller get?', a: '`None`. Forgetting `return` is a classic cause of "NoneType" errors later.' },
      ],
      quiz: [
        { q: 'What does this print?', code: 'total = 0\nfor k in range(1, 4):\n    total = total + k * k\nprint(total)', lang: 'python', choices: ['6', '14', '30', '9'], answer: 1, why: '`range(1, 4)` is 1, 2, 3. The squares sum to 1 + 4 + 9 = 14.' },
        { q: 'In the traced loop, the code updates `v` before `x`. If the two lines were swapped, the final `x` would be:', choices: ['The same', 'Higher (it falls less)', 'Lower (it falls more)', 'An error'], answer: 1, why: 'Updating `x` first uses the older, slower velocity each step, so the object falls less. Update order matters in simulation.' },
      ],
      code: {
        prompt: 'Write `drop(height, dt)`. Start at rest at `height`, and each step update `v` then `x` exactly as in the trace ($g = 9.8$). Return the number of steps taken until `x <= 0`.',
        starter: 'def drop(height, dt):\n    x = height\n    v = 0.0\n    steps = 0\n    # loop until x <= 0: update v, then x, then count the step\n    return steps\n\nprint(drop(100, 0.5))',
        solution: 'def drop(height, dt):\n    x = height\n    v = 0.0\n    steps = 0\n    while x > 0:\n        v = v - 9.8 * dt\n        x = x + v * dt\n        steps += 1\n    return steps\n\nprint(drop(100, 0.5))',
        tests: 'assert drop(100, 0.5) == 9, f"drop(100, 0.5) should be 9 steps, got {drop(100, 0.5)}"\nassert drop(10, 0.1) == 14, f"drop(10, 0.1) should be 14, got {drop(10, 0.1)}"\nassert drop(1, 1) == 1',
        hint: 'Use `while x > 0:` with three indented lines inside: update `v`, update `x`, then `steps += 1`.',
      },
    },
    {
      id: 'calc-integral', skill: 'calc', title: 'Integrals accumulate', pre: ['calc-derivative', 'mech-kinematics'],
      hook: 'An inertial navigator never measures position. It adds up acceleration samples, and the way it adds them decides how fast it drifts.',
      body: [
        'An integral is a running total: $∫v(t)dt$ adds up velocity × time slices to give distance. On a computer the slices are finite, so the question becomes how to estimate each slice from samples.',
        { list: ['**Left/right** sums use one edge of each slice. Error shrinks like $1/n$.', '**Midpoint** and **trapezoid** rules cancel the first-order error. Error shrinks like $1/n^2$.'] },
        'That difference is large in practice. Doubling the sample rate halves a left-sum error but quarters a midpoint error. Choosing the rule is often cheaper than buying a faster sensor.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'n', label: 'Slices n', min: 1, max: 60, step: 1, v: 6 },
          { k: 'm', type: 'select', label: 'Rule', v: 'left', options: [['left', 'Left edge'], ['right', 'Right edge'], ['mid', 'Midpoint'], ['trap', 'Trapezoid']] },
        ],
        draw(g, s, p) {
          g.view(0, 8, 0, 40).axes({ xl: 't (s)', yl: 'v (m/s)' });
          const h = 8 / p.n;
          for (let i = 0; i < p.n; i++) {
            const a = i * h, b = a + h;
            if (p.m === 'trap') g.path([[a, 0], [a, vel(a)], [b, vel(b)], [b, 0]], g.c.b, { w: 1, fill: true, close: true, fa: 0.22 });
            else { const hh = p.m === 'left' ? vel(a) : p.m === 'right' ? vel(b) : vel((a + b) / 2); g.rect(a, 0, h, hh, g.c.b, { fa: 0.22, stroke: g.c.b }); }
          }
          g.fn(vel, g.c.ink, { w: 2.5 });
        },
        read: (s, p) => { const est = riemann(p.n, p.m), ex = velExact(8); return [['estimate', num(est, 5) + ' m'], ['exact', num(ex, 5) + ' m'], ['error', num(abs(est - ex) / ex * 100, 2) + ' %']]; },
        mission: 'Get the distance within 0.1% of exact using 6 slices or fewer.',
        goal: (s, p) => p.n <= 6 && abs(riemann(p.n, p.m) - velExact(8)) / velExact(8) < 0.001,
        win: { n: 6, m: 'mid' },
      },
      cards: [
        { q: 'How does the error of a left-edge Riemann sum scale with the number of slices $n$? What about midpoint or trapezoid?', a: 'Left/right: error ∝ $1/n$. Midpoint/trapezoid: error ∝ $1/n^2$.' },
        { q: 'What physical quantity is the area under a velocity–time curve? Under an acceleration–time curve?', a: 'Area under $v(t)$ is displacement. Area under $a(t)$ is the change in velocity.' },
      ],
      quiz: [
        { q: 'A trapezoid-rule integration has error 0.8 m with 10 slices. With 40 slices, expect about:', choices: ['0.2 m', '0.05 m', '0.4 m', '0.0125 m'], answer: 1, why: 'Trapezoid error scales as $1/n^2$. Four times the slices gives one sixteenth of the error: 0.05 m.' },
        { q: 'An accelerometer reads a constant 0.02 m/s² bias while the vehicle is actually still. After 60 s of integrating twice, how far off is the computed position?', num: 36, unit: 'm', why: '$x = ½at^2 = 0.5 × 0.02 × 3600 = 36$ m. Double integration turns a small bias into an error that grows with $t^2$.' },
      ],
    },
    {
      id: 'mech-spring', skill: 'mech', title: 'Spring force and simple harmonic motion', pre: ['mech-kinematics', 'calc-derivative'],
      hook: 'Structures, sensors, landing gear and missile fins all behave like springs when disturbed. One equation covers them.',
      body: [
        'A spring pushes back in proportion to how far it is displaced: $F = -kx$. The minus sign makes it a **restoring** force, always aimed at equilibrium.',
        'Put that into Newton’s second law and you get a differential equation, $m·x″ = -kx$. Its solution is a sinusoid, because sine is the function whose second derivative is minus itself:',
        { eq: 'x(t) = A·cos(ωt),  ω = √(k/m),  T = 2π·√(m/k)', where: 'period depends on stiffness and mass, not on amplitude' },
        'Drag the mass in the lab and let go. Watch the force arrow: largest at the extremes where speed is zero, zero at the center where speed peaks. Energy trades between the spring ($½kx^2$) and motion ($½mv^2$).',
      ],
      labNote: 'Drag the block sideways and release it.',
      sim: {
        h: 340,
        controls: [
          { k: 'k', label: 'Stiffness k', min: 10, max: 200, step: 1, v: 40, unit: 'N/m' },
          { k: 'm', label: 'Mass m', min: 0.5, max: 5, step: 0.5, v: 1, unit: 'kg' },
        ],
        init: () => ({ x: 0.8, v: 0, t: 0, hist: [], hold: false }),
        step(s, p, dt) {
          if (!s.hold) for (let i = 0; i < 20; i++) { s.v += -p.k / p.m * s.x * dt / 20; s.x += s.v * dt / 20; }
          s.t += dt; s.hist.push([s.t, s.x]);
          while (s.hist.length && s.hist[0][0] < s.t - 6) s.hist.shift();
        },
        drag(s, p, x, y, ph) { s.hold = ph !== 'up'; s.x = Math.max(-1.2, Math.min(1.2, x)); s.v = 0; },
        draw(g, s, p) {
          g.view(s.t - 6, s.t, -1.4, 1.4, { pad: [44, 150, 14, 30] }).axes({ xl: 't (s)', yl: 'x (m)', xt: false });
          g.clip(() => g.path(s.hist, g.c.a, { w: 2 }));
          g.view(-2.2, 1.8, -1, 1, { pad: [14, 10, 14, 200] });
          g.rect(-2.2, -1, 0.08, 2, g.c.dim).line(-2.2, -0.62, 1.8, -0.62, g.c.dim, { w: 1 });
          g.line(0, -0.9, 0, 0.9, g.c.grid, { w: 1, dash: [4, 4] }).text('x = 0', 0, 0.86, g.c.dim, { a: 'center', s: 10.5 });
          g.spring(-2.12, 0, s.x - 0.25, 0, g.c.ink, 12, 9);
          g.rect(s.x - 0.25, -0.6, 0.5, 1.2, g.c.b, { fa: 0.9 });
          const F = -p.k * s.x;
          g.arrow(s.x, 0, s.x + F / 200 * 1.4, 0, g.c.a, { w: 3, head: 11 });
          g.text('F = −kx', s.x + F / 200 * 0.7, 0.42, g.c.a, { a: 'center', s: 11 });
        },
        read: (s, p) => [['force', num(-p.k * s.x) + ' N'], ['period T', num(2 * PI * sqrt(p.m / p.k), 3) + ' s'], ['spring energy', num(0.5 * p.k * s.x * s.x) + ' J'], ['kinetic energy', num(0.5 * p.m * s.v * s.v) + ' J']],
        mission: 'With a 2 kg mass, choose the stiffness that gives a 1.00 s period (±0.01 s).',
        goal: (s, p) => p.m === 2 && abs(2 * PI * sqrt(p.m / p.k) - 1) < 0.01,
        win: { m: 2, k: 79 },
      },
      cards: [
        { q: 'Write Hooke’s law and explain the sign.', a: '$F = -kx$. The force is proportional to displacement and points back toward equilibrium, which is what makes it a restoring force.' },
        { q: 'What is the period of a mass on a spring, and what does it not depend on?', a: '$T = 2π√(m/k)$. It does not depend on amplitude (for an ideal spring).' },
      ],
      quiz: [
        { q: 'You quadruple the mass on a spring. The period:', choices: ['Doubles', 'Quadruples', 'Halves', 'Stays the same'], answer: 0, why: '$T ∝ √m$, so 4× the mass gives 2× the period.' },
        { q: 'A 0.5 kg sensor mount has stiffness 800 N/m. What is its natural frequency in hertz?', num: 6.37, unit: 'Hz', tol: 0.1, why: '$ω = √(k/m) = √1600 = 40$ rad/s, and $f = ω/2π ≈ 6.37$ Hz.' },
      ],
    },
    {
      id: 'ode-first-order', skill: 'ode', title: 'First-order systems and the time constant', pre: ['calc-integral', 'mech-spring'],
      hook: 'Thermocouples, motors, pressure sensors and seeker gimbals all lag the same way. One number, τ, tells you how much.',
      body: [
        'A differential equation states a rate rule instead of a formula. The simplest useful one says "move toward the target at a rate proportional to how far away you are":',
        { eq: 'dx/dt = (u − x)/τ   ⇒   x(t) = u + (x_0 − u)·e^{−t/τ}' },
        'The **time constant** $τ$ is the time to close 63% of the remaining gap. After $3τ$ about 95% is closed; after $5τ$ over 99%.',
        'The short dashes in the lab are a slope field: at each point they show the direction the rule demands. Every solution is a curve that follows those dashes. That picture works for equations you cannot solve by hand.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'tau', label: 'Time constant τ', min: 0.05, max: 1, step: 0.05, v: 0.5, unit: 's' },
          { k: 'x0', label: 'Start value x₀', min: 0, max: 2, step: 0.1, v: 0 },
        ],
        draw(g, s, p) {
          g.view(0, 3, -0.1, 2.1).axes({ xl: 't (s)', yl: 'x' });
          for (let t = 0.1; t < 3; t += 0.2) for (let x = 0; x <= 2.01; x += 0.15) {
            const m = (1 - x) / p.tau, L = 0.07 / sqrt(1 + (m * 3 / 2.2 * 0.5) ** 2);
            g.line(t - L, x - m * L, t + L, x + m * L, g.c.dim, { w: 1, alpha: 0.55 });
          }
          g.line(0, 1, 3, 1, g.c.c, { w: 1.5, dash: [6, 4] }).text('target u = 1', 2.95, 1.09, g.c.c, { a: 'right', s: 11 });
          const f = t => 1 + (p.x0 - 1) * exp(-t / p.tau);
          g.fn(f, g.c.a, { w: 2.5 });
          g.line(p.tau, -0.1, p.tau, f(p.tau), g.c.b, { w: 1.5, dash: [3, 3] }).dot(p.tau, f(p.tau), g.c.b, 5);
          g.text('t = τ: 63% of the gap closed', p.tau, f(p.tau), g.c.b, { dx: 8, dy: p.x0 > 1 ? -12 : 12, s: 11 });
        },
        read: (s, p) => [['x(τ)', 1 + (p.x0 - 1) * exp(-1)], ['5% settling time', num(p.tau * log(20), 3) + ' s'], ['1% settling time', num(p.tau * log(100), 3) + ' s']],
        mission: 'A seeker must settle to within 5% in 0.60 s. Set τ so the 5% settling time is 0.60 s (±0.02).',
        goal: (s, p) => abs(p.tau * log(20) - 0.6) < 0.02,
        win: { tau: 0.2 },
      },
      cards: [
        { q: 'For $dx/dt = (u − x)/τ$, what does the time constant $τ$ mean physically?', a: 'The time to close 63% (1 − 1/e) of the gap to the target. About $3τ$ reaches 95% and $5τ$ reaches 99%.' },
        { q: 'What is a slope field, and why is it useful?', a: 'A plot of the slope $dx/dt$ demanded by the ODE at each point. Solutions are curves tangent to it everywhere, so you can see behavior without solving the equation.' },
      ],
      quiz: [
        { q: 'A temperature probe has τ = 2 s. It is plunged from 20 °C into 100 °C flow. What does it read after 2 s?', num: 70.6, unit: '°C', tol: 0.6, why: 'It closes 63.2% of the 80 °C gap: $20 + 0.632 × 80 ≈ 70.6$ °C.' },
        { q: 'Which change makes a first-order sensor respond faster?', choices: ['A larger τ', 'A smaller τ', 'A larger step input', 'A higher starting value'], answer: 1, why: 'The rate is (gap)/τ. Smaller τ means a steeper approach. Step size changes the scale, not the timing.' },
      ],
    },
    {
      id: 'ode-oscillator', skill: 'ode', title: 'Second-order systems: damping ratio', pre: ['mech-spring', 'ode-first-order'],
      hook: 'Whether a fin actuator snaps to its command or rings like a bell comes down to a single dimensionless number.',
      body: [
        'Add a damper to the spring and drive it toward a command $u$. Dividing by mass gives the standard second-order form:',
        { eq: 'x″ + 2ζω_n·x′ + ω_n^2·x = ω_n^2·u', where: '$ω_n$ = natural frequency (rad/s), $ζ$ = damping ratio' },
        { list: ['$ζ < 1$ **underdamped**: fast but overshoots and rings.', '$ζ = 1$ **critically damped**: fastest approach with no overshoot.', '$ζ > 1$ **overdamped**: no overshoot, sluggish.'] },
        '$ω_n$ sets the time scale; $ζ$ sets the shape. Designers often aim near $ζ ≈ 0.7$, which trades a few percent overshoot for a quick settle.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'z', label: 'Damping ratio ζ', min: 0, max: 2, step: 0.05, v: 0.2 },
          { k: 'wn', label: 'Natural frequency ωₙ', min: 1, max: 10, step: 0.5, v: 5, unit: 'rad/s' },
        ],
        draw(g, s, p) {
          g.view(0, 4, 0, 2).axes({ xl: 't (s)', yl: 'response x' });
          g.rect(0, 0.98, 4, 0.04, g.c.c, { fa: 0.2 });
          g.line(0, 1, 4, 1, g.c.c, { w: 1, dash: [6, 4] });
          const r = stepResponse(p.z, p.wn);
          g.path(r.pts, g.c.a, { w: 2.5 });
          if (r.settle < 3.99) g.line(r.settle, 0, r.settle, 1, g.c.b, { w: 1.5, dash: [3, 3] }).text('settled', r.settle, 0.1, g.c.b, { dx: 6, s: 11 });
          g.note(p.z < 0.999 ? (p.z === 0 ? 'undamped' : 'underdamped') : p.z < 1.001 ? 'critically damped' : 'overdamped', 'tr', g.c.ink);
        },
        read: (s, p) => { const r = stepResponse(p.z, p.wn); return [['overshoot', num(r.overshoot, 3) + ' %'], ['2% settling time', r.settle >= 3.99 ? '> 4 s' : num(r.settle, 3) + ' s']]; },
        mission: 'Hold ωₙ at 5 rad/s. Find a damping ratio with overshoot under 5% and 2% settling time under 1.0 s.',
        goal: (s, p) => { if (p.wn !== 5) return false; const r = stepResponse(p.z, p.wn); return r.overshoot < 5 && r.settle < 1.0; },
        win: { z: 0.8, wn: 5 },
      },
      cards: [
        { q: 'Name the three damping regimes of a second-order system and the $ζ$ range for each.', a: 'Underdamped $ζ<1$ (overshoot, ringing); critically damped $ζ=1$ (fastest with no overshoot); overdamped $ζ>1$ (slow, no overshoot).' },
        { q: 'In $x″ + 2ζω_n x′ + ω_n^2 x = ω_n^2 u$, what does each parameter control?', a: '$ω_n$ sets the speed (time scale) of the response. $ζ$ sets its shape: how much it overshoots and rings.' },
      ],
      quiz: [
        { q: 'Two actuators have the same ζ = 0.7. One has ωₙ = 10 rad/s, the other 20 rad/s. The second one:', choices: ['Overshoots twice as much', 'Has the same shape, in half the time', 'Is overdamped', 'Takes twice as long to settle'], answer: 1, why: 'ζ fixes the shape, so the overshoot is identical. Doubling $ω_n$ compresses the time axis by two.' },
        { q: 'A step response overshoots by 50% and rings for many cycles. The best single fix is to:', choices: ['Increase damping', 'Decrease stiffness', 'Increase the command', 'Decrease damping'], answer: 0, why: 'Heavy ringing means ζ is far below 1. Adding damping raises ζ and removes the overshoot.' },
      ],
    },
    {
      id: 'num-euler-rk4', skill: 'nummeth', title: 'Simulating motion: Euler versus RK4', pre: ['ode-oscillator', 'py-basics'],
      hook: 'A six-degree-of-freedom flight simulation is this loop run millions of times. A poor integrator invents energy from nothing.',
      body: [
        'To simulate $dy/dt = f(y)$ you step: from the current state, estimate the change over $Δt$, and repeat. **Euler’s method** uses the slope at the start of the step: $y_{n+1} = y_n + f(y_n)·Δt$. Its error per step is ∝ $Δt^2$, so total error is ∝ $Δt$.',
        '**RK4** samples the slope four times across the step and blends them. Total error is ∝ $Δt^4$: halve the step and the error falls 16-fold.',
        'A frictionless oscillator should keep its energy forever, which makes energy drift a clean test. Plain Euler gains energy every step and spirals outward. A **symplectic** variant (update $v$, then use the new $v$ for $x$) keeps energy bounded for the same cost, which is why orbit propagators like it.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'm', type: 'select', label: 'Method', v: 'euler', options: [['euler', 'Euler'], ['symp', 'Symplectic Euler'], ['rk4', 'RK4']] },
          { k: 'dt', label: 'Time step Δt', min: 0.005, max: 0.2, step: 0.005, v: 0.02, unit: 's' },
        ],
        draw(g, s, p) {
          g.view(0, 10, -3, 3).axes({ xl: 't (s)', yl: 'x' });
          g.fn(t => cos(2 * PI * t), g.c.dim, { w: 1.5, n: 600 });
          const r = integrate(p.m, p.dt);
          g.clip(() => g.path(r.pts, g.c.a, { w: 2 }));
          g.note('exact', 'tr', g.c.dim).note('simulated', 'tr', g.c.a, 1);
        },
        read: (s, p) => { const r = integrate(p.m, p.dt); return [['steps', Math.round(10 / p.dt)], ['energy error after 10 s', (abs(r.err) > 1e5 ? 'blown up' : num(r.err, 3) + ' %')]]; },
        mission: 'Keep the energy error under 1% (in size) using a time step of 0.05 s or larger.',
        goal: (s, p) => p.dt >= 0.05 && abs(integrate(p.m, p.dt).err) < 1,
        win: { m: 'rk4', dt: 0.05 },
      },
      cards: [
        { q: 'Write one Euler step for $dy/dt = f(y)$ and state how its total error scales with step size.', a: '$y_{n+1} = y_n + f(y_n)Δt$. Total (global) error ∝ $Δt$: first order.' },
        { q: 'How does RK4’s global error scale with $Δt$, and what does halving the step buy you?', a: 'Error ∝ $Δt^4$. Halving the step cuts the error by 16×, versus 2× for Euler.' },
        { q: 'Why is energy drift a good test of an integrator, and which cheap method keeps it bounded?', a: 'A conservative system should hold energy exactly, so any drift is pure numerical error. Symplectic (semi-implicit) Euler keeps energy bounded instead of growing.' },
      ],
      quiz: [
        { q: 'An RK4 simulation has position error 1.6 m at Δt = 0.1 s. At Δt = 0.05 s you expect about:', choices: ['0.8 m', '0.4 m', '0.1 m', '0.2 m'], answer: 2, why: 'Fourth order: halving Δt divides the error by $2^4 = 16$, giving 0.1 m.' },
        { q: 'Plain Euler on a frictionless oscillator makes the amplitude:', choices: ['Decay to zero', 'Stay constant', 'Grow every cycle', 'Jump randomly'], answer: 2, why: 'Each Euler step multiplies the energy by $(1 + ω^2Δt^2)$, so the orbit spirals outward.' },
      ],
      code: {
        prompt: 'Write `euler(f, y0, t1, n)`: integrate $dy/dt = f(y)$ from $t = 0$ to `t1` in `n` equal Euler steps, starting from `y0`, and return the final `y`.',
        starter: 'def euler(f, y0, t1, n):\n    dt = t1 / n\n    y = y0\n    # take n Euler steps\n    return y\n\n# decay: dy/dt = -y, exact answer at t=1 is 0.3679\nprint(euler(lambda y: -y, 1.0, 1.0, 1000))',
        solution: 'def euler(f, y0, t1, n):\n    dt = t1 / n\n    y = y0\n    for _ in range(n):\n        y = y + f(y) * dt\n    return y\n\nprint(euler(lambda y: -y, 1.0, 1.0, 1000))',
        tests: 'assert abs(euler(lambda y: -y, 1.0, 1.0, 2) - 0.25) < 1e-12, "two steps of size 0.5 on dy/dt=-y should give 0.25"\nassert abs(euler(lambda y: -y, 1.0, 1.0, 1000) - 0.36770) < 1e-4\nassert abs(euler(lambda y: 3.0, 2.0, 4.0, 8) - 14.0) < 1e-9',
        hint: 'Inside a `for _ in range(n):` loop, replace `y` with `y + f(y) * dt`.',
      },
    },
    {
      id: 'vcs-git', skill: 'vcs', title: 'Git: a graph of snapshots', pre: ['py-basics'],
      hook: 'Flight software is certified commit by commit. Knowing exactly which snapshot flew, and how it got there, is a safety requirement.',
      body: [
        'Git stores **commits**: full snapshots of the project, each pointing to its parent. The history is a graph. A **branch** is only a movable label on one commit, and `HEAD` marks the branch you are on.',
        { list: ['`git commit` adds a snapshot and moves the current branch label forward.', '`git switch -c feature` makes a new label at the current commit.', '`git merge feature` joins two lines of work. If history diverged, Git creates a **merge commit** with two parents. If not, it simply slides the label forward (a fast-forward).'] },
        'Branches let you try a risky change without disturbing `main`, and the graph records who changed what and why. Small commits with clear messages make a later bisect or review practical.',
      ],
      sim: {
        h: 240, resettable: true,
        controls: [
          { type: 'button', label: 'Commit', on: s => git.commit(s) },
          { type: 'button', label: 'Create feature branch', on: s => git.branch(s) },
          { type: 'button', label: 'Switch branch', on: s => git.sw(s) },
          { type: 'button', label: 'Merge other branch in', on: s => git.merge(s) },
        ],
        init: () => ({ commits: [{ id: 0, parents: [], lane: 0 }], br: { main: 0 }, head: 'main', msg: 'one commit on main' }),
        draw(g, s) {
          g.view(-0.6, Math.max(8, s.commits.length) + 0.4, -0.9, 1.9, { pad: [70, 16, 16, 30] });
          g.text('main', 8, g.Y(0), g.c.b, { px: true, s: 12, bold: true }).text('feature', 8, g.Y(1), g.c.c, { px: true, s: 12, bold: true });
          s.commits.forEach(c => c.parents.forEach(pid => { const q = s.commits[pid]; g.line(q.id, q.lane, c.id, c.lane, g.c.dim, { w: 2 }); }));
          s.commits.forEach(c => { g.dot(c.id, c.lane, c.parents.length === 2 ? g.c.a : c.lane ? g.c.c : g.c.b, 9); g.text('c' + c.id, c.id, c.lane, g.c.dim, { a: 'center', dy: 20, s: 10.5 }); });
          Object.entries(s.br).forEach(([name, id]) => { const c = s.commits[id], up = name === 'feature' ? -1 : 1; g.text(name + (s.head === name ? ' ← HEAD' : ''), c.id, c.lane, s.head === name ? g.c.ink : g.c.dim, { a: 'center', dy: up * 34 + (up > 0 ? 4 : 0), s: 11, bold: s.head === name, bg: true }); });
        },
        read: s => [['on branch', s.head], ['commits', s.commits.length], ['last action', s.msg]],
        mission: 'Create the feature branch, commit twice on it, commit once on main, then merge feature into main to produce a two-parent merge commit.',
        goal: s => s.head === 'main' && s.commits.some(c => c.parents.length === 2 && c.lane === 0) && s.commits.filter(c => c.lane === 1).length >= 2,
        win: s => { git.branch(s); git.commit(s); git.commit(s); git.sw(s); git.commit(s); git.merge(s); },
      },
      cards: [
        { q: 'In Git, what is a commit and what is a branch?', a: 'A commit is a snapshot of the whole project that points to its parent commit(s). A branch is a movable label pointing at one commit.' },
        { q: 'When does `git merge` create a merge commit, and when does it fast-forward?', a: 'If both branches have new commits since they split, Git makes a merge commit with two parents. If the current branch has no new commits, its label just slides forward.' },
      ],
      quiz: [
        { q: 'You are on `main`, which has not changed since `feature` branched off. `git merge feature` will:', choices: ['Create a merge commit with two parents', 'Fast-forward main to feature’s commit', 'Delete the feature branch', 'Fail with a conflict'], answer: 1, why: 'No divergence means nothing to combine. Git moves the `main` label forward.' },
        { q: 'Why keep experimental work on a branch instead of committing straight to `main`?', choices: ['Branches run faster', 'Main stays in a known working state while the experiment develops', 'Git cannot store two versions on one branch', 'Branches use less disk space'], answer: 1, why: 'Isolation: `main` stays releasable, and the experiment can be reviewed, tested or dropped without affecting it.' },
      ],
    },
  ],
};
