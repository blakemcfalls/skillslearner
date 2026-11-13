import { num, rng, clamp, gauss } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, atan2, hypot, max, min, log10, sign, asin, round } = Math;
const rad = d => d * PI / 180, TAU = 2 * PI;

// --- Fourier series ---
const WAVES = {
  square: { f: x => sign(sin(x)) || 0, a: k => (k % 2 ? 4 / (PI * k) : 0), label: 'Square' },
  saw: { f: x => { const y = ((x + PI) % TAU + TAU) % TAU - PI; return y / PI; }, a: k => 2 / (PI * k) * (k % 2 ? 1 : -1), label: 'Sawtooth' },
  tri: { f: x => 2 / PI * asin(sin(x)), a: k => (k % 2 ? 8 / (PI * PI * k * k) * ((k - 1) / 2 % 2 ? -1 : 1) : 0), label: 'Triangle' },
};
const partial = (w, N, x) => { let s = 0; for (let k = 1; k <= N; k++) s += WAVES[w].a(k) * sin(k * x); return s; };
export function seriesErr(w, N) { let e = 0, p = 0; for (let i = 0; i < 720; i++) { const x = (i + 0.5) / 720 * TAU, f = WAVES[w].f(x); e += (partial(w, N, x) - f) ** 2; p += f * f; } return sqrt(e / p); }

// --- two-source interference ---
const RX = [1, 3];
export function rxAmp(p) { const k = TAU / p.lam, r1 = hypot(RX[0] + p.d / 2, RX[1]), r2 = hypot(RX[0] - p.d / 2, RX[1]), a1 = 1 / sqrt(r1), a2 = 1 / sqrt(r2), ph = k * (r2 - r1) + rad(p.ph); return sqrt(a1 * a1 + a2 * a2 + 2 * a1 * a2 * cos(ph)) / (a1 + a2); }

// --- moving average ---
const maGain = (f, M) => (f === 0 ? 1 : abs(sin(PI * f * M / 1000) / (M * sin(PI * f / 1000))));
const SIG = (() => { const r = rng(4); return Array.from({ length: 560 }, (_, n) => sin(TAU * 5 * n / 1000) + 0.5 * sin(TAU * 50 * n / 1000) + 0.08 * r.n()); })();

// --- spectrum with windows ---
const WIN = { rect: () => 1, hann: (n, N) => 0.5 - 0.5 * cos(TAU * n / N), hamming: (n, N) => 0.54 - 0.46 * cos(TAU * n / N) };
const smem = new Map();
export function spectrum(f1, w) {
  const key = f1 + w; if (smem.has(key)) return smem.get(key);
  const N = 128, x = Array.from({ length: N }, (_, n) => (cos(TAU * f1 * n / N) + 0.01 * cos(TAU * 34 * n / N)) * WIN[w](n, N)), pts = [];
  let pk = 0;
  for (let k = 0; k <= 64; k += 0.25) { let re = 0, im = 0; for (let n = 0; n < N; n++) { re += x[n] * cos(TAU * k * n / N); im -= x[n] * sin(TAU * k * n / N); } const m = hypot(re, im); pk = max(pk, m); pts.push([k, m]); }
  const db = pts.map(([k, m]) => [k, max(-100, 20 * log10(m / pk + 1e-12))]);
  const at = k0 => db.find(q => abs(q[0] - k0) < 1e-9)[1];
  const floor = max(...db.filter(q => q[0] >= 26 && q[0] <= 31).map(q => q[1]));
  const res = { db, stand: at(34) - floor };
  if (smem.size > 200) smem.clear(); smem.set(key, res); return res;
}

// --- electric field of two charges ---
const E2 = (p, x, y) => { let ex = 0, ey = 0; [[-1.5, p.q1], [1.5, p.q2]].forEach(([cx, q]) => { const dx = x - cx, r = max(0.12, hypot(dx, y)); ex += q * dx / r ** 3; ey += q * y / r ** 3; }); return [ex, ey]; };

export default {
  id: 'u06', title: 'Waves and signals', blurb: 'Fourier analysis, fields and digital signal processing.',
  lessons: [
    {
      id: 'fourier-phasors', skill: 'fourier', title: 'Phasors: sinusoids as rotating arrows', pre: ['mech-spring', 'linalg-vectors', 'calc-taylor'],
      hook: 'Radar, radio and AC power engineers rarely write cosines. They draw an arrow and let it spin.',
      body: [
        'Euler’s formula ties exponentials to rotation: $e^{jθ} = cos θ + j·sin θ$. So $A·e^{j(ωt + φ)}$ is an arrow of length $A$ spinning at $ω$ rad/s, and the real signal $A·cos(ωt + φ)$ is its shadow on the horizontal axis.',
        'Freeze the spin and what remains, $A·e^{jφ}$, is the **phasor**: one complex number holding amplitude and phase. Adding two sinusoids of the same frequency becomes adding two arrows tip to tail.',
        'That makes interference easy to see. Arrows aligned (in phase) add to a longer arrow: **constructive**. Arrows opposed (180° apart) subtract: **destructive**. Equal arrows exactly opposed cancel completely, which is how noise-cancelling headphones and antenna nulls work.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'A2', label: 'Second amplitude', min: 0, max: 1.5, step: 0.05, v: 0.7 },
          { k: 'ph', label: 'Second phase', min: -180, max: 180, step: 5, v: 60, unit: '°' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 1.6; },
        draw(g, s, p) {
          const split = min(g.h, g.w * 0.4), a = s.t, b = s.t + rad(p.ph);
          const x1 = cos(a), y1 = sin(a), x2 = p.A2 * cos(b), y2 = p.A2 * sin(b);
          g.view(-2.6, 2.6, -2.6, 2.6, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.circle(0, 0, 1, g.c.grid, { w: 1 }).line(-2.6, 0, 2.6, 0, g.c.grid, { w: 1 }).line(0, -2.6, 0, 2.6, g.c.grid, { w: 1 });
          g.arrow(0, 0, x1, y1, g.c.b, { w: 2.5 }).arrow(x1, y1, x1 + x2, y1 + y2, g.c.c, { w: 2.5 }).arrow(0, 0, x1 + x2, y1 + y2, g.c.a, { w: 3.5 });
          g.line(x1 + x2, y1 + y2, x1 + x2, 0, g.c.a, { w: 1, dash: [3, 3] });
          g.view(0, 12, -2.6, 2.6, { pad: [split + 40, 12, 14, 30] }).axes({ xl: 'time', xt: false });
          g.fn(t => cos(s.t - t), g.c.b, { w: 1.5 }).fn(t => p.A2 * cos(s.t - t + rad(p.ph)), g.c.c, { w: 1.5 }).fn(t => cos(s.t - t) + p.A2 * cos(s.t - t + rad(p.ph)), g.c.a, { w: 2.5 });
          g.note('sum', 'tr', g.c.a);
        },
        read: (s, p) => { const re = 1 + p.A2 * cos(rad(p.ph)), im = p.A2 * sin(rad(p.ph)); return [['sum amplitude', num(hypot(re, im), 3)], ['sum phase', num(atan2(im, re) * 180 / PI, 3) + '°']]; },
        mission: 'Cancel the first signal: bring the amplitude of the sum below 0.05.',
        goal: (s, p) => hypot(1 + p.A2 * cos(rad(p.ph)), p.A2 * sin(rad(p.ph))) < 0.05,
        win: { A2: 1, ph: 180 },
      },
      cards: [
        { q: 'State Euler’s formula and say what $e^{jωt}$ looks like in the complex plane.', a: '$e^{jθ} = cosθ + j sinθ$. $e^{jωt}$ is a unit arrow rotating counter-clockwise at $ω$ rad/s; its real part is $cos ωt$.' },
        { q: 'What is a phasor, and why is it useful for adding sinusoids?', a: 'A complex number $Ae^{jφ}$ holding a sinusoid’s amplitude and phase. Same-frequency sinusoids add by vector addition of their phasors.' },
      ],
      quiz: [
        { q: 'Two equal-amplitude signals (each amplitude 1) are 90° apart in phase. What is the amplitude of their sum?', num: 1.414, tol: 0.01, why: 'Perpendicular arrows of length 1 add to $√2 ≈ 1.414$.' },
        { q: 'For complete cancellation, a second signal must have:', choices: ['Equal amplitude and the same phase', 'Equal amplitude and a 180° phase difference', 'Double amplitude and 90° phase', 'Any amplitude at 180°'], answer: 1, why: 'The arrows must be the same length and point in opposite directions.' },
      ],
    },
    {
      id: 'fourier-series', skill: 'fourier', title: 'Fourier series: building signals from sines', pre: ['fourier-phasors', 'calc-integral'],
      hook: 'A sharp-edged radar pulse and a pure tone are the same kind of thing. One just needs many more ingredients.',
      body: [
        'Any periodic signal can be written as a sum of sinusoids at whole-number multiples of its repetition frequency: the **harmonics**. The recipe of amplitudes is the signal’s **spectrum**.',
        { eq: 'square(x) = (4/π)·[sin x + sin 3x/3 + sin 5x/5 + …]' },
        'Smooth signals need few harmonics; their amplitudes fall quickly (a triangle wave’s fall as $1/k^2$). Sharp edges need many, falling only as $1/k$. **Fast changes in time require high frequencies**: remember that sentence, because bandwidth, resolution and data rate all come from it.',
        'Near a jump the partial sum overshoots by about 9% however many terms you add. This **Gibbs phenomenon** is why abruptly truncating a spectrum makes a signal ring.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'w', type: 'select', label: 'Waveform', v: 'square', options: Object.entries(WAVES).map(([k, v]) => [k, v.label]) },
          { k: 'N', label: 'Highest harmonic kept', min: 1, max: 61, step: 2, v: 3 },
        ],
        draw(g, s, p) {
          g.view(-PI, 3 * PI, -1.5, 1.5, { pad: [40, 10, 14, 120] }).axes({ xt: false });
          g.fn(WAVES[p.w].f, g.c.dim, { w: 1.5, n: 900 }).fn(x => partial(p.w, p.N, x), g.c.a, { w: 2.2, n: 900 });
          g.view(0, 62, 0, 1.35, { pad: [40, g.h - 106, 14, 30] }).axes({ xl: 'harmonic number', yl: 'amplitude', xs: 10 });
          for (let k = 1; k <= 61; k++) { const a = abs(WAVES[p.w].a(k)); if (a > 0) g.rect(k - 0.35, 0, 0.7, a, k <= p.N ? g.c.b : g.c.dim, { fa: k <= p.N ? 0.9 : 0.3 }); }
        },
        read: (s, p) => [['RMS error', num(seriesErr(p.w, p.N) * 100, 3) + ' %'], ['harmonics in use', p.w === 'saw' ? p.N : (p.N + 1) / 2]],
        mission: 'Build a square wave with RMS error below 12%.',
        goal: (s, p) => p.w === 'square' && seriesErr('square', p.N) < 0.12,
        win: { w: 'square', N: 29 },
      },
      cards: [
        { q: 'What does a Fourier series express, and what are harmonics?', a: 'A periodic signal as a sum of sinusoids at integer multiples (harmonics) of the fundamental frequency. The set of amplitudes is the spectrum.' },
        { q: 'How do the harmonic amplitudes of a signal with sharp jumps fall off compared with a smooth one, and what does that imply?', a: 'Jumps: only as $1/k$ (square, sawtooth). Continuous with corners: $1/k^2$ (triangle). Sharp time features need wide bandwidth.' },
        { q: 'What is the Gibbs phenomenon?', a: 'The roughly 9% overshoot of a truncated Fourier series next to a discontinuity. Adding terms narrows it but does not reduce its height.' },
      ],
      quiz: [
        { q: 'A 1 kHz square wave is passed through a filter that removes everything above 4 kHz. Which harmonics survive?', choices: ['1 kHz only', '1 and 3 kHz', '1, 2, 3 and 4 kHz', '1, 3 and 5 kHz'], answer: 1, why: 'A square wave contains only odd harmonics: 1, 3, 5… kHz. Only 1 and 3 kHz are below the cutoff.' },
        { q: 'The fundamental of a square wave has amplitude $4/π$. What is the amplitude of its 5th harmonic?', num: 0.2546, tol: 0.005, why: '$4/(5π) ≈ 0.2546$: one fifth of the fundamental.' },
      ],
      code: {
        prompt: 'Complete `square_partial(t, n_terms)`: the sum of the first `n_terms` odd harmonics of a square wave, $(4/π)·Σ sin((2k+1)t)/(2k+1)$ for $k$ from 0 to `n_terms - 1`. `t` is a NumPy array.',
        starter: 'import numpy as np\n\ndef square_partial(t, n_terms):\n    total = np.zeros_like(t)\n    # add each odd harmonic\n    return 4 / np.pi * total\n\nt = np.array([np.pi / 2])\nprint(square_partial(t, 1), square_partial(t, 50))',
        solution: 'import numpy as np\n\ndef square_partial(t, n_terms):\n    total = np.zeros_like(t)\n    for k in range(n_terms):\n        h = 2 * k + 1\n        total = total + np.sin(h * t) / h\n    return 4 / np.pi * total\n\nt = np.array([np.pi / 2])\nprint(square_partial(t, 1), square_partial(t, 50))',
        tests: 'import numpy as np\n_t = np.array([np.pi / 2, -np.pi / 2, 0.0])\nassert np.allclose(square_partial(_t, 1), [4 / np.pi, -4 / np.pi, 0.0]), "with one term the result is (4/pi) sin t"\n_y = square_partial(_t, 400)\nassert abs(_y[0] - 1) < 0.01 and abs(_y[1] + 1) < 0.01, f"400 terms should be close to +1 and -1, got {_y[:2]}"\nassert abs(square_partial(np.array([np.pi / 2]), 2)[0] - 4 / np.pi * (1 - 1 / 3)) < 1e-12',
        hint: 'Loop `for k in range(n_terms)`, set `h = 2 * k + 1`, and add `np.sin(h * t) / h` to the total.',
      },
    },
    {
      id: 'em-interference', skill: 'em', title: 'Waves, superposition and interference', pre: ['fourier-phasors', 'calc-vector-fields'],
      hook: 'Two transmitters do not simply double the signal. They carve space into lanes of reinforcement and lanes of silence.',
      body: [
        'A wave carries a disturbance through space at speed $v = fλ$. Waves **superpose**: where two overlap, the displacements add. Whether they reinforce or cancel at a point depends only on their relative phase there.',
        'For two sources that phase is set by the **path difference**:',
        { eq: 'Δφ = 2π·(r_2 − r_1)/λ + φ_0', where: '$φ_0$ is any phase offset applied to the second source' },
        'A path difference of a whole number of wavelengths gives a maximum; a half-integer gives a null. The result is a fixed pattern of lobes and nulls.',
        'Change $φ_0$ and the whole pattern swings sideways with no moving parts. That one observation is the principle of the phased-array antenna, coming in the next unit.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'lam', label: 'Wavelength λ', min: 0.4, max: 1.5, step: 0.05, v: 1, unit: 'm' },
          { k: 'd', label: 'Source separation', min: 0.5, max: 4, step: 0.1, v: 2, unit: 'm' },
          { k: 'ph', label: 'Phase offset of right source', min: 0, max: 360, step: 5, v: 0, unit: '°' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 4; },
        draw(g, s, p) {
          g.view(-5, 5, -0.6, 5.4, { eq: true, pad: [8, 8, 8, 8] });
          const k = TAU / p.lam;
          g.heat((x, y) => { const r1 = max(0.25, hypot(x + p.d / 2, y)), r2 = max(0.25, hypot(x - p.d / 2, y)); return (sin(k * r1 - s.t) / sqrt(r1) + sin(k * r2 - s.t + rad(p.ph)) / sqrt(r2)) / 1.6; }, 84, 50, g.div);
          g.dot(-p.d / 2, 0, g.c.ink, 5).dot(p.d / 2, 0, g.c.ink, 5);
          g.dot(RX[0], RX[1], g.c.panel, 7, { ring: g.c.ink }).text('receiver', RX[0], RX[1], g.c.ink, { dx: 12, s: 11, bg: true });
        },
        read: (s, p) => [['signal at receiver (1 = fully reinforced)', num(rxAmp(p), 3)], ['path difference', num((hypot(RX[0] + p.d / 2, RX[1]) - hypot(RX[0] - p.d / 2, RX[1])) / p.lam, 3) + ' λ']],
        mission: 'Steer a null onto the receiver: signal there below 0.1.',
        goal: (s, p) => rxAmp(p) < 0.1,
        win: { lam: 1, d: 2, ph: 40 },
      },
      cards: [
        { q: 'What determines whether two waves reinforce or cancel at a given point?', a: 'Their relative phase there, set by the path difference: $Δφ = 2π(r_2 − r_1)/λ$ plus any source phase offset. Multiples of $2π$ reinforce; odd multiples of $π$ cancel.' },
        { q: 'What happens to a two-source interference pattern when a phase offset is applied to one source?', a: 'The whole pattern of lobes and nulls shifts in angle. This is electronic beam steering.' },
      ],
      quiz: [
        { q: 'Two in-phase sources emit λ = 3 cm waves. A point is 7.5 cm farther from one source than the other. There you find:', choices: ['A maximum', 'A null', 'Half amplitude', 'No waves at all from either source'], answer: 1, why: '7.5 cm is 2.5 wavelengths: a half-integer path difference, so the waves arrive in opposite phase.' },
        { q: 'A 10 GHz radar wave travels at $3 × 10^8$ m/s. What is its wavelength in centimeters?', num: 3, unit: 'cm', tol: 0.05, why: '$λ = c/f = 3 × 10^8/10^{10} = 0.03$ m = 3 cm.' },
      ],
    },
    {
      id: 'fourier-transform', skill: 'fourier', title: 'The Fourier transform and bandwidth', pre: ['fourier-series', 'em-interference'],
      hook: 'Want to tell two targets apart in range? You need a short pulse, and a short pulse needs bandwidth. There is no way around the trade.',
      body: [
        'A Fourier series handles periodic signals. Let the period go to infinity and the harmonics merge into a continuum: the **Fourier transform**, $X(f) = ∫x(t)·e^{−j2πft} dt$. It gives the amount of each frequency in any signal.',
        'The key fact is the **time–bandwidth trade**. A rectangular pulse of duration $τ$ has a sinc-shaped spectrum whose width is about',
        { eq: 'B ≈ 1/τ' },
        'Squeeze a signal in time and it spreads in frequency, and the reverse. A Gaussian pulse is the most compact possible in both at once.',
        'For radar, a pulse of length $τ$ occupies $cτ/2$ in range, so two targets closer than that blur together. In terms of bandwidth, range resolution is $ΔR = c/2B$. Notice too that a shorter pulse carries less energy. A later lesson shows how radars get out of that bind.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'tau', label: 'Pulse duration τ', min: 0.1, max: 5, step: 0.1, v: 2, unit: 'µs' },
          { k: 'shape', type: 'select', label: 'Pulse shape', v: 'rect', options: [['rect', 'Rectangular'], ['gauss', 'Gaussian']] },
        ],
        draw(g, s, p) {
          const sg = p.tau / 2.355, sinc = x => (abs(x) < 1e-9 ? 1 : sin(PI * x) / (PI * x));
          g.view(-4, 4, 0, 1.25, { pad: [40, 10, 14, 170] }).axes({ xl: 'time (µs)', yt: false });
          g.fn(t => (p.shape === 'rect' ? (abs(t) <= p.tau / 2 ? 1 : 0) : exp(-t * t / (2 * sg * sg))), g.c.a, { w: 2.5, n: 900 });
          g.view(-10, 10, 0, 1.25, { pad: [40, g.h - 150, 14, 30] }).axes({ xl: 'frequency offset (MHz)', yl: 'spectrum magnitude', yt: false });
          g.fn(f => (p.shape === 'rect' ? abs(sinc(f * p.tau)) : exp(-2 * (PI * f * sg) ** 2)), g.c.b, { w: 2.5, n: 900 });
        },
        read: (s, p) => [['3 dB bandwidth', num((p.shape === 'rect' ? 0.886 : 0.441) / p.tau, 3) + ' MHz'], ['range resolution cτ/2', num(150 * p.tau, 4) + ' m'], ['relative pulse energy', num(p.tau / 5, 2)]],
        mission: 'Shorten the pulse until two targets 30 m apart in range can be resolved.',
        goal: (s, p) => 150 * p.tau <= 30.001,
        win: { tau: 0.2 },
      },
      cards: [
        { q: 'State the time–bandwidth trade for a pulse of duration $τ$.', a: 'Bandwidth $B ≈ 1/τ$. A signal cannot be made short in time and narrow in frequency at once.' },
        { q: 'Give radar range resolution in terms of pulse length and in terms of bandwidth.', a: '$ΔR = cτ/2 = c/(2B)$.' },
      ],
      quiz: [
        { q: 'What bandwidth is needed for 1.5 m range resolution? Give MHz.', num: 100, unit: 'MHz', tol: 1, why: '$B = c/(2ΔR) = 3 × 10^8/3 = 10^8$ Hz = 100 MHz.' },
        { q: 'A pulse is made four times shorter. Its spectrum becomes:', choices: ['Four times narrower', 'Four times wider', 'Unchanged', 'Twice as wide'], answer: 1, why: '$B ≈ 1/τ$: time compression by 4 spreads the spectrum by 4.' },
      ],
    },
    {
      id: 'dsp-sampling', skill: 'dsp', title: 'Sampling and aliasing', pre: ['fourier-transform', 'py-numpy'],
      hook: 'Wagon wheels spin backward on film for the same reason a radar can report a fast target as a slow one.',
      body: [
        'A digital system sees a signal only at instants $1/f_s$ apart. The **sampling theorem** says nothing is lost provided the signal contains no frequency at or above half the sample rate:',
        { eq: 'f_s > 2·f_{max}', where: '$f_s/2$ is the Nyquist frequency' },
        'Break the rule and a high frequency produces exactly the same samples as a lower one. It is recorded as an **alias** at $|f − k·f_s|$ for the integer $k$ that lands in the 0 to $f_s/2$ band. After sampling the two are indistinguishable.',
        'The defense is an analog **anti-aliasing filter** before the converter. Pulsed radars meet the same effect twice: the pulse repetition frequency samples Doppler, causing blind and ambiguous speeds, and it samples range, causing ambiguous ranges.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'f', label: 'Signal frequency', min: 0.5, max: 12, step: 0.1, v: 3, unit: 'kHz' },
          { k: 'fs', label: 'Sample rate', min: 2, max: 30, step: 0.5, v: 20, unit: 'kHz' },
        ],
        draw(g, s, p) {
          const fa = alias(p), ok = p.f < p.fs / 2;
          g.view(0, 2, -1.3, 1.3, { pad: [40, 10, 14, 96] }).axes({ xl: 'time (ms)', yt: false });
          g.fn(t => sin(TAU * p.f * t), g.c.dim, { w: 1.5, n: 900 });
          if (!ok) g.fn(t => sign(p.f - p.fs * round(p.f / p.fs)) * sin(TAU * fa * t), g.c.a, { w: 2.2, n: 600 });
          for (let n = 0; n <= 2 * p.fs + 1e-9; n++) { const t = n / p.fs; g.line(t, 0, t, sin(TAU * p.f * t), g.c.b, { w: 1 }).dot(t, sin(TAU * p.f * t), g.c.b, 3.5); }
          g.note(ok ? 'samples capture the signal' : 'samples fit a lower frequency: alias', 'tr', ok ? g.c.good : g.c.a);
          g.view(0, 15, 0, 1, { pad: [40, g.h - 70, 14, 30] }).axes({ xl: 'frequency (kHz)', yt: false, grid: false });
          g.rect(0, 0, min(15, p.fs / 2), 1, g.c.c, { fa: 0.14 }).line(p.fs / 2, 0, p.fs / 2, 1, g.c.c, { w: 1.5, dash: [4, 3] });
          g.line(p.f, 0, p.f, 0.85, g.c.dim, { w: 3 }); if (!ok) g.arrow(p.f, 0.5, fa, 0.5, g.c.a, { w: 1.5 }).line(fa, 0, fa, 0.85, g.c.a, { w: 3 });
        },
        read: (s, p) => [['Nyquist frequency', num(p.fs / 2, 3) + ' kHz'], ['recorded as', num(alias(p), 3) + ' kHz'], ['samples per cycle', num(p.fs / p.f, 3)]],
        mission: 'Make a 9 kHz tone show up as a 1 kHz tone.',
        goal: (s, p) => abs(p.f - 9) < 0.01 && abs(alias(p) - 1) < 0.01,
        win: { f: 9, fs: 10 },
      },
      cards: [
        { q: 'State the sampling theorem.', a: 'A signal is fully captured by its samples if the sample rate exceeds twice its highest frequency: $f_s > 2f_{max}$. Half the sample rate is the Nyquist frequency.' },
        { q: 'What is aliasing, and how is it prevented?', a: 'A frequency above $f_s/2$ produces the same samples as a lower one at $|f − kf_s|$ and is recorded as that. Prevent it with an analog low-pass (anti-aliasing) filter before sampling, or a higher sample rate.' },
      ],
      quiz: [
        { q: 'A 7 kHz tone is sampled at 10 kHz. At what frequency does it appear? Give kHz.', num: 3, unit: 'kHz', tol: 0.02, why: '$|7 − 10| = 3$ kHz, which lies inside 0–5 kHz.' },
        { q: 'A sensor signal has content up to 400 Hz. The minimum sample rate that avoids aliasing is just above:', choices: ['200 Hz', '400 Hz', '800 Hz', '1600 Hz'], answer: 2, why: 'Twice the highest frequency: 800 Hz. Practical designs add margin for the filter roll-off.' },
      ],
    },
    {
      id: 'dsp-convolution', skill: 'dsp', title: 'Convolution and FIR filters', pre: ['dsp-sampling', 'prob-distributions'],
      hook: 'Every digital filter, matched filter and image blur is one operation: slide a small pattern along the data and take a weighted sum.',
      body: [
        '**Convolution** combines a signal $x$ with a short **kernel** $h$: each output sample is a weighted sum of nearby inputs.',
        { eq: 'y[n] = Σ_k h[k]·x[n − k]' },
        'A filter built this way is an **FIR** (finite impulse response) filter; the kernel is its impulse response. The simplest is the **moving average**: $M$ equal weights of $1/M$. It averages noise down by $√M$, as you saw in the probability unit.',
        'In frequency terms a moving average is a low-pass filter with nulls at multiples of $f_s/M$: any sinusoid that completes a whole number of cycles inside the window averages to zero. Choosing $M$ lets you park a null on an interferer.',
        'Convolution in time equals multiplication in frequency. That duality is why filters are designed in one domain and run in the other.',
      ],
      sim: {
        h: 340,
        controls: [{ k: 'M', label: 'Moving-average length M', min: 1, max: 60, step: 1, v: 5, unit: 'samples' }],
        draw(g, s, p) {
          g.view(0, 0.5, -1.8, 1.8, { pad: [40, 10, 14, 140] }).axes({ xl: 'time (s), sampled at 1 kHz', yt: false });
          const y = []; for (let n = 0; n < 500; n++) { let a = 0, c = 0; for (let k = 0; k < p.M; k++) if (n - k >= 0) { a += SIG[n - k]; c++; } y.push([n / 1000, a / c]); }
          g.clip(() => { g.path(SIG.slice(0, 500).map((v, n) => [n / 1000, v]), g.c.dim, { w: 1.2 }); g.path(y, g.c.a, { w: 2.5 }); });
          g.note('input: 5 Hz signal + 50 Hz hum + noise', 'tl', g.c.dim).note('filtered', 'tl', g.c.a, 1);
          g.view(0, 120, 0, 1.1, { pad: [40, g.h - 122, 14, 30] }).axes({ xl: 'frequency (Hz)', yl: 'filter gain' });
          g.fn(f => maGain(f, p.M), g.c.b, { w: 2.5, n: 600 });
          g.line(5, 0, 5, 1.1, g.c.good, { w: 1.5, dash: [4, 3] }).line(50, 0, 50, 1.1, g.c.bad, { w: 1.5, dash: [4, 3] }).text('signal', 7, 1.0, g.c.good, { s: 10.5 }).text('hum', 52, 1.0, g.c.bad, { s: 10.5 });
        },
        read: (s, p) => [['gain at 5 Hz', num(maGain(5, p.M), 3)], ['gain at 50 Hz', num(maGain(50, p.M), 3)], ['first null at', num(1000 / p.M, 3) + ' Hz']],
        mission: 'Remove the 50 Hz hum (gain below 0.02) while keeping more than 90% of the 5 Hz signal.',
        goal: (s, p) => maGain(50, p.M) < 0.02 && maGain(5, p.M) > 0.9,
        win: { M: 20 },
      },
      cards: [
        { q: 'Write the convolution sum for an FIR filter with kernel $h$.', a: '$y[n] = Σ_k h[k]·x[n−k]$: each output is a weighted sum of recent inputs.' },
        { q: 'Where are the frequency nulls of an $M$-point moving average, and why?', a: 'At multiples of $f_s/M$. A sinusoid with a whole number of cycles in the window averages to exactly zero.' },
        { q: 'What does convolution in the time domain correspond to in the frequency domain?', a: 'Multiplication of the spectra: $Y(f) = H(f)·X(f)$.' },
      ],
      quiz: [
        { q: 'Data is sampled at 2 kHz. What moving-average length puts the first null at 100 Hz?', num: 20, tol: 0.01, why: '$f_s/M = 100$ gives $M = 2000/100 = 20$ samples.' },
        { q: 'A 16-point moving average reduces the standard deviation of white noise by a factor of:', choices: ['2', '4', '8', '16'], answer: 1, why: 'Averaging $M$ independent samples divides σ by $√M = 4$.' },
      ],
      code: {
        prompt: 'Complete `smooth(x, m)`: an `m`-point moving average of array `x` using `np.convolve` with `mode="valid"` (so the output has `len(x) - m + 1` samples).',
        starter: 'import numpy as np\n\ndef smooth(x, m):\n    kernel = np.ones(m)  # fix the weights\n    return x\n\nprint(smooth(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3))',
        solution: 'import numpy as np\n\ndef smooth(x, m):\n    kernel = np.ones(m) / m\n    return np.convolve(x, kernel, mode="valid")\n\nprint(smooth(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3))',
        tests: 'import numpy as np\n_y = smooth(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3)\nassert len(_y) == 3, f"expected 3 output samples, got {len(_y)}"\nassert np.allclose(_y, [2.0, 3.0, 4.0]), f"got {_y}"\n_n = np.arange(200)\n_hum = np.sin(2 * np.pi * _n / 20)\nassert np.max(np.abs(smooth(_hum, 20))) < 1e-9, "a 20-point average should null a tone with a 20-sample period"',
        hint: 'The kernel is `np.ones(m) / m`. Return `np.convolve(x, kernel, mode="valid")`.',
      },
    },
    {
      id: 'dsp-fft', skill: 'dsp', title: 'The FFT, leakage and windows', pre: ['dsp-convolution', 'fourier-transform'],
      hook: 'A weak target next to a strong one can vanish in the spectrum, hidden by an artifact of how the data was cut. A window function brings it back.',
      body: [
        'The **discrete Fourier transform** (DFT) turns $N$ samples into $N$ frequency bins spaced $f_s/N$ apart. The **FFT** computes it in $N·log N$ operations instead of $N^2$, which is what made real-time spectral processing possible.',
        'The DFT assumes the $N$ samples repeat forever. If a tone does not fit a whole number of cycles in the record, the repeat has a jump at the seam, and its energy smears across all bins. This is **spectral leakage**, and with no correction the sidelobes fall off slowly, starting only 13 dB below the peak.',
        'A **window** tapers the record smoothly to zero at both ends before the FFT. The Hann window pushes sidelobes far down, at the cost of a main lobe about twice as wide. You trade resolution for dynamic range.',
        'The lab signal is a strong tone plus one 40 dB weaker (1% of the amplitude) at bin 34.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'w', type: 'select', label: 'Window', v: 'rect', options: [['rect', 'Rectangular (none)'], ['hamming', 'Hamming'], ['hann', 'Hann']] },
          { k: 'f1', label: 'Strong tone: cycles in the record', min: 18, max: 23, step: 0.1, v: 20.5 },
        ],
        draw(g, s, p) {
          const r = spectrum(p.f1, p.w);
          g.view(0, 64, -100, 5).axes({ xl: 'frequency bin', yl: 'level (dB)', xs: 8, ys: 20 });
          g.rect(26, -100, 5, 105, g.c.dim, { fa: 0.08 });
          g.clip(() => g.path(r.db, g.c.b, { w: 2 }));
          g.line(34, -100, 34, 5, g.c.a, { w: 1, dash: [4, 4] }).text('weak tone (−40 dB)', 35, -8, g.c.a, { s: 11 });
        },
        read: (s, p) => { const r = spectrum(p.f1, p.w); return [['weak tone stands above nearby leakage by', num(r.stand, 3) + ' dB'], ['verdict', r.stand >= 10 ? 'visible' : 'buried']]; },
        mission: 'Make the weak tone stand at least 10 dB above the leakage in the shaded band.',
        goal: (s, p) => spectrum(p.f1, p.w).stand >= 10,
        win: { w: 'hann' },
      },
      cards: [
        { q: 'What is the frequency spacing of DFT bins for $N$ samples at rate $f_s$, and what does the FFT contribute?', a: 'Bin spacing is $f_s/N$. The FFT is a fast algorithm for the DFT: $N log N$ operations instead of $N^2$.' },
        { q: 'What causes spectral leakage and how does a window reduce it?', a: 'A tone that does not complete a whole number of cycles in the record is discontinuous at the ends, spreading energy into all bins. A window tapers the ends to zero, lowering sidelobes at the cost of a wider main lobe.' },
      ],
      quiz: [
        { q: 'A 1024-point FFT of data sampled at 51.2 kHz has bins spaced how far apart? Give Hz.', num: 50, unit: 'Hz', tol: 0.5, why: '$f_s/N = 51200/1024 = 50$ Hz.' },
        { q: 'Compared with no window, a Hann window gives:', choices: ['Narrower main lobe, higher sidelobes', 'Wider main lobe, much lower sidelobes', 'The same spectrum', 'Higher frequency resolution'], answer: 1, why: 'Tapering suppresses leakage sidelobes but roughly doubles main-lobe width.' },
      ],
      code: {
        prompt: 'Complete `dominant_freq(x, fs)`: return the frequency in Hz of the largest peak in the spectrum of real signal `x` sampled at `fs`. Use `np.fft.rfft` and `np.fft.rfftfreq`, and ignore the zero-frequency bin.',
        starter: 'import numpy as np\n\ndef dominant_freq(x, fs):\n    spectrum = np.abs(np.fft.rfft(x))\n    freqs = np.fft.rfftfreq(len(x), 1 / fs)\n    return 0.0  # replace\n\nt = np.arange(1000) / 1000\nprint(dominant_freq(np.sin(2 * np.pi * 50 * t), 1000))',
        solution: 'import numpy as np\n\ndef dominant_freq(x, fs):\n    spectrum = np.abs(np.fft.rfft(x))\n    freqs = np.fft.rfftfreq(len(x), 1 / fs)\n    spectrum[0] = 0\n    return freqs[np.argmax(spectrum)]\n\nt = np.arange(1000) / 1000\nprint(dominant_freq(np.sin(2 * np.pi * 50 * t), 1000))',
        tests: 'import numpy as np\n_t = np.arange(1000) / 1000\nassert abs(dominant_freq(np.sin(2 * np.pi * 50 * _t), 1000) - 50) < 1e-9\nassert abs(dominant_freq(5 + np.sin(2 * np.pi * 120 * _t) + 0.3 * np.sin(2 * np.pi * 40 * _t), 1000) - 120) < 1e-9, "ignore the DC bin and pick the strongest tone"\n_t2 = np.arange(400) / 200\nassert abs(dominant_freq(np.cos(2 * np.pi * 12.5 * _t2), 200) - 12.5) < 1e-9',
        hint: 'Zero the first element of `spectrum`, then return `freqs[np.argmax(spectrum)]`.',
      },
    },
    {
      id: 'em-electric-field', skill: 'em', title: 'Charge, electric field and potential', pre: ['calc-gradient', 'calc-vector-fields'],
      hook: 'Every antenna, sensor and circuit starts here: charges create fields, and fields push charges.',
      body: [
        'A charge $q$ creates an **electric field** around it, pointing away from positive charge and falling off with the square of distance:',
        { eq: 'E = k·q/r^2,   F = q_{test}·E', where: '$k ≈ 9 × 10^9$ N·m²/C²' },
        'Fields from several charges add as vectors. That is superposition again, the same rule waves obeyed.',
        'The **potential** $V = kq/r$ is a scalar landscape, measured in volts. The field is its downhill slope, $E = −∇V$: charges roll down potential the way masses roll down hills. **Gauss’s law** restates all this with the tools from the last unit: the electric flux out of any closed surface equals the enclosed charge divided by $ε_0$.',
        'In the lab, color shows potential, arrows show field direction, and the probe reports the field where you drag it.',
      ],
      labNote: 'Drag the probe. Units are scaled so k = 1.',
      sim: {
        h: 330,
        controls: [
          { k: 'q1', label: 'Left charge', min: -5, max: 5, step: 1, v: 4 },
          { k: 'q2', label: 'Right charge', min: -5, max: 5, step: 1, v: -4 },
        ],
        init: () => ({ x: 0, y: 1.5 }),
        drag(s, p, x, y) { s.x = clamp(x, -4, 4); s.y = clamp(y, -3, 3); },
        draw(g, s, p) {
          g.view(-4, 4, -3, 3, { eq: true, pad: [8, 8, 8, 8] });
          g.heat((x, y) => clamp((p.q1 / max(0.15, hypot(x + 1.5, y)) + p.q2 / max(0.15, hypot(x - 1.5, y))) / 5, -1, 1), 64, 48, g.div);
          for (let x = -3.6; x <= 3.61; x += 0.6) for (let y = -2.7; y <= 2.71; y += 0.6) { const [ex, ey] = E2(p, x, y), m = hypot(ex, ey); if (m > 1e-3) g.arrow(x - ex / m * 0.18, y - ey / m * 0.18, x + ex / m * 0.18, y + ey / m * 0.18, g.c.ink, { w: 1, head: 5, alpha: clamp(0.25 + m, 0.25, 0.9) }); }
          [[-1.5, p.q1], [1.5, p.q2]].forEach(([cx, q]) => { g.dot(cx, 0, q > 0 ? g.c.a : q < 0 ? g.c.b : g.c.dim, 11, { ring: g.c.ink }); g.text(q > 0 ? '+' : q < 0 ? '−' : '0', cx, 0, '#fff', { a: 'center', s: 14, bold: true }); });
          const [ex, ey] = E2(p, s.x, s.y), m = hypot(ex, ey) || 1, L = min(1.2, 0.3 + m * 0.4);
          g.arrow(s.x, s.y, s.x + ex / m * L, s.y + ey / m * L, g.c.ink, { w: 3 }).dot(s.x, s.y, g.c.panel, 6, { ring: g.c.ink });
        },
        read: (s, p) => { const [ex, ey] = E2(p, s.x, s.y); return [['|E| at probe', num(hypot(ex, ey), 3)], ['potential V', num(p.q1 / max(0.15, hypot(s.x + 1.5, s.y)) + p.q2 / max(0.15, hypot(s.x - 1.5, s.y)), 3)], ['probe', `(${num(s.x, 2)}, ${num(s.y, 2)})`]]; },
        mission: 'Set the charges to +4 and +1. Between them is a point where the fields cancel. Put the probe there (|E| below 0.3).',
        goal: (s, p) => p.q1 === 4 && p.q2 === 1 && abs(s.x) < 1.5 && abs(s.y) < 0.6 && hypot(...E2(p, s.x, s.y)) < 0.3,
        win: (s, p) => { p.q1 = 4; p.q2 = 1; s.x = 0.5; s.y = 0; },
      },
      cards: [
        { q: 'Give the electric field of a point charge and the force on a test charge in that field.', a: '$E = kq/r^2$, directed away from positive charge. Force on a test charge: $F = q_{test}E$.' },
        { q: 'How are electric field and potential related?', a: '$E = −∇V$: the field points down the steepest slope of potential, with magnitude equal to that slope (volts per meter).' },
        { q: 'State Gauss’s law in words.', a: 'The total electric flux out of any closed surface equals the charge enclosed divided by $ε_0$.' },
      ],
      quiz: [
        { q: 'The distance from a point charge triples. The field strength becomes:', choices: ['One third', 'One ninth', 'One sixth', 'Three times larger'], answer: 1, why: 'Inverse square: $1/3^2 = 1/9$.' },
        { q: 'Charges +4 and +1 sit 3 m apart. How far from the +4 charge is the point between them where the field is zero?', num: 2, unit: 'm', tol: 0.03, why: '$4/d^2 = 1/(3 − d)^2$ gives $d/(3 − d) = 2$, so $d = 2$ m.' },
      ],
    },
    {
      id: 'em-magnetism', skill: 'em', title: 'Magnetic force and induction', pre: ['em-electric-field', 'mech-rotation'],
      hook: 'Motors, generators, railguns, mass spectrometers and the antenna in your phone all run on two facts about magnetism.',
      body: [
        '**Fact one: a magnetic field pushes moving charge sideways.** The Lorentz force is',
        { eq: 'F = q·v × B' },
        'always perpendicular to the velocity. It changes direction, never speed, so a charge in a uniform field moves in a circle of radius $r = mv/(qB)$. The same force on current in a wire, $F = I·L × B$, drives every electric motor and accelerates the armature of a railgun.',
        '**Fact two: a changing magnetic field makes an electric field.** Faraday’s law says the voltage induced around a loop equals the rate of change of magnetic flux through it: $EMF = −dΦ/dt$. This is how generators, transformers and receiving loop antennas work.',
        'Put the two facts together with their electric counterparts and you have Maxwell’s equations, whose solutions include self-propagating waves. That is the next lesson.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'v', label: 'Speed v', min: 1, max: 10, step: 0.1, v: 3 },
          { k: 'B', label: 'Field strength B', min: 0.2, max: 3, step: 0.05, v: 1 },
          { k: 'mq', label: 'Mass-to-charge ratio m/q', min: 1, max: 4, step: 0.5, v: 1 },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt; },
        draw(g, s, p) {
          g.view(-1.5, 9, -0.9, 5, { eq: true, pad: [8, 8, 8, 8] });
          for (let x = -1; x <= 8.6; x += 0.8) for (let y = 0.4; y <= 4.8; y += 0.8) { g.circle(x, y, 0.09, g.c.dim, { w: 1, alpha: 0.6 }).dot(x, y, g.c.dim, 1.2); }
          g.line(-1.5, 0, 9, 0, g.c.ink, { w: 2 }).rect(3.85, -0.35, 0.3, 0.35, g.c.good).text('detector', 4, -0.6, g.c.good, { a: 'center', s: 11 });
          g.arrow(0, -0.8, 0, -0.1, g.c.a, { w: 2 });
          const r = p.mq * p.v / p.B, pts = []; for (let i = 0; i <= 60; i++) pts.push([r - r * cos(i / 60 * PI), r * sin(i / 60 * PI)]);
          g.clip(() => { g.path(pts, g.c.a, { w: 2, dash: [5, 4] }); const th = ((s.t * p.v / r) % (PI + 0.6)); if (th <= PI) { const x = r - r * cos(th), y = r * sin(th); g.dot(x, y, g.c.a, 6).arrow(x, y, x + sin(th) * 0.9, y + cos(th) * 0.9, g.c.b, { w: 2 }).arrow(x, y, x + cos(th) * 0.7, y - sin(th) * 0.7, g.c.c, { w: 2 }); } });
          g.note('B points out of the page', 'tr', g.c.dim).note('velocity', 'tr', g.c.b, 1).note('force', 'tr', g.c.c, 2);
        },
        read: (s, p) => { const r = p.mq * p.v / p.B; return [['orbit radius', num(r, 3) + ' m'], ['lands at', num(2 * r, 3) + ' m'], ['orbit period', num(TAU * p.mq / p.B, 3) + ' s']]; },
        mission: 'Steer the particle into the detector 4.0 m from the entry point (±0.1 m).',
        goal: (s, p) => abs(2 * p.mq * p.v / p.B - 4) < 0.1,
        win: { v: 4, B: 2, mq: 1 },
      },
      cards: [
        { q: 'Write the Lorentz magnetic force and describe the motion of a charge in a uniform magnetic field.', a: '$F = qv × B$, perpendicular to velocity. The charge moves in a circle of radius $r = mv/(qB)$ at constant speed.' },
        { q: 'State Faraday’s law of induction.', a: 'The EMF induced around a loop equals minus the rate of change of magnetic flux through it: $EMF = −dΦ/dt$.' },
      ],
      quiz: [
        { q: 'A particle’s speed doubles in a fixed magnetic field. Its orbit radius:', choices: ['Halves', 'Doubles', 'Quadruples', 'Is unchanged'], answer: 1, why: '$r = mv/(qB)$ is proportional to $v$.' },
        { q: 'Why does a magnetic field do no work on a moving charge?', choices: ['The force is too small', 'The force is always perpendicular to the velocity', 'Magnetic fields are conservative', 'The charge is massless'], answer: 1, why: 'Work is $F·v$ per unit time. A force perpendicular to motion changes direction only.' },
      ],
    },
    {
      id: 'em-waves', skill: 'em', title: 'Electromagnetic waves and the inverse-square law', pre: ['em-magnetism', 'em-interference'],
      hook: 'Radar, radio, infrared, light and X-rays are one phenomenon at different wavelengths, and all of them thin out the same way with distance.',
      body: [
        'A changing electric field creates a magnetic field, and a changing magnetic field creates an electric one. The pair sustains itself and travels at $c = 3 × 10^8$ m/s: an **electromagnetic wave**. $E$ and $B$ are perpendicular to each other and to the direction of travel.',
        'The direction of $E$ is the wave’s **polarization**. A receiving antenna tilted by angle $θ$ from the wave’s polarization collects only $cos^2θ$ of the power.',
        'A transmitter radiating power $P$ equally in all directions spreads it over a sphere of area $4πR^2$, so the **power density** is',
        { eq: 'S = P/(4πR^2)   (W/m²)' },
        'Double the range and the power density falls to a quarter. This inverse-square spreading is the first term in every link and radar budget you will write.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'lp', label: 'Transmit power', min: 0, max: 6, step: 0.5, v: 3, fmt: v => num(10 ** v, 3) + ' W' },
          { k: 'lr', label: 'Range', min: 2, max: 5, step: 0.05, v: 3, fmt: v => num(10 ** v / 1000, 3) + ' km' },
          { k: 'pol', label: 'Polarization mismatch', min: 0, max: 90, step: 5, v: 0, unit: '°' },
        ],
        init: () => ({ t: 0 }),
        step(s, p, dt) { s.t += dt * 3; },
        draw(g, s, p) {
          const split = g.w * 0.5;
          g.view(0, 12, -2, 2, { pad: [10, 10, g.w - split, 10] });
          g.arrow(0, 0, 12, 0, g.c.dim, { w: 1 }).text('direction of travel', 11.8, -0.25, g.c.dim, { a: 'right', s: 10.5 });
          for (let x = 0.3; x < 11.6; x += 0.45) { const e = cos(x - s.t) * 1.3; g.arrow(x, 0, x, e, g.c.a, { w: 1.5, head: 5 }).arrow(x, 0, x + e * 0.42, -e * 0.3, g.c.b, { w: 1.5, head: 5 }); }
          g.note('E field', 'tl', g.c.a).note('B field (perpendicular)', 'tl', g.c.b, 1);
          const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');
          g.view(2, 5, -12, 2, { pad: [split + 50, 12, 14, 30] }).axes({ xl: 'range (m)', yl: 'power density (W/m²)', xf: pw, yf: pw, xs: 1, ys: 2 });
          g.fn(lr => p.lp - log10(4 * PI) - 2 * lr + 2 * log10(max(1e-6, cos(rad(p.pol)))), g.c.c, { w: 2.5 });
          g.line(2, -6, 5, -6, g.c.good, { w: 1, dash: [5, 4] }).text('1 µW/m²', 4.95, -5.3, g.c.good, { a: 'right', s: 10.5 });
          g.dot(p.lr, clamp(log10(max(1e-13, dens6(p))), -12, 2), g.c.ink, 6);
        },
        read: (s, p) => [['power density collected', num(dens6(p), 3) + ' W/m²'], ['field strength E', num(sqrt(2 * 377 * dens6(p)), 3) + ' V/m'], ['polarization loss', num(cos(rad(p.pol)) ** 2 * 100, 3) + ' %']],
        mission: 'Deliver 1 µW/m² (±10%) to a receiver more than 5 km away.',
        goal: (s, p) => 10 ** p.lr > 5000 && abs(dens6(p) / 1e-6 - 1) < 0.1,
        win: { lp: 3, lr: 3.95, pol: 0 },
      },
      cards: [
        { q: 'Describe the structure of an electromagnetic wave.', a: 'Oscillating electric and magnetic fields, perpendicular to each other and to the direction of travel, moving at $c = 3 × 10^8$ m/s in vacuum. The E-field direction is the polarization.' },
        { q: 'Give the power density at range $R$ from an isotropic transmitter of power $P$.', a: '$S = P/(4πR^2)$ in W/m². Doubling the range quarters the power density.' },
      ],
      quiz: [
        { q: 'An isotropic source radiates 100 W. What is the power density 10 m away? Give W/m².', num: 0.0796, unit: 'W/m²', tol: 0.002, why: '$100/(4π × 100) = 1/(4π) ≈ 0.0796$ W/m².' },
        { q: 'A receiving antenna is rotated 60° from the wave’s polarization. The fraction of power collected is:', choices: ['50%', '25%', '87%', '0%'], answer: 1, why: '$cos^2 60° = 0.25$.' },
      ],
    },
  ],
};

function alias(p) { return abs(p.f - p.fs * round(p.f / p.fs)); }
function dens6(p) { return 10 ** p.lp / (4 * PI * (10 ** p.lr) ** 2) * cos(rad(p.pol)) ** 2; }
