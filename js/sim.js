// Simulation engine. A lesson supplies a small spec; this mounts a canvas with
// sliders, readouts and an optional mission that latches when goal() is true.
//
// spec = {
//   h: 300,                       canvas height in CSS px
//   controls: [                   sliders by default
//     { k, label, min, max, step, v, unit, re }   re:true re-runs init on change
//     { k, type:'toggle', label, v }
//     { k, type:'select', label, options:[[value,label]], v }
//     { type:'button', label, on(s, p) }
//   ],
//   init(p) -> state,             optional
//   step(s, p, dt, t),            optional; presence makes the sim animate
//   draw(g, s, p, t),
//   read(s, p) -> [[label, text]],
//   drag(s, p, x, y, phase),      world coords of the last g.view()
//   mission: 'text', goal(s, p) -> bool,
//   win: {k: v} | (s, p) => {}    a known solution, used by tools/validate.mjs
// }

const TAU = Math.PI * 2;

export function themeColors(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (n, d) => (cs.getPropertyValue(n) || d).trim() || d;
  return {
    ink: v('--ink', '#15181c'), dim: v('--dim', '#6b7280'), grid: v('--grid', '#d9d5c9'),
    panel: v('--canvas', '#fffdf8'), a: v('--a', '#e5480f'), b: v('--b', '#1f5fbf'),
    c: v('--c', '#0f8a7a'), d: v('--d', '#7a4fd0'), good: v('--good', '#1a8f4c'),
    bad: v('--bad', '#c8321f'), dark: v('--is-dark', '0') === '1',
  };
}

export function niceStep(range, target = 6) {
  const raw = Math.abs(range) / target || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

export function num(v, sig = 3) {
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  let s;
  if (a >= 1e6 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = (v / Math.pow(10, e)).toPrecision(Math.max(1, sig - 1));
    s = `${parseFloat(m)}×10^${e}`.replace(/\^(-?\d+)/, (_, d) =>
      [...d].map(ch => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ch] ?? '⁻').join(''));
  } else {
    s = String(parseFloat(v.toPrecision(sig)));
    if (a >= 10000) s = Number(s).toLocaleString('en-US');
  }
  return s.replace('-', '−');
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const mix = (c1, c2, t) => {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`;
};

export function makeG(ctx, W, H, c) {
  let x0 = 0, x1 = 1, y0 = 0, y1 = 1, L = 0, T = 0, R = W, B = H;
  const g = {
    w: W, h: H, c, ctx,
    // Set world coordinates. pad = [left, top, right, bottom] px. eq keeps 1:1 aspect.
    view(ax0, ax1, ay0, ay1, o = {}) {
      const pad = o.pad || [44, 12, 14, 30];
      L = pad[0]; T = pad[1]; R = W - pad[2]; B = H - pad[3];
      x0 = ax0; x1 = ax1; y0 = ay0; y1 = ay1;
      if (o.eq) {
        const sx = (R - L) / (x1 - x0), sy = (B - T) / (y1 - y0);
        if (sx > sy) { const cx = (x0 + x1) / 2, half = (R - L) / sy / 2; x0 = cx - half; x1 = cx + half; }
        else { const cy = (y0 + y1) / 2, half = (B - T) / sx / 2; y0 = cy - half; y1 = cy + half; }
      }
      g.x0 = x0; g.x1 = x1; g.y0 = y0; g.y1 = y1;
      return g;
    },
    X: x => L + (x - x0) / (x1 - x0) * (R - L),
    Y: y => B - (y - y0) / (y1 - y0) * (B - T),
    invX: px => x0 + (px - L) / (R - L) * (x1 - x0),
    invY: py => y0 + (B - py) / (B - T) * (y1 - y0),
    S: d => Math.abs(d / (x1 - x0) * (R - L)), // world length -> px (x scale)
    clear() { ctx.clearRect(0, 0, W, H); },
    axes(o = {}) {
      ctx.save();
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.lineWidth = 1;
      const xs = o.xs || niceStep(x1 - x0, Math.max(3, Math.round((R - L) / 80)));
      const ys = o.ys || niceStep(y1 - y0, Math.max(3, Math.round((B - T) / 46)));
      const xf = o.xf || (v => num(v, 3)), yf = o.yf || (v => num(v, 3));
      const e = 1e-9;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (let x = Math.ceil((x0 - e) / xs) * xs; x <= x1 + xs * e; x += xs) {
        const X = Math.round(g.X(x)) + 0.5;
        if (o.grid !== false) { ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, B); ctx.stroke(); }
        if (o.xt !== false) { ctx.fillStyle = c.dim; ctx.fillText(xf(Math.abs(x) < xs * 1e-6 ? 0 : x), X, B + 5); }
      }
      ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      for (let y = Math.ceil((y0 - e) / ys) * ys; y <= y1 + ys * e; y += ys) {
        const Y = Math.round(g.Y(y)) + 0.5;
        if (o.grid !== false) { ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(R, Y); ctx.stroke(); }
        if (o.yt !== false) { ctx.fillStyle = c.dim; ctx.fillText(yf(Math.abs(y) < ys * 1e-6 ? 0 : y), L - 6, Y); }
      }
      ctx.strokeStyle = c.dim;
      if (o.zero !== false) {
        if (y0 < 0 && y1 > 0) { const Y = Math.round(g.Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(R, Y); ctx.stroke(); }
        if (x0 < 0 && x1 > 0) { const X = Math.round(g.X(0)) + 0.5; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, B); ctx.stroke(); }
      }
      ctx.strokeRect(L + 0.5, T + 0.5, R - L, B - T);
      ctx.fillStyle = c.dim;
      if (o.xl) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xl, R - 4, B - 4); }
      if (o.yl) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(o.yl, L + 5, T + 5); }
      ctx.restore();
      return g;
    },
    clip(fn) { ctx.save(); ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip(); fn(); ctx.restore(); },
    _stroke(color, o = {}) {
      ctx.strokeStyle = color || c.ink; ctx.lineWidth = o.w || 2;
      ctx.setLineDash(o.dash || []); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = o.alpha ?? 1;
    },
    fn(f, color, o = {}) {
      const n = o.n || Math.max(120, Math.round(R - L));
      const a = o.from ?? x0, b = o.to ?? x1;
      ctx.save(); ctx.beginPath(); ctx.rect(L, T - 1, R - L, B - T + 2); ctx.clip();
      g._stroke(color, o); ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const x = a + (b - a) * i / n, y = f(x);
        if (!isFinite(y)) { pen = false; continue; }
        const Y = Math.max(-1e4, Math.min(1e4, g.Y(y)));
        if (pen) ctx.lineTo(g.X(x), Y); else { ctx.moveTo(g.X(x), Y); pen = true; }
      }
      ctx.stroke(); ctx.restore();
      return g;
    },
    path(pts, color, o = {}) {
      if (!pts.length) return g;
      ctx.save(); g._stroke(color, o); ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(g.X(p[0]), g.Y(p[1])) : ctx.moveTo(g.X(p[0]), g.Y(p[1]))));
      if (o.close) ctx.closePath();
      if (o.fill) { ctx.fillStyle = o.fill === true ? color : o.fill; ctx.globalAlpha = o.fa ?? 0.18; ctx.fill(); ctx.globalAlpha = o.alpha ?? 1; }
      if (o.w !== 0) ctx.stroke();
      ctx.restore();
      return g;
    },
    line(ax, ay, bx, by, color, o = {}) {
      ctx.save(); g._stroke(color, o); ctx.beginPath();
      ctx.moveTo(g.X(ax), g.Y(ay)); ctx.lineTo(g.X(bx), g.Y(by)); ctx.stroke(); ctx.restore();
      return g;
    },
    arrow(ax, ay, bx, by, color, o = {}) {
      const X1 = g.X(ax), Y1 = g.Y(ay), X2 = g.X(bx), Y2 = g.Y(by);
      const len = Math.hypot(X2 - X1, Y2 - Y1);
      if (len < 1.5) return g;
      const ang = Math.atan2(Y2 - Y1, X2 - X1), hd = Math.min(o.head || 9, len * 0.6);
      ctx.save(); g._stroke(color, o); ctx.fillStyle = color || c.ink;
      ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2 - Math.cos(ang) * hd * 0.7, Y2 - Math.sin(ang) * hd * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X2, Y2);
      ctx.lineTo(X2 - hd * Math.cos(ang - 0.42), Y2 - hd * Math.sin(ang - 0.42));
      ctx.lineTo(X2 - hd * Math.cos(ang + 0.42), Y2 - hd * Math.sin(ang + 0.42));
      ctx.closePath(); ctx.fill(); ctx.restore();
      return g;
    },
    dot(x, y, color, r = 4, o = {}) {
      ctx.save(); ctx.globalAlpha = o.alpha ?? 1; ctx.fillStyle = color || c.ink;
      ctx.beginPath(); ctx.arc(g.X(x), g.Y(y), r, 0, TAU); ctx.fill();
      if (o.ring) { ctx.strokeStyle = o.ring; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
      return g;
    },
    circle(x, y, rWorld, color, o = {}) {
      ctx.save(); g._stroke(color, o); ctx.beginPath();
      ctx.ellipse(g.X(x), g.Y(y), g.S(rWorld), Math.abs(rWorld / (y1 - y0) * (B - T)), 0, 0, TAU);
      if (o.fill) { ctx.fillStyle = o.fill === true ? color : o.fill; ctx.globalAlpha = o.fa ?? 0.18; ctx.fill(); ctx.globalAlpha = o.alpha ?? 1; }
      if (o.w !== 0) ctx.stroke();
      ctx.restore();
      return g;
    },
    rect(x, y, w, h, color, o = {}) {
      const X = g.X(x), Y = g.Y(y + h), Wd = g.X(x + w) - X, Ht = g.Y(y) - Y;
      ctx.save(); g._stroke(color, o);
      if (o.fill !== false) { ctx.fillStyle = o.fill && o.fill !== true ? o.fill : color; ctx.globalAlpha = o.fa ?? 1; ctx.fillRect(X, Y, Wd, Ht); ctx.globalAlpha = 1; }
      if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 1; ctx.strokeRect(X, Y, Wd, Ht); }
      ctx.restore();
      return g;
    },
    text(str, x, y, color, o = {}) {
      ctx.save();
      ctx.font = `${o.bold ? '600 ' : ''}${o.s || 12}px ${o.mono === false ? 'system-ui, sans-serif' : 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}`;
      ctx.fillStyle = color || c.ink; ctx.textAlign = o.a || 'left'; ctx.textBaseline = o.b || 'middle';
      const X = (o.px ? x : g.X(x)) + (o.dx || 0), Y = (o.px ? y : g.Y(y)) + (o.dy || 0);
      if (o.bg) {
        const m = ctx.measureText(str), wv = m.width + 8;
        const lx = ctx.textAlign === 'center' ? X - wv / 2 : ctx.textAlign === 'right' ? X - wv + 4 : X - 4;
        ctx.save(); ctx.fillStyle = c.panel; ctx.globalAlpha = 0.85; ctx.fillRect(lx, Y - 9, wv, 18); ctx.restore();
      }
      ctx.fillText(str, X, Y); ctx.restore();
      return g;
    },
    // Pixel-anchored note: corner is 'tl' | 'tr' | 'bl' | 'br', row stacks lines.
    note(str, corner = 'tl', color, row = 0) {
      const right = corner[1] === 'r', bottom = corner[0] === 'b';
      return g.text(str, right ? R - 8 : L + 8, bottom ? B - 12 - row * 16 : T + 12 + row * 16, color || c.dim,
        { px: true, a: right ? 'right' : 'left', s: 11.5, bg: true });
    },
    spring(ax, ay, bx, by, color, coils = 10, amp = 8) {
      const X1 = g.X(ax), Y1 = g.Y(ay), X2 = g.X(bx), Y2 = g.Y(by);
      const len = Math.hypot(X2 - X1, Y2 - Y1) || 1, ux = (X2 - X1) / len, uy = (Y2 - Y1) / len;
      ctx.save(); g._stroke(color, { w: 2 }); ctx.beginPath(); ctx.moveTo(X1, Y1);
      const lead = Math.min(10, len * 0.1), n = coils * 2;
      ctx.lineTo(X1 + ux * lead, Y1 + uy * lead);
      for (let i = 0; i <= n; i++) {
        const t = lead + (len - 2 * lead) * (i + 0.5) / (n + 1), side = i % 2 ? -amp : amp;
        ctx.lineTo(X1 + ux * t - uy * side, Y1 + uy * t + ux * side);
      }
      ctx.lineTo(X2 - ux * lead, Y2 - uy * lead); ctx.lineTo(X2, Y2); ctx.stroke(); ctx.restore();
      return g;
    },
    // Scalar field over the current view. f(x, y) -> value; cmap(value) -> css color.
    heat(f, nx = 48, ny = 32, cmap = g.ramp) {
      const cw = (R - L) / nx, ch = (B - T) / ny;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = x0 + (i + 0.5) / nx * (x1 - x0), y = y1 - (j + 0.5) / ny * (y1 - y0);
        ctx.fillStyle = cmap(f(x, y));
        ctx.fillRect(L + i * cw - 0.3, T + j * ch - 0.3, cw + 0.6, ch + 0.6);
      }
      return g;
    },
    ramp: t => mix(c.panel, c.a, Math.max(0, Math.min(1, t))),            // 0..1 sequential
    div: t => (t >= 0 ? mix(c.panel, c.a, Math.min(1, t)) : mix(c.panel, c.b, Math.min(1, -t))), // -1..1
    hot: t => { // black-body style ramp for temperature
      t = Math.max(0, Math.min(1, t));
      return t < 0.5 ? mix(c.dark ? '#1b2030' : '#dfe6f3', '#e5480f', t * 2) : mix('#e5480f', '#ffe9a8', (t - 0.5) * 2);
    },
    bars(vals, color, o = {}) { // vals: [[x, h]] in world units, width in world units
      const wd = o.wd || (vals.length > 1 ? Math.abs(vals[1][0] - vals[0][0]) * 0.8 : 1);
      vals.forEach(([x, hgt], i) => g.rect(x - wd / 2, Math.min(0, hgt) + (o.base || 0), wd, Math.abs(hgt),
        typeof color === 'function' ? color(i) : color, { fa: o.fa ?? 0.85 }));
      return g;
    },
  };
  g.view(0, 1, 0, 1);
  return g;
}

// 'P_fa' -> P<sub>fa</sub> in control labels and readout names
const sub = t => String(t).replace(/_\{([^}]+)\}|_([A-Za-z0-9θωλ]+)/g, '<sub>$1$2</sub>');

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function defaults(spec) {
  const p = {};
  (spec.controls || []).forEach(c => { if (c.k) p[c.k] = c.v; });
  return p;
}

export function mountSim(host, spec, opts = {}) {
  host.innerHTML = '';
  host.classList.add('sim');
  const p = defaults(spec);
  let s = spec.init ? spec.init(p) : {};
  let done = !!opts.done, t = 0, last = 0, raf = 0, visible = true, dirty = true, alive = true;

  const stage = el('div', 'sim-stage');
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', opts.label || 'Interactive simulation');
  stage.style.height = (spec.h || 300) + 'px';
  stage.appendChild(canvas);
  const reads = el('div', 'sim-reads');
  const ctrls = el('div', 'sim-ctrls');
  const mission = el('div', 'sim-mission');
  host.append(stage, reads, ctrls);
  if (spec.mission) host.appendChild(mission);

  const ctx = canvas.getContext('2d');
  let g = null, W = 0, H = 0, colors = themeColors(host);

  function size() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(200, Math.round(r.width)); H = Math.round(r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    colors = themeColors(host);
    g = makeG(ctx, W, H, colors);
    dirty = true;
  }

  function reinit() { s = spec.init ? spec.init(p) : {}; t = 0; dirty = true; }

  const outs = {};
  (spec.controls || []).forEach(c => {
    if (c.type === 'button') {
      const b = el('button', 'btn btn-sm', c.label); b.type = 'button';
      b.onclick = () => { c.on(s, p); dirty = true; };
      const w = el('div', 'ctl ctl-btn'); w.appendChild(b); ctrls.appendChild(w);
      return;
    }
    const w = el('label', 'ctl');
    if (c.type === 'toggle') {
      w.classList.add('ctl-toggle');
      const i = el('input'); i.type = 'checkbox'; i.checked = !!c.v;
      i.onchange = () => { p[c.k] = i.checked; if (c.re) reinit(); dirty = true; };
      w.append(i, el('span', 'ctl-name', sub(c.label)));
    } else if (c.type === 'select') {
      const sel = el('select');
      c.options.forEach(([val, lab]) => { const o = el('option', '', lab); o.value = val; sel.appendChild(o); });
      sel.value = c.v;
      sel.onchange = () => { p[c.k] = isNaN(+sel.value) || sel.value === '' ? sel.value : +sel.value; if (c.re) reinit(); dirty = true; };
      w.append(el('span', 'ctl-name', sub(c.label)), sel);
    } else {
      const head = el('span', 'ctl-head');
      const out = el('output', 'ctl-val');
      const show = () => { out.textContent = (c.fmt ? c.fmt(p[c.k]) : num(p[c.k], 4)) + (c.unit ? ' ' + c.unit : ''); };
      head.append(el('span', 'ctl-name', sub(c.label)), out);
      const i = el('input'); i.type = 'range'; i.min = c.min; i.max = c.max; i.step = c.step ?? (c.max - c.min) / 200; i.value = c.v;
      i.oninput = () => { p[c.k] = +i.value; show(); if (c.re) reinit(); dirty = true; };
      outs[c.k] = { i, show };
      show(); w.append(head, i);
    }
    ctrls.appendChild(w);
  });
  if (spec.step || spec.resettable) {
    const b = el('button', 'btn btn-sm btn-ghost', 'Restart'); b.type = 'button';
    b.onclick = reinit;
    const w = el('div', 'ctl ctl-btn'); w.appendChild(b); ctrls.appendChild(w);
  }
  if (!ctrls.children.length) ctrls.remove();

  function paintMission() {
    if (!spec.mission) return;
    mission.classList.toggle('is-done', done);
    mission.innerHTML = `<span class="sim-mission-tag">${done ? 'Mission complete' : 'Mission'}</span><span>${spec.mission}</span>`;
  }
  paintMission();

  function render() {
    if (!g) return;
    g.clear();
    try { spec.draw(g, s, p, t); } catch (e) { g.text('Sim error: ' + e.message, 12, 20, colors.bad, { px: true }); console.error(e); }
    if (spec.read) {
      const rows = spec.read(s, p) || [];
      reads.innerHTML = rows.map(([k, v]) => `<span class="rd"><span class="rd-k">${sub(k)}</span><span class="rd-v">${typeof v === 'number' ? num(v) : v}</span></span>`).join('');
    }
    if (!done && spec.goal && spec.goal(s, p)) { done = true; paintMission(); opts.onGoal && opts.onGoal(); }
  }

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!visible) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    if (spec.step) { t += dt; spec.step(s, p, dt, t); dirty = true; }
    if (dirty) { dirty = false; render(); }
  }

  if (spec.drag) {
    canvas.style.touchAction = 'none'; canvas.style.cursor = 'crosshair';
    let down = false;
    const at = (e, phase) => {
      const r = canvas.getBoundingClientRect();
      spec.drag(s, p, g.invX(e.clientX - r.left), g.invY(e.clientY - r.top), phase);
      dirty = true;
    };
    canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); at(e, 'down'); });
    canvas.addEventListener('pointermove', e => { if (down) at(e, 'move'); });
    const up = e => { if (down) { down = false; at(e, 'up'); } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }

  const ro = new ResizeObserver(size); ro.observe(stage);
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; });
  io.observe(stage);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => size();
  mq.addEventListener('change', onTheme);
  document.addEventListener('themechange', onTheme);
  size();
  raf = requestAnimationFrame(frame);

  return {
    destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); mq.removeEventListener('change', onTheme); document.removeEventListener('themechange', onTheme); },
    set(k, v) { p[k] = v; if (outs[k]) { outs[k].i.value = v; outs[k].show(); } dirty = true; },
    get state() { return s; }, params: p,
  };
}

// ---- reusable sim builders -------------------------------------------------

// Step through code with a variable table. lines: string[]; steps: [{ line, vars:{}, note }]
export function tracer(lines, steps, extra = {}) {
  return {
    h: Math.max(220, 34 + lines.length * 20),
    controls: [{ k: 'i', label: 'Step', min: 0, max: steps.length - 1, step: 1, v: 0, fmt: v => `${v + 1} / ${steps.length}` }],
    draw(g, s, p) {
      const st = steps[p.i], ctx = g.ctx, split = Math.min(g.w * 0.58, g.w - 170);
      ctx.font = '12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      lines.forEach((ln, i) => {
        const y = 22 + i * 20;
        if (i === st.line) { ctx.fillStyle = g.c.a; ctx.globalAlpha = 0.16; ctx.fillRect(8, y - 10, split - 16, 20); ctx.globalAlpha = 1; ctx.fillStyle = g.c.a; ctx.fillRect(8, y - 10, 3, 20); }
        g.text(String(i + 1).padStart(2), 16, y, g.c.dim, { px: true, s: 11 });
        g.text(ln, 40, y, i === st.line ? g.c.ink : g.c.dim, { px: true, s: 12.5 });
      });
      ctx.strokeStyle = g.c.grid; ctx.beginPath(); ctx.moveTo(split, 10); ctx.lineTo(split, g.h - 10); ctx.stroke();
      g.text(extra.varsTitle || 'MEMORY', split + 14, 20, g.c.dim, { px: true, s: 10.5 });
      Object.entries(st.vars || {}).forEach(([k, v], i) => {
        const y = 44 + i * 24, bad = String(v).startsWith('✗');
        g.text(k, split + 14, y, g.c.b, { px: true, s: 12.5 });
        g.text(String(v), split + 14 + Math.max(56, k.length * 8 + 14), y, bad ? g.c.bad : g.c.ink, { px: true, s: 12.5, bold: true });
      });
      if (st.note) g.text(st.note, split + 14, g.h - 18, st.bad ? g.c.bad : g.c.c, { px: true, s: 11.5, mono: false });
    },
    read: (s, p) => [['line', steps[p.i].line + 1]],
    ...extra,
  };
}

// Seeded RNG so sims are reproducible.
export function rng(seed = 1) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.n = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r());
  return r;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dB = x => 10 * Math.log10(x);
export const undB = x => Math.pow(10, x / 10);
export const erfc = x => { // Abramowitz-Stegun 7.1.26
  const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  const y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
};
export const Q = x => 0.5 * erfc(x / Math.SQRT2);     // Gaussian tail probability
export const gauss = (x, mu = 0, sd = 1) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(TAU));
// RK4 for a state vector. f(y, t) -> dy/dt
export function rk4(f, y, t, h) {
  const add = (a, b, k) => a.map((v, i) => v + b[i] * k);
  const k1 = f(y, t), k2 = f(add(y, k1, h / 2), t + h / 2), k3 = f(add(y, k2, h / 2), t + h / 2), k4 = f(add(y, k3, h), t + h);
  return y.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}
