import { tracer, num, clamp } from '../sim.js';
const { abs, max, min, floor, hypot, log2 } = Math;

// --- toy 32-bit mixing function (bijective), used as a stand-in hash / block cipher ---
export const mix = x => { let h = x >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };

// --- data race schedules ---
function schedule(p) {
  const S = [], st = { r1: '–', r2: '–', x: 0 }, add = (who, text, ch, note) => { Object.assign(st, ch); S.push({ who, text, ...st, note }); };
  if (p.mutex) {
    add(1, 'lock', {}, 'T1 holds the lock');
    if (p.sched === 'inter') add(2, 'lock (blocked)', {}, 'T2 must wait');
    add(1, 'load x', { r1: 0 }); add(1, 'add 1', { r1: 1 }); add(1, 'store x', { x: 1 }); add(1, 'unlock', {}, 'lock released');
    add(2, 'lock', {}, 'T2 holds the lock'); add(2, 'load x', { r2: 1 }, 'sees T1’s update'); add(2, 'add 1', { r2: 2 }); add(2, 'store x', { x: 2 }); add(2, 'unlock', {}, 'final x = 2');
  } else if (p.sched === 'inter') {
    add(1, 'load x', { r1: 0 }); add(2, 'load x', { r2: 0 }, 'T2 reads the old value too'); add(1, 'add 1', { r1: 1 }); add(2, 'add 1', { r2: 1 }); add(1, 'store x', { x: 1 }); add(2, 'store x', { x: 1 }, 'lost update: final x = 1');
  } else { add(1, 'load x', { r1: 0 }); add(1, 'add 1', { r1: 1 }); add(1, 'store x', { x: 1 }); add(2, 'load x', { r2: 1 }); add(2, 'add 1', { r2: 2 }); add(2, 'store x', { x: 2 }, 'got lucky: final x = 2'); }
  return S;
}

// --- stack frame model ---
function frame(p) {
  const cells = [], n = p.len, lim = p.check ? min(n, 8) : n;
  for (let i = 0; i < 28; i++) { const region = i < 8 ? 'buf' : i < 12 ? 'flag' : i < 20 ? 'canary' : 'ret'; cells.push({ region, hit: i < lim }); }
  const flag = lim > 8, can = lim > 12, ret = lim > 20;
  const status = p.check && n > 8 ? ['input rejected: longer than the buffer', 'good'] : ret && p.canary ? ['canary changed: program aborts before returning', 'warn'] : ret ? ['return address overwritten: attacker controls where the program jumps', 'bad'] : can && p.canary ? ['canary changed: program aborts before returning', 'warn'] : flag ? ['neighboring variable corrupted', 'bad'] : ['normal', 'good'];
  return { cells, status, safe: status[1] !== 'bad' };
}

// --- timing side channel on a 4-digit PIN ---
const PIN = [7, 2, 9, 4];
export function timing(p) {
  const g = [p.d1, p.d2, p.d3, p.d4]; let k = 0; while (k < 4 && g[k] === PIN[k]) k++;
  const jit = (mix(g[0] * 1000 + g[1] * 100 + g[2] * 10 + g[3]) % 30) / 10 - 1.5;
  return { t: p.ct ? 98 + jit : 50 + 12 * k + jit, k, ok: k === 4 };
}

// --- block cipher modes on a small image ---
const BW = 40, BH = 24;
const PLAIN = Array.from({ length: BW * BH }, (_, i) => { const x = i % BW, y = floor(i / BW); return hypot(x - 13, y - 12) < 8 ? 210 : (x > 26 && x < 36 && y > 4 && y < 20) ? 130 : 40; });
const PLAIN2 = Array.from({ length: BW * BH }, (_, i) => { const x = i % BW, y = floor(i / BW); return (floor((x + y) / 6) % 2) ? 180 : 60; });
const emem = new Map();
export function encrypt(mode, key) {
  const k = mode + key; if (emem.has(k)) return emem.get(k);
  const out = new Array(BW * BH), blocks = [];
  for (let b = 0; b < BW * BH / 4; b++) {
    const pt = (PLAIN[b * 4] << 24 | PLAIN[b * 4 + 1] << 16 | PLAIN[b * 4 + 2] << 8 | PLAIN[b * 4 + 3]) >>> 0;
    const p2 = (PLAIN2[b * 4] << 24 | PLAIN2[b * 4 + 1] << 16 | PLAIN2[b * 4 + 2] << 8 | PLAIN2[b * 4 + 3]) >>> 0;
    const ks = mix(mix(key * 2654435761) + b);
    const ct = mode === 'none' ? pt : mode === 'ecb' ? mix(pt ^ mix(key * 2654435761)) : mode === 'ctr' ? (pt ^ ks) >>> 0 : ((pt ^ ks) ^ (p2 ^ ks)) >>> 0;
    blocks.push(ct); for (let j = 0; j < 4; j++) out[b * 4 + j] = (ct >>> (24 - 8 * j)) & 255;
  }
  const count = new Map(); blocks.forEach(c => count.set(c, (count.get(c) || 0) + 1));
  const res = { out, dup: blocks.filter(c => count.get(c) > 1).length / blocks.length };
  if (emem.size > 600) emem.clear(); emem.set(k, res); return res;
}

// --- Diffie-Hellman with a small prime ---
const DP = 467, DG = 2;
export const modexp = (b, e, m) => { let r = 1; b %= m; while (e > 0) { if (e & 1) r = r * b % m; b = b * b % m; e >>= 1; } return r; };
const DA = modexp(DG, 153, DP), DB = modexp(DG, 271, DP);
const DPOW = Array.from({ length: DP }, (_, a) => modexp(DG, a, DP));

// --- truncated hash collisions ---
const h8 = m => mix(m + 0x1234) & 255;
export const COLL = (() => { for (let m = 1; m < 1024; m++) if (h8(m) === h8(0)) return m; return -1; })();
const bits = (v, n) => Array.from({ length: n }, (_, i) => (v >>> (n - 1 - i)) & 1);

export default {
  id: 'u13', title: 'Secure systems', blurb: 'Rust, embedded security and cryptography.',
  lessons: [
    {
      id: 'rust-traits', skill: 'rust', title: 'Rust: structs, traits and generics', pre: ['rust-types', 'py-classes'],
      hook: 'Flight code must swap a real sensor for a simulated one without touching the control law. Traits make that swap a compile-time guarantee.',
      body: [
        'A Rust `struct` groups data; an `impl` block gives it methods. There is no inheritance. Shared behavior is expressed with a **trait**: a named set of method signatures that any type can implement.',
        { code: 'trait Sensor {\n    fn read(&self) -> f32;\n}\n\nstruct Gyro { bias: f32 }\nstruct SimGyro { truth: f32 }\n\nimpl Sensor for Gyro    { fn read(&self) -> f32 { 0.5 - self.bias } }\nimpl Sensor for SimGyro { fn read(&self) -> f32 { self.truth } }\n\nfn rate<S: Sensor>(s: &S) -> f32 { s.read() * 2.0 }', lang: 'rust' },
        '`rate` is **generic**: it accepts any type that implements `Sensor`. The compiler generates a specialized copy for each concrete type used, so the abstraction costs nothing at run time. That is what "zero-cost abstraction" means.',
        'If a type lacks the trait, the call does not compile. Hardware-in-the-loop rigs, unit tests and flight builds can then share one control law, each plugging in its own implementation of the same trait.',
      ],
      sim: tracer(
        ['trait Sensor { fn read(&self) -> f32; }', 'impl Sensor for Gyro    { ... 0.5 - self.bias }', 'impl Sensor for SimGyro { ... self.truth }', 'fn rate<S: Sensor>(s: &S) -> f32 { s.read() * 2.0 }', '', 'let g = Gyro { bias: 0.1 };', 'let s = SimGyro { truth: 3.0 };', 'let a = rate(&g);', 'let b = rate(&s);', 'let c = rate(&7.0_f32);   // ?'],
        [
          { line: 5, vars: { g: 'Gyro { bias: 0.1 }' }, note: 'a real-hardware type' },
          { line: 6, vars: { g: 'Gyro { bias: 0.1 }', s: 'SimGyro { truth: 3.0 }' }, note: 'a simulated type' },
          { line: 7, vars: { 'S =': 'Gyro', 'read()': 0.4 }, note: 'compiler picks Gyro’s read' },
          { line: 7, vars: { 'S =': 'Gyro', a: 0.8 }, note: '0.4 × 2.0' },
          { line: 8, vars: { 'S =': 'SimGyro', 'read()': '3.0', a: 0.8 }, note: 'same function, different impl' },
          { line: 8, vars: { a: 0.8, b: '6.0' } },
          { line: 9, vars: { a: 0.8, b: '6.0', c: '✗ does not compile' }, note: 'f32 does not implement Sensor', bad: true },
        ],
        { h: 250, mission: 'Step to the last line and predict which calls compile.', goal: (s, p) => p.i === 6, win: { i: 6 } },
      ),
      cards: [
        { q: 'What is a trait in Rust?', a: 'A named set of method signatures. Any type can implement it, and generic code can require it. It plays the role of an interface; Rust has no inheritance.' },
        { q: 'What does "zero-cost abstraction" mean for Rust generics?', a: 'The compiler generates specialized code for each concrete type (monomorphization), so calling through a generic is as fast as hand-written code for that type.' },
      ],
      quiz: [
        { q: 'A function is declared `fn log<T: Display>(x: T)`. Calling it with a type that does not implement `Display`:', choices: ['Panics at run time', 'Fails to compile', 'Prints nothing', 'Converts the value automatically'], answer: 1, why: 'Trait bounds are checked at compile time. The error names the missing trait.' },
        { q: 'How does Rust share behavior between `Gyro` and `SimGyro`?', choices: ['Both inherit from a base class', 'Both implement the same trait', 'Through global functions only', 'It cannot'], answer: 1, why: 'Traits replace inheritance: each type provides its own implementation of the shared interface.' },
      ],
    },
    {
      id: 'rust-concurrency', skill: 'rust', title: 'Rust: concurrency without data races', pre: ['rust-traits', 'rust-ownership'],
      hook: 'Two threads, one counter, and an answer that is wrong one run in a thousand. Race conditions are the bugs testing rarely finds.',
      body: [
        'A **data race** happens when two threads touch the same memory at the same time and at least one writes. "Increment" is really three steps: load, add, store. Interleave two threads’ steps and one update can vanish.',
        'The usual cure is a **mutex**: a lock that lets one thread at a time into the critical section. In most languages, using it is a convention you can forget. In Rust the data lives **inside** the mutex, and the only way to reach it is to lock:',
        { code: 'let counter = Arc::new(Mutex::new(0));\nlet c2 = Arc::clone(&counter);\n\nlet t = thread::spawn(move || {\n    *c2.lock().unwrap() += 1;     // lock, modify, auto-unlock\n});\n*counter.lock().unwrap() += 1;\nt.join().unwrap();', lang: 'rust' },
        'The ownership rules do the rest. Sharing a plain mutable variable between threads does not compile, because the borrow checker forbids two mutable references. Types that are safe to move or share across threads are marked by the `Send` and `Sync` traits, and the compiler checks them.',
        'Rust does not prevent every concurrency bug. Deadlocks and logic races remain. But the whole class of memory-corrupting data races is gone before the program runs, which matters most in embedded code where an interrupt handler is a second thread in all but name.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'sched', type: 'select', label: 'Thread schedule', v: 'seq', options: [['seq', 'One after the other'], ['inter', 'Interleaved']] },
          { k: 'mutex', type: 'toggle', label: 'Protect the counter with a Mutex', v: false },
          { k: 'i', label: 'Step', min: 0, max: 10, step: 1, v: 0 },
        ],
        draw(g, s, p) {
          const S = schedule(p), i = min(p.i, S.length - 1), cur = S[i];
          g.view(0, 10, 0, 12.5, { pad: [10, 10, 10, 10] });
          g.text('Thread 1', 1.6, 11.8, g.c.b, { a: 'center', s: 12, bold: true }).text('Thread 2', 5, 11.8, g.c.c, { a: 'center', s: 12, bold: true }).text('shared x', 8.5, 11.8, g.c.ink, { a: 'center', s: 12, bold: true });
          S.forEach((st, k) => { const y = 10.6 - k * 0.92, x = st.who === 1 ? 1.6 : 5, on = k === i; if (on) g.rect(x - 1.5, y - 0.4, 3, 0.8, g.c.a, { fa: 0.18 }); g.text(st.text, x, y, k <= i ? g.c.ink : g.c.dim, { a: 'center', s: 11.5, bold: on }); });
          g.rect(7.6, 6.6, 1.8, 1.8, cur.x === 1 && i === S.length - 1 ? g.c.bad : g.c.dim, { fa: 0.2, stroke: g.c.ink }).text(String(cur.x), 8.5, 7.5, g.c.ink, { a: 'center', s: 22, bold: true });
          g.text(`T1 register: ${cur.r1}`, 8.5, 5.2, g.c.b, { a: 'center', s: 11 }).text(`T2 register: ${cur.r2}`, 8.5, 4.4, g.c.c, { a: 'center', s: 11 });
          if (cur.note) g.text(cur.note, 8.5, 2.6, /lost/.test(cur.note) ? g.c.bad : g.c.dim, { a: 'center', s: 11, mono: false });
        },
        read: (s, p) => { const S = schedule(p), i = min(p.i, S.length - 1); return [['step', `${i + 1} of ${S.length}`], ['x', S[i].x], ['expected final x', 2]]; },
        mission: 'Find the schedule that loses an update. Then turn on the Mutex and step that same schedule to the end to confirm x = 2.',
        goal: (s, p) => { const S = schedule(p); return p.mutex && p.sched === 'inter' && p.i >= S.length - 1 && S[S.length - 1].x === 2; },
        win: { sched: 'inter', mutex: true, i: 10 },
      },
      cards: [
        { q: 'What is a data race?', a: 'Two threads accessing the same memory concurrently, at least one writing, with no synchronization. The result depends on timing and may corrupt data.' },
        { q: 'How does Rust’s `Mutex<T>` differ from a lock in C?', a: 'The data is owned by the mutex and can only be reached through `lock()`, which returns a guard that unlocks when dropped. Forgetting to lock is impossible.' },
        { q: 'What do the `Send` and `Sync` traits mean?', a: '`Send`: the type can be moved to another thread. `Sync`: it can be shared by reference between threads. The compiler checks them, rejecting unsafe sharing.' },
      ],
      quiz: [
        { q: 'Two threads each increment a shared counter 1,000 times with no synchronization. The final value is:', choices: ['Always 2,000', 'Anywhere from about 1,000 to 2,000, varying run to run', 'Always 1,000', 'Always 0'], answer: 1, why: 'Interleaved load–add–store sequences lose updates unpredictably.' },
        { q: 'Which bug can still occur in safe Rust?', choices: ['Use-after-free', 'A data race on a shared integer', 'A deadlock from locking two mutexes in opposite orders', 'Buffer overflow'], answer: 2, why: 'Rust prevents memory-unsafe races but cannot prove freedom from deadlock or logic errors.' },
      ],
    },
    {
      id: 'embsec-memory', skill: 'embsec', title: 'Memory safety: what a buffer overflow does', pre: ['rust-ownership', 'rust-concurrency', 'vcs-testing'],
      hook: 'For decades the most common way into a system has been to send it more bytes than a programmer expected. Understanding the mechanism is the first step to closing it.',
      body: [
        'In C and C++, an array is just a starting address. Nothing checks that writes stay inside it. A function’s local variables sit side by side on the **stack**, together with bookkeeping the processor needs: in particular the **return address**, which says where to continue when the function finishes.',
        'If code copies input into a fixed buffer without checking its length, the extra bytes spill into whatever lies next. First a neighboring variable changes. A longer input reaches the return address, and then the sender of the input decides what the program does next. That is a **stack buffer overflow**.',
        'Defenses are layered, because each one alone can be defeated:',
        { list: ['**Bounds checks**: reject or truncate input longer than the buffer. The actual fix.', '**Stack canaries**: a secret value placed before the return address and verified before returning. Turns a hijack into a crash.', '**Non-executable data** and **address randomization**: make a successful overwrite much harder to use.', '**Memory-safe languages** such as Rust check every access, removing the bug class.', '**Fuzzing** and static analysis find the unchecked copies before an adversary does.'] },
        'On embedded devices without an operating system some of these are missing, which makes safe languages and careful input handling matter more.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'len', label: 'Input length', min: 0, max: 28, step: 1, v: 6, unit: 'bytes' },
          { k: 'check', type: 'toggle', label: 'Bounds check before copying', v: false },
          { k: 'canary', type: 'toggle', label: 'Stack canary', v: false },
        ],
        draw(g, s, p) {
          const f = frame(p), col = { buf: g.c.b, flag: g.c.c, canary: g.c.d, ret: g.c.ink };
          g.view(0, 28, 0, 6, { pad: [12, 10, 12, 10] });
          [['buffer[8]', 0, 8, 'buf'], ['is_admin', 8, 4, 'flag'], [p.canary ? 'canary' : '(padding)', 12, 8, 'canary'], ['return address', 20, 8, 'ret']].forEach(([n, x, w, r]) => { g.text(n, x + w / 2, 4.6, col[r], { a: 'center', s: 11, bold: true }); g.line(x + 0.1, 4.2, x + w - 0.1, 4.2, col[r], { w: 2 }); });
          f.cells.forEach((c, i) => { const bad = c.hit && c.region !== 'buf'; g.rect(i + 0.06, 2.8, 0.88, 1.1, c.hit ? (bad ? g.c.bad : g.c.b) : g.c.dim, { fa: c.hit ? 0.85 : 0.15, stroke: g.c.grid }); if (c.hit) g.text('A', i + 0.5, 3.35, '#fff', { a: 'center', s: 10 }); });
          g.arrow(0, 2.2, min(28, max(1, p.check ? min(p.len, 8) : p.len)), 2.2, g.c.a, { w: 2 }).text('bytes written', 0, 1.7, g.c.a, { s: 10.5 });
          g.text(f.status[0], 14, 0.7, f.status[1] === 'bad' ? g.c.bad : f.status[1] === 'warn' ? g.c.d : g.c.good, { a: 'center', s: 12.5, bold: true, mono: false });
          g.text('lower addresses', 0, 5.6, g.c.dim, { s: 10 }).text('higher addresses →', 28, 5.6, g.c.dim, { a: 'right', s: 10 });
        },
        read: (s, p) => { const f = frame(p); return [['buffer capacity', '8 bytes'], ['bytes past the end', max(0, (p.check ? min(p.len, 8) : p.len) - 8)], ['outcome', f.status[0]]]; },
        mission: 'Send a 24-byte input and make the program handle it without corrupting anything.',
        goal: (s, p) => p.len >= 24 && p.check,
        win: { len: 24, check: true },
      },
      cards: [
        { q: 'What is a stack buffer overflow?', a: 'Writing more data into a fixed-size stack buffer than it holds, so the excess overwrites adjacent variables and eventually the saved return address, letting an attacker redirect execution.' },
        { q: 'What does a stack canary do, and what does it not do?', a: 'It is a secret value before the return address, checked before the function returns. It converts a control-flow hijack into a crash; it does not prevent the overwrite or protect variables located before it.' },
        { q: 'Name four defenses against memory-corruption bugs.', a: 'Bounds checking, stack canaries, non-executable data with address randomization, memory-safe languages, and fuzzing/static analysis to find bugs early.' },
      ],
      quiz: [
        { q: 'A function copies network input into a 64-byte buffer with no length check. The correct fix is to:', choices: ['Make the buffer 128 bytes', 'Check the input length against the buffer size before copying', 'Add a comment warning callers', 'Disable the network'], answer: 1, why: 'A larger buffer just moves the limit. The copy must be bounded by the destination’s size.' },
        { q: 'Why does a memory-safe language remove this class of bug?', choices: ['Its programs run in a sandbox', 'Every array access is checked against the array’s bounds', 'It has no arrays', 'It encrypts memory'], answer: 1, why: 'An out-of-range index is caught (at compile time or with a controlled panic) instead of silently writing to neighboring memory.' },
      ],
    },
    {
      id: 'embsec-trust', skill: 'embsec', title: 'Roots of trust and side channels', pre: ['embsec-memory', 'prob-estimation'],
      hook: 'A device can do its math perfectly and still give away its secrets through how long the math takes.',
      body: [
        'How does a processor know the code it is about to run is genuine? **Secure boot** builds a **chain of trust**. A small immutable program in ROM holds a public key. It verifies the digital signature of the bootloader before running it; the bootloader verifies the operating system; and so on. The starting point that must simply be trusted, usually hardware, is the **root of trust**. Anti-rollback counters stop an attacker from installing an old, vulnerable but validly signed version.',
        'Now a subtler threat. A **side channel** is information that leaks through physical behavior instead of through the intended output: execution time, power draw, electromagnetic emissions.',
        'The classic example is comparing a secret against a guess byte by byte and stopping at the first mismatch. A guess with more correct leading bytes takes slightly longer to reject. An attacker who can measure time recovers the secret one position at a time: 40 tries for a 4-digit code instead of up to 10,000.',
        'The fix is **constant-time** code: always compare every byte and combine the results, so timing does not depend on the secret. The same discipline applies to cryptographic implementations, which must avoid secret-dependent branches and table lookups.',
        'The lab is a toy lock with a leaky comparison. Change one digit at a time and watch the response time.',
      ],
      sim: {
        h: 280,
        controls: [
          { k: 'd1', label: 'Digit 1', min: 0, max: 9, step: 1, v: 0 }, { k: 'd2', label: 'Digit 2', min: 0, max: 9, step: 1, v: 0 },
          { k: 'd3', label: 'Digit 3', min: 0, max: 9, step: 1, v: 0 }, { k: 'd4', label: 'Digit 4', min: 0, max: 9, step: 1, v: 0 },
          { k: 'ct', type: 'toggle', label: 'Use a constant-time comparison', v: false },
        ],
        draw(g, s, p) {
          const r = timing(p), gs = [p.d1, p.d2, p.d3, p.d4];
          g.view(0, 10, 0, 6, { pad: [10, 10, 10, 10] });
          gs.forEach((d, i) => { g.rect(1.2 + i * 2, 3.6, 1.6, 1.8, r.ok ? g.c.good : g.c.dim, { fa: r.ok ? 0.5 : 0.18, stroke: g.c.ink }); g.text(String(d), 2 + i * 2, 4.5, g.c.ink, { a: 'center', s: 24, bold: true }); });
          g.text(r.ok ? 'UNLOCKED' : 'rejected', 5, 2.9, r.ok ? g.c.good : g.c.bad, { a: 'center', s: 13, bold: true });
          g.rect(1, 1.2, 8, 0.7, g.c.dim, { fa: 0.15 }).rect(1, 1.2, 8 * clamp((r.t - 40) / 70, 0, 1), 0.7, g.c.a, { fa: 0.85 });
          g.text(`response time ${num(r.t, 4)} µs`, 5, 0.6, g.c.ink, { a: 'center', s: 12 });
        },
        read: (s, p) => { const r = timing(p); return [['response time', num(r.t, 4) + ' µs'], ['result', r.ok ? 'unlocked' : 'rejected'], ['comparison', p.ct ? 'constant time' : 'stops at first wrong digit']]; },
        mission: 'With the leaky comparison, recover the 4-digit code from response times alone. Then switch on constant time and see the signal vanish.',
        goal: (s, p) => !p.ct && timing(p).ok,
        win: { d1: 7, d2: 2, d3: 9, d4: 4 },
      },
      cards: [
        { q: 'What is secure boot’s chain of trust?', a: 'Each boot stage verifies the digital signature of the next before running it, starting from an immutable root of trust (typically ROM code and a key in hardware).' },
        { q: 'What is a side-channel attack? Give an example.', a: 'Extracting secrets from physical behavior instead of the intended output: execution time, power consumption or electromagnetic emissions. Example: an early-exit comparison whose duration reveals how many leading bytes of a guess are correct.' },
        { q: 'What is constant-time code?', a: 'Code whose execution time and memory access pattern do not depend on secret values: no secret-dependent branches, early exits or table lookups.' },
      ],
      quiz: [
        { q: 'A 6-digit code is checked with an early-exit comparison that leaks timing. About how many guesses does an attacker need at most?', num: 60, tol: 1, why: 'Ten tries per position, six positions: 60, instead of up to 1,000,000.' },
        { q: 'Why does secure boot need anti-rollback protection?', choices: ['To make booting faster', 'So an old, validly signed version with known flaws cannot be reinstalled', 'To encrypt the firmware', 'To save flash memory'], answer: 1, why: 'A signature proves who made the image, not that it is the latest. A version counter in protected storage rejects older images.' },
      ],
    },
    {
      id: 'crypto-symmetric', skill: 'crypto', title: 'Symmetric encryption and why modes matter', pre: ['embsec-trust', 'comms-spread-spectrum', 'prob-distributions'],
      hook: 'A perfectly good cipher, used the obvious way, leaves the outline of the secret plainly visible. Most real breaks are misuse, not mathematics.',
      body: [
        '**Symmetric** encryption uses one shared secret key to lock and unlock. The simplest scheme is XOR with a random keystream: flip each message bit wherever the key bit is 1. If the keystream is truly random, as long as the message, and never reused, this **one-time pad** is unbreakable.',
        'Reuse it once and it fails: XOR two ciphertexts made with the same keystream and the key cancels, leaving the XOR of the two messages.',
        'Practical ciphers such as **AES** encrypt fixed-size blocks under a short key. How blocks are chained is the **mode of operation**, and it matters as much as the cipher.',
        { list: ['**ECB** encrypts each block independently. Identical plaintext blocks give identical ciphertext blocks, so patterns survive.', '**CTR** encrypts a counter to make a keystream and XORs it with the data. Every block is different, provided the counter (nonce) is never reused with the same key.', '**Authenticated** modes such as GCM also produce a tag that detects tampering. Encryption alone hides content; it does not stop an adversary from flipping bits.'] },
        'The lab encrypts a small image with a toy block cipher so you can see what each mode reveals.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'mode', type: 'select', label: 'Mode', v: 'ecb', options: [['none', 'No encryption'], ['ecb', 'ECB'], ['ctr', 'CTR'], ['reuse', 'Two images, same keystream: XOR of ciphertexts']] },
          { k: 'key', label: 'Key', min: 1, max: 255, step: 1, v: 42 },
        ],
        draw(g, s, p) {
          const r = encrypt(p.mode, p.key), half = (g.w - 24) / 2;
          const show = (x0, title, px) => { g.view(0, BW, 0, BH, { eq: true, pad: [x0, 22, g.w - x0 - half, 8] }); g.text(title, 0, BH, g.c.dim, { s: 11, mono: false, b: 'bottom', dy: -4 }); px.forEach((v, i) => g.rect(i % BW, BH - 1 - floor(i / BW), 1.03, 1.03, `rgb(${v},${v},${v})`)); };
          show(8, 'plaintext', PLAIN); show(half + 16, p.mode === 'reuse' ? 'ciphertext 1 XOR ciphertext 2' : 'ciphertext', r.out);
        },
        read: (s, p) => { const r = encrypt(p.mode, p.key); return [['ciphertext blocks that repeat', num(r.dup * 100, 3) + ' %'], ['structure visible', p.mode === 'ctr' ? 'no' : 'yes']]; },
        mission: 'Encrypt the image so that no ciphertext blocks repeat and no outline survives.',
        goal: (s, p) => p.mode === 'ctr' && encrypt('ctr', p.key).dup < 0.02,
        win: { mode: 'ctr' },
      },
      cards: [
        { q: 'Why must a one-time-pad keystream never be reused?', a: 'XORing two ciphertexts made with the same keystream cancels the key and yields the XOR of the two plaintexts, which leaks both.' },
        { q: 'What is wrong with ECB mode, and what does CTR mode do instead?', a: 'ECB encrypts identical plaintext blocks to identical ciphertext blocks, exposing patterns. CTR encrypts a unique counter per block to make a keystream, so identical blocks encrypt differently.' },
        { q: 'What does authenticated encryption add?', a: 'An integrity tag, so any modification of the ciphertext is detected. Encryption alone provides confidentiality but not integrity.' },
      ],
      quiz: [
        { q: 'A message byte is 0b10110010 and the key byte is 0b01101100. What is the ciphertext byte under XOR, as a decimal number?', num: 222, tol: 0.1, why: '10110010 XOR 01101100 = 11011110 = 222.' },
        { q: 'A system uses CTR mode but restarts its counter from zero with the same key after every reboot. The result is:', choices: ['Still secure', 'Keystream reuse: messages from different sessions can be XORed to cancel the key', 'Slower encryption', 'Larger ciphertext'], answer: 1, why: 'Same key and same counter give the same keystream: the two-time pad failure.' },
      ],
      code: {
        prompt: 'Complete `xor_bytes(data, key)`: XOR each byte of `data` with the key bytes, repeating the key as needed. Return a `bytes` object. Applying it twice with the same key must return the original.',
        starter: 'def xor_bytes(data, key):\n    return data  # replace\n\nc = xor_bytes(b"ATTACK AT DAWN", b"\\x5a\\xc3")\nprint(c, xor_bytes(c, b"\\x5a\\xc3"))',
        solution: 'def xor_bytes(data, key):\n    return bytes(d ^ key[i % len(key)] for i, d in enumerate(data))\n\nc = xor_bytes(b"ATTACK AT DAWN", b"\\x5a\\xc3")\nprint(c, xor_bytes(c, b"\\x5a\\xc3"))',
        tests: '_k = b"\\x5a\\xc3\\x11"\n_m = b"HOLD POSITION"\n_c = xor_bytes(_m, _k)\nassert isinstance(_c, bytes) and len(_c) == len(_m)\nassert _c != _m, "ciphertext should differ from the message"\nassert xor_bytes(_c, _k) == _m, "decrypting with the same key should restore the message"\nassert xor_bytes(b"\\x00\\x00\\x00\\x00", b"\\x01\\x02") == b"\\x01\\x02\\x01\\x02", "the key should repeat"\n_m2 = b"MOVE AT NIGHT"\nassert xor_bytes(_c, xor_bytes(_m2, _k)) == xor_bytes(_m, _m2), "reusing a key: c1 XOR c2 equals m1 XOR m2"',
        hint: '`bytes(d ^ key[i % len(key)] for i, d in enumerate(data))`',
      },
    },
    {
      id: 'crypto-public-key', skill: 'crypto', title: 'Public-key cryptography: agreeing on a secret in the open', pre: ['crypto-symmetric', 'num-root-finding'],
      hook: 'Two parties who have never met agree on a secret key while an eavesdropper hears every word. It sounds impossible, and it runs the internet.',
      body: [
        'Symmetric encryption leaves a problem: how do both sides get the key? **Public-key cryptography** solves it with a **one-way function**: easy to compute, infeasible to reverse.',
        'The original example is **modular exponentiation**. Computing $g^a$ mod $p$ is fast even for enormous numbers. Recovering $a$ from the result, the **discrete logarithm**, has no known efficient method for well-chosen large $p$.',
        '**Diffie–Hellman key exchange** uses it directly:',
        { list: ['Publicly agree on a prime $p$ and a base $g$.', 'Alice picks a secret $a$ and sends $A = g^a$ mod $p$. Bob picks a secret $b$ and sends $B = g^b$ mod $p$.', 'Alice computes $B^a$; Bob computes $A^b$. Both equal $g^{ab}$ mod $p$: the shared secret.'] },
        'An eavesdropper sees $p$, $g$, $A$ and $B$ but needs $a$ or $b$. In the lab the prime is tiny, so you can do the eavesdropper’s search by hand. Notice that the powers jump around with no visible pattern, so there is nothing to home in on. Real systems use 2,048-bit primes or elliptic curves, where the same search would outlast the universe.',
        'One caveat: a large **quantum computer** running Shor’s algorithm would solve discrete logarithms and factoring efficiently. New **post-quantum** algorithms, mostly based on lattice problems, are being deployed now, partly because encrypted traffic recorded today could be decrypted later.',
      ],
      sim: {
        h: 320,
        controls: [{ k: 'a', label: 'Guess for Alice’s secret a', min: 1, max: 466, step: 1, v: 1 }],
        draw(g, s, p) {
          g.view(0, 467, 0, 467).axes({ xl: 'exponent a', yl: 'gᵃ mod p', xs: 100, ys: 100 });
          for (let a = 1; a < DP; a++) g.dot(a, DPOW[a], g.c.dim, 1.4, { alpha: 0.7 });
          g.line(0, DA, 467, DA, g.c.good, { w: 1.5, dash: [5, 4] }).text(`Alice’s public value A = ${DA}`, 462, DA + 14, g.c.good, { a: 'right', s: 11, bg: true });
          const v = DPOW[p.a]; g.line(p.a, 0, p.a, v, g.c.a, { w: 1 }).dot(p.a, v, v === DA ? g.c.good : g.c.a, 6);
          g.note(`public: p = ${DP}, g = ${DG}, A = ${DA}, B = ${DB}`, 'tl', g.c.ink);
        },
        read: (s, p) => { const v = DPOW[p.a], hit = v === DA; return [['2ᵃ mod 467', v], ['match', hit ? 'yes: secret found' : 'no'], ['shared key Bᵃ mod p', hit ? modexp(DB, p.a, DP) : 'unknown']]; },
        mission: 'Play the eavesdropper: find an exponent a with 2ᵃ mod 467 equal to Alice’s public value.',
        goal: (s, p) => DPOW[p.a] === DA,
        win: { a: 153 },
      },
      cards: [
        { q: 'Describe the Diffie–Hellman key exchange.', a: 'Agree publicly on $p$ and $g$. Alice sends $g^a$ mod $p$, Bob sends $g^b$ mod $p$, keeping $a$ and $b$ secret. Each raises the other’s value to their own secret, both getting $g^{ab}$ mod $p$.' },
        { q: 'What is a one-way function, and which one does Diffie–Hellman rely on?', a: 'A function easy to compute but infeasible to invert. Diffie–Hellman relies on modular exponentiation, whose inverse is the discrete logarithm problem.' },
        { q: 'Why does quantum computing threaten today’s public-key cryptography, and what is the response?', a: 'Shor’s algorithm would solve factoring and discrete logarithms efficiently on a large quantum computer. The response is post-quantum algorithms (mainly lattice-based), being adopted now.' },
      ],
      quiz: [
        { q: 'With $p$ = 23 and $g$ = 5, Alice’s secret is $a$ = 6. What public value does she send?', num: 8, tol: 0.1, why: '$5^6 = 15625$, and $15625$ mod $23 = 8$.' },
        { q: 'Diffie–Hellman alone does not protect against:', choices: ['An eavesdropper who only listens', 'An active attacker who impersonates each side to the other', 'Brute force on short keys', 'Replay of old symmetric ciphertext'], answer: 1, why: 'It gives secrecy but not identity. Without authentication (signatures or certificates), a man-in-the-middle can run a separate exchange with each party.' },
      ],
      code: {
        prompt: 'Complete `modexp(b, e, m)`: compute $b^e$ mod $m$ by square-and-multiply, without using Python’s built-in three-argument `pow`. Loop while `e > 0`: if `e` is odd multiply the result by `b`; then square `b` and halve `e`; reduce mod `m` each time.',
        starter: 'def modexp(b, e, m):\n    result = 1\n    b = b % m\n    # square-and-multiply loop\n    return result\n\nprint(modexp(5, 6, 23))',
        solution: 'def modexp(b, e, m):\n    result = 1\n    b = b % m\n    while e > 0:\n        if e & 1:\n            result = result * b % m\n        b = b * b % m\n        e >>= 1\n    return result\n\nprint(modexp(5, 6, 23))',
        tests: 'assert modexp(5, 6, 23) == 8\nassert modexp(2, 153, 467) == pow(2, 153, 467)\nassert modexp(7, 0, 13) == 1\nassert modexp(123456789, 65537, 1000000007) == pow(123456789, 65537, 1000000007)\n_p, _g, _a, _b = 467, 2, 153, 271\nassert modexp(modexp(_g, _a, _p), _b, _p) == modexp(modexp(_g, _b, _p), _a, _p), "both sides must reach the same shared secret"',
        hint: 'Inside `while e > 0:` — `if e & 1: result = result * b % m`, then `b = b * b % m` and `e >>= 1`.',
      },
    },
    {
      id: 'crypto-hashes', skill: 'crypto', title: 'Hashes, signatures and integrity', pre: ['crypto-public-key', 'embsec-trust'],
      hook: 'Secrecy is half of security. The other half is knowing that a message, a firmware image or a command really came from who it claims, unaltered.',
      body: [
        'A **cryptographic hash** turns any input into a short fixed-size fingerprint. Three properties make it useful: it is infeasible to find an input with a given hash, infeasible to find two inputs with the same hash (a **collision**), and changing one input bit flips about half of the output bits: the **avalanche effect**.',
        'Collisions always exist; there are more possible inputs than outputs. Safety comes from length. By the birthday paradox an $n$-bit hash yields a collision after about $2^{n/2}$ tries, so 256-bit hashes are standard and anything short is broken by search.',
        'Hashes are the building block for integrity.',
        { list: ['A **MAC** (such as HMAC) mixes a shared secret key into the hash. Only key holders can produce a valid tag, so a command with a valid MAC came from one of them and was not altered.', 'A **digital signature** uses a key pair: sign the hash with the private key; anyone verifies with the public key. Unlike a MAC it proves origin to third parties, which is what secure boot and software updates rely on.', '**Certificates** are signatures that bind a public key to an identity, chaining back to a trusted root.'] },
        'Together with encryption these give the three goals of secure communication: confidentiality, integrity and authenticity.',
      ],
      sim: {
        h: 300,
        controls: [
          { k: 'm', label: 'Message (a number)', min: 0, max: 1023, step: 1, v: 1 },
          { k: 'trunc', type: 'select', label: 'Hash length kept', v: 8, options: [[8, '8 bits'], [16, '16 bits'], [32, '32 bits']] },
        ],
        draw(g, s, p) {
          const h = mix(p.m + 0x1234), h0 = mix(0x1234), hb = bits(h, 32), rb = bits(mix(p.m - 1 + 0x1234), 32);
          g.view(0, 33, 0, 8, { pad: [10, 10, 10, 10] });
          g.text(`message ${p.m}  =  ${p.m.toString(2).padStart(10, '0')}`, 0.5, 7.3, g.c.ink, { s: 12 });
          g.text('hash of this message', 0.5, 6.1, g.c.dim, { s: 11, mono: false });
          hb.forEach((b, i) => g.rect(i + 0.56, 4.8, 0.88, 0.9, b ? g.c.a : g.c.dim, { fa: b ? 0.9 : 0.2, stroke: i >= 32 - p.trunc ? g.c.ink : g.c.grid, w: i >= 32 - p.trunc ? 1.5 : 1 }));
          g.text('hash of the previous number (one step away)', 0.5, 4.1, g.c.dim, { s: 11, mono: false });
          rb.forEach((b, i) => g.rect(i + 0.56, 2.8, 0.88, 0.9, b ? g.c.b : g.c.dim, { fa: b ? 0.9 : 0.2, stroke: g.c.grid }));
          const diff = hb.filter((b, i) => b !== rb[i]).length, mask = p.trunc === 32 ? 0xffffffff : (1 << p.trunc) - 1, coll = p.m !== 0 && ((h & mask) >>> 0) === ((h0 & mask) >>> 0);
          g.text(`${diff} of 32 output bits differ`, 0.5, 1.9, g.c.ink, { s: 12 });
          g.text(coll ? `COLLISION: message ${p.m} has the same ${p.trunc}-bit hash as message 0` : `outlined bits are the ${p.trunc} kept; target: match message 0’s`, 0.5, 0.8, coll ? g.c.good : g.c.dim, { s: 11.5, mono: false, bold: coll });
        },
        read: (s, p) => { const mask = p.trunc === 32 ? 0xffffffff : (1 << p.trunc) - 1; return [['kept hash', ((mix(p.m + 0x1234) & mask) >>> 0).toString(16)], ['hash of message 0', ((mix(0x1234) & mask) >>> 0).toString(16)], ['tries expected for a collision', num(2 ** (p.trunc / 2), 3)]]; },
        mission: 'With only 8 bits kept, find a second message whose hash matches message 0’s.',
        goal: (s, p) => p.trunc === 8 && p.m !== 0 && h8(p.m) === h8(0),
        win: { m: COLL, trunc: 8 },
      },
      cards: [
        { q: 'Name the key properties of a cryptographic hash function.', a: 'Preimage resistance (cannot find an input for a given hash), collision resistance (cannot find two inputs with the same hash), and the avalanche effect (a one-bit input change flips about half the output bits).' },
        { q: 'How many attempts does the birthday bound predict to find a collision in an $n$-bit hash?', a: 'About $2^{n/2}$. That is why hashes are 256 bits or longer.' },
        { q: 'What is the difference between a MAC and a digital signature?', a: 'A MAC uses one shared secret key: anyone who can verify can also forge. A signature uses a private key to sign and a public key to verify, so it proves origin to third parties.' },
      ],
      quiz: [
        { q: 'A hash is truncated to 40 bits. Roughly how many random messages until a collision is likely? Answer as a power of two: 2 to the what?', num: 20, tol: 0.1, why: 'Birthday bound: $2^{40/2} = 2^{20}$, about a million. Far too few to be safe.' },
        { q: 'A ground station must prove to anyone, including outside auditors, that a firmware image came from the manufacturer. It should use:', choices: ['A plain hash', 'A MAC with a shared key', 'A digital signature', 'ECB encryption'], answer: 2, why: 'Only a signature lets parties without the secret key verify origin, and it cannot be forged by verifiers.' },
      ],
    },
  ],
};
