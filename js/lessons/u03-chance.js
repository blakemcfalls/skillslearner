import { tracer, num, rng, Q, gauss, clamp } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, log10, atan2, hypot } = Math;

// --- Monte Carlo lab ---
export function fire(s, p) {
  if (s.n >= 50000) return;
  for (let i = 0; i < 1000; i++) {
    const x = s.r.n(), y = s.r.n(), hit = hypot(x, y) <= p.r;
    s.n++; if (hit) s.hits++;
    s.pts.push([x, y, hit]); if (s.pts.length > 1200) s.pts.shift();
    if (s.n % 50 === 0) s.hist.push([s.n, s.hits / s.n]);
  }
}
const mcHalf = s => (s.n ? 1.96 * sqrt(Math.max(1e-9, (s.hits / s.n) * (1 - s.hits / s.n)) / s.n) : 1);

// --- least squares data ---
const LX = [0, 1, 2, 3, 4, 5, 6, 7], LN = [0.4, -0.6, 0.3, 0.9, -0.8, 0.2, -0.5, 0.6];
const LY = LX.map((x, i) => 0.8 * x + 1.5 + LN[i]);
const sse = (m, b) => LX.reduce((a, x, i) => a + (LY[i] - m * x - b) ** 2, 0);
export const LS = (() => { const n = 8, sx = 28, sy = LY.reduce((a, b) => a + b), sxx = 140, sxy = LX.reduce((a, x, i) => a + x * LY[i], 0); const m = (n * sxy - sx * sy) / (n * sxx - sx * sx); return { m, b: (sy - m * sx) / n }; })();

// --- covariance ellipse ---
function ell(p) {
  const a = p.sx * p.sx, d = p.sy * p.sy, b = p.rho * p.sx * p.sy, tr = (a + d) / 2, disc = sqrt(Math.max(0, tr * tr - (a * d - b * b)));
  const l1 = tr + disc, l2 = Math.max(1e-9, tr - disc), th = 0.5 * atan2(2 * b, a - d);
  return { major: sqrt(l1), minor: sqrt(l2), th, deg: th * 180 / PI };
}

// --- 1D Kalman filter on a fixed data set ---
const KD = (() => { const r = rng(7), truth = [], z = []; let w = 0; for (let k = 0; k < 200; k++) { w += 0.06 * r.n(); const x = 10 + 3 * sin(0.03 * k) + w; truth.push(x); z.push(x + r.n()); } return { truth, z }; })();
export function kf(lq, lr) {
  const Qn = 10 ** lq, R = 10 ** lr; let x = KD.z[0], P = R, se = 0, K = 0; const est = [], band = [];
  KD.z.forEach((z, k) => { if (k) { P += Qn; K = P / (P + R); x += K * (z - x); P *= (1 - K); } est.push([k, x]); band.push(sqrt(P)); if (k >= 20) se += (x - KD.truth[k]) ** 2; });
  return { est, band, K, rms: sqrt(se / 180) };
}
const rawRms = sqrt(KD.z.reduce((a, z, k) => a + (k >= 20 ? (z - KD.truth[k]) ** 2 : 0), 0) / 180);

export default {
  id: 'u03', title: 'Chance and estimation', blurb: 'Probability, Monte Carlo and the first Kalman filter.',
  lessons: [
    {
      id: 'prob-distributions', skill: 'prob', title: 'Noise, averages and the bell curve', pre: ['py-numpy', 'calc-integral'],
      hook: 'Every sensor reading is a draw from a distribution. Averaging readings is the cheapest signal processing there is.',
      body: [
        'A random variable is described by its distribution. Two numbers summarize it: the **mean** $μ$ (center) and the **standard deviation** $σ$ (spread). Variance is $σ^2$.',
        'Average $n$ independent readings and two things happen. The spread shrinks:',
        { eq: 'σ_{mean} = σ/√n', where: 'four times the samples halves the noise' },
        'And the shape of the average heads toward a Gaussian whatever the original distribution looked like. That is the **central limit theorem**, and it is why the bell curve appears everywhere: most measured quantities are sums of many small effects.',
        'The lab draws flat (uniform) noise, averages $n$ readings, and histograms the result against the Gaussian the theorem predicts.',
      ],
      sim: {
        h: 300,
        controls: [{ k: 'n', label: 'Readings averaged n', min: 1, max: 40, step: 1, v: 1, re: true }],
        init: () => ({ bins: new Array(60).fill(0), count: 0, sum: 0, sq: 0, r: rng(11) }),
        step(s, p) {
          if (s.count >= 4000) return;
          for (let i = 0; i < 40; i++) { let m = 0; for (let j = 0; j < p.n; j++) m += s.r(); m /= p.n; s.bins[Math.min(59, Math.floor(m * 60))]++; s.count++; s.sum += m; s.sq += m * m; }
        },
        draw(g, s, p) {
          const sd = 0.288675 / sqrt(p.n), top = 1.3 / (sd * sqrt(2 * PI));
          g.view(0, 1, 0, top).axes({ xl: 'average of n readings', yl: 'density' });
          s.bins.forEach((b, i) => g.rect(i / 60, 0, 1 / 60, s.count ? b / s.count * 60 : 0, g.c.b, { fa: 0.5 }));
          g.fn(x => gauss(x, 0.5, sd), g.c.a, { w: 2.5, n: 400 });
          g.note('Gaussian predicted by the CLT', 'tr', g.c.a).note('histogram of averages', 'tr', g.c.b, 1);
        },
        read: (s, p) => { const m = s.sum / (s.count || 1); return [['samples', s.count], ['measured σ', num(sqrt(Math.max(0, s.sq / (s.count || 1) - m * m)), 3)], ['predicted σ/√n', num(0.288675 / sqrt(p.n), 3)]]; },
        mission: 'Choose n so the spread of the average falls below 0.06, and collect 1,000 samples to confirm it.',
        goal: (s, p) => { const m = s.sum / (s.count || 1); return s.count >= 1000 && sqrt(Math.max(0, s.sq / s.count - m * m)) < 0.06; },
        win: { n: 25 },
      },
      cards: [
        { q: 'How does the standard deviation of an average of $n$ independent readings compare with that of one reading?', a: 'It is smaller by $√n$: $σ_{mean} = σ/√n$.' },
        { q: 'State the central limit theorem in one sentence.', a: 'The sum (or average) of many independent random quantities is approximately Gaussian, regardless of the distribution of each one.' },
      ],
      quiz: [
        { q: 'One range reading has noise σ = 12 m. How many readings must be averaged to bring σ down to 3 m?', num: 16, tol: 0.01, why: '$12/√n = 3$ gives $√n = 4$, so $n = 16$.' },
        { q: 'You average 100 readings from a sensor whose noise is not Gaussian. The average is:', choices: ['Still shaped like the original noise', 'Approximately Gaussian with one tenth the spread', 'Exactly the true value', 'Gaussian with the same spread'], answer: 1, why: 'The CLT gives the Gaussian shape, and $σ/√100$ gives one tenth the spread.' },
      ],
    },
    {
      id: 'prob-bayes', skill: 'prob', title: 'Bayes’ rule and the base rate', pre: ['prob-distributions'],
      hook: 'A warning sensor that is "99% accurate" can still be wrong most of the times it alarms. The base rate decides.',
      body: [
        'Conditional probability $P(A|B)$ is the chance of $A$ given that $B$ happened. **Bayes’ rule** flips the condition:',
        { eq: 'P(target | alarm) = P(alarm | target)·P(target) / P(alarm)' },
        'A sensor has two error rates: probability of detection $P_d = P(alarm | target)$ and probability of false alarm $P_{fa} = P(alarm | no target)$. Neither is what the operator wants to know, which is "given this alarm, is it real?"',
        'When real targets are rare, the few true alarms are swamped by false alarms from the huge number of empty looks. The **prior** (base rate) matters as much as the sensor. This is why practical systems demand tiny $P_{fa}$ and confirm with a second look.',
      ],
      sim: {
        h: 280,
        controls: [
          { k: 'lb', label: 'Base rate: looks with a real target', min: -3, max: -0.3, step: 0.1, v: -2, fmt: v => num(10 ** v * 100, 2) + ' %' },
          { k: 'pd', label: 'Detection probability P_d', min: 0.5, max: 0.99, step: 0.01, v: 0.9 },
          { k: 'lf', label: 'False alarm probability P_fa', min: -4, max: -0.5, step: 0.1, v: -1.3, fmt: v => num(10 ** v * 100, 2) + ' %' },
        ],
        draw(g, s, p) {
          const b = 10 ** p.lb, fa = 10 ** p.lf, N = 100000, T = b * N, det = p.pd * T, fal = fa * (N - T), ppv = det / (det + fal);
          g.view(0, 1, 0, 1, { pad: [16, 10, 16, 10] });
          g.text('Out of 100,000 radar looks:', 0, 0.93, g.c.ink, { s: 12.5, mono: false, bold: true });
          g.text(`${num(T, 3)} contain a target  →  ${num(det, 3)} detected`, 0, 0.8, g.c.c, { s: 12.5 });
          g.text(`${num(N - T, 5)} are empty  →  ${num(fal, 3)} false alarms`, 0, 0.69, g.c.a, { s: 12.5 });
          g.text('Every alarm the operator sees:', 0, 0.5, g.c.ink, { s: 12.5, mono: false, bold: true });
          g.rect(0, 0.2, ppv, 0.2, g.c.c, { fa: 0.9 }).rect(ppv, 0.2, 1 - ppv, 0.2, g.c.a, { fa: 0.85 });
          if (ppv > 0.12) g.text('real', ppv / 2, 0.3, '#fff', { a: 'center', s: 12, bold: true });
          if (ppv < 0.85) g.text('false', ppv + (1 - ppv) / 2, 0.3, '#fff', { a: 'center', s: 12, bold: true });
          g.text(`P(target | alarm) = ${num(ppv * 100, 3)} %`, 0, 0.08, g.c.ink, { s: 13, bold: true });
        },
        read: (s, p) => { const b = 10 ** p.lb, fa = 10 ** p.lf, ppv = p.pd * b / (p.pd * b + fa * (1 - b)); return [['P(target | alarm)', num(ppv * 100, 3) + ' %'], ['false alarms per true detection', num(fa * (1 - b) / (p.pd * b), 3)]]; },
        mission: 'Targets appear in 1% of looks or fewer. Make an alarm at least 90% likely to be real.',
        goal: (s, p) => { const b = 10 ** p.lb, fa = 10 ** p.lf; return b <= 0.0101 && p.pd * b / (p.pd * b + fa * (1 - b)) >= 0.9; },
        win: { lb: -2, pd: 0.95, lf: -3.1 },
      },
      cards: [
        { q: 'Write Bayes’ rule for $P(H|E)$.', a: '$P(H|E) = P(E|H)·P(H)/P(E)$, where $P(E) = P(E|H)P(H) + P(E|¬H)P(¬H)$.' },
        { q: 'Why can a sensor with high $P_d$ and low $P_{fa}$ still produce mostly false alarms?', a: 'If targets are rare (low prior), the small false-alarm rate applied to the enormous number of empty looks outnumbers the true detections.' },
      ],
      quiz: [
        { q: 'Targets are present in 1 look per 1,000. $P_d$ = 0.9 and $P_{fa}$ = 0.01. What fraction of alarms are real? Give a percentage.', num: 8.3, unit: '%', tol: 0.3, why: 'Per 100,000 looks: 100 targets → 90 detections; 99,900 empty → 999 false alarms. $90/(90 + 999) ≈ 8.3$%.' },
        { q: 'To raise $P(target | alarm)$ the most when targets are rare, you should:', choices: ['Raise $P_d$ from 0.90 to 0.99', 'Cut $P_{fa}$ by a factor of 10', 'Take fewer looks', 'Ignore the base rate'], answer: 1, why: 'False alarms dominate the alarm count when targets are rare, so dividing $P_{fa}$ by ten removes most of them.' },
      ],
    },
    {
      id: 'mc-basics', skill: 'mc', title: 'Monte Carlo: answers by sampling', pre: ['prob-distributions', 'num-euler-rk4'],
      hook: 'When the math will not close, simulate the system thousands of times with random inputs and count what happens.',
      body: [
        'A **Monte Carlo** estimate replaces an integral or a probability with an average over random samples. To find the chance that a round lands inside a circle, draw many impact points and count the fraction inside.',
        'The estimate is itself random. Its standard error is',
        { eq: 'SE = √(p(1 − p)/N)', where: 'for an estimated probability $p$ from $N$ samples' },
        'so precision improves as $1/√N$: one more decimal digit costs 100 times the samples. The good news is that this rate does not depend on how many random inputs the model has, which is why Monte Carlo is the standard tool for high-dimensional engineering problems.',
        'A 95% confidence interval is about $±1.96·SE$.',
      ],
      sim: {
        h: 320, resettable: true,
        controls: [
          { k: 'r', label: 'Circle radius ÷ dispersion σ', min: 0.5, max: 3, step: 0.1, v: 1, re: true },
          { type: 'button', label: 'Fire 1,000 rounds', on: (s, p) => fire(s, p) },
        ],
        init: () => ({ n: 0, hits: 0, pts: [], hist: [], r: rng(5) }),
        draw(g, s, p) {
          const exact = 1 - exp(-p.r * p.r / 2), split = Math.min(g.h, g.w * 0.42);
          g.view(-3.6, 3.6, -3.6, 3.6, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.circle(0, 0, p.r, g.c.ink, { w: 2, fill: g.c.c, fa: 0.12 });
          s.pts.forEach(([x, y, hit]) => { if (abs(x) < 3.6 && abs(y) < 3.6) g.dot(x, y, hit ? g.c.c : g.c.a, 1.6, { alpha: 0.7 }); });
          g.view(0, Math.max(2000, s.n), Math.max(0, exact - 0.12), Math.min(1, exact + 0.12), { pad: [split + 52, 12, 14, 30] }).axes({ xl: 'rounds N', yl: 'estimated P(hit)' });
          g.fn(n => exact + 1.96 * sqrt(exact * (1 - exact) / Math.max(n, 1)), g.c.dim, { w: 1, dash: [4, 4] });
          g.fn(n => exact - 1.96 * sqrt(exact * (1 - exact) / Math.max(n, 1)), g.c.dim, { w: 1, dash: [4, 4] });
          g.line(0, exact, Math.max(2000, s.n), exact, g.c.good, { w: 1.5 });
          g.clip(() => g.path(s.hist, g.c.a, { w: 2 }));
          g.note('exact', 'tr', g.c.good).note('95% band ∝ 1/√N', 'tr', g.c.dim, 1);
        },
        read: (s, p) => [['rounds', s.n], ['estimate', s.n ? num(s.hits / s.n, 4) : '–'], ['exact', num(1 - exp(-p.r * p.r / 2), 4)], ['95% half-width', s.n ? '±' + num(mcHalf(s), 3) : '–']],
        mission: 'Fire enough rounds to shrink the 95% half-width below ±0.01.',
        goal: s => s.n > 0 && mcHalf(s) < 0.01,
        win: (s, p) => { for (let i = 0; i < 10; i++) fire(s, p); },
      },
      cards: [
        { q: 'How does Monte Carlo error scale with the number of samples $N$, and what does that imply for one more digit of precision?', a: 'Error ∝ $1/√N$. Ten times better precision needs 100 times more samples.' },
        { q: 'What is the standard error of a probability estimated from $N$ Monte Carlo trials?', a: '$√(p(1−p)/N)$. A 95% interval is roughly ±1.96 times that.' },
      ],
      quiz: [
        { q: 'A Monte Carlo run of 2,500 trials gives a standard error of 0.01. About how many trials are needed for 0.002?', num: 62500, tol: 700, why: 'Five times smaller error needs $5^2 = 25$ times the trials: 62,500.' },
        { q: 'Why is Monte Carlo favored for a simulation with 40 uncertain inputs?', choices: ['It is exact', 'Its convergence rate does not depend on the number of inputs', 'It needs no random numbers', 'It converges like 1/N'], answer: 1, why: 'Grid methods need points in every dimension, which is hopeless at 40. Monte Carlo error stays ∝ $1/√N$.' },
      ],
      code: {
        prompt: 'Complete `estimate_pi(n, seed)`: draw `n` random points in the unit square, find the fraction inside the quarter circle $x^2 + y^2 ≤ 1$, and return 4 times that fraction. Use the provided generator so results repeat.',
        starter: 'import numpy as np\n\ndef estimate_pi(n, seed=0):\n    rng = np.random.default_rng(seed)\n    x = rng.random(n)\n    y = rng.random(n)\n    return 0.0  # replace\n\nfor n in [100, 10_000, 1_000_000]:\n    print(n, estimate_pi(n))',
        solution: 'import numpy as np\n\ndef estimate_pi(n, seed=0):\n    rng = np.random.default_rng(seed)\n    x = rng.random(n)\n    y = rng.random(n)\n    return 4 * np.mean(x * x + y * y <= 1.0)\n\nfor n in [100, 10_000, 1_000_000]:\n    print(n, estimate_pi(n))',
        tests: 'assert abs(estimate_pi(200_000, 1) - 3.14159) < 0.02, f"estimate with 200,000 points was {estimate_pi(200_000, 1)}"\nassert abs(estimate_pi(100, 2) - 3.14159) < 0.7\nassert estimate_pi(1000, 3) != estimate_pi(1000, 4), "different seeds should give different estimates"',
        hint: '`x * x + y * y <= 1.0` is a boolean array. `np.mean` of it is the fraction that is True.',
      },
    },
    {
      id: 'linalg-least-squares', skill: 'linalg', title: 'Least squares: the best wrong answer', pre: ['linalg-matrices', 'prob-distributions'],
      hook: 'Eight noisy measurements and two unknowns: no line fits them all. Least squares picks the one that misses by the least.',
      body: [
        'With more equations than unknowns, $Ax = b$ usually has no exact solution. **Least squares** chooses the $x$ that minimizes the total squared miss, $‖Ax − b‖^2$.',
        'Squared error is used because it is smooth and because, for Gaussian noise, the least-squares answer is also the most probable one. Setting the gradient to zero gives the **normal equations**:',
        { eq: 'A^{T}A·x = A^{T}b' },
        'For a line $y = mx + c$, each row of $A$ is $[x_i, 1]$. Geometrically the solution projects $b$ onto the space that $A$ can reach, leaving a residual perpendicular to it. GPS position fixes, radar track fits and sensor calibration are all this computation.',
      ],
      labNote: 'Each shaded square has an area equal to one squared residual. Shrink the total area.',
      sim: {
        h: 330,
        controls: [
          { k: 'm', label: 'Slope m', min: 0, max: 2, step: 0.01, v: 0.3 },
          { k: 'b', label: 'Intercept c', min: -2, max: 5, step: 0.05, v: 3 },
          { k: 'show', type: 'toggle', label: 'Show the least-squares line', v: false },
        ],
        draw(g, s, p) {
          g.view(-1, 9, -1, 9, { eq: true }).axes({ xl: 'x', yl: 'y' });
          g.clip(() => {
            LX.forEach((x, i) => { const r = LY[i] - (p.m * x + p.b); g.rect(r > 0 ? x - abs(r) : x, Math.min(LY[i], p.m * x + p.b), abs(r), abs(r), g.c.a, { fa: 0.2, stroke: g.c.a }); });
            g.fn(x => p.m * x + p.b, g.c.ink, { w: 2.5 });
            if (p.show) g.fn(x => LS.m * x + LS.b, g.c.good, { w: 2, dash: [6, 4] });
          });
          LX.forEach((x, i) => g.dot(x, LY[i], g.c.b, 5));
        },
        read: (s, p) => [['sum of squared residuals', num(sse(p.m, p.b), 4)], ['smallest possible', num(sse(LS.m, LS.b), 4)]],
        mission: 'By adjusting slope and intercept, get the sum of squares within 2% of the smallest possible.',
        goal: (s, p) => sse(p.m, p.b) <= 1.02 * sse(LS.m, LS.b),
        win: { m: Math.round(LS.m * 100) / 100, b: Math.round(LS.b * 20) / 20 },
      },
      cards: [
        { q: 'What quantity does a least-squares solution minimize?', a: 'The sum of squared residuals, $‖Ax − b‖^2$: the squared distance between what the model predicts and what was measured.' },
        { q: 'Write the normal equations for the least-squares solution of $Ax ≈ b$.', a: '$A^{T}A x = A^{T}b$.' },
      ],
      quiz: [
        { q: 'Fitting a line to 50 points gives a system with how many unknowns and how many equations?', choices: ['50 unknowns, 2 equations', '2 unknowns, 50 equations', '50 and 50', '2 and 2'], answer: 1, why: 'The unknowns are slope and intercept. Each data point contributes one equation.' },
        { q: 'One data point is wildly wrong (an outlier). Least squares will:', choices: ['Ignore it', 'Be pulled strongly toward it, because its error is squared', 'Fail to produce an answer', 'Weight it the same as a small error'], answer: 1, why: 'Squaring makes large residuals dominate the cost, so one outlier can drag the fit. Robust methods limit that influence.' },
      ],
    },
    {
      id: 'prob-gaussian-cov', skill: 'prob', title: 'Covariance and the error ellipse', pre: ['linalg-matrices', 'prob-distributions'],
      hook: 'A radar knows range to meters and angle only to a fraction of a degree. Its uncertainty is a long thin ellipse, and trackers must carry its shape.',
      body: [
        'Uncertainty in two quantities needs more than two standard deviations. The **covariance matrix** also records how the errors move together:',
        { eq: 'P = [σ_x^2  ρσ_xσ_y; ρσ_xσ_y  σ_y^2]', where: '$ρ$ = correlation, from −1 to 1' },
        'A 2-D Gaussian with covariance $P$ has elliptical contours. The ellipse axes point along the **eigenvectors** of $P$, and their half-lengths are the square roots of its eigenvalues. (Eigenvectors get a full lesson soon; for now, read them as the natural axes of the cloud.)',
        'Strong correlation means a thin tilted ellipse: knowing one error tells you most of the other. A second sensor looking from a different angle cuts the long axis down.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'sx', label: 'σₓ', min: 0.5, max: 3, step: 0.1, v: 2 }, { k: 'sy', label: 'σ_y', min: 0.5, max: 3, step: 0.1, v: 1 },
          { k: 'rho', label: 'Correlation ρ', min: -0.99, max: 0.99, step: 0.01, v: 0.3 },
        ],
        init: () => { const r = rng(3); return { z: Array.from({ length: 350 }, () => [r.n(), r.n()]) }; },
        draw(g, s, p) {
          g.view(-8, 8, -6, 6, { eq: true }).axes({ xl: 'x error', yl: 'y error' });
          const e = ell(p), k = sqrt(1 - p.rho * p.rho);
          g.clip(() => {
            s.z.forEach(([a, b]) => g.dot(p.sx * a, p.sy * (p.rho * a + k * b), g.c.b, 1.8, { alpha: 0.55 }));
            [1, 2].forEach(n => { const pts = []; for (let i = 0; i <= 72; i++) { const t = i / 72 * 2 * PI, u = n * e.major * cos(t), v = n * e.minor * sin(t); pts.push([u * cos(e.th) - v * sin(e.th), u * sin(e.th) + v * cos(e.th)]); } g.path(pts, g.c.a, { w: n === 1 ? 2.5 : 1.5, dash: n === 2 ? [5, 4] : [] }); });
            g.arrow(0, 0, e.major * cos(e.th), e.major * sin(e.th), g.c.ink, { w: 2 }).arrow(0, 0, -e.minor * sin(e.th), e.minor * cos(e.th), g.c.ink, { w: 2 });
          });
          g.note('1σ and 2σ ellipses', 'tr', g.c.a);
        },
        read: (s, p) => { const e = ell(p); return [['long axis σ', num(e.major)], ['short axis σ', num(e.minor)], ['axis ratio', num(e.major / e.minor)], ['tilt', num(e.deg) + '°']]; },
        mission: 'Shape an ellipse at least 5 times longer than it is wide, tilted between 40° and 50°.',
        goal: (s, p) => { const e = ell(p); return e.major / e.minor >= 5 && e.deg >= 40 && e.deg <= 50; },
        win: { sx: 2, sy: 2, rho: 0.93 },
      },
      cards: [
        { q: 'What do the off-diagonal entries of a covariance matrix represent?', a: 'How two errors vary together: $ρσ_xσ_y$. Zero means uncorrelated; near ±$σ_xσ_y$ means one error nearly determines the other.' },
        { q: 'How are the axes of a Gaussian error ellipse related to its covariance matrix?', a: 'The axes point along the eigenvectors of the covariance matrix; their 1σ half-lengths are the square roots of the eigenvalues.' },
      ],
      quiz: [
        { q: '$σ_x = σ_y = 2$ and $ρ = 0$. The 1σ contour is:', choices: ['A circle of radius 2', 'An ellipse tilted 45°', 'A line', 'A circle of radius 4'], answer: 0, why: 'Equal variances and no correlation give equal eigenvalues (4), so the contour is a circle of radius $√4 = 2$.' },
        { q: 'Two sensors view a target from directions 90° apart. Each has a long thin error ellipse along its own line of sight. Fusing them gives:', choices: ['A larger ellipse', 'A small, roughly round ellipse', 'The same ellipse as the better sensor', 'A line'], answer: 1, why: 'Each sensor is precise exactly where the other is poor, so the combined uncertainty is small in both directions.' },
      ],
    },
    {
      id: 'prob-estimation', skill: 'prob', title: 'How many tests are enough?', pre: ['mc-basics', 'prob-bayes'],
      hook: 'Flight tests cost millions each. Statistics tells you what ten of them can and cannot prove.',
      body: [
        'Run $n$ independent trials, see $k$ successes, and the natural estimate of the success probability is $p̂ = k/n$. It carries uncertainty:',
        { eq: 'p̂ ± 1.96·√(p̂(1 − p̂)/n)', where: 'approximate 95% confidence interval' },
        'The interval means: if you repeated the whole test campaign many times, about 95% of the intervals built this way would contain the true value. Any single interval either does or does not.',
        'In the lab each vertical bar is one complete campaign of $n$ trials. Red bars missed the truth. Notice how slowly the bars shorten: halving the width takes four times the trials.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'p', label: 'True success probability', min: 0.5, max: 0.95, step: 0.05, v: 0.8, re: true },
          { k: 'n', label: 'Trials per campaign n', min: 10, max: 500, step: 2, v: 30, re: true },
          { type: 'button', label: 'Run 40 new campaigns', on: s => { s.seed++; s.runs = null; } },
        ],
        init: () => ({ seed: 1, runs: null }),
        draw(g, s, p) {
          if (!s.runs) { const r = rng(s.seed * 97 + p.n); s.runs = Array.from({ length: 40 }, () => { let k = 0; for (let i = 0; i < p.n; i++) if (r() < p.p) k++; const ph = k / p.n, hw = 1.96 * sqrt(ph * (1 - ph) / p.n); return [ph, hw]; }); }
          g.view(0, 41, 0.3, 1.02).axes({ xl: 'campaign', yl: 'estimated probability with 95% interval', xt: false });
          g.line(0, p.p, 41, p.p, g.c.good, { w: 2 });
          g.clip(() => s.runs.forEach(([ph, hw], i) => { const miss = abs(ph - p.p) > hw; g.line(i + 1, ph - hw, i + 1, ph + hw, miss ? g.c.bad : g.c.b, { w: 3 }); g.dot(i + 1, ph, miss ? g.c.bad : g.c.b, 3); }));
          g.note('true value', 'tr', g.c.good);
        },
        read: (s, p) => [['typical 95% half-width', '±' + num(1.96 * sqrt(p.p * (1 - p.p) / p.n), 3)], ['campaigns that missed the truth', s.runs ? s.runs.filter(([ph, hw]) => abs(ph - p.p) > hw).length + ' of 40' : '–']],
        mission: 'The true probability is 0.8. Find how many trials make the 95% half-width smaller than ±0.05.',
        goal: (s, p) => p.p === 0.8 && 1.96 * sqrt(0.16 / p.n) < 0.05,
        win: { p: 0.8, n: 250 },
      },
      cards: [
        { q: 'Give the approximate 95% confidence interval for a probability estimated as $p̂$ from $n$ trials.', a: '$p̂ ± 1.96√(p̂(1−p̂)/n)$.' },
        { q: 'What does "95% confidence" mean for an interval?', a: 'The procedure captures the true value in about 95% of repeated experiments. It is a statement about the method, not a 95% probability for one particular interval.' },
      ],
      quiz: [
        { q: 'A system succeeds in 18 of 20 tests. What is the approximate 95% half-width on its success probability?', num: 0.13, tol: 0.01, why: '$1.96√(0.9 × 0.1/20) = 1.96 × 0.067 ≈ 0.13$. Twenty tests leave a wide margin.' },
        { q: 'To halve the width of a confidence interval you need:', choices: ['Twice the trials', 'Four times the trials', 'Half the trials', 'Ten times the trials'], answer: 1, why: 'Width ∝ $1/√n$, so half the width needs four times $n$.' },
      ],
    },
    {
      id: 'detect-threshold', skill: 'detect', title: 'Detection is a threshold decision', pre: ['prob-bayes', 'prob-distributions'],
      hook: 'A radar receiver never sees "target" or "no target". It sees a voltage, and someone had to decide where to draw the line.',
      body: [
        'With no target the receiver output is noise, spread around zero. With a target it is the same noise shifted up by the signal. The detector compares the output with a **threshold** $T$ and declares a target if it is exceeded.',
        { list: ['$P_{fa}$: area of the noise-only curve above $T$.', '$P_d$: area of the signal-plus-noise curve above $T$.'] },
        'Raising $T$ lowers both; lowering $T$ raises both. The only way to improve one without hurting the other is to separate the curves, which means more **signal-to-noise ratio** (SNR). The curve of $P_d$ against $P_{fa}$ as $T$ slides is the **ROC** (receiver operating characteristic).',
        'Radar designers usually fix $P_{fa}$ first (say $10^{−6}$ per cell, because there are millions of cells) and then ask how much SNR the required $P_d$ costs.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'snr', label: 'SNR', min: 0, max: 20, step: 0.1, v: 6, unit: 'dB' },
          { k: 'T', label: 'Threshold T (in noise σ)', min: -2, max: 8, step: 0.05, v: 1 },
        ],
        draw(g, s, p) {
          const d = 10 ** (p.snr / 20), split = g.w * 0.62;
          g.view(-4, 12, 0, 0.45, { pad: [44, 12, g.w - split, 30] }).axes({ xl: 'receiver output (noise σ)', yt: false });
          const tail = (mu, col) => { const pts = [[p.T, 0]]; for (let x = p.T; x <= 12; x += 0.05) pts.push([x, gauss(x, mu)]); pts.push([12, 0]); g.path(pts, col, { fill: true, fa: 0.3, w: 0, close: true }); };
          g.clip(() => { tail(d, g.c.c); tail(0, g.c.a); });
          g.fn(x => gauss(x), g.c.a, { w: 2 }).fn(x => gauss(x, d), g.c.c, { w: 2 });
          g.line(p.T, 0, p.T, 0.45, g.c.ink, { w: 2, dash: [5, 4] }).text('T', p.T, 0.43, g.c.ink, { dx: 5, s: 12 });
          g.note('noise only', 'tl', g.c.a).note('signal + noise', 'tl', g.c.c, 1);
          g.view(-6, 0, 0, 1, { pad: [split + 46, 12, 12, 30] }).axes({ xl: 'P_fa', yl: 'P_d', xf: v => '10' + ('⁰¹²³⁴⁵⁶'[-v] ? '⁻' + '⁰¹²³⁴⁵⁶'[-v] : ''), xs: 2 });
          const roc = []; for (let T = -3; T <= 9; T += 0.1) roc.push([log10(Math.max(1e-7, Q(T))), Q(T - d)]);
          g.clip(() => g.path(roc, g.c.d, { w: 2 }));
          g.dot(clamp(log10(Math.max(1e-7, Q(p.T))), -6, 0), Q(p.T - d), g.c.ink, 5);
        },
        read: (s, p) => { const d = 10 ** (p.snr / 20); return [['P_d', num(Q(p.T - d), 3)], ['P_fa', num(Q(p.T), 2)]]; },
        mission: 'Reach P_d ≥ 0.9 with P_fa ≤ 10⁻³ using no more than 13 dB of SNR.',
        goal: (s, p) => p.snr <= 13 && Q(p.T - 10 ** (p.snr / 20)) >= 0.9 && Q(p.T) <= 1e-3,
        win: { snr: 13, T: 3.1 },
      },
      cards: [
        { q: 'Define $P_d$ and $P_{fa}$ in terms of the threshold and the two receiver-output distributions.', a: '$P_{fa}$ is the area of the noise-only distribution above the threshold. $P_d$ is the area of the signal-plus-noise distribution above it.' },
        { q: 'What is an ROC curve, and what moves a detector to a better ROC curve?', a: 'The plot of $P_d$ versus $P_{fa}$ as the threshold varies. Moving the threshold slides along one curve; only more SNR (better separation) gives a better curve.' },
      ],
      quiz: [
        { q: 'An operator lowers the detection threshold. What happens?', choices: ['$P_d$ up, $P_{fa}$ down', 'Both go up', 'Both go down', '$P_d$ down, $P_{fa}$ up'], answer: 1, why: 'More of both distributions lies above a lower threshold: more detections and more false alarms.' },
        { q: 'A radar checks 1,000,000 range-Doppler cells per scan with $P_{fa} = 10^{−6}$ per cell. Expected false alarms per scan:', num: 1, tol: 0.01, why: '$10^6 × 10^{−6} = 1$. This is why per-cell $P_{fa}$ must be so small.' },
      ],
    },
    {
      id: 'kalman-1d', skill: 'kalman', title: 'The Kalman filter in one dimension', pre: ['prob-gaussian-cov', 'ode-first-order', 'detect-threshold'],
      hook: 'Blend what you predicted with what you measured, weighted by how much you trust each. That one idea steers spacecraft.',
      body: [
        'A Kalman filter keeps two numbers for each quantity: an estimate $x̂$ and its variance $P$. Each cycle has two steps.',
        { list: ['**Predict.** Carry the estimate forward. Uncertainty grows by the process noise: $P ← P + Q$.', '**Update.** A measurement $z$ with noise variance $R$ arrives. Blend: $K = P/(P + R)$, then $x̂ ← x̂ + K(z − x̂)$ and $P ← (1 − K)P$.'] },
        'The **Kalman gain** $K$ lies between 0 and 1. If the measurement is trusted ($R$ small) $K$ nears 1 and the filter follows the data. If the model is trusted ($Q$ small) $K$ nears 0 and the filter smooths heavily but lags any real change.',
        'Tuning is choosing $Q$ and $R$. In the lab the true signal drifts and the sensor noise has σ = 1. Too little $Q$ and the estimate lags; too much and it chases noise.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'lq', label: 'Process noise Q', min: -5, max: 0, step: 0.1, v: -5, fmt: v => num(10 ** v, 2) },
          { k: 'lr', label: 'Measurement noise R', min: -2, max: 2, step: 0.1, v: 0, fmt: v => num(10 ** v, 2) },
        ],
        draw(g, s, p) {
          g.view(0, 200, 5, 16).axes({ xl: 'time step', yl: 'value' });
          const r = kf(p.lq, p.lr);
          g.clip(() => {
            g.path([...r.est.map(([k, x], i) => [k, x + 2 * r.band[i]]), ...r.est.map(([k, x], i) => [k, x - 2 * r.band[i]]).reverse()], g.c.a, { fill: true, fa: 0.15, w: 0, close: true });
            KD.z.forEach((z, k) => g.dot(k, z, g.c.dim, 1.8, { alpha: 0.8 }));
            g.path(KD.truth.map((x, k) => [k, x]), g.c.good, { w: 2 });
            g.path(r.est, g.c.a, { w: 2.5 });
          });
          g.note('truth', 'tr', g.c.good).note('estimate ± 2σ', 'tr', g.c.a, 1).note('measurements', 'tr', g.c.dim, 2);
        },
        read: (s, p) => { const r = kf(p.lq, p.lr); return [['steady gain K', num(r.K, 3)], ['estimate RMS error', num(r.rms, 3)], ['raw measurement RMS error', num(rawRms, 3)]]; },
        mission: 'Tune Q and R until the estimate’s RMS error is below 0.42: less than half of the raw sensor error.',
        goal: (s, p) => kf(p.lq, p.lr).rms < 0.42,
        win: { lq: -1.2, lr: 0 },
      },
      cards: [
        { q: 'Write the scalar Kalman update: gain, estimate and variance.', a: '$K = P/(P+R)$; $x̂ ← x̂ + K(z − x̂)$; $P ← (1−K)P$.' },
        { q: 'In a Kalman filter, what happens to the gain and the behavior if $Q$ is set too small? Too large?', a: 'Too small: gain falls toward 0, the estimate is smooth but lags real changes. Too large: gain rises toward 1, the estimate follows measurement noise.' },
        { q: 'What are the two steps of each Kalman filter cycle and what does each do to the uncertainty $P$?', a: 'Predict (uncertainty grows: $P + Q$) and update (uncertainty shrinks: $(1−K)P$).' },
      ],
      quiz: [
        { q: 'Prior estimate 100 with variance $P = 9$. A measurement of 106 arrives with $R = 3$. What is the updated estimate?', num: 104.5, tol: 0.05, why: '$K = 9/(9+3) = 0.75$, so $x̂ = 100 + 0.75 × 6 = 104.5$.' },
        { q: 'After that update, the variance $P$ becomes:', num: 2.25, tol: 0.02, why: '$(1 − K)P = 0.25 × 9 = 2.25$. Smaller than both the prior variance and $R$.' },
      ],
      code: {
        prompt: 'Implement the two halves of a scalar Kalman filter. `predict(x, P, Q)` returns the pair after the predict step (the state itself does not change in this model). `update(x, P, z, R)` returns the pair after blending in measurement `z`.',
        starter: 'def predict(x, P, Q):\n    return x, P  # fix the variance\n\ndef update(x, P, z, R):\n    K = 0.0      # Kalman gain\n    return x, P  # blend using K\n\nx, P = 0.0, 100.0\nfor z in [10.2, 9.7, 10.4, 9.9]:\n    x, P = predict(x, P, 0.01)\n    x, P = update(x, P, z, 1.0)\n    print(round(x, 3), round(P, 3))',
        solution: 'def predict(x, P, Q):\n    return x, P + Q\n\ndef update(x, P, z, R):\n    K = P / (P + R)\n    return x + K * (z - x), (1 - K) * P\n\nx, P = 0.0, 100.0\nfor z in [10.2, 9.7, 10.4, 9.9]:\n    x, P = predict(x, P, 0.01)\n    x, P = update(x, P, z, 1.0)\n    print(round(x, 3), round(P, 3))',
        tests: 'assert predict(1.0, 2.0, 0.5) == (1.0, 2.5), "predict should add Q to P"\n_x, _P = update(0.0, 1.0, 2.0, 1.0)\nassert abs(_x - 1.0) < 1e-12 and abs(_P - 0.5) < 1e-12, f"update(0, 1, 2, 1) gave ({_x}, {_P}), expected (1.0, 0.5)"\n_x, _P = update(10.0, 4.0, 12.0, 1.0)\nassert abs(_x - 11.6) < 1e-9 and abs(_P - 0.8) < 1e-9',
        hint: 'Gain: `K = P / (P + R)`. New estimate: `x + K * (z - x)`. New variance: `(1 - K) * P`.',
      },
    },
    {
      id: 'rust-ownership', skill: 'rust', title: 'Rust: ownership and borrowing', pre: ['py-basics', 'vcs-testing'],
      hook: 'Most serious vulnerabilities in C and C++ systems are memory errors. Rust removes that class of bug at compile time, with no garbage collector.',
      body: [
        'Rust’s core rule: every value has exactly one **owner**. When the owner goes out of scope the value is freed. Assigning a heap value to another name **moves** ownership; the old name can no longer be used.',
        'To let code use a value without taking it, you **borrow** it with a reference:',
        { list: ['`&T` is a shared, read-only borrow. Any number may exist at once.', '`&mut T` is an exclusive, writable borrow. While it exists, no other reference may.'] },
        'The compiler checks these rules. Use-after-free, double free and data races become compile errors instead of field failures. The cost is that you must be explicit about who owns what, which is a design discipline embedded systems benefit from anyway.',
      ],
      sim: tracer(
        ['fn main() {', '    let a = String::from("fin");', '    let b = a;                 // move', '    // println!("{}", a);      // would not compile', '    let n = len(&b);           // shared borrow', '    let mut c = b.clone();     // deep copy', '    grow(&mut c);              // exclusive borrow', '    println!("{} {} {}", b, c, n);', '}'],
        [
          { line: 1, vars: { a: 'owns "fin"' }, note: 'a owns the heap string' },
          { line: 2, vars: { a: '✗ moved', b: 'owns "fin"' }, note: 'ownership moved to b' },
          { line: 3, vars: { a: '✗ moved', b: 'owns "fin"' }, note: 'error[E0382]: borrow of moved value', bad: true },
          { line: 4, vars: { a: '✗ moved', b: 'owns "fin" (lent, read-only)', n: 3 }, note: '&b lends without giving up b' },
          { line: 5, vars: { a: '✗ moved', b: 'owns "fin"', n: 3, c: 'owns its own "fin"' }, note: 'clone makes a second string' },
          { line: 6, vars: { a: '✗ moved', b: 'owns "fin"', n: 3, c: 'owns "fin!"' }, note: 'grow changed c through &mut' },
          { line: 7, vars: { a: '✗ moved', b: 'owns "fin"', n: 3, c: 'owns "fin!"' }, note: 'prints: fin fin! 3' },
          { line: 8, vars: { a: '✗ moved', b: 'freed', n: 'gone', c: 'freed' }, note: 'scope ends: owners free their values' },
        ],
        { h: 250, varsTitle: 'OWNERSHIP', mission: 'Step to the closing brace, tracking who owns each string.', goal: (s, p) => p.i === 7, win: { i: 7 } },
      ),
      cards: [
        { q: 'State Rust’s ownership rule and what happens on `let b = a;` when `a` is a `String`.', a: 'Each value has exactly one owner and is freed when that owner goes out of scope. `let b = a;` moves ownership to `b`; using `a` afterward is a compile error.' },
        { q: 'What is the difference between `&T` and `&mut T`?', a: '`&T` is a shared read-only borrow (many allowed at once). `&mut T` is an exclusive writable borrow (no other references may exist while it does).' },
      ],
      quiz: [
        { q: 'Does this compile?', code: 'let mut v = vec![1, 2, 3];\nlet first = &v[0];\nv.push(4);\nprintln!("{}", first);', lang: 'rust', choices: ['Yes, prints 1', 'No: `v` is mutated while a shared borrow is still in use', 'No: vectors cannot be pushed to', 'Yes, prints 4'], answer: 1, why: '`push` needs `&mut v` while `first` (a shared borrow) is used afterward. The push could reallocate and leave `first` dangling, which is exactly the bug Rust forbids.' },
        { q: 'Which class of bug does the borrow checker eliminate at compile time?', choices: ['Logic errors in formulas', 'Use-after-free and data races', 'Integer overflow', 'Infinite loops'], answer: 1, why: 'Ownership and borrowing rules make dangling references and unsynchronized shared mutation impossible in safe Rust.' },
      ],
    },
  ],
};
