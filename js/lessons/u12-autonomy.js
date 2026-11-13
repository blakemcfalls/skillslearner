import { num, rng, clamp } from '../sim.js';
const { sin, cos, tanh, acos, atan2, PI, sqrt, exp, log, abs, max, min, hypot, floor, round } = Math;
const TAU = 2 * PI, sigm = z => 1 / (1 + exp(-z));

// --- logistic regression on two overlapping blobs ---
const LR = (() => { const r = rng(12); return Array.from({ length: 100 }, (_, i) => { const c = i % 2; return [(c ? 0.8 : -0.8) + 0.9 * r.n(), (c ? 0.6 : -0.5) + 0.9 * r.n(), c]; }); })();
function lrStep(s, lr) { let g0 = 0, g1 = 0, gb = 0, L = 0, ok = 0; LR.forEach(([x, y, c]) => { const pr = sigm(s.w0 * x + s.w1 * y + s.b), d = pr - c; g0 += d * x; g1 += d * y; gb += d; L -= c ? log(pr + 1e-12) : log(1 - pr + 1e-12); if ((pr > 0.5) === !!c) ok++; }); s.w0 -= lr * g0 / 100; s.w1 -= lr * g1 / 100; s.b -= lr * gb / 100; s.loss = L / 100; s.acc = ok / 100; }
export function lrRun(lr, n = 200) { const s = { w0: 0, w1: 0, b: 0 }; for (let i = 0; i <= n; i++) lrStep(s, lr); return s; }

// --- a tiny neural network: 2 inputs, H tanh units, 1 sigmoid output ---
const RING = (() => { const r = rng(40), d = []; for (let i = 0; i < 60; i++) { const a = r() * TAU, q = 0.85 * sqrt(r()); d.push([q * cos(a), q * sin(a), 1]); } for (let i = 0; i < 80; i++) { const a = r() * TAU, q = 1.5 + 0.8 * r(); d.push([q * cos(a), q * sin(a), 0]); } return d; })();
export function netInit(H) { const r = rng(H * 7 + 3), z = () => 0.9 * r.n(); return { H, W1: Array.from({ length: H }, () => [z(), z()]), b1: Array.from({ length: H }, z), W2: Array.from({ length: H }, z), b2: 0, m: null, ep: 0, acc: 0, loss: 1 }; }
const netOut = (n, x, y) => { let z = n.b2; for (let j = 0; j < n.H; j++) z += n.W2[j] * tanh(n.W1[j][0] * x + n.W1[j][1] * y + n.b1[j]); return sigm(z); };
export function netTrain(n, steps) {
  const H = n.H, lr = 0.25, mom = 0.9; n.m = n.m || { W1: n.W1.map(() => [0, 0]), b1: new Array(H).fill(0), W2: new Array(H).fill(0), b2: 0 };
  for (let st = 0; st < steps; st++) {
    const g = { W1: n.W1.map(() => [0, 0]), b1: new Array(H).fill(0), W2: new Array(H).fill(0), b2: 0 }; let L = 0, ok = 0;
    for (const [x, y, c] of RING) { const h = n.W1.map((w, j) => tanh(w[0] * x + w[1] * y + n.b1[j])); let z = n.b2; for (let j = 0; j < H; j++) z += n.W2[j] * h[j]; const o = sigm(z), d = o - c; L -= c ? log(o + 1e-12) : log(1 - o + 1e-12); if ((o > 0.5) === !!c) ok++; g.b2 += d; for (let j = 0; j < H; j++) { g.W2[j] += d * h[j]; const dz = d * n.W2[j] * (1 - h[j] * h[j]); g.W1[j][0] += dz * x; g.W1[j][1] += dz * y; g.b1[j] += dz; } }
    const N = RING.length, up = (m, gr) => mom * m - lr * gr / N;
    n.m.b2 = up(n.m.b2, g.b2); n.b2 += n.m.b2;
    for (let j = 0; j < H; j++) { n.m.W2[j] = up(n.m.W2[j], g.W2[j]); n.W2[j] += n.m.W2[j]; n.m.b1[j] = up(n.m.b1[j], g.b1[j]); n.b1[j] += n.m.b1[j]; for (let k = 0; k < 2; k++) { n.m.W1[j][k] = up(n.m.W1[j][k], g.W1[j][k]); n.W1[j][k] += n.m.W1[j][k]; } }
    n.loss = L / N; n.acc = ok / N; n.ep++;
  }
}

// --- polynomial fitting in a Chebyshev basis with ridge regularization ---
const truth = x => sin(2.5 * x) + 0.3 * x;
const PF = (() => { const r = rng(77), tr = Array.from({ length: 14 }, (_, i) => { const x = -0.95 + 1.9 * i / 13; return [x, truth(x) + 0.2 * r.n()]; }), te = Array.from({ length: 60 }, () => { const x = -0.95 + 1.9 * r(); return [x, truth(x) + 0.2 * r.n()]; }); return { tr, te }; })();
const cheb = (k, x) => cos(k * acos(clamp(x, -1, 1)));
const pmem = new Map();
export function polyfit(deg, ll) {
  const key = deg + ',' + ll; if (pmem.has(key)) return pmem.get(key);
  const n = deg + 1, lam = 10 ** ll, A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  PF.tr.forEach(([x, y]) => { const ph = Array.from({ length: n }, (_, k) => cheb(k, x)); for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += ph[i] * ph[j]; A[i][n] += ph[i] * y; } });
  for (let i = 0; i < n; i++) A[i][i] += lam * (i ? 1 : 0) + 1e-10;
  for (let c = 0; c < n; c++) { let pv = c; for (let r = c + 1; r < n; r++) if (abs(A[r][c]) > abs(A[pv][c])) pv = r; [A[c], A[pv]] = [A[pv], A[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
  const w = A.map((row, i) => row[n] / row[i]), f = x => w.reduce((s, c, k) => s + c * cheb(k, x), 0), rmse = d => sqrt(d.reduce((s, [x, y]) => s + (f(x) - y) ** 2, 0) / d.length);
  const res = { f, tr: rmse(PF.tr), te: rmse(PF.te) }; pmem.set(key, res); return res;
}
export const bestTest = () => { let b = 9; for (let d = 1; d <= 13; d++) b = min(b, polyfit(d, -9).te); return b; };

// --- image filtering ---
const IW = 40, IH = 30;
const IMG = (() => { const r = rng(5), clean = [], noisy = []; for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) { let v = 0.2; if (x >= 7 && x < 19 && y >= 6 && y < 19) v = 0.85; if (hypot(x - 29, y - 17) < 7.2) v = 0.6; clean.push(v); noisy.push(v + 0.11 * r.n()); } return { clean, noisy }; })();
const conv = (im, k) => im.map((_, i) => { const x = i % IW, y = floor(i / IW); let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = clamp(x + dx, 0, IW - 1), yy = clamp(y + dy, 0, IH - 1); s += k[(dy + 1) * 3 + dx + 1] * im[yy * IW + xx]; } return s; });
const K = { blur: [1, 2, 1, 2, 4, 2, 1, 2, 1].map(v => v / 16), sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0], sx: [-1, 0, 1, -2, 0, 2, -1, 0, 1].map(v => v / 4), sy: [-1, -2, -1, 0, 0, 0, 1, 2, 1].map(v => v / 4) };
const vmem = new Map();
export function vision(p) {
  const key = [p.f, p.pre, p.th].join(); if (vmem.has(key)) return vmem.get(key);
  const pipe = im => { let a = im; if (p.pre) a = conv(conv(a, K.blur), K.blur); if (p.f === 'none') return a; if (p.f === 'blur') return conv(a, K.blur); if (p.f === 'sharpen') return conv(a, K.sharpen); const gx = conv(a, K.sx), gy = conv(a, K.sy); return p.f === 'sx' ? gx : p.f === 'sy' ? gy : gx.map((v, i) => hypot(v, gy[i])); };
  const out = pipe(IMG.noisy), ref = pipe(IMG.clean), res = { out, tp: 0, fp: 0, cls: null };
  if (p.f === 'mag') { const mx = max(...ref), edge = ref.map(v => v > 0.3 * mx), det = out.map(v => v > p.th); let ne = 0, hit = 0, fa = 0; res.cls = det.map((d, i) => { if (edge[i]) { ne++; if (d) { hit++; return 1; } return 3; } if (d) { fa++; return 2; } return 0; }); res.tp = hit / ne; res.fp = fa / (IW * IH - ne); }
  if (vmem.size > 300) vmem.clear(); vmem.set(key, res); return res;
}

// --- cliff gridworld value iteration ---
const GW = 7, GH = 4, cliff = (x, y) => y === 0 && x >= 1 && x <= 5, isGoal = (x, y) => x === 6 && y === 0;
const MOVES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const gmem = new Map();
export function valueIter(gam, slip, k) {
  const key = [gam, slip, k].join(); if (gmem.has(key)) return gmem.get(key);
  let V = Array.from({ length: GH }, () => new Array(GW).fill(0)); const pol = Array.from({ length: GH }, () => new Array(GW).fill(0));
  const q = (V, x, y, a) => { let s = 0; [[a, 1 - slip], [(a + 1) % 4, slip / 2], [(a + 3) % 4, slip / 2]].forEach(([m, pr]) => { if (!pr) return; const nx = clamp(x + MOVES[m][0], 0, GW - 1), ny = clamp(y + MOVES[m][1], 0, GH - 1); s += pr * (cliff(nx, ny) ? -10 : isGoal(nx, ny) ? 10 : -0.2 + gam * V[ny][nx]); }); return s; };
  for (let it = 0; it < k; it++) { const N = V.map(r => r.slice()); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (cliff(x, y) || isGoal(x, y)) continue; let b = -1e9; for (let a = 0; a < 4; a++) { const v = q(V, x, y, a); if (v > b) { b = v; pol[y][x] = a; } } N[y][x] = b; } V = N; }
  let x = 0, y = 0, row3 = -1; const path = [[0, 0]];
  for (let i = 0; i < 24 && !isGoal(x, y) && !cliff(x, y); i++) { const m = MOVES[pol[y][x]]; x = clamp(x + m[0], 0, GW - 1); y = clamp(y + m[1], 0, GH - 1); path.push([x, y]); if (x === 3 && row3 < 0) row3 = y; }
  const res = { V, pol, path, row3, reached: isGoal(x, y) }; if (gmem.size > 400) gmem.clear(); gmem.set(key, res); return res;
}

// --- epsilon-greedy bandit ---
const ARMS = [0.2, 0.5, 0.9, 0.4, 0.65];
const bmem = new Map();
export function bandit(eps) {
  const key = round(eps * 100); if (bmem.has(key)) return bmem.get(key);
  const r = rng(99), T = 400, runs = 150, avg = new Array(T).fill(0);
  for (let run = 0; run < runs; run++) { const q = [0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0]; for (let t = 0; t < T; t++) { let a; if (r() < eps) a = floor(r() * 5); else { a = 0; for (let i = 1; i < 5; i++) if (q[i] > q[a]) a = i; } const rew = ARMS[a] + 0.7 * r.n(); n[a]++; q[a] += (rew - q[a]) / n[a]; avg[t] += ARMS[a] / runs; } }
  const res = { avg, mean: avg.reduce((a, b) => a + b) / T }; bmem.set(key, res); return res;
}
let bbest = null;
export const banditBest = () => { if (bbest == null) { bbest = 0; for (let e = 0; e <= 50; e += 2) bbest = max(bbest, bandit(e / 100).mean); } return bbest; };

// --- consensus over a proximity graph ---
const AG = (() => { const r = rng(23); return Array.from({ length: 12 }, () => [0.6 + r() * 8.8, 0.5 + r() * 5, r()]); })();
export function comps(range) { const seen = new Array(12).fill(-1); let c = 0; for (let i = 0; i < 12; i++) { if (seen[i] >= 0) continue; const st = [i]; seen[i] = c; while (st.length) { const a = st.pop(); for (let b = 0; b < 12; b++) if (seen[b] < 0 && hypot(AG[a][0] - AG[b][0], AG[a][1] - AG[b][1]) < range) { seen[b] = c; st.push(b); } } c++; } return c; }
export const RMIN = (() => { for (let r = 0.5; r <= 8; r = round((r + 0.05) * 100) / 100) if (comps(r) === 1) return r; return 8; })();

export default {
  id: 'u12', title: 'Autonomy', blurb: 'Learning, vision, decisions and swarms.',
  lessons: [
    {
      id: 'ml-regression', skill: 'ml', title: 'Machine learning: a model, a loss and a descent', pre: ['opt-gradient-descent', 'prob-bayes', 'linalg-least-squares'],
      hook: 'Training a classifier is the optimization you already know, pointed at data instead of a formula.',
      body: [
        'Supervised learning needs three things: a **model** with adjustable parameters, a **loss** that scores how wrong its predictions are on labeled examples, and an **optimizer** that adjusts the parameters to lower the loss.',
        'For a two-class problem the simplest model is **logistic regression**. It draws a line (in higher dimensions, a plane) through feature space and reports how confident it is on each side:',
        { eq: 'p = σ(w·x + b),   σ(z) = 1/(1 + e^{−z})' },
        'The loss is **cross-entropy**, which punishes confident wrong answers heavily. Its gradient is remarkably simple: the average of (prediction − label) × input. Gradient descent then nudges $w$ and $b$ each **epoch** (one pass over the data).',
        'The learning rate matters exactly as it did before. Too small and the model has barely moved after hundreds of epochs; too large and it lurches. In the lab the two classes overlap, so no line is perfect. The floor on the loss is set by the data, not the optimizer.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'll', label: 'Learning rate', min: -2, max: 1, step: 0.05, v: -1.7, fmt: v => num(10 ** v, 2), re: true }],
        init: () => ({ w0: 0, w1: 0, b: 0, ep: 0, loss: 0.693, acc: 0.5, hist: [] }),
        step(s, p) { if (s.ep >= 200) return; lrStep(s, 10 ** p.ll); s.ep++; s.hist.push([s.ep, s.loss]); },
        draw(g, s, p) {
          const split = g.w * 0.55;
          g.view(-3.5, 3.5, -3, 3, { pad: [8, 8, g.w - split, 8] });
          g.heat((x, y) => (sigm(s.w0 * x + s.w1 * y + s.b) - 0.5) * 1.2, 36, 30, g.div);
          LR.forEach(([x, y, c]) => g.dot(x, y, c ? g.c.a : g.c.b, 3.2, { ring: g.c.panel }));
          g.view(0, 200, 0.3, 0.75, { pad: [split + 50, 12, 14, 30] }).axes({ xl: 'epoch', yl: 'cross-entropy loss' });
          g.line(0, LMIN, 200, LMIN, g.c.good, { w: 1, dash: [5, 4] }).text('best possible', 195, LMIN + 0.02, g.c.good, { a: 'right', s: 10.5 });
          g.clip(() => g.path(s.hist, g.c.ink, { w: 2.2 }));
        },
        read: s => [['epoch', s.ep + ' / 200'], ['loss', num(s.loss, 3)], ['accuracy', num(s.acc * 100, 3) + ' %']],
        mission: 'Choose a learning rate that brings the loss within 2% of the best possible by epoch 200.',
        goal: s => s.ep >= 200 && s.loss < LMIN * 1.02,
        win: { ll: 0.3 },
      },
      cards: [
        { q: 'Name the three ingredients of supervised learning.', a: 'A model with adjustable parameters, a loss function measuring error on labeled data, and an optimizer (usually gradient descent) that adjusts the parameters to reduce the loss.' },
        { q: 'Write the logistic regression model.', a: '$p = σ(w·x + b)$ with $σ(z) = 1/(1+e^{−z})$: a linear score squashed into a probability.' },
        { q: 'Why can’t training loss reach zero when classes overlap?', a: 'No boundary separates the examples perfectly; some are on the wrong side of any line. The irreducible error comes from the data, not from the optimizer.' },
      ],
      quiz: [
        { q: 'A logistic model has $w·x + b = 0$ for some input. What probability does it output?', num: 0.5, tol: 0.001, why: '$σ(0) = 1/(1 + 1) = 0.5$. The decision boundary is where the score is zero.' },
        { q: 'One "epoch" of training means:', choices: ['One parameter update', 'One pass through the entire training set', 'One layer of the network', 'One test evaluation'], answer: 1, why: 'An epoch is a full sweep over the training data.' },
      ],
      code: {
        prompt: 'Complete `gd_step(w, b, X, y, lr)` for logistic regression. `X` has shape (n, 2), `y` holds 0/1 labels. Compute predictions `p = sigmoid(X @ w + b)`, then update with the gradients `X.T @ (p - y) / n` and `mean(p - y)`. Return the new `(w, b)`.',
        starter: 'import numpy as np\n\ndef sigmoid(z):\n    return 1 / (1 + np.exp(-z))\n\ndef gd_step(w, b, X, y, lr):\n    n = len(y)\n    p = sigmoid(X @ w + b)\n    # compute gradients and return updated (w, b)\n    return w, b\n\nX = np.array([[1.0, 2.0], [-1.0, -1.5], [2.0, 0.5], [-2.0, -0.5]])\ny = np.array([1.0, 0.0, 1.0, 0.0])\nw, b = np.zeros(2), 0.0\nfor _ in range(200):\n    w, b = gd_step(w, b, X, y, 0.5)\nprint(w, b, sigmoid(X @ w + b).round(3))',
        solution: 'import numpy as np\n\ndef sigmoid(z):\n    return 1 / (1 + np.exp(-z))\n\ndef gd_step(w, b, X, y, lr):\n    n = len(y)\n    p = sigmoid(X @ w + b)\n    gw = X.T @ (p - y) / n\n    gb = np.mean(p - y)\n    return w - lr * gw, b - lr * gb\n\nX = np.array([[1.0, 2.0], [-1.0, -1.5], [2.0, 0.5], [-2.0, -0.5]])\ny = np.array([1.0, 0.0, 1.0, 0.0])\nw, b = np.zeros(2), 0.0\nfor _ in range(200):\n    w, b = gd_step(w, b, X, y, 0.5)\nprint(w, b, sigmoid(X @ w + b).round(3))',
        tests: 'import numpy as np\n_X = np.array([[1.0, 2.0], [-1.0, -1.5], [2.0, 0.5], [-2.0, -0.5]])\n_y = np.array([1.0, 0.0, 1.0, 0.0])\n_w, _b = gd_step(np.zeros(2), 0.0, _X, _y, 1.0)\nassert np.allclose(_w, [0.75, 0.5625]) and abs(_b) < 1e-12, f"first step from zero gave w={_w}, b={_b}; expected [0.75, 0.5625], 0"\n_w, _b = np.zeros(2), 0.0\nfor _ in range(300):\n    _w, _b = gd_step(_w, _b, _X, _y, 0.5)\nassert np.all((sigmoid(_X @ _w + _b) > 0.5) == (_y > 0.5)), "after training, all four points should be classified correctly"',
        hint: '`gw = X.T @ (p - y) / n`, `gb = np.mean(p - y)`, then `return w - lr * gw, b - lr * gb`.',
      },
    },
    {
      id: 'ml-neural-net', skill: 'ml', title: 'Neural networks: bending the boundary', pre: ['ml-regression', 'linalg-matrices', 'calc-gradient'],
      hook: 'One neuron draws one straight line. A few of them, combined through a second layer, can draw almost anything.',
      body: [
        'Logistic regression can only split the plane with a straight line. A **neural network** stacks layers: each hidden unit computes its own line, passes the result through a nonlinear **activation** (such as tanh or ReLU), and the next layer combines those outputs.',
        { eq: 'h = tanh(W_1·x + b_1),   p = σ(W_2·h + b_2)' },
        'The nonlinearity is essential. Without it, stacked layers collapse into one linear map. With it, each hidden unit contributes one bend, and enough bends approximate any boundary.',
        'Training is still gradient descent. The gradient with respect to every weight is found by **backpropagation**: the chain rule applied layer by layer from the output back to the input.',
        'The lab trains a small network live to separate an inner cluster from a surrounding ring, a problem no single line can solve. Watch how many hidden units it takes before the boundary can close into a loop.',
      ],
      sim: {
        h: 330,
        controls: [{ k: 'h', label: 'Hidden units', min: 1, max: 8, step: 1, v: 2, re: true }],
        init: p => ({ net: netInit(p.h) }),
        step(s) { if (s.net.ep < 6000) netTrain(s.net, 20); },
        draw(g, s, p) {
          g.view(-2.8, 2.8, -2.5, 2.5, { eq: true, pad: [8, 8, 8, 8] });
          g.heat((x, y) => (netOut(s.net, x, y) - 0.5) * 1.6, 44, 36, g.div);
          RING.forEach(([x, y, c]) => g.dot(x, y, c ? g.c.a : g.c.b, 3, { ring: g.c.panel }));
          g.note(`${p.h} hidden unit${p.h > 1 ? 's' : ''}`, 'tl', g.c.ink);
        },
        read: s => [['training steps', s.net.ep], ['loss', num(s.net.loss, 3)], ['accuracy', num(s.net.acc * 100, 3) + ' %']],
        mission: 'Give the network enough hidden units to classify the ring data with at least 97% accuracy.',
        goal: s => s.net.acc >= 0.97,
        win: { h: 6 }, winTime: 20,
      },
      cards: [
        { q: 'Why does a neural network need nonlinear activation functions?', a: 'Without them, any stack of layers reduces to a single linear transformation, which can only produce straight decision boundaries.' },
        { q: 'What is backpropagation?', a: 'The chain rule applied layer by layer, from the output back toward the input, to compute the gradient of the loss with respect to every weight.' },
      ],
      quiz: [
        { q: 'What is the smallest number of hidden units (each one a straight line) that can enclose a region of the plane?', num: 3, tol: 0.01, why: 'Three lines form a triangle. One or two lines can only make open regions.' },
        { q: 'A network with two hidden layers but no activation functions is equivalent to:', choices: ['A deeper network', 'A single linear layer', 'A decision tree', 'Nothing useful at all'], answer: 1, why: 'A product of matrices is a matrix. Depth adds power only with nonlinearity between layers.' },
      ],
    },
    {
      id: 'ml-generalization', skill: 'ml', title: 'Generalization: the test that counts', pre: ['ml-neural-net', 'prob-estimation', 'calc-taylor'],
      hook: 'A model that memorizes its training data scores perfectly in the lab and fails in the field. Measuring that gap is the central discipline of machine learning.',
      body: [
        'The goal is low error on data the model has **never seen**. So data is split: a **training set** to fit parameters and a held-out **test set** to estimate real performance. The test set is touched once, at the end.',
        'Model capacity cuts both ways.',
        { list: ['Too simple: the model cannot capture the pattern. Training and test errors are both high. **Underfitting** (high bias).', 'Too flexible: the model fits the noise in its particular training sample. Training error keeps falling while test error rises. **Overfitting** (high variance).'] },
        'The best model sits between. **Regularization** helps by penalizing large weights, which smooths the fit without removing capacity. More data helps more than anything.',
        'For fielded systems there is a harder problem: **distribution shift**. A classifier trained on clear-weather imagery meets fog; a model tuned on one sensor meets another. Test accuracy says nothing about inputs unlike the training set, and deliberately crafted **adversarial** inputs can flip a confident answer with changes a person would not notice.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'deg', label: 'Polynomial degree (model capacity)', min: 1, max: 13, step: 1, v: 1 },
          { k: 'll', label: 'Regularization strength', min: -9, max: 0, step: 0.5, v: -9, fmt: v => (v <= -9 ? 'off' : num(10 ** v, 2)) },
        ],
        draw(g, s, p) {
          const r = polyfit(p.deg, p.ll), split = g.w * 0.6;
          g.view(-1, 1, -2, 2, { pad: [40, 10, g.w - split, 30] }).axes({ xl: 'x', yl: 'y' });
          g.fn(truth, g.c.dim, { w: 1.5, dash: [5, 4] });
          g.fn(x => clamp(r.f(x), -5, 5), g.c.a, { w: 2.5, n: 400, from: -0.99, to: 0.99 });
          PF.te.forEach(([x, y]) => g.dot(x, y, g.c.c, 2, { alpha: 0.6 })); PF.tr.forEach(([x, y]) => g.dot(x, y, g.c.b, 4.5, { ring: g.c.panel }));
          g.view(0.5, 13.5, 0, 1, { pad: [split + 46, 10, 14, 30] }).axes({ xl: 'degree', yl: 'RMS error', xs: 3 });
          g.clip(() => { g.path(Array.from({ length: 13 }, (_, i) => [i + 1, polyfit(i + 1, p.ll).tr]), g.c.b, { w: 2 }); g.path(Array.from({ length: 13 }, (_, i) => [i + 1, min(1.5, polyfit(i + 1, p.ll).te)]), g.c.c, { w: 2 }); });
          g.dot(p.deg, min(1, r.te), g.c.ink, 5);
          g.note('train', 'tr', g.c.b).note('test', 'tr', g.c.c, 1);
        },
        read: (s, p) => { const r = polyfit(p.deg, p.ll); return [['training error', num(r.tr, 3)], ['test error', num(r.te, 3)], ['noise level in the data', '0.2']]; },
        mission: 'Find the model with the lowest test error (within 3% of the best, regularization off).',
        goal: (s, p) => p.ll <= -9 && polyfit(p.deg, -9).te <= 1.03 * bestTest(),
        win: { deg: 5, ll: -9 },
      },
      cards: [
        { q: 'Distinguish underfitting from overfitting using training and test error.', a: 'Underfitting: both errors high (model too simple). Overfitting: training error low but test error high (model fits noise in the training sample).' },
        { q: 'Why keep a held-out test set, and how should it be used?', a: 'To estimate performance on unseen data. It must not influence training or model selection; touch it once, at the end.' },
        { q: 'What is distribution shift?', a: 'Operating conditions that differ from the training data (new sensor, weather, environment or adversary). Performance measured on test data from the old distribution no longer applies.' },
      ],
      quiz: [
        { q: 'A model has 99% training accuracy and 71% test accuracy. It is:', choices: ['Underfitting', 'Overfitting', 'Perfectly tuned', 'Regularized too strongly'], answer: 1, why: 'A large gap between training and test performance is the signature of overfitting.' },
        { q: 'Which change most reliably reduces overfitting?', choices: ['More model parameters', 'More training data', 'Training for more epochs', 'Removing the test set'], answer: 1, why: 'With more data the model has less freedom to fit noise. Regularization and simpler models also help.' },
      ],
    },
    {
      id: 'cv-convolution', skill: 'cv', title: 'Computer vision: filters and features', pre: ['dsp-convolution', 'calc-gradient', 'detect-threshold'],
      hook: 'Before any network can recognize a vehicle, something has to find its edges. That something is a 3×3 grid of numbers slid across the image.',
      body: [
        'An image is a grid of numbers, and the basic operation on it is the 2-D **convolution** you met in signal processing: slide a small **kernel** over the image and take a weighted sum at each position.',
        { list: ['A **blur** kernel (all positive, summing to 1) averages neighbors and suppresses noise.', 'A **Sobel** kernel subtracts one side from the other: a finite-difference derivative. It responds where brightness changes: **edges**. One kernel for $∂/∂x$, one for $∂/∂y$; together they give the image gradient.', 'A **sharpen** kernel adds back the difference between a pixel and its neighbors.'] },
        'Differentiation amplifies noise, a lesson from numerical methods, so edge detectors blur first and then differentiate. The gradient magnitude is thresholded to get an edge map, and the threshold is a detection problem with its own false alarms and misses.',
        'A **convolutional neural network** uses the same operation, with one difference: the kernel values are learned. Its first layer reliably learns edge and color detectors much like these; deeper layers combine them into corners, textures, parts and objects.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'f', type: 'select', label: 'Filter', v: 'none', options: [['none', 'None (input)'], ['blur', 'Blur'], ['sharpen', 'Sharpen'], ['sx', 'Sobel ∂/∂x'], ['sy', 'Sobel ∂/∂y'], ['mag', 'Gradient magnitude']] },
          { k: 'pre', type: 'toggle', label: 'Blur before filtering', v: false },
          { k: 'th', label: 'Edge threshold', min: 0.02, max: 0.5, step: 0.01, v: 0.2 },
        ],
        draw(g, s, p) {
          const r = vision(p), half = (g.w - 24) / 2, signed = p.f === 'sx' || p.f === 'sy';
          g.view(0, IW, 0, IH, { eq: true, pad: [8, 22, g.w - half - 8, 8] });
          g.text('filter output', 0, IH, g.c.dim, { s: 11, mono: false, b: 'bottom', dy: -4 });
          r.out.forEach((v, i) => g.rect(i % IW, IH - 1 - floor(i / IW), 1.03, 1.03, signed ? g.div(clamp(v * 2.5, -1, 1)) : g.ramp(clamp(p.f === 'mag' ? v * 2 : v, 0, 1))));
          g.view(0, IW, 0, IH, { eq: true, pad: [half + 16, 22, 8, 8] });
          g.text(r.cls ? 'edge map: green hit, red false alarm, blue miss' : 'select "Gradient magnitude" for an edge map', 0, IH, g.c.dim, { s: 11, mono: false, b: 'bottom', dy: -4 });
          if (r.cls) r.cls.forEach((c, i) => g.rect(i % IW, IH - 1 - floor(i / IW), 1.03, 1.03, [g.c.panel, g.c.good, g.c.bad, g.c.b][c], { fa: c ? 0.9 : 1 }));
          else IMG.noisy.forEach((v, i) => g.rect(i % IW, IH - 1 - floor(i / IW), 1.03, 1.03, g.ramp(clamp(v, 0, 1))));
        },
        read: (s, p) => { const r = vision(p); return r.cls ? [['edge pixels found', num(r.tp * 100, 3) + ' %'], ['false alarms', num(r.fp * 100, 3) + ' % of non-edge pixels']] : [['view', 'filtered image']]; },
        mission: 'Produce an edge map that finds at least 90% of edge pixels with under 2% false alarms.',
        goal: (s, p) => { const r = vision(p); return p.f === 'mag' && r.tp >= 0.9 && r.fp < 0.02; },
        win: { f: 'mag', pre: true, th: 0.14 },
      },
      cards: [
        { q: 'What does a Sobel kernel compute, and what image feature does it reveal?', a: 'A finite-difference derivative of brightness in one direction. It responds strongly at edges; the x and y kernels together give the image gradient.' },
        { q: 'Why blur an image before detecting edges?', a: 'Differentiation amplifies pixel noise. Smoothing first suppresses the noise so the gradient responds to real edges.' },
        { q: 'How does a convolutional neural network relate to hand-designed filters?', a: 'It applies the same sliding-kernel operation but learns the kernel values from data. Early layers typically learn edge-like detectors; deeper layers combine them into complex features.' },
      ],
      quiz: [
        { q: 'A 3×3 kernel has all nine entries equal to 1/9. Applied to an image it:', choices: ['Detects vertical edges', 'Blurs: each pixel becomes the average of its neighborhood', 'Sharpens', 'Inverts the image'], answer: 1, why: 'Equal positive weights summing to 1 compute a local mean.' },
        { q: 'A horizontal Sobel kernel is applied to a region of perfectly uniform brightness. The output is:', num: 0, tol: 0.001, why: 'Its weights sum to zero, so a constant input gives zero: no change, no edge.' },
      ],
    },
    {
      id: 'cv-camera-geometry', skill: 'cv', title: 'Camera geometry and depth from two views', pre: ['cv-convolution', 'eoir-optics', 'linalg-vectors'],
      hook: 'A single image has no depth. Two images from slightly different places do, by the same triangle that surveyors use.',
      body: [
        'The **pinhole camera model** projects a 3-D point $(X, Y, Z)$ onto the image by similar triangles:',
        { eq: 'u = f·X/Z,   v = f·Y/Z', where: '$f$ = focal length in pixels' },
        'Dividing by $Z$ is what makes distant things small, and what destroys depth: every point along a ray lands on the same pixel.',
        'A second camera a **baseline** $b$ to the side sees the point shifted. That shift, the **disparity** $d$, encodes depth:',
        { eq: 'Z = f·b/d,   δZ ≈ Z^2·δd/(f·b)' },
        'The second formula is the one to remember. Depth error grows with the **square** of range, because disparity shrinks toward zero and a fixed matching error of a fraction of a pixel becomes a huge depth error. Long range needs a long baseline or a long focal length.',
        'The same geometry underlies visual navigation: track features across frames from a moving camera and solve for both the scene and the camera’s own motion.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'b', label: 'Baseline', min: 0.05, max: 2, step: 0.05, v: 0.2, unit: 'm' },
          { k: 'f', label: 'Focal length', min: 500, max: 4000, step: 100, v: 1000, unit: 'px' },
          { k: 'Z', label: 'Target depth', min: 2, max: 100, step: 1, v: 50, unit: 'm' },
        ],
        draw(g, s, p) {
          const d = p.f * p.b / p.Z, dz = p.Z * p.Z * 0.5 / (p.f * p.b);
          g.view(-3, 3, -4, 108, { pad: [10, 10, 150, 26] }).axes({ yl: 'depth (m)', xt: false, grid: false });
          g.rect(-3, max(0, p.Z - dz), 6, min(108, p.Z + dz) - max(0, p.Z - dz), g.c.a, { fa: 0.18 });
          [-1, 1].forEach(sd => { const cx = sd * p.b / 2 * 1.2; g.line(cx, 0, 0, p.Z, sd < 0 ? g.c.b : g.c.c, { w: 1.5 }); g.rect(cx - 0.12, -3, 0.24, 3, sd < 0 ? g.c.b : g.c.c); });
          g.dot(0, p.Z, g.c.ink, 5);
          g.text('uncertainty band', 2.9, clamp(p.Z + dz + 4, 6, 104), g.c.a, { a: 'right', s: 10.5 });
          g.view(-60, 60, 0, 3, { pad: [g.w - 136, 30, 10, 30] });
          g.text('image position (px)', -60, 3.3, g.c.dim, { s: 10.5, mono: false });
          [[2, g.c.b, 'left', d / 2], [0.7, g.c.c, 'right', -d / 2]].forEach(([y, col, n, u]) => { g.rect(-60, y, 120, 0.7, g.c.dim, { fa: 0.15 }); g.line(clamp(u, -60, 60), y, clamp(u, -60, 60), y + 0.7, col, { w: 3 }); g.text(n, -60, y + 0.95, col, { s: 10.5 }); });
        },
        read: (s, p) => [['disparity', num(p.f * p.b / p.Z, 3) + ' px'], ['depth error for ±0.5 px', '±' + num(p.Z * p.Z * 0.5 / (p.f * p.b), 3) + ' m'], ['relative error', num(p.Z * 0.5 / (p.f * p.b) * 100, 3) + ' %']],
        mission: 'Measure a target at 50 m or beyond to within ±1 m.',
        goal: (s, p) => p.Z >= 50 && p.Z * p.Z * 0.5 / (p.f * p.b) <= 1,
        win: { b: 0.85, f: 1500, Z: 50 },
      },
      cards: [
        { q: 'Write the pinhole projection equations.', a: '$u = fX/Z$, $v = fY/Z$: image position is focal length times lateral position divided by depth.' },
        { q: 'Give the stereo depth formula and how depth error scales.', a: '$Z = fb/d$ (focal length × baseline ÷ disparity). Error $δZ ≈ Z^2δd/(fb)$: it grows with the square of range.' },
      ],
      quiz: [
        { q: 'A stereo rig has $f$ = 1,200 px and $b$ = 0.5 m. A feature shows a disparity of 15 px. How far away is it, in meters?', num: 40, unit: 'm', tol: 0.4, why: '$Z = 1200 × 0.5/15 = 40$ m.' },
        { q: 'A stereo system’s depth error at 20 m is 0.2 m. At 60 m it is about:', num: 1.8, unit: 'm', tol: 0.05, why: 'Error ∝ $Z^2$: $3^2 × 0.2 = 1.8$ m.' },
      ],
    },
    {
      id: 'rl-value-iteration', skill: 'rl', title: 'Decisions under uncertainty: value and policy', pre: ['prob-bayes', 'opt-nonconvex', 'trajopt-bang-bang'],
      hook: 'The shortest path runs along a cliff edge. Whether to take it depends on how much you trust your own steering.',
      body: [
        'A **Markov decision process** describes sequential decisions: **states**, **actions**, a transition rule that may be random, and a **reward** for each step. A **policy** says which action to take in each state. The aim is the policy that collects the most reward over time, with future reward discounted by a factor $γ$ per step.',
        'The key object is the **value** of a state: the total discounted reward expected from there under the best policy. Values obey the **Bellman equation**:',
        { eq: 'V(s) = max_a Σ_{s′} P(s′|s,a)·[r + γ·V(s′)]' },
        'It says a state is worth the best you can do in one step plus the discounted worth of where you land. **Value iteration** applies this as an update, sweep after sweep, until the numbers stop changing. The optimal policy is then to act greedily on the values.',
        'In the lab, an agent must get from the bottom-left to the bottom-right. The bottom row between is a cliff. Each move may **slip** sideways. With perfect control the best route hugs the edge; add slip and the optimal route moves away, trading distance for safety. Nobody programs that behavior. It falls out of the equation.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'slip', label: 'Chance a move slips sideways', min: 0, max: 0.2, step: 0.02, v: 0 },
          { k: 'gam', label: 'Discount γ', min: 0.8, max: 0.99, step: 0.01, v: 0.95 },
          { k: 'k', label: 'Value-iteration sweeps', min: 0, max: 60, step: 1, v: 60 },
        ],
        draw(g, s, p) {
          const r = valueIter(p.gam, p.slip, p.k);
          g.view(0, GW, 0, GH, { eq: true, pad: [8, 8, 8, 8] });
          for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
            const cl = cliff(x, y), go = isGoal(x, y);
            g.rect(x + 0.03, y + 0.03, 0.94, 0.94, cl ? g.c.bad : go ? g.c.good : g.div(clamp(r.V[y][x] / 10, -1, 1)), { fa: cl || go ? 0.85 : 1, stroke: g.c.grid });
            if (cl) g.text('cliff', x + 0.5, y + 0.5, '#fff', { a: 'center', s: 10 });
            else if (go) g.text('goal', x + 0.5, y + 0.5, '#fff', { a: 'center', s: 11, bold: true });
            else { const m = MOVES[r.pol[y][x]]; if (p.k > 0) g.arrow(x + 0.5 - m[0] * 0.2, y + 0.3 - m[1] * 0.12, x + 0.5 + m[0] * 0.22, y + 0.3 + m[1] * 0.2, g.c.ink, { w: 1.5, head: 6 }); g.text(num(r.V[y][x], 2), x + 0.5, y + 0.74, g.c.ink, { a: 'center', s: 10 }); }
          }
          if (p.k > 0) g.path(r.path.map(([x, y]) => [x + 0.5, y + 0.5]), g.c.b, { w: 3, alpha: 0.7 });
          g.dot(0.5, 0.5, g.c.b, 6);
        },
        read: (s, p) => { const r = valueIter(p.gam, p.slip, p.k); return [['value at start', num(r.V[0][0], 3)], ['route clears the cliff by', r.row3 < 0 ? '–' : r.row3 + ' row' + (r.row3 === 1 ? '' : 's')], ['reaches goal', r.reached ? 'yes' : 'not yet']]; },
        mission: 'Find conditions under which the optimal route keeps at least two rows away from the cliff.',
        goal: (s, p) => { const r = valueIter(p.gam, p.slip, p.k); return p.k >= 30 && r.reached && r.row3 >= 2; },
        win: { slip: 0.2, gam: 0.95, k: 60 },
      },
      cards: [
        { q: 'What defines a Markov decision process?', a: 'States, actions, transition probabilities, rewards, and a discount factor. A policy maps states to actions.' },
        { q: 'Write the Bellman optimality equation.', a: '$V(s) = max_a Σ_{s′} P(s′|s,a)[r + γV(s′)]$: the value of a state is the best expected one-step reward plus discounted value of the next state.' },
        { q: 'What does value iteration do?', a: 'Repeatedly applies the Bellman equation as an update to every state until values converge; the optimal policy acts greedily with respect to them.' },
      ],
      quiz: [
        { q: 'With $γ$ = 0.9, a reward of 10 received three steps from now is worth how much today?', num: 7.29, tol: 0.05, why: '$10 × 0.9^3 = 7.29$.' },
        { q: 'Raising the slip probability in the cliff world makes the optimal path:', choices: ['Hug the cliff more closely', 'Move farther from the cliff', 'Stay the same', 'Go backward'], answer: 1, why: 'Each step beside the cliff now risks a large penalty, so the expected cost of the short route rises above the cost of a longer, safer one.' },
      ],
    },
    {
      id: 'rl-q-learning', skill: 'rl', title: 'Learning by trial: explore or exploit', pre: ['rl-value-iteration', 'mc-basics'],
      hook: 'Value iteration needs the rules of the world written down. Reinforcement learning has to discover them by acting, and every experiment costs something.',
      body: [
        'When the transition rule and rewards are unknown, an agent must learn from experience. **Q-learning** keeps an estimate $Q(s, a)$ of the long-run value of taking action $a$ in state $s$, and nudges it after every step toward what just happened:',
        { eq: 'Q(s,a) ← Q(s,a) + α·[r + γ·max_{a′}Q(s′,a′) − Q(s,a)]', where: '$α$ = step size; the bracket is the "temporal-difference error"' },
        'This raises a dilemma that planning never faced. To earn reward the agent should **exploit**: take the action it currently thinks is best. To find out whether another action is better it must **explore**, which means sometimes choosing worse. The simplest compromise is **ε-greedy**: with probability $ε$ act at random, otherwise act greedily.',
        'The lab is the purest version: a **bandit** with five actions of unknown average payoff and noisy rewards. With $ε = 0$ the agent often locks onto a mediocre action forever. With $ε$ too large it keeps wasting pulls after it knows the answer.',
        'Scaling this to real systems is hard. Trial and error in a simulator is cheap; on hardware it is slow and risky, and a policy trained in simulation must survive the gap to reality.',
      ],
      sim: {
        h: 300,
        controls: [{ k: 'eps', label: 'Exploration rate ε', min: 0, max: 0.5, step: 0.02, v: 0 }],
        draw(g, s, p) {
          const r = bandit(p.eps);
          g.view(0, 400, 0.2, 1).axes({ xl: 'pull number', yl: 'average payoff of chosen action' });
          g.line(0, 0.9, 400, 0.9, g.c.good, { w: 1.5, dash: [5, 4] }).text('best action 0.9', 395, 0.93, g.c.good, { a: 'right', s: 10.5 });
          ARMS.forEach(a => g.line(0, a, 400, a, g.c.grid, { w: 1 }));
          const sm = r.avg.map((_, i) => { let a = 0, c = 0; for (let k = max(0, i - 4); k <= min(399, i + 4); k++) { a += r.avg[k]; c++; } return [i, a / c]; });
          g.clip(() => g.path(sm, g.c.a, { w: 2.5 }));
          g.note('averaged over 150 runs', 'br', g.c.dim);
        },
        read: (s, p) => { const r = bandit(p.eps); return [['mean payoff per pull', num(r.mean, 4)], ['shortfall from always choosing the best', num((0.9 - r.mean) * 400, 3) + ' in total']]; },
        mission: 'Find an exploration rate that earns within 1.5% of the best achievable total payoff.',
        goal: (s, p) => bandit(p.eps).mean >= 0.985 * banditBest(),
        win: { eps: 0.1 },
      },
      cards: [
        { q: 'Write the Q-learning update.', a: '$Q(s,a) ← Q(s,a) + α[r + γ max_{a′}Q(s′,a′) − Q(s,a)]$.' },
        { q: 'What is the exploration–exploitation dilemma, and what is ε-greedy?', a: 'Exploiting the best-known action earns reward now; exploring others may find something better but costs reward. ε-greedy acts randomly with probability ε and greedily otherwise.' },
        { q: 'Why is reinforcement learning usually trained in simulation, and what is the risk?', a: 'It needs huge numbers of trials, which are slow, costly and unsafe on hardware. The risk is the sim-to-real gap: a policy that exploits simulator quirks fails on the real system.' },
      ],
      quiz: [
        { q: '$Q(s,a)$ = 4, the reward is 2, the best next value is 5, $γ$ = 0.9 and $α$ = 0.5. What is the updated $Q(s,a)$?', num: 5.25, tol: 0.02, why: 'Target $= 2 + 0.9 × 5 = 6.5$. Update: $4 + 0.5 × (6.5 − 4) = 5.25$.' },
        { q: 'A purely greedy agent (ε = 0) on a noisy bandit often:', choices: ['Finds the best action fastest', 'Locks onto whichever action looked good first and never checks the others', 'Explores forever', 'Chooses uniformly at random'], answer: 1, why: 'With no exploration, an early lucky or unlucky sample fixes its choice for good.' },
      ],
      code: {
        prompt: 'Complete `q_update(q, r, q_next_max, alpha, gamma)`: return the new value of $Q(s,a)$ after one Q-learning update. Then complete `choose(q_values, eps, u)`: given a list of action values and a uniform random number `u` in [0, 1), return a random-looking index `int(u / eps * len(q_values))` if `u < eps`, otherwise the index of the largest value.',
        starter: 'def q_update(q, r, q_next_max, alpha, gamma):\n    return q  # replace\n\ndef choose(q_values, eps, u):\n    return 0  # replace\n\nprint(q_update(4.0, 2.0, 5.0, 0.5, 0.9))\nprint(choose([0.1, 0.7, 0.3], 0.1, 0.5))',
        solution: 'def q_update(q, r, q_next_max, alpha, gamma):\n    return q + alpha * (r + gamma * q_next_max - q)\n\ndef choose(q_values, eps, u):\n    if u < eps:\n        return int(u / eps * len(q_values))\n    return max(range(len(q_values)), key=lambda i: q_values[i])\n\nprint(q_update(4.0, 2.0, 5.0, 0.5, 0.9))\nprint(choose([0.1, 0.7, 0.3], 0.1, 0.5))',
        tests: 'assert abs(q_update(4.0, 2.0, 5.0, 0.5, 0.9) - 5.25) < 1e-12\nassert abs(q_update(1.0, 0.0, 0.0, 0.1, 0.9) - 0.9) < 1e-12\nassert choose([0.1, 0.7, 0.3], 0.1, 0.5) == 1, "with u >= eps, pick the largest value"\nassert choose([0.1, 0.7, 0.3], 0.3, 0.25) == 2, "with u < eps, pick int(u/eps*n)"\nassert choose([0.9, 0.7, 0.3], 0.0, 0.0) == 0',
        hint: 'Update: `q + alpha * (r + gamma * q_next_max - q)`. Greedy index: `max(range(len(q_values)), key=lambda i: q_values[i])`.',
      },
    },
    {
      id: 'swarm-flocking', skill: 'swarm', title: 'Swarms: order from local rules', pre: ['control-feedback', 'linalg-vectors', 'rl-q-learning'],
      hook: 'No bird leads a flock. Each one watches a few neighbors and follows three simple rules, and the group moves as one.',
      body: [
        'A swarm is many simple agents with no central controller. Each senses only its **neighbors** within some radius and reacts to them. In 1986 Craig Reynolds showed that three local rules are enough to produce flocking:',
        { list: ['**Separation**: steer away from neighbors that are too close.', '**Alignment**: steer toward the average heading of neighbors.', '**Cohesion**: steer toward the average position of neighbors.'] },
        'Group behavior that no individual was told to produce is called **emergent**. It is robust in a way centralized control is not: remove any agent and the rest carry on, and no single link or node is critical.',
        'It is also hard to engineer. You set local gains and get a global pattern, and the mapping between them is not obvious. Too little alignment and the group mills about; too little separation and agents collide; too much cohesion and they clump.',
        'The readout shows **polarization**: the length of the average heading vector, 1 when everyone flies the same way and near 0 for random headings.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'ws', label: 'Separation', min: 0, max: 3, step: 0.1, v: 1 },
          { k: 'wa', label: 'Alignment', min: 0, max: 3, step: 0.1, v: 0 },
          { k: 'wc', label: 'Cohesion', min: 0, max: 3, step: 0.1, v: 0.5 },
        ],
        init: () => { const r = rng(6); return { b: Array.from({ length: 50 }, () => { const a = r() * TAU; return [r() * 10, r() * 7, cos(a), sin(a)]; }), pol: 0, near: 1 }; },
        step(s, p, dt) {
          const B = s.b, W = 10, H = 7, wrap = (d, L) => d - L * round(d / L); let mn = 9;
          const acc = B.map(([x, y, vx, vy], i) => { let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0; for (let j = 0; j < B.length; j++) { if (j === i) continue; const dx = wrap(B[j][0] - x, W), dy = wrap(B[j][1] - y, H), d = hypot(dx, dy); if (d < mn) mn = d; if (d < 1.6) { n++; ax += B[j][2]; ay += B[j][3]; cx += dx; cy += dy; if (d < 0.6) { sx -= dx / (d * d + 0.01); sy -= dy / (d * d + 0.01); } } } return n ? [p.ws * sx * 0.6 + p.wa * (ax / n - vx) * 1.5 + p.wc * cx / n * 0.5, p.ws * sy * 0.6 + p.wa * (ay / n - vy) * 1.5 + p.wc * cy / n * 0.5] : [0, 0]; });
          let mx = 0, my = 0;
          B.forEach((b, i) => { b[2] += acc[i][0] * dt; b[3] += acc[i][1] * dt; const sp = hypot(b[2], b[3]) || 1; b[2] /= sp; b[3] /= sp; b[0] = (b[0] + b[2] * 1.4 * dt + W) % W; b[1] = (b[1] + b[3] * 1.4 * dt + H) % H; mx += b[2]; my += b[3]; });
          s.pol += (hypot(mx, my) / B.length - s.pol) * min(1, dt * 2); s.near += (mn - s.near) * min(1, dt * 2);
        },
        draw(g, s) {
          g.view(0, 10, 0, 7, { eq: true, pad: [6, 6, 6, 6] });
          s.b.forEach(([x, y, vx, vy]) => g.path([[x + vx * 0.22, y + vy * 0.22], [x - vx * 0.12 - vy * 0.09, y - vy * 0.12 + vx * 0.09], [x - vx * 0.12 + vy * 0.09, y - vy * 0.12 - vx * 0.09]], g.c.b, { fill: true, fa: 0.9, close: true, w: 1 }));
        },
        read: s => [['polarization', num(s.pol, 3)], ['closest pair', num(s.near, 2)], ['agents', 50]],
        mission: 'Tune the rules until the swarm flies as one: polarization above 0.9 with no pair closer than 0.1.',
        goal: s => s.pol > 0.9 && s.near > 0.1,
        win: { ws: 1.5, wa: 2, wc: 0.5 }, winTime: 25,
      },
      cards: [
        { q: 'State the three flocking rules.', a: 'Separation (avoid crowding neighbors), alignment (match neighbors’ average heading), cohesion (move toward neighbors’ average position).' },
        { q: 'What is emergent behavior, and why is it attractive for a swarm?', a: 'A group-level pattern that arises from local interactions without being commanded. It needs no central controller, so it tolerates the loss of individual agents and links.' },
      ],
      quiz: [
        { q: 'Ten agents all fly in exactly the same direction. Their polarization is:', num: 1, tol: 0.01, why: 'The average of identical unit vectors has length 1.' },
        { q: 'A swarm’s agents keep colliding while moving in a well-aligned group. Which gain is too low?', choices: ['Alignment', 'Cohesion', 'Separation', 'Speed'], answer: 2, why: 'Separation is the rule that keeps neighbors apart.' },
      ],
    },
    {
      id: 'swarm-consensus', skill: 'swarm', title: 'Consensus and the communication graph', pre: ['swarm-flocking', 'linalg-eigen', 'ode-first-order'],
      hook: 'A team with no leader can still agree on a heading, a time or a target estimate, provided the gossip can reach everyone.',
      body: [
        'Many multi-agent tasks reduce to **consensus**: every agent must end up with the same value (a rendezvous point, a clock, a shared estimate) using only messages to neighbors. The standard protocol is simple: each agent moves its value toward its neighbors’ values.',
        { eq: 'ẋ_i = Σ_{j ∈ neighbors} (x_j − x_i)' },
        'Who can talk to whom forms a **graph**. Two facts govern everything.',
        { list: ['Agreement is reached if and only if the graph is **connected**: there is a path of links between every pair. Split into two groups and each converges to its own answer.', 'The speed of agreement is set by the second-smallest eigenvalue of the graph’s Laplacian matrix, the **algebraic connectivity**. One thin bridge between two clusters makes consensus slow and fragile.'] },
        'This is the same first-order dynamics you studied early on, with eigenvalues deciding the time constants.',
        'Real swarms add limited range, dropped packets, delays and jamming, so the graph changes while the algorithm runs. For dividing work, agents often run **auctions**: each bids its cost for a task and the lowest bidder takes it, with no central planner.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'range', label: 'Communication range', min: 0.5, max: 6, step: 0.05, v: 1.5, re: true }],
        init: () => ({ x: AG.map(a => a[2]), t: 0, hist: AG.map(a => [[0, a[2]]]) }),
        step(s, p, dt) {
          for (let k = 0; k < 4; k++) { const nx = s.x.slice(); for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if (i !== j && hypot(AG[i][0] - AG[j][0], AG[i][1] - AG[j][1]) < p.range) nx[i] += 3 * (s.x[j] - s.x[i]) * dt / 4; s.x = nx; }
          s.t += dt; if (s.t < 40) s.x.forEach((v, i) => s.hist[i].push([s.t, v]));
        },
        draw(g, s, p) {
          const split = g.w * 0.55;
          g.view(0, 10, 0, 6, { eq: true, pad: [8, 8, g.w - split, 8] });
          for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (hypot(AG[i][0] - AG[j][0], AG[i][1] - AG[j][1]) < p.range) g.line(AG[i][0], AG[i][1], AG[j][0], AG[j][1], g.c.dim, { w: 1.2 });
          AG.forEach((a, i) => g.dot(a[0], a[1], g.ramp(clamp(s.x[i], 0, 1)), 9, { ring: g.c.ink }));
          g.view(0, 40, 0, 1, { pad: [split + 44, 12, 14, 30] }).axes({ xl: 'time (s)', yl: 'each agent’s value' });
          g.clip(() => s.hist.forEach(h => g.path(h, g.c.a, { w: 1.3, alpha: 0.8 })));
        },
        read: (s, p) => [['separate groups', comps(p.range)], ['spread of values', num(Math.max(...s.x) - Math.min(...s.x), 3)], ['links', AG.reduce((n, a, i) => n + AG.filter((b, j) => j > i && hypot(a[0] - b[0], a[1] - b[1]) < p.range).length, 0)]],
        mission: 'Find the shortest communication range (to within 0.05) at which all twelve agents still reach agreement (spread below 0.02).',
        goal: (s, p) => comps(p.range) === 1 && comps(p.range - 0.05) > 1 && Math.max(...s.x) - Math.min(...s.x) < 0.02,
        win: { range: RMIN }, winTime: 60,
      },
      cards: [
        { q: 'Write the basic consensus protocol.', a: '$ẋ_i = Σ_{j∈N_i}(x_j − x_i)$: each agent moves its value toward those of its neighbors.' },
        { q: 'What condition on the communication graph guarantees consensus, and what sets its speed?', a: 'The graph must be connected. Convergence speed is set by the algebraic connectivity: the second-smallest eigenvalue of the graph Laplacian.' },
        { q: 'How can agents divide tasks without a central planner?', a: 'With market-based (auction) allocation: each agent bids its cost for a task and the best bidder takes it.' },
      ],
      quiz: [
        { q: 'A communication graph splits into two groups that cannot reach each other. The consensus protocol will:', choices: ['Still reach one common value', 'Converge to a separate value within each group', 'Diverge', 'Stop immediately'], answer: 1, why: 'Information cannot cross between components, so each agrees internally on its own average.' },
        { q: 'Three agents start with values 2, 5 and 11 on a connected, symmetric graph. They converge to:', num: 6, tol: 0.05, why: 'Symmetric consensus preserves the average: $(2 + 5 + 11)/3 = 6$.' },
      ],
    },
  ],
};

const LMIN = lrRun(1, 4000).loss;
