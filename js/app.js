import { UNITS, LESSONS, byId, SKILLS, TRACKS, cardIds, findCard } from './course.js';
import * as store from './store.js';
import { mountSim } from './sim.js';
import { fmt, body, esc, codeBlock } from './fmt.js';
import { runPython, tidyError } from './py.js';

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
let cleanup = [];
let keyHandler = null;

const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const go = path => { location.hash = '#/' + path; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function applyTheme() {
  const t = store.load().settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.dispatchEvent(new Event('themechange'));
}

// ---- progression ---------------------------------------------------------------
const nextLesson = () => LESSONS.find(l => !store.isDone(l.id)) || null;
function unlocked(l) {
  if (store.load().settings.freeRoam || store.isDone(l.id)) return true;
  const n = nextLesson();
  return !n || l.index <= n.index;
}
const doneCount = () => LESSONS.filter(l => store.isDone(l.id)).length;
const skillChip = l => `<span class="chip chip-${SKILLS[l.skill].track}">${SKILLS[l.skill].name}</span>`;

// ---- shared pieces ---------------------------------------------------------------
function sim(host, lesson, opts = {}) {
  const inst = mountSim(host, lesson.sim, { label: `Interactive: ${lesson.title}`, ...opts });
  cleanup.push(() => inst.destroy());
  return inst;
}

// Renders one question. kind: recall | mc | num. Calls onDone(rating) once answered.
function question(item, onDone, { showLab = true } = {}) {
  const { lesson, kind, data } = item;
  const box = h(`<div class="q q-${kind}"></div>`);
  const prompt = h(`<div class="q-prompt">${fmt(data.q)}</div>`);
  box.appendChild(prompt);
  if (data.code) box.appendChild(h(codeBlock(data.code, data.lang || '')));
  const after = h('<div class="q-after" hidden></div>');
  let answered = false;

  const finish = (rating, verdictHtml) => {
    if (answered) return; answered = true;
    after.hidden = false;
    after.innerHTML = verdictHtml;
    if (showLab && lesson.sim) {
      const b = h('<button class="btn btn-sm btn-ghost" type="button">Open the lab for this idea</button>');
      const slot = h('<div class="q-lab" hidden></div>');
      b.onclick = () => { slot.hidden = false; b.remove(); sim(slot, lesson, { done: true }); };
      after.append(b, slot);
    }
    onDone(rating, box);
  };

  if (kind === 'recall') {
    const reveal = h('<button class="btn" type="button">Show answer</button>');
    const hint = h('<p class="q-hint">Say or write your answer first. Retrieval is what makes it stick.</p>');
    box.append(hint, reveal, after);
    box._reveal = () => reveal.click();
    reveal.onclick = () => {
      reveal.remove(); hint.remove();
      const ans = h(`<div class="q-answer">${fmt(data.a)}</div>`);
      const row = h(`<div class="rate" role="group" aria-label="How well did you recall it?">
        <button class="btn rate-0" data-r="0" type="button"><kbd>1</kbd> Missed it</button>
        <button class="btn rate-1" data-r="1" type="button"><kbd>2</kbd> Hard</button>
        <button class="btn rate-2" data-r="2" type="button"><kbd>3</kbd> Got it</button>
        <button class="btn rate-3" data-r="3" type="button"><kbd>4</kbd> Easy</button></div>`);
      box.insertBefore(ans, after); box.insertBefore(row, after);
      box._rate = r => { const b = row.querySelector(`[data-r="${r}"]`); b && b.click(); };
      row.onclick = e => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        row.querySelectorAll('button').forEach(x => { x.disabled = true; });
        b.classList.add('is-picked');
        finish(+b.dataset.r, '');
      };
    };
  } else if (kind === 'mc') {
    const list = h('<div class="choices" role="group"></div>');
    data.choices.forEach((c, i) => {
      const b = h(`<button class="choice" type="button"><kbd>${i + 1}</kbd><span>${fmt(c)}</span></button>`);
      b.onclick = () => {
        if (answered) return;
        const ok = i === data.answer;
        list.querySelectorAll('button').forEach((x, j) => { x.disabled = true; if (j === data.answer) x.classList.add('is-right'); });
        if (!ok) b.classList.add('is-wrong');
        finish(ok ? 2 : 0, `<p class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Correct.' : 'Not quite.'} ${fmt(data.why || '')}</p>`);
      };
      list.appendChild(b);
    });
    box._pick = i => { const b = list.children[i]; b && b.click(); };
    box.append(list, after);
  } else {
    const form = h(`<form class="numform"><label class="sr" for="numin">Your answer</label>
      <input id="numin" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 12.5">
      ${data.unit ? `<span class="q-unit">${fmt(data.unit)}</span>` : ''}<button class="btn" type="submit">Check answer</button></form>`);
    const msg = h('<p class="q-hint" hidden></p>');
    form.onsubmit = e => {
      e.preventDefault();
      if (answered) return;
      const raw = form.querySelector('input').value.trim().replace(/,/g, '').replace('−', '-');
      const val = Number(raw);
      if (raw === '' || !isFinite(val)) { msg.hidden = false; msg.textContent = 'Enter a number, like 12.5 or 3e8.'; return; }
      msg.hidden = true;
      const tol = data.tol ?? Math.abs(data.num) * 0.03;
      const ok = Math.abs(val - data.num) <= tol + 1e-12;
      form.querySelectorAll('input,button').forEach(x => { x.disabled = true; });
      finish(ok ? 2 : 0, `<p class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Correct.' : `Not quite. The answer is <strong>${data.num}${data.unit ? ' ' + fmt(data.unit) : ''}</strong>.`} ${fmt(data.why || '')}</p>`);
    };
    box.append(form, msg, after);
  }
  return box;
}

function codeExercise(lesson, onPass) {
  const ex = lesson.code, st = store.lessonState(lesson.id);
  const box = h(`<div class="codex">
    <div class="q-prompt">${fmt(ex.prompt)}</div>
    <label class="sr" for="ed-${lesson.id}">Python editor</label>
    <textarea id="ed-${lesson.id}" class="editor" spellcheck="false" autocapitalize="off" autocomplete="off" rows="${Math.min(22, Math.max(8, ex.starter.split('\n').length + 2))}"></textarea>
    <div class="codex-bar">
      <button class="btn" data-a="check" type="button">Run checks</button>
      <button class="btn btn-ghost" data-a="run" type="button">Run code</button>
      <button class="btn btn-ghost" data-a="hint" type="button">Show hint</button>
      <button class="btn btn-ghost" data-a="sol" type="button">Show solution</button>
      <button class="btn btn-ghost" data-a="reset" type="button">Restore starter</button>
    </div>
    <pre class="out" aria-live="polite" hidden></pre>
    <div class="codex-extra"></div></div>`);
  const ta = $('textarea', box), out = $('.out', box), extra = $('.codex-extra', box);
  ta.value = st.draft ?? ex.starter;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      const a = ta.selectionStart; ta.setRangeText('    ', a, ta.selectionEnd, 'end');
    }
  });
  let saveT = 0;
  ta.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => store.patchLesson(lesson.id, { draft: ta.value }), 400); });
  const show = (text, cls) => { out.hidden = false; out.className = 'out ' + (cls || ''); out.textContent = text; };
  let busy = false;
  async function run(withTests) {
    if (busy) return; busy = true;
    const btns = box.querySelectorAll('.codex-bar button'); btns.forEach(b => { b.disabled = true; });
    let loaded = false;
    const slow = setTimeout(() => { if (!loaded) show('Loading the Python runtime. The first run downloads about 10 MB; later runs are instant.', 'wait'); }, 350);
    show('Running…', 'wait');
    const res = await runPython(ta.value + (withTests ? '\n\n' + ex.tests + '\nprint("__PASS__")\n' : ''), { onStage: () => { loaded = true; show('Running…', 'wait'); } });
    clearTimeout(slow); busy = false; btns.forEach(b => { b.disabled = false; });
    const passed = withTests && res.ok && res.out.includes('__PASS__');
    const text = (res.out || '').replace('__PASS__\n', '').trimEnd();
    if (res.boot) show(`${res.err}\nPython runs in your browser and needs a connection the first time. Your code is saved; try Run again.`, 'err');
    else if (!res.ok) show((text ? text + '\n\n' : '') + tidyError(res.err, ta.value.split('\n').length), 'err');
    else if (withTests) show((text ? text + '\n\n' : '') + (passed ? 'All checks passed.' : 'Checks did not finish.'), passed ? 'ok' : 'err');
    else show(text || '(no output; use print() to see values)', '');
    if (passed) { store.patchLesson(lesson.id, { code: true }); onPass && onPass(); }
  }
  $('.codex-bar', box).onclick = e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'check') run(true);
    else if (a === 'run') run(false);
    else if (a === 'hint') { extra.innerHTML = `<p class="note">${fmt(ex.hint)}</p>`; }
    else if (a === 'sol') { extra.innerHTML = `<p class="note">One working solution. Read it, close it, then type your own from memory.</p>${codeBlock(ex.solution, 'python')}`; }
    else if (a === 'reset') { ta.value = ex.starter; store.patchLesson(lesson.id, { draft: ex.starter }); }
  };
  return box;
}

// ---- views ---------------------------------------------------------------------
function viewToday() {
  const st = store.load(), d = store.today();
  const due = store.dueCards(), cap = st.settings.reviewCap;
  const next = nextLesson(), doneToday = store.lessonsDoneOn(d), quota = st.settings.newPerDay;
  const total = LESSONS.length, done = doneCount(), streak = store.streak();
  const reviewedToday = st.days[d]?.r || 0;
  const quotaMet = doneToday >= quota;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const reviewCard = due.length
    ? `<section class="step"><div class="step-n">1</div><div class="step-b"><h2>Recall</h2>
        <p>${plural(Math.min(due.length, cap), 'card')} due from earlier lessons${due.length > cap ? ` (${due.length - cap} more held for later)` : ''}. About ${Math.max(1, Math.round(Math.min(due.length, cap) * 0.5))} min.</p>
        <a class="btn btn-primary" href="#/review">Start review</a></div></section>`
    : `<section class="step is-done"><div class="step-n">1</div><div class="step-b"><h2>Recall</h2>
        <p>${reviewedToday ? `Review done: ${plural(reviewedToday, 'card')} recalled today.` : done ? 'Nothing is due today. Cards return on a widening schedule.' : 'Your review queue fills as you finish lessons. Each lesson adds a few cards.'}</p></div></section>`;

  let lessonCard;
  if (!next) {
    lessonCard = `<section class="step is-done"><div class="step-n">2</div><div class="step-b"><h2>Course complete</h2><p>All ${total} lessons are done. Keep the review queue empty and revisit any lab from the Lab tab.</p></div></section>`;
  } else {
    lessonCard = `<section class="step ${quotaMet ? 'is-done' : ''}"><div class="step-n">2</div><div class="step-b">
      <h2>${quotaMet ? 'Today’s lesson is done' : 'Learn'}</h2>
      ${quotaMet ? `<p>Next up tomorrow:</p>` : ''}
      <div class="lesson-card"><div class="lesson-card-meta">Lesson ${next.index + 1} of ${total} · ${esc(next.unit.title)}</div>
        <h3>${esc(next.title)}</h3><p>${fmt(next.hook)}</p>${skillChip(next)}</div>
      <a class="btn ${quotaMet ? '' : (due.length ? '' : 'btn-primary')}" href="#/lesson/${next.id}">${quotaMet ? 'Start it now anyway' : 'Start lesson'}</a>
    </div></section>`;
  }

  main.innerHTML = `<div class="page">
    <header class="page-head"><p class="eyebrow">${dateStr}</p><h1>${done === 0 ? 'Day one' : quotaMet && !due.length ? 'Done for today' : 'Today'}</h1>
      <div class="tiles">
        <div class="tile"><span class="tile-v">${streak}</span><span class="tile-k">day streak</span></div>
        <div class="tile"><span class="tile-v">${done}<small>/${total}</small></span><span class="tile-k">lessons</span></div>
        <div class="tile"><span class="tile-v">${Object.keys(st.cards).length}</span><span class="tile-k">cards in rotation</span></div>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Course progress"><i style="width:${done / total * 100}%"></i></div>
    </header>
    ${store.canPersist() ? '' : '<p class="banner">This browser is blocking storage, so progress will not be saved after you close the tab. Allow site data for this page to keep your streak.</p>'}
    ${reviewCard}${lessonCard}
    ${done === 0 ? `<section class="how"><h2>How a session works</h2><ol>
      <li><strong>Recall.</strong> Answer cards from earlier lessons before seeing the answer. Cards you know come back later; cards you miss come back sooner.</li>
      <li><strong>Learn.</strong> One new lesson: a short idea, then a lab you control, with a mission to hit.</li>
      <li><strong>Check.</strong> A few questions, sometimes code. They join tomorrow’s recall queue.</li></ol></section>` : ''}
  </div>`;
}

function viewCourse() {
  const next = nextLesson();
  main.innerHTML = `<div class="page"><header class="page-head"><p class="eyebrow">${LESSONS.length} lessons · ${UNITS.length} units</p><h1>Course</h1>
    <p class="lede">Units mix math, physics, code and engineering so each idea is used soon after you learn it.</p></header>
    ${UNITS.map((u, ui) => {
      const dn = u.lessons.filter(l => store.isDone(l.id)).length;
      const open = next ? next.unit === u : ui === 0;
      return `<details class="unit" ${open ? 'open' : ''}><summary><span class="unit-n">${String(ui + 1).padStart(2, '0')}</span>
        <span class="unit-t"><strong>${esc(u.title)}</strong><span>${esc(u.blurb)}</span></span>
        <span class="unit-p">${dn}/${u.lessons.length}</span></summary>
        <ol class="lessons" start="${u.lessons[0].index + 1}">${u.lessons.map(l => {
          const dnL = store.isDone(l.id), ok = unlocked(l), isNext = next && next.id === l.id;
          const inner = `<span class="l-n">${l.index + 1}</span><span class="l-t">${esc(l.title)}</span>${skillChip(l)}<span class="l-s">${dnL ? 'Done' : isNext ? 'Next' : ok ? '' : 'Locked'}</span>`;
          return `<li class="${dnL ? 'is-done' : ''} ${isNext ? 'is-next' : ''} ${ok ? '' : 'is-locked'}">${ok ? `<a href="#/lesson/${l.id}">${inner}</a>` : `<span>${inner}</span>`}</li>`;
        }).join('')}</ol></details>`;
    }).join('')}
    <p class="fine">Lessons unlock in order. To jump around, turn on free roam in Progress.</p></div>`;
}

function viewLesson(id) {
  const l = byId[id];
  if (!l) return notFound();
  if (!unlocked(l)) {
    main.innerHTML = `<div class="page"><h1>${esc(l.title)}</h1><p>This lesson builds on earlier ones. Finish lesson ${nextLesson().index + 1} first, or turn on free roam in Progress.</p><a class="btn btn-primary" href="#/lesson/${nextLesson().id}">Open the next lesson</a></div>`;
    return;
  }
  const wasDone = store.isDone(l.id);
  const page = h(`<article class="page lesson"></article>`);
  page.appendChild(h(`<header class="page-head"><p class="eyebrow"><a href="#/course">Course</a> · Lesson ${l.index + 1} · ${esc(l.unit.title)}</p>
    <h1>${esc(l.title)}</h1><p class="lede">${fmt(l.hook)}</p>${skillChip(l)}</header>`));
  main.innerHTML = ''; main.appendChild(page);

  // Warm-up: pull cards from prerequisite lessons.
  const pool = [];
  (l.pre || []).forEach(pid => { const pl = byId[pid]; if (pl) pl.cards.forEach((c, i) => pool.push({ id: `${pid}:c${i}`, lesson: pl, kind: 'recall', data: c })); });
  pool.sort((a, b) => ((store.cardState(a.id)?.last ?? -1) - (store.cardState(b.id)?.last ?? -1)));
  const warm = wasDone ? [] : pool.slice(0, 2);

  const sections = [];
  const addSection = (title, tag, build) => sections.push({ title, tag, build });

  if (warm.length) addSection('Retrieve first', 'Warm-up', (sec, next) => {
    sec.appendChild(h(`<p class="sec-lede">This lesson builds on ${[...new Set(warm.map(w => `“${esc(w.lesson.title)}”`))].join(' and ')}. Pull these from memory before going on.</p>`));
    let left = warm.length;
    warm.forEach(w => sec.appendChild(question(w, r => { if (store.cardState(w.id)) store.rate(w.id, r); if (--left === 0) next(); }, { showLab: false })));
  });

  addSection('The idea', 'Learn', (sec, next) => { sec.appendChild(h(`<div class="prose">${body(l.body)}</div>`)); next(); });

  addSection('Lab', 'Do', (sec, next) => {
    if (l.labNote) sec.appendChild(h(`<p class="sec-lede">${fmt(l.labNote)}</p>`));
    const host = h('<div></div>'); sec.appendChild(host);
    sim(host, l, { done: !!store.lessonState(l.id).mission, onGoal: () => store.patchLesson(l.id, { mission: true }) });
    next();
  });

  const results = {};
  addSection('Check', 'Recall', (sec, next) => {
    let left = l.quiz.length;
    l.quiz.forEach((qd, i) => {
      const item = { lesson: l, kind: qd.choices ? 'mc' : 'num', data: qd };
      sec.appendChild(question(item, r => { results[i] = r; if (--left === 0) next(); }, { showLab: false }));
    });
    if (!l.quiz.length) next();
  });

  if (l.code) addSection('Code it', 'Python', (sec, next) => {
    sec.appendChild(codeExercise(l));
    next();
  });

  addSection('Lock it in', 'Finish', sec => {
    const ids = cardIds(l);
    const finishBtn = h(`<button class="btn btn-primary" type="button">${wasDone ? 'Back to Today' : 'Complete lesson'}</button>`);
    sec.appendChild(h(`<p>${wasDone ? 'You finished this lesson before. Its cards are already in your review rotation.' : `Completing adds ${plural(ids.length, 'card')} to your review rotation. The first review is tomorrow.`}</p>`));
    sec.appendChild(h(`<details class="cards-preview"><summary>Preview the recall cards</summary><ul>${l.cards.map(c => `<li>${fmt(c.q)}</li>`).join('')}</ul></details>`));
    sec.appendChild(finishBtn);
    finishBtn.onclick = () => {
      if (wasDone) return go('');
      store.completeLesson(l.id, ids);
      const nx = LESSONS[l.index + 1];
      sec.innerHTML = `<div class="done-card"><h3>Lesson complete</h3><p>${plural(ids.length, 'card')} scheduled. ${store.lessonState(l.id).mission || !l.sim.mission ? '' : 'The lab mission is still open if you want another try.'}</p>
        <div class="row"><a class="btn btn-primary" href="#/">Back to Today</a>${nx ? `<a class="btn" href="#/lesson/${nx.id}">Next: ${esc(nx.title)}</a>` : ''}</div></div>`;
      sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
  });

  let idx = 0;
  function reveal() {
    if (idx >= sections.length) return;
    const sdef = sections[idx++], isLast = idx === sections.length;
    const sec = h(`<section class="sec"><div class="sec-head"><span class="sec-tag">${sdef.tag}</span><h2>${sdef.title}</h2></div></section>`);
    page.appendChild(sec);
    const next = () => {
      if (isLast) return;
      if (wasDone) return reveal();
      const b = h('<button class="btn btn-primary sec-next" type="button">Continue</button>');
      b.onclick = () => { b.remove(); const before = page.lastElementChild; reveal(); before.nextElementSibling?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
      sec.appendChild(b);
    };
    sdef.build(sec, next);
  }
  reveal();
}

function viewReview() {
  const st = store.load();
  const queue = store.dueCards().slice(0, st.settings.reviewCap).map(id => ({ id, ...findCard(id) })).filter(x => x.lesson);
  // Interleave: avoid two cards from the same lesson back to back where possible.
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].lesson === queue[i - 1].lesson) {
      const j = queue.findIndex((x, k) => k > i && x.lesson !== queue[i].lesson);
      if (j > 0) [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }
  const total = queue.length;
  if (!total) {
    main.innerHTML = `<div class="page"><header class="page-head"><h1>Review</h1></header><div class="empty"><h2>Nothing due</h2><p>Cards come back on a widening schedule: about 1 day, 3 days, a week, then longer. Finishing a lesson adds new ones.</p><a class="btn btn-primary" href="#/">Back to Today</a></div></div>`;
    return;
  }
  let n = 0, missed = 0;
  const page = h(`<div class="page review"><header class="page-head"><p class="eyebrow">Spaced recall</p><h1>Review</h1>
    <div class="bar" role="progressbar" aria-label="Review progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0"><i style="width:0%"></i></div><p class="count"></p></header><div class="slot"></div></div>`);
  main.innerHTML = ''; main.appendChild(page);
  const slot = $('.slot', page);
  let cur = null;
  function show() {
    cleanup.forEach(f => f()); cleanup = [];
    if (!queue.length) {
      $('.bar i', page).style.width = '100%';
      $('.count', page).textContent = '';
      const nx = nextLesson(), quotaMet = store.lessonsDoneOn(store.today()) >= st.settings.newPerDay;
      slot.innerHTML = `<div class="empty"><h2>Review complete</h2><p>${plural(total, 'card')} recalled${missed ? `, ${missed} to see again tomorrow` : ''}.</p>
        <div class="row">${nx && !quotaMet ? `<a class="btn btn-primary" href="#/lesson/${nx.id}">Start today’s lesson</a>` : ''}<a class="btn" href="#/">Back to Today</a></div></div>`;
      keyHandler = null; return;
    }
    const item = queue.shift();
    $('.bar', page).setAttribute('aria-valuenow', n);
    $('.bar i', page).style.width = (n / total * 100) + '%';
    $('.count', page).textContent = `${Math.min(n + 1, total)} of ${total}${item.again ? ' · second pass' : ''}`;
    slot.innerHTML = '';
    slot.appendChild(h(`<p class="from">${skillChip(item.lesson)} <a href="#/lesson/${item.lesson.id}">Lesson ${item.lesson.index + 1}: ${esc(item.lesson.title)}</a></p>`));
    cur = question(item, (r, box) => {
      if (!item.again) { store.rate(item.id, r); n++; if (r === 0) missed++; }
      if (r === 0 && !item.again) queue.push({ ...item, again: true });
      const nb = h(`<button class="btn btn-primary q-next" type="button">${queue.length ? 'Next card' : 'Finish review'}</button>`);
      nb.onclick = show; box.appendChild(nb); cur._next = () => nb.click();
      nb.focus({ preventScroll: true });
    });
    slot.appendChild(cur);
  }
  keyHandler = e => {
    if (!cur || e.target.matches('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target.matches('button, a, summary')) return;
      e.preventDefault(); (cur._next || cur._reveal || (() => {}))();
    } else if (/^[1-4]$/.test(e.key)) {
      if (cur._rate) cur._rate(+e.key - 1); else if (cur._pick) cur._pick(+e.key - 1);
    }
  };
  show();
}

function viewLab(id) {
  if (id && byId[id]) {
    const l = byId[id];
    if (!unlocked(l)) return go('lab');
    main.innerHTML = `<div class="page"><header class="page-head"><p class="eyebrow"><a href="#/lab">Lab</a> · ${esc(SKILLS[l.skill].name)}</p><h1>${esc(l.title)}</h1><p class="lede">${fmt(l.hook)}</p></header><div class="host"></div>
      <p class="row"><a class="btn" href="#/lesson/${l.id}">Open the full lesson</a></p></div>`;
    sim($('.host', main), l, { done: !!store.lessonState(l.id).mission, onGoal: () => store.patchLesson(l.id, { mission: true }) });
    return;
  }
  const missions = LESSONS.filter(l => store.lessonState(l.id).mission).length;
  main.innerHTML = `<div class="page"><header class="page-head"><p class="eyebrow">${missions} of ${LESSONS.filter(l => l.sim.mission).length} missions complete</p><h1>Lab</h1><p class="lede">Every interactive in the course, open for free play once its lesson is unlocked.</p></header>
    ${UNITS.map(u => `<section class="lab-unit"><h2>${esc(u.title)}</h2><div class="lab-grid">${u.lessons.map(l => {
      const ok = unlocked(l), m = store.lessonState(l.id).mission;
      const inner = `<span class="lab-skill">${esc(SKILLS[l.skill].name)}</span><strong>${esc(l.title)}</strong><span class="lab-m">${ok ? (m ? 'Mission complete' : l.sim.mission ? 'Mission open' : 'Explore') : 'Locked'}</span>`;
      return ok ? `<a class="lab-card ${m ? 'is-done' : ''}" href="#/lab/${l.id}">${inner}</a>` : `<span class="lab-card is-locked">${inner}</span>`;
    }).join('')}</div></section>`).join('')}</div>`;
}

function viewProgress() {
  const st = store.load(), d = store.today();
  const fc = store.forecast(14), fmax = Math.max(1, ...fc);
  const allCards = LESSONS.flatMap(cardIds), mat = store.maturity(allCards);
  const weeks = 15;
  const cells = [];
  for (let k = d - weeks * 7 + 1; k <= d; k++) {
    const a = st.days[k] ? st.days[k].r + st.days[k].l * 5 : 0;
    cells.push(`<i class="hm hm-${a === 0 ? 0 : a < 6 ? 1 : a < 16 ? 2 : 3}" title="${store.dayToDate(k).toLocaleDateString()}: ${st.days[k] ? `${st.days[k].l} lessons, ${st.days[k].r} cards` : 'no activity'}"></i>`);
  }
  const trackRows = Object.entries(TRACKS).map(([tk, tn]) => {
    const skills = Object.entries(SKILLS).filter(([, s]) => s.track === tk);
    return `<section class="track"><h2>${tn}</h2><div class="skills">${skills.map(([sk, s]) => {
      const ls = LESSONS.filter(l => l.skill === sk), dn = ls.filter(l => store.isDone(l.id)).length;
      const m = store.maturity(ls.flatMap(cardIds));
      return `<div class="skill"><div class="skill-h"><span>${s.name}</span><span class="skill-c">${dn}/${ls.length}</span></div>
        <div class="bar bar-2" role="progressbar" aria-label="${s.name}: lessons done" aria-valuemin="0" aria-valuemax="${ls.length}" aria-valuenow="${dn}"><i style="width:${ls.length ? dn / ls.length * 100 : 0}%"></i><b style="width:${m.total ? m.mature / m.total * 100 : 0}%"></b></div></div>`;
    }).join('')}</div></section>`;
  }).join('');

  main.innerHTML = `<div class="page"><header class="page-head"><p class="eyebrow">Since ${st.started ? store.dayToDate(st.started).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'today'}</p><h1>Progress</h1>
    <div class="tiles">
      <div class="tile"><span class="tile-v">${doneCount()}<small>/${LESSONS.length}</small></span><span class="tile-k">lessons</span></div>
      <div class="tile"><span class="tile-v">${store.streak()}</span><span class="tile-k">day streak</span></div>
      <div class="tile"><span class="tile-v">${mat.seen}</span><span class="tile-k">cards learned</span></div>
      <div class="tile"><span class="tile-v">${mat.mature}</span><span class="tile-k">long-term (3+ weeks)</span></div>
    </div></header>
    <section class="panel"><h2>Reviews coming up</h2><div class="fc" role="img" aria-label="Cards due over the next 14 days: ${fc.join(', ')}">${fc.map((v, i) => `<div class="fc-col"><span class="fc-v">${v || ''}</span><i style="height:${v / fmax * 100}%"></i><span class="fc-d">${i === 0 ? 'now' : '+' + i}</span></div>`).join('')}</div></section>
    <section class="panel"><h2>Last ${weeks} weeks</h2><div class="heat">${cells.join('')}</div></section>
    <p class="fine legend"><span>Skill bars:</span><span><i class="sw sw-a"></i> lessons done</span><span><i class="sw sw-b"></i> cards in long-term memory</span></p>
    ${trackRows}
    <section class="panel settings"><h2>Settings</h2>
      <label class="set"><span>New lessons per day</span><select data-s="newPerDay">${[1, 2, 3].map(v => `<option ${st.settings.newPerDay === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="set"><span>Most review cards per day</span><select data-s="reviewCap">${[10, 20, 30, 50].map(v => `<option ${st.settings.reviewCap === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="set"><span>Appearance</span><select data-s="theme">${[['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<option value="${v}" ${st.settings.theme === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="set set-check"><input type="checkbox" data-s="freeRoam" ${st.settings.freeRoam ? 'checked' : ''}><span>Free roam: open any lesson in any order</span></label>
      <div class="row"><button class="btn" data-a="export" type="button">Download progress file</button><button class="btn" data-a="import" type="button">Load progress file</button><button class="btn btn-danger" data-a="reset" type="button">Erase progress</button></div>
      <input type="file" accept="application/json,.json" hidden>
      <p class="fine msg" aria-live="polite">Progress is stored in this browser only. Download a progress file to move it to another device.</p>
    </section></div>`;
  const panel = $('.settings', main), msg = $('.msg', panel), file = $('input[type=file]', panel);
  panel.onchange = e => {
    const k = e.target.dataset.s; if (!k) return;
    const s = store.load().settings;
    s[k] = e.target.type === 'checkbox' ? e.target.checked : (k === 'theme' ? e.target.value : +e.target.value);
    store.save(); if (k === 'theme') applyTheme();
  };
  panel.onclick = e => {
    const a = e.target.dataset.a;
    if (a === 'export') {
      const url = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
      const link = h(`<a download="defense-tech-progress-${new Date().toISOString().slice(0, 10)}.json"></a>`); link.href = url; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else if (a === 'import') file.click();
    else if (a === 'reset') {
      const b = e.target;
      if (b.dataset.armed) { store.reset(); applyTheme(); viewProgress(); }
      else { b.dataset.armed = '1'; b.textContent = `Erase ${doneCount()} lessons and all cards for good`; msg.textContent = 'This cannot be undone. Select the button again to erase, or leave this page to cancel.'; }
    }
  };
  file.onchange = async () => {
    try { store.importJSON(await file.files[0].text()); applyTheme(); viewProgress(); }
    catch (err) { msg.textContent = `That file could not be loaded (${err.message}). Choose a progress file downloaded from this app.`; }
  };
}

function notFound() {
  main.innerHTML = `<div class="page"><h1>Page not found</h1><p>That link does not match a lesson or view.</p><a class="btn btn-primary" href="#/">Back to Today</a></div>`;
}

function route() {
  cleanup.forEach(f => f()); cleanup = []; keyHandler = null;
  const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
  document.querySelectorAll('.nav a').forEach(a => {
    const on = a.dataset.v === (view || 'today') || (view === 'lesson' && a.dataset.v === 'course');
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const due = store.dueCards().length, badge = $('.nav [data-v=review] .badge');
  badge.textContent = due ? Math.min(due, 99) : ''; badge.hidden = !due;
  if (!view) viewToday();
  else if (view === 'course') viewCourse();
  else if (view === 'lesson') viewLesson(arg);
  else if (view === 'review') viewReview();
  else if (view === 'lab') viewLab(arg);
  else if (view === 'progress') viewProgress();
  else notFound();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

document.addEventListener('keydown', e => { if (keyHandler && !e.metaKey && !e.ctrlKey && !e.altKey) keyHandler(e); });
window.addEventListener('hashchange', route);
applyTheme();
route();
