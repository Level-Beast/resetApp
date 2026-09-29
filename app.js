'use strict';
/* ---------- helpers & storage ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = 'ease.';
const load = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dkey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const DEFAULTS = { vol: 0.6, sIn: 'rise', sOut: 'fall', sHold: 'bowl', sEnd: 'bowl', boreMin: 20, heatMin: 10, heatArea: 'Neck', wake: true, vibe: true };
let settings = Object.assign({}, DEFAULTS, load('settings', {}));
let programs = load('programs', null) || [
  { id: uid(), name: 'Box 4-4-4-4', in: 4, h1: 4, out: 4, h2: 4, cycles: 8 },
  { id: uid(), name: '4-7-8', in: 4, h1: 7, out: 8, h2: 0, cycles: 6 },
  { id: uid(), name: 'Slow 4-6', in: 4, h1: 0, out: 6, h2: 0, cycles: 12 }
];
let logs = load('logs', []);
const saveSettings = () => save('settings', settings);
const savePrograms = () => save('programs', programs);
const saveLogs = () => save('logs', logs);
const addLog = (type, secs, extra) => { logs.push(Object.assign({ id: uid(), t: Date.now(), type, secs: Math.round(secs) }, extra || {})); saveLogs(); };

/* ---------- audio (synthesised, so it works offline) ---------- */
let ctx = null, master = null;
function audio(vol) {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  master.gain.value = settings.vol * (vol == null ? 1 : vol);
  return ctx;
}
function voice(freq, t0, dur, o) {
  o = o || {};
  const osc = ctx.createOscillator(), g = ctx.createGain();
  const att = Math.min(o.att == null ? 0.4 : o.att, dur * 0.5);
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.peak || 0.2, t0 + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}
const SOUNDS = {
  rise:  { label: 'Rising swell',  fn: (t, d, p) => { const L = Math.min(Math.max(d, 1.5), 4); voice(220 * p, t, L, { to: 330 * p, peak: .26, att: L * .55 }); voice(330 * p, t, L, { to: 495 * p, peak: .12, att: L * .55 }); } },
  fall:  { label: 'Falling swell', fn: (t, d, p) => { const L = Math.min(Math.max(d, 1.5), 4); voice(330 * p, t, L, { to: 220 * p, peak: .26, att: L * .3 }); voice(495 * p, t, L, { to: 330 * p, peak: .1, att: L * .3 }); } },
  bowl:  { label: 'Singing bowl',  fn: (t, d, p) => { [[1, .3], [2.76, .14], [5.4, .06], [8.9, .025]].forEach(a => voice(196 * p * a[0], t, 5, { peak: a[1], att: .02 })); } },
  chime: { label: 'Soft chime',    fn: (t, d, p) => { [[1, .2], [2.4, .09], [3.1, .05]].forEach(a => voice(660 * p * a[0], t, 2.6, { peak: a[1], att: .01 })); } },
  pad:   { label: 'Warm pad',      fn: (t, d, p) => { const L = Math.min(Math.max(d, 2), 5); [174.6, 220, 261.6].forEach(f => voice(f * p, t, L, { peak: .11, att: L * .5 })); } },
  drop:  { label: 'Water drop',    fn: (t, d, p) => { voice(720 * p, t, .55, { to: 360 * p, peak: .3, att: .01 }); voice(540 * p, t + .18, .5, { to: 270 * p, peak: .1, att: .01 }); } },
  hum:   { label: 'Low hum',       fn: (t, d, p) => { const L = Math.min(Math.max(d, 2), 5); voice(110 * p, t, L, { peak: .3, att: L * .45 }); voice(220 * p, t, L, { peak: .08, att: L * .45 }); } },
  off:   { label: 'Silent',        fn: () => {} }
};
function play(name, dur, pitch, vol) {
  if (name === 'off' || !SOUNDS[name]) return;
  const c = audio(vol); if (!c) return;
  SOUNDS[name].fn(c.currentTime + 0.02, dur || 3, pitch || 1);
}
const buzz = ms => { if (settings.vibe && navigator.vibrate) navigator.vibrate(ms); };

/* ---------- wake lock ---------- */
let wl = null;
async function wakeOn() { if (!settings.wake || !('wakeLock' in navigator)) return; try { wl = await navigator.wakeLock.request('screen'); } catch (e) {} }
function wakeOff() { try { wl && wl.release(); } catch (e) {} wl = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (sess || bore || heat)) wakeOn();
});

/* ---------- navigation ---------- */
$$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.v));
function go(v) {
  $$('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'stats') renderStats();
  if (v === 'heat') renderHeat();
  if (v === 'still') renderStill();
  window.scrollTo(0, 0);
}

/* ---------- breathe: programs ---------- */
const fmtProg = p => {
  const a = ['in ' + p.in]; if (p.h1) a.push('hold ' + p.h1); a.push('out ' + p.out); if (p.h2) a.push('hold ' + p.h2);
  return a.join(' · ') + '  ×' + p.cycles;
};
function renderPrograms() {
  const box = $('#programs'); box.innerHTML = '';
  programs.forEach(p => {
    const el = document.createElement('div'); el.className = 'card prog';
    el.innerHTML = '<div><b></b><span></span></div><div class="row"><button class="btn ghost sm edit">Edit</button><button class="btn primary sm go">Start</button></div>';
    $('b', el).textContent = p.name; $('span', el).textContent = fmtProg(p);
    $('.edit', el).onclick = () => openEditor(p);
    $('.go', el).onclick = () => startSession(p);
    box.appendChild(el);
  });
}
$('#newProgram').onclick = () => openEditor(null);

let editing = null;
function openEditor(p) {
  editing = p ? p.id : null;
  const d = p || { name: '', in: 4, h1: 4, out: 4, h2: 0, cycles: 8 };
  $('#eTitle').textContent = p ? 'Edit program' : 'New program';
  $('#eName').value = d.name; $('#eIn').value = d.in; $('#eH1').value = d.h1;
  $('#eOut').value = d.out; $('#eH2').value = d.h2; $('#eCycles').value = d.cycles;
  $('#eDel').hidden = !p; $('#editor').hidden = false;
}
$('#eCancel').onclick = () => $('#editor').hidden = true;
$('#eSave').onclick = () => {
  const num = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? Math.round(v * 2) / 2 : def; };
  const p = { id: editing || uid(), name: $('#eName').value.trim(), in: num('#eIn', 4), h1: num('#eH1', 0), out: num('#eOut', 4), h2: num('#eH2', 0), cycles: Math.max(1, parseInt($('#eCycles').value, 10) || 8) };
  if (p.in + p.h1 + p.out + p.h2 <= 0) return;
  if (!p.name) p.name = [p.in, p.h1, p.out, p.h2].filter((x, i) => x || i !== 3).join('-');
  const i = programs.findIndex(x => x.id === p.id);
  if (i >= 0) programs[i] = p; else programs.push(p);
  savePrograms(); renderPrograms(); $('#editor').hidden = true;
};
$('#eDel').onclick = () => {
  if (!confirm('Delete this program?')) return;
  programs = programs.filter(x => x.id !== editing);
  savePrograms(); renderPrograms(); $('#editor').hidden = true;
};

/* ---------- breathe: session ---------- */
let sess = null;
const PHASE_TEXT = { in: 'Breathe in', h1: 'Hold', out: 'Breathe out', h2: 'Hold' };
function startSession(p) {
  const phases = [];
  [['in', p.in], ['h1', p.h1], ['out', p.out], ['h2', p.h2]].forEach(a => { if (a[1] > 0) phases.push({ k: a[0], d: a[1] }); });
  if (!phases.length) return;
  audio();
  sess = { p, phases, cycle: 0, i: 0, el: 0, total: 0, last: performance.now(), paused: false, done: false, logged: false };
  $('#sName').textContent = p.name;
  $('#sControls').hidden = false; $('#sDone').hidden = true;
  $('#sPause').textContent = 'Pause';
  $('#session').hidden = false;
  wakeOn(); enterPhase();
  sess.timer = setInterval(tick, 100);
  const frame = () => { if (!sess) return; draw(); sess.raf = requestAnimationFrame(frame); };
  sess.raf = requestAnimationFrame(frame);
}
function enterPhase() {
  const ph = sess.phases[sess.i];
  $('#sLabel').textContent = PHASE_TEXT[ph.k];
  $('#sRound').textContent = 'Round ' + (sess.cycle + 1) + ' of ' + sess.p.cycles;
  if (ph.k === 'in') play(settings.sIn, ph.d);
  else if (ph.k === 'out') play(settings.sOut, ph.d);
  else play(settings.sHold, ph.d, ph.k === 'h2' ? 0.75 : 1);
  buzz(25);
}
function tick() {
  if (!sess) return;
  const n = performance.now(), dt = (n - sess.last) / 1000; sess.last = n;
  if (sess.paused || sess.done) return;
  sess.el += dt; sess.total += dt;
  let guard = 0;
  while (sess && !sess.done && sess.el >= sess.phases[sess.i].d && guard++ < 50) {
    sess.el -= sess.phases[sess.i].d; nextPhase();
  }
}
function nextPhase() {
  sess.i++;
  if (sess.i >= sess.phases.length) {
    sess.i = 0; sess.cycle++;
    if (sess.cycle >= sess.p.cycles) return finishSession();
  }
  enterPhase();
}
function draw() {
  if (!sess || sess.done) return;
  const ph = sess.phases[sess.i], f = Math.min(sess.el / ph.d, 1), e = (1 - Math.cos(Math.PI * f)) / 2;
  const s = ph.k === 'in' ? 0.5 + 0.5 * e : ph.k === 'out' ? 1 - 0.5 * e : ph.k === 'h1' ? 1 : 0.5;
  $('#orb').style.transform = 'scale(' + s.toFixed(3) + ')';
  $('#sCount').textContent = Math.ceil(ph.d - sess.el);
}
function logSession() {
  if (!sess || sess.logged) return; sess.logged = true;
  if (sess.total >= 10) addLog('breath', sess.total, { name: sess.p.name });
}
function finishSession() {
  sess.done = true; logSession();
  play('chime', 3); buzz([60, 80, 60]);
  $('#sControls').hidden = true; $('#sDone').hidden = false;
  $('#sLabel').textContent = ''; $('#sCount').textContent = '';
  $('#orb').style.transform = 'scale(.5)';
  const m = Math.max(1, Math.round(sess.total / 60));
  $('#sSummary').textContent = sess.p.cycles + ' rounds · about ' + m + ' min';
}
function closeSession() {
  if (!sess) return;
  clearInterval(sess.timer); cancelAnimationFrame(sess.raf);
  logSession(); sess = null; wakeOff();
  $('#session').hidden = true;
}
$('#sPause').onclick = () => { if (!sess) return; sess.paused = !sess.paused; sess.last = performance.now(); $('#sPause').textContent = sess.paused ? 'Resume' : 'Pause'; };
$('#sSkip').onclick = () => { if (!sess || sess.done) return; sess.el = 0; nextPhase(); };
$('#sEnd').onclick = closeSession;
$('#sDoneBtn').onclick = closeSession;

/* ---------- stillness ---------- */
let bore = null;
function stepper(sel, key, min, max, cb) {
  $$(sel + ' [data-d]').forEach(b => b.onclick = () => {
    settings[key] = Math.min(max, Math.max(min, settings[key] + Number(b.dataset.d)));
    saveSettings(); cb();
  });
}
function renderStill() {
  $('#boreVal').textContent = settings.boreMin + ' min';
  $$('#boreChips button').forEach(b => b.classList.toggle('on', Number(b.dataset.m) === settings.boreMin));
}
$('#boreChips').innerHTML = [5, 10, 15, 20, 30, 45, 60].map(m => '<button data-m="' + m + '">' + m + '</button>').join('');
$$('#boreChips button').forEach(b => b.onclick = () => { settings.boreMin = Number(b.dataset.m); saveSettings(); renderStill(); });
stepper('#boreSteps', 'boreMin', 1, 240, renderStill);

$('#boreStart').onclick = () => {
  audio();
  bore = { start: Date.now(), dur: settings.boreMin * 60000, done: false, logged: false };
  $('#voidBtn').textContent = 'end';
  $('#void').hidden = false; wakeOn();
  bore.timer = setInterval(boreTick, 500);
};
function boreTick() {
  if (!bore || bore.done) return;
  if (Date.now() - bore.start >= bore.dur) {
    bore.done = true; clearInterval(bore.timer);
    logBore(bore.dur / 1000);
    play(settings.sEnd, 5, 1, 0.55); buzz([80, 120, 80]);
    $('#voidBtn').textContent = 'done'; wakeOff();
  }
}
function logBore(secs) { if (bore && !bore.logged) { bore.logged = true; addLog('bore', secs); } }
$('#voidBtn').onclick = () => {
  if (!bore) return;
  if (!bore.done) {
    clearInterval(bore.timer);
    const el = (Date.now() - bore.start) / 1000;
    if (el >= 60) logBore(el);
  }
  bore = null; wakeOff(); $('#void').hidden = true;
};

/* ---------- heat ---------- */
let heat = null;
const AREAS = ['Neck', 'Temples', 'Both'];
$('#heatAreas').innerHTML = AREAS.map(a => '<button data-a="' + a + '">' + a + '</button>').join('');
$$('#heatAreas button').forEach(b => b.onclick = () => { settings.heatArea = b.dataset.a; saveSettings(); renderHeat(); });
stepper('#heatSteps', 'heatMin', 1, 60, renderHeat);
const todayHeat = () => logs.filter(l => l.type === 'heat' && dkey(l.t) === dkey(Date.now()));
function renderHeat() {
  const t = todayHeat(), st = $('#heatStatus');
  if (t.length) {
    const l = t[t.length - 1];
    st.textContent = 'Done today · ' + (l.area || 'Heat') + (l.secs ? ', ' + Math.max(1, Math.round(l.secs / 60)) + ' min' : '');
    st.className = 'status done';
  } else { st.textContent = 'Not yet today'; st.className = 'status'; }
  $('#heatVal').textContent = settings.heatMin + ' min';
  $$('#heatAreas button').forEach(b => b.classList.toggle('on', b.dataset.a === settings.heatArea));
  $('#heatUndo').hidden = !t.length;
}
$('#heatStart').onclick = () => {
  audio();
  heat = { start: Date.now(), dur: settings.heatMin * 60000 };
  $('#heatIdle').hidden = true; $('#heatRun').hidden = false; $('#heatActions').hidden = true;
  wakeOn(); heat.timer = setInterval(heatTick, 250); heatTick();
};
function heatTick() {
  if (!heat) return;
  const left = heat.dur - (Date.now() - heat.start);
  if (left <= 0) { play('chime', 3); buzz([80, 120, 80]); addLog('heat', heat.dur / 1000, { area: settings.heatArea }); endHeat(); }
  else $('#heatClock').textContent = mmss(left / 1000);
}
function endHeat() {
  if (heat) clearInterval(heat.timer);
  heat = null; wakeOff();
  $('#heatIdle').hidden = false; $('#heatRun').hidden = true; $('#heatActions').hidden = false;
  renderHeat();
}
$('#heatCancel').onclick = endHeat;
$('#heatMark').onclick = () => { addLog('heat', 0, { area: settings.heatArea }); renderHeat(); };
$('#heatUndo').onclick = () => {
  const t = todayHeat(); if (!t.length) return;
  const id = t[t.length - 1].id; logs = logs.filter(l => l.id !== id); saveLogs(); renderHeat();
};

/* ---------- stats ---------- */
let gridFilter = 'all', selDay = null;
function byDay() {
  const m = {};
  logs.forEach(l => {
    const k = dkey(l.t);
    const d = m[k] = m[k] || { breath: { n: 0, s: 0 }, bore: { n: 0, s: 0 }, heat: { n: 0, s: 0 } };
    if (d[l.type]) { d[l.type].n++; d[l.type].s += l.secs || 0; }
  });
  return m;
}
function level(d, f) {
  if (!d) return 0;
  if (f === 'all') return ['breath', 'bore', 'heat'].filter(t => d[t].n > 0).length;
  const x = d[f];
  if (f === 'heat') return x.n ? 3 : 0;
  if (f === 'bore') { const m = x.s / 60; return m >= 30 ? 3 : m >= 10 ? 2 : m > 0 ? 1 : 0; }
  return x.n >= 3 ? 3 : x.n;
}
function streak(days, types) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const has = k => days[k] && types.some(t => days[k][t].n > 0);
  if (!has(dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const WEEKS = 16;
function renderStats() {
  const days = byDay(), grid = $('#grid'); grid.innerHTML = '';
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;
  const start = new Date(today); start.setDate(today.getDate() - dow - 7 * (WEEKS - 1));
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dkey(d), b = document.createElement('button');
    b.className = 'l' + level(days[k], gridFilter);
    if (d > today) b.classList.add('future');
    if (k === dkey(today)) b.classList.add('today');
    if (k === selDay) b.classList.add('sel');
    b.setAttribute('aria-label', k);
    b.onclick = () => { selDay = k; showDetail(k, days[k]); renderStats(); };
    grid.appendChild(b);
  }
  if (selDay) showDetail(selDay, days[selDay]);

  const last7 = []; for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); last7.push(d); }
  let boreS = 0, breathN = 0, breathS = 0, heatN = 0, allBore = 0;
  last7.forEach(d => { const x = days[dkey(d)]; if (x) { boreS += x.bore.s; breathN += x.breath.n; breathS += x.breath.s; if (x.heat.n) heatN++; } });
  Object.values(days).forEach(x => allBore += x.bore.s);
  const tile = (v, l) => '<div class="tile"><b>' + v + '</b><span>' + l + '</span></div>';
  $('#tiles').innerHTML =
    tile((boreS / 3600).toFixed(1) + ' h', 'Stillness this week') +
    tile((allBore / 3600).toFixed(1) + ' h', 'Stillness in total') +
    tile(heatN + ' of 7', 'Days heated this week') +
    tile(streak(days, ['heat']) + ' days', 'Heat streak') +
    tile(breathN + ' · ' + Math.round(breathS / 60) + ' min', 'Breathing this week') +
    tile(streak(days, ['breath', 'bore', 'heat']) + ' days', 'Any-activity streak');
  $('#heatDots').innerHTML = last7.map(d => {
    const on = days[dkey(d)] && days[dkey(d)].heat.n > 0;
    return '<div class="dot' + (on ? ' on' : '') + '"><i></i>' + 'SMTWTFS'[d.getDay()] + '</div>';
  }).join('');
}
function showDetail(k, d) {
  const nice = new Date(k + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  const m = s => Math.round(s / 60);
  const parts = d ? [
    'Breathing: ' + (d.breath.n ? d.breath.n + ' session' + (d.breath.n > 1 ? 's' : '') + ', ' + m(d.breath.s) + ' min' : 'none'),
    'Stillness: ' + (d.bore.n ? m(d.bore.s) + ' min' : 'none'),
    'Heat: ' + (d.heat.n ? 'done' : 'not done')
  ] : ['Nothing logged'];
  $('#gridDetail').innerHTML = '<b>' + nice + '</b><br>' + parts.join('<br>');
}
$$('#gridFilter button').forEach(b => b.onclick = () => {
  gridFilter = b.dataset.f;
  $$('#gridFilter button').forEach(x => x.classList.toggle('on', x === b));
  renderStats();
});

/* ---------- settings ---------- */
function fillSelect(id, key) {
  const s = $(id);
  s.innerHTML = Object.keys(SOUNDS).map(k => '<option value="' + k + '">' + SOUNDS[k].label + '</option>').join('');
  s.value = settings[key];
  s.onchange = () => { settings[key] = s.value; saveSettings(); play(s.value, 3); };
}
fillSelect('#sIn', 'sIn'); fillSelect('#sOut', 'sOut'); fillSelect('#sHold', 'sHold'); fillSelect('#sEnd', 'sEnd');
$$('[data-prev]').forEach(b => b.onclick = () => play($('#' + b.dataset.prev).value, 3));
$('#sVol').value = settings.vol;
$('#sVol').oninput = e => { settings.vol = Number(e.target.value); saveSettings(); };
$('#sVol').onchange = () => play(settings.sHold, 3);
$('#sWake').checked = settings.wake; $('#sWake').onchange = e => { settings.wake = e.target.checked; saveSettings(); };
$('#sVibe').checked = settings.vibe; $('#sVibe').onchange = e => { settings.vibe = e.target.checked; saveSettings(); };

$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'ease', settings, programs, logs }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'ease-backup-' + dkey(Date.now()) + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'ease' || !Array.isArray(d.logs) || !Array.isArray(d.programs)) throw 0;
      if (!confirm('Replace current data with this backup?')) return;
      settings = Object.assign({}, DEFAULTS, d.settings); programs = d.programs; logs = d.logs;
      saveSettings(); savePrograms(); saveLogs(); location.reload();
    } catch (err) { alert('That file is not an Ease backup.'); }
  };
  r.readAsText(f); e.target.value = '';
};
$('#resetBtn').onclick = () => {
  if (!confirm('Erase all programs, settings and history?')) return;
  ['settings', 'programs', 'logs'].forEach(k => localStorage.removeItem(LS + k)); location.reload();
};

/* ---------- init ---------- */
renderPrograms(); renderStill(); renderHeat();
/* ---------- install / PWA ---------- */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installStatus() {
  const msg = $('#installMsg'), btn = $('#installBtn');
  const sw = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'ready' : 'starting, reload once') : 'not supported here';
  if (isStandalone()) { msg.textContent = 'Running as an installed app. Offline: ' + sw + '.'; btn.hidden = true; return; }
  if (installEvt) { msg.textContent = 'Ready to install as a full app.'; btn.hidden = false; return; }
  btn.hidden = true;
  msg.textContent = 'Not installed yet. Offline: ' + sw + '. If Chrome offers only "Add to Home screen", open the site over https, reload once, then check the menu for "Install app". Remove any old shortcut first.';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installStatus(); });
window.addEventListener('appinstalled', () => { installEvt = null; installStatus(); });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; installStatus(); };
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './' }).then(installStatus).catch(installStatus);
  navigator.serviceWorker.addEventListener('controllerchange', installStatus);
}
installStatus();
