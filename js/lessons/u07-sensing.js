import { num, rng, clamp } from '../sim.js';
const { sin, cos, PI, sqrt, exp, abs, hypot, max, min, log10, round, atan2 } = Math;
const rad = d => d * PI / 180, TAU = 2 * PI;
const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');
const sinc = x => (abs(x) < 1e-9 ? 1 : sin(PI * x) / (PI * x));

// --- radar range equation (X band, B = 1 MHz, noise figure 3 dB) ---
export const snr = (p, R) => 10 * p.lp + 2 * p.G + 20 * log10(0.03) + p.sig + 10 * p.ln - 30 * log10(4 * PI) - 40 * log10(R) + 141;
const rmax = p => 10 ** ((snr(p, 1) - 13) / 40);

// --- pulse compression: two point targets, 10 us LFM pulse ---
const env = (t, B) => { const T = 10, a = abs(t) / T; return a >= 1 ? 0 : abs((1 - a) * sinc(B * t * (1 - a))); };
export function dip(p) { const dt = p.sep / 150, f = t => hypot(env(t + dt / 2, p.B), env(t - dt / 2, p.B)); let pk = 0; for (let t = -dt; t <= dt; t += dt / 200) pk = max(pk, f(t)); return f(0) / pk; }

// --- phased array factor ---
const af = (p, deg) => { const psi = TAU * p.d * (sin(rad(deg)) - sin(rad(p.st))), den = p.N * sin(psi / 2); return abs(den) < 1e-9 ? 1 : abs(sin(p.N * psi / 2) / den); };
export function worstLobe(p) {
  const bw = 2 * 57.3 / (p.N * p.d * max(0.2, cos(rad(p.st)))); let w = 0;
  for (let a = -90; a <= 90; a += 0.25) if (abs(a - p.st) > bw) w = max(w, af(p, a));
  return 20 * log10(max(1e-6, w));
}

// --- CFAR range profile ---
const CF = (() => { const r = rng(31); return Array.from({ length: 200 }, () => Array.from({ length: 32 }, () => -Math.log(1 - r()))); })();
const TGT = { 40: 30, 130: 200, 180: 40 };
const cellPow = (i, n) => { let m = 0; for (let k = 0; k < n; k++) m += CF[i][k]; return (i >= 100 && i < 160 ? 8 : 1) * m / n + (TGT[i] || 0); };
export function cfar(p) {
  const pow = CF.map((_, i) => cellPow(i, p.n)), thr = pow.map((_, i) => {
    if (p.mode === 'fixed') return 10 ** (p.fix / 10);
    let s = 0, c = 0; for (let k = 3; k <= 2 + p.ref / 2; k++) { if (i - k >= 0) { s += pow[i - k]; c++; } if (i + k < 200) { s += pow[i + k]; c++; } }
    return 10 ** (p.al / 10) * s / c;
  });
  let hit = 0, fa = 0; const det = [];
  pow.forEach((v, i) => { if (v > thr[i]) { det.push(i); if (TGT[i]) hit++; else fa++; } });
  return { pow, thr, det, hit, fa };
}

// --- Planck ---
const planck = (lam, T) => 3.7418e8 / lam ** 5 / (exp(14388 / (lam * T)) - 1);
export const band = (a, b, T) => { let s = 0; const n = 60, h = (b - a) / n; for (let i = 0; i <= n; i++) s += planck(a + i * h, T) * (i === 0 || i === n ? 0.5 : 1); return s * h; };

// --- two-sensor fusion: 2x2 covariances at a target 10 km away ---
function fuseP(p) {
  const sr = 20, sc = 1e4 * rad(p.raz), P1 = [[sr * sr, 0], [0, sc * sc]];
  const a = rad(p.geo), l = 5000, c2 = 1e4 * rad(p.ir), ca = cos(a), sa = sin(a);
  const P2 = [[l * l * ca * ca + c2 * c2 * sa * sa, (l * l - c2 * c2) * ca * sa], [(l * l - c2 * c2) * ca * sa, l * l * sa * sa + c2 * c2 * ca * ca]];
  const inv = M => { const d = M[0][0] * M[1][1] - M[0][1] * M[1][0]; return [[M[1][1] / d, -M[0][1] / d], [-M[1][0] / d, M[0][0] / d]]; };
  const I1 = inv(P1), I2 = inv(P2), Pf = inv([[I1[0][0] + I2[0][0], I1[0][1] + I2[0][1]], [I1[1][0] + I2[1][0], I1[1][1] + I2[1][1]]]);
  const det = M => M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return { P1, P2, Pf, ratio: sqrt(det(Pf) / det(P1)) };
}
const ellipse = (P, n = 1) => { const tr = (P[0][0] + P[1][1]) / 2, dc = sqrt(max(0, tr * tr - (P[0][0] * P[1][1] - P[0][1] * P[1][0]))), a = sqrt(tr + dc) * n, b = sqrt(max(1e-9, tr - dc)) * n, th = 0.5 * atan2(2 * P[0][1], P[0][0] - P[1][1]), pts = []; for (let i = 0; i <= 72; i++) { const t = i / 36 * PI; pts.push([a * cos(t) * cos(th) - b * sin(t) * sin(th), a * cos(t) * sin(th) + b * sin(t) * cos(th)]); } return pts; };

export default {
  id: 'u07', title: 'Sensing', blurb: 'Radar, antennas, infrared and fusing sensors.',
  lessons: [
    {
      id: 'radar-range-equation', skill: 'radar', title: 'The radar range equation', pre: ['em-waves', 'detect-threshold'],
      hook: 'One equation decides how far a radar can see. Its fourth root explains why stealth is hard and why it still works.',
      body: [
        'A radar sends power $P_t$ through an antenna of gain $G$. The power density spreads as $1/4πR^2$ on the way out. The target intercepts some and reradiates it as if it had area $σ$, its **radar cross-section**. That echo spreads as $1/4πR^2$ again on the way back, and the antenna collects it.',
        { eq: 'P_r = P_t·G^2·λ^2·σ / ((4π)^3·R^4)' },
        'Two-way spreading gives the famous **fourth-power law**. Doubling the range costs a factor of 16 (12 dB) in echo power. Turned around, detection range grows only as the fourth root of anything you improve: sixteen times the transmitter power buys twice the range.',
        'The same root protects a low-observable target only partly. Cutting $σ$ by a factor of 100 shrinks detection range by $100^{1/4} ≈ 3.2$. The radar designer answers with antenna gain (which counts twice) and by integrating many pulses.',
        'Detection needs the echo to beat receiver noise $kTBF$ by roughly 13 dB.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'lp', label: 'Peak power', min: 3, max: 6, step: 0.1, v: 5, fmt: v => num(10 ** v / 1000, 3) + ' kW' },
          { k: 'G', label: 'Antenna gain', min: 20, max: 45, step: 1, v: 35, unit: 'dB' },
          { k: 'sig', label: 'Target cross-section', min: -30, max: 20, step: 1, v: 0, unit: 'dBsm' },
          { k: 'ln', label: 'Pulses integrated', min: 0, max: 3, step: 0.1, v: 0, fmt: v => num(round(10 ** v), 4) },
        ],
        draw(g, s, p) {
          g.view(3, 6, -30, 70).axes({ xl: 'range (m)', yl: 'signal-to-noise (dB)', xf: pw, xs: 1, ys: 20 });
          g.rect(3, -30, 3, 43, g.c.bad, { fa: 0.07 });
          g.line(3, 13, 6, 13, g.c.bad, { w: 1.5, dash: [6, 4] }).text('detection threshold 13 dB', 3.05, 17, g.c.bad, { s: 11 });
          g.fn(lr => snr(p, 10 ** lr), g.c.a, { w: 2.5 });
          g.line(5, -30, 5, 70, g.c.dim, { w: 1, dash: [3, 4] }).text('100 km', 5.02, 64, g.c.dim, { s: 11 });
          const lr = log10(rmax(p)); if (lr > 3 && lr < 6) g.dot(lr, 13, g.c.ink, 6);
          g.note('slope: −12 dB per doubling of range', 'tr', g.c.a);
        },
        read: (s, p) => [['detection range', num(rmax(p) / 1000, 3) + ' km'], ['SNR at 100 km', num(snr(p, 1e5), 3) + ' dB'], ['cross-section', num(10 ** (p.sig / 10), 2) + ' m²']],
        mission: 'Detect a −20 dBsm target (0.01 m²) or smaller at 100 km without exceeding 250 kW of peak power.',
        goal: (s, p) => p.sig <= -20 && 10 ** p.lp <= 252000 && snr(p, 1e5) >= 13,
        win: { lp: 5.4, G: 45, sig: -20, ln: 2 },
      },
      cards: [
        { q: 'Write the radar range equation for received power.', a: '$P_r = P_t G^2 λ^2 σ/((4π)^3 R^4)$.' },
        { q: 'Why does echo power fall as $R^4$, and what does that imply for extending detection range?', a: 'The signal spreads as $1/R^2$ going out and again coming back. Range grows only as the fourth root of power, cross-section or integration: 16× the power doubles the range.' },
        { q: 'What is radar cross-section?', a: 'The effective area $σ$ (m², often in dBsm) that describes how strongly a target reflects radar energy back toward the radar. It depends on shape, material, aspect and wavelength, not just size.' },
      ],
      quiz: [
        { q: 'A target’s radar cross-section is reduced by a factor of 10,000 (40 dB). Detection range falls by a factor of:', num: 10, tol: 0.1, why: '$10{,}000^{1/4} = 10$.' },
        { q: 'A radar detects a target at 80 km. With 16 times the transmitted power and nothing else changed, the range becomes:', num: 160, unit: 'km', tol: 2, why: '$16^{1/4} = 2$, so the range doubles to 160 km.' },
      ],
    },
    {
      id: 'radar-range-doppler', skill: 'radar', title: 'Measuring range and speed: the PRF dilemma', pre: ['radar-range-equation', 'dsp-sampling', 'linalg-vectors'],
      hook: 'A pulsed radar samples the world at its pulse rate, so it aliases. It must choose between knowing how far and knowing how fast.',
      body: [
        '**Range** comes from echo delay: $R = c·t/2$. **Radial velocity** comes from the Doppler shift of the echo: $f_d = 2v_r/λ$.',
        'The radar sends pulses at the **pulse repetition frequency** (PRF). An echo that returns after the next pulse has left is credited to the wrong pulse and appears at a false, shorter range. And Doppler is sampled once per pulse, so shifts beyond ±PRF/2 alias exactly as in the sampling lesson.',
        { eq: 'R_{unamb} = c/(2·PRF),   v_{unamb} = ±λ·PRF/4' },
        'Raising the PRF fixes velocity and ruins range; lowering it does the opposite. Their product is fixed by the wavelength. Radars cope by choosing a regime (low, medium or high PRF) and by switching between several PRFs and solving for the one answer consistent with all of them.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'lprf', label: 'Pulse repetition frequency', min: -0.3, max: 2, step: 0.05, v: 0, fmt: v => num(10 ** v, 3) + ' kHz' },
          { k: 'R', label: 'True target range', min: 5, max: 200, step: 5, v: 120, unit: 'km' },
          { k: 'v', label: 'True closing speed', min: 0, max: 600, step: 10, v: 300, unit: 'm/s' },
        ],
        draw(g, s, p) {
          const m = prf(p);
          g.view(0, 3, 0, 1.2, { pad: [14, 26, 14, 172] });
          g.text('Time: pulses sent (dark) and echoes received (orange)', 0, 1.2, g.c.dim, { s: 11, mono: false, b: 'bottom' });
          g.line(0, 0, 3, 0, g.c.dim, { w: 1 });
          for (let k = 0; k <= 3; k++) { g.rect(k, 0, 0.03, 1, g.c.ink); const e = k + p.R / m.Ru; if (e < 3) { g.rect(e, 0, 0.03, 0.55, g.c.a); g.path([[k + 0.015, 1.02], [(k + e) / 2, 1.12], [e + 0.015, 0.58]], g.c.a, { w: 1, dash: [3, 3] }); } }
          g.text(m.rOK ? 'echo returns before the next pulse' : 'echo arrives after later pulses: range is ambiguous', 3, 0.85, m.rOK ? g.c.good : g.c.bad, { a: 'right', s: 11, bg: true });
          g.view(-0.5, 0.5, 0, 1.2, { pad: [14, g.h - 140, 14, 34] }).axes({ xl: 'Doppler frequency ÷ PRF', yt: false, grid: false });
          g.text('Doppler: true shift (grey) folds into ±PRF/2', -0.5, 1.2, g.c.dim, { s: 11, mono: false, b: 'bottom' });
          const fd = m.fd / m.PRF, fa = fd - round(fd);
          g.line(fa, 0, fa, 0.9, m.vOK ? g.c.good : g.c.bad, { w: 4 });
          g.text(m.vOK ? 'unaliased' : `aliased: true shift is ${num(fd, 3)} × PRF`, fa, 1.02, m.vOK ? g.c.good : g.c.bad, { a: fa > 0 ? 'right' : 'left', s: 11 });
        },
        read: (s, p) => { const m = prf(p); return [['unambiguous range', num(m.Ru, 3) + ' km'], ['apparent range', num(p.R % m.Ru, 3) + ' km'], ['unambiguous speed', '±' + num(m.vu, 3) + ' m/s'], ['apparent speed', num(m.va, 3) + ' m/s']]; },
        mission: 'The target is at 120 km closing at 300 m/s. Choose a PRF that reports its speed correctly, then read what that did to range.',
        goal: (s, p) => p.R === 120 && p.v === 300 && prf(p).vOK,
        win: { lprf: 1.65 },
      },
      cards: [
        { q: 'How does a radar measure range and radial velocity?', a: 'Range from echo delay: $R = ct/2$. Radial velocity from Doppler shift: $f_d = 2v_r/λ$.' },
        { q: 'Give the unambiguous range and unambiguous velocity of a pulsed radar, and state the dilemma.', a: '$R_{unamb} = c/(2·PRF)$ and $v_{unamb} = ±λ·PRF/4$. High PRF gives unambiguous velocity but ambiguous range; low PRF gives the reverse.' },
      ],
      quiz: [
        { q: 'A radar uses a PRF of 1,500 Hz. What is its unambiguous range in km?', num: 100, unit: 'km', tol: 1, why: '$c/(2·PRF) = 3 × 10^8/3000 = 10^5$ m = 100 km.' },
        { q: 'A 10 GHz radar (λ = 3 cm) sees a target closing at 450 m/s. What is the Doppler shift in kHz?', num: 30, unit: 'kHz', tol: 0.3, why: '$f_d = 2v/λ = 900/0.03 = 30{,}000$ Hz.' },
      ],
    },
    {
      id: 'radar-pulse-compression', skill: 'radar', title: 'Pulse compression and the matched filter', pre: ['radar-range-doppler', 'fourier-transform', 'dsp-convolution'],
      hook: 'Long pulses carry energy; short pulses give resolution. A chirp, and the filter matched to it, delivers both.',
      body: [
        'Detection depends on pulse **energy**, so radars want long pulses. Resolution depends on **bandwidth**, and a plain long pulse has almost none. The way out is to add bandwidth by modulating inside the pulse.',
        'The classic choice is the linear FM **chirp**: frequency sweeps across a bandwidth $B$ during a pulse of length $T$. The receiver correlates the echo with a copy of what was sent. This **matched filter** is the filter that maximizes SNR for a known waveform.',
        { eq: 'compressed width ≈ 1/B,   processing gain = T·B' },
        'A 10 µs pulse alone resolves 1,500 m. Swept over 10 MHz it resolves 15 m and gains a factor $TB$ = 100 (20 dB) in peak SNR, while the transmitter still sends the long, low-peak-power pulse.',
        'The compressed pulse is sinc-shaped, with range sidelobes 13 dB down that are usually tamed with a window, at a small cost in resolution.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'B', label: 'Chirp bandwidth B', min: 0.5, max: 20, step: 0.5, v: 1, unit: 'MHz' },
          { k: 'sep', label: 'Target separation', min: 10, max: 300, step: 5, v: 60, unit: 'm' },
        ],
        draw(g, s, p) {
          const dt = p.sep / 150;
          g.view(-8, 8, -1.3, 1.3, { pad: [40, 24, 14, 176] }).axes({ yt: false, xt: false });
          g.text('Received: two overlapping 10 µs chirps', -8, 1.3, g.c.dim, { s: 11, mono: false, b: 'bottom' });
          const ch = (t, t0) => (abs(t - t0) <= 5 ? cos(PI * min(p.B, 4) / 10 * (t - t0) ** 2) : 0);
          g.fn(t => ch(t, -dt / 2), g.c.b, { w: 1.2, n: 900, alpha: 0.8 }).fn(t => ch(t, dt / 2), g.c.c, { w: 1.2, n: 900, alpha: 0.8 });
          const z = max(1.2, dt * 2.2, 3 / p.B);
          g.view(-z, z, 0, 1.6, { pad: [40, g.h - 150, 14, 30] }).axes({ xl: 'delay (µs)', yl: 'matched filter output', yt: false });
          g.fn(t => hypot(env(t + dt / 2, p.B), env(t - dt / 2, p.B)), g.c.a, { w: 2.5, n: 900 });
          g.line(-dt / 2, 0, -dt / 2, 1.5, g.c.b, { w: 1, dash: [3, 3] }).line(dt / 2, 0, dt / 2, 1.5, g.c.c, { w: 1, dash: [3, 3] });
          g.note(dip(p) < 0.8 ? 'two targets resolved' : 'targets merge into one', 'tr', dip(p) < 0.8 ? g.c.good : g.c.bad);
        },
        read: (s, p) => [['range resolution c/2B', num(150 / p.B, 3) + ' m'], ['uncompressed', '1,500 m'], ['processing gain T·B', num(10 * p.B, 3) + ' (' + num(10 * log10(10 * p.B), 3) + ' dB)'], ['dip between peaks', num(dip(p) * 100, 3) + ' %']],
        mission: 'Resolve two targets 15 m apart or closer (dip below 80% of the peaks) without shortening the pulse.',
        goal: (s, p) => p.sep <= 15 && dip(p) < 0.8,
        win: { B: 12.5, sep: 15 },
      },
      cards: [
        { q: 'What problem does pulse compression solve, and how?', a: 'It separates energy from resolution. A long pulse (high energy) is modulated across a wide bandwidth, typically a chirp, and the receiver’s matched filter compresses it to a width of about $1/B$.' },
        { q: 'What is a matched filter?', a: 'A filter that correlates the received signal with a replica of the transmitted waveform. It gives the highest possible output SNR for a known signal in white noise.' },
        { q: 'Give the processing gain and range resolution of a chirp with duration $T$ and bandwidth $B$.', a: 'Processing gain = $TB$ (time-bandwidth product). Range resolution = $c/2B$.' },
      ],
      quiz: [
        { q: 'A chirp lasts 20 µs and sweeps 50 MHz. What is its processing gain in dB?', num: 30, unit: 'dB', tol: 0.2, why: '$TB = 20 × 10^{−6} × 50 × 10^6 = 1000$, which is 30 dB.' },
        { q: 'After pulse compression, range resolution depends on:', choices: ['Pulse duration only', 'Bandwidth only', 'Peak power', 'PRF'], answer: 1, why: '$ΔR = c/2B$. The pulse length sets energy; bandwidth sets resolution.' },
      ],
      code: {
        prompt: 'Complete `find_delay(rx, replica)`: slide `replica` along `rx` with `np.correlate(..., mode="valid")` and return the sample index where the magnitude of the correlation peaks. That index is the echo delay.',
        starter: 'import numpy as np\n\ndef find_delay(rx, replica):\n    return 0  # replace\n\nt = np.arange(200) / 200\nchirp = np.cos(2 * np.pi * (5 * t + 40 * t ** 2))\nrx = np.zeros(1000)\nrx[321:521] += chirp\nprint(find_delay(rx, chirp))',
        solution: 'import numpy as np\n\ndef find_delay(rx, replica):\n    out = np.correlate(rx, replica, mode="valid")\n    return int(np.argmax(np.abs(out)))\n\nt = np.arange(200) / 200\nchirp = np.cos(2 * np.pi * (5 * t + 40 * t ** 2))\nrx = np.zeros(1000)\nrx[321:521] += chirp\nprint(find_delay(rx, chirp))',
        tests: 'import numpy as np\n_t = np.arange(200) / 200\n_c = np.cos(2 * np.pi * (5 * _t + 40 * _t ** 2))\n_rng = np.random.default_rng(0)\n_rx = _rng.normal(0, 1.0, 1000)\n_rx[321:521] += _c\nassert find_delay(_rx, _c) == 321, f"expected 321, got {find_delay(_rx, _c)} (the echo is buried in noise of equal amplitude)"\n_rx2 = np.zeros(600); _rx2[77:277] -= _c\nassert find_delay(_rx2, _c) == 77, "use the magnitude: an inverted echo still counts"',
        hint: '`out = np.correlate(rx, replica, mode="valid")`, then `int(np.argmax(np.abs(out)))`.',
      },
    },
    {
      id: 'rf-antennas', skill: 'rf', title: 'Antennas: aperture, gain and beamwidth', pre: ['em-waves', 'fourier-transform', 'em-interference'],
      hook: 'An antenna does not create power. It decides where the power goes, and how big it is in wavelengths decides how tightly.',
      body: [
        'An antenna’s **gain** $G$ is how much more power density it sends in its best direction than an isotropic radiator would. Gain comes from concentration: the same power into a smaller solid angle.',
        'For an aperture of diameter $D$, two rules of thumb do most of the work:',
        { eq: 'θ_{3dB} ≈ 70°·λ/D,   G = η·(πD/λ)^2', where: '$η$ ≈ 0.6 is aperture efficiency' },
        'The beam pattern is the Fourier transform of the field across the aperture, the same mathematics as the pulse and its spectrum. A uniformly lit aperture gives a sinc-shaped pattern with −13 dB sidelobes; tapering the illumination lowers them and widens the main beam.',
        'Because gain goes as $(D/λ)^2$, doubling the frequency on the same dish buys 6 dB. High frequencies give sharp beams from small antennas, and they pay in atmospheric loss and tighter tolerances.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'D', label: 'Aperture diameter D', min: 0.1, max: 5, step: 0.05, v: 0.5, unit: 'm' },
          { k: 'f', label: 'Frequency', min: 1, max: 40, step: 1, v: 10, unit: 'GHz' },
        ],
        draw(g, s, p) {
          const lam = 0.3 / p.f, bw = 70 * lam / p.D, zoom = clamp(bw * 6, 4, 90);
          g.view(-zoom, zoom, -50, 3).axes({ xl: 'angle off boresight (°)', yl: 'relative gain (dB)', ys: 10 });
          g.fn(a => max(-60, 20 * log10(abs(sinc(p.D / lam * sin(rad(a)))) + 1e-6)), g.c.a, { w: 2.5, n: 1000 });
          g.line(-zoom, -3, zoom, -3, g.c.dim, { w: 1, dash: [4, 4] }).line(-bw / 2, -50, -bw / 2, -3, g.c.b, { w: 1.5 }).line(bw / 2, -50, bw / 2, -3, g.c.b, { w: 1.5 });
          g.text('3 dB beamwidth', 0, -46, g.c.b, { a: 'center', s: 11 }).note('first sidelobes −13 dB', 'tr', g.c.dim);
        },
        read: (s, p) => { const lam = 0.3 / p.f; return [['wavelength', num(lam * 100, 3) + ' cm'], ['aperture in wavelengths', num(p.D / lam, 3)], ['gain', num(agai(p), 3) + ' dB'], ['beamwidth', num(70 * lam / p.D, 3) + '°']]; },
        mission: 'At 10 GHz, find the smallest dish (to within 0.1 m) that gives at least 40 dB of gain.',
        goal: (s, p) => p.f === 10 && agai(p) >= 40 && agai({ D: p.D - 0.1, f: 10 }) < 40,
        win: { D: 1.25, f: 10 },
      },
      cards: [
        { q: 'Give the rule-of-thumb beamwidth and the gain of an aperture antenna of diameter $D$.', a: '$θ_{3dB} ≈ 70°λ/D$ and $G = η(πD/λ)^2$ with efficiency $η$ around 0.6.' },
        { q: 'How is an antenna’s far-field pattern related to the field across its aperture?', a: 'It is the Fourier transform of the aperture illumination. Uniform illumination gives a sinc pattern with −13 dB sidelobes; tapering lowers sidelobes and widens the beam.' },
      ],
      quiz: [
        { q: 'A dish is used at twice the frequency. Its gain changes by:', choices: ['+3 dB', '+6 dB', '−6 dB', 'No change'], answer: 1, why: '$G ∝ (D/λ)^2$. Halving λ quadruples the gain: 6 dB.' },
        { q: 'What is the 3 dB beamwidth of a 2.1 m dish at λ = 3 cm? Give degrees.', num: 1, unit: '°', tol: 0.03, why: '$70 × 0.03/2.1 = 1.0°$.' },
      ],
    },
    {
      id: 'rf-phased-arrays', skill: 'rf', title: 'Phased arrays: steering without moving', pre: ['rf-antennas', 'em-interference', 'fourier-phasors'],
      hook: 'A modern radar face has thousands of small elements and no moving parts. It can look in a new direction every few microseconds.',
      body: [
        'Line up $N$ antenna elements a distance $d$ apart and feed each with a slightly later phase than its neighbor. The wavefronts add up in a tilted direction. Changing that phase step re-aims the beam electronically:',
        { eq: 'Δφ = 2π·(d/λ)·sin θ_0', where: 'phase step between neighbors for steering angle $θ_0$' },
        'The array samples the aperture in space, and spatial sampling can alias too. If elements are too far apart, a second full-strength beam appears: a **grating lobe**. Avoiding it requires',
        { eq: 'd/λ ≤ 1/(1 + |sin θ_{max}|)' },
        'which is the reason for the familiar half-wavelength spacing. Steering away from broadside also widens the beam by $1/cos θ_0$, because the array looks shorter from the side.',
        'The phasor row under the plot shows the phase applied to each element.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'N', label: 'Elements N', min: 4, max: 32, step: 1, v: 16 },
          { k: 'd', label: 'Spacing d/λ', min: 0.3, max: 1.5, step: 0.05, v: 1 },
          { k: 'st', label: 'Steering angle', min: -60, max: 60, step: 1, v: 0, unit: '°' },
        ],
        draw(g, s, p) {
          g.view(-90, 90, -40, 3, { pad: [44, 12, 14, 76] }).axes({ xl: 'angle (°)', yl: 'array pattern (dB)', xs: 30, ys: 10 });
          g.fn(a => max(-60, 20 * log10(af(p, a) + 1e-6)), g.c.a, { w: 2.2, n: 1400 });
          g.line(p.st, -40, p.st, 3, g.c.b, { w: 1, dash: [4, 4] }).line(-90, -10, 90, -10, g.c.dim, { w: 1, dash: [2, 4] });
          g.view(-0.5, p.N - 0.5, -1, 1, { pad: [44, g.h - 40, 14, 6] });
          for (let i = 0; i < p.N; i++) { const ph = -TAU * p.d * sin(rad(p.st)) * i, r = min(0.42, 0.42 * 16 / p.N * 1); g.circle(i, 0, 0.36, g.c.grid, { w: 1 }); g.arrow(i, 0, i + 0.36 * cos(ph), 0.9 * sin(ph), g.c.b, { w: 1.5, head: 5 }); }
        },
        read: (s, p) => [['phase step per element', num(((360 * p.d * sin(rad(p.st))) % 360 + 360) % 360, 3) + '°'], ['beamwidth', num(50.8 / (p.N * p.d * cos(rad(p.st))), 3) + '°'], ['worst lobe outside the main beam', num(worstLobe(p), 3) + ' dB']],
        mission: 'Steer to 40° with 16 or more elements while keeping every other lobe below −10 dB.',
        goal: (s, p) => p.N >= 16 && p.st === 40 && worstLobe(p) < -10,
        win: { N: 16, d: 0.5, st: 40 },
      },
      cards: [
        { q: 'What phase step between neighboring elements steers a phased array to angle $θ_0$?', a: '$Δφ = 2π(d/λ) sinθ_0$.' },
        { q: 'What is a grating lobe and what element spacing avoids it?', a: 'A second full-strength beam caused by spatial aliasing when elements are too far apart. Avoid it with $d/λ ≤ 1/(1 + |sinθ_{max}|)$; half a wavelength is safe for any scan angle.' },
        { q: 'What happens to a phased array’s beam as it is steered far off broadside?', a: 'It broadens by about $1/cosθ_0$ (the projected aperture shrinks), and gain falls correspondingly.' },
      ],
      quiz: [
        { q: 'An array must scan to ±30° with no grating lobes. What is the largest spacing $d/λ$?', num: 0.667, tol: 0.01, why: '$1/(1 + sin 30°) = 1/1.5 ≈ 0.667$.' },
        { q: 'Elements are spaced λ/2. What phase step steers the beam to 30°? Give degrees.', num: 90, unit: '°', tol: 0.5, why: '$360° × 0.5 × sin 30° = 90°$.' },
      ],
    },
    {
      id: 'detect-cfar', skill: 'detect', title: 'Integration and adaptive thresholds', pre: ['detect-threshold', 'radar-pulse-compression', 'prob-estimation'],
      hook: 'Noise is not the same everywhere. Rain, sea, terrain and jamming raise the floor in patches, and a fixed threshold drowns in false alarms.',
      body: [
        'A fixed threshold assumes a known noise level. Real radars see a floor that changes with range, angle and time. Set the threshold for the quiet region and clutter floods the display; set it for the clutter and weak targets in the quiet region are missed.',
        '**CFAR** (constant false alarm rate) detection estimates the local floor for every cell from its neighbors. In cell-averaging CFAR the threshold is',
        { eq: 'T = α × (mean power of the reference cells around the cell under test)' },
        'A few guard cells beside the test cell are skipped so a target does not raise its own threshold. The multiplier $α$ sets the false alarm rate, whatever the floor happens to be.',
        '**Integration** attacks the problem from the other side. Averaging $n$ pulses does not lower the mean noise but shrinks its fluctuation by $√n$, so the threshold can sit closer to the floor.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'mode', type: 'select', label: 'Detector', v: 'fixed', options: [['fixed', 'Fixed threshold'], ['cfar', 'Cell-averaging CFAR']] },
          { k: 'fix', label: 'Fixed threshold', min: 0, max: 30, step: 0.5, v: 12, unit: 'dB' },
          { k: 'al', label: 'CFAR multiplier α', min: 3, max: 20, step: 0.5, v: 6, unit: 'dB' },
          { k: 'ref', label: 'CFAR reference cells', min: 4, max: 32, step: 4, v: 16 },
          { k: 'n', label: 'Pulses integrated', min: 1, max: 32, step: 1, v: 1 },
        ],
        draw(g, s, p) {
          const r = cfar(p), db = v => 10 * log10(max(1e-3, v));
          g.view(0, 200, -12, 30).axes({ xl: 'range cell', yl: 'power (dB)', xs: 25, ys: 10 });
          g.rect(100, -12, 60, 42, g.c.dim, { fa: 0.1 }).text('clutter', 130, 27.5, g.c.dim, { a: 'center', s: 10.5 });
          g.clip(() => { g.path(r.pow.map((v, i) => [i, db(v)]), g.c.b, { w: 1.3 }); g.path(r.thr.map((v, i) => [i, db(v)]), g.c.a, { w: 2 }); r.det.forEach(i => g.dot(i, min(29, db(r.pow[i])), TGT[i] ? g.c.good : g.c.bad, 5)); });
          Object.keys(TGT).forEach(i => g.text('▼', +i, -10.3, g.c.good, { a: 'center', s: 10 }));
          g.note('threshold', 'tl', g.c.a).note('▼ true target positions', 'bl', g.c.good);
        },
        read: (s, p) => { const r = cfar(p); return [['targets found', r.hit + ' of 3'], ['false alarms', r.fa]]; },
        mission: 'Find all three targets with zero false alarms.',
        goal: (s, p) => { const r = cfar(p); return r.hit === 3 && r.fa === 0; },
        win: { mode: 'cfar', al: 10, ref: 16, n: 4 },
      },
      cards: [
        { q: 'How does a cell-averaging CFAR detector set its threshold?', a: 'For each cell it averages the power in surrounding reference cells (skipping guard cells) to estimate the local noise floor, then multiplies by a constant $α$ chosen for the desired false alarm rate.' },
        { q: 'Why use CFAR instead of a fixed threshold?', a: 'The noise and clutter floor varies with range, angle and time. A fixed threshold gives too many false alarms where the floor is high or misses targets where it is low; CFAR keeps the false alarm rate constant.' },
        { q: 'What does integrating $n$ pulses do to the noise?', a: 'It leaves the mean level unchanged but reduces its fluctuation by about $√n$, so the threshold can be set closer to the floor and weaker targets are detected.' },
      ],
      quiz: [
        { q: 'Why does CFAR skip "guard cells" next to the cell under test?', choices: ['To save computation', 'So energy from a target spilling into neighbors does not inflate its own threshold', 'Guard cells are always noisy', 'To increase the false alarm rate'], answer: 1, why: 'A target’s energy leaks into adjacent cells. Including them in the noise estimate would raise the threshold and mask the target.' },
        { q: 'Two targets sit a few cells apart. A cell-averaging CFAR may:', choices: ['Detect both more easily', 'Miss one, because each raises the other’s threshold', 'Raise the false alarm rate', 'Be unaffected'], answer: 1, why: 'Each target lies in the other’s reference window and inflates its noise estimate. Ordered-statistic CFAR variants address this.' },
      ],
    },
    {
      id: 'eoir-blackbody', skill: 'eoir', title: 'Infrared: everything glows', pre: ['em-waves', 'calc-integral'],
      hook: 'A warm engine, a rocket plume and a person all broadcast in the infrared without any transmitter. A passive sensor just has to look in the right band.',
      body: [
        'Any object above absolute zero emits electromagnetic radiation. For an ideal emitter (a **blackbody**) the spectrum depends only on temperature, described by Planck’s law. Two results summarize it:',
        { eq: 'λ_{peak} = 2898/T  µm,   M = σ·T^4  W/m²', where: 'Wien’s displacement law and the Stefan–Boltzmann law' },
        'Hotter objects emit far more in total, and their peak moves to shorter wavelengths. A 300 K vehicle or person peaks near 10 µm. A 700 K exhaust pipe peaks near 4 µm. A 1,500 K plume peaks near 2 µm.',
        'The atmosphere is opaque over much of the infrared. Sensors work in its windows: **SWIR** 1–2.5 µm, **MWIR** 3–5 µm and **LWIR** 8–12 µm. Hot targets stand out in MWIR; room-temperature scenes are brightest in LWIR. Real surfaces emit a fraction $ε$ (the emissivity) of the blackbody amount, which is why polished metal looks cold to a thermal camera.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'T', label: 'Temperature', min: 250, max: 3000, step: 5, v: 300, unit: 'K' }],
        draw(g, s, p) {
          g.view(log10(0.3), log10(30), -1, 7).axes({ xl: 'wavelength (µm)', yl: 'spectral exitance (W/m²/µm)', xf: v => num(10 ** v, 2), yf: pw, xs: 0.5, ys: 2 });
          [[0.4, 0.7, 'visible', g.c.d], [1, 2.5, 'SWIR', g.c.c], [3, 5, 'MWIR', g.c.a], [8, 12, 'LWIR', g.c.b]].forEach(([a, b, n, c]) => { g.rect(log10(a), -1, log10(b / a), 8, c, { fa: 0.13 }); g.text(n, (log10(a) + log10(b)) / 2, 6.6, c, { a: 'center', s: 10.5 }); });
          g.fn(l => log10(max(1e-3, planck(10 ** l, 300))), g.c.dim, { w: 1.2, dash: [4, 4] });
          g.fn(l => log10(max(1e-3, planck(10 ** l, p.T))), g.c.ink, { w: 2.5 });
          const lp = 2898 / p.T; g.dot(log10(lp), clamp(log10(planck(lp, p.T)), -1, 7), g.c.a, 6);
          g.note('dashed: 300 K for reference', 'bl', g.c.dim);
        },
        read: (s, p) => [['peak wavelength', num(2898 / p.T, 3) + ' µm'], ['total exitance σT⁴', num(5.67e-8 * p.T ** 4, 3) + ' W/m²'], ['MWIR (3–5 µm)', num(band(3, 5, p.T), 3) + ' W/m²'], ['LWIR (8–12 µm)', num(band(8, 12, p.T), 3) + ' W/m²']],
        mission: 'Find the temperature at which an object emits equally in the MWIR and LWIR bands (within 5%).',
        goal: (s, p) => abs(band(3, 5, p.T) / band(8, 12, p.T) - 1) < 0.05,
        win: { T: 580 },
      },
      cards: [
        { q: 'State Wien’s displacement law and the Stefan–Boltzmann law.', a: '$λ_{peak} = 2898/T$ µm (peak emission wavelength). Total emitted power per area $M = σT^4$, with $σ = 5.67 × 10^{−8}$ W/m²K⁴.' },
        { q: 'Name the three infrared atmospheric windows and what each is best suited to.', a: 'SWIR 1–2.5 µm (reflected light, very hot sources), MWIR 3–5 µm (hot targets such as engines and plumes), LWIR 8–12 µm (room-temperature scenes and people).' },
        { q: 'What is emissivity?', a: 'The ratio $ε$ (0 to 1) of a surface’s thermal emission to that of a blackbody at the same temperature. Shiny metals have low emissivity and appear cooler to a thermal sensor.' },
      ],
      quiz: [
        { q: 'At what wavelength does a 966 K exhaust plume emit most strongly? Give µm.', num: 3, unit: 'µm', tol: 0.05, why: '$2898/966 = 3.0$ µm, at the edge of the MWIR window.' },
        { q: 'A surface warms from 300 K to 600 K. Its total radiated power rises by a factor of:', num: 16, tol: 0.2, why: '$M ∝ T^4$ and $2^4 = 16$.' },
      ],
    },
    {
      id: 'eoir-optics', skill: 'eoir', title: 'Resolution: the diffraction limit', pre: ['eoir-blackbody', 'rf-antennas'],
      hook: 'No amount of pixels or processing recovers detail the aperture never collected. The limit is set by wavelength over diameter.',
      body: [
        'Light passing through a circular aperture of diameter $D$ spreads by diffraction. A point source images as a small blur disc, and two points closer than the **Rayleigh criterion** merge:',
        { eq: 'θ = 1.22·λ/D   (radians)' },
        'It is the antenna beamwidth formula again. From altitude $h$ the smallest ground detail is about $1.22·λh/D$. That is the best case; the detector must also sample finely enough, with at least two pixels across the blur, and atmospheric turbulence and platform jitter must be smaller still.',
        'Wavelength matters enormously. A 10 µm thermal image needs an aperture about 18 times larger than a 0.55 µm visible image for the same resolution. That is why thermal imagery from orbit is so much coarser than visible imagery.',
        'The lab images a row of bars, 0.5 m wide with 0.5 m gaps, from 500 km.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'D', label: 'Aperture diameter', min: 0.1, max: 2.5, step: 0.05, v: 0.3, unit: 'm' },
          { k: 'lam', type: 'select', label: 'Band', v: 0.55, options: [[0.55, 'Visible 0.55 µm'], [4, 'MWIR 4 µm'], [10, 'LWIR 10 µm']] },
        ],
        draw(g, s, p) {
          const res = gres(p), sg = 0.42 * res / 1.22 * 1.0, mod = exp(-2 * PI * PI * sg * sg);
          const img = x => 0.5 + 0.5 * mod * cos(TAU * x) * (abs(x) < 4.25 ? 1 : 0) - (abs(x) >= 4.25 ? 0.5 * (1 - exp(-((abs(x) - 4.25) ** 2) / (2 * sg * sg + 1e-6))) : 0);
          g.view(-6, 6, 0, 1, { pad: [14, 26, 14, 150] });
          g.text('Image of 0.5 m bars from 500 km', -6, 1, g.c.dim, { s: 11, mono: false, b: 'bottom' });
          for (let i = 0; i < 240; i++) { const x = -6 + (i + 0.5) / 20; g.rect(-6 + i / 20, 0, 1 / 20 + 0.004, 1, g.ramp(clamp(img(x), 0, 1))); }
          g.view(-6, 6, 0, 1.1, { pad: [44, g.h - 130, 14, 30] }).axes({ xl: 'ground distance (m)', yl: 'brightness' });
          g.fn(x => clamp(img(x), 0, 1), g.c.a, { w: 2.2, n: 800 });
        },
        read: (s, p) => { const res = gres(p), sg = 0.42 * res / 1.22; return [['diffraction-limited ground resolution', num(res, 3) + ' m'], ['bar contrast', num(exp(-2 * PI * PI * sg * sg) * 100, 3) + ' %'], ['angular resolution', num(1.22 * p.lam * 1e-6 / p.D * 1e6, 3) + ' µrad']]; },
        mission: 'Resolve the 0.5 m bars (ground resolution of 0.5 m or better) with the smallest aperture you can, to within 0.05 m.',
        goal: (s, p) => gres(p) <= 0.5 && gres({ D: p.D - 0.05, lam: p.lam }) > 0.5,
        win: { D: 0.7, lam: 0.55 },
      },
      cards: [
        { q: 'State the Rayleigh criterion for the angular resolution of a circular aperture.', a: '$θ = 1.22λ/D$ radians. From distance $h$ the resolvable detail is about $1.22λh/D$.' },
        { q: 'Why is thermal (LWIR) imagery coarser than visible imagery from the same telescope?', a: 'Resolution scales with wavelength. At 10 µm the diffraction blur is about 18 times larger than at 0.55 µm for the same aperture.' },
      ],
      quiz: [
        { q: 'A 1.22 m aperture observes at λ = 0.5 µm from 400 km. What is its diffraction-limited ground resolution in meters?', num: 0.2, unit: 'm', tol: 0.005, why: '$1.22 × 0.5 × 10^{−6} × 4 × 10^5/1.22 = 0.2$ m.' },
        { q: 'A camera’s pixels are much smaller than its diffraction blur. Adding even smaller pixels will:', choices: ['Sharpen the image', 'Not reveal more detail', 'Reduce diffraction', 'Increase the aperture'], answer: 1, why: 'The optics have already discarded finer detail. Finer sampling of a blur is still a blur.' },
      ],
    },
    {
      id: 'kalman-fusion', skill: 'kalman', title: 'Sensor fusion: adding information', pre: ['kalman-tracking', 'prob-gaussian-cov', 'eoir-optics', 'radar-range-equation'],
      hook: 'A radar knows range superbly and angle roughly. An infrared sensor knows angle superbly and range not at all. Together they know where the target is.',
      body: [
        'Fusing two independent estimates of the same quantity is a Kalman update in disguise. In matrix form, **information adds**:',
        { eq: 'P_f^{−1} = P_1^{−1} + P_2^{−1},   x_f = P_f·(P_1^{−1}x_1 + P_2^{−1}x_2)' },
        'The inverse covariance is called the information matrix. Each sensor contributes most in the directions where its ellipse is thin. The fused ellipse is never larger than either input, and it is dramatically smaller when the sensors are **complementary**: precise in different directions.',
        'Geometry therefore matters as much as sensor quality. Two sensors whose thin axes line up add little. Rotate one so its thin axis covers the other’s long axis and the uncertainty collapses.',
        'Fusion in the field is harder than the formula: measurements must be time-aligned, sensor biases removed, and each report matched to the right track. Get the association wrong and you fuse two different objects.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'geo', label: 'IR sensor viewing direction', min: 0, max: 180, step: 5, v: 90, unit: '°' },
          { k: 'ir', label: 'IR angle accuracy', min: 0.05, max: 1, step: 0.05, v: 0.3, unit: '°' },
          { k: 'raz', label: 'Radar angle accuracy', min: 0.5, max: 3, step: 0.1, v: 1, unit: '°' },
        ],
        draw(g, s, p) {
          const f = fuseP(p);
          g.view(-450, 450, -330, 330, { eq: true }).axes({ xl: 'along radar line of sight (m)', yl: 'cross-range (m)' });
          g.clip(() => {
            g.path(ellipse(f.P2, 1), g.c.b, { w: 2, fill: true, fa: 0.1 }).path(ellipse(f.P1, 1), g.c.a, { w: 2, fill: true, fa: 0.12 });
            g.path(ellipse(f.Pf, 1), g.c.good, { w: 2.5, fill: true, fa: 0.5 });
            g.arrow(-430, 0, -330, 0, g.c.a, { w: 2 }); const a = rad(p.geo); g.arrow(-380 * cos(a), -280 * sin(a), -300 * cos(a), -220 * sin(a), g.c.b, { w: 2 });
          });
          g.dot(0, 0, g.c.ink, 3);
          g.note('radar 1σ', 'tr', g.c.a).note('IR 1σ (no range)', 'tr', g.c.b, 1).note('fused', 'tr', g.c.good, 2);
        },
        read: (s, p) => { const f = fuseP(p); return [['radar-only σ: range × cross', `20 × ${num(1e4 * rad(p.raz), 3)} m`], ['fused area ÷ radar-only area', num(f.ratio * 100, 3) + ' %'], ['fused σ (x, y)', `${num(sqrt(f.Pf[0][0]), 3)}, ${num(sqrt(f.Pf[1][1]), 3)} m`]]; },
        mission: 'Arrange the sensors so the fused uncertainty area is below 15% of the radar-only area.',
        goal: (s, p) => fuseP(p).ratio < 0.15,
        win: { geo: 0, ir: 0.1, raz: 1 },
      },
      cards: [
        { q: 'Write the rule for fusing two independent estimates with covariances $P_1$ and $P_2$.', a: '$P_f^{−1} = P_1^{−1} + P_2^{−1}$ and $x_f = P_f(P_1^{−1}x_1 + P_2^{−1}x_2)$: information (inverse covariance) adds.' },
        { q: 'What makes two sensors "complementary", and why does it matter?', a: 'Each is precise in the direction where the other is poor (for example radar range and infrared angle). Their thin error axes cross, so the fused uncertainty is small in every direction.' },
      ],
      quiz: [
        { q: 'Two independent sensors measure the same scalar with variances 4 and 12. What is the variance of the optimal fused estimate?', num: 3, tol: 0.03, why: '$1/P = 1/4 + 1/12 = 1/3$, so $P = 3$: better than either sensor alone.' },
        { q: 'With those variances, the measurements are 10 (variance 4) and 14 (variance 12). The fused estimate is:', num: 11, tol: 0.05, why: 'Weights are inverse variances: $(10/4 + 14/12)/(1/4 + 1/12) = 3.667/0.333 = 11$. It sits closer to the better sensor.' },
      ],
      code: {
        prompt: 'Complete `fuse(x1, v1, x2, v2)`: combine two independent scalar estimates with variances `v1` and `v2` by inverse-variance weighting. Return `(x, v)`: the fused estimate and its variance.',
        starter: 'def fuse(x1, v1, x2, v2):\n    x = (x1 + x2) / 2   # plain average ignores which sensor is better\n    v = (v1 + v2) / 2\n    return x, v\n\nprint(fuse(10.0, 4.0, 14.0, 12.0))',
        solution: 'def fuse(x1, v1, x2, v2):\n    v = 1 / (1 / v1 + 1 / v2)\n    x = v * (x1 / v1 + x2 / v2)\n    return x, v\n\nprint(fuse(10.0, 4.0, 14.0, 12.0))',
        tests: '_x, _v = fuse(10.0, 4.0, 14.0, 12.0)\nassert abs(_x - 11.0) < 1e-9 and abs(_v - 3.0) < 1e-9, f"expected (11.0, 3.0), got ({_x}, {_v})"\n_x, _v = fuse(5.0, 1.0, 9.0, 1.0)\nassert abs(_x - 7.0) < 1e-9 and abs(_v - 0.5) < 1e-9\n_x, _v = fuse(0.0, 1e-6, 100.0, 1e6)\nassert abs(_x) < 1e-6, "a very precise sensor should dominate"',
        hint: 'Fused variance: `1 / (1/v1 + 1/v2)`. Fused value: that variance times `(x1/v1 + x2/v2)`.',
      },
    },
  ],
};

function prf(p) { const PRF = 10 ** p.lprf * 1000, Ru = 3e5 / (2 * PRF), vu = 0.03 * PRF / 4, fd = 2 * p.v / 0.03, fa = fd - PRF * round(fd / PRF); return { PRF, Ru, vu, fd, va: abs(fa) * 0.03 / 2, rOK: p.R < Ru, vOK: p.v <= vu }; }
function agai(p) { return 10 * log10(0.6 * (PI * p.D / (0.3 / p.f)) ** 2); }
function gres(p) { return 1.22 * p.lam * 1e-6 * 5e5 / p.D; }
