import { tracer, num, rng, rk4, clamp } from '../sim.js';
const { sin, cos, PI, sqrt, abs, atan2, hypot, max, min } = Math;

// --- shared control loop: plant 1/((s+1)(0.2s+1)), PID with derivative on measurement ---
const memo = new Map();
export function loop(Kp, Ki = 0, Kd = 0, dist = 0, T = 8) {
  const key = [Kp, Ki, Kd, dist, T].join();
  if (memo.has(key)) return memo.get(key);
  const dt = 0.002; let x1 = 0, x2 = 0, I = 0, peak = 0, settle = 0, late = 0; const pts = [], us = [];
  for (let i = 0; i <= T / dt; i++) {
    const t = i * dt, e = 1 - x2, yd = (x1 - x2) / 0.2, u = Kp * e + Ki * I - Kd * yd, d = t >= 4 ? dist : 0;
    if (i % 10 === 0) { pts.push([t, x2]); us.push([t, u]); }
    if (t < 4) { peak = max(peak, x2); if (abs(e) > 0.02) settle = t; }
    if (t >= 6) late = max(late, abs(e));
    I += e * dt; x1 += (-x1 + u + d) * dt; x2 += (x1 - x2) / 0.2 * dt;
    if (!isFinite(x2) || abs(x2) > 1e6) break;
  }
  const r = { pts, us, peak, settle, late, yEnd: x2 };
  if (memo.size > 400) memo.clear();
  memo.set(key, r); return r;
}

// --- cubic roots (Durand-Kerner) for s^3 + 6s^2 + 8s + K ---
const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cs = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cd = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
export function poles(K) {
  let r = [[-4.3, 0.1], [-1, 1.2], [-0.8, -1.1]];
  const f = z => { let y = [1, 0]; for (const c of [6, 8, K]) { y = cm(y, z); y[0] += c; } return y; };
  for (let it = 0; it < 80; it++) r = r.map((z, i) => { let den = [1, 0]; r.forEach((w, j) => { if (j !== i) den = cm(den, cs(z, w)); }); return cs(z, cd(f(z), den)); });
  return r;
}
const maxRe = K => max(...poles(K).map(z => z[0]));

// --- position-velocity Kalman tracker on a fixed scenario ---
const TR = (() => { const r = rng(21), pos = [], vel = [], z = []; let p = 0, v = 10; for (let k = 0; k < 150; k++) { const a = k >= 50 && k < 90 ? -0.5 : 0; pos.push(p); vel.push(v); z.push(p + 8 * r.n()); p += v + 0.5 * a; v += a; } return { pos, vel, z }; })();
export function track(lq) {
  const q = 10 ** lq, R = 64; let x = [TR.z[0], 0], P = [[64, 0], [0, 100]], sp = 0, sv = 0; const ep = [], ev = [];
  for (let k = 0; k < 150; k++) {
    if (k) {
      x = [x[0] + x[1], x[1]];
      const a = P[0][0] + 2 * P[0][1] + P[1][1] + q / 4, b = P[0][1] + P[1][1] + q / 2, d = P[1][1] + q;
      const S = a + R, k0 = a / S, k1 = b / S, y = TR.z[k] - x[0];
      x = [x[0] + k0 * y, x[1] + k1 * y];
      P = [[(1 - k0) * a, (1 - k0) * b], [(1 - k0) * b, d - k1 * b]];
    }
    ep.push([k, x[0]]); ev.push([k, x[1]]);
    if (k >= 15) { sp += (x[0] - TR.pos[k]) ** 2; sv += (x[1] - TR.vel[k]) ** 2; }
  }
  return { ep, ev, rp: sqrt(sp / 135), rv: sqrt(sv / 135) };
}

const eig = p => { const tr = p.a + p.d, det = p.a * p.d - p.b * p.c, disc = tr * tr / 4 - det; return disc >= 0 ? { real: true, l1: tr / 2 + sqrt(disc), l2: tr / 2 - sqrt(disc), tr, det } : { real: false, re: tr / 2, im: sqrt(-disc), tr, det }; };

export default {
  id: 'u04', title: 'Feedback', blurb: 'State space, stability and control.',
  lessons: [
    {
      id: 'ode-state-space', skill: 'ode', title: 'State space and phase portraits', pre: ['ode-oscillator', 'linalg-matrices'],
      hook: 'Modern control and estimation write every system the same way: a state vector and a rule for its rate of change.',
      body: [
        'Any ODE can be rewritten as a set of first-order equations by naming the **state**: the smallest set of numbers that fixes the future. For a mass on a spring the state is position and velocity.',
        { eq: 'x″ + c·x′ + k·x = 0   ⇒   d/dt [x; v] = [0 1; −k −c]·[x; v]' },
        'Plot state against state instead of against time and you get the **phase plane**. Each point has one arrow, the rate of change there, and a solution is a curve that follows the arrows. The picture shows every possible behavior at once.',
        { list: ['**Stable node / spiral**: everything flows into the origin.', '**Center**: closed loops, oscillation that never dies.', '**Saddle**: flows in along one direction and out along another. Unstable.', '**Unstable spiral**: oscillation that grows.'] },
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'c', label: 'Damping c', min: -2, max: 3, step: 0.1, v: 0.5 },
          { k: 'k', label: 'Stiffness k', min: -2, max: 5, step: 0.1, v: 2 },
        ],
        draw(g, s, p) {
          g.view(-3, 3, -3, 3, { eq: true }).axes({ xl: 'position x', yl: 'velocity v' });
          const f = y => [y[1], -p.k * y[0] - p.c * y[1]];
          g.clip(() => {
            for (let x = -4.5; x <= 4.5; x += 0.5) for (let v = -3; v <= 3; v += 0.5) { const [dx, dv] = f([x, v]), n = hypot(dx, dv) || 1; g.arrow(x - dx / n * 0.14, v - dv / n * 0.14, x + dx / n * 0.14, v + dv / n * 0.14, g.c.dim, { w: 1, head: 5, alpha: 0.6 }); }
            for (let i = 0; i < 8; i++) { let y = [2.4 * cos(i * PI / 4 + 0.3), 2.4 * sin(i * PI / 4 + 0.3)]; const pts = [y]; for (let j = 0; j < 320 && hypot(y[0], y[1]) < 12; j++) { y = rk4(f, y, 0, 0.03); pts.push(y); } g.path(pts, [g.c.a, g.c.b, g.c.c, g.c.d][i % 4], { w: 1.8 }); g.dot(pts[0][0], pts[0][1], g.c.ink, 3); }
          });
          g.note(kind(p), 'tr', g.c.ink);
        },
        read: (s, p) => { const d = p.c * p.c - 4 * p.k; return [['type', kind(p)], ['eigenvalues', d >= 0 ? `${num((-p.c + sqrt(d)) / 2)}, ${num((-p.c - sqrt(d)) / 2)}` : `${num(-p.c / 2)} ± ${num(sqrt(-d) / 2)}i`]]; },
        mission: 'Build an unstable spiral: an oscillation whose amplitude grows.',
        goal: (s, p) => p.c < 0 && p.c * p.c - 4 * p.k < 0,
        win: { c: -0.4, k: 2 },
      },
      cards: [
        { q: 'What is the "state" of a dynamic system? Give the state of a mass on a spring.', a: 'The smallest set of variables that, with the inputs, determines the future. For the spring-mass: position and velocity.' },
        { q: 'Rewrite $x″ + cx′ + kx = 0$ in state-space (matrix) form.', a: 'With state $[x; v]$: $d/dt[x; v] = [0 1; −k −c][x; v]$.' },
      ],
      quiz: [
        { q: 'In a phase portrait, closed loops around the origin mean the system is:', choices: ['Decaying to rest', 'Oscillating forever at fixed amplitude', 'Diverging', 'Stuck at equilibrium'], answer: 1, why: 'A closed orbit returns to the same state repeatedly: undamped oscillation (a center).' },
        { q: 'A system has negative stiffness ($k < 0$) and positive damping. Its origin is:', choices: ['A stable node', 'A center', 'A saddle (unstable)', 'A stable spiral'], answer: 2, why: 'Negative stiffness pushes away from equilibrium. One eigenvalue is positive, giving a saddle no matter how much damping there is.' },
      ],
    },
    {
      id: 'linalg-eigen', skill: 'linalg', title: 'Eigenvalues: the directions a matrix only stretches', pre: ['ode-state-space', 'prob-gaussian-cov'],
      hook: 'Stability, vibration modes, the axes of an error ellipse and the convergence of a filter are all read from eigenvalues.',
      body: [
        'Most vectors change direction when a matrix acts on them. An **eigenvector** does not: $Av = λv$. The matrix only scales it, and the scale factor $λ$ is the **eigenvalue**.',
        'For a 2×2 matrix the eigenvalues solve $λ^2 − (trace)·λ + det = 0$. So their **sum is the trace** and their **product is the determinant**. If the discriminant is negative they are a complex pair, and the matrix rotates as well as scales: no real direction is left unturned.',
        'For $dx/dt = Ax$, each eigen-direction evolves as $e^{λt}$. A negative real part decays, a positive one grows, an imaginary part oscillates. That single fact is the stability test used in the rest of this unit.',
      ],
      labNote: 'The black vector sweeps around the unit circle; the orange vector is its image. They line up only along eigenvectors.',
      sim: {
        h: 330,
        controls: [
          { k: 'a', label: 'a', min: -3, max: 3, step: 0.5, v: 2 }, { k: 'b', label: 'b', min: -3, max: 3, step: 0.5, v: 1 },
          { k: 'c', label: 'c', min: -3, max: 3, step: 0.5, v: 0 }, { k: 'd', label: 'd', min: -3, max: 3, step: 0.5, v: 1 },
        ],
        init: () => ({ th: 0 }),
        step(s, p, dt) { s.th += dt * 0.6; },
        draw(g, s, p) {
          g.view(-5, 5, -4, 4, { eq: true }).axes({});
          const e = eig(p), A = (x, y) => [p.a * x + p.b * y, p.c * x + p.d * y];
          const circ = [], img = []; for (let i = 0; i <= 72; i++) { const t = i / 36 * PI; circ.push([cos(t), sin(t)]); img.push(A(cos(t), sin(t))); }
          const v = [cos(s.th), sin(s.th)], w = A(...v), cross = abs(v[0] * w[1] - v[1] * w[0]) / (hypot(...w) || 1);
          g.clip(() => {
            g.path(circ, g.c.dim, { w: 1, dash: [4, 3] }).path(img, g.c.a, { w: 1, alpha: 0.5 });
            if (e.real) [e.l1, e.l2].forEach((l, i) => { const ex = abs(p.b) > 1e-9 ? [p.b, l - p.a] : abs(p.c) > 1e-9 ? [l - p.d, p.c] : (abs(l - p.a) < 1e-9 ? [1, 0] : [0, 1]); const n = hypot(...ex) || 1; g.line(-6 * ex[0] / n, -6 * ex[1] / n, 6 * ex[0] / n, 6 * ex[1] / n, i ? g.c.c : g.c.b, { w: 1.5, dash: [7, 5] }); });
            g.arrow(0, 0, ...w, cross < 0.06 ? g.c.good : g.c.a, { w: 3 }).arrow(0, 0, ...v, g.c.ink, { w: 2.5 });
          });
          g.note('v', 'tl', g.c.ink).note(cross < 0.06 ? 'Av is parallel to v: eigenvector' : 'Av', 'tl', cross < 0.06 ? g.c.good : g.c.a, 1);
        },
        read: (s, p) => { const e = eig(p); return [['eigenvalues', e.real ? `${num(e.l1)}, ${num(e.l2)}` : `${num(e.re)} ± ${num(e.im)}i`], ['trace (sum)', e.tr], ['determinant (product)', e.det]]; },
        mission: 'Build a matrix whose eigenvalues are 3 and −1.',
        goal: (s, p) => { const e = eig(p); return e.real && abs(e.l1 - 3) < 0.05 && abs(e.l2 + 1) < 0.05; },
        win: { a: 1, b: 2, c: 2, d: 1 },
      },
      cards: [
        { q: 'Define an eigenvector and eigenvalue of a matrix $A$.', a: 'A nonzero vector $v$ with $Av = λv$: $A$ only scales it. The scale factor $λ$ is the eigenvalue.' },
        { q: 'How are the eigenvalues of a 2×2 matrix related to its trace and determinant?', a: 'Their sum equals the trace and their product equals the determinant.' },
        { q: 'For $dx/dt = Ax$, what do the eigenvalues of $A$ say about stability?', a: 'Each mode behaves like $e^{λt}$. All real parts negative: stable. Any positive real part: unstable. Imaginary parts give oscillation.' },
      ],
      quiz: [
        { q: 'A matrix has trace 5 and determinant 6. Its larger eigenvalue is:', num: 3, tol: 0.01, why: '$λ^2 − 5λ + 6 = 0$ gives $λ = 2, 3$.' },
        { q: 'The matrix $[0 −1; 1 0]$ rotates every vector by 90°. Its eigenvalues are:', choices: ['1 and 1', '0 and 0', '±i (a complex pair)', '1 and −1'], answer: 2, why: 'No real direction is left unturned, so the eigenvalues cannot be real: $λ^2 + 1 = 0$ gives $±i$.' },
      ],
    },
    {
      id: 'control-feedback', skill: 'control', title: 'Feedback and proportional control', pre: ['ode-oscillator', 'ode-state-space'],
      hook: 'Measure, compare, correct. Feedback lets an imperfect machine hit a target its designers could not predict.',
      body: [
        'A feedback controller measures the output $y$, compares it with the command $r$, and acts on the **error** $e = r − y$. The simplest law is **proportional**: $u = K_p·e$.',
        'More gain gives a faster response and a smaller leftover error. For this lab’s plant the steady-state error to a step is',
        { eq: 'e_{ss} = 1/(1 + K_p)' },
        'so it never reaches zero with finite gain. And real plants have lag: here an actuator pole and a slower airframe pole. Push $K_p$ up and the lag turns correction into overshoot.',
        'That tension between accuracy and stability is the central trade in control. The next lesson adds two more terms to break it.',
      ],
      sim: {
        h: 300,
        controls: [{ k: 'kp', label: 'Proportional gain Kp', min: 0, max: 30, step: 0.5, v: 1 }],
        draw(g, s, p) {
          g.view(0, 6, 0, 1.5).axes({ xl: 't (s)', yl: 'output y' });
          g.line(0, 1, 6, 1, g.c.c, { w: 1.5, dash: [6, 4] }).text('command r = 1', 5.9, 1.06, g.c.c, { a: 'right', s: 11 });
          const r = loop(p.kp, 0, 0, 0, 6), yss = p.kp / (1 + p.kp);
          g.line(0, yss, 6, yss, g.c.dim, { w: 1, dash: [2, 4] });
          g.clip(() => g.path(r.pts, g.c.a, { w: 2.5 }));
          g.arrow(5.4, yss, 5.4, 1, g.c.bad, { w: 1.5 }).text('steady error', 5.3, (1 + yss) / 2, g.c.bad, { a: 'right', s: 11 });
        },
        read: (s, p) => { const r = loop(p.kp, 0, 0, 0, 6), yss = p.kp / (1 + p.kp); return [['steady-state error', num(100 / (1 + p.kp), 3) + ' %'], ['overshoot past final value', num(max(0, (r.peak - yss) / (yss || 1) * 100), 3) + ' %']]; },
        mission: 'With gain alone, get steady-state error under 12% while keeping overshoot under 20%.',
        goal: (s, p) => { const r = loop(p.kp, 0, 0, 0, 6), yss = p.kp / (1 + p.kp); return 100 / (1 + p.kp) < 12 && (r.peak - yss) / yss * 100 < 20; },
        win: { kp: 7.5 },
      },
      cards: [
        { q: 'What is the error signal in a feedback loop, and what does a proportional controller do with it?', a: '$e = r − y$ (command minus measured output). A proportional controller applies $u = K_p e$.' },
        { q: 'What are the two effects of raising proportional gain on a plant with lag?', a: 'Steady-state error shrinks and the response speeds up, but overshoot and oscillation grow; enough gain can destabilize the loop.' },
      ],
      quiz: [
        { q: 'For the lab plant, what proportional gain gives a steady-state error of 4%?', num: 24, tol: 0.1, why: '$1/(1 + K_p) = 0.04$ gives $K_p = 24$.' },
        { q: 'Why does a proportional controller on this plant always leave some error?', choices: ['The sensor is noisy', 'Holding the output requires nonzero control, which requires nonzero error', 'The gain is too high', 'Proportional control is unstable'], answer: 1, why: 'With $u = K_p e$, zero error means zero control effort, and the plant needs effort to hold its output up.' },
      ],
    },
    {
      id: 'control-pid', skill: 'control', title: 'PID: past, present and future', pre: ['control-feedback', 'calc-integral'],
      hook: 'Three terms run most of the world’s control loops, from fin actuators to engine fuel valves.',
      body: [
        'PID adds two terms to proportional control:',
        { eq: 'u = K_p·e + K_i·∫e dt + K_d·de/dt' },
        { list: ['**P** reacts to the present error.', '**I** accumulates past error. Any persistent offset keeps growing the integral until it is driven to zero, so steady-state error vanishes and constant disturbances are rejected.', '**D** reacts to the trend. It adds damping, letting you use more gain with less overshoot, but it amplifies sensor noise.'] },
        'Tuning by hand: raise $K_p$ until the response is brisk but oscillatory, add $K_d$ to calm it, then add $K_i$ to remove the offset. Too much $K_i$ brings oscillation back.',
        'At $t$ = 4 s the lab injects a constant disturbance (think of a gust or a center-of-gravity shift). Watch which term deals with it.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'kp', label: 'Kp', min: 0, max: 30, step: 0.5, v: 4 }, { k: 'ki', label: 'Ki', min: 0, max: 40, step: 0.5, v: 0 }, { k: 'kd', label: 'Kd', min: 0, max: 5, step: 0.1, v: 0 },
        ],
        draw(g, s, p) {
          const r = loop(p.kp, p.ki, p.kd, 0.5);
          g.view(0, 8, 0, 1.6, { pad: [44, 12, 14, 110] }).axes({ yl: 'output y', xt: false });
          g.rect(0, 0.98, 8, 0.04, g.c.c, { fa: 0.2 }).line(4, 0, 4, 1.6, g.c.bad, { w: 1, dash: [4, 4] }).text('disturbance', 4.08, 0.12, g.c.bad, { s: 11 });
          g.clip(() => g.path(r.pts, g.c.a, { w: 2.5 }));
          g.view(0, 8, -2, 12, { pad: [44, g.h - 96, 14, 30] }).axes({ xl: 't (s)', yl: 'control u', ys: 5 });
          g.clip(() => g.path(r.us, g.c.b, { w: 1.8 }));
        },
        read: (s, p) => { const r = loop(p.kp, p.ki, p.kd, 0.5); return [['overshoot', num(max(0, (r.peak - 1) * 100), 3) + ' %'], ['2% settling time', r.settle > 3.9 ? '> 4 s' : num(r.settle, 3) + ' s'], ['error after disturbance', num(r.late * 100, 2) + ' %']]; },
        mission: 'Tune for overshoot under 10%, settling inside 1.5 s, and under 2% error two seconds after the disturbance.',
        goal: (s, p) => { const r = loop(p.kp, p.ki, p.kd, 0.5); return r.peak < 1.10 && r.settle < 1.5 && r.late < 0.02; },
        win: { kp: 10, ki: 6, kd: 1 },
      },
      cards: [
        { q: 'Write the PID control law and say what each term responds to.', a: '$u = K_p e + K_i∫e dt + K_d de/dt$. P: present error. I: accumulated past error (removes steady offset). D: rate of change (adds damping).' },
        { q: 'Which PID term removes steady-state error from a constant disturbance, and why?', a: 'The integral term. A persistent error keeps the integral growing, so the control keeps increasing until the error is exactly zero.' },
        { q: 'What is the main practical drawback of derivative action?', a: 'It amplifies high-frequency sensor noise, so it is usually filtered and often applied to the measurement, not the error.' },
      ],
      quiz: [
        { q: 'A loop is fast and well damped but settles 3% below the command. Which change fixes it?', choices: ['Add integral action', 'Add derivative action', 'Lower $K_p$', 'Remove feedback'], answer: 0, why: 'A constant offset is exactly what integral action eliminates.' },
        { q: 'After adding a large $K_i$ the response begins to oscillate. The cause is:', choices: ['Integral action adds phase lag, eroding stability', 'The sensor failed', 'Derivative noise', 'The plant became nonlinear'], answer: 0, why: 'An integrator delays the control response. Too much of it pushes the loop toward instability.' },
      ],
    },
    {
      id: 'control-stability', skill: 'control', title: 'Poles, the s-plane and stability margins', pre: ['control-pid', 'linalg-eigen'],
      hook: 'Before a new autopilot flies, engineers know how much gain error it tolerates. That number comes from where the poles sit.',
      body: [
        'A linear system’s behavior is set by its **poles**: the eigenvalues of its state matrix, plotted in the complex **s-plane**. A pole at $s = σ + jω$ contributes a response $e^{σt}$ oscillating at $ω$.',
        { list: ['Left half-plane ($σ < 0$): decays. Stable.', 'Right half-plane ($σ > 0$): grows. Unstable.', 'Farther left: faster decay. Farther from the real axis: faster oscillation.'] },
        'Closing a feedback loop moves the poles, and the gain decides where. The path they trace as gain rises is the **root locus**. In the lab the plant is $1/(s(s+2)(s+4))$: two poles head for each other, meet, split off the real axis and eventually cross into the right half-plane.',
        'The **gain margin** is the factor by which gain can rise before that crossing. A margin of 2 (6 dB) or more is a common design rule.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'K', label: 'Loop gain K', min: 0, max: 80, step: 0.5, v: 6 }],
        draw(g, s, p) {
          const split = g.w * 0.48;
          g.view(-7, 2, -6, 6, { pad: [40, 12, g.w - split, 30] }).axes({ xl: 'Re(s)', yl: 'Im(s)' });
          g.rect(0, -6, 2, 12, g.c.bad, { fa: 0.1 }).text('unstable', 1, 5.3, g.c.bad, { a: 'center', s: 10.5 });
          g.clip(() => { for (let K = 0; K <= 80; K += 1) poles(K).forEach(z => g.dot(z[0], z[1], g.c.dim, 1.3)); poles(p.K).forEach(z => { const d = 0.22, dy = d * 12 / 9 * 1.0; g.line(z[0] - d, z[1] - dy, z[0] + d, z[1] + dy, g.c.a, { w: 3 }).line(z[0] - d, z[1] + dy, z[0] + d, z[1] - dy, g.c.a, { w: 3 }); }); });
          g.view(0, 10, -0.5, 2.5, { pad: [split + 44, 12, 14, 30] }).axes({ xl: 't (s)', yl: 'step response' });
          g.line(0, 1, 10, 1, g.c.c, { w: 1, dash: [5, 4] });
          let y = [0, 0, 0]; const pts = [[0, 0]];
          for (let i = 1; i <= 500; i++) { y = rk4(q => [q[1], q[2], p.K * (1 - q[0]) - 8 * q[1] - 6 * q[2]], y, 0, 0.02); pts.push([i * 0.02, clamp(y[0], -50, 50)]); }
          g.clip(() => g.path(pts, g.c.a, { w: 2 }));
        },
        read: (s, p) => { const m = maxRe(p.K); return [['rightmost pole real part', num(m, 3)], ['status', m < -0.01 ? 'stable' : m > 0.01 ? 'unstable' : 'marginal'], ['gain margin', p.K > 0 ? '×' + num(48 / p.K, 3) : '–']]; },
        mission: 'Raise the gain to the edge of stability: put the complex poles on the imaginary axis (real part within 0.01 of zero).',
        goal: (s, p) => abs(maxRe(p.K)) < 0.01,
        win: { K: 48 },
      },
      cards: [
        { q: 'Where must all poles lie for a linear system to be stable, and what does a pole’s position tell you?', a: 'In the left half of the s-plane (negative real part). The real part sets the decay rate; the imaginary part sets the oscillation frequency.' },
        { q: 'What is gain margin?', a: 'The factor by which loop gain can increase before the closed loop becomes unstable (poles reach the imaginary axis).' },
      ],
      quiz: [
        { q: 'A pole pair sits at $s = −2 ± 5j$. The response is:', choices: ['A growing oscillation', 'A decaying oscillation at 5 rad/s', 'A pure exponential decay', 'A constant'], answer: 1, why: 'Real part −2 gives decay as $e^{−2t}$; imaginary part 5 gives oscillation at 5 rad/s.' },
        { q: 'The lab system goes unstable at $K$ = 48. Operating at $K$ = 12, what is the gain margin as a factor?', num: 4, tol: 0.05, why: '$48/12 = 4$: the gain could quadruple before instability (about 12 dB).' },
      ],
    },
    {
      id: 'mech-rotation', skill: 'mech', title: 'Torque, inertia and angular momentum', pre: ['mech-momentum', 'linalg-vectors'],
      hook: 'Satellites point by trading angular momentum with spinning wheels. Nothing is thrown overboard; momentum is only moved around.',
      body: [
        'Rotation mirrors straight-line motion. Force becomes **torque** $τ = r × F$, mass becomes **moment of inertia** $I = Σmr^2$, and Newton’s law becomes $τ = Iα$.',
        '**Angular momentum** is $L = Iω$. With no external torque it is conserved, so if $I$ changes, $ω$ must change the other way. A skater pulling in her arms and a deploying satellite slowing its spin are the same event.',
        { eq: 'L = Iω = constant   ⇒   ω_2 = ω_1·I_1/I_2' },
        'Rotational kinetic energy is $½Iω^2 = L^2/2I$. It is not conserved when $I$ changes: pulling the masses inward takes work, and that work appears as extra spin energy.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'r', label: 'Mass radius r', min: 0.2, max: 1, step: 0.02, v: 1, unit: 'm' },
          { k: 'motor', type: 'toggle', label: 'Motor torque on (delivers up to 20 kg·m²/s)', v: false },
        ],
        init: () => ({ th: 0, L: 0 }),
        step(s, p, dt) { if (p.motor && s.L < 20) s.L = min(20, s.L + 5 * dt); s.th += s.L / (2 * p.r * p.r) * dt; },
        draw(g, s, p) {
          g.view(-1.6, 1.6, -1.25, 1.25, { eq: true, pad: [10, 10, 10, 10] });
          g.circle(0, 0, 1, g.c.grid, { w: 1, dash: [4, 4] });
          const x = p.r * cos(s.th), y = p.r * sin(s.th), w = s.L / (2 * p.r * p.r);
          g.line(-cos(s.th), -sin(s.th), cos(s.th), sin(s.th), g.c.dim, { w: 3 });
          g.dot(x, y, g.c.a, 13).dot(-x, -y, g.c.a, 13).dot(0, 0, g.c.ink, 5);
          if (w > 0.2) { g.arrow(x, y, x - sin(s.th) * min(0.9, w * p.r / 22), y + cos(s.th) * min(0.9, w * p.r / 22), g.c.b, { w: 2 }); }
          g.note('two 1 kg masses on a light rod', 'tl', g.c.dim);
        },
        read: (s, p) => { const I = 2 * p.r * p.r; return [['I', num(I, 3) + ' kg·m²'], ['L', num(s.L, 3) + ' kg·m²/s'], ['ω', num(s.L / I, 3) + ' rad/s'], ['spin energy', num(s.L * s.L / (2 * I), 3) + ' J']]; },
        mission: 'The motor can supply only 20 kg·m²/s. Reach a spin rate above 30 rad/s anyway.',
        goal: (s, p) => s.L / (2 * p.r * p.r) > 30,
        win: (s, p) => { s.L = 20; p.r = 0.5; },
      },
      cards: [
        { q: 'Give the rotational analogs of force, mass, momentum and $F = ma$.', a: 'Torque $τ$, moment of inertia $I = Σmr^2$, angular momentum $L = Iω$, and $τ = Iα$.' },
        { q: 'A spinning body with no external torque reduces its moment of inertia. What happens to $ω$ and to its kinetic energy?', a: '$L = Iω$ is conserved so $ω$ rises in proportion. Kinetic energy $L^2/2I$ also rises; the work done pulling mass inward supplies it.' },
      ],
      quiz: [
        { q: 'A satellite spinning at 6 rad/s deploys booms that triple its moment of inertia. What is its new spin rate?', num: 2, unit: 'rad/s', tol: 0.02, why: '$ω_2 = ω_1 I_1/I_2 = 6/3 = 2$ rad/s.' },
        { q: 'A reaction wheel inside a satellite speeds up clockwise. With no external torque, the satellite body:', choices: ['Stays still', 'Rotates counter-clockwise', 'Rotates clockwise', 'Translates sideways'], answer: 1, why: 'Total angular momentum stays zero, so the body must take up equal and opposite momentum.' },
      ],
    },
    {
      id: 'control-state-feedback', skill: 'control', title: 'State feedback: balancing the unstable', pre: ['control-stability', 'mech-rotation'],
      hook: 'A rocket balancing on its own thrust is an inverted pendulum. Left alone it falls over in a second; with feedback it flies.',
      body: [
        'Many high-performance vehicles are **open-loop unstable**: a small tilt creates a torque that increases the tilt. Linearized, the pitch dynamics are $θ″ = a·θ + b·u$ with $a > 0$.',
        'Feed back the whole state, angle and angular rate: $u = −(k_θ·θ + k_ω·ω)$. The closed loop becomes',
        { eq: 'θ″ + b·k_ω·θ′ + (b·k_θ − a)·θ = 0' },
        'Now you choose the stiffness and the damping, and therefore the poles. Stability needs $k_θ > a/b$ and $k_ω > 0$. Here $a$ = 4 and $b$ = 1.',
        'With more states, picking gains by hand becomes guesswork. **LQR** (the linear-quadratic regulator) computes the gain matrix that minimizes a cost $∫(x^{T}Qx + u^{T}Ru)dt$: you state how much you dislike error versus control effort, and the math returns the gains.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'kt', label: 'Angle gain k_θ', min: 0, max: 20, step: 0.5, v: 2, re: true },
          { k: 'kw', label: 'Rate gain k_ω', min: 0, max: 8, step: 0.1, v: 0, re: true },
          { type: 'button', label: 'Hit it with a gust', on: s => { if (!s.fell) s.w += 1.2; } },
        ],
        init: () => ({ th: 0.2, w: 0, t: 0, hist: [], fell: false, u: 0 }),
        step(s, p, dt) {
          if (s.fell) return;
          for (let i = 0; i < 10; i++) { s.u = clamp(-(p.kt * s.th + p.kw * s.w), -10, 10); s.w += (4 * sin(s.th) + s.u) * dt / 10; s.th += s.w * dt / 10; }
          s.t += dt; s.hist.push([s.t, s.th * 180 / PI]); if (s.hist.length > 480) s.hist.shift();
          if (abs(s.th) > 1.45) s.fell = true;
        },
        draw(g, s, p) {
          const split = g.w * 0.4;
          g.view(-1.3, 1.3, -0.35, 1.5, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.line(-1.3, 0, 1.3, 0, g.c.dim, { w: 2 }).line(0, 0, 0, 1.4, g.c.grid, { w: 1, dash: [4, 4] });
          const tx = sin(s.th) * 1.2, ty = cos(s.th) * 1.2;
          g.line(0, 0, tx, ty, s.fell ? g.c.bad : g.c.ink, { w: 9 });
          g.path([[tx, ty], [tx + sin(s.th) * 0.25 - cos(s.th) * 0.07, ty + cos(s.th) * 0.25 + sin(s.th) * 0.07], [tx + sin(s.th) * 0.25 + cos(s.th) * 0.07, ty + cos(s.th) * 0.25 - sin(s.th) * 0.07]], g.c.ink, { fill: true, fa: 1, close: true, w: 0 });
          g.arrow(0, -0.02, -s.u * 0.06, -0.3, g.c.a, { w: 4 });
          if (s.fell) g.text('fell over', 0, 0.7, g.c.bad, { a: 'center', s: 13, bold: true, bg: true });
          g.view(max(0, s.t - 8), max(8, s.t), -30, 30, { pad: [split + 44, 12, 14, 30] }).axes({ xl: 't (s)', yl: 'tilt θ (°)', xt: false });
          g.clip(() => g.path(s.hist, g.c.a, { w: 2 }));
        },
        read: (s, p) => { const st = p.kt - 4; return [['closed-loop stiffness', num(st)], ['damping ratio ζ', st > 0 ? num(p.kw / (2 * sqrt(st)), 3) : 'unstable'], ['tilt', num(s.th * 180 / PI, 3) + '°']]; },
        mission: 'Stabilize the vehicle with a damping ratio between 0.6 and 0.8, and let it settle upright.',
        goal: (s, p) => { const st = p.kt - 4, z = st > 0 ? p.kw / (2 * sqrt(st)) : 0; return !s.fell && z >= 0.6 && z <= 0.8 && s.t > 2 && abs(s.th) < 0.02 && abs(s.w) < 0.02; },
        win: { kt: 13, kw: 4.2 },
      },
      cards: [
        { q: 'For $θ″ = aθ + bu$ with $u = −(k_θθ + k_ωω)$, what conditions on the gains give stability?', a: '$k_θ > a/b$ (feedback stiffness must exceed the destabilizing term) and $k_ω > 0$ (positive damping).' },
        { q: 'What does LQR compute, and what do you tell it?', a: 'The state-feedback gain matrix minimizing $∫(x^{T}Qx + u^{T}Ru)dt$. You choose $Q$ (penalty on state error) and $R$ (penalty on control effort).' },
      ],
      quiz: [
        { q: 'With $a$ = 4 and $b$ = 1, the gains are $k_θ$ = 20, $k_ω$ = 4. What is the closed-loop damping ratio?', num: 0.5, tol: 0.01, why: 'Stiffness $= 20 − 4 = 16$, so $ω_n = 4$. Damping term $4 = 2ζω_n$ gives $ζ = 0.5$.' },
        { q: 'Why can’t angle feedback alone ($k_ω = 0$) stabilize the vehicle well?', choices: ['It makes the stiffness negative', 'It gives stiffness but no damping, so the vehicle oscillates forever', 'It uses too much fuel', 'It requires infinite gain'], answer: 1, why: 'With no rate term the closed loop is an undamped oscillator. Rate feedback supplies the damping.' },
      ],
    },
    {
      id: 'kalman-tracking', skill: 'kalman', title: 'Tracking: estimating what you cannot measure', pre: ['kalman-1d', 'ode-state-space', 'linalg-eigen'],
      hook: 'A radar reports position only. The tracker still knows the target’s velocity, because a model ties the two together.',
      body: [
        'Give the Kalman filter a state vector, here position and velocity, and a motion model:',
        { eq: 'x_{k+1} = F·x_k + w,   F = [1 Δt; 0 1],   z_k = [1 0]·x_k + v' },
        'The filter measures only position, yet the covariance matrix $P$ tracks how position and velocity errors are correlated. Each position measurement therefore corrects the velocity estimate as well. Velocity is **observable** through the model.',
        'The process noise $q$ says how hard the target might maneuver. Small $q$ assumes straight flight: smooth estimates, but the track lags badly in a turn. Large $q$ follows the turn and passes more noise. Real trackers adapt $q$ or run several models at once.',
        'In the lab the target flies straight, decelerates through a turn between steps 50 and 90, then flies straight again.',
      ],
      sim: {
        h: 340,
        controls: [{ k: 'lq', label: 'Assumed maneuver noise q', min: -4, max: 1, step: 0.1, v: -4, fmt: v => num(10 ** v, 2) }],
        draw(g, s, p) {
          const r = track(p.lq);
          g.view(0, 150, -100, 500, { pad: [48, 12, 14, 150] }).axes({ yl: 'position (m)', xt: false });
          g.clip(() => { TR.z.forEach((z, k) => g.dot(k, z, g.c.dim, 1.6)); g.path(TR.pos.map((v, k) => [k, v]), g.c.good, { w: 2 }); g.path(r.ep, g.c.a, { w: 2 }); });
          g.note('truth', 'tr', g.c.good).note('estimate', 'tr', g.c.a, 1);
          g.view(0, 150, -16, 16, { pad: [48, g.h - 136, 14, 30] }).axes({ xl: 'time step', yl: 'velocity (m/s): never measured' });
          g.clip(() => { g.path(TR.vel.map((v, k) => [k, v]), g.c.good, { w: 2 }); g.path(r.ev, g.c.a, { w: 2 }); });
        },
        read: (s, p) => { const r = track(p.lq); return [['position RMS error', num(r.rp, 3) + ' m'], ['velocity RMS error', num(r.rv, 3) + ' m/s'], ['raw measurement noise', '8 m']]; },
        mission: 'Tune q until the velocity RMS error is below 1.6 m/s.',
        goal: (s, p) => track(p.lq).rv < 1.6,
        win: { lq: 0 },
      },
      cards: [
        { q: 'A tracker measures only position. How does the Kalman filter obtain a velocity estimate?', a: 'The motion model links position to velocity, and the covariance matrix carries their correlation, so each position residual also corrects velocity. Velocity is observable through the model.' },
        { q: 'In a tracking filter, what is the trade in choosing the process noise $q$?', a: 'Small $q$: smooth estimates but large lag when the target maneuvers. Large $q$: follows maneuvers but passes more measurement noise.' },
      ],
      quiz: [
        { q: 'A constant-velocity tracker with very small $q$ follows a target that suddenly turns. The estimate will:', choices: ['Follow the turn immediately', 'Keep going straight and lag behind for a while', 'Become noisier', 'Reverse direction'], answer: 1, why: 'Small $q$ tells the filter the model is nearly perfect, so it trusts its straight-line prediction over the measurements.' },
        { q: 'With $F = [1 Δt; 0 1]$, $Δt$ = 2 s and state (position 100 m, velocity 15 m/s), what position does the filter predict next?', num: 130, unit: 'm', tol: 0.5, why: '$100 + 15 × 2 = 130$ m. Velocity is carried forward unchanged.' },
      ],
    },
    {
      id: 'rust-types', skill: 'rust', title: 'Rust: enums, Option and Result', pre: ['rust-ownership'],
      hook: 'A null pointer or an ignored error code has ended missions. Rust makes "there might be nothing here" a type the compiler will not let you forget.',
      body: [
        'A Rust `enum` is a value that is exactly one of several variants, and each variant can carry data. Two enums from the standard library replace two famous hazards:',
        { list: ['`Option<T>` is `Some(value)` or `None`. There is no null; absence is a variant you must handle.', '`Result<T, E>` is `Ok(value)` or `Err(error)`. A function that can fail says so in its type.'] },
        '`match` inspects an enum and must cover **every** variant, or the program does not compile. Add a new fault code to an enum and the compiler lists every place that needs updating.',
        { code: 'fn read_temp(raw: i16) -> Result<f32, SensorError> { ... }\n\nlet t = read_temp(raw)?;   // on Err, return it to the caller', lang: 'rust' },
        'The `?` operator passes an error up one level. Errors cannot be silently dropped: an unused `Result` triggers a compiler warning.',
      ],
      sim: tracer(
        ['enum Reading { Valid(f32), Fault(u8) }', '', 'fn decode(raw: i16) -> Reading {', '    if raw < 0 { Reading::Fault(1) }', '    else { Reading::Valid(raw as f32 * 0.1) }', '}', '', 'for raw in [215, -1] {', '    match decode(raw) {', '        Reading::Valid(t) => println!("{t} C"),', '        Reading::Fault(c) => println!("fault {c}"),', '    }', '}'],
        [
          { line: 7, vars: { raw: 215 }, note: 'first packet' },
          { line: 3, vars: { raw: 215 }, note: '215 < 0 is false' },
          { line: 4, vars: { raw: 215, returns: 'Valid(21.5)' }, note: 'variant carries the value' },
          { line: 8, vars: { raw: 215, value: 'Valid(21.5)' }, note: 'match must cover all variants' },
          { line: 9, vars: { raw: 215, t: 21.5 }, note: 'prints: 21.5 C' },
          { line: 7, vars: { raw: -1 }, note: 'second packet' },
          { line: 3, vars: { raw: -1, returns: 'Fault(1)' }, note: 'negative raw is a fault code' },
          { line: 8, vars: { raw: -1, value: 'Fault(1)' } },
          { line: 10, vars: { raw: -1, c: 1 }, note: 'prints: fault 1' },
        ],
        { h: 300, mission: 'Step through both packets, predicting which match arm runs.', goal: (s, p) => p.i === 8, win: { i: 8 } },
      ),
      cards: [
        { q: 'What are `Option<T>` and `Result<T, E>` in Rust, and what problems do they replace?', a: '`Option` is `Some(v)` or `None` (replaces null). `Result` is `Ok(v)` or `Err(e)` (replaces unchecked error codes and exceptions).' },
        { q: 'What does the compiler require of a `match` on an enum?', a: 'It must be exhaustive: every variant handled (or a wildcard arm), otherwise the code does not compile.' },
      ],
      quiz: [
        { q: 'What happens when this is compiled?', code: 'enum Mode { Safe, Armed, Test }\nfn label(m: Mode) -> &\'static str {\n    match m {\n        Mode::Safe => "safe",\n        Mode::Armed => "armed",\n    }\n}', lang: 'rust', choices: ['Compiles; `Test` returns an empty string', 'Compile error: `Mode::Test` is not covered', 'Compiles; panics at run time for `Test`', 'Compile error: enums cannot be matched'], answer: 1, why: 'Matches must be exhaustive. The compiler names the missing variant.' },
        { q: 'A function returns `Option<f32>`. Before using the number you must:', choices: ['Check for null with an if statement, optionally', 'Handle the `None` case, for example with `match` or `if let`', 'Cast it to `f32`', 'Nothing; it converts automatically'], answer: 1, why: 'An `Option<f32>` is not an `f32`. The type system forces you to deal with absence before you can reach the value.' },
      ],
    },
  ],
};

function kind(p) {
  const d = p.c * p.c - 4 * p.k;
  if (p.k < 0) return 'saddle (unstable)';
  if (abs(p.k) < 1e-9) return 'degenerate';
  if (abs(p.c) < 1e-9) return 'center';
  return (p.c > 0 ? 'stable ' : 'unstable ') + (d < 0 ? 'spiral' : 'node');
}
