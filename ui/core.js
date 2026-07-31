'use strict';
// State and persistence. All game math lives in game.js (covered by tests),
// here is only UI plumbing: loading/saving meta to localStorage.

const $ = id => document.getElementById(id);

// ============ Language ============
// Saved choice → system language: any code we ship a pack for, else English.
const LANG_KEY = 'cyber-ronin-lang';
const initialLang = localStorage.getItem(LANG_KEY)
  || (() => {
    const nav = (navigator.language || 'en').toLowerCase().slice(0, 2);
    return ['ru', 'en', 'es', 'de', 'fr', 'ja'].includes(nav) ? nav : 'en';
  })();
Game.setLang(initialLang);

function saveLang(l) {
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* no save */ }
}

const SAVE_KEY = 'cyber-ronin-save';

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return Game.normalizeState(JSON.parse(raw));
  } catch (e) { /* corrupted save — start from a clean slate */ }
  return Game.createState((Date.now() & 0x7fffffff) || 1);
}

let state = loadState();

// While a replay plays, `state` points at the RECONSTRUCTED run — writing that
// to localStorage would clobber the real save with a ghost's meta. main.js
// raises the flag for the duration of the viewer.
let replayActive = false;

// We save only meta: a run lives within the session.
function saveState() {
  if (replayActive) return; // a ghost's meta must never touch the disk
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ rngState: state.rngState, meta: state.meta }));
  } catch (e) { /* private mode — play without saving */ }
}

// Progress reset: drop the stored save outright rather than overwrite it, so a
// reset followed by a crash cannot leave a half-wiped save behind.
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
}

// ============ Device settings ============
// Volume and graphics live OUTSIDE the save: wiping progress must not blow up
// the speakers, and these describe the machine and the room, not the series.
const SET_KEY = 'cyber-ronin-settings';

const settings = (() => {
  const s = { musicVol: 1, sfxVol: 1, gfx: 'auto' };
  try { Object.assign(s, JSON.parse(localStorage.getItem(SET_KEY)) || {}); }
  catch (e) { /* corrupted — defaults stand */ }
  const vol = v => Math.min(1, Math.max(0, +v || 0));
  s.musicVol = vol(s.musicVol);
  s.sfxVol = vol(s.sfxVol);
  if (!['auto', 'high', 'medium', 'low'].includes(s.gfx)) s.gfx = 'auto';
  return s;
})();

function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
}

window.addEventListener('beforeunload', saveState);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

// Roman act numerals for the HUD and banners.
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const romanAct = n => ROMAN[n - 1] || String(n);
