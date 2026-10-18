'use strict';
// Debug panel — a dev tool for testing changes without playing up to them.
//
// Deliberately self-contained: markup, styles and hotkeys all live in this file,
// so removing the panel is deleting one <script> tag. The only hooks outside are
// three lines in the main loop (time controls, fast-forward, per-frame readout)
// and one guard in game.js hurt() for invulnerability.
//
// Open: F1 or ` (Ё). Auto-opens with ?debug in the URL.
//
// Anything that touches a live run marks it tainted (r.cheated) — same rule as
// the hidden wave skip: a poked-at run must never write records or credits into
// the meta. Buttons in the META section change the save on purpose and say so.

const Debug = (() => {

// The release build (bundle.sh stamps window.CR_BUILD) ships WITHOUT the
// panel: no hotkeys, no «F1» hint, no ?debug — only the inert loop hooks
// main.js calls. Developers running the loose files keep everything.
if (typeof window !== 'undefined' && window.CR_BUILD) {
  return {
    timeScale: 1, frozen: false, noWarp: false, step: 0, teachAll: false,
    timeDt: dt => dt, frame: () => {}, togglePanel: () => {},
  };
}

const STYLE = `
#dbg { position: fixed; top: 0; right: 0; width: 268px; max-height: 100vh; overflow-y: auto;
  z-index: 200; background: rgba(6,5,14,.93); border-left: 1px solid #26d6ff55;
  color: #cfe8f5; font: 11px/1.35 ui-monospace, "SF Mono", Menlo, monospace;
  padding: 6px 8px 14px; backdrop-filter: blur(3px); }
#dbg.hidden { display: none; }
#dbg h4 { margin: 9px 0 4px; font-size: 10px; letter-spacing: .12em; color: #26d6ff;
  text-transform: uppercase; border-bottom: 1px solid #26d6ff33; padding-bottom: 2px; }
#dbg .row { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 3px; }
#dbg button { flex: 1 1 auto; min-width: 26px; padding: 3px 5px; cursor: pointer;
  background: #12203a; border: 1px solid #2b4a6b; border-radius: 3px;
  color: #cfe8f5; font: inherit; }
#dbg button:hover { background: #1c3355; border-color: #26d6ff; }
#dbg button.on { background: #26d6ff; border-color: #26d6ff; color: #05040c; font-weight: 700; }
#dbg button.warn { border-color: #ff2d4e55; color: #ff9ab0; }
#dbg .stat { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; }
#dbg .stat b { color: #7fa0b8; font-weight: 400; }
#dbg .stat span { color: #eafcff; text-align: right; }
#dbg .note { color: #6d8496; margin: 4px 0 0; font-size: 10px; }
#dbg .slider { flex: 1 1 100%; display: flex; align-items: center; gap: 6px; }
#dbg .slider span { color: #7fa0b8; white-space: nowrap; min-width: 58px; }
#dbg .slider input { flex: 1; accent-color: #26d6ff; min-width: 0; }
#dbg-tip { position: fixed; bottom: 6px; right: 8px; z-index: 199; color: #26d6ff66;
  font: 10px ui-monospace, monospace; pointer-events: none; }
`;

// ---------- Public state read by the main loop ----------
const D = {
  timeScale: 1,
  frozen: false,
  noWarp: false,
  teachAll: false, // every teaching word shows, whatever the profile has learned
  step: 0, // frames queued by the "кадр" button while frozen
};

// ---------- DOM helpers ----------
const el = (tag, cls, parent) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
};

let panel, tipEl;
const toggles = []; // {node, get} — re-synced on every readout tick

function section(title) {
  el('h4', null, panel).textContent = title;
  return el('div', 'row', panel);
}

function btn(row, label, fn, cls) {
  const b = el('button', cls, row);
  b.textContent = label;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); refresh(); });
  return b;
}

// A button that reads its lit/unlit state from `get` on every refresh.
function toggle(row, label, get, fn) {
  const b = btn(row, label, fn);
  toggles.push({ node: b, get });
  return b;
}

function note(text) {
  el('div', 'note', panel).textContent = text;
}

// A labelled slider for the genuinely continuous knobs (BPM). Everything else in
// the panel is a discrete toggle — reach for this only when stepping matters.
function slider(row, label, min, max, step, get, fn) {
  const wrap = el('label', 'slider', row);
  const cap = el('span', null, wrap);
  const input = el('input', null, wrap);
  input.type = 'range';
  input.min = min; input.max = max; input.step = step;
  input.value = get();
  const paint = () => { cap.textContent = `${label} ${input.value}`; };
  paint();
  input.addEventListener('input', e => { e.stopPropagation(); paint(); fn(+input.value); });
  // deliberately not registered in `toggles` — nothing outside the panel moves
  // these, and re-syncing mid-drag would fight the pointer
  return input;
}

// ---------- Run helpers ----------
const run = () => state.run;

// Every gameplay poke costs the run its honesty — see the file header. The
// recording dies with it: a poked run's replay would replay a lie.
function taint() {
  if (state.run) Game.taintRun(state.run);
}

// Rebuild the current wave from scratch (after act/wave/mutator changes).
function rebuild() {
  const r = run();
  if (!r) return;
  taint();
  Game.buildWave(state);
  hudArmor = ''; hudCombo = -1; hudMut = ''; // force a full HUD redraw
  Scene.setAct(actData(r.act).id);
  Sound.startMusic(actData(r.act).id);
}

function jump(dAct, dWave) {
  const r = run();
  if (!r) return;
  if (dWave) {
    r.wave += dWave;
    if (r.wave > Game.WAVES_PER_ACT) { r.wave = 1; r.act++; }
    if (r.wave < 1) { r.wave = Game.WAVES_PER_ACT; r.act--; }
  }
  r.act = Math.max(1, Math.min(r.endless ? 12 : Game.ACTS.length, r.act + (dAct || 0)));
  r.wave = Math.max(1, Math.min(Game.WAVES_PER_ACT, r.wave));
  rebuild();
}

let spawnSide = -1;   // -1 left, 1 right, 0 both
let spawnDist = 420;

function spawn(type) {
  const r = run();
  if (!r || state.phase !== 'combat') return;
  taint();
  const sides = spawnSide === 0 ? [-1, 1] : [spawnSide];
  if (type === 'twin') {
    // twins only make sense as a mirrored pair sharing one pair id
    const pair = 10000 + r.nextId;
    for (const s of [-1, 1]) {
      r.enemies.push({ id: r.nextId++, type: 'twin', side: s, dist: spawnDist,
        hits: Game.ENEMY_TYPES.twin.hits, thrown: false, pair });
    }
    return;
  }
  if (type === 'proj') {
    for (const s of sides) {
      r.enemies.push({ kind: 'proj', id: r.nextId++, owner: 0, side: s, dist: spawnDist,
        projSpeed: Game.ENEMY_TYPES.thrower.projSpeed });
    }
    return;
  }
  for (const s of sides) {
    r.enemies.push({ id: r.nextId++, type, side: s, dist: spawnDist,
      hits: Game.ENEMY_TYPES[type].hits, thrown: false });
  }
}

// Clear the field but keep the queue coming — the wave is not "cleared", just emptied.
function clearField() {
  const r = run();
  if (!r) return;
  taint();
  r.enemies = [];
}

// Pull the act Warden in right now, whatever wave we are on.
function summonBoss() {
  const r = run();
  if (!r || state.phase !== 'combat') return;
  taint();
  r.enemies = [];
  r.queue = [];
  r.boss = null;
  r.bossPending = true; // the next tick spawns him through the normal path
}

function setMutator(id) {
  const r = run();
  if (!r) return;
  r.forceMutator = id; // null — a guaranteed plain wave; undefined — roll as usual
  rebuild();
}

function giveImplant(id) {
  const r = run();
  if (!r) return;
  taint();
  const im = Game.IMPLANTS.find(x => x.id === id);
  if ((r.implants[id] || 0) >= im.stack) return;
  r.implants[id] = (r.implants[id] || 0) + 1;
  if (id === 'hp') r.hp = Math.min(r.hp + 1, Game.maxHp(state));
  hudArmor = ''; hudExec = '';
}

// ---------- Panel ----------
function build() {
  const style = el('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  panel = el('div', 'hidden', document.body);
  panel.id = 'dbg';
  // clicks inside the panel must never reach the canvas strike handler
  panel.addEventListener('pointerdown', e => e.stopPropagation());

  tipEl = el('div', null, document.body);
  tipEl.id = 'dbg-tip';
  tipEl.textContent = 'F1 — отладка';

  // --- status readout ---
  el('h4', null, panel).textContent = 'состояние';
  statEl = el('div', 'stat', panel);

  // --- navigation ---
  let row = section('навигация');
  btn(row, '◀ акт', () => jump(-1, 0));
  btn(row, 'акт ▶', () => jump(1, 0));
  btn(row, '◀ волна', () => jump(0, -1));
  btn(row, 'волна ▶', () => jump(0, 1));
  row = el('div', 'row', panel);
  btn(row, 'перезапустить волну', () => rebuild());
  row = el('div', 'row', panel);
  btn(row, 'забег', () => startGame());
  btn(row, 'бесконечность', () => startGame('endless'));
  btn(row, 'в меню', () => quitToMenu());

  // --- wave ---
  row = section('волна');
  btn(row, 'очистить поле', clearField);
  btn(row, 'скипнуть', () => doSkipWave());
  row = el('div', 'row', panel);
  btn(row, '☠ призвать стража', summonBoss);

  // --- mutators ---
  row = section('мутатор');
  toggle(row, 'ролл', () => run() && run().forceMutator === undefined, () => setMutator(undefined));
  toggle(row, 'нет', () => run() && run().forceMutator === null, () => setMutator(null));
  row = el('div', 'row', panel);
  for (const m of Game.MUTATORS) {
    toggle(row, m.icon + ' ' + Game.T(m, 'name').toLowerCase(),
      () => run() && run().forceMutator === m.id, () => setMutator(m.id));
  }

  // --- cutscenes ---
  // Preview shots over whatever scenery is on: the debug panel's job is to let
  // the timings be judged without replaying three acts to reach one bridge.
  row = section('кат-сцены');
  btn(row, '▶ интро', () => debugCinema('intro'));
  btn(row, '▶ финал', () => debugCinema('final'));
  row = el('div', 'row', panel);
  for (const a of Game.ACTS.slice(1)) {
    btn(row, '→ ' + Game.T(a, 'name').toLowerCase(), () => debugCinema(a.id));
  }

  // --- spawn ---
  row = section('спавн');
  toggle(row, '◀ слева', () => spawnSide === -1, () => { spawnSide = -1; });
  toggle(row, 'обе', () => spawnSide === 0, () => { spawnSide = 0; });
  toggle(row, 'справа ▶', () => spawnSide === 1, () => { spawnSide = 1; });
  row = el('div', 'row', panel);
  for (const d of [160, 280, 420, 620]) {
    toggle(row, d + '', () => spawnDist === d, () => { spawnDist = d; });
  }
  row = el('div', 'row', panel);
  for (const t of Object.keys(Game.ENEMY_TYPES)) {
    btn(row, Game.ENEMY_TYPES[t].name.toLowerCase(), () => spawn(t));
  }
  row = el('div', 'row', panel);
  btn(row, '✷ сюрикен', () => spawn('proj'));

  // --- cheats ---
  row = section('читы');
  toggle(row, '∞ бессмертие', () => !!(state.debug && state.debug.god), () => {
    state.debug = state.debug || {};
    state.debug.god = !state.debug.god;
    if (state.debug.god) taint();
  });
  btn(row, '+1 броня', () => {
    const r = run();
    if (!r) return;
    taint();
    r.hp = Math.min(r.hp + 1, Game.maxHp(state));
    hudArmor = '';
  });
  row = el('div', 'row', panel);
  btn(row, 'комбо +25', () => {
    const r = run();
    if (!r) return;
    taint();
    r.combo += 25;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
  });
  // the recorded score's thresholds: +5 steps across 10 to hear the swell,
  // the reset is a broken streak — mid-vocal it yanks the record
  btn(row, 'комбо +5', () => {
    const r = run();
    if (!r) return;
    taint();
    r.combo += 5;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
  });
  btn(row, 'сбросить комбо', () => {
    const r = run();
    if (!r) return;
    taint();
    r.combo = 0;
  });
  btn(row, 'убить героя', () => {
    const r = run();
    if (!r || state.phase !== 'combat') return;
    taint();
    if (state.debug) state.debug.god = false;
    r.hp = 1;
    r.enemies.push({ id: r.nextId++, type: 'drone', side: 1, dist: 6, hits: 1, thrown: false });
  }, 'warn');

  // --- implants ---
  row = section('импланты (по стаку за клик)');
  for (const im of Game.IMPLANTS) {
    btn(row, im.icon + ' ' + Game.T(im, 'name').toLowerCase(), () => giveImplant(im.id));
  }

  // --- time ---
  // Slowing or freezing time is superhuman reaction for free, so it costs a
  // live run its honesty like any other poke; 2×/4× only make life harder and
  // stay clean, noWarp is cosmetic.
  row = section('время');
  for (const k of [0.25, 0.5, 1, 2, 4]) {
    toggle(row, k + '×', () => D.timeScale === k, () => { D.timeScale = k; if (k < 1) taint(); });
  }
  row = el('div', 'row', panel);
  toggle(row, '⏸ стоп', () => D.frozen, () => { D.frozen = !D.frozen; if (D.frozen) taint(); });
  btn(row, '⏭ кадр', () => { D.step++; taint(); });
  toggle(row, 'без ускорения', () => D.noWarp, () => { D.noWarp = !D.noWarp; });
  note('«без ускорения» отключает перемотку пустого подхода');

  // --- sound ---
  // Knobs for the adaptive-audio spike: flip one factor at a time to hear what
  // each contributes. See the FLAGS block in audio.js.
  row = section('звук');
  const f = Sound.flags();
  toggle(row, '💥 вес ударов', () => f.weight, () => Sound.setFlag('weight', !f.weight));
  toggle(row, '🕳 обрыв на промахе', () => f.duck, () => Sound.setFlag('duck', !f.duck));
  row = el('div', 'row', panel);
  toggle(row, '🌊 дроп на комбо', () => f.drop, () => Sound.setFlag('drop', !f.drop));
  btn(row, '▸ дроп', () => { Sound.ensure(); Sound.dropMusic(); });
  row = el('div', 'row', panel);
  toggle(row, '🔒 лимитер', () => f.limiter, () => Sound.setFlag('limiter', !f.limiter));
  toggle(row, '🎭 тембр врагов', () => f.voices, () => Sound.setFlag('voices', !f.voices));
  row = el('div', 'row', panel);
  toggle(row, '🏛 реверб акта', () => f.space, () => Sound.setFlag('space', !f.space));
  toggle(row, '❤️ тревога', () => f.peril, () => Sound.setFlag('peril', !f.peril));
  row = el('div', 'row', panel);
  slider(row, 'простр. %', 0, 200, 5, () => f.spaceGain * 100, v => Sound.setFlag('spaceGain', v / 100));
  note('выше — включено. ниже — проверено на слух и не читается, оставлено выключенным');

  // --- solo hunt: mute music voices one at a time to find the offender ---
  row = section('голоса музыки');
  toggle(row, '🥁 бочка', () => f.mxKick, () => Sound.setFlag('mxKick', !f.mxKick));
  toggle(row, '🎩 хэты', () => f.mxHats, () => Sound.setFlag('mxHats', !f.mxHats));
  toggle(row, '👏 снейр', () => f.mxSnare, () => Sound.setFlag('mxSnare', !f.mxSnare));
  row = el('div', 'row', panel);
  toggle(row, '🎸 рифф/бас', () => f.mxBass, () => Sound.setFlag('mxBass', !f.mxBass));
  toggle(row, '🔪 стабы', () => f.mxStab, () => Sound.setFlag('mxStab', !f.mxStab));
  row = el('div', 'row', panel);
  toggle(row, '🎹 арпы', () => f.mxArp, () => Sound.setFlag('mxArp', !f.mxArp));
  toggle(row, '🎤 лид', () => f.mxLead, () => Sound.setFlag('mxLead', !f.mxLead));
  row = el('div', 'row', panel);
  toggle(row, '🌫 пады', () => f.mxPad, () => Sound.setFlag('mxPad', !f.mxPad));
  toggle(row, '🧵 швы', () => f.mxSeam, () => Sound.setFlag('mxSeam', !f.mxSeam));
  toggle(row, '✨ сталь', () => f.mxShim, () => Sound.setFlag('mxShim', !f.mxShim));
  note('охота на звук: выключай по одному, пока раздражитель не замолчит. '
     + '«швы» — подъём/спуск припева и тёрнэраунд, «сталь» — мерцание на комбо 30+');

  row = el('div', 'row', panel);
  toggle(row, '♪ ноты', () => f.notes, () => Sound.setFlag('notes', !f.notes));
  toggle(row, '▤ тиры', () => f.tiers, () => Sound.setFlag('tiers', !f.tiers));
  row = el('div', 'row', panel);
  toggle(row, '⇅ квант. питча', () => f.quantPitch, () => Sound.setFlag('quantPitch', !f.quantPitch));
  row = el('div', 'row', panel);
  toggle(row, '⏱ квант. времени (ур. 2)', () => f.quantTime, () => Sound.setFlag('quantTime', !f.quantTime));
  row = el('div', 'row', panel);
  // Coarser grid = more audible, more laggy. This is the trade the level-2
  // attempt got wrong by defaulting to 32nds — see gridSec in audio.js.
  for (const [d, label] of [[4, '¼'], [8, '⅛'], [16, '1/16'], [32, '1/32']]) {
    toggle(row, label, () => f.grid === d, () => Sound.setFlag('grid', d));
  }
  row = el('div', 'row', panel);
  slider(row, 'ноты %', 0, 600, 10, () => f.noteGain * 100, v => Sound.setFlag('noteGain', v / 100));
  row = el('div', 'row', panel);
  toggle(row, '🎧 панорама', () => f.pan, () => Sound.setFlag('pan', !f.pan));
  row = el('div', 'row', panel);
  slider(row, 'ширина %', 0, 100, 5, () => f.panWidth * 100, v => Sound.setFlag('panWidth', v / 100));
  row = el('div', 'row', panel);
  toggle(row, '🎵 музыка', () => f.music, () => Sound.setFlag('music', !f.music));
  toggle(row, '💥 удары', () => f.sfx, () => Sound.setFlag('sfx', !f.sfx));
  row = el('div', 'row', panel);
  toggle(row, 'тир: авто', () => f.tier === null, () => Sound.setFlag('tier', null));
  for (const t of [0, 1, 2, 3]) {
    toggle(row, String(t), () => f.tier === t, () => Sound.setFlag('tier', t));
  }
  row = el('div', 'row', panel);
  slider(row, 'BPM', 60, 200, 1, () => f.bpm, v => Sound.setFlag('bpm', v));
  note('сетка крупнее — слышнее, но нота ждёт дольше (макс. задержка в строке состояния). '
     + 'удары не задерживаются никогда');

  // --- feedback ---
  row = section('отклик');
  toggle(row, '📳 вибрация', () => Pad.getHaptics(), () => Pad.setHaptics(!Pad.getHaptics()));
  toggle(row, '💢 смак камеры', () => Scene.getFx().impact, () => Scene.setFx('impact', !Scene.getFx().impact));
  btn(row, '▸ тест вибро', () => Pad.test());
  note('вибрация — геймпад и телефон разом; смак — пинок камеры, punch-зум и кольца');

  // --- render ---
  row = section('картинка');
  for (const [id, label] of [['bloom', '✦ блум'], ['signLight', '💡 свет вывесок'],
                             ['foreground', '▤ передний план'], ['grain', '▚ зерно']]) {
    toggle(row, label, () => Scene.getFx()[id], () => Scene.setFx(id, !Scene.getFx()[id]));
  }
  note('выключается по одному — так видно вклад каждого');

  // --- meta ---
  row = section('мета (пишется в сейв!)');
  btn(row, '+1000 ㋕', () => { state.meta.credits += 1000; saveState(); });
  btn(row, 'мета в макс', () => {
    for (const m of Game.META) state.meta.upgrades[m.id] = m.cap;
    saveState();
  });
  row = el('div', 'row', panel);
  btn(row, 'открыть ∞', () => { state.meta.stats.wins = Math.max(1, state.meta.stats.wins); saveState(); });
  btn(row, 'все трофеи', () => {
    for (const a of Game.ACHIEVEMENTS) state.meta.ach[a.id] = true;
    saveState();
  });
  note('забег с любой правкой помечается «без зачёта» — рекорды и кредиты в мету не идут');
  row = section('обучение');
  toggle(row, 'обучение: всегда', () => D.teachAll, () => { D.teachAll = !D.teachAll; });
  note('подсказки новичков видны, даже если профиль их уже прошёл; сейв не трогается')
}

// ---------- Live readout ----------
let statEl, fps = 60, statT = 0;

const stat = (k, v) => `<b>${k}</b><span>${v}</span>`;

function readout() {
  const r = run();
  const rows = [
    stat('fps', fps.toFixed(0)),
    stat('фаза', state.phase),
  ];
  if (r) {
    rows.push(
      stat('акт/волна', `${r.act}/${r.wave}${r.endless ? ' ∞' : ''}`),
      stat('броня', `${r.hp}/${Game.maxHp(state)}`),
      stat('комбо', `${r.combo} (макс ${r.bestCombo})`),
      stat('на поле / в очереди', `${r.enemies.length} / ${r.queue.length}`),
      stat('мутатор', r.mutator || '—'),
      stat('страж', r.boss ? `${r.boss.state} фаза ${r.boss.phase + 1}/${r.boss.phases}` : (r.bossPending ? 'ждёт' : '—')),
      stat('зона удара', Game.range(state).toFixed(0)),
      stat('до контакта', Game.threatEta(state).toFixed(2) + ' c'),
      stat('стан', r.stun > 0 ? r.stun.toFixed(2) + ' c' : '—'),
      stat('счёт / ㋕', `${r.score} / ${r.credits}`),
      stat('зачёт', r.cheated ? 'НЕТ' : 'да'),
    );
  }
  rows.push(stat('время', (D.frozen ? 'стоп' : D.timeScale + '×') + (D.noWarp ? ' · без уск.' : '')));
  const sf = Sound.flags();
  rows.push(stat('тир / нота', `${Sound.tier()}${sf.tier === null ? '' : ' (фикс)'}` +
    ` / ${r ? Sound.rung(r.combo).toFixed(3) : '—'}`));
  rows.push(stat('сетка / лаг', sf.quantTime
    ? `1/${sf.grid} · до ${(Sound.gridSec() * 1000).toFixed(0)} мс`
    : 'выкл'));
  statEl.innerHTML = rows.join('');
}

function refresh() {
  for (const t of toggles) t.node.classList.toggle('on', !!t.get());
  if (statEl) readout();
}

// ---------- Loop hooks (called from main.js) ----------
// Applies the panel's time controls to a frame's dt.
D.timeDt = dt => {
  if (!D.frozen) return dt * D.timeScale;
  if (D.step > 0) { D.step--; return 1 / 60; }
  return 0;
};

// Per-frame bookkeeping: FPS average and a throttled readout.
D.frame = rawDt => {
  if (rawDt > 0) fps += (1 / rawDt - fps) * 0.1;
  if (panel.classList.contains('hidden')) {
    // the hint stays discoverable but never sits over the game itself
    tipEl.style.display = activeScreen === 'menu' ? '' : 'none';
    return;
  }
  statT += rawDt;
  if (statT > 0.2) { statT = 0; refresh(); }
};

D.togglePanel = () => {
  const hidden = panel.classList.toggle('hidden');
  tipEl.style.display = hidden ? '' : 'none';
  if (!hidden) refresh();
};

// ---------- Startup ----------
build();
refresh();
document.addEventListener('keydown', e => {
  if (e.code === 'F1' || e.code === 'Backquote') {
    e.preventDefault();
    D.togglePanel();
  }
});
if (location.search.includes('debug')) D.togglePanel();

return D;
})();
