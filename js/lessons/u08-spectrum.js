import { tracer, num, rng, clamp, Q } from '../sim.js';
const { sin, cos, PI, sqrt, abs, hypot, max, min, log10, log2, floor, atan2 } = Math;
const rad = d => d * PI / 180;
const pw = v => '10' + [...String(Math.round(v))].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join('');

// --- modulation ---
const CONST = {
  2: [[-1, 0], [1, 0]],
  4: [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(q => q.map(v => v / Math.SQRT2)),
  16: Array.from({ length: 16 }, (_, i) => [(2 * (i % 4) - 3) / sqrt(10), (2 * floor(i / 4) - 3) / sqrt(10)]),
};
export const ber = (m, db) => { const g = 10 ** (db / 10); return m === 16 ? 0.75 * Q(sqrt(0.8 * g)) : Q(sqrt(2 * g)); };

// --- spread spectrum ---
export const sinr = p => p.gp + 10 * log10(1 / (10 ** (-p.snr / 10) + 10 ** (p.js / 10)));

// --- self-protection jamming ---
export const burn = p => sqrt(10 ** ((p.erp + p.sig - p.jam + 10 * p.lb) / 10) / (4 * PI));

// --- frequency hopping ---
const HOP = (() => { const r = rng(17); return Array.from({ length: 60 }, () => r()); })();
export const jammed = p => ({ partial: min(1, 4 / p.N), follower: max(0, 1 - 0.002 * 10 ** p.lh) });

// --- GNSS geometry: 2-D position plus clock bias ---
export function dop(p) {
  const H = Array.from({ length: p.n }, (_, i) => { const a = rad(90 - p.spread / 2 + p.spread * (p.n === 1 ? 0.5 : i / (p.n - 1))); return [cos(a), sin(a), 1]; });
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; H.forEach(h => h.forEach((v, i) => h.forEach((w, j) => { A[i][j] += v * w; })));
  const [a, b, c] = A[0], [d, e, f] = A[1], [g2, h2, k] = A[2], det = a * (e * k - f * h2) - b * (d * k - f * g2) + c * (d * h2 - e * g2);
  if (abs(det) < 1e-9) return { pdop: 99, C: [[1e4, 0], [0, 1e4]], H };
  const C = [[(e * k - f * h2) / det, (c * h2 - b * k) / det], [(f * g2 - d * k) / det, (a * k - c * g2) / det]];
  return { pdop: sqrt(max(0, C[0][0] + C[1][1])), C, H };
}

// --- GNSS jamming: free-space, L1 ---
export const tol = p => 40 + (p.crpa ? 30 : 0) + (p.ins ? 15 : 0);
export const denial = p => 10 ** ((10 * p.lp + 122.1 - tol(p)) / 20) / 1000;

export default {
  id: 'u08', title: 'The spectrum contest', blurb: 'Communications, electronic warfare and navigation.',
  lessons: [
    {
      id: 'comms-modulation', skill: 'comms', title: 'Digital modulation and the Shannon limit', pre: ['fourier-phasors', 'detect-threshold', 'em-waves'],
      hook: 'Every link trades three things: data rate, bandwidth and power. Shannon proved exactly how far the trade can go.',
      body: [
        'A digital radio sends **symbols**: a carrier whose amplitude and phase are set to one of $M$ points on the I/Q plane, the **constellation**. Each symbol carries $log_2 M$ bits. BPSK has 2 points (1 bit), QPSK 4 (2 bits), 16-QAM 16 (4 bits).',
        'Noise smears each received point into a cloud. When a cloud spills across the boundary to a neighboring point, bits are wrong. Packing more points into the same power puts them closer together, so denser constellations need more energy per bit, $E_b/N_0$, for the same **bit error rate**.',
        'Shannon’s theorem caps what any scheme can do. The largest error-free rate through bandwidth $B$ at signal-to-noise ratio $SNR$ is',
        { eq: 'C = B·log_2(1 + SNR)   bits per second' },
        'Error-correcting codes close most of the gap between practical modulation and this limit. They do it by adding structured redundancy, which is why modern links run at error rates that the raw constellation alone could never reach.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'm', type: 'select', label: 'Modulation', v: 4, options: [[2, 'BPSK (1 bit/symbol)'], [4, 'QPSK (2 bits)'], [16, '16-QAM (4 bits)']] },
          { k: 'eb', label: 'E_b/N₀', min: 0, max: 20, step: 0.5, v: 6, unit: 'dB' },
        ],
        init: () => { const r = rng(8); return { z: Array.from({ length: 480 }, () => [r.n(), r.n()]) }; },
        draw(g, s, p) {
          const k = log2(p.m), sg = sqrt(1 / (2 * k * 10 ** (p.eb / 10))), pts = CONST[p.m], split = min(g.h, g.w * 0.5);
          g.view(-1.7, 1.7, -1.7, 1.7, { eq: true, pad: [8, 8, g.w - split, 8] });
          g.line(-1.7, 0, 1.7, 0, g.c.grid, { w: 1 }).line(0, -1.7, 0, 1.7, g.c.grid, { w: 1 });
          if (p.m === 16) [-2, 2].forEach(v => { g.line(v / sqrt(10), -1.7, v / sqrt(10), 1.7, g.c.grid, { w: 1, dash: [3, 3] }).line(-1.7, v / sqrt(10), 1.7, v / sqrt(10), g.c.grid, { w: 1, dash: [3, 3] }); });
          s.z.forEach(([a, b], i) => { const c = pts[i % p.m]; g.dot(c[0] + a * sg, c[1] + (p.m === 2 ? b * sg : b * sg), g.c.b, 1.6, { alpha: 0.55 }); });
          pts.forEach(c => g.dot(c[0], c[1], g.c.a, 4));
          g.view(0, 20, -8, 0, { pad: [split + 50, 12, 14, 30] }).axes({ xl: 'E_b/N₀ (dB)', yl: 'bit error rate', yf: pw, ys: 2, xs: 5 });
          [[2, g.c.dim], [16, g.c.dim]].forEach(([m, col]) => g.fn(x => log10(max(1e-9, ber(m, x))), col, { w: 1.2, dash: [4, 3] }));
          g.fn(x => log10(max(1e-9, ber(p.m, x))), g.c.a, { w: 2.5 });
          g.dot(p.eb, clamp(log10(max(1e-9, ber(p.m, p.eb))), -8, 0), g.c.ink, 5);
        },
        read: (s, p) => { const k = log2(p.m), snrl = k * 10 ** (p.eb / 10); return [['bit error rate', num(ber(p.m, p.eb), 2)], ['bits per symbol', k], ['Shannon limit at this SNR', num(log2(1 + snrl), 3) + ' bits/s/Hz']]; },
        mission: 'Run 16-QAM at a bit error rate below 10⁻⁵ using the least E_b/N₀ that works (within 0.5 dB).',
        goal: (s, p) => p.m === 16 && ber(16, p.eb) < 1e-5 && ber(16, p.eb - 0.5) >= 1e-5,
        win: { m: 16, eb: 13.5 },
      },
      cards: [
        { q: 'What is a constellation, and how many bits does each symbol of an $M$-point constellation carry?', a: 'The set of amplitude/phase points (on the I/Q plane) a modulator can send. Each symbol carries $log_2 M$ bits.' },
        { q: 'State Shannon’s capacity formula.', a: '$C = B log_2(1 + SNR)$ bits per second: the highest error-free rate over a channel of bandwidth $B$ with the given signal-to-noise ratio.' },
        { q: 'Why does 16-QAM need more $E_b/N_0$ than QPSK for the same bit error rate?', a: 'Its points are packed closer together for the same average power, so less noise is needed to push a received sample across a decision boundary.' },
      ],
      quiz: [
        { q: 'A channel has 1 MHz of bandwidth and an SNR of 15 (linear). What is its Shannon capacity in Mbit/s?', num: 4, unit: 'Mbit/s', tol: 0.05, why: '$C = 10^6 × log_2(16) = 4 × 10^6$ bit/s.' },
        { q: 'Switching from QPSK to 16-QAM at the same symbol rate:', choices: ['Doubles the bit rate and needs more signal power', 'Doubles the bit rate for free', 'Halves the bandwidth and the bit rate', 'Lowers the bit error rate'], answer: 0, why: '4 bits per symbol instead of 2, in the same bandwidth, at the cost of several dB more $E_b/N_0$.' },
      ],
    },
    {
      id: 'comms-spread-spectrum', skill: 'comms', title: 'Spread spectrum: hiding below the noise', pre: ['comms-modulation', 'radar-pulse-compression'],
      hook: 'GPS signals arrive weaker than the background noise, yet your phone finds them. The same trick makes a link hard to detect and hard to jam.',
      body: [
        '**Direct-sequence spread spectrum** multiplies each data bit by a fast pseudo-random sequence of ±1 **chips**. The signal’s bandwidth grows by the number of chips per bit, and its power is spread thin across that bandwidth, often below the noise floor.',
        'A receiver that knows the code multiplies by it again. The data collapses back to its narrow bandwidth, while anything that is not matched to the code, noise or a jammer, is spread out instead. The advantage is the **processing gain**:',
        { eq: 'G_p = chip rate / bit rate,   SINR_{out} = G_p·S/(N + J)' },
        'This is pulse compression again: bandwidth traded for robustness. It gives three properties at once. **Low probability of intercept**: a watcher without the code sees only a slight rise in noise. **Jam resistance**: a jammer must overcome $G_p$. **Multiple access**: users with different codes share one band.',
        'Spreading protects the transmission, not the message. Keeping the content secret is the job of encryption, which is covered in the security unit.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'gp', label: 'Processing gain', min: 0, max: 40, step: 1, v: 10, unit: 'dB' },
          { k: 'snr', label: 'Signal power relative to noise in the spread band', min: -30, max: 10, step: 1, v: 0, unit: 'dB' },
          { k: 'js', label: 'Jammer power relative to signal', min: -10, max: 40, step: 1, v: 20, unit: 'dB' },
        ],
        draw(g, s, p) {
          const half = (g.w - 30) / 2, W = 10, nb = max(0.12, W / 10 ** (p.gp / 20) * 0.6);
          const panel = (x0, title, sigW, sigL, jamW, jamL) => {
            g.view(-6, 6, -45, 45, { pad: [x0 + 36, 26, g.w - x0 - half, 30] }).axes({ xl: 'frequency', yl: 'power density (dB)', xt: false, ys: 20 });
            g.text(title, -6, 45, g.c.dim, { s: 11, mono: false, b: 'bottom', dy: -4 });
            g.rect(-6, -45, 12, 45, g.c.dim, { fa: 0.18 }).text('noise', -5.7, -4, g.c.dim, { s: 10.5 });
            g.rect(-jamW / 2 + 1.6, -45, jamW, clamp(jamL, -44, 44) + 45, g.c.bad, { fa: 0.35 });
            g.rect(-sigW / 2, -45, sigW, clamp(sigL, -44, 44) + 45, g.c.c, { fa: 0.55 });
          };
          panel(0, 'On the air', W, p.snr, 0.25, p.snr + p.js + 10 * log10(W / 0.25));
          panel(half + 16, 'After despreading', nb * 1.2, p.snr + p.gp, W, p.snr + p.js - 10 * log10(1));
          g.note('signal', 'tr', g.c.c).note('jammer', 'tr', g.c.bad, 1);
        },
        read: (s, p) => [['chips per bit', num(10 ** (p.gp / 10), 3)], ['output SINR', num(sinr(p), 3) + ' dB'], ['link', sinr(p) >= 10 ? 'closes (≥ 10 dB)' : 'fails']],
        mission: 'Keep the signal at least 10 dB below the noise, survive a jammer 20 dB stronger than the signal, and still get 10 dB of output SINR.',
        goal: (s, p) => p.snr <= -10 && p.js >= 20 && sinr(p) >= 10,
        win: { gp: 31, snr: -10, js: 20 },
      },
      cards: [
        { q: 'What is processing gain in a direct-sequence spread-spectrum system?', a: 'The ratio of chip rate to bit rate (spread bandwidth to data bandwidth). Despreading improves the signal relative to noise and jamming by this factor.' },
        { q: 'Name three benefits of spread spectrum.', a: 'Low probability of intercept (signal hides below the noise), resistance to jamming and interference, and code-division multiple access (many users in one band).' },
      ],
      quiz: [
        { q: 'A system sends 50 bit/s data spread with a 1.023 Mchip/s code. What is its processing gain in dB?', num: 43.1, unit: 'dB', tol: 0.3, why: '$10 log_{10}(1{,}023{,}000/50) ≈ 43.1$ dB. These are the GPS C/A code numbers.' },
        { q: 'A narrowband jammer enters a spread-spectrum receiver. Despreading:', choices: ['Concentrates the jammer into the data band', 'Spreads the jammer across the wide band, leaving only a fraction in the data band', 'Has no effect on the jammer', 'Removes the jammer completely'], answer: 1, why: 'Multiplying by the code spreads anything not already coded. Only $1/G_p$ of the jammer power falls inside the narrow data filter.' },
      ],
    },
    {
      id: 'ew-jamming', skill: 'ew', title: 'Jamming: J/S and burn-through', pre: ['radar-range-equation', 'comms-spread-spectrum'],
      hook: 'A jammer has geometry on its side: its signal travels one way while the radar’s travels two. Close in, the radar wins anyway.',
      body: [
        '**Electronic warfare** contests the spectrum. Electronic attack denies or deceives a sensor; electronic protection hardens the sensor; electronic support listens. The basic attack is **noise jamming**: raise the receiver’s noise floor until echoes drown.',
        'A radar echo falls as $1/R^4$. A jammer carried by the target reaches the radar after one trip, falling only as $1/R^2$. Their ratio is',
        { eq: 'J/S = 4π·ERP_j·R^2·(B_r/B_j) / (ERP_r·σ)', where: 'ERP = power × antenna gain; $B_r/B_j$ = fraction of jammer power inside the radar’s band' },
        'Far away the jammer dominates. As range closes, the echo grows faster, and at the **burn-through range** the radar sees the target through the jamming.',
        'The radar’s best counter is to make the jammer waste power. If the radar hops unpredictably over a wide band, the jammer must spread across all of it (barrage jamming), and only the fraction $B_r/B_j$ lands in the receiver. More radar ERP helps too, as does a larger target cross-section, which is the one term the defender of the target wants small.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'erp', label: 'Radar ERP', min: 70, max: 110, step: 1, v: 85, unit: 'dBW' },
          { k: 'jam', label: 'Jammer ERP', min: 0, max: 40, step: 1, v: 20, unit: 'dBW' },
          { k: 'sig', label: 'Target cross-section', min: -10, max: 20, step: 1, v: 7, unit: 'dBsm' },
          { k: 'lb', label: 'Jammer bandwidth ÷ radar bandwidth', min: 0, max: 3, step: 0.1, v: 0, fmt: v => num(10 ** v, 3) },
        ],
        draw(g, s, p) {
          g.view(2, 5.3, -130, -20).axes({ xl: 'range (m)', yl: 'power at radar receiver (dBW)', xf: pw, xs: 1, ys: 20 });
          const S = lr => p.erp + 35 + 20 * log10(0.03) + p.sig - 30 * log10(4 * PI) - 40 * lr;
          const J = lr => p.jam + 35 + 20 * log10(0.03) - 20 * log10(4 * PI) - 20 * lr - 10 * p.lb;
          g.fn(S, g.c.b, { w: 2.5 }).fn(J, g.c.bad, { w: 2.5 });
          const lb = log10(burn(p)); if (lb > 2 && lb < 5.3) { g.line(lb, -130, lb, -20, g.c.ink, { w: 1, dash: [4, 4] }).dot(lb, S(lb), g.c.ink, 6).text('burn-through', lb, -124, g.c.ink, { dx: 6, s: 11 }); }
          g.note('echo  ∝ 1/R⁴', 'tr', g.c.b).note('jamming  ∝ 1/R²', 'tr', g.c.bad, 1);
        },
        read: (s, p) => [['burn-through range', num(burn(p) / 1000, 3) + ' km'], ['J/S at 50 km', num(20 * log10(50000 / burn(p)), 3) + ' dB']],
        mission: 'As the radar designer: push burn-through beyond 20 km against a jammer of at least 20 dBW protecting a target no larger than 7 dBsm.',
        goal: (s, p) => p.jam >= 20 && p.sig <= 7 && burn(p) > 20000,
        win: { erp: 95, jam: 20, sig: 7, lb: 1.6 },
      },
      cards: [
        { q: 'Why does a self-protection jammer have a range advantage over the radar, and where does it lose it?', a: 'The jamming travels one way ($1/R^2$) while the echo travels two ways ($1/R^4$), so J/S grows with $R^2$. Inside the burn-through range the echo exceeds the jamming.' },
        { q: 'How does frequency agility help a radar against noise jamming?', a: 'If the jammer cannot predict the radar’s frequency it must spread its power over the whole agile band (barrage). Only the fraction $B_r/B_j$ enters the receiver, reducing J/S.' },
        { q: 'Name the three divisions of electronic warfare.', a: 'Electronic attack (jam or deceive), electronic protection (resist attack), and electronic support (detect, identify and locate emitters).' },
      ],
      quiz: [
        { q: 'A radar’s burn-through range against a jammer is 4 km. The radar then raises its ERP by 20 dB. The new burn-through range is:', num: 40, unit: 'km', tol: 0.5, why: '$R_{bt} ∝ √ERP_r$. A factor of 100 in power gives a factor of 10 in range.' },
        { q: 'A jammer is forced to spread over 100 times the radar’s bandwidth. J/S at the radar drops by:', choices: ['10 dB', '20 dB', '40 dB', '100 dB'], answer: 1, why: 'Only 1/100 of the jammer power lands in the radar’s band: $10 log_{10}100 = 20$ dB.' },
      ],
    },
    {
      id: 'ew-frequency-hopping', skill: 'ew', title: 'Frequency hopping against jammers', pre: ['ew-jamming', 'prob-distributions'],
      hook: 'If you cannot outshout a jammer, outrun it. A hopping radio is gone from each channel before the jammer arrives.',
      body: [
        'A **frequency-hopping** radio changes channel many times a second in a pseudo-random pattern known to both ends. Two kinds of jammer answer it.',
        { list: ['A **partial-band jammer** parks its power on a few channels and waits. It corrupts the fraction of hops that land there: (jammed channels)/(total channels). The counter is more channels, plus error-correcting codes that repair the lost hops.', 'A **follower jammer** listens, finds the current channel and jams it. It needs a reaction time $τ$. If the radio dwells on each channel for less than $τ$, the jammer always arrives late. The counter is a faster hop rate.'] },
        { eq: 'fraction jammed (follower) = max(0, 1 − τ·hop rate)' },
        'A robust waveform needs both: enough channels to dilute a partial-band jammer and enough speed to beat a follower. The hop pattern must also be unpredictable, which makes generating it a cryptographic problem.',
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'N', label: 'Channels', min: 4, max: 100, step: 1, v: 10 },
          { k: 'lh', label: 'Hop rate', min: 1, max: 3.3, step: 0.05, v: 2, fmt: v => num(10 ** v, 3) + ' hops/s' },
          { k: 'view', type: 'select', label: 'Show jammer', v: 'partial', options: [['partial', 'Partial band (4 channels)'], ['follower', 'Follower (2 ms reaction)']] },
        ],
        draw(g, s, p) {
          const j = jammed(p), late = min(1, 0.002 * 10 ** p.lh);
          g.view(0, 40, 0, p.N, { pad: [44, 12, 14, 30] }).axes({ xl: 'dwell (time →)', yl: 'channel', grid: false, xt: false, ys: max(1, Math.round(p.N / 5)) });
          if (p.view === 'partial') g.rect(0, 0, 40, min(4, p.N), g.c.bad, { fa: 0.22 });
          for (let k = 0; k < 40; k++) {
            const ch = floor(HOP[k] * p.N), hit = p.view === 'partial' ? ch < 4 : false;
            g.rect(k + 0.06, ch, 0.88, 1, hit ? g.c.bad : g.c.c, { fa: 0.9 });
            if (p.view === 'follower' && late < 1) g.rect(k + 0.06 + 0.88 * late, ch, 0.88 * (1 - late), 1, g.c.bad, { fa: 0.9 });
          }
          g.note(p.view === 'partial' ? 'jammed band' : 'jammer catches the tail of each dwell', 'tr', g.c.bad);
        },
        read: (s, p) => { const j = jammed(p); return [['dwell time', num(1000 / 10 ** p.lh, 3) + ' ms'], ['jammed by partial-band', num(j.partial * 100, 3) + ' %'], ['jammed by follower', num(j.follower * 100, 3) + ' %']]; },
        mission: 'Design a hop set that loses less than 5% of its air time to either jammer.',
        goal: (s, p) => { const j = jammed(p); return j.partial < 0.05 && j.follower < 0.05; },
        win: { N: 100, lh: 2.7 },
      },
      cards: [
        { q: 'How does a partial-band jammer attack a frequency hopper, and what counters it?', a: 'It jams a fixed subset of channels, corrupting the fraction of hops that land there. Counter with more channels and error-correcting codes.' },
        { q: 'How does a follower jammer work, and what defeats it?', a: 'It detects the current hop frequency and jams it after a reaction time $τ$. Hopping fast enough that the dwell time is shorter than $τ$ means the radio has moved before the jamming arrives.' },
      ],
      quiz: [
        { q: 'A follower jammer needs 1 ms to react. At what hop rate (hops/s) does it first fail to jam any part of a dwell?', num: 1000, unit: 'hops/s', tol: 5, why: 'Dwell time must be no longer than the reaction time: 1 ms per hop is 1,000 hops/s.' },
        { q: 'A radio hops over 200 channels. A jammer covers 10 of them. About what fraction of hops are jammed?', choices: ['0.5%', '5%', '10%', '20%'], answer: 1, why: '$10/200 = 5$%.' },
      ],
    },
    {
      id: 'gnss-positioning', skill: 'gnss', title: 'How satellite navigation finds you', pre: ['linalg-least-squares', 'comms-spread-spectrum', 'prob-gaussian-cov'],
      hook: 'A receiver the size of a fingernail solves for position and time from signals sent 20,000 km away by transmitters weaker than a light bulb.',
      body: [
        'Each navigation satellite broadcasts a spread-spectrum code stamped with its transmit time. The receiver measures the arrival time, and delay × $c$ gives a range. Ranges to several satellites at known positions fix the receiver’s position: **trilateration**.',
        'There is a catch. The receiver’s clock is cheap, and 1 microsecond of clock error is 300 m of range error. So the measurements are called **pseudoranges**, and the receiver solves for its clock bias as one more unknown: three position coordinates plus time need **four satellites**. The solution is the least-squares problem from the estimation unit.',
        'Accuracy depends on geometry as much as on signal quality:',
        { eq: 'position error ≈ DOP × range error' },
        '**Dilution of precision** (DOP) is small when satellites are spread across the sky and large when they are bunched together, because nearly parallel lines of sight barely constrain the position across them.',
      ],
      sim: {
        h: 330,
        controls: [
          { k: 'n', label: 'Satellites in view', min: 3, max: 8, step: 1, v: 3 },
          { k: 'spread', label: 'Spread across the sky', min: 10, max: 170, step: 5, v: 40, unit: '°' },
          { k: 'sr', label: 'Range measurement noise', min: 0.5, max: 10, step: 0.5, v: 3, unit: 'm' },
        ],
        draw(g, s, p) {
          const d = dop(p);
          g.view(-12, 12, -3.5, 12, { eq: true, pad: [8, 8, 8, 8] });
          g.line(-12, 0, 12, 0, g.c.dim, { w: 2 });
          d.H.forEach(h => { g.line(0, 0, h[0] * 10.5, h[1] * 10.5, g.c.b, { w: 1, dash: [4, 4] }); g.rect(h[0] * 10.5 - 0.35, h[1] * 10.5 - 0.2, 0.7, 0.4, g.c.b).line(h[0] * 10.5 - 0.9, h[1] * 10.5, h[0] * 10.5 + 0.9, h[1] * 10.5, g.c.b, { w: 3 }); });
          const C = d.C, tr = (C[0][0] + C[1][1]) / 2, dc = sqrt(max(0, tr * tr - (C[0][0] * C[1][1] - C[0][1] * C[1][0]))), a = sqrt(tr + dc), b = sqrt(max(1e-9, tr - dc)), th = 0.5 * atan2(2 * C[0][1], C[0][0] - C[1][1]), k = p.sr * 0.12, pts = [];
          for (let i = 0; i <= 72; i++) { const t = i / 36 * PI; pts.push([k * (a * cos(t) * cos(th) - b * sin(t) * sin(th)), k * (a * cos(t) * sin(th) + b * sin(t) * cos(th))]); }
          g.clip(() => g.path(pts, g.c.a, { w: 2, fill: true, fa: 0.3 }));
          g.dot(0, 0, g.c.ink, 4).text('receiver', 0, -1, g.c.ink, { a: 'center', s: 11 }).note('position uncertainty (magnified)', 'tr', g.c.a);
        },
        read: (s, p) => { const d = dop(p); return [['DOP', num(d.pdop, 3)], ['position error (1σ)', num(d.pdop * p.sr, 3) + ' m'], ['unknowns solved', 'x, y, clock']]; },
        mission: 'With range noise of 3 m or more, get the position error below 5 m.',
        goal: (s, p) => p.sr >= 3 && dop(p).pdop * p.sr < 5,
        win: { n: 8, spread: 170, sr: 3 },
      },
      cards: [
        { q: 'Why does a satellite navigation receiver need four satellites for a 3-D fix?', a: 'It must solve for three position coordinates plus its own clock bias. Each satellite gives one pseudorange equation, so four unknowns need four satellites.' },
        { q: 'What is dilution of precision (DOP)?', a: 'A geometry factor: position error ≈ DOP × range error. Satellites spread widely across the sky give low DOP; bunched satellites give high DOP.' },
        { q: 'What is a pseudorange?', a: 'The measured signal travel time times $c$. It equals the true range plus the receiver clock error (times $c$) and other delays, hence "pseudo".' },
      ],
      quiz: [
        { q: 'A receiver clock is off by 10 nanoseconds. How much range error does that cause, in meters?', num: 3, unit: 'm', tol: 0.05, why: '$3 × 10^8 × 10 × 10^{−9} = 3$ m.' },
        { q: 'All visible satellites are clustered in one small patch of sky. The position solution will be:', choices: ['More accurate', 'Poor, especially across the line of sight', 'Unaffected', 'Impossible to compute'], answer: 1, why: 'Nearly parallel lines of sight give almost the same information, so DOP is high.' },
      ],
    },
    {
      id: 'gnss-denial', skill: 'gnss', title: 'GNSS jamming, spoofing and protection', pre: ['gnss-positioning', 'ew-jamming', 'kalman-fusion'],
      hook: 'The signal is so faint that a transmitter you can hold in one hand can blank it for kilometers. Navigation has to be designed to survive that.',
      body: [
        'A GNSS signal reaches the ground at about −158 dBW, well below thermal noise. Processing gain pulls it out, but only so far: a typical civil receiver loses lock when jamming exceeds the signal by roughly 40 dB.',
        { eq: 'J/S (dB) ≈ P_j(dBW) + 122 − 20·log_{10}(d_{meters})', where: 'free-space, line of sight, at the L1 frequency' },
        '**Jamming** simply overpowers the signal. **Spoofing** is subtler: it broadcasts counterfeit signals so the receiver computes a confident, wrong position or time.',
        'Protection is layered, and each layer adds decibels or adds a cross-check:',
        { list: ['**Antenna nulling.** A controlled reception pattern antenna (CRPA) uses several elements to place a null toward the jammer: the phased array from the sensing unit, run in reverse. Worth roughly 30 dB.', '**Inertial aiding.** An inertial unit carries the solution through outages and lets the tracking loops narrow their bandwidth. Worth roughly 15 dB, and it exposes spoofing when the two disagree.', '**Signal design.** Encrypted military signals cannot be counterfeited without the key and tolerate more jamming.', '**Consistency checks** on clock, signal power, direction of arrival and redundant satellites, and **alternative sources**: terrain or star matching, signals of opportunity.'] },
      ],
      sim: {
        h: 320,
        controls: [
          { k: 'lp', label: 'Jammer power', min: -2, max: 2, step: 0.1, v: 0, fmt: v => num(10 ** v, 3) + ' W' },
          { k: 'crpa', type: 'toggle', label: 'Nulling antenna (CRPA), +30 dB', v: false },
          { k: 'ins', type: 'toggle', label: 'Inertial aiding, +15 dB', v: false },
        ],
        draw(g, s, p) {
          const r = denial(p), R = max(2, min(140, r * 1.5));
          g.view(-R, R, -R * 0.7, R * 0.7, { eq: true }).axes({ xl: 'km', yl: 'km' });
          g.clip(() => { g.circle(0, 0, r, g.c.bad, { w: 2, fill: true, fa: 0.18 }); for (let i = 0; i < 5; i++) g.circle(0, 0, r * (i + 1) / 5, g.c.bad, { w: 1, alpha: 0.25 }); });
          g.dot(0, 0, g.c.bad, 6).text('jammer', 0, 0, g.c.bad, { dx: 10, s: 11, bg: true });
          g.note('inside the circle the receiver loses lock (line of sight)', 'tl', g.c.dim);
        },
        read: (s, p) => [['jamming tolerance J/S', tol(p) + ' dB'], ['denial radius', num(denial(p), 3) + ' km'], ['J/S at 1 km', num(10 * p.lp + 122.1 - 60, 3) + ' dB']],
        mission: 'Shrink the denial radius of a jammer of 10 W or more to under 1 km.',
        goal: (s, p) => p.lp >= 1 && denial(p) < 1,
        win: { lp: 1, crpa: true, ins: true },
      },
      cards: [
        { q: 'Why is GNSS so easy to jam?', a: 'The signals arrive at about −158 dBW, below the thermal noise floor, after travelling roughly 20,000 km. A nearby transmitter of a few watts exceeds them by far more than the receiver’s processing gain can absorb.' },
        { q: 'What is the difference between GNSS jamming and spoofing?', a: 'Jamming overpowers the signal so the receiver loses lock (denial). Spoofing transmits counterfeit signals so the receiver reports a false position or time (deception).' },
        { q: 'Name three layers of protection against GNSS denial.', a: 'A nulling antenna (CRPA), inertial aiding/coupling, encrypted or higher-power signals, consistency checks, and alternative navigation sources.' },
      ],
      quiz: [
        { q: 'Using the lesson’s formula, what is the J/S in dB from a 1 W (0 dBW) jammer at 10 km?', num: 42, unit: 'dB', tol: 0.5, why: '$0 + 122 − 20 log_{10}(10{,}000) = 122 − 80 = 42$ dB: enough to deny a basic receiver.' },
        { q: 'A receiver suddenly reports that it jumped 3 km while its inertial unit sensed no acceleration. The most likely explanation is:', choices: ['Normal satellite geometry change', 'Spoofing or a faulty signal: the two sources disagree', 'A leap second', 'Low battery'], answer: 1, why: 'Independent sensors disagreeing is the classic spoofing indicator. An inertial unit cannot be fooled by radio signals.' },
      ],
    },
    {
      id: 'py-classes', skill: 'python', title: 'Python: objects that hold state', pre: ['py-numpy', 'vcs-testing'],
      hook: 'A simulation has many parts, each with its own state and rules. Classes keep each part’s data and behavior in one place.',
      body: [
        'A **class** bundles data (attributes) with the functions that act on it (methods). `__init__` runs when an object is created. Inside methods, `self` is the object itself.',
        { code: 'class Tank:\n    def __init__(self, fuel):\n        self.fuel = fuel          # each Tank has its own fuel\n\n    def burn(self, rate, dt):\n        used = min(self.fuel, rate * dt)\n        self.fuel -= used\n        return used', lang: 'python' },
        'Each object carries its own state, so two tanks do not interfere. Methods that change state and also return a value, like `burn`, are common in simulations: the vehicle asks the tank for propellant and the tank answers with what it could actually deliver.',
        'Keep classes small and their interfaces explicit. A model you can construct and step in three lines is a model you can test in three lines.',
      ],
      sim: tracer(
        ['class Tank:', '    def __init__(self, fuel):', '        self.fuel = fuel', '    def burn(self, rate, dt):', '        used = min(self.fuel, rate * dt)', '        self.fuel -= used', '        return used', '', 't = Tank(10.0)', 'a = t.burn(4.0, 2.0)', 'b = t.burn(4.0, 2.0)', 'print(a, b, t.fuel)'],
        [
          { line: 8, vars: { 't.fuel': '10.0' }, note: '__init__ stored the fuel' },
          { line: 9, vars: { 't.fuel': '10.0' }, note: 'call burn(4.0, 2.0)' },
          { line: 4, vars: { 't.fuel': '10.0', used: '8.0' }, note: 'min(10.0, 8.0)' },
          { line: 5, vars: { 't.fuel': '2.0', used: '8.0' } },
          { line: 6, vars: { 't.fuel': '2.0', a: '8.0' }, note: 'returns 8.0' },
          { line: 10, vars: { 't.fuel': '2.0', a: '8.0' }, note: 'call burn again' },
          { line: 4, vars: { 't.fuel': '2.0', a: '8.0', used: '2.0' }, note: 'min(2.0, 8.0): tank limits it' },
          { line: 5, vars: { 't.fuel': '0.0', a: '8.0', used: '2.0' } },
          { line: 6, vars: { 't.fuel': '0.0', a: '8.0', b: '2.0' }, note: 'returns 2.0' },
          { line: 11, vars: { 't.fuel': '0.0', a: '8.0', b: '2.0' }, note: 'prints 8.0 2.0 0.0' },
        ],
        { h: 290, mission: 'Step to the print, predicting each value of used and t.fuel.', goal: (s, p) => p.i === 9, win: { i: 9 } },
      ),
      cards: [
        { q: 'In a Python class, what are `__init__` and `self`?', a: '`__init__` is the method that runs when an object is created, used to set its initial attributes. `self` is the object the method is acting on.' },
        { q: 'Why give each simulation component its own class?', a: 'Each object keeps its own state and exposes a small interface, so parts can be built, tested and replaced independently.' },
      ],
      quiz: [
        { q: 'What does this print?', code: 'class Counter:\n    def __init__(self):\n        self.n = 0\n    def tick(self):\n        self.n += 1\n\na = Counter()\nb = Counter()\na.tick(); a.tick(); b.tick()\nprint(a.n, b.n)', lang: 'python', choices: ['3 3', '2 1', '1 1', '2 2'], answer: 1, why: 'Each object has its own `n`. `a` was ticked twice, `b` once.' },
        { q: 'A method is defined as `def burn(self, rate, dt)`. How is it called on a tank `t`?', choices: ['`burn(t, self, 4.0, 2.0)`', '`t.burn(4.0, 2.0)`', '`t.burn(self, 4.0, 2.0)`', '`Tank.burn(4.0, 2.0)`'], answer: 1, why: 'Python passes the object as `self` automatically when you call the method on it.' },
      ],
      code: {
        prompt: 'Write a class `Vehicle` with attributes `x` and `v` set by `__init__(self, x, v)`. Add `step(self, a, dt)` that updates `v` by `a * dt` and then `x` by the new `v * dt`, and `energy(self, m)` that returns the kinetic energy $½mv^2$.',
        starter: 'class Vehicle:\n    def __init__(self, x, v):\n        pass  # store x and v\n\n    def step(self, a, dt):\n        pass  # update v, then x\n\n    def energy(self, m):\n        return 0.0\n\ncar = Vehicle(0.0, 0.0)\nfor _ in range(10):\n    car.step(2.0, 0.5)\nprint(car.x, car.v, car.energy(1000.0))',
        solution: 'class Vehicle:\n    def __init__(self, x, v):\n        self.x = x\n        self.v = v\n\n    def step(self, a, dt):\n        self.v += a * dt\n        self.x += self.v * dt\n\n    def energy(self, m):\n        return 0.5 * m * self.v ** 2\n\ncar = Vehicle(0.0, 0.0)\nfor _ in range(10):\n    car.step(2.0, 0.5)\nprint(car.x, car.v, car.energy(1000.0))',
        tests: '_c = Vehicle(1.0, 2.0)\nassert _c.x == 1.0 and _c.v == 2.0, "__init__ should store x and v"\n_c.step(4.0, 0.5)\nassert abs(_c.v - 4.0) < 1e-12 and abs(_c.x - 3.0) < 1e-12, f"after step(4, 0.5) expected v=4, x=3; got v={_c.v}, x={_c.x}"\nassert abs(_c.energy(2.0) - 16.0) < 1e-12\n_d = Vehicle(0.0, 0.0)\nassert _d.v == 0.0, "objects must not share state"',
        hint: 'In `__init__`: `self.x = x` and `self.v = v`. In `step`: `self.v += a * dt` then `self.x += self.v * dt`.',
      },
    },
  ],
};
