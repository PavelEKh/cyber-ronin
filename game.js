'use strict';
// @ts-check — checked by `npx tsc -p jsconfig.json` in CI (implicit any allowed;
// the point is catching typo'd state fields and impossible comparisons for free)
// Pure game logic of Cyber Ronin — a two-button roguelite slasher.
// The hero stands at the center, enemies rush from both sides, two buttons: strike left / strike right.
// Loaded in the browser via <script src="game.js"> (global Game object)
// and in Node via require — this allows testing the logic without a browser.
// All distances are in abstract "units" (hero at zero); the UI converts them to pixels.
(() => {

// ---------- Seeded random ----------
// Two mulberry32 streams with one contract between them:
//   rnd(s)      — COMBAT noise over state.rngState: knocks, rain sides, Warden
//                 chains, gusts. Deterministic given the seed AND the actions
//                 (all a replay needs) — but chaotically sensitive to play, so
//                 across daily ATTEMPTS these reaction tests stay effectively
//                 fresh: a chain learned on attempt one won't repeat on two.
//                 That unpredictability is a design decision (2026-07-31) —
//                 do not move these draws onto the plan stream.
//   rndPlan(r)  — the PLAN stream over run.planRng: wave composition, mutator
//                 rolls and implant offers. Deterministic given the seed and
//                 the pick history ALONE — combat noise must not touch it,
//                 or two daily runs on the shared seed would drift apart the
//                 moment one player knocked a punk the other let through.
function rnd(s) {
  let t = (s.rngState = (s.rngState + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rndPlan(r) {
  if (r.planRng == null) r.planRng = 1; // a pre-1.1 mid-run save joins the stream here
  let t = (r.planRng = (r.planRng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}


// ---------- Language ----------
// Default is ru: Node tests and the simulation work unchanged. The UI calls setLang.
// Russian is the source of truth, English lives beside it in the data; every
// FURTHER language is an overlay pack registered from ui/lang.js — a dict
// keyed by the exact Russian string. A key the pack misses falls back to
// English, so dynamic (interpolated) lines and untranslated prose degrade
// readably instead of breaking. Editing a Russian string silently retires its
// translations to English until the pack catches up — degradation, not a bug.
let LANG = 'ru';
// Every language is one RESOLVER (ru, en) → string, all living in one
// registry: ru returns the source, en its inline pair, and a registered pack
// closes over its dictionary with the English fallback. setLang swaps the
// active resolver once — L is a single call with no special cases, and T is
// just L applied to a data field (element by element for line arrays).
const RESOLVERS = {
  ru: ru => ru,
  en: (ru, en) => en,
};
function registerLang(code, pack) {
  RESOLVERS[code] = (ru, en) => (pack[ru] !== undefined ? pack[ru] : en);
}
let resolve = RESOLVERS.ru;
function setLang(l) {
  LANG = RESOLVERS[l] ? l : 'en';
  resolve = RESOLVERS[LANG];
}
function getLang() { return LANG; }
// L('rus','eng') — for generated strings; T(obj,'name') — for data fields
function L(ru, en) { return resolve(ru, en); }
function T(obj, field) {
  const ru = obj[field];
  const en = obj.en && obj.en[field] !== undefined ? obj.en[field] : ru;
  if (Array.isArray(ru)) {
    return ru.map((line, i) => L(line, Array.isArray(en) ? en[i] : line));
  }
  return typeof ru === 'string' ? L(ru, en) : en;
}
// F('шаблон {n}', 'template {n}', {n: 5}) — interpolated lines. The RUSSIAN
// TEMPLATE, placeholders and all, is the pack key, so dynamic strings
// translate exactly like static ones; substitution happens after lookup.
function F(ru, en, params) {
  let s = L(ru, en);
  for (const k in params) s = s.split('{' + k + '}').join(params[k]);
  return s;
}

// ---------- Simulation step ----------
// The logic advances in EXACT quanta of STEP: the UI accumulates real time and
// feeds whole steps, the sim bot already runs at 1/60, and every replay is a
// list of actions pinned to integer tick numbers. Slow-mo, hitstop and the
// empty-approach fast-forward only change how many steps play per real frame —
// they can never change what happens inside one.
const STEP = 1 / 60;
// ---------- Version ----------
// Three numbers, three contracts — MAJOR.REPLAY.COSMETIC, born at 1.0.0:
//   MAJOR    — global gameplay overhauls: the game plays differently.
//   REPLAY   — any change that shifts the SIMULATION (balance constants, wave
//              generation, RNG order, tick pipeline). Resets on a major bump.
//   COSMETIC — everything else: UI, text, art, sound, the worker. Resets on
//              either bump above. Replays cross it freely.
// A recording is stamped with the REPLAY EPOCH — "MAJOR.REPLAY" — and refuses
// to cross it: an old tape on a new sim would diverge silently, so it is
// rejected loudly instead. Bumping the epoch retires stored replays (board
// ROWS survive). The full version shows in the menu corner.
const VERSION_MAJOR = 1;
const VERSION_REPLAY = 8; // 1.8: a fuller first act, longer Warden duels, a duel holds against a cut away, newcomers staged alone, waves in phrases
                          // (1.6: the pool trades its dead pair (stasis, intercept) + the road learns its weather)
                          // (1.6: the pool trades its dead pair — the Stasis Discharge freezes the struck zone, the Intercept re-aims deflected steel)
                          // (1.5: the arc's follow-through is forgiven — a press into the side a sweep just cleared is not a whiff)
                          // (1.4: stances — the two buttons keep their sides and change what a press means)
                          // (1.3: an execute on a twin takes the pair, and the chord charges the execute counter)
                          // (1.2: the combo multiplier caps at ×3.5 — score favors depth over one unbroken tail)
                          // (1.1: the early-press buffer — a swing at an empty zone waits for its target)
const VERSION_COSMETIC = 0;
const VERSION = `${VERSION_MAJOR}.${VERSION_REPLAY}.${VERSION_COSMETIC}`;
const REPLAY_EPOCH = `${VERSION_MAJOR}.${VERSION_REPLAY}`;

// ---------- Combat constants ----------
const BASE_RANGE = 150;   // base strike range
// The early-press buffer: a swing that found the zone empty hangs in the air
// this long, and lands the moment its target crosses into reach. Rhythm-game
// forgiveness — the difference between "hard but fair" and "the game cheated
// me out of a frame". One queued press per side; a second press on the same
// side while one waits is spam and flubs immediately (see resolveCrowd), so the
// mash exploit — hold a permanent buffer, never eat a miss — cannot exist.
const PRESS_BUFFER = 5 * STEP; // ~83ms, tuned to feel like the press "counted"
const HIT_DIST = 34;      // an enemy this close lands a hit on the hero
const SPAWN_DIST = 860;   // where enemies spawn
// Where a knocked punk lands on the other side: ON THE EDGE of the strike
// zone, plus a small scatter outside it. Landing deep used to hand the pair of
// presses a dead pause; landing at the rim keeps the rhythm — flip, a step,
// strike. Tied to range(s), so the zone's implants move the landing with it.
const KNOCK_EDGE_PAD = 8;   // just outside the rim — a beat of approach remains
const KNOCK_SPREAD = 34;
const PUSHBACK = 45;      // pushback of a non-swapped enemy after a hit
const MERCY_DIST = 350;   // after the hero is wounded, nearby enemies retreat at least this far
const FOLLOW_GAP = 50;    // a follower never gets closer to the one in front — the crowd queues up
// minimum interval between arrivals into the strike zone per side (sec)
const sideArrGap = act => Math.max(0.28, 0.42 - (act - 1) * 0.04);
// global minimum arrival interval (both sides combined, sec):
// the combined press rate must stay physically possible; pincers are the exception
const anyArrGap = act => Math.max(0.2, 0.3 - (act - 1) * 0.03);
const KILL_PUSH = 30;  // a kill pushes back the next enemy in the column — the wave "rolls back"
const DASH_STOP = 56;  // dash: the hero stops this many units short of the victim
const DASH_HIT = 36;   // lunge distance on a non-killing hit
const BASE_STUN = 0.65;   // seconds of penalty for swinging at air
// A miss now costs twice: the hero hangs, AND the crowd smells blood and rushes.
// The surge lasts exactly as long as the stun, which makes it one punishment with
// two faces: it cannot stack (a stunned hero cannot miss again) and the Reflex
// Chip shortens both. Shurikens already in flight keep their own speed — you
// cannot answer them while stunned anyway, so speeding them up is only cruelty.
// 1.18 chosen off sim.js: it costs a skilled player nothing and a mid player
// ~16% of run length. The surge is a pure accuracy filter — raising it further
// punishes only the players who already miss most.
// And a filter belongs on a road that has already taught the zone: act I is a
// primer here like everywhere else (stances arrive with act II, mutators with
// act II, seals with IV), so the crowd only learns to smell blood from the
// second act on. The novice's death spiral was miss → stun → surge → wound,
// repeated until quit — the career sim priced act I at 45+ of 60 novice
// deaths. In the primer a miss still stuns; it just no longer feeds the wave.
const MISS_SURGE = 1.18;
const SURGE_ACT = 2;
// The teach: the first few times the crowd actually rushes, the UI names it —
// the speed streaks alone read as noise until the rule is said out loud.
const TEACH_SURGE = 2;
const BASE_HP = 3;
const WAVES_PER_ACT = 3;
// Stasis Discharge: every Nth CONNECTED press arms the blade, and the armed
// strike freezes every other walker on the struck SIDE — the whole column
// stands still while the hand works the other one. The reach was the strike
// zone at first, and the implant read as a no-op: in the game's actual rhythm
// the zone is empty (bodies die on entry, the kill's rollback shoves the
// next one out), so the discharge kept firing into nothing. The side is the
// honest unit — that is what the eye tracks and what the freeze must answer.
// One exception, for the hand's sake: a body whose walk would carry it into
// the zone before the hold expires keeps marching (see hitEnemy) — freezing
// it would bait the press already committed to its arrival into a whiff.
// The charge is monotonic (a miss does not advance it, but never wipes it):
// its predecessor, the Arc Discharge, charged with success and reset in
// trouble, which made it absent exactly when it was needed — and its bolt
// killed BEYOND the zone, buying future time while runs died in the present.
const STASIS_EVERY1 = 6;
const STASIS_EVERY2 = 5;   // the second stack arms faster and holds longer
const STASIS_HOLD1 = 0.8;  // sec a discharged side stands still
const STASIS_HOLD2 = 1.2;
// The forgiveness for the arc. SWEEP takes every
// body in reach on its side in one motion — which is the point — and the hand
// that was already swinging for the second of them finds an empty street. The
// press was aimed at a body the previous press had legally removed, so counting
// it as a whiff punished the same swing twice: the arc pays one link of streak
// for the whole crowd (deliberate), and then the follow-through paid the whole
// streak plus a stun (not). Measured: three drones in reach, blade leaves the
// combo at 3, sweep at 0.
const SWEEP_GRACE = 0.4;
// Emergency Capacitor: the lethal hit is survived at 1 armor, once per run, and
// the discharge hurls every walker at least this far out — twice the mercy
// distance, so the save buys a real breath and not just the next contact frame.
const GUARD_REPEL = MERCY_DIST * 2;
// Static Jammer: the anti-steel counter-implant. Each stack stretches the
// thrower's wind-up by half (the telegraph reads longer) and slows every
// shuriken in flight — the thrower's, the steel rain's and the Armorer's
// alike. Reflected blades fly at the same jammed speed: the implant scrambles
// the blade's drive, not its allegiance, and a one-sided speed-up would make
// the Armorer rally unreadable in the other direction.
const JAM_WINDUP = 0.5;  // wind-up share added per stack
const JAM_PROJ = 0.15;   // shuriken speed share removed per stack
// Decryptor: each stack stretches the Warden chain timer by this share. It is
// the only implant aimed at the duel — timeouts, the Maglev squeeze and long
// deep-act chains are exactly where runs end past act III.
const HACK_TIMER = 0.35;
// ---------- Boss (the act-ending Warden) ----------
const BOSS_SPEED = 78;     // units/s, multiplied by act speed
const BOSS_RETREAT = 430;  // where he retreats after contact or a QTE fault
// 1.8: three links longer from the first Warden on (act I: 7·8·9) and a
// longer cap; past the opening duel every Warden fights four rounds.
const BOSS_QTE_LEN = (act, phase) => Math.min(14, 6 + act + phase); // sequence length (capped for endless)
const BOSS_QTE_PRESS = act => Math.max(0.45, 0.8 - (act - 1) * 0.07); // seconds per press
const BOSS_PHASES = act => (act >= 2 ? 4 : 3);
// Each act's Warden has a signature trick; in endless mode the four cycle.
// kind 1 — baseline QTE; 2 — Maglev: wind gusts hurl him forward;
// 3 — Admin Oni: glitch links are displayed inverted, press the opposite side;
// 4 — Core Shogun: a broken phase summons minions.
// Every Warden now guards a campaign act (see ACTS.boss); endless cycles the
// campaign order past the summit. BOSS_KINDS stays the roster size — the save
// loader walks it when restoring per-Warden meeting counts.
const BOSS_KINDS = 6;
const bossKind = act => ACTS[(act - 1) % ACTS.length].boss;
// The Armorer (kind 5): shuriken cadence and the reward for throwing them back.
const ARMORER_THROW_MIN = 380; // he only throws from beyond this: the blade's whole
                               // flight stays readable, and it clears max range (~257)
const ARMORER_THROW_T = 1.5;   // sec between throws, plus up to ARMORER_THROW_RND
const ARMORER_THROW_RND = 0.8;
const ARMORER_RALLY_CAP = 3;   // he bats a return back at most this many times: the rally grows
                               // over the first throws, then holds — uncapped, a long fight (every
                               // retreat buys another throw) ran it to 8–10 returns, an endless ping-pong
const ARMORER_BURN_CAP = 3;    // banked burns cap, and a burned chain never drops below
const ARMORER_BURN_FLOOR = 3;  // this many links — the duel must still be a duel
const GUST_MULT = 3.2;   // Maglev gust speed multiplier
const GUST_TIME = 0.3;   // gust duration, sec
// The wind is the Maglev Warden's whole identity, so it reaches both halves of
// his fight: it steals anticipation on the approach and compresses the chain.
// Both halves keep a hard fairness floor — the wind squeezes, it never robs.
const GUST_FLOOR = 0.55;     // sec: a gust dies rather than eat the in-zone reaction window
const GUST_ZONE_K = 0.75;    // the wind may carry him through the first QUARTER of the zone:
                             // only past that depth does the reaction-floor check bite
const GUST_TELE = 0.4;       // sec of howl before a chain gust bites — always announced
const GUST_SQUEEZE = 0.72;   // chain gust: the remaining QTE timer is cut to this share
const GUST_MIN_PRESS = 0.26; // sec per remaining press the squeeze may never go below
const GLITCH_CHANCE = 0.3; // Admin Oni: chance a QTE link is glitch-inverted
// the side the QTE link SHOWS (glitched links display the opposite of the true press)
const qteShown = (b, i) => (b.glitch && b.glitch[i] ? -b.seq[i] : b.seq[i]);
const BOSS_CREDITS = 15;   // ×act number (and ×credit multiplier)
const BOSS_SCORE = 400;    // ×act number
const VICTORY_BONUS = 1.5; // credit multiplier for a full clear

// ---------- Acts ----------
// Six acts; `boss` is the act's Warden kind. The road: the city's own streets
// and its market of fakes, then the corporate maglev, the bay by cargo deck,
// and the arcology — server hall to summit garden. The Double guards the
// market because everything there is a copy, himself included; the Armorer
// guards the ship because sea wind and thrown steel are his native weather.
const ACTS = [
  { id: 'street', boss: 1, name: 'Неоновая улица',  sub: 'Дождь. Вывески. Первая кровь.',
    en: { name: 'Neon Street',     sub: 'Rain. Signs. First blood.' } },
  { id: 'market', boss: 6, name: 'Ночной рынок',    sub: 'Всё, что блестит, — подделка. Кроме стали.',
    en: { name: 'Night Market',    sub: 'Everything that shines is fake. Except the steel.' } },
  { id: 'train',  boss: 2, name: 'Крыша маглева',   sub: 'Город проносится мимо на 400 км/ч.',
    en: { name: 'Maglev Rooftop',  sub: 'The city rushes past at 400 km/h.' } },
  { id: 'ship',   boss: 5, name: 'Грузовой левиафан', sub: 'Палуба качается. Залив глотает неон.',
    en: { name: 'Cargo Leviathan', sub: 'The deck rolls. The bay swallows the neon.' } },
  { id: 'server', boss: 3, name: 'Серверный зал',   sub: 'Сердце корпорации «Кагэ».',
    en: { name: 'Server Hall',     sub: 'The heart of Kage Corp.' } },
  { id: 'garden', boss: 4, name: 'Сад дзен',        sub: 'Вершина аркологии. Тишина перед финалом.',
    en: { name: 'Zen Garden',      sub: 'Arcology summit. Silence before the end.' } },
];

// ---------- Enemies ----------
// hits — strikes to kill; swap — knocked across to the other side after a hit;
// throwDist/projSpeed — thrower: stops and hurls a shuriken that can be deflected.
const ENEMY_TYPES = {
  drone:   { name: 'Дрон',     en: { name: 'Drone' },    hits: 1, speed: 132, credits: 1, score: 10 },
  punk:    { name: 'Трейсер',  en: { name: 'Tracer' },     hits: 2, speed: 100, credits: 2, score: 25, swap: true },
  shield:  { name: 'Щитовик',  en: { name: 'Shielder' }, hits: 3, speed: 72,  credits: 4, score: 40 },
  thrower: { name: 'Метатель', en: { name: 'Thrower' },  hits: 1, speed: 106, credits: 4, score: 40, throwDist: 430, projSpeed: 300 },
  // Rhythm breakers: they punish mindless mashing, each with its own input.
  fencer:  { name: 'Фехтовальщик', en: { name: 'Fencer' },  hits: 1, speed: 88, credits: 5, score: 60, fencer: true }, // strike only during the green window
  adapt:   { name: 'Маятник',      en: { name: 'Pendulum' }, hits: 3, speed: 62, credits: 5, score: 55, swap: true }, // two flights across the road; the third hit stops the swing
  twin:    { name: 'Близнец',      en: { name: 'Twin' },    hits: 1, speed: 70, credits: 3, score: 45, twin: true },   // the pair dies only to an L+R chord
  mimic:   { name: 'Мимик',        en: { name: 'Mimic' },   hits: 1, speed: 118, credits: 3, score: 35, mimic: true }, // looks like a drone; flashes real or phantom at the last second
};
// ---------- Stances ----------
// The road only ever asked ONE question — which side. A stance is the second
// question, and unlike everything else in this game it is asked every second
// rather than every wave: the two buttons keep their sides and change what a
// press MEANS. Three stances, cycled with one input; switching is instant but
// cannot be spammed (see STANCE_CD), so a stance is a state you commit to.
//
//   blade  — the precise cut. One target, and a kill carries the hero forward.
//   sweep  — the wide arc. Every damageable body in reach on that side takes a
//            hit, but the whole swing pays a single link of combo: crowd
//            control bought with the streak rather than with kills.
//   pierce — the heavy thrust. One target, two hits' worth of damage, and it
//            throws what survives much further back.
const STANCES = ['blade', 'sweep', 'pierce'];
// The first act stays a primer: one grammar, one question, nothing to read but
// the road. The blade learns the other two when the market opens — by then the
// player has the sides in their hands and can afford a second question.
const STANCE_ACT = 2;  // the market opens the sweep — two grammars, one choice
const PIERCE_ACT = 4;  // the ship hands over the thrust — the vocabulary completes
// The seal. With every body answering two grammars of three, ANY PAIR of
// stances covered the whole road and the third was decoration — the vocabulary
// was three words wide and two words deep. A sealed body answers exactly ONE
// grammar, named on its skin, so the full set finally has to be carried. Seals
// only appear once all three are in hand (SEAL_ACT), or one could name a word
// the run has not learned.
const SEAL_ACT = PIERCE_ACT;
const SEAL_CHANCE = 0.22; // share of eligible bodies that come sealed
const SEAL_PER_WAVE = 2;  // never a wall of them: the seal is a demand, not a tax
const SEALABLE = ['drone', 'punk', 'shield']; // the rank and file; elites keep their own rules
const stancesOn = r => !!r && !!r.hard && r.act >= STANCE_ACT;
// The standing choice of way. 'stance' walks the three grammars; anything else
// (including an old save that never heard of it) walks plainly.
const wayHard = s => !!s && !!s.meta && s.meta.way === 'stance';
function setWay(s, way) { s.meta.way = way === 'stance' ? 'stance' : 'plain'; }
// The stances this run may hold right now. Handing all three over at once was
// three rules arriving in one breath; they come one at a time instead, and the
// early pair (blade against the light, sweep against the plate) is a question
// with one answer rather than two.
function stanceUnlocked(r, idx) {
  if (idx === 0) return true;
  if (idx === 1) return stancesOn(r);
  return !!r && r.act >= PIERCE_ACT;
}
// Which stance answers this body, of the ones the run actually holds. The
// simulation, the renderer's marker and both bots read this one function, so
// what the screen promises is exactly what the blade does.
// A stance this run actually holds, optionally avoiding one. A Warden sealed
// with a grammar the blade has not been given yet is an unopenable duel — the
// run would stall at his feet until he ended it.
function pickUnlockedStance(s, r, avoid) {
  const pool = [];
  for (let i = 0; i < STANCES.length; i++) {
    if (stanceUnlocked(r, i) && i !== avoid) pool.push(i);
  }
  if (!pool.length) return avoid !== undefined ? avoid : 0;
  return pool[Math.floor(rnd(s) * pool.length) % pool.length];
}

function stanceFor(r, body) {
  for (let i = 0; i < STANCES.length; i++) {
    if (stanceUnlocked(r, i) && bodyBites(body, STANCES[i])) return i;
  }
  return -1;
}
const STANCE_CD = 0.08; // sec: just enough to swallow a double-tap, never a tax on reacting
const PIERCE_DMG = 2;
const PIERCE_PUSH = 90; // the heavy thrust throws survivors far

// Which stance the basic crowd ANSWERS to. Every one of them dies to two of the
// three and shrugs the third off — not immune, just unhurt: the press connects,
// the body is shoved back, and the stubborn stance costs tempo instead of the
// run. The elites are absent on purpose: a fencer's window, a chord and a
// mimic's bluff are rules enough for one enemy, and stacking a second reading
// on top of them is load, not depth. Their profile is `null` — damaged by all.
//
//   drone/mimic — nimble: the heavy thrust goes right past them
//   punk        — ducks under a wide arc
//   shielder    — the plate turns a precise cut aside
const STANCE_ARMOR = {
  drone:   { pierce: false },
  mimic:   { pierce: false },
  punk:    { sweep: false },
  shield:  { blade: false },
};
// Does this stance hurt this body at all? Anything not in the table takes
// damage from everything — elites are governed by their own rules.
function stanceBites(type, stance) {
  const prof = STANCE_ARMOR[type];
  return !prof || prof[stance] !== false;
}

// The entity-aware form: a seal overrides the type's matrix entirely — the mark
// on the skin is the whole truth about what can hurt this one.
function bodyBites(e, stance) {
  if (e && e.seal !== undefined) return STANCES[e.seal] === stance;
  return stanceBites(e && e.type ? e.type : e, stance);
}

// Mimic: disguised as an ordinary drone, it reveals its true nature only as it
// nears the zone — a solid flash means REAL (strike it, or it hurts you), a hollow
// one means PHANTOM (do NOT strike; it dissipates harmlessly, but a swing through it
// whiffs like a miss). It tests concentration, not the trained "in the zone → hit"
// reflex: half the drones on screen might not be drones.
const MIMIC_REVEAL_K = 1.85; // reveals well before the zone: the hollow shell has to be
                             // seen for long enough to register, not flicker at the edge
const MIMIC_FLASH = 0.5;     // sec the reveal flash lasts on both the real and the fake
const MIMIC_PHANTOM = 0.5;   // share of mimics that are phantoms
const FENCER_GUARD = 0.8;  // sec of parry stance (partly spent approaching)
const FENCER_OPEN = 0.45;  // sec of green window when the fencer can be hit
// sec between the two twin presses for them to merge into a chord. 0.12 was the
// reaction time of the strongest simulated player, so the chord sat at the edge of
// what a good player can do and outside what a weak one can. Measured over 150
// waves: a pair lingered in the zone 7.0s and took 3.9 attempts for the novice
// profile against 0.1s and one attempt for the skilled one — which is why twin
// pairs always ended up the last thing alive. At 0.18 the mid player is down to a
// single attempt and the novice's struggle halves, and the skilled player is
// untouched. It cannot mis-fire: both presses must still land on the same pair.
const CHORD_WIN = 0.18;
// Two mechanics cannot be derived from watching them — a twin pair needs BOTH
// buttons (and the chord window is far too short to hint after the first press),
// and a lying QTE link needs the opposite side. Both are taught in-frame until
// the player has performed them this many times, then the words retire for good.
const TEACH_STANCE = 4;  // "the stance did not bite" is invisible until named — say it, then stop
const TEACH_CHORDS = 3;
const TEACH_GLITCH = 3;
const TEACH_FENCER = 3; // the newcomers' words (main.js) — until the profile has answered each body a few times
const TEACH_THROW = 3;
const TEACH_MIMIC = 3;  // "don't strike a phantom" can't be watched — it's learned once, then taught in-frame
const THROW_WINDUP = 0.45; // sec of thrower wind-up: stands and blinks before the throw — it telegraphs
// shuriken speed scales with acts half as fast as walkers, or the deflect window collapses
const projSpeedMult = sm => 1 + (sm - 1) * 0.5;

// Wave composition per act: type weights for generation.
const ACT_WEIGHTS = [
  { drone: 6, punk: 2 },                                             // street: the basics
  { drone: 5, punk: 3.5, shield: 1, mimic: 1.5 },                    // market: crowds and first fakes
  // maglev: first stances and steel — and a thin thread of mimics (~5%), so the
  // fake met at the market is not forgotten for a whole act before the ship
  { drone: 5, punk: 3, shield: 1.5, fencer: 0.8, thrower: 0.8, mimic: 0.6 },
  // ship: thrower country — and the pendulum's first swing: the ship completes
  // the stance vocabulary, and the heavy crosser used to arrive only in act V,
  // where most careers never met the body the design had already paid for.
  // One newcomer per act from here: the twins moved on to the server hall
  // (2026-10-17) — the ship used to bring two new bodies at once and the hall none
  { drone: 4, punk: 3, shield: 2, thrower: 2.2, fencer: 1, adapt: 0.6, mimic: 1 },
  { drone: 4, punk: 3, shield: 2, thrower: 1.5, fencer: 1, adapt: 1, twin: 0.8, mimic: 2 },     // server hall: the twins' chord
  { drone: 3, punk: 3, shield: 2.5, thrower: 2.5, fencer: 1.2, adapt: 1.5, twin: 1, mimic: 2.5 },
];
// Deep endless: past the summit the road grows QUESTIONS, not speed. Every
// elite asks a distinct input — the window, the chord, the read, the deflect,
// the heavy finish — so their share is the axis of depth that has no
// physiological wall. The weights drift linearly from the act-VI table to
// this one across DEEP_DRIFT_ACTS acts, then hold: light infantry thins to a
// breather share (~23%), the fencer barely grows (his duel stalls the column
// — see the no-repeat rule in buildWave) and twins stay modest (a pair
// demands both hands, and stacked pairs at the arrival floor would jam).
const DEEP_WEIGHTS = { drone: 2, punk: 2.5, shield: 3.2, thrower: 3.2, fencer: 1.4, adapt: 2.6, twin: 1.1, mimic: 3.6 };
const DEEP_DRIFT_ACTS = 6; // acts VII..XII walk act VI's table into DEEP_WEIGHTS
function waveWeights(r) {
  const last = ACT_WEIGHTS[ACTS.length - 1];
  if (r.act <= ACTS.length) return ACT_WEIGHTS[r.act - 1];
  const k = Math.min(1, (r.act - ACTS.length) / DEEP_DRIFT_ACTS);
  const w = {};
  for (const t in DEEP_WEIGHTS) w[t] = (last[t] || 0) * (1 - k) + DEEP_WEIGHTS[t] * k;
  return w;
}
// The seal keeps pace with the deep road (stance way only): a run that has
// carried all three grammars for six acts can be asked more often. Both caps
// are gentle — the seal stays a demand, never a wall.
const sealChance = act => Math.min(0.4, SEAL_CHANCE + Math.max(0, act - ACTS.length) * 0.03);
const sealPerWave = act => SEAL_PER_WAVE + Math.min(2, Math.floor(Math.max(0, act - ACTS.length) / 3));

// ---------- Road rules ----------
// One light mechanical rule per location — the setting's promise made real.
// Same fairness frame as the Maglev Warden's own wind: every event is
// telegraphed (ROAD_WARN of howl/creak/static before it bites), and the
// strike zone is untouchable — a road rule may move the APPROACH, never the
// answer. In endless the locations cycle, so the rules return with them.
// The Warden's arrival clears the weather: his duel owns the road.
//   train  — WIND: a gust carries every walker beyond the zone toward the
//            rim (both columns: the slipstream buffets the whole roof) and
//            dies at the rim rather than crossing it.
//   ship   — ROLL: the deck tilts; the downhill column slides closer (to the
//            rim at most), the uphill one slides away. Asymmetric pressure,
//            answered by re-reading side priority. Planted bodies (a stanced
//            fencer, a winding thrower), frozen bodies and intact twin pairs
//            hold the deck — the pair-sync would tax a slid pair otherwise.
//   server — GLITCH: the hall's light stutters; for a beat the background
//            falls dark and every BODY beyond GLITCH_DIST sinks behind the
//            fog-style curtains (not a bare unrender — the dark must be SEEN
//            taking them). A UI veil, logic untouched — the FOG mutator's
//            exact contract — and steel is never veiled: the vetted
//            fog+steel rejection stands for the road too.
const ROAD_RULES = { train: 'wind', ship: 'roll', server: 'glitch' };
const roadRule = act => ROAD_RULES[ACTS[(act - 1) % ACTS.length].id] || null;
const ROAD_WARN = 0.5;   // sec of telegraph before any road event bites
const ROAD_NEAR = 460;   // an event fires only with a walker this close: under
                         // the empty-road warp the telegraph would flash past
const WIND_TIME = 0.4, WIND_MULT = 2.2;     // gust: length and approach multiplier
const ROLL_TIME = 0.5, ROLL_DIST = 55;      // tilt: length and slide distance
const GLITCH_TIME = 1.3, GLITCH_DIST = 300; // stutter: length and veil radius
const ROAD_CONF = { // seconds between events: base + rnd share
  wind:   { every: 7, rnd: 3, time: WIND_TIME },
  roll:   { every: 8, rnd: 4, time: ROLL_TIME },
  glitch: { every: 6, rnd: 3, time: GLITCH_TIME },
};
// The UI veil radius while the server hall's light is out (0 = lights on).
function roadVeil(r) {
  return r && r.road && r.road.kind === 'glitch' && !r.road.warn && r.road.t > 0
    ? GLITCH_DIST : 0;
}

// ---------- Wave mutators ----------
// A named rule that twists one wave. Rolled from act 2, never on the Warden's
// wave; the reward is +30% credits from every kill on a mutated wave.
const MUTATOR_CHANCE = 0.25;
const MUT_CREDIT = 1.3;
const MUT_PAIR_CREDIT = 1.6; // a curated pair is two rules at once — it pays like it
const MUT_PAIR_WAVE = 10;    // pairs join the endless pool from this total wave on
const FOG_DIST = 470;      // FOG: enemies materialize this close (a UI veil; logic unchanged)
const RAIN_EVERY = 3.2;    // STEEL RAIN: seconds between stray shurikens
const BLITZ_SPEED = 1.22;  // BLITZ: enemy speed multiplier
const SQUALL_SIZE = 1.45;  // SQUALL: wave size multiplier (light enemies only)
// icon — the HUD badge glyph; tip — the detailed advice shown on pause.
const MUTATORS = [
  { id: 'squall', icon: '🌪', name: 'ШКВАЛ',       desc: 'плотная толпа лёгкой пехоты',
    tip: 'Врагов в полтора раза больше, но все они лёгкие — дронов и трейсеров нет смысла бояться. Держи ровное чередование сторон и бей только в зоне: на такой плотности один промах стоит целой цепочки комбо.',
    en: { name: 'SQUALL', desc: 'a dense crowd of light infantry',
      tip: 'Half again as many enemies, but all of them are light — drones and tracers, nothing that outlasts you. Keep a steady left-right alternation and only swing inside the zone: at this density one whiff costs a whole combo chain.' } },
  { id: 'fog',    icon: '🌫', name: 'ТУМАН',       desc: 'враги проявляются только вблизи',
    tip: 'Проявляются они поздно, но приходят по тем же правилам — слушай шаги и смотри на метки зоны, а не вдаль. Не бей на упреждение в пустоту: стан в тумане почти всегда означает пропущенный удар.',
    en: { name: 'FOG', desc: 'enemies materialize only up close',
      tip: 'They appear late but arrive by the same rules — listen for footsteps and watch the zone markers instead of the horizon. Never swing pre-emptively into the dark: a stun in the fog almost always means a hit taken.' } },
  { id: 'steel',  icon: '🌩', name: 'ДОЖДЬ СТАЛИ', desc: 'шальные сюрикены — отбивай',
    tip: 'Каждые несколько секунд прилетает сюрикен без метателя. Отбивается он тем же ударом в зоне — и отражённый летит обратно, убивая всех на своей стороне. Приоритет всегда у сюрикена: он быстрее любого пехотинца.',
    en: { name: 'STEEL RAIN', desc: 'stray shurikens fly in — deflect them',
      tip: 'Every few seconds a shuriken arrives with no thrower behind it. The same in-zone strike deflects it, and the reflected blade flies back and kills everything on its side. Always prioritise the shuriken: it moves faster than any footsoldier.' } },
  { id: 'blitz',  icon: '⚡', name: 'БЛИЦ',        desc: 'враги быстрее, но держат на удар меньше',
    tip: 'Размен в твою пользу: щитовик падает с двух ударов, трейсер — с одного, но времени на решение на четверть меньше. Не копи цели — бей ближайшую сразу, как она вошла в зону.',
    en: { name: 'BLITZ', desc: 'enemies are faster but take one hit less',
      tip: 'The trade favours you: a shielder drops in two hits, a tracer in one — but you get a quarter less time to decide. Do not let targets stack up; hit the nearest one the moment it enters the zone.' } },
  // Curated PAIRS: two base rules at once, hand-vetted for fairness and named
  // as their own thing. They join the roll only deep into endless (see
  // MUT_PAIR_WAVE) and pay MUT_PAIR_CREDIT. `combo` lists the base rules the
  // pair applies — every rule check goes through mutHas, so a pair needs no
  // code of its own. (fog+steel was vetted and REJECTED: an invisible shuriken
  // at deep-wave speed leaves less than a reaction window past the veil.)
  { id: 'steelstorm', icon: '🌩⚡', name: 'СТАЛЬНОЙ ШТОРМ', combo: ['steel', 'blitz'],
    desc: 'дождь стали над блицем — быстрые мягкие враги и шальные сюрикены',
    tip: 'Оба правила разом: враги быстрее и мягче, а между ними прилетают сюрикены. Приоритет прежний — клинок в зоне важнее пехоты, и отражённый чистит всю сторону. Не копи цели: на этой скорости толпа не прощает.',
    en: { name: 'STEEL STORM', desc: 'steel rain over a blitz — fast soft enemies and stray shurikens',
      tip: 'Both rules at once: enemies are faster and softer, and shurikens fly in between them. The old priority holds — a blade in the zone beats any footsoldier, and a reflected one clears its whole side. Do not stack targets: at this speed the crowd does not forgive.' } },
  { id: 'blindsquall', icon: '🌫🌪', name: 'СЛЕПОЙ ШКВАЛ', combo: ['fog', 'squall'],
    desc: 'плотная лёгкая толпа, проявляющаяся только вблизи',
    tip: 'Шквал, которого не видно: толпа в полтора раза плотнее и вся выходит из тумана. Все враги лёгкие — страшна не сила, а темп. Смотри только на метки зоны и держи чередование; в туман на упреждение не бей.',
    en: { name: 'BLIND SQUALL', desc: 'a dense light crowd that materializes only up close',
      tip: 'A squall you cannot see: the crowd is half again as dense and all of it steps out of the fog. Every enemy is light — the danger is tempo, not strength. Watch only the zone markers, keep the alternation, and never swing pre-emptively into the dark.' } },
  { id: 'avalanche', icon: '🌪⚡', name: 'ЛАВИНА', combo: ['squall', 'blitz'],
    desc: 'плотнее, быстрее, мягче — чистая интенсивность',
    tip: 'Толпа шквала на скорости блица, и вся она падает с одного-двух ударов. Это чистый тест темпа: ровное чередование сторон держит её бесконечно, один промах — хоронит.',
    en: { name: 'AVALANCHE', desc: 'denser, faster, softer — pure intensity',
      tip: 'The squall crowd at blitz speed, all of it dying in one or two hits. A pure tempo test: steady left-right alternation holds it forever, a single whiff buries you.' } },
];
// id -> entry, and the answer to "is base rule X active this wave": a wave's
// mutator id may name a pair whose combo carries several base rules at once.
const MUT_BY_ID = {};
for (const m of MUTATORS) MUT_BY_ID[m.id] = m;
function mutHas(r, id) {
  if (!r.mutator) return false;
  if (r.mutator === id) return true;
  const m = MUT_BY_ID[r.mutator];
  return !!(m && m.combo && m.combo.includes(id));
}
const mutCredit = r => {
  if (!r.mutator) return 1;
  const m = MUT_BY_ID[r.mutator];
  return m && m.combo ? MUT_PAIR_CREDIT : MUT_CREDIT;
};
const mutSpeed = r => (mutHas(r, 'blitz') ? BLITZ_SPEED : 1);
// Live speed factor from a miss. Deliberately NOT part of wave generation: the
// schedule is planned once at base speed, so the generator's solvability
// guarantee (minimum arrival gaps) is never rewritten by the player's mistake.
const surgeMult = r => (r.stun > 0 && r.act >= SURGE_ACT ? MISS_SURGE : 1);

// ---------- Implants (within a run) ----------
const IMPLANTS = [
  { id: 'range',   icon: '📡', name: 'Моно-катана',      desc: '+15% дальность удара',                        stack: 3,
    en: { name: 'Mono-Katana',      desc: '+15% strike range' } },
  { id: 'cryo',    icon: '🧊', name: 'Криоядро',          desc: 'Враги на 8% медленнее',                       stack: 3,
    en: { name: 'Cryo Core',        desc: 'Enemies are 8% slower' } },
  { id: 'hp',      icon: '🔋', name: 'Батарея щита',      desc: '+1 к максимуму брони и починка',              stack: 5,
    en: { name: 'Shield Battery',   desc: '+1 max armor, instant repair' } },
  { id: 'vamp',    icon: '🩸', name: 'Нановампиризм',     desc: '+1 броня за половину врагов волны (раз за волну)', stack: 1,
    en: { name: 'Nanovampirism',    desc: '+1 armor for half the wave (once per wave)' } },
  { id: 'stasis',  icon: '❄️', name: 'Стазис-разряд',     desc: `Каждое ${STASIS_EVERY1}-е меткое нажатие замораживает сторону удара — кроме уже подходящих к клинку`, stack: 2,
    en: { name: 'Stasis Discharge', desc: `Every ${STASIS_EVERY1}th connected press freezes the struck side — bodies already closing on the blade keep coming` } },
  { id: 'reflex',  icon: '🎯', name: 'Рефлекс-чип',       desc: 'Штраф за промах вдвое короче',                stack: 2,
    en: { name: 'Reflex Chip',      desc: 'Miss penalty is half as long' } },
  { id: 'icept',   icon: '🪃', name: 'Перехват',          desc: 'Отбитый сюрикен перенаводится в самую опасную цель своей стороны — и убивает её', stack: 1,
    en: { name: 'Intercept',        desc: 'A deflected shuriken retargets the most dangerous body on its side — and kills it' } },
  // 2026-07-31: the Credit Magnet (+30% credits) is retired — a passive number
  // that merely duplicated the shop's mcred firmware. Its slot in the pool is
  // deliberately left open until a trigger mechanic worth pressing arrives.
  { id: 'guard',   icon: '🔌', name: 'Аварийный конденсатор', desc: 'Смертельный удар оставляет 1 броню и отбрасывает всех (раз за забег)', stack: 1,
    en: { name: 'Emergency Capacitor', desc: 'A lethal hit leaves 1 armor and repels the field (once per run)' } },
  { id: 'jam',     icon: '📵', name: 'Глушилка «Помехи»', desc: 'Метатели замахиваются дольше, все сюрикены летят на 15% медленнее', stack: 2,
    en: { name: 'Static Jammer',    desc: 'Throwers wind up longer, every shuriken flies 15% slower' } },
  { id: 'hack',    icon: '🔓', name: 'Дешифратор',        desc: `+${Math.round(HACK_TIMER * 100)}% времени на цепочку стража`, stack: 2,
    en: { name: 'Decryptor',        desc: `+${Math.round(HACK_TIMER * 100)}% time on a Warden chain` } },
];

// ---------- Achievements ----------
// Unlocked forever (live in meta); each grants credits exactly once.
const ACHIEVEMENTS = [
  { id: 'kill1',     icon: '🩸', name: 'Первая кровь',   desc: 'Первое убийство',               target: 1,     reward: 10,  value: s => s.meta.stats.totalKills,
    en: { name: 'First Blood', desc: 'Your first kill' } },
  { id: 'kill100',   icon: '⚔️', name: 'Сотня',          desc: '100 убийств за всё время',      target: 100,   reward: 25,  value: s => s.meta.stats.totalKills,
    en: { name: 'The Hundred', desc: '100 kills all-time' } },
  { id: 'kill1000',  icon: '🗡️', name: 'Тысяча клинков', desc: '1000 убийств за всё время',     target: 1000,  reward: 100, value: s => s.meta.stats.totalKills,
    en: { name: 'Thousand Blades', desc: '1000 kills all-time' } },
  { id: 'combo25',   icon: '🔥', name: 'Поток',          desc: 'Комбо 25',                      target: 25,    reward: 25,  value: s => s.meta.stats.bestCombo,
    en: { name: 'Flow', desc: 'Combo 25' } },
  { id: 'combo60',   icon: '🌊', name: 'Транс',          desc: 'Комбо 60',                      target: 60,    reward: 75,  value: s => s.meta.stats.bestCombo,
    en: { name: 'Trance', desc: 'Combo 60' } },
  { id: 'boss1',     icon: '👹', name: 'Цареубийца',     desc: 'Победить стража',               target: 1,     reward: 40,  value: s => s.meta.stats.bossKills,
    en: { name: 'Kingslayer', desc: 'Defeat a Warden' } },
  { id: 'boss10',    icon: '💀', name: 'Гроза стражей',  desc: '10 поверженных стражей',        target: 10,    reward: 120, value: s => s.meta.stats.bossKills,
    en: { name: "Wardens' Bane", desc: '10 Wardens down' } },
  { id: 'win1',      icon: '🌅', name: 'Рассвет',        desc: 'Пройти все шесть актов',        target: 1,     reward: 150, value: s => s.meta.stats.wins,
    en: { name: 'Dawn', desc: 'Clear all six acts' } },
  { id: 'runs10',    icon: '♻️', name: 'Возвращенец',    desc: '10 забегов',                    target: 10,    reward: 30,  value: s => s.meta.stats.runs,
    en: { name: 'Returner', desc: '10 runs' } },
  { id: 'refl25',    icon: '🌀', name: 'Отражатель',     desc: 'Отбить 25 сюрикенов',           target: 25,    reward: 40,  value: s => s.meta.stats.reflects,
    en: { name: 'Deflector', desc: 'Deflect 25 shurikens' } },
  { id: 'chord10',   icon: '🎼', name: 'Резонанс',       desc: '10 пар близнецов аккордом',     target: 10,    reward: 60,  value: s => s.meta.stats.chords,
    en: { name: 'Resonance', desc: '10 twin pairs by chord' } },
  { id: 'fenc15',    icon: '🤺', name: 'Дуэлянт',        desc: '15 фехтовальщиков — в окно',    target: 15,    reward: 60,  value: s => s.meta.stats.fencerKills,
    en: { name: 'Duelist', desc: '15 fencers — in the window' } },
  { id: 'icept15',   icon: '🪃', name: 'Перехватчик',    desc: '15 целей снято перенаведённым клинком', target: 15, reward: 60,  value: s => s.meta.stats.iceptKills,
    en: { name: 'Interceptor', desc: '15 bodies down to a retargeted blade' } },
  { id: 'perfect1',  icon: '✨', name: 'Без царапины',   desc: 'Волна без единой раны',         target: 1,     reward: 20,  value: s => s.meta.stats.perfectWaves,
    en: { name: 'Untouched', desc: 'A wave without a wound' } },
  { id: 'perfect20', icon: '💎', name: 'Неприкасаемый',  desc: '20 идеальных волн',             target: 20,    reward: 100, value: s => s.meta.stats.perfectWaves,
    en: { name: 'Untouchable', desc: '20 perfect waves' } },
  { id: 'score25k',  icon: '🏆', name: 'Легенда района', desc: 'Счёт 25 000 за один забег',     target: 25000, reward: 80,  value: s => s.meta.stats.bestScore,
    en: { name: 'Local Legend', desc: 'Score 25,000 in one run' } },
  { id: 'endless15', icon: '♾️', name: 'За горизонт',    desc: '15 волн бесконечного режима',   target: 15,    reward: 100, value: s => s.meta.stats.bestEndless || 0,
    en: { name: 'Beyond the Horizon', desc: '15 endless-mode waves' } },
  { id: 'endless30', icon: '🌌', name: 'Вечный клинок',  desc: '30 волн бесконечного режима',   target: 30,    reward: 200, value: s => s.meta.stats.bestEndless || 0,
    en: { name: 'Eternal Blade', desc: '30 endless-mode waves' } },
];

// Check and unlock. Returns the freshly unlocked list — the UI shows toasts.
function checkAchievements(s) {
  const unlocked = [];
  if (s.run && s.run.cheated) return unlocked; // a tainted run unlocks nothing
  for (const a of ACHIEVEMENTS) {
    if (!s.meta.ach[a.id] && a.value(s) >= a.target) {
      s.meta.ach[a.id] = true;
      s.meta.credits += a.reward;
      unlocked.push(a);
    }
  }
  return unlocked;
}

// ---------- Story ----------
// The fiction is delivered only where the player has already stopped and is
// reading anyway: the death screen, the Warden's banner, the victory screen and
// this journal. Nothing of it ever appears during combat.
//
// Most of it was already sitting in the data, unspoken. The first Warden is
// called RONIN BETA — so the hero is not the first of his kind. Act III is "the
// heart of Kage Corp". Credits survive death and the run does not. Put together:
// the blades are manufactured in series, a run is one instance, and whatever the
// upload catches is what carries over. The roguelite loop stops being a
// convention and becomes the plot.
//
// A Warden's banner teaches the mechanic for the first BOSS_VOICE_AFTER
// meetings and speaks only after that — the same retirement the twins' and the
// glitch links' teaching lines already use.
const BOSS_VOICE_AFTER = 2;

const LOG = [
  { id: 'series', icon: '🏭', name: 'Серия «Ронин»',
    text: 'Kage Corp собирает клинки партиями. Экземпляр — расходник, память — актив. Расходник не жалуются: жалоба не входит в спецификацию.',
    when: s => s.meta.stats.runs >= 1,
    en: { name: 'The Ronin Series',
          text: 'Kage Corp builds blades in batches. The instance is stock, the memory is the asset. Stock does not complain: complaint is not in the spec.' } },
  { id: 'beta', icon: '🥷', name: 'Ронин-бета',
    text: 'Предыдущая серия. Патруль ему выдали до того, как снесли маршрут, а отменить приказ теперь некому.',
    when: s => (s.meta.story.bossSeen[1] || 0) >= 1,
    en: { name: 'Ronin Beta',
          text: 'The previous series. His patrol was issued before they tore the route down, and there is no one left to countermand it.' } },
  { id: 'upload', icon: '💾', name: 'Протокол «Возвращение»',
    text: 'При отказе выгружают то, что успело: рефлексы, счета, привычки. Это и есть кредиты, которые ты тратишь между забегами.',
    when: s => s.meta.stats.runs >= 3,
    en: { name: 'Protocol: Return',
          text: 'On failure they upload whatever made it out: reflexes, ledgers, habits. That is exactly the credits you spend between runs.' } },
  { id: 'market', icon: '🏮', name: 'Ночной рынок',
    text: 'Рынок торгует копиями копий. Подделку выдаёт не блеск — блеск здесь у всех. Её выдаёт пустота внутри.',
    when: s => s.meta.stats.bestAct >= 2,
    en: { name: 'The Night Market',
          text: 'The market sells copies of copies. It is not the shine that betrays a fake — everything here shines. It is the hollow inside.' } },
  { id: 'double', icon: '🎭', name: 'Двойник',
    text: 'Рынку нужен был страж, и рынок поступил по-рыночному: заказал одного, получил двоих, настоящий из них один.',
    when: s => (s.meta.story.bossSeen[6] || 0) >= 1,
    en: { name: 'The Double',
          text: 'The market needed a warden and did it the market way: ordered one, took delivery of two, only one of them real.' } },
  { id: 'spine', icon: '🚄', name: 'Хребет',
    text: 'Маглев — единственная дорога наверх, которая не принадлежит городу. Она принадлежит корпорации, и потому она пустая.',
    when: s => s.meta.stats.bestAct >= 3,
    en: { name: 'The Spine',
          text: 'The maglev is the only road up that does not belong to the city. It belongs to the corporation, which is why it is empty.' } },
  { id: 'maglev', icon: '🌬', name: 'Страж маглева',
    text: 'Ветер в тоннеле — не погода, а охлаждение. Стража оно несёт вперёд быстрее, чем он успевает решить, хочет ли он вперёд.',
    when: s => (s.meta.story.bossSeen[2] || 0) >= 1,
    en: { name: 'The Maglev Warden',
          text: 'The wind in the tunnel is not weather, it is cooling. It carries the Warden forward faster than he can decide whether he wants to go.' } },
  { id: 'leviathan', icon: '🚢', name: 'Левиафан',
    text: 'Левиафаны Кагэ ходят без экипажа: море дешевле охранять сталью, чем людьми. Сталь сегодня на палубе — это ты.',
    when: s => s.meta.stats.bestAct >= 4,
    en: { name: 'The Leviathan',
          text: 'Kage leviathans sail crewless: the sea is cheaper guarded by steel than by people. Tonight the steel on deck is you.' } },
  { id: 'armorer', icon: '🗡', name: 'Оружейник',
    text: 'Он выдаёт клинки по накладной и принимает возвраты. Возврат, дошедший до него, списывает звено его собственной цепи.',
    when: s => (s.meta.story.bossSeen[5] || 0) >= 1,
    en: { name: 'The Armorer',
          text: 'He issues blades against invoice and accepts returns. A return that reaches him writes off a link of his own chain.' } },
  { id: 'hall', icon: '🗄', name: 'Серверный зал',
    text: 'Здесь лежат копии. Твоя — в трёх экземплярах; активной всё это время остаётся одна.',
    when: s => s.meta.stats.bestAct >= 5,
    en: { name: 'The Server Hall',
          text: 'This is where the copies are kept. Yours exists in three; exactly one of them is ever active.' } },
  { id: 'oni', icon: '👺', name: 'Админ-они',
    text: 'Собран из отбракованной памяти. Его стрелки лгут не со зла — он сам уже не помнит, где право.',
    when: s => (s.meta.story.bossSeen[3] || 0) >= 1,
    en: { name: 'Admin Oni',
          text: 'Assembled from rejected memory. His arrows do not lie out of malice — he no longer remembers which way is right.' } },
  { id: 'garden', icon: '🌸', name: 'Сад дзен',
    text: 'Вершина аркологии. Сад настоящий — единственное живое место в здании, где всё остальное копия.',
    when: s => s.meta.stats.bestAct >= 6,
    en: { name: 'The Zen Garden',
          text: 'The arcology summit. The garden is real — the one living thing in a building where everything else is a copy.' } },
  { id: 'shogun', icon: '🀄', name: 'Сёгун ядра',
    text: 'Ядро говорит голосом мастера. Голос — всё, что от мастера осталось: остальное разобрали на серию.',
    when: s => (s.meta.story.bossSeen[4] || 0) >= 1,
    en: { name: 'The Core Shogun',
          text: 'The core speaks in the master’s voice. The voice is all that is left of him: the rest was parted out into the series.' } },
  { id: 'dawn', icon: '🌅', name: 'Рассвет',
    text: 'Ты дошёл до вершины. Смена закончилась. Контракт — нет.',
    when: s => s.meta.stats.wins >= 1,
    en: { name: 'Dawn',
          text: 'You reached the summit. The shift is over. The contract is not.' } },
  { id: 'loop', icon: '♾', name: 'Петля',
    text: 'Считать волны проще, чем считать экземпляры. Одно из этих чисел растёт быстрее, и это не волны.',
    when: s => (s.meta.stats.bestEndless || 0) >= 10,
    en: { name: 'The Loop',
          text: 'Counting waves is easier than counting instances. One of those numbers grows faster, and it is not the waves.' } },
  { id: 'ledger', icon: '📈', name: 'Бухгалтерия',
    text: 'Двадцать пять запусков. В квартальном отчёте это одна строка: «износ в пределах нормы».',
    when: s => s.meta.stats.runs >= 25,
    en: { name: 'The Ledger',
          text: 'Twenty-five launches. In the quarterly report it is one line: "wear within tolerance".' } },
];

// Unlock check, mirroring checkAchievements — but deliberately NOT gated on a
// tainted run. A trophy is a record and a skipped wave forfeits it; a story
// fragment is not a reward, and silently freezing the plot because someone used
// the escape hatch once would read as a bug, not as a penalty.
function checkLog(s) {
  const fresh = [];
  for (const e of LOG) {
    if (!s.meta.story.log[e.id] && e.when(s)) {
      s.meta.story.log[e.id] = true;
      fresh.push(e);
    }
  }
  return fresh;
}

// ---------- Meta progression (between runs, for credits) ----------
// Prices raised for the mid and late shop (2026-07-29): by mid-career it had
// run out of things to want, and the agency firmware below is worth saving
// for. The two entry rungs (armor, accelerator) keep their old prices on
// purpose — the career sim showed a hike there costs the novice the ladder.
const META = [
  { id: 'mhp',    icon: '🛡️', name: 'Подкожная броня',   desc: '+1 стартовая броня',        baseCost: 150, cap: 3, growth: 1.6,
    en: { name: 'Subdermal Armor',   desc: '+1 starting armor' } },
  { id: 'mrange', icon: '🗡️', name: 'Удлинённый клинок', desc: '+6% дальность удара',       baseCost: 140, cap: 3, growth: 1.6,
    en: { name: 'Extended Blade',    desc: '+6% strike range' } },
  { id: 'mcred',  icon: '💾', name: 'Крипто-кошелёк',    desc: '+15% кредитов с врагов',    baseCost: 160, cap: 3, growth: 1.6,
    en: { name: 'Crypto Wallet',     desc: '+15% credits from kills' } },
  { id: 'mstun',  icon: '⏱️', name: 'Нейро-ускоритель',  desc: 'Штраф за промах −15%',      baseCost: 150, cap: 2, growth: 1.6,
    en: { name: 'Neuro Accelerator', desc: 'Miss penalty −15%' } },
  { id: 'mstart', icon: '📦', name: 'Заводская комплектация', desc: '+1 случайный имплант на старте забега', baseCost: 400, cap: 2, growth: 1.6,
    en: { name: 'Factory Loadout',   desc: '+1 random implant at run start' } },
  { id: 'mslot',  icon: '🧰', name: 'Расширенный отсек', desc: 'После волны предлагается 4 импланта вместо 3', baseCost: 600, cap: 1, growth: 1.6,
    en: { name: 'Extended Bay',      desc: 'Waves offer 4 implants instead of 3' } },
  { id: 'mdock',  icon: '🔧', name: 'Ремонтный док',     desc: 'Переход между актами чинит +1 броню', baseCost: 1000, cap: 1, growth: 1.6,
    en: { name: 'Repair Dock',       desc: 'Crossing into a new act repairs +1 armor' } },
  { id: 'mreroll', icon: '🎲', name: 'Пересборка',       desc: 'Раз за забег пересобрать предложенные импланты', baseCost: 350, cap: 2, growth: 1.6,
    en: { name: 'Reassembly',        desc: 'Once per run, reroll the offered implants' } },
  // The stance way's own firmware: offered only to a blade that carries three
  // grammars, because neither line means anything without them.
  { id: 'mriposte', icon: '⛩️', name: 'Ответный ход', desc: 'Скольжение примораживает врага на 0.4с', baseCost: 450, cap: 2, growth: 1.7, way: 'stance',
    en: { name: 'Riposte',           desc: 'A glance freezes the body for 0.4s' } },
  { id: 'mmomentum', icon: '🌀', name: 'Инерция клинка', desc: 'Каждое 8-е нажатие без смены стойки бьёт сквозь броню и на урон больше', baseCost: 500, cap: 3, growth: 1.7, way: 'stance',
    en: { name: 'Blade Momentum',    desc: 'Every 8th press without changing stance bites through armor for +1 damage' } },
];
// How long a glance holds a body, by riposte level — and how many presses of
// one grammar it takes to charge momentum. Both read straight off meta.
const RIPOSTE_HOLD = [0, 0.4, 0.7];
const MOMENTUM_EVERY = [0, 8, 6, 4];

// ---------- Blade palettes (the cosmetic rack) ----------
// A late-career credit sink that buys IDENTITY, never power: a palette
// recolors the hero's own light — the slash arc, the idle halo, the speed
// ghosts — and nothing that carries a rule. Signals keep their colors under
// any palette: stasis frost stays ice, the stun blink stays red, stance chips
// keep their grammar hues, every enemy-side cue is untouched. 'ion' is the
// free default and follows the act's own accent, as the blade always has —
// core: null means "the act paints me". Prices sit above the firmware shop
// on purpose: this rack is what credits are FOR once the firmware is bought.
const BLADES = [
  { id: 'ion',      name: 'Ион',      en: { name: 'Ion' },      cost: 0,    core: null,      glow: null },
  { id: 'oni',      name: 'Они',      en: { name: 'Oni' },      cost: 600,  core: '#ff3d6e', glow: '#ff7e9e' },
  { id: 'kintsugi', name: 'Кинцуги',  en: { name: 'Kintsugi' }, cost: 1000, core: '#ffd24d', glow: '#ffe89a' },
  { id: 'jade',     name: 'Нефрит',   en: { name: 'Jade' },     cost: 1500, core: '#3dff9e', glow: '#8affc9' },
  { id: 'wisteria', name: 'Глициния', en: { name: 'Wisteria' }, cost: 2200, core: '#b44dff', glow: '#d493ff' },
  { id: 'ghost',    name: 'Призрак',  en: { name: 'Ghost' },    cost: 3000, core: '#f2f6ff', glow: '#ffffff' },
];
const bladeById = id => BLADES.find(b => b.id === id) || BLADES[0];
// Buying is equipping: nobody buys a katana to leave it on the wall.
function buyBlade(s, id) {
  const b = BLADES.find(x => x.id === id);
  if (!b || !b.cost || s.meta.blades[id] || s.meta.credits < b.cost) return false;
  s.meta.credits -= b.cost;
  s.meta.blades[id] = true;
  s.meta.blade = id;
  return true;
}
function setBlade(s, id) {
  const b = BLADES.find(x => x.id === id);
  if (!b || (b.cost > 0 && !s.meta.blades[id])) return false;
  s.meta.blade = id;
  return true;
}

// ---------- State ----------
function createState(seed = 1) {
  return {
    rngState: seed | 0,
    phase: 'menu', // menu | combat | choice | dead | victory
    meta: {
      credits: 0,
      upgrades: {}, // meta upgrade id -> level
      blade: 'ion', // equipped blade palette id
      blades: {},   // owned palette id -> true ('ion' is free and never listed)
      ach: {},      // achievement id -> true (unlocked forever)
      stats: {
        runs: 0, bestAct: 0, bestScore: 0, bestCombo: 0, totalKills: 0, wins: 0,
        reflects: 0, chords: 0, glitchHits: 0, bossKills: 0, fencerKills: 0, iceptKills: 0, perfectWaves: 0, surges: 0,
        stanceSwitches: 0, sealKills: 0,
        mimicReads: 0, bestEndless: 0,
      },
      // story: unlocked journal fragments, and how many times each Warden kind
      // has been met — his banner teaches while that count is low and speaks
      // once it is not
      story: { log: {}, bossSeen: {} },
    },
    run: null,
  };
}

// Merge saved meta into a fresh state (guards against broken/old saves).
function normalizeState(saved) {
  const s = createState((saved && saved.rngState) | 0 || (Date.now() & 0x7fffffff));
  if (saved && saved.meta) {
    if (typeof saved.meta.credits === 'number') s.meta.credits = Math.max(0, saved.meta.credits);
    if (saved.meta.upgrades) {
      for (const m of META) {
        const v = saved.meta.upgrades[m.id];
        if (typeof v === 'number') s.meta.upgrades[m.id] = Math.min(m.cap, Math.max(0, v | 0));
      }
    }
    // stats, key by key: only known counters, only finite non-negative numbers —
    // a broken save must not smuggle in NaN that Math.max would then keep forever
    if (saved.meta.stats) {
      for (const k of Object.keys(s.meta.stats)) {
        const v = saved.meta.stats[k];
        if (Number.isFinite(v)) s.meta.stats[k] = Math.max(0, v);
      }
    }
    if (saved.meta.ach) {
      for (const a of ACHIEVEMENTS) {
        if (saved.meta.ach[a.id]) s.meta.ach[a.id] = true;
      }
    }
    // blade palettes: only known ids survive, the equipped one must be owned
    if (saved.meta.blades) {
      for (const b of BLADES) {
        if (b.cost > 0 && saved.meta.blades[b.id]) s.meta.blades[b.id] = true;
      }
    }
    if (typeof saved.meta.blade === 'string') setBlade(s, saved.meta.blade);
    // the daily board: a string date and sane numbers, or nothing at all
    const num = v => (Number.isFinite(v) ? Math.max(0, v) : 0);
    for (const slot of ['daily', 'dailyS']) {
      const d = saved.meta[slot];
      if (d && typeof d.date === 'string') {
        s.meta[slot] = {
          date: d.date, score: num(d.score), act: num(d.act), wave: num(d.wave),
          victory: !!d.victory, done: !!d.done,
        };
      }
    }
    if (saved.meta.way === 'stance') s.meta.way = 'stance';
    // the monthly ledger, by the same rule
    for (const slot of ['monthly', 'monthlyS']) {
      const mo = saved.meta[slot];
      if (mo && typeof mo.month === 'string') {
        s.meta[slot] = {
          month: mo.month, score: num(mo.score), act: num(mo.act), wave: num(mo.wave),
          done: !!mo.done,
        };
      }
    }
    // story, id by id: an old save simply has none of it, and a broken one
    // cannot smuggle in fragments that no longer exist
    const story = saved.meta.story;
    if (story) {
      if (story.log) {
        for (const e of LOG) if (story.log[e.id]) s.meta.story.log[e.id] = true;
      }
      if (story.bossSeen) {
        for (let k = 1; k <= BOSS_KINDS; k++) {
          const v = story.bossSeen[k];
          if (typeof v === 'number' && v > 0) s.meta.story.bossSeen[k] = v | 0;
        }
      }
    }
  }
  return s;
}

// ---------- Derived stats (meta + implants) ----------
const implantCount = (s, id) => (s.run && s.run.implants[id]) || 0;
// The daily freezes the meta: upgrades read as level zero while the run is
// LIVE (combat/choice — which startRun enters before the loadout grant), so
// the day compares hands. Ended phases see real levels again — the shop on the
// death screen must show and charge the truth, not the freeze.
const metaLvl = (s, id) =>
  (s.run && (s.run.daily || s.run.monthly) && (s.phase === 'combat' || s.phase === 'choice'))
    ? 0 : (s.meta.upgrades[id] || 0);

function range(s)      { return BASE_RANGE * (1 + 0.15 * implantCount(s, 'range')) * (1 + 0.06 * metaLvl(s, 'mrange')); }
function cryoMult(s)   { return Math.pow(0.92, implantCount(s, 'cryo')); }
function stunTime(s)   { return BASE_STUN * Math.pow(0.5, implantCount(s, 'reflex')) * (1 - 0.15 * metaLvl(s, 'mstun')); }
function maxHp(s)      { return BASE_HP + metaLvl(s, 'mhp') + implantCount(s, 'hp'); }
function creditMult(s) { return 1 + 0.15 * metaLvl(s, 'mcred'); }
function stasisEvery(s) { const c = implantCount(s, 'stasis'); return c ? (c >= 2 ? STASIS_EVERY2 : STASIS_EVERY1) : 0; }
function stasisHold(s)  { return implantCount(s, 'stasis') >= 2 ? STASIS_HOLD2 : STASIS_HOLD1; }
function iceptOn(s)     { return implantCount(s, 'icept') > 0; }
function qteTimerMult(s) { return 1 + HACK_TIMER * implantCount(s, 'hack'); }
function jamWindupMult(s) { return 1 + JAM_WINDUP * implantCount(s, 'jam'); }
function jamProjMult(s)  { return 1 - JAM_PROJ * implantCount(s, 'jam'); }

// ---------- Daily seed ----------
// One shared seed per calendar day, hashed from the local date string: every
// install rolls the same waves, the same offers, the same Wardens. The meta is
// frozen for the run (metaLvl reads zero), so the day's number measures the
// hands, not the wallet. Attempts are unlimited — the day's board keeps the
// BEST result (the online board upserts by the same rule), so a retry can
// only improve the ledger, never launder a worse run onto it. The date comes
// in from outside (UI clock, tests' literals); game.js itself stays clock-free.
function dailySeed(dateStr) {
  let h = 2166136261 >>> 0; // FNV-1a over the date string
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) & 0x7fffffff) || 1; // rngState is a positive int31
}
function startDaily(s, dateStr) {
  s.rngState = dailySeed(dateStr);
  startRun(s, 'daily');
  // a fresh date opens a fresh board entry; the same date keeps the day's best
  const dk = dailySlot(s, s.run.hard);
  if (!s.meta[dk] || s.meta[dk].date !== dateStr) {
    s.meta[dk] = { date: dateStr, score: 0, act: 1, wave: 1, victory: false, done: false };
  }
  return true;
}
// The day's ledger takes a finished run only if it beats what already stands —
// mirrored by the worker's own merge rule, so client and board agree.
// One ledger per way: a plain daily and a stance daily on the same date are two
// different games and must never overwrite each other's best.
const dailySlot = (s, hard) => (hard ? 'dailyS' : 'daily');
const monthlySlot = (s, hard) => (hard ? 'monthlyS' : 'monthly');

function recordDaily(s, r, victory) {
  const d = s.meta[dailySlot(s, r.hard)];
  if (!r.daily || r.cheated || !d) return;
  if (d.done && r.score <= d.score) return;
  Object.assign(d, { score: r.score, act: r.act, wave: r.wave, victory: !!victory, done: true });
}

// ---------- Monthly seed ----------
// The daily's long-form sibling: one shared ENDLESS seed per calendar month
// ('YYYY-MM', UTC like the daily). Firmware frozen the same way — the month's
// ladder measures how deep the hands go, not the wallet. The 'm:' prefix keeps
// a month's hash from ever colliding with some date's.
function startMonthly(s, monthStr) {
  s.rngState = dailySeed('m:' + monthStr);
  startRun(s, 'monthly');
  const mk = monthlySlot(s, s.run.hard);
  if (!s.meta[mk] || s.meta[mk].month !== monthStr) {
    s.meta[mk] = { month: monthStr, score: 0, act: 1, wave: 1, done: false };
  }
  return true;
}
// The month's ledger keeps the deepest run; equal depth falls to score —
// the exact tie rule the worker's endless metric applies.
function recordMonthly(s, r) {
  const m = s.meta[monthlySlot(s, r.hard)];
  if (!r.monthly || r.cheated || !m) return;
  const oldWaves = (m.act - 1) * WAVES_PER_ACT + m.wave;
  if (m.done && (endlessWave(r) < oldWaves || (endlessWave(r) === oldWaves && r.score <= m.score))) return;
  Object.assign(m, { score: r.score, act: r.act, wave: r.wave, done: true });
}

// ---------- Difficulty ----------
// The knee: past it, extra speed arrives at 15% of the raw slope. Depth used
// to grow along ONE axis — crossing speed — while every other pressure ring
// (arrival gaps, wave size, chain length) sat at its floor, so an endless
// run ended exactly when the in-zone window shrank below the player's
// reaction: a wall of physiology, not of reading. The knee sits just above
// the campaign's own maximum (act VI wave 3 = ×2.24 — the campaign never
// feels it), keeps every absolute window (the fencer's, the mimic's flash)
// in sane proportion to the world, and leaves a slow residual climb so an
// endless run still ENDS — records stay finite and comparable. Depth's real
// growth moves to composition: see DEEP_WEIGHTS.
const SPEED_KNEE = 2.3;
function speedMult(run) {
  const raw = 1 + (run.act - 1) * 0.22 + (run.wave - 1) * 0.07;
  return raw <= SPEED_KNEE ? raw : SPEED_KNEE + (raw - SPEED_KNEE) * 0.15;
}
// Pincer chance grew unclamped and crossed 1.0 at act IX: every slot rolled
// "simultaneous pair", and the deep wave degenerated into a metronome of
// L+R stabs at the arrival floor — no bursts, no breathers, no reading. The
// cap is the campaign's own maximum (act VI), so the ragged choreography
// survives to any depth and the campaign keeps its exact old plans.
const PAIR_CAP = 0.68;
const pairChance = act => Math.min(PAIR_CAP, 0.08 + (act - 1) * 0.12);
// The first act runs heavier (+3/+4/+4): its music only finds its voice at a
// 25 streak, and the opening act must let a clean player get there inside
// its second wave — 13 + 18 kills, where 10 + 14 left it out of reach.
const ACT1_EXTRA = [3, 4, 4];
function waveSize(run)   { return Math.min(40, 10 + (run.act - 1) * 7 + (run.wave - 1) * 4 + (run.act === 1 ? ACT1_EXTRA[run.wave - 1] || 0 : 0)); }
function spawnGap(run)   { return Math.max(0.34, 1.05 - (run.act - 1) * 0.16 - (run.wave - 1) * 0.06); }

// ---------- Run ----------
// mode 'endless' — no victory: acts keep counting past the fourth,
// Warden kinds cycle, and the record is the total wave number reached.
// mode 'daily' — a campaign run with the meta frozen; see startDaily.
function startRun(s, mode) {
  // the recording's seed is the rngState BEFORE the run consumes anything —
  // together with the upgrades snapshot it replays the run bit for bit
  const seed = s.rngState;
  s.meta.stats.runs++;
  s.run = {
    act: 1, wave: 1,
    planRng: (seed ^ 0x9E3779B9) | 0, // the plan stream's own state — see rndPlan
    ticks: 0, // completed fixed steps — the replay timeline's integer clock
    endless: mode === 'endless' || mode === 'monthly', // the monthly IS an endless run
    // The WAY is orthogonal to the mode: any of the four roads (campaign,
    // endless, daily, monthly) can be walked plainly or under the three
    // grammars. It is a standing choice in meta, so every start reads it and
    // no combination needs a button of its own.
    hard: wayHard(s),
    daily: mode === 'daily',
    monthly: mode === 'monthly',
    hp: 0, // set below once run exists (maxHp reads implants from run)
    combo: 0, bestCombo: 0, kills: 0, score: 0, credits: 0,
    implants: {},   // implant id -> times taken
    stasisHits: 0,  // connected presses toward the Stasis Discharge — monotonic,
                    // a miss stalls the charge but never wipes it (see STASIS_EVERY1)
    lastStrikeSide: 0, // side of the previous press — kept for mechanics that read press order
    stance: 'blade',   // the hand's current grammar (see STANCES)
    stanceCd: 0,       // sec until the stance may change again
    sameStance: 0,     // connected presses since the last switch — Blade Momentum's charge
    twinPress: null,   // first press of a twin chord: {pair, side, at}
    lastPress: null,   // the previous press of ANY kind: {side, at} — the zone-wide chord reads it
    buf: [],           // early presses waiting for a target: {side, t, prev} — see PRESS_BUFFER
    worldX: 0,         // the hero's accumulated world travel — drives background parallax in the UI
    stun: 0, time: 0,
    enemies: [], queue: [], waveT: 0, nextId: 1,
    offers: null,   // 3 implant ids offered between waves
    guardUsed: false, // the Emergency Capacitor fires once per run
    // the run's own ledger, read back by deathReport: every meaningful press,
    // every punished swing, every chain fault, every wound with its cause
    presses: 0, misses: 0, qteFails: 0, wounds: [],
    rerollsUsed: 0, // Reassembly firmware charges spent this run
    rec: null,      // the run's recording; filled below once the run exists
    cheated: false, // the hidden skip code was used — this run writes nothing to the meta
  };
  // a run born under debug invulnerability is tainted from its first frame —
  // records belong to runs the panel never touched (the recording built below
  // is dropped by the same taint once it exists)
  if (s.debug && s.debug.god) s.run.cheated = true;
  // combat starts HERE, before the loadout: the daily's meta freeze keys on a
  // live phase, and the grant below must already see the frozen levels
  s.phase = 'combat';
  // Factory Loadout: the run opens with pre-installed implants, rolled from the
  // same pool the shop draws on (stacks respected). Random on purpose — the
  // meta sells a head start, not a build.
  for (let i = metaLvl(s, 'mstart'); i > 0; i--) {
    const pool = IMPLANTS.filter(im => implantCount(s, im.id) < im.stack);
    if (!pool.length) break;
    const im = pool[Math.floor(rndPlan(s.run) * pool.length)];
    s.run.implants[im.id] = (s.run.implants[im.id] || 0) + 1;
  }
  s.run.hp = maxHp(s); // after the loadout — a granted battery raises the start
  // The recording: everything a replay needs to rebuild this run from nothing.
  // The upgrades snapshot is copied — the shop must not mutate history.
  s.run.rec = s.run.cheated ? null : { // born tainted (god pre-run) — no recording
    v: REPLAY_EPOCH,
    seed,
    mode: mode || 'campaign',
    hard: s.run.hard, // the way is part of the rules a ghost was played under
    upgrades: { ...s.meta.upgrades },
    a: [], // actions: {t, s: side} strikes · {c: idx} implant choices · {rr: 1} rerolls
  };
  buildWave(s);
}

function weightedPick(s, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let roll = rndPlan(s.run) * total; // wave composition rides the plan stream
  for (const k in weights) { roll -= weights[k]; if (roll <= 0) return k; }
  return 'drone';
}

// The newcomers' introduction. A body the act brings for the first time does
// not arrive by chance in the thick of a crowd: in the act's FIRST wave it is
// staged — the n-th body of the wave (DEBUT_SLOTS), alone on the road, with
// DEBUT_LEAD seconds clear before it and DEBUT_ROOM after. It is the same for
// everyone (replays and boards stay comparable): a veteran just meets a short
// gap in the column. The words that name the new rule are UI-only and stop once
// the profile has answered that body a few times (TEACH_FENCER etc. in main.js).
// Phrases. A wave is a string of phrases, not a bag of draws: a BREATHER
// (2–3 bodies, light ones, roomier gaps, never a pincer) and then a PRESS
// (3–5 bodies, the elites concentrated, tighter gaps, pincers likelier) —
// tension and release instead of noise. The press carries the elites the
// breather gave up: its elite share is the act table's × PRESS_SPREAD (at most
// PRESS_MAX), and only when that is not enough — the late acts, the deep
// road — the breather keeps the remainder, so the act's overall mix stays
// what ACT_WEIGHTS says. Between a press and the next breather — the old
// «lull» pause (2.2 gaps). Elites are the QUESTIONS; the shielder is heavy
// infantry, not one.
const ELITE = new Set(['thrower', 'fencer', 'adapt', 'twin', 'mimic']);
const PRESS_MAX = 0.85;
const PHRASE_PRESS = 4 / 6.5; // the press's expected share of a wave's bodies (3–5 against 2–3)
const PRESS_SPREAD = 1.6;
const PRESS_GAP = 0.85, BREATH_GAP = 1.2;  // spawn-gap multipliers inside each phrase
const PRESS_PAIR = 1.3;                    // pincer chance inside a press (× pairChance, capped)
// Combinations: from act VI (and on the deep road) a press may open with two
// questions scripted to meet — a shielder and a thrower arriving together from
// both sides, or the twins right behind a fencer's window.
const COMBO_ACT = 6;
const COMBO_CHANCE = 0.35;
// Clumping rules: never more than ELITE_RUN elites in a row on one side (the
// next one there is a light body), and THROW_SPACE seconds between two
// throwers' arrivals — their shuriken would otherwise land as one.
const ELITE_RUN = 2;
const THROW_SPACE = 0.9;
const DEBUT_SLOTS = [3, 9];
const DEBUT_LEAD = 1.6;
const DEBUT_ROOM = 2.4;
function actDebuts(r) {
  if (r.wave !== 1 || r.act < 2 || r.act > ACTS.length) return [];
  // new to the CAMPAIGN, not just to the act: the mimic skips the maglev and
  // comes back on the ship — a return, not a debut
  const seen = new Set(ACT_WEIGHTS.slice(0, r.act - 1).flatMap(w => Object.keys(w)));
  return Object.keys(ACT_WEIGHTS[r.act - 1]).filter(t => !seen.has(t));
}

// Wave generation. Choreography is defined by ARRIVAL time into the strike zone
// (solvability guarantee): intervals are planned at zone entry, and each enemy's
// spawn moment is back-computed from its speed. Otherwise a fast drone
// spawned after a slow walker catches up en route — and even spawn
// intervals turn into an unsolvable pile of simultaneous arrivals.
// Queue entry: {at — spawn second, arr — arrival second, type, side, dist}.
function buildWave(s) {
  const r = s.run;
  r.enemies = [];
  r.waveT = 0;
  r.waveKills = 0;   // kills in the current wave — nanovampirism threshold
  r.vampUsed = false; // nanovampirism repair: at most once per wave
  r.boss = null;
  r.bossPending = r.wave === WAVES_PER_ACT; // the act's last wave ends with a Warden
  r.waveHurt = false; // for the "perfect wave" tracking
  // mutator roll: from act 2, never on the Warden's wave; tests may force one
  r.mutator = null;
  if (r.forceMutator !== undefined) r.mutator = r.forceMutator;
  else if (r.act >= 2 && !r.bossPending && rndPlan(r) < MUTATOR_CHANCE) {
    // curated pairs join the pool only deep into endless; the campaign pool
    // keeps the base entries in table order, so its rnd mapping is unchanged
    const pool = r.endless && endlessWave(r) >= MUT_PAIR_WAVE
      ? MUTATORS : MUTATORS.filter(m => !m.combo);
    r.mutator = pool[Math.floor(rndPlan(r) * pool.length)].id;
  }
  r.rainT = 2.4; // STEEL RAIN: countdown to the first stray shuriken
  r.road = null;        // road weather never crosses a wave border
  r.roadT = undefined;  // the wave's first event re-rolls its own delay
  const sm = speedMult(r) * cryoMult(s) * mutSpeed(r);
  const zone = range(s);
  const minGap = sideArrGap(r.act);
  // pincer chance — simultaneous arrival from both sides — grows with acts
  const pairCh = pairChance(r.act);
  const anyGap = anyArrGap(r.act);
  let size = waveSize(r);
  let weights = waveWeights(r); // campaign tables, drifting deep past the summit
  let gapMul = 1;
  const debuts = actDebuts(r); // staged in order at DEBUT_SLOTS; a squall wave has none
  if (mutHas(r, 'squall')) {
    debuts.length = 0;
    // squall: many light enemies, packed tighter
    size = Math.min(46, Math.round(size * SQUALL_SIZE));
    weights = { drone: 6, punk: 2.5 };
    gapMul = 0.85;
  }
  const q = [];
  const lastArr = { '-1': -Infinity, '1': -Infinity };
  let lastAny = -Infinity; // last arrival from either side
  let arr = 0; // arrival timeline; the whole wave is shifted to a normal start at the end
  let side = rndPlan(r) < 0.5 ? -1 : 1;
  // The fencer is the road's slowest question — his duel holds his column
  // while guard and window play out, and fencers stacked close stall the
  // whole street. The spacing is counted in TIME, not slots: a slot cooldown
  // leaked through pincers, which compress several slots into one instant.
  // A new fencer may only be drawn once the arrival cursor has moved a full
  // window cycle past the previous fencer's arrival — however many pincer
  // partners and twins landed in between. The thrower keeps his own, shorter
  // spacing (THROW_SPACE).
  const fenSpace = FENCER_GUARD + FENCER_OPEN;
  let lastFenArr = -Infinity, lastThrowArr = -Infinity;
  let quietUntil = -Infinity, prevDebut = false, staged = 0; // the room a staged newcomer keeps after itself
  // the phrase pools: elites weighed up in the press, down (to none, early on) in the breather
  const lightW = {};
  let eliteSum = 0, allSum = 0;
  for (const t in weights) {
    allSum += weights[t];
    if (ELITE.has(t)) eliteSum += weights[t]; else lightW[t] = weights[t];
  }
  const eShare = allSum ? eliteSum / allSum : 0;
  const pShare = Math.min(PRESS_MAX, eShare * PRESS_SPREAD);
  const bRest = (eShare - PHRASE_PRESS * pShare) / (1 - PHRASE_PRESS);
  const bShare = bRest < 0.05 ? 0 : bRest; // a sliver is rounding, not a remainder — the breather stays clean
  // scale the elites so that they make up `share` of the pool, the light ones keep their ratios
  const tilt = share => {
    const k = eShare > 0 && eShare < 1 && share > 0 ? share * (1 - eShare) / (eShare * (1 - share)) : 0;
    const w = {};
    for (const t in weights) {
      const v = weights[t] * (ELITE.has(t) ? k : 1);
      if (v > 0) w[t] = v;
    }
    return Object.keys(w).length ? w : weights;
  };
  const pressW = eShare > 0 && eShare < 1 ? tilt(pShare) : weights;
  const breathW = eShare > 0 && eShare < 1 ? tilt(bShare) : weights;
  let phrase = 'breath', phraseLeft = 2 + Math.floor(rndPlan(r) * 2);
  let combo = []; // the scripted pair at the head of a press, consumed in order
  const streak = { '-1': 0, '1': 0 }; // elites in a row on each side
  const lightPick = () => weightedPick(s, Object.keys(lightW).length ? lightW : { drone: 1 });
  r.waveTotal = size; // actual wave size (mutators change it) — the nanovampirism threshold
  for (let i = 0; i < size; i++) {
    if (phraseLeft <= 0) {
      if (phrase === 'press') {
        arr += spawnGap(r) * 2.2 * gapMul; // the lull between a press and the next breather
        phrase = 'breath';
        phraseLeft = 2 + Math.floor(rndPlan(r) * 2);
      } else {
        phrase = 'press';
        phraseLeft = 3 + Math.floor(rndPlan(r) * 3);
        if (r.act >= COMBO_ACT && !mutHas(r, 'squall') && rndPlan(r) < COMBO_CHANCE) {
          const opts = [];
          if (weights.shield && weights.thrower && arr >= lastThrowArr + THROW_SPACE) {
            opts.push([{ type: 'shield' }, { type: 'thrower', pincer: true }]);
          }
          if (weights.fencer && weights.twin && i < size - 2 && arr >= lastFenArr + fenSpace) {
            opts.push([{ type: 'fencer' }, { type: 'twin', afterFencer: true }]);
          }
          if (opts.length) combo = opts[Math.floor(rndPlan(r) * opts.length)];
        }
      }
    }
    phraseLeft--;
    const press = phrase === 'press';
    const gm = gapMul * (press ? PRESS_GAP : BREATH_GAP);
    if (arr < quietUntil) arr = quietUntil;
    let pool = { ...(press ? pressW : breathW) };
    if (arr < lastFenArr + fenSpace) delete pool.fencer;
    if (arr < lastThrowArr + THROW_SPACE) delete pool.thrower;
    // a newcomer still waiting for its staged entrance is not drawn by chance before it
    for (const t of debuts) delete pool[t];
    if (!Object.keys(pool).length) pool = { drone: 1 };
    let type = weightedPick(s, pool);
    const debut = debuts.length > 0 && i >= DEBUT_SLOTS[staged] &&
      (debuts[0] !== 'twin' || i < size - 1);
    let forced = null;
    if (debut) {
      type = debuts.shift();
      staged++;
      combo = []; // the introduction owns the moment
      arr = Math.max(arr, lastAny + DEBUT_LEAD);
    } else if (combo.length) {
      forced = combo.shift();
      type = forced.type;
    }
    if (type === 'twin' && !debut && !forced && (streak['-1'] >= ELITE_RUN || streak['1'] >= ELITE_RUN)) {
      type = lightPick(); // a pair would be the third elite in a row on one side
    }
    if (type === 'twin') {
      // twins come as a mirrored pair on both sides simultaneously (2 slots)
      if (i >= size - 1) type = 'drone'; // not enough room for a pair
      else {
        if (forced && forced.afterFencer) arr = Math.max(arr, lastFenArr + fenSpace); // right behind his window
        arr += spawnGap(r) * (0.75 + rndPlan(r) * 0.5) * gm;
        const arrT = Math.max(arr, lastArr['-1'] + minGap, lastArr['1'] + minGap, lastAny + anyGap);
        lastArr['-1'] = lastArr['1'] = arrT;
        lastAny = arrT;
        if (arrT > arr) arr = arrT;
        const dist = SPAWN_DIST * (0.92 + rndPlan(r) * 0.16);
        const travel = (dist - zone) / (ENEMY_TYPES.twin.speed * sm);
        // ph/combo/debut/ord: how the plan was built — read by tests only, never by the sim
        const tag = { ph: press ? 1 : 0, combo: forced ? 1 : 0, debut: debut ? 1 : 0, ord: q.length };
        q.push({ at: arrT - travel, arr: arrT, type: 'twin', side: -1, dist, pair: i, ...tag });
        q.push({ at: arrT - travel, arr: arrT, type: 'twin', side: 1, dist, pair: i, ...tag });
        streak['-1']++; streak['1']++;
        if (debut) quietUntil = arrT + DEBUT_ROOM;
        prevDebut = debut;
        phraseLeft--; // the pair takes two of the phrase's bodies
        i++;
        continue;
      }
    }
    let thisSide, thisArr;
    // the fencer never arrives as a pincer partner: the pair shares the
    // PREVIOUS pick's arrival time, which would drop his duel behind the
    // spacing rule above — and a duel opening simultaneously with another
    // body is exactly the stall the rule exists to prevent
    // ...nor does a newcomer on its staged entrance, nor anyone beside it.
    // A breather never pincers; a press does more often; a combo's thrower always.
    const pin = forced && forced.pincer && q.length ? true
      : press && i > 0 && q.length && type !== 'fencer' && !debut && !prevDebut &&
        rndPlan(r) < Math.min(0.68, pairCh * PRESS_PAIR);
    if (pin) {
      // pincers: same arrival, opposite side — a deliberate test
      const prev = q[q.length - 1];
      thisSide = -prev.side;
      thisArr = prev.arr;
    } else {
      // the side switches more often than it stays — no single-button turkey shoot
      side = rndPlan(r) < 0.62 ? -side : side;
      thisSide = side;
      arr += spawnGap(r) * (0.75 + rndPlan(r) * 0.5) * gm;
      thisArr = arr;
    }
    // the third elite in a row on this side stands down for a light body
    if (ELITE.has(type) && !debut && !forced && streak[thisSide] >= ELITE_RUN) type = lightPick();
    // solvability guarantee: per side no denser than minGap; combined no denser than anyGap
    // (pincers arrive simultaneously on purpose and bypass the global limit)
    thisArr = Math.max(thisArr, lastArr[thisSide] + minGap);
    if (thisArr !== q[q.length - 1]?.arr) thisArr = Math.max(thisArr, lastAny + anyGap);
    lastArr[thisSide] = thisArr;
    lastAny = Math.max(lastAny, thisArr);
    if (thisArr > arr) arr = thisArr;
    const dist = SPAWN_DIST * (0.92 + rndPlan(r) * 0.16);
    const travel = (dist - zone) / (ENEMY_TYPES[type].speed * sm);
    // a mimic rolls real-or-phantom at planning time; hidden until it nears the zone
    const phantom = type === 'mimic' && rndPlan(r) < MIMIC_PHANTOM;
    q.push({ at: thisArr - travel, arr: thisArr, type, side: thisSide, dist, phantom,
      ph: press ? 1 : 0, combo: forced ? 1 : 0, debut: debut ? 1 : 0, ord: q.length });
    streak[thisSide] = ELITE.has(type) ? streak[thisSide] + 1 : 0;
    if (type === 'fencer') lastFenArr = thisArr;
    if (type === 'thrower') lastThrowArr = thisArr;
    if (debut) quietUntil = thisArr + DEBUT_ROOM;
    prevDebut = debut;
  }
  // Seals go on in a second pass, after the crowd is choreographed: the rolls
  // sit at the tail of the planning stream, so a seed keeps the wave it always
  // had and only gains marks. Only the rank and file can be sealed, only once
  // the whole vocabulary is in hand, and never more than a couple a wave.
  if (r.act >= SEAL_ACT) {
    let left = sealPerWave(r.act); // the deep road may ask more (stance way)
    for (const e of q) {
      if (left <= 0) break;
      if (!SEALABLE.includes(e.type)) continue;
      if (rndPlan(r) >= sealChance(r.act)) continue;
      e.seal = Math.floor(rndPlan(r) * STANCES.length) % STANCES.length;
      left--;
    }
  }
  // first spawn at second 0.8 of the wave
  const minAt = Math.min(...q.map(e => e.at));
  for (const e of q) { e.at += 0.8 - minAt; e.arr += 0.8 - minAt; }
  q.sort((a, b) => a.at - b.at);
  r.queue = q;
}

// ---------- Tick ----------
// Returns a list of UI events: throw, hurt, dead, waveClear, actClear, victory, reflectKill.
//
// The frame is a fixed pipeline, each step its own function below. The order
// matters twice over: later steps read state the earlier ones wrote, and three
// of them (rain, walkers, the Warden) consume the shared seeded RNG — reordering
// would silently reshuffle every run with the same seed.
function tick(s, dt) {
  const ev = [];
  if (s.phase !== 'combat') return ev;
  const r = s.run;
  r.ticks++; // strikes recorded between ticks carry the pre-increment value
  r.time += dt;
  r.waveT += dt;
  if (r.stun > 0) r.stun = Math.max(0, r.stun - dt);
  if (r.stanceCd > 0) r.stanceCd = Math.max(0, r.stanceCd - dt);

  // The renderer's interpolation anchor: where every body stood when the
  // previous tick ended. Taken before any movement or spawning this tick; the
  // simulation itself never reads pd, so replays stay bit-for-bit. (Entities
  // born mid-tick carry no pd and draw at their true dist for one step.)
  for (const e of r.enemies) e.pd = e.dist;
  if (r.boss) r.boss.pd = r.boss.dist;

  const sm = speedMult(r) * cryoMult(s) * mutSpeed(r) * surgeMult(r);
  const rg = range(s);

  spawnFromQueue(r, ev);
  stepSteelRain(s, ev, dt, sm);
  stepRoad(s, ev, dt, rg);
  expireTwinWindow(s, ev);
  stepWalkers(s, ev, dt, rg, sm);
  resolveFormation(r);
  r.enemies = r.enemies.filter(e => !e.dead);
  stepBuffer(s, ev, dt, rg);

  const fieldEmpty = !r.queue.length &&
    !r.enemies.some(e => (e.kind === 'proj' ? !e.reflected : true));
  stepBoss(s, ev, dt, rg, sm, fieldEmpty);

  if (s.phase === 'combat' && fieldEmpty && !r.bossPending) {
    clearWave(s, ev);
  }
  return ev;
}

function spawnFromQueue(r, ev) {
  while (r.queue.length && r.queue[0].at <= r.waveT) {
    const q = r.queue.shift();
    const t = ENEMY_TYPES[q.type];
    r.enemies.push({
      id: r.nextId++, type: q.type, side: q.side,
      dist: q.dist, // distance assigned during wave planning
      // blitz: everyone is one hit softer (but never below one)
      hits: mutHas(r, 'blitz') ? Math.max(1, t.hits - 1) : t.hits,
      thrown: false, pair: q.pair, phantom: q.phantom, seal: q.seal,
    });
    if (q.seal !== undefined && ev) ev.push({ type: 'sealTell', side: q.side, dist: q.dist, seal: q.seal });
  }
}

// STEEL RAIN: while the wave is still coming, stray shurikens fly in on their own
function stepSteelRain(s, ev, dt, sm) {
  const r = s.run;
  if (mutHas(r, 'steel') &&
      (r.queue.length || r.enemies.some(e => !e.dead && e.kind !== 'proj'))) {
    r.rainT -= dt;
    if (r.rainT <= 0) {
      r.rainT += RAIN_EVERY;
      const rainSide = rnd(s) < 0.5 ? -1 : 1;
      const rainDist = SPAWN_DIST * 0.72;
      r.enemies.push({
        kind: 'proj', id: r.nextId++, owner: 0, side: rainSide,
        dist: rainDist, projSpeed: ENEMY_TYPES.thrower.projSpeed * projSpeedMult(sm) * jamProjMult(s),
      });
      ev.push({ type: 'throw', side: rainSide, dist: rainDist });
    }
  }
}

// Road weather: schedule, telegraph and play the location's rule. Consumes
// the combat rnd stream (period jitter, the roll's tilt side) at a fixed
// pipeline position — reordering would reshuffle every seeded run.
function stepRoad(s, ev, dt, rg) {
  const r = s.run;
  const rule = roadRule(r.act);
  // the Warden's approach owns the road — weather clears and stays cleared
  if (!rule || r.boss) { r.road = null; return; }
  const rd = r.road;
  if (rd) {
    if (rd.warn > 0) {
      rd.warn = Math.max(0, rd.warn - dt);
      if (rd.warn === 0) ev.push({ type: 'road', kind: rd.kind, dir: rd.dir });
      return;
    }
    // the roll slides the deck while it lasts; the wind rides the walkers'
    // own step (stepWalkers), the glitch is a pure UI veil (roadVeil)
    if (rd.kind === 'roll') {
      const shift = (ROLL_DIST / ROLL_TIME) * Math.min(dt, rd.t);
      const twinAlive = {};
      for (const o of r.enemies) {
        if (!o.dead && o.type === 'twin') twinAlive[o.pair] = (twinAlive[o.pair] || 0) + 1;
      }
      for (const o of r.enemies) {
        if (o.dead || o.kind === 'proj' || o.dist <= rg) continue;
        if (o.fstate || (o.windup !== undefined && !o.thrown)) continue;
        if (o.hold > 0) continue; // frozen is frozen — the stasis promise holds
        if (o.type === 'twin' && twinAlive[o.pair] === 2) continue;
        o.dist = o.side === rd.dir
          ? Math.max(rg, o.dist - shift)
          : Math.min(SPAWN_DIST, o.dist + shift);
      }
    }
    rd.t -= dt;
    if (rd.t <= 0) r.road = null;
    return;
  }
  if (r.roadT === undefined) r.roadT = 3 + rnd(s) * 2; // the wave's first event
  r.roadT -= dt;
  if (r.roadT > 0) return;
  // fire only with someone actually approaching: under the empty-road warp
  // the telegraph would compress into a blink and read as nothing at all
  if (!r.enemies.some(o => !o.dead && o.kind !== 'proj' && o.dist > rg && o.dist < ROAD_NEAR)) {
    r.roadT = 0.25; // retry as soon as the road is peopled again
    return;
  }
  const conf = ROAD_CONF[rule];
  const dir = rule === 'roll' ? (rnd(s) < 0.5 ? -1 : 1) : 0;
  r.road = { kind: rule, dir, warn: ROAD_WARN, t: conf.time };
  r.roadT = conf.every + rnd(s) * conf.rnd;
  ev.push({ type: 'roadWarn', kind: rule, dir });
}

function expireTwinWindow(s, ev) {
  const r = s.run;
  // The twin chord window expired. The pair used to be shoved back 90 units here,
  // on the theory that a failed attempt earns a retry. In practice a twin is often
  // simply the nearest enemy, so ordinary alternation kept starting chords it never
  // finished: measured at a human press cadence, a pair took 29 shoves and racked up
  // 3100 units of pushback — four times its whole approach — and was NEVER killed,
  // while dealing no damage either. It was an unkillable, harmless ping-pong, and it
  // is why pairs always outlived the rest of the wave. Now the window just lapses:
  // the pair keeps walking, so ignoring it costs armour and the chord stays the
  // deliberate answer. The event survives — the UI uses it to teach the rule.
  // What the lapse DOES cost is the press itself: a pair in the zone can only be
  // answered by a chord, so a lone press was never a strike at all. It resolves as a
  // miss — stun and a wiped combo — once the window closes rather than on contact,
  // because punishing the first press outright would make the chord unreachable.
  if (r.twinPress && r.time - r.twinPress.at > CHORD_WIN) {
    const { pair, side } = r.twinPress;
    r.twinPress = null;
    // ...but only if the pair is still standing: if it vanished between the press
    // and the lapse, there is nothing the press failed to answer — no punishment
    const alive = r.enemies.reduce((n, o) =>
      n + (!o.dead && o.type === 'twin' && o.pair === pair ? 1 : 0), 0);
    if (alive >= 2) {
      r.stun = stunTime(s);
      r.combo = 0;
      r.misses++; // the lone press was never a strike — it resolves as a miss
      ev.push({ type: 'twinKnock', side });
    }
  }
}

// The early-press buffer (see PRESS_BUFFER): queued presses land the tick their
// target crosses into reach, or expire into the full miss punishment. Living
// inside the tick keeps replays honest — a conversion is a pure function of the
// simulation state, so the ghost's buffered presses land on the same tick on
// every machine.
function stepBuffer(s, ev, dt, rg) {
  const r = s.run;
  if (!r.buf || !r.buf.length) return;
  // a stun (twin lapse, a phantom whiff) or an opening duel empties the hands:
  // during the QTE every press belongs to the chain, a leftover ordinary swing
  // feeding a chain link would be nonsense
  if (r.stun > 0 || (r.boss && r.boss.state === 'qte')) { r.buf.length = 0; return; }
  for (const q of r.buf.slice()) {
    const ready =
      nearestWalker(r, q.side, null, o => o.dist <= rg) ||
      r.enemies.some(e => !e.dead && e.kind === 'proj' && !e.reflected && e.side === q.side && e.dist <= rg) ||
      (r.boss && r.boss.state === 'walk' && r.boss.side === q.side && r.boss.dist <= rg);
    if (ready) {
      r.buf.splice(r.buf.indexOf(q), 1);
      ev.push({ type: 'bufferedStrike', ev: strikeCore(s, q.side, q.prev, false) });
      // the landed swing may have ended the wave, stunned the hero (a phantom)
      // or opened a duel — in each case whatever is still queued must not fire
      if (s.phase !== 'combat' || r.stun > 0 ||
          (r.boss && r.boss.state === 'qte')) { r.buf.length = 0; return; }
    } else if ((q.t -= dt) <= 0) {
      // nothing arrived: the swing was a whiff after all — the full price, and
      // the flub's stun takes any other queued press down with it
      r.buf.length = 0;
      ev.push({ type: 'bufferedStrike', ev: flubMiss(s, q.side) });
      return;
    }
  }
}

// Walkers and projectiles: every enemy's own step of the approach.
function stepWalkers(s, ev, dt, rg, sm) {
  const r = s.run;
  // Duel focus: while the QTE shred runs, every press belongs to the chain and
  // walkers cannot be fought off — so they freeze. Unanswerable damage is unfair.
  // (Only the Shogun's summons can coexist with a Warden; projectiles keep flying.)
  const qteLock = !!(r.boss && r.boss.state === 'qte');
  for (const e of r.enemies) {
    if (e.dead) continue;
    if (e.kind === 'proj') {
      if (e.reflected) {
        e.dist += e.projSpeed * dt; // flies back into its owner
        // the Armorer's own blade coming back burns a link out of his NEXT
        // chain (banked in b.burn, spent at qteStart) — deflection becomes
        // an attack on the duel itself, not just self-defence
        const bBoss = r.boss;
        if (e.fromBoss && bBoss && e.side === bBoss.side && e.dist >= bBoss.dist) {
          if (bBoss.state === 'walk' && e.parries > 0) {
            // the rally: he bats the return straight back, one parry spent,
            // the blade a shade hotter — mid-duel he is busy and never parries
            e.parries--;
            e.reflected = false;
            e.dist = Math.min(e.dist, bBoss.dist);
            e.projSpeed *= 1.08;
            ev.push({ type: 'bossParry', side: e.side, dist: bBoss.dist, left: e.parries });
            continue;
          }
          e.dead = true;
          bBoss.burn = Math.min(ARMORER_BURN_CAP, (bBoss.burn || 0) + 1);
          ev.push({ type: 'bossBurn', side: e.side, dist: bBoss.dist, burn: bBoss.burn });
          continue;
        }
        // An intercepted blade flies THROUGH the crowd to its mark — the
        // re-aim would mean nothing if the first body crossed still ate it —
        // and the mark DIES. The implant aims at the most dangerous body on
        // the side, and a single point of chip damage skidding off a plate
        // read as a dud: the whole payoff of the deflect is decisiveness,
        // the way a thrower's own return has always killed its owner. A mark
        // that died mid-flight is forgotten and the blade falls back to the
        // plain one-bite rules of ownerless steel.
        if (e.icept !== undefined) {
          const mark = r.enemies.find(o => o.id === e.icept && !o.dead);
          if (!mark || mark.side !== e.side) e.icept = undefined;
          else if (e.dist >= mark.dist) {
            e.dead = true;
            s.meta.stats.iceptKills = (s.meta.stats.iceptKills || 0) + 1;
            const healed = killEnemy(s, mark);
            ev.push({ type: 'reflectKill', side: e.side, dist: mark.dist, enemy: mark.type, icept: true });
            if (healed) ev.push({ type: 'vamp' });
            continue;
          } else continue; // still flying to the mark
        }
        const owner = r.enemies.find(o => o.id === e.owner && !o.dead);
        if (owner && owner.side === e.side && e.dist >= owner.dist) {
          const healed = killEnemy(s, owner);
          e.dead = true;
          ev.push({ type: 'reflectKill', side: e.side, dist: owner.dist, enemy: owner.type });
          if (healed) ev.push({ type: 'vamp' });
        } else if (!owner && !e.fromBoss) {
          // Ownerless steel — the rain's, or the thrower died before his blade
          // came home — is not spent: it bites the first solid walker it
          // crosses. Eligibility is the intercept's rule (auto-steel must not
          // cheat a mechanic): a guarded stance and twins are off-limits, a
          // hologram is not solid. One bite: a kill or one hit, blade spent.
          const prev = e.dist - e.projSpeed * dt; // where this tick's flight began
          let victim = null;
          for (const w of r.enemies) {
            if (w.dead || w.kind === 'proj' || w.side !== e.side || w.phantom) continue;
            if (w.fstate === 'guard' || ENEMY_TYPES[w.type].twin) continue;
            if (w.dist > e.dist || w.dist < prev) continue;
            if (!victim || w.dist < victim.dist) victim = w;
          }
          if (victim) {
            e.dead = true;
            victim.hits -= 1;
            if (victim.hits <= 0) {
              const healed = killEnemy(s, victim);
              ev.push({ type: 'reflectKill', side: e.side, dist: victim.dist, enemy: victim.type });
              if (healed) ev.push({ type: 'vamp' });
            } else {
              ev.push({ type: 'reflectHit', side: e.side, dist: victim.dist, enemy: victim.type });
            }
          } else if (e.dist > SPAWN_DIST * 1.15) e.dead = true;
        } else if (e.dist > SPAWN_DIST * 1.15) e.dead = true;
      } else {
        e.dist -= e.projSpeed * dt;
        if (e.dist <= HIT_DIST) { e.dead = true; hurt(s, ev, e); }
      }
      continue;
    }
    if (qteLock) continue;
    // a body held by a riposte stands where the glance left it
    if (e.hold > 0) { e.hold = Math.max(0, e.hold - dt); continue; }
    const t = ENEMY_TYPES[e.type];
    // the type's own per-frame step (fencer stance, mimic flash, thrower wind-up);
    // truthy means it handled this frame and the generic advance below is skipped
    const behavior = ENEMY_BEHAVIOR[e.type];
    if (behavior && behavior.update && behavior.update(e, { s, r, ev, dt, rg, sm })) {
      if (s.phase !== 'combat') break; // a fencer lunge can end the run
      continue;
    }
    let step = t.speed * (e.thrown ? 0.6 : 1) * sm * dt;
    // the road wind carries the approach — up to the rim, never past it, and
    // never slower than the honest walk (a body at the rim just walks in)
    if (r.road && r.road.kind === 'wind' && !r.road.warn && r.road.t > 0 && e.dist > rg) {
      step = Math.min(step * WIND_MULT, Math.max(step, e.dist - rg));
    }
    e.dist -= step;
    if (e.dist <= HIT_DIST) {
      e.dead = true;
      if (t.mimic && e.phantom) {
        // Read correctly and left alone: a hologram passes through, no damage. A held
        // hand should feel as good as a landed hit, so it keeps the combo going (and
        // pays a little score). The stasis charge is left alone — that one tracks
        // actual strikes, and a read is the absence of one.
        bumpCombo(r);
        r.score += 12;
        s.meta.stats.mimicReads = (s.meta.stats.mimicReads || 0) + 1;
        ev.push({ type: 'phantomFade', side: e.side, combo: r.combo });
      } else hurt(s, ev, e);
    }
    if (s.phase !== 'combat') break; // the hero died — stop simulating
  }
}

// Formation repair: the crowd queues instead of piling up, and a twin pair
// moves as one — a jam in one column would desync it and kill the chord.
function resolveFormation(r) {
  // following distance: no piling onto the one in front, the crowd queues
  for (const sideK of [-1, 1]) {
    const col = r.enemies
      .filter(e => !e.dead && e.kind !== 'proj' && e.side === sideK)
      .sort((a, b) => a.dist - b.dist);
    for (let i = 1; i < col.length; i++) {
      if (col[i].dist < col[i - 1].dist + FOLLOW_GAP) col[i].dist = col[i - 1].dist + FOLLOW_GAP;
    }
  }
  // twins keep a mirrored formation: the pair moves as one, otherwise a jam
  // in one column desyncs them and the chord becomes impossible
  const pairLead = {};
  for (const e of r.enemies) {
    if (e.dead || e.type !== 'twin') continue;
    if (pairLead[e.pair]) {
      const d = Math.max(pairLead[e.pair].dist, e.dist);
      pairLead[e.pair].dist = d;
      e.dist = d;
    } else pairLead[e.pair] = e;
  }
}

// Act Warden: emerges once the last wave's regular enemies are gone, walks in,
// and duels. The kind's signature trick lives in BOSS_BEHAVIOR.
function stepBoss(s, ev, dt, rg, sm, fieldEmpty) {
  const r = s.run;
  if (s.phase === 'combat' && r.bossPending && !r.boss && fieldEmpty) {
    const kind = bossKind(r.act);
    r.boss = {
      side: rnd(s) < 0.5 ? -1 : 1,
      dist: SPAWN_DIST,
      state: 'walk', // walk | qte
      kind, // the signature trick: 2 — gusts, 3 — glitch links, 4 — summons
      phase: 0,
      phases: BOSS_PHASES(r.act),
      seq: null, glitch: null, idx: 0, timer: 0, timerMax: 0,
      gust: 0, gustT: 0,
      windup: 0, // Maglev: the howl before a chain gust bites
    };
    const bb0 = BOSS_BEHAVIOR[kind];
    if (bb0 && bb0.init) bb0.init(r.boss);
    // meeting a Warden is what retires his teaching line — count it here, at the
    // one place he actually walks onto the field
    r.boss.seen = (s.meta.story.bossSeen[kind] || 0) + 1;
    s.meta.story.bossSeen[kind] = r.boss.seen;
    ev.push({ type: 'bossSpawn', side: r.boss.side, act: r.act, kind, seen: r.boss.seen });
  }
  const b = r.boss;
  if (s.phase === 'combat' && b) {
    const bb = BOSS_BEHAVIOR[b.kind];
    if (b.state === 'walk') {
      if (bb && bb.walkUpdate) bb.walkUpdate({ s, r, b, ev, dt, rg, sm });
      b.dist -= BOSS_SPEED * sm * (b.gust > 0 ? GUST_MULT : 1) * dt;
      // fairness floor: past the first quarter of the zone the gust dies rather
      // than eat the reaction window — the wind may cross the zone's edge at
      // full speed, but it steals anticipation, never the answer
      if (b.gust > 0 && b.dist <= rg * GUST_ZONE_K &&
          (b.dist - HIT_DIST) / (BOSS_SPEED * sm * GUST_MULT) < GUST_FLOOR) {
        b.gust = 0;
      }
      if (b.dist <= HIT_DIST) {
        b.dist = BOSS_RETREAT; // lands a hit — and backs off for another approach
        hurt(s, ev, { side: b.side });
        if (bb && bb.retreat) bb.retreat({ s, b });
      }
    } else if (b.state === 'qte') {
      if (bb && bb.qteUpdate) bb.qteUpdate({ s, b, ev, dt });
      b.timer -= dt;
      if (b.timer <= 0) {
        // the side that held the chain, taken BEFORE the teardown: the Double's
        // retreat inside abortChain re-rolls b.side, and the verdict must name
        // the wall the wound came from, not the side of the next approach
        const bs = b.side;
        abortChain(s, b, 'timeout', ev);
        ev.push({ type: 'qteFail', side: bs, reason: 'timeout' });
      }
    }
  }
}

// Tainting is terminal for more than records: the RECORDING dies with the
// run's honesty. Debug pokes and skips mutate state outside the recorded
// channels, so a tainted run's replay would be a lie — it must not survive to
// be watched or shared.
function taintRun(r) {
  r.cheated = true;
  r.rec = null;
}

// The hero takes a hit: −1 armor, combo to zero, nearby enemies mercifully retreat.
// `cause` overrides the wound's ledger entry where the source object is
// ambiguous (the fencer's riposte passes an untyped source on purpose — the UI
// reads a typed one as a corpse); everywhere else it is derived from `from`.
function hurt(s, ev, from, cause) {
  const r = s.run;
  if (s.debug && s.debug.god) {
    // debug invulnerability: the blocked wound taints the run right here — god
    // switched on BEFORE the run started would otherwise slip past the panel's
    // own taint (it only marks a run that already exists)
    taintRun(r);
    return;
  }
  r.waveHurt = true;
  r.hp--;
  r.combo = 0;
  r.wounds.push({
    cause: cause || (from.kind === 'proj' ? 'proj' : from.type || 'boss'),
    act: r.act, wave: r.wave,
  });
  // Emergency Capacitor: the killing blow is survived at 1 armor, once per run.
  // The discharge supersedes ordinary mercy — every walker is hurled out to
  // twice the mercy distance, and shurikens still in flight are fried where
  // they hang (an unanswerable blade a frame after the save would make the
  // rescue a lie). Reflected blades are the player's — they keep flying.
  const saved = r.hp <= 0 && r.implants.guard && !r.guardUsed;
  if (saved) {
    r.guardUsed = true;
    r.hp = 1;
    if (r.boss && r.boss.state === 'walk') r.boss.dist = Math.max(r.boss.dist, BOSS_RETREAT);
  }
  const repel = saved ? GUARD_REPEL : MERCY_DIST;
  for (const o of r.enemies) {
    if (o.dead) continue;
    if (o.kind === 'proj') {
      if (saved && !o.reflected) o.dead = true;
      continue;
    }
    if (o.dist < repel) {
      o.dist = repel;
      if (o.fstate) { o.fstate = null; o.ftimer = 0; } // a pushed-back fencer drops his stance
    }
  }
  ev.push({ type: 'hurt', side: from.side, hp: r.hp, enemy: from.type, dist: from.dist });
  if (saved) ev.push({ type: 'guardSave', side: from.side });
  if (r.hp <= 0) {
    endRun(s, false);
    ev.push({ type: 'dead' });
  }
}

// ---------- Hidden wave skip ----------
// An escape hatch (Ctrl+Shift+K in the UI): the current wave is dropped as if it
// had been cleared — the Warden included. The price is the run's honesty: a
// tainted run writes no records, no achievements and no credits into the meta,
// so the code cannot be used to farm progress. The flag never clears.
function skipWave(s) {
  const r = s.run;
  if (!r || s.phase !== 'combat') return null;
  taintRun(r);
  r.enemies = [];
  r.queue = [];
  r.boss = null;
  r.bossPending = false;
  const ev = [{ type: 'waveSkipped', act: r.act, wave: r.wave }];
  clearWave(s, ev);
  return ev;
}

function clearWave(s, ev) {
  const r = s.run;
  if (r.buf) r.buf.length = 0; // a press queued at the wave's end dies with the wave
  // a skipped wave is nobody's flawless wave
  if (!r.waveHurt && !r.cheated) s.meta.stats.perfectWaves++;
  if (!r.endless && r.wave >= WAVES_PER_ACT && r.act >= ACTS.length) {
    r.credits = Math.round(r.credits * VICTORY_BONUS);
    endRun(s, true);
    ev.push({ type: 'victory' });
  } else {
    const evObj = { type: r.wave >= WAVES_PER_ACT ? 'actClear' : 'waveClear', act: r.act, wave: r.wave };
    r.offers = rollOffers(s);
    if (!r.offers.length) {
      // deep endless: every implant stack is full — straight into the next wave
      r.offers = null;
      advanceWave(s);
      buildWave(s);
      evObj.auto = true;
    } else {
      s.phase = 'choice';
    }
    ev.push(evObj);
  }
}

function advanceWave(s) {
  const r = s.run;
  r.stance = 'blade'; // every act opens in the plain grammar
  r.stanceCd = 0;
  if (r.wave >= WAVES_PER_ACT) {
    r.act++;
    r.wave = 1;
    // Repair Dock: the border between acts patches one plate — an act's wounds
    // stop bleeding into the whole rest of the run
    if (metaLvl(s, 'mdock') && r.hp < maxHp(s)) r.hp++;
  } else r.wave++;
}

// Random distinct implants whose stack is not exhausted — three by default,
// four with the Extended Bay firmware (frozen to three in the daily).
function rollOffers(s) {
  const pool = IMPLANTS.filter(im => implantCount(s, im.id) < im.stack);
  const out = [];
  const slots = 3 + (metaLvl(s, 'mslot') ? 1 : 0);
  while (out.length < slots && pool.length) {
    // the plan stream: on a shared daily seed, the same pick history sees the
    // same cards — however differently the fights themselves went
    out.push(pool.splice(Math.floor(rndPlan(s.run) * pool.length), 1)[0].id);
  }
  return out;
}

// Reassembly: reroll the standing offers, spending one of the firmware's
// charges. The new roll may repeat items — the dice owe nothing.
function rerollOffers(s) {
  const r = s.run;
  if (s.phase !== 'choice' || !r || !r.offers) return false;
  if ((r.rerollsUsed || 0) >= metaLvl(s, 'mreroll')) return false;
  if (r.rec) r.rec.a.push({ t: r.ticks, rr: 1 });
  r.rerollsUsed = (r.rerollsUsed || 0) + 1;
  r.offers = rollOffers(s);
  return true;
}

function chooseImplant(s, idx) {
  const r = s.run;
  if (s.phase !== 'choice' || !r.offers || !r.offers[idx]) return false;
  if (r.rec) r.rec.a.push({ t: r.ticks, c: idx });
  const id = r.offers[idx];
  r.implants[id] = (r.implants[id] || 0) + 1;
  if (id === 'hp') r.hp = Math.min(r.hp + 1, maxHp(s)); // the battery repairs immediately
  r.offers = null;
  advanceWave(s);
  s.phase = 'combat';
  buildWave(s);
  return true;
}

// Hero dash: the world is stored hero-relative, so "the hero moved to the victim" =
// "everything shifted": same-side entities closer, opposite-side ones farther.
// worldX accumulates absolute travel for background parallax.
function applyDash(s, side, m) {
  const r = s.run;
  if (m <= 0) return 0;
  r.worldX += side * m;
  const holdD = range(s) * 0.94; // the fencer's dueling measure — where his own advance stops
  // Living pairs count once, up front: a twin pair straddles both columns, so a
  // dash shifts one mirror in and the other out — and the pair-sync used to
  // resolve that to the WORSE of the two. Net effect: every kill-dash anywhere
  // walked the pair backward (measured: ~2000 units over a 26-kill wave — the
  // pair could never arrive while the player was doing well). A pair holds
  // formation instead: net shift zero, and no visible jump either — its screen
  // offset simply never changes. An orphaned twin has no mirror and dashes
  // like everyone.
  const twinAlive = {};
  for (const e of r.enemies) {
    if (!e.dead && e.type === 'twin') twinAlive[e.pair] = (twinAlive[e.pair] || 0) + 1;
  }
  for (const e of r.enemies) {
    if (e.dead) continue;
    if (e.type === 'twin' && twinAlive[e.pair] === 2) continue;
    const before = e.dist;
    e.dist += e.side === side ? -m : m;
    if (e.kind === 'proj' && e.dist < 2) e.dist = 2; // a deflected shuriken never "jumps past" the hero
    // A duelist holds his measure: the dash never DRAGS a stanced fencer past
    // his dueling distance. The guard→window timing is tuned for his own
    // approach — a kill-dash that teleported the stance to point-blank played
    // the window at a range where the lunge was effectively unanswerable.
    if (e.fstate && e.side === side && e.dist < holdD) e.dist = Math.min(before, holdD);
    // ...and a cut the other way does not carry the hero out of a duel already
    // joined: the stanced fencer keeps his measure behind the hero's back
    // (2026-10-17). Before, any strike away was a free escape from his window.
    if (e.fstate && e.side !== side) e.dist = before;
    // The same contract for a winding thrower: he planted his feet to throw,
    // and the dash must not slide him closer while he stands — on screen he
    // was a statue moonwalking after the hero. He throws from where he
    // stopped; a dash AWAY still leaves him behind like anything planted.
    if (e.windup !== undefined && !e.thrown && e.side === side) e.dist = before;
  }
  if (r.boss && r.boss.state === 'walk') {
    r.boss.dist = Math.max(DASH_STOP, r.boss.dist + (r.boss.side === side ? -m : m));
  }
  return m;
}

// ---------- Strike ----------
// side: -1 (left) | 1 (right). Returns a UI event:
// idle | stunned | miss | reflect | kill | hit (+ `stasis` when the discharge fires).
function genSeq(s, len) {
  const seq = [];
  for (let i = 0; i < len; i++) seq.push(rnd(s) < 0.5 ? -1 : 1);
  return seq;
}

// The duel's grammar demands. A chain used to ask one question — which side —
// and the stance system simply stood aside for the climax of every act. Some
// links now name a grammar too: the side is still the side, but the blade has
// to be holding the right word when it lands. Not every link, and never two in
// a row — the chain is fast, and a duel of nothing but switching would be a
// typing test. The demand is drawn from what the run actually holds.
const QTE_GRAM_CHANCE = 0.35;
function genGrams(s, r, seq) {
  if (!stancesOn(r)) return null;
  const g = new Array(seq.length).fill(undefined);
  for (let i = 1; i < seq.length; i++) {
    if (g[i - 1] !== undefined) continue; // never back to back
    if (rnd(s) >= QTE_GRAM_CHANCE) continue;
    g[i] = pickUnlockedStance(s, r);
  }
  return g.some(x => x !== undefined) ? g : null;
}

// ---------- Per-type behaviour registry ----------
// A type's rhythm-breaking behaviour lives in ONE place here, instead of smeared
// across an `if (t.fencer)` in tick(), an `if (t.fencer && …)` in strike(), and so
// on. Each entry may define:
//   update(e, ctx)     — the per-frame step run from tick()'s walker loop. Returns
//                        truthy to say "I handled this frame, skip the generic
//                        advance"; falsy to fall through to a normal walk.
//   resolveStrike(ctx) — how a press on THIS enemy resolves. Returns an event object,
//                        or null to fall through to a plain hit.
// Both are dispatched by the enemy's OWN type (an enemy is exactly one type), so
// there is no precedence to get wrong — the old strike() cascade only looked ordered
// because the flags were mutually exclusive. drone/punk/shield have no entry: they
// are the plain walk-and-hit baseline. ctx carries only per-call state — the constants
// and the mutators (hurt, killEnemy, …) are module scope.
const ENEMY_BEHAVIOR = {
  // Fencer: a parry stance before the zone, a short green window, then a lunge.
  fencer: {
    update(e, { s, r, ev, dt, rg, sm }) {
      const t = ENEMY_TYPES.fencer;
      if (!e.fstate && e.dist <= rg * 1.15) {
        e.fstate = 'guard';
        e.ftimer = FENCER_GUARD;
        ev.push({ type: 'stance', side: e.side, dist: e.dist });
      }
      if (e.fstate && e.dist > rg * 1.6) {
        // the hero's dash carried the duel too far — stance dropped, approach again
        e.fstate = null;
        e.ftimer = 0;
      }
      if (!e.fstate) return false; // not yet in stance — walk toward the zone
      e.ftimer -= dt;
      if (e.dist > rg * 0.94) e.dist -= t.speed * sm * dt;
      if (e.fstate === 'guard' && e.ftimer <= 0) {
        e.fstate = 'open';
        e.ftimer = FENCER_OPEN;
        ev.push({ type: 'fencerOpen', side: e.side, dist: e.dist });
      } else if (e.fstate === 'open' && e.ftimer <= 0) {
        if (e.dist <= rg * 1.05) {
          e.dead = true; // lunge: the window was missed at close range
          hurt(s, ev, e);
        } else {
          // the hero moved away — the lunge cuts air, the fencer re-approaches
          e.fstate = null;
          e.ftimer = 0;
          ev.push({ type: 'fencerMiss', side: e.side, dist: e.dist });
        }
      }
      return true; // in a stance — the generic advance does not run
    },
    // a fencer in guard parries — the riposte wounds (the stance is telegraphed, so
    // swinging into it is a read the player already had)
    resolveStrike({ s, r, side, enemy }) {
      if (enemy.fstate !== 'guard') return null;
      r.stun = stunTime(s);
      const dist = enemy.dist;
      const evs = [];
      // no `type` on the source: the fencer lives, and a typed source reads to the UI
      // as an enemy that died reaching the hero
      hurt(s, evs, { side: enemy.side, dist }, 'parry');
      return { type: 'parried', side, dist, events: evs };
    },
  },
  // Mimic: hidden as a drone, then flashes its true nature just before the zone. The
  // flash lasts on BOTH kinds so every one must be READ — a real one that never
  // changed would let the eye skip it. It still walks, so update falls through.
  mimic: {
    update(e, { ev, dt, rg }) {
      if (e.reveal > 0) e.reveal = Math.max(0, e.reveal - dt);
      if (!e.revealed && e.dist <= rg * MIMIC_REVEAL_K) {
        e.revealed = true;
        e.reveal = MIMIC_FLASH;
        ev.push({ type: 'mimicReveal', side: e.side, dist: e.dist, phantom: !!e.phantom });
      }
      return false;
    },
    // a swing at a phantom is a whiff, punished like a miss; a real mimic (no phantom
    // flag) falls through to a normal hit
    resolveStrike({ s, r, side, enemy }) {
      if (!enemy.phantom) return null;
      enemy.dead = true;
      r.stun = stunTime(s);
      r.combo = 0;
      r.misses++;
      return { type: 'phantomWhiff', side, dist: enemy.dist };
    },
  },
  // Thrower: stops at range, winds up, releases a deflectable shuriken.
  thrower: {
    update(e, { s, r, ev, dt, sm }) {
      const t = ENEMY_TYPES.thrower;
      if (e.thrown || e.dist > t.throwDist) return false; // walk in / creep after the throw
      if (e.windup === undefined) {
        e.windup = 0;
        ev.push({ type: 'windup', side: e.side, dist: e.dist });
      }
      e.windup += dt;
      if (e.windup >= THROW_WINDUP * jamWindupMult(s)) { // the Jammer stretches the telegraph
        e.thrown = true;
        r.enemies.push({
          kind: 'proj', id: r.nextId++, owner: e.id, side: e.side,
          dist: Math.max(HIT_DIST + 1, e.dist - 20), projSpeed: t.projSpeed * projSpeedMult(sm) * jamProjMult(s),
        });
        ev.push({ type: 'throw', side: e.side, dist: e.dist });
      }
      return true; // standing and winding — no advance this frame
    },
  },
  // Twins die only to a chord: two presses on opposite sides inside CHORD_WIN. (Their
  // mirrored-formation and window-expiry passes are global, not per-enemy — see tick.)
  twin: {
    resolveStrike({ s, r, side, enemy }) {
      const partner = r.enemies.find(o =>
        !o.dead && o !== enemy && o.type === 'twin' && o.pair === enemy.pair);
      if (!partner) return null; // orphaned twin — fights as a normal enemy
      const tp = r.twinPress;
      if (tp && tp.pair === enemy.pair && tp.side === -side && r.time - tp.at <= CHORD_WIN) {
        return chordKill(s, side, enemy, partner);
      }
      r.twinPress = { pair: enemy.pair, side, at: r.time };
      return { type: 'twinTouch', side, dist: enemy.dist };
    },
  },
};

// Per-Warden signature tricks, mirroring ENEMY_BEHAVIOR: the generic boss code in
// tick and strike dispatches into these hooks, so a Warden's whole trick lives in
// one entry instead of `b.kind === N` branches scattered across both functions.
// Kind 1 (the Street Warden) has no entry — his lesson is the bare QTE chain.
//
//   init(b)        — the spawn literal is kind-agnostic; set the trick's fields here
//   walkUpdate     — each frame of the approach, before the walk advances him
//   qteUpdate      — each frame of the chain, before the shared timer ticks down
//   qteStart(s, b) — the chain just opened (b.seq is built, b.glitch is null)
//   phaseBreak     — a phase was just broken; returns how many minions joined
//
// A hook must consume rnd(s) exactly when the old inline branch did: the stream
// is shared and seeded, and tests and visual baselines rely on its order.
const BOSS_BEHAVIOR = {
  // Maglev Warden — the wind. On approach it hurls him forward in gusts; inside
  // the chain the same wind, after a telegraphed howl, squeezes the timer.
  2: {
    init(b) { b.gustT = 1.3; },
    walkUpdate({ s, b, ev, dt, rg }) {
      if (b.gust > 0) b.gust = Math.max(0, b.gust - dt);
      b.gustT -= dt;
      // Gusts fire only in the readable band: below the fast-forward horizon
      // (farther out the warp would swallow them), and they now reach all the
      // way to the zone — he arrives ahead of the rhythm the other Wardens
      // teach, so the press must come early.
      if (b.gustT <= 0 && b.dist < 560 && b.dist > rg) {
        b.gust = GUST_TIME;
        b.gustT = 1.0 + rnd(s) * 0.9;
        ev.push({ type: 'bossGust', side: b.side, dist: b.dist, at: 'walk' });
      }
    },
    // A gust is always telegraphed by a howl (GUST_TELE) and only then
    // compresses what is left of the timer — the bar visibly lurches. It never
    // cuts below the floor, so a squeezed chain is always still pressable.
    qteUpdate({ s, b, ev, dt }) {
      const left = b.seq.length - b.idx;
      if (b.windup > 0) {
        b.windup -= dt;
        if (b.windup <= 0) {
          b.windup = 0;
          const squeezed = Math.max(left * GUST_MIN_PRESS, b.timer * GUST_SQUEEZE);
          if (squeezed < b.timer) {
            b.timer = squeezed;
            ev.push({ type: 'bossGust', side: b.side, dist: b.dist, at: 'qte' });
          }
        }
      } else {
        b.gustT -= dt;
        // never on the last press, and never when the timer is already tight
        if (b.gustT <= 0 && left > 1 && b.timer > left * GUST_MIN_PRESS * 1.4) {
          b.windup = GUST_TELE;
          b.gustT = 1.4 + rnd(s) * 1.0;
          ev.push({ type: 'bossGustWarn', side: b.side });
        }
      }
    },
  },
  // Admin Oni — some links glitch: shown inverted, press the OPPOSITE side.
  // Never the first (already struck); at least one per chain so the trick reads.
  3: {
    qteStart({ s, b }) {
      b.glitch = b.seq.map((_, i) => i > 0 && rnd(s) < GLITCH_CHANCE);
      if (!b.glitch.some(Boolean)) b.glitch[1 + Math.floor(rnd(s) * (b.seq.length - 1))] = true;
    },
  },
  // Core Shogun — a broken phase summons minions; clear them while he returns.
  4: {
    phaseBreak({ r, b }) {
      const summoned = 1 + b.phase;
      for (let i = 0; i < summoned; i++) {
        const mt = i % 2 ? 'punk' : 'drone';
        r.enemies.push({
          id: r.nextId++, type: mt, side: i % 2 ? -b.side : b.side,
          dist: 460 + i * 85, hits: ENEMY_TYPES[mt].hits, thrown: false,
        });
      }
      return summoned;
    },
  },
  // The Armorer — shurikens on the approach, thrown only from deep field so the
  // whole flight is readable. Every blade is an offer: deflect it back into him
  // and it burns a link out of his next chain. But he learns: each successive
  // throw he is ready to BAT THE RETURN BACK one more time — the first blade
  // he never parries, the second once, the third twice, every later one three
  // times (ARMORER_RALLY_CAP) — a rally that grows over the first exchanges and
  // then holds, each return a shade faster. While his blade
  // is in the air he throws no other: the rally IS the engagement. At the
  // duel's first press he recalls the blades still in the air — the chain
  // stays honest, and no unanswerable shuriken flies while every press
  // belongs to the QTE (a returned blade reaching him mid-chain is never
  // parried either: he is busy, it lands and burns).
  5: {
    init(b) { b.throwT = 1.9; b.burn = 0; b.throws = 0; },
    walkUpdate({ s, r, b, ev, dt, sm }) {
      b.throwT -= dt;
      // one blade in play at a time — a rally in flight postpones the next throw
      if (r.enemies.some(o => !o.dead && o.fromBoss)) return;
      if (b.throwT <= 0 && b.dist > ARMORER_THROW_MIN && b.dist < SPAWN_DIST * 0.95) {
        b.throwT = ARMORER_THROW_T + rnd(s) * ARMORER_THROW_RND;
        const n = b.throws || 0;
        b.throws = n + 1;
        r.enemies.push({
          kind: 'proj', id: r.nextId++, owner: 0, fromBoss: true, side: b.side,
          dist: b.dist, projSpeed: ENEMY_TYPES.thrower.projSpeed * projSpeedMult(sm) * jamProjMult(s),
          parries: Math.min(n, ARMORER_RALLY_CAP), // how many times HE will bat this one's return back
        });
        ev.push({ type: 'bossThrow', side: b.side, dist: b.dist, rally: n });
      }
    },
    qteStart({ r, b }) {
      // the recall: blades still flying fall dead the moment the duel opens
      for (const e of r.enemies) if (e.fromBoss && !e.reflected) e.dead = true;
      if (b.burn) {
        b.seq = b.seq.slice(0, Math.max(ARMORER_BURN_FLOOR, b.seq.length - b.burn));
        b.burn = 0;
      }
    },
  },
  // The Double — two mirrored Wardens approach and one is a broken projection.
  // The flash exposes the hollow one only as the real one CROSSES INTO the
  // zone: the whole approach is held in doubt, and the read is a reaction test
  // at the moment strikes first become possible — the fencer's window taught
  // that shape, the mimics taught the hollow look. A swing at the exposed
  // hollow whiffs like a miss and burns the projection out; before the flash a
  // wrong-side swing is just an ordinary out-of-target miss, never the labeled
  // phantom punishment. The projection itself never deals damage — at contact
  // it dissolves while the real one lands his hit. Every fresh approach rolls
  // the real side anew.
  6: {
    init(b) { b.ph = { alive: true, revealed: false }; },
    walkUpdate({ b, ev, rg }) {
      if (b.ph.alive && !b.ph.revealed && b.dist <= rg) {
        b.ph.revealed = true;
        ev.push({ type: 'bossReveal', side: b.side, dist: b.dist });
      }
    },
    // the mimic's lesson at Warden scale: striking the hollow silhouette in the
    // zone is a miss — stun, wiped combo — and the projection is spent
    walkStrike({ s, r, b, side, rg }) {
      if (b.ph.alive && b.ph.revealed && side === -b.side && b.dist <= rg) {
        b.ph.alive = false;
        r.stun = stunTime(s);
        r.combo = 0;
        r.misses++;
        return { type: 'bossPhantomMiss', side, dist: b.dist };
      }
      return null;
    },
    qteStart({ b }) { b.ph.alive = false; }, // the duel opens — the projection collapses
    retreat({ s, b }) {
      // a new approach: re-roll the real side, re-arm the projection
      b.side = rnd(s) < 0.5 ? -1 : 1;
      b.ph = { alive: true, revealed: false };
    },
  },
};

// Cycle the stance. Like a strike it is a player action, so it goes on the tape
// — a ghost that swung in the wrong grammar would diverge on the first press.
// The tape carries the RESULTING stance, not the direction that reached it —
// a number one player typed on a keypad and another cycled to must replay the
// same way.
function setStance(s, idx) {
  if (s.phase !== 'combat') return { type: 'idle' };
  const r = s.run;
  const next = STANCES[idx];
  if (!next || next === r.stance || r.stanceCd > 0 || !stanceUnlocked(r, idx)) return { type: 'idle' };
  r.stance = next;
  r.stanceCd = STANCE_CD;
  r.sameStance = 0; // the momentum lived in the grammar you just left
  s.meta.stats.stanceSwitches = (s.meta.stats.stanceSwitches || 0) + 1;
  if (r.rec) r.rec.a.push({ t: r.ticks, st: idx });
  return { type: 'stance', stance: next, idx };
}

function cycleStance(s, dir = 1) {
  if (s.phase !== 'combat') return { type: 'idle' };
  const r = s.run;
  let i = STANCES.indexOf(r.stance);
  for (let step = 0; step < STANCES.length; step++) {
    i = ((i + dir) % STANCES.length + STANCES.length) % STANCES.length;
    if (stanceUnlocked(r, i)) return setStance(s, i); // the ring skips what the run has not earned
  }
  return { type: 'idle' };
}

function strike(s, side) {
  if (s.phase !== 'combat') return { type: 'idle' };
  const r = s.run;
  if (r.stun > 0) return { type: 'stunned', side };
  // a stunned press mutated nothing and is not worth a byte of recording
  if (r.rec) r.rec.a.push({ t: r.ticks, s: side });
  r.presses++; // every press that reached the blade — the accuracy denominator
  // side of the previous press (any press) — the adapter's shield "reads" it
  const prevSide = r.lastStrikeSide;
  r.lastStrikeSide = side;
  return strikeCore(s, side, prevSide, true);
}

// The body of a swing. Called twice: from strike() at the press itself, and
// from stepBuffer() when a queued early press converts — the conversion passes
// canBuffer=false (a press may wait once, never re-queue) and the prevSide it
// captured at press time, so the adapter's shield reads the true press order.
// The chord's payout, shared by the twin resolver and the zone-wide double
// tap in resolveCrowd: both twins fall for +2 combo, and the stasis charge
// counts the two connected presses.
function chordKill(s, side, a, b) {
  const r = s.run;
  r.twinPress = null;
  r.lastPress = null; // the gesture is spent — a third tap starts a new one
  s.meta.stats.chords++;
  bumpCombo(r, 2);
  if (stasisEvery(s)) r.stasisHits += 2;
  const dist = a.dist;
  // both die unconditionally — no short-circuit between the two kills
  const healedFirst = killEnemy(s, a);
  const healed = killEnemy(s, b) || healedFirst;
  const res = { type: 'twinKill', side, dist, combo: r.combo };
  if (healed) res.vamp = true;
  return res;
}

// One exit from the chain, three doors into it. Every way a QTE ends short of
// the Warden's death funnels through here: the chain state is torn down the
// same way each time, and the kind's retreat hook fires exactly once, LAST —
// hurt() reads b.side for the wound, and the Double's retreat re-rolls it.
//   'phase'   — a broken phase: he flips sides and re-enters from deep field
//   'wrong'   — the pressed side missed: a fault, a wound, a near retreat
//   'timeout' — the clock ran out: the same fault; the caller words the event
// The differing verdict events (bossStagger, the two shapes of qteFail) stay
// with the callers — they carry caller-local facts (glitch, summons, wording).
// b.gram is cleared on EVERY exit. The old timeout and phase-break paths left
// it dangling through the walk; that was unobservable, and so is clearing it:
// gram is only ever read under state === 'qte' (this file, sim.js, the
// scripted player in game.test.js, drawQte in ui/scene.js — all guarded), and
// every entry into 'qte' rebuilds it via genGrams before the first read.
function abortChain(s, b, reason, ev) {
  const r = s.run;
  b.state = 'walk';
  b.seq = null;
  b.gram = null;
  b.glitch = null;
  b.windup = 0;
  const bb = BOSS_BEHAVIOR[b.kind];
  let summoned = 0;
  if (reason === 'phase') {
    // he re-enters from the other side; the next chain is longer
    b.side = -b.side;
    b.dist = SPAWN_DIST * 0.75;
    if (bb && bb.phaseBreak) summoned = bb.phaseBreak({ r, b });
  } else {
    b.dist = Math.max(b.dist, BOSS_RETREAT);
    r.qteFails++;
    hurt(s, ev, { side: b.side }, 'boss');
  }
  if (bb && bb.retreat) bb.retreat({ s, b });
  return summoned;
}

// ---------- Warden: the QTE shred ----------
// The open chain owns every press outright: while the QTE runs, no swing
// reaches the crowd, the steel, or the buffer — that is why this rule stands
// FIRST in strikeCore's priority. One rung lower and a press that happened to
// match some walker in the zone would strike the crowd instead of advancing
// (or failing) the chain: the duel could be farmed for kills mid-chain or
// broken by rules that were never about it. The chain answers every press, so
// unlike the walk resolver below this one never declines.
function resolveQte(s, b, side, rg) {
  const r = s.run;
  // the link's grammar answers before its side: a correct press in the wrong
  // word rings off the chain — no progress, no fault, and the clock keeps
  // running. The punishment for reading it late is the time it costs.
  if (side === b.seq[b.idx] && b.gram && b.gram[b.idx] !== undefined &&
      STANCES[b.gram[b.idx]] !== r.stance) {
    return { type: 'qteGlance', side, idx: b.idx, gram: b.gram[b.idx], dist: b.dist };
  }
  if (side === b.seq[b.idx]) {
    // a correct press on a lying link is the proof the inversion was understood —
    // the in-frame hint retires once the player has done it TEACH_GLITCH times
    if (b.glitch && b.glitch[b.idx]) s.meta.stats.glitchHits++;
    b.idx++;
    bumpCombo(r);
    // chain presses charge the stasis too — the implant keeps cycling through
    // the duel and comes out of it ready (the discharge itself only fires on a
    // regular hit: during the QTE every press belongs to the chain)
    if (stasisEvery(s)) r.stasisHits++;
    if (b.idx < b.seq.length) {
      // the Warden leaps to the SHOWN side; on a glitch link that is the wrong one
      b.side = qteShown(b, b.idx);
      return { type: 'qteHit', side, idx: b.idx, len: b.seq.length, dist: b.dist,
               nextSide: b.side, nextGlitch: !!(b.glitch && b.glitch[b.idx]),
               nextGram: b.gram ? b.gram[b.idx] : undefined };
    }
    b.phase++;
    if (b.phase >= b.phases) {
      // the Warden is slain
      const dist = b.dist;
      r.boss = null;
      r.bossPending = false;
      r.kills++;
      s.meta.stats.totalKills++;
      s.meta.stats.bossKills++;
      r.score += BOSS_SCORE * r.act;
      r.credits += Math.round(BOSS_CREDITS * r.act * creditMult(s));
      return { type: 'bossDead', side, dist, kind: b.kind };
    }
    // phase broken: the chain comes down and he re-enters for the next one
    const summoned = abortChain(s, b, 'phase');
    return { type: 'bossStagger', side, dist: rg, phasesLeft: b.phases - b.phase, summoned };
  }
  // wrong side: a fault — a wound and a fresh Warden approach
  const evs = [];
  // was the missed link a lying one? the UI corrects the player only then
  const onGlitch = !!(b.glitch && b.glitch[b.idx]);
  abortChain(s, b, 'wrong', evs);
  return { type: 'qteFail', side, reason: 'wrong', glitch: onGlitch, events: evs };
}

// A Warden walking in the zone takes the press before the crowd does — this
// rule is what lets the duel OPEN at all, and that is why it stands between
// the chain and the crowd. One rung lower and any minion sharing the zone
// (the Core Shogun summons them onto the road on purpose) would steal the
// opening strike, and the chain could never start through a crowd. Two rules
// live here in their own order: the kind's walk trick first (the Double's
// hollow projection eats the swing as a miss), then the opening strike that
// turns walk into qte. Declines (null) when the press is not the Warden's to
// take — the crowd resolver answers instead.
function resolveBossWalk(s, b, side, rg) {
  const r = s.run;
  const bbw = BOSS_BEHAVIOR[b.kind];
  if (bbw && bbw.walkStrike) {
    const res = bbw.walkStrike({ s, r, b, side, rg });
    if (res) return res;
  }
  if (b.side === side && b.dist <= rg) {
    // the first strike on the Warden IS the chain's first link: it counts,
    // shows as completed, and the timer covers only the remaining presses
    b.state = 'qte';
    b.seq = genSeq(s, BOSS_QTE_LEN(r.act, b.phase));
    b.seq[0] = side;
    b.gram = genGrams(s, r, b.seq);
    b.glitch = null;
    const bb = BOSS_BEHAVIOR[b.kind];
    if (bb && bb.qteStart) bb.qteStart({ s, r, b });
    b.idx = 1;
    b.side = qteShown(b, 1); // immediately takes the next link's shown side
    // the Decryptor stretches the whole chain's budget; the Maglev squeeze is
    // relative and the per-press floors are absolute, so both still behave
    b.timerMax = b.timer = (b.seq.length - 1) * BOSS_QTE_PRESS(r.act) * qteTimerMult(s);
    // Maglev: the first chain gust never lands on the opening press
    b.windup = 0;
    b.gustT = 0.8 + rnd(s) * 0.7;
    bumpCombo(r);
    if (stasisEvery(s)) r.stasisHits++; // the opening press counts like any chain press
    return { type: 'qteStart', side, idx: 1, len: b.seq.length, dist: b.dist,
             nextSide: b.side, nextGlitch: !!(b.glitch && b.glitch[1]),
             nextGram: b.gram ? b.gram[1] : undefined };
  }
  return null;
}

// Everything a press can mean once no duel claims it: the deflecting arc, the
// miss and the buffer, the zone-wide twin chord, the enemy types'
// own resolvers, the sweep and the dash. LAST in strikeCore's priority by
// definition — the crowd is what a press falls through to when nothing above
// wanted it; any of these rules standing higher would let a walker steal a
// press out of a Warden's duel.
function resolveCrowd(s, side, prevSide, prevPress, canBuffer, rg) {
  const r = s.run;
  // The slash is an arc: it deflects ALL shurikens in the zone on this side
  // and simultaneously hits the nearest enemy if it is in the zone too.
  // A revealed phantom does not stop steel: when a real target stands in the
  // zone behind it, the blade passes through the hologram and lands — the
  // press had a legitimate victim, so the fake must not steal it. The whiff
  // punishment survives only where it teaches: a phantom ALONE in the zone.
  // The bypassed phantom is left walking — it fades at contact, feeding the
  // combo, exactly as if it had been read and ignored.
  const enemy = nearestWalker(r, side, null, o => o.dist <= rg && !o.phantom) ||
                nearestWalker(r, side, null, o => o.dist <= rg);
  const projs = r.enemies.filter(e =>
    !e.dead && e.kind === 'proj' && !e.reflected && e.side === side && e.dist <= rg);
  if (!enemy && !projs.length) {
    // the arc that just cleared this side takes the follow-through with it
    if (r.sweepAt !== undefined && r.sweepSide === side &&
        r.time - r.sweepAt < SWEEP_GRACE) {
      r.sweepAt = undefined;
      return { type: 'ghostMiss', side };
    }
    // The early swing hangs and waits for its target (see PRESS_BUFFER). One
    // slot per side — two, so a hair-early twin chord queues both hands and
    // both land the tick the pair steps in. A repeat on an occupied side is
    // mashing: it flubs at once and takes everything queued down with it.
    if (canBuffer && !(r.buf || []).some(q => q.side === side)) {
      (r.buf = r.buf || []).push({ side, t: PRESS_BUFFER, prev: prevSide });
      return { type: 'buffered', side };
    }
    if (r.buf) r.buf.length = 0;
    return flubMiss(s, side);
  }
  for (const p of projs) {
    p.reflected = true;
    // Intercept: the returned blade is re-aimed at the most dangerous body on
    // its side instead of whoever happened to throw it. Never the Armorer's
    // steel — his returns ARE the duel's burn economy, and stealing them
    // would break a mechanic to feed another.
    if (iceptOn(s) && !p.fromBoss) {
      const mark = iceptPick(r, side, p.dist);
      if (mark) p.icept = mark.id;
    }
    bumpCombo(r);
    if (stasisEvery(s)) r.stasisHits++; // a deflection is a connected press — it charges the stasis
    r.score += 15;
    s.meta.stats.reflects++;
  }
  const finish = res => {
    if (projs.length) res.reflected = projs.length; // deflect and strike with a single press
    // the shuriken principle for the fencer: if an OPEN fencer stands in the zone
    // behind the target, the same slash reaches him — the window isn't lost to
    // the crowd. A chord is both hands swinging at once, so a twinKill's bonus
    // reads either column (two fencers open on both sides at once is a stack
    // rare enough that the first one found takes the single slash).
    if (res.type === 'kill' || res.type === 'hit' || res.type === 'twinKill') {
      for (const o of r.enemies) {
        if (o.dead || o === enemy || o.kind === 'proj' || o.dist > rg) continue;
        if (o.side !== side && res.type !== 'twinKill') continue;
        if (ENEMY_TYPES[o.type].fencer && o.fstate === 'open') {
          res.opened = hitEnemy(s, o, o.side, true);
          break;
        }
      }
    }
    return res;
  };
  if (!enemy) {
    return finish({ type: 'reflect', side, dist: projs[0].dist, combo: r.combo, count: projs.length });
  }

  // The zone-wide double tap: a pair standing in reach answers to L+R inside
  // the chord window NO MATTER what else shares the zone. The nearest-first
  // rule used to hand one hand's press to a drone and the pair never heard
  // the chord — the first press still strikes whatever it strikes, but the
  // second, landing on the other hand in time, belongs to the twins. Only
  // when the nearest target is NOT itself a twin: then the resolver's own
  // touch-and-chord flow already answers, and preempting it would eat the
  // pair out from under a buffered second swing.
  if (!(enemy && enemy.type === 'twin') &&
      prevPress && prevPress.side === -side && r.time - prevPress.at <= CHORD_WIN) {
    const byPair = {};
    for (const o of r.enemies) {
      if (!o.dead && o.type === 'twin' && o.dist <= rg) (byPair[o.pair] = byPair[o.pair] || []).push(o);
    }
    for (const k in byPair) {
      if (byPair[k].length === 2) return finish(chordKill(s, side, byPair[k][0], byPair[k][1]));
    }
  }

  // A press that just deflected steel has already connected: the arc stops at
  // the steel instead of committing into a guarded blade or a hologram. Without
  // this, a shuriken flying past a fencer's closed stance was a trap with no
  // answer — deflect and eat the riposte, or hold and eat the shuriken. The
  // punishing resolutions (parry, whiff) survive only for a press with no
  // legitimate victim.
  if (projs.length && (enemy.fstate === 'guard' || enemy.phantom)) {
    return finish({ type: 'reflect', side, dist: projs[0].dist, combo: r.combo, count: projs.length });
  }
  {
    const b = ENEMY_BEHAVIOR[enemy.type];
    const res = b && b.resolveStrike && b.resolveStrike({ s, r, side, prevSide, enemy });
    if (res) return finish(res);
  }

  const targetDist = enemy.dist; // victim's distance before the hit (a punk swap changes it)
  // The arc's targets are taken BEFORE the first body falls: killing rolls the
  // next one in the column backwards, and a swing resolved one victim at a time
  // would shove the tail of the crowd out of its own reach mid-motion. One
  // swing, one snapshot. Bodies with a rule of their own stay out of it — a
  // chord is not an arc, a parried stance is still a parry, a hologram is not
  // solid.
  const sweepTargets = [];
  if (stancesOn(r) && r.stance === 'sweep') {
    for (const o of r.enemies) {
      if (o.dead || o === enemy || o.kind === 'proj' || o.kind === 'obj') continue;
      if (o.side !== side || o.dist > rg) continue;
      if (o.phantom || o.type === 'twin' || o.fstate === 'guard') continue;
      sweepTargets.push(o);
    }
  }
  const res = hitEnemy(s, enemy, side, false);
  // The wide arc. Everything else of the crowd standing in reach on this side
  // takes the same swing — but the arc pays ONE link of combo for the whole
  // motion (the extras go in quiet), so sweeping is crowd control bought with
  // score. Bodies with a rule of their own are left out of it: a chord is not
  // an arc, a parried stance is still a parry, and a hologram is not solid.
  const extras = [];
  if (res.type !== 'glance') {
    for (const o of sweepTargets) {
      if (o.dead) continue;
      const sub = hitEnemy(s, o, side, false, true);
      if (sub.type !== 'glance') extras.push(sub);
    }
  }
  if (extras.length) {
    res.swept = extras;
    // the arc took more than one: whatever the hand does next on this side, it
    // was aimed at a body that is no longer there (see SWEEP_GRACE)
    r.sweepAt = r.time;
    r.sweepSide = side;
  }
  // dash: a kill moves the hero to the victim, a non-killing hit is a short
  // lunge — the same in every grammar. The arc used to plant the feet, which
  // made one of the three move the world differently from the other two for no
  // reason the hand could feel; the blade travels the same way whatever it is
  // doing at the end of the swing.
  if (res.type === 'kill') {
    const m = applyDash(s, side, Math.max(0, targetDist - DASH_STOP));
    if (m) { res.dash = m; res.dist = targetDist - m; }
  } else if (res.type === 'hit') {
    const m = applyDash(s, side, Math.max(0, Math.min(DASH_HIT, targetDist - DASH_STOP)));
    if (m) res.dash = m;
  }
  return finish(res);
}

// The rulebook's priority, explicit and in one place: an open chain owns the
// press outright; a walking Warden may claim it; whatever neither takes
// belongs to the crowd. The order IS a rule of the game — each resolver's own
// comment says what would break if it stood elsewhere.
function strikeCore(s, side, prevSide, canBuffer) {
  const r = s.run;
  const rg = range(s);
  // every press leaves a timestamp; the zone-wide double tap in resolveCrowd
  // reads the PREVIOUS one, so the pair hears the chord no matter what each hand hit
  const prevPress = r.lastPress;
  r.lastPress = { side, at: r.time };
  const b = r.boss;
  if (b && b.state === 'qte') return resolveQte(s, b, side, rg);
  if (b && b.state === 'walk') {
    const res = resolveBossWalk(s, b, side, rg);
    if (res) return res;
  }
  return resolveCrowd(s, side, prevSide, prevPress, canBuffer, rg);
}

// The punished swing: the stun, the wiped combo, the ledger's miss. Shared by
// the immediate flub in resolveCrowd and a buffered press expiring in stepBuffer.
function flubMiss(s, side) {
  const r = s.run;
  r.stun = stunTime(s);
  r.combo = 0;
  r.misses++;
  // the surge's teach counter: the UI names the rushing crowd while this is
  // low (see TEACH_SURGE), then the words retire for good
  if (r.act >= SURGE_ACT) s.meta.stats.surges = (s.meta.stats.surges || 0) + 1;
  return { type: 'miss', side };
}

// Every press that connects bumps the combo and the best-combo high-water mark.
function bumpCombo(r, n = 1) {
  r.combo += n;
  if (r.combo > r.bestCombo) r.bestCombo = r.combo;
}

// The streak's exchange rate on a kill: every full ten links adds ×0.5,
// capped at ×3.5 (combo 50). Uncapped, one unbroken tail outweighed any
// depth and the meta became restarting for a perfect opening; the cap turns
// the question back into "how far can you go". Combo past 50 keeps its
// milestones, music tiers and the bestCombo record — just not more score.
// One source of truth — killEnemy pays by it and the HUD displays it.
const comboMult = c => Math.min(1 + Math.floor(c / 10) * 0.5, 3.5);

// Nearest living walker in a column, skipping one enemy and an optional extra
// filter — the crowd scans (intercept aim, kill rollback, strike target) all
// share this shape.
function nearestWalker(r, side, skip, extra) {
  /** @type {?} */ let best = null;
  for (const o of r.enemies) {
    if (o.dead || o === skip || o.kind === 'proj' || o.side !== side) continue;
    if (extra && !extra(o)) continue;
    if (!best || o.dist < best.dist) best = o;
  }
  return best;
}

// Intercept's aim: the most dangerous body on the side, past the blade's own
// position (the return flies outward and cannot bite behind itself). The
// priority is the retired Arc Discharge's brain, kept because it was right:
// a thrower mid-windup (the shuriken never flies), then a fencer (the stance
// never starts), then the plain nearest. Eligibility mirrors ownerless steel:
// a guarded stance and twins are off-limits, a hologram is not solid.
function iceptPick(r, side, minD) {
  const ok = o => o.dist > minD && o.fstate !== 'guard' && !ENEMY_TYPES[o.type].twin && !o.phantom;
  return nearestWalker(r, side, null, o => ok(o) && !o.thrown && o.windup !== undefined) ||
         nearestWalker(r, side, null, o => ok(o) && ENEMY_TYPES[o.type].fencer) ||
         nearestWalker(r, side, null, ok);
}

function hitEnemy(s, e, side, isChain, quiet) {
  const r = s.run;
  // The stance gate. A body the current grammar cannot hurt still FEELS the
  // press — it is shoved back, the streak survives — but nothing else happens:
  // the wrong stance costs tempo and ground, never the run. Automatic effects
  // (intercepted steel, ownerless steel, the fencer bonus) pass through it:
  // they are not presses and must not surprise.
  // Blade Momentum: loyalty to one grammar charges the hand, and the charged
  // press bites anything — the reward for NOT switching, against a road that
  // keeps asking you to.
  const momEvery = MOMENTUM_EVERY[metaLvl(s, 'mmomentum')] || 0;
  const surge = !isChain && momEvery > 0 && stancesOn(r) && (r.sameStance + 1) % momEvery === 0;
  if (!isChain && !surge && stancesOn(r) && !bodyBites(e, r.stance)) {
    e.dist = Math.min(SPAWN_DIST, e.dist + PUSHBACK);
    // Riposte: the wrong grammar stops being a lost beat and becomes a tool —
    // the body it skidded off stands frozen while you deal with the other side.
    const hold = RIPOSTE_HOLD[metaLvl(s, 'mriposte')] || 0;
    if (hold > 0) e.hold = hold;
    return { type: 'glance', side, enemy: e.type, dist: e.dist, stance: r.stance, held: hold > 0 };
  }
  if (!isChain && stancesOn(r)) r.sameStance++;
  if (!quiet) {
    bumpCombo(r);
    if (stasisEvery(s)) r.stasisHits++;
  }
  // Stasis Discharge: the armed press freezes every OTHER walker on the
  // struck SIDE — the strike's own victim already answered the press, the
  // rest of the column stands still while the hand works the other one. Only
  // a real press discharges (never the sweep's quiet extras, never automatic
  // steel), so the freeze lands exactly where the player aimed the charge.
  // Steel never freezes: a shuriken in flight stays answerable by the same
  // rules as always. And the freeze must never BAIT the hand: a body already
  // on approach — one whose walk would carry it into the zone before the
  // hold expires — keeps marching, or the press committed to its arrival
  // would whiff into a street the implant itself emptied and pay the combo
  // for it. The freeze takes the column BEHIND the beat: bodies in the zone
  // (already under the blade) and everything too deep to arrive during the
  // hold. Targets are taken HERE, before the blow resolves; the holds go on
  // after it, so the freeze pins bodies where the swing left them. A held
  // twin holds its mirror through the pair-sync, a held fencer's stance
  // clock stops with him.
  const se = stasisEvery(s);
  let stasisTargets = null;
  if (se && !isChain && !quiet && r.stasisHits > 0 && r.stasisHits % se === 0) {
    const rgS = range(s);
    const holdS = stasisHold(s);
    const smS = speedMult(r) * cryoMult(s) * mutSpeed(r);
    stasisTargets = r.enemies.filter(o =>
      !o.dead && o !== e && o.kind !== 'proj' && o.side === side &&
      (o.dist <= rgS ||
       o.dist > rgS + ENEMY_TYPES[o.type].speed * (o.thrown ? 0.6 : 1) * smS * holdS));
  }
  // the heavy thrust lands twice over; every other grammar cuts once
  const dmg = (!isChain && stancesOn(r) && r.stance === 'pierce' ? PIERCE_DMG : 1) + (surge ? 1 : 0);
  e.hits -= dmg;
  let res;
  if (e.hits <= 0) {
    if (e.seal !== undefined) s.meta.stats.sealKills = (s.meta.stats.sealKills || 0) + 1;
    if (ENEMY_TYPES[e.type].fencer && e.fstate === 'open') s.meta.stats.fencerKills++;
    const healed = killEnemy(s, e);
    res = { type: 'kill', side, enemy: e.type, dist: e.dist, combo: r.combo, chain: isChain, surge };
    if (healed) res.vamp = true;
  } else {
    if (ENEMY_TYPES[e.type].swap && !isChain) {
      // an automatic hit never swaps punks — auto-effects must not surprise
      e.side = -e.side;
      e.dist = range(s) + KNOCK_EDGE_PAD + rnd(s) * KNOCK_SPREAD;
      // ...but the returning punk must not cut in front of a walking twin: the
      // follow-gap would shove the twin back and the mirror-sync would tax the
      // whole pair. If the landing spot sits just ahead of a twin, the punk
      // takes the slot BEHIND the pair instead.
      for (const o of r.enemies) {
        if (o.dead || o.type !== 'twin' || o.side !== e.side) continue;
        if (o.dist >= e.dist - 1 && o.dist < e.dist + FOLLOW_GAP) e.dist = o.dist + FOLLOW_GAP;
      }
    } else {
      const push = !isChain && stancesOn(r) && r.stance === 'pierce' ? PIERCE_PUSH : PUSHBACK;
      e.dist = Math.min(SPAWN_DIST, e.dist + push);
    }
    res = { type: 'hit', side, enemy: e.type, dist: e.dist, combo: r.combo, chain: isChain, surge };
  }
  if (stasisTargets && stasisTargets.length) {
    const hold = stasisHold(s);
    let held = 0;
    for (const o of stasisTargets) {
      if (o.dead) continue;
      o.hold = Math.max(o.hold || 0, hold);
      held++;
    }
    if (held) res.stasis = { count: held, hold };
  }
  return res;
}

// Returns true if the nanovampirism repair fired (for UI effects).
function killEnemy(s, e) {
  const r = s.run;
  e.dead = true;
  r.kills++;
  r.waveKills++;
  s.meta.stats.totalKills++;
  const t = ENEMY_TYPES[e.type];
  r.score += Math.round(t.score * comboMult(r.combo));
  // a mutated wave pays extra — the risk is rewarded
  r.credits += Math.round(t.credits * creditMult(s) * mutCredit(r));
  // wave rollback: a kill pushes the nearest living enemy in that column back —
  // fast hands genuinely push the crowd back instead of just surviving it.
  // Twins are exempt like stanced fencers: the slowest walkers in the roster
  // were the likeliest "nearest", and the mirror-sync taxed the whole pair for
  // one column's rollback — the pair is a lesson to answer, not queue filler.
  const follower = nearestWalker(r, e.side, e);
  if (follower && !follower.fstate && follower.type !== 'twin' &&
      !(follower.windup !== undefined && !follower.thrown)) {
    // ...and never a thrower mid-windup: he planted his feet to throw, and
    // every force that slid the statue — dash or rollback — read as jank
    follower.dist = Math.min(SPAWN_DIST, follower.dist + KILL_PUSH);
  }
  // nanovampirism: one repair per wave, earned by killing half its enemies;
  // with full armor at the threshold, the repair waits for the first wound taken
  if (r.implants.vamp && !r.vampUsed && r.waveKills >= Math.ceil((r.waveTotal || waveSize(r)) / 2) && r.hp < maxHp(s)) {
    r.vampUsed = true;
    r.hp++;
    return true;
  }
  return false;
}

// Minimum time (sec) until the nearest threat enters the strike zone.
// The UI fast-forwards the world while this is large: the approach of a wave's
// first enemies and the Warden compresses equally — slow boss or fast drone, the
// final stretch at normal speed lasts the same ~1.5 seconds.
// During the QTE the Warden is point-blank — no fast-forward.
function threatEta(s) {
  const r = s.run;
  if (!r || s.phase !== 'combat') return Infinity;
  const sm = speedMult(r) * cryoMult(s) * mutSpeed(r) * surgeMult(r);
  const rg = range(s);
  let eta = Infinity;
  for (const e of r.enemies) {
    if (e.dead) continue;
    let v;
    if (e.kind === 'proj') {
      if (e.reflected) continue;
      v = e.projSpeed;
    } else {
      v = ENEMY_TYPES[e.type].speed * sm;
      // active road weather is a real speed-up — the warp must not mask it
      if (r.road && !r.road.warn && r.road.t > 0 && e.dist > rg) {
        if (r.road.kind === 'wind') v *= WIND_MULT;
        else if (r.road.kind === 'roll' && e.side === r.road.dir) v += ROLL_DIST / ROLL_TIME;
      }
    }
    const d = e.dist - rg;
    if (d <= 0) return 0;
    eta = Math.min(eta, d / v);
  }
  if (r.boss) {
    if (r.boss.state === 'qte') return 0;
    const d = r.boss.dist - rg;
    if (d <= 0) return 0;
    // an active Maglev gust is a real speed-up — the warp must not mask it
    eta = Math.min(eta, d / (BOSS_SPEED * sm * (r.boss.gust > 0 ? GUST_MULT : 1)));
  }
  return eta;
}

// ---------- Death report ----------
// The death screen stops being an obituary and becomes a debrief: what killed
// the run, where the wounds came from, how clean the hands were — and ONE
// piece of advice, picked from what actually went wrong. Rule order: a
// dominant wound cause (two or more from one source) speaks first, then a
// dirty accuracy, then the fundamentals.
const REPORT_TIPS = [
  { id: 'proj',
    text: 'Сюрикен отбивается тем же ударом в зоне — а отбитый летит обратно и убивает. Клинок в воздухе всегда важнее пехоты: он быстрее.',
    en: { text: 'A shuriken is deflected by the same in-zone strike — and the reflected one flies back and kills. Steel in the air always outranks infantry: it is faster.' } },
  { id: 'window',
    text: 'Фехтовальщик в стойке парирует — рипост ранит. Жди зелёного окна: оно объявляется заранее и его хватает на спокойный удар.',
    en: { text: 'A fencer in stance parries — the riposte wounds. Wait for the green window: it is announced ahead and leaves time for a calm strike.' } },
  { id: 'boss',
    text: 'Страж наказывает за ритм, не за скорость: бей туда, где он стоит, и не гонись за таймером. Дешифратор растягивает цепь, если её вечно не хватает.',
    en: { text: 'The Warden punishes rhythm, not speed: strike where he stands and stop racing the timer. The Decryptor stretches the chain if it always runs short.' } },
  { id: 'twin',
    text: 'Близнецы умирают только от аккорда — обе кнопки одним движением. Одиночное нажатие по паре засчитывается промахом.',
    en: { text: 'Twins die only to the chord — both buttons in one motion. A lone press on the pair resolves as a miss.' } },
  { id: 'mimic',
    text: 'Мимик выдаёт себя вспышкой у зоны: плотный — бей, полый — держи руку. Смотри на силуэт, а не на счётчик комбо.',
    en: { text: 'The mimic betrays itself with a flash near the zone: solid — strike, hollow — hold. Watch the silhouette, not the combo counter.' } },
  { id: 'miss',
    text: 'Каждый второй враг добежал под твой стан: бей только в зоне — метки на земле. Промах отдаёт толпе и время, и дистанцию.',
    en: { text: 'Half those wounds walked in under your stun: strike only inside the zone — the ground markers show it. A miss hands the crowd both time and ground.' } },
  { id: 'crowd',
    text: 'Толпа берёт темпом: держи чередование сторон и снимай ближайшего сразу, как он вошёл в зону. Батарея щита и конденсатор прощают по одной ошибке.',
    en: { text: 'The crowd wins on tempo: keep alternating sides and take the nearest the moment it crosses in. The battery and the capacitor each forgive one mistake.' } },
];
const TIP_BY_CAUSE = { proj: 'proj', fencer: 'window', parry: 'window', boss: 'boss', twin: 'twin', mimic: 'mimic' };

// A wound cause's display name (report rows speak the enemy's own language).
function causeName(cause) {
  if (ENEMY_TYPES[cause]) return T(ENEMY_TYPES[cause], 'name');
  if (cause === 'proj') return L('Сюрикен', 'Shuriken');
  if (cause === 'parry') return L('Рипост фехтовальщика', 'Fencer riposte');
  return L('Страж', 'Warden');
}

function deathReport(s) {
  const r = s.run;
  if (!r) return null;
  const counts = {};
  for (const w of r.wounds) counts[w.cause] = (counts[w.cause] || 0) + 1;
  // the fencer and his riposte are one lesson — dominance counts them together
  const lessonKey = c => (c === 'parry' ? 'fencer' : c);
  const lessons = {};
  for (const c in counts) lessons[lessonKey(c)] = (lessons[lessonKey(c)] || 0) + counts[c];
  const top = Object.keys(lessons).sort((a, b) => lessons[b] - lessons[a])[0];
  let tipId = 'crowd';
  if (top && lessons[top] >= 2 && TIP_BY_CAUSE[top]) tipId = TIP_BY_CAUSE[top];
  else if (r.presses >= 12 && r.misses / r.presses > 0.15) tipId = 'miss';
  else if (r.qteFails >= 2) tipId = 'boss';
  return {
    killer: r.wounds[r.wounds.length - 1] || null, // the wound that ended it
    counts,
    presses: r.presses, misses: r.misses,
    accuracy: r.presses ? (r.presses - r.misses) / r.presses : 1,
    qteFails: r.qteFails,
    tip: REPORT_TIPS.find(t => t.id === tipId),
  };
}

// ---------- Replay ----------
// A recording rebuilds its run from nothing: a fresh state, the author's
// upgrades snapshot, the original seed, and the same mode. The replay state
// records nothing itself — history does not re-record history.
function replayState(rec) {
  const s = createState(1);
  if (rec.upgrades) {
    for (const m of META) {
      const v = rec.upgrades[m.id];
      if (typeof v === 'number') s.meta.upgrades[m.id] = Math.min(m.cap, Math.max(0, v | 0));
    }
  }
  s.rngState = rec.seed | 0;
  setWay(s, rec.hard ? 'stance' : 'plain'); // a ghost replays under the rules it was played by
  startRun(s, rec.mode === 'campaign' ? undefined : rec.mode);
  s.run.rec = null;
  return s;
}

// Feed the actions due RIGHT NOW into the replay state: strikes pinned to the
// current tick, and — while the choice screen holds — the recorded picks and
// rerolls. Each strike's RESULT goes to `onStrike` — the viewer feeds it to
// the same effect handler as a live press, so the ghost slashes, kills and
// whiffs with full animation and sound. Returns the new action cursor. Shared
// by the headless executor below (no callback) and the UI's replay viewer.
function replayFeed(s, rec, cursor, onStrike) {
  const a = rec.a;
  let i = cursor;
  for (;;) {
    const act = a[i];
    if (!act) break;
    if (s.phase === 'choice') {
      if (act.c !== undefined) { i++; chooseImplant(s, act.c); continue; }
      if (act.rr) { i++; rerollOffers(s); continue; }
      break; // the next action is a strike — it waits for combat
    }
    if (s.phase === 'combat' && act.st !== undefined && act.t === s.run.ticks) {
      i++;
      s.run.stanceCd = 0; // the tape's timing is the truth — never gate a recorded switch
      setStance(s, act.st);
      continue;
    }
    if (s.phase === 'combat' && act.s !== undefined && act.t === s.run.ticks) {
      i++;
      const res = strike(s, act.s);
      if (onStrike) onStrike(res);
      continue;
    }
    break;
  }
  return i;
}

// Wire form of a recording: actions collapse into terse arrays — a strike is
// [tick, side], a pick is ['c', idx], a reroll is ['r']. Cuts the payload
// roughly in half against the in-memory objects; the worker stores the packed
// JSON opaquely and the viewer unpacks it back.
function packRec(rec) {
  return {
    v: rec.v, seed: rec.seed, mode: rec.mode, upgrades: rec.upgrades,
    T: rec.T, end: rec.end,
    // the way is part of the rules: without it a stance tape downloaded from
    // the board replayed as plain and silently diverged from its own score.
    // Only stamped when set — older plain tapes carry no field and stay valid.
    ...(rec.hard ? { hard: 1 } : {}),
    a: rec.a.map(x =>
      x.s !== undefined ? [x.t, x.s] : x.c !== undefined ? ['c', x.c]
      : x.st !== undefined ? ['s', x.t, x.st] : ['r']),
  };
}
function unpackRec(p) {
  if (!p || !Array.isArray(p.a)) return null;
  return {
    // tapes stamped before the three-part version carried the integer epoch 1;
    // the sim did not change at the rebase, so they map onto '1.0' and live on
    v: p.v === 1 ? '1.0' : p.v,
    seed: p.seed, mode: p.mode, upgrades: p.upgrades || {},
    T: p.T, end: p.end, hard: p.hard ? 1 : 0,
    // choice actions carry no tick — replayFeed applies them whenever the
    // choice screen holds, exactly as it does for the in-memory form
    a: p.a.map(x =>
      x[0] === 'c' ? { t: 0, c: x[1] } : x[0] === 'r' ? { t: 0, rr: 1 }
      : x[0] === 's' ? { t: x[1], st: x[2] } : { t: x[0], s: x[1] }),
  };
}

// Headless executor: replay the whole recording and return the final state —
// the determinism test compares it bit for bit against the original run.
function runReplay(rec) {
  if (!rec || rec.v !== REPLAY_EPOCH) return null;
  const s = replayState(rec);
  let i = 0;
  const cap = (rec.T || 0) + 3600; // runaway guard: a minute past the seal
  while ((s.phase === 'combat' || s.phase === 'choice') && s.run.ticks <= cap) {
    i = replayFeed(s, rec, i);
    if (s.phase === 'choice') break; // recording ended on an unanswered choice (quit)
    if (rec.T !== undefined && s.run.ticks >= rec.T) break; // the seal: a quit run ends mid-air
    tick(s, STEP);
  }
  return s;
}

// ---------- End of run ----------
// Total wave number of an endless run — the record metric.
function endlessWave(r) { return (r.act - 1) * WAVES_PER_ACT + r.wave; }

function endRun(s, victory) {
  const r = s.run;
  const st = s.meta.stats;
  // a tainted run (the skip code was used) leaves no trace in the meta
  if (!r.cheated) {
    s.meta.credits += r.credits;
    st.bestScore = Math.max(st.bestScore, r.score);
    st.bestCombo = Math.max(st.bestCombo, r.bestCombo);
    if (r.endless) st.bestEndless = Math.max(st.bestEndless || 0, endlessWave(r));
    else st.bestAct = Math.max(st.bestAct, victory ? ACTS.length + 1 : r.act);
    if (victory) st.wins++;
    recordDaily(s, r, victory);
    recordMonthly(s, r);
  }
  // seal the recording: the replay knows where the run truly ended
  if (r.rec) { r.rec.T = r.ticks; r.rec.end = victory ? 'victory' : 'dead'; }
  s.phase = victory ? 'victory' : 'dead';
}

// Wipe every trace of progress: credits, meta upgrades, achievements and stats,
// plus any run in flight. Irreversible — the UI must confirm before calling this.
// The RNG seed carries over; language lives outside the state and is a
// preference, not progress, so it survives too.
function resetProgress(s) {
  const fresh = createState(s.rngState);
  s.meta = fresh.meta;
  s.run = null;
  s.phase = 'menu';
}

// Quitting to menu mid-run: credits are kept.
function abandonRun(s) {
  if (s.run && !s.run.cheated && (s.phase === 'combat' || s.phase === 'choice')) {
    s.meta.credits += s.run.credits;
    if (s.run.endless) s.meta.stats.bestEndless = Math.max(s.meta.stats.bestEndless || 0, endlessWave(s.run));
    else s.meta.stats.bestAct = Math.max(s.meta.stats.bestAct, s.run.act);
    // walking out on the daily still offers the door-side score to the ledger —
    // it lands only if it beats the day's standing best
    recordDaily(s, s.run, false);
    recordMonthly(s, s.run);
    if (s.run.rec) { s.run.rec.T = s.run.ticks; s.run.rec.end = 'quit'; }
  }
  s.run = null;
  s.phase = 'menu';
}

// ---------- Meta shop ----------
function metaCost(s, m) { return Math.round(m.baseCost * Math.pow(m.growth, metaLvl(s, m.id))); }

function buyMeta(s, id) {
  const m = META.find(x => x.id === id);
  if (!m || metaLvl(s, id) >= m.cap) return false;
  const cost = metaCost(s, m);
  if (s.meta.credits < cost) return false;
  s.meta.credits -= cost;
  s.meta.upgrades[id] = metaLvl(s, id) + 1;
  return true;
}

// ---------- Formatting ----------
// Thousands separated by spaces: 12 345 678. Independent of environment locale.
function fmt(n) {
  const str = String(Math.floor(Math.abs(n)));
  const sign = n < 0 ? '-' : '';
  return sign + str.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const Game = {
  // constants and data
  STEP, VERSION, VERSION_MAJOR, VERSION_REPLAY, VERSION_COSMETIC, REPLAY_EPOCH,
  replayState, replayFeed, runReplay, packRec, unpackRec,
  BASE_RANGE, HIT_DIST, SPAWN_DIST, BASE_STUN, BASE_HP, WAVES_PER_ACT,
  STASIS_EVERY1, STASIS_EVERY2, STASIS_HOLD1, STASIS_HOLD2, KNOCK_EDGE_PAD, KNOCK_SPREAD, MERCY_DIST, FOLLOW_GAP, sideArrGap,
  GUARD_REPEL, HACK_TIMER, JAM_WINDUP, JAM_PROJ,
  anyArrGap, KILL_PUSH, DASH_STOP, DASH_HIT, applyDash,
  THROW_WINDUP, projSpeedMult, FENCER_GUARD, FENCER_OPEN, CHORD_WIN,
  TEACH_CHORDS, TEACH_GLITCH, TEACH_MIMIC, TEACH_STANCE, TEACH_FENCER, TEACH_THROW, actDebuts, DEBUT_LEAD, DEBUT_ROOM, ELITE, ELITE_RUN, THROW_SPACE, COMBO_ACT,
  setWay, wayHard, dailySlot, monthlySlot, RIPOSTE_HOLD, MOMENTUM_EVERY,
  STANCES, STANCE_CD, STANCE_ACT, PIERCE_ACT, STANCE_ARMOR, stanceBites, bodyBites, stancesOn, stanceUnlocked, stanceFor,
  SEAL_ACT, SEAL_CHANCE, SEAL_PER_WAVE,
  PIERCE_DMG, cycleStance, setStance, MIMIC_FLASH, MIMIC_REVEAL_K,
  BOSS_SPEED, BOSS_RETREAT, BOSS_QTE_LEN, BOSS_QTE_PRESS, BOSS_PHASES, BOSS_CREDITS, BOSS_SCORE,
  bossKind, qteShown, genGrams, QTE_GRAM_CHANCE, GUST_MULT, GUST_TIME, GLITCH_CHANCE,
  BOSS_KINDS, ARMORER_THROW_MIN, ARMORER_BURN_FLOOR, ARMORER_BURN_CAP,
  GUST_FLOOR, GUST_TELE, GUST_SQUEEZE, GUST_MIN_PRESS, GUST_ZONE_K,
  MUTATORS, MUTATOR_CHANCE, MUT_CREDIT, MUT_PAIR_CREDIT, MUT_PAIR_WAVE, FOG_DIST, RAIN_EVERY, BLITZ_SPEED, SQUALL_SIZE, mutSpeed, mutHas, mutCredit,
  ROAD_RULES, roadRule, roadVeil, ROAD_WARN, ROAD_NEAR,
  WIND_TIME, WIND_MULT, ROLL_TIME, ROLL_DIST, GLITCH_TIME, GLITCH_DIST,
  MISS_SURGE, SURGE_ACT, TEACH_SURGE, surgeMult,
  endlessWave,
  dailySeed, startDaily, startMonthly,
  deathReport, causeName, REPORT_TIPS,
  ACTS, ENEMY_TYPES, ACT_WEIGHTS, DEEP_WEIGHTS, DEEP_DRIFT_ACTS, waveWeights,
  SPEED_KNEE, PAIR_CAP, pairChance, sealChance, sealPerWave,
  IMPLANTS, META, ACHIEVEMENTS, checkAchievements,
  LOG, checkLog, BOSS_VOICE_AFTER,
  // state
  setLang, getLang, registerLang, L, T, F,
  createState, normalizeState, startRun, abandonRun, resetProgress,
  // derived
  range, cryoMult, stunTime, maxHp, creditMult, comboMult, stasisEvery, stasisHold, iceptOn, qteTimerMult, jamWindupMult, jamProjMult,
  implantCount, metaLvl, speedMult, waveSize, spawnGap,
  // combat
  tick, strike, buildWave, chooseImplant, rollOffers, rerollOffers, threatEta, skipWave, taintRun,
  // meta
  metaCost, buyMeta,
  BLADES, bladeById, buyBlade, setBlade,
  fmt, rnd,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Game;
else globalThis.Game = Game;

})();
