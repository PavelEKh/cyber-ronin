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

window.addEventListener('beforeunload', saveState);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

// Roman act numerals for the HUD and banners.
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const romanAct = n => ROMAN[n - 1] || String(n);
