'use strict';
// Yandex Games — the third coat on the same single file (after Electron for
// Steam and Capacitor for Android). Only the yandex build (bundle.sh yandex
// stamps window.CR_YANDEX and adds the /sdk.js tag) runs anything here; every
// other build gets inert stubs, exactly like debug.js in a release.
//
// What the platform requires and where it lands:
//  - LoadingAPI.ready() once the menu is playable        → Yandex.ready(), main.js splash
//  - GameplayAPI.start()/stop() around real combat        → Yandex.gameplay(on), main.js loop
//  - sound stops and the fight pauses when focus is lost  → visibilitychange / blur below
//  - the platform's own pause/resume (overlays, ads)      → game_api_pause / game_api_resume
//  - interface language from the SDK, unless the player chose one here → init
//  - a fullscreen ad between runs, the sound held under it            → Yandex.interstitial(go), main.js afterRun
//  - the save mirrored in the player's cloud data                     → setSaveSink (core.js), pull at start
//  - the leaderboards are Yandex's own (our worker is never called here) → Board.setBackend below
// Everything is fire-and-forget: a missing SDK (a local smoke run of the yandex
// build) logs once and the game plays on as a plain page.

const Yandex = (() => {
  if (typeof window === 'undefined' || !window.CR_YANDEX) {
    return { ready: () => {}, gameplay: () => {}, interstitial: go => go() };
  }

  let ysdk = null;
  let playing = false;   // the last state told to GameplayAPI — dedupes the per-frame sync
  let readySent = false; // LoadingAPI.ready() is a one-shot
  let readyWanted = false;

  const sdkReady = (typeof YaGames !== 'undefined' ? YaGames.init() : Promise.reject(new Error('sdk missing')))
    .then(sdk => {
      ysdk = sdk;
      pickLanguage(sdk);
      adoptPlayer(sdk);
      // the platform's own pause: an overlay or an ad on top of the frame.
      // Resume hands the audio back but keeps the fight on its pause screen —
      // the player, not the overlay, decides when the steel moves again.
      try {
        sdk.on('game_api_pause', () => holdWorld());
        sdk.on('game_api_resume', () => Sound.suspend(false));
      } catch (e) { /* older SDK without the events */ }
      if (readyWanted) sendReady();
      return sdk;
    })
    .catch(e => { console.warn('[yandex] SDK unavailable:', e && e.message); return null; });

  // SDK language wins only over the browser guess: a choice saved in the
  // settings stays. ISO 639-1 codes, same as our pack roster.
  function pickLanguage(sdk) {
    try {
      if (localStorage.getItem(LANG_KEY)) return;
    } catch (e) { return; }
    const lang = sdk.environment && sdk.environment.i18n && sdk.environment.i18n.lang;
    if (!lang || lang === Game.getLang() || !LANGS.some(l => l.code === lang)) return;
    Game.setLang(lang);
    applyLang();
    if (activeScreen) showScreen(activeScreen);
  }

  // The player: the cloud save is for everyone; the boards need a signed-in one
  // (setScore refuses a guest). scopes: false — no consent dialog at startup.
  let authed = false, myUid = '';
  function adoptPlayer(sdk) {
    if (typeof sdk.getPlayer !== 'function') return Promise.resolve();
    return sdk.getPlayer({ scopes: false }).then(p => {
      if (!p) return;
      if (!player) pullSave(p); // the cloud save is for every player, signed in or not
      else player = p;
      authed = !!(p.isAuthorized && p.isAuthorized());
      myUid = authed ? String(p.getUniqueID() || '') : '';
    }).catch(e => console.warn('[yandex] player unavailable:', e && e.message));
  }

  // ---------- The leaderboards ----------
  // Yandex's native boards replace our worker in this build. One board per kind
  // and way, created by hand in the console with exactly these technical names:
  //   daily, monthly, campaign, endless — and the same with a «Stance» suffix
  //   for the Way of Three Stances (dailyStance, …).
  // The daily and monthly boards are ONE board each across all days/months:
  // a player's best seed run ever. The number on the board is what our worker
  // ranks by — the score, or for endless/monthly the total waves reached — and
  // the rest of the row (score, act, wave, clear) rides in extraData.
  // A board is only ever raised, never lowered: the player's own entry is read
  // first and a weaker run is not sent. Limits (SDK docs): setScore 1/s,
  // getEntries 20 per 5 min — hence the spacing and a short cache.
  const isWaves = kind => kind === 'endless' || kind === 'monthly';
  function lbName(key) {
    const stance = key.startsWith('s:');
    const k = stance ? key.slice(2) : key;
    const kind = /^\d{4}-\d{2}-\d{2}$/.test(k) ? 'daily' : /^\d{4}-\d{2}$/.test(k) ? 'monthly' : k;
    return { name: kind + (stance ? 'Stance' : ''), kind };
  }
  const metricOf = (kind, e) => (isWaves(kind) ? (e.act - 1) * Game.WAVES_PER_ACT + e.wave : e.score);
  const parseExtra = x => { try { return JSON.parse(x || '{}') || {}; } catch (e) { return {}; } };
  const lb = () => sdkReady.then(sdk => {
    if (!sdk || !sdk.leaderboards) throw new Error('no leaderboards');
    return sdk.leaderboards;
  });

  let setChain = Promise.resolve(), lastSet = 0;
  const cache = new Map(); // board name → { ts, data } — or { ts, pending } while the read is in flight
  const CACHE_TTL = 60000;

  function submit(key, entry) {
    if (!authed) return Promise.resolve(); // a guest's run stays off the board; the login line says why
    const { name, kind } = lbName(key);
    const metric = metricOf(kind, entry);
    const extra = JSON.stringify({ s: entry.score, a: entry.act, w: entry.wave, v: entry.victory ? 1 : 0 });
    return lb().then(async api => {
      let old = null;
      try { old = await api.getPlayerEntry(name); } catch (e) {
        if (!e || e.code !== 'LEADERBOARD_PLAYER_NOT_PRESENT') throw e;
      }
      if (old) {
        const o = parseExtra(old.extraData);
        if (old.score > metric || (old.score === metric && (o.s | 0) >= entry.score)) return;
      }
      // one write per second at most, across all boards
      setChain = setChain.catch(() => {}).then(async () => {
        const wait = lastSet + 1100 - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastSet = Date.now();
        await api.setScore(name, metric, extra);
        cache.delete(name);
      });
      return setChain;
    });
  }

  function fetchBoard(key) {
    const { name, kind } = lbName(key);
    const hit = cache.get(name);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.pending || Promise.resolve(hit.data);
    // two callers at once (the menu's frame on startup) share one read
    const pending = lb().then(api => api.getEntries(name, { quantityTop: 10, includeUser: authed, quantityAround: 1 }))
      .then(res => {
        const seen = new Set();
        const top = [];
        for (const e of res.entries || []) {
          if (seen.has(e.rank)) continue;
          seen.add(e.rank);
          const x = parseExtra(e.extraData);
          const p = e.player || {};
          top.push({
            rank: e.rank,
            name: p.publicName || L('ронин', 'ronin'),
            score: isWaves(kind) ? (x.s | 0) : e.score,
            act: Math.max(1, x.a | 0), wave: Math.max(1, x.w | 0), victory: !!x.v,
            me: !!(myUid && p.uniqueID === myUid),
          });
        }
        top.sort((a, b) => a.rank - b.rank);
        const data = { top, total: null, rank: res.userRank || 0 };
        cache.set(name, { ts: Date.now(), data });
        return data;
      }, e => { cache.delete(name); throw e; });
    cache.set(name, { ts: Date.now(), pending });
    return pending;
  }

  function login() {
    return sdkReady.then(sdk => {
      if (!sdk || !sdk.auth || authed) return;
      return sdk.auth.openAuthDialog().then(() => adoptPlayer(sdk), () => {});
    }).then(() => cache.clear());
  }

  Board.setBackend({
    submit, fetch: fetchBoard, login, authorized: () => authed,
    archive: false, allTime: true,
  });

  // ---------- The save in the cloud ----------
  // The local save stays the source of truth for THIS device; the player's
  // cloud data (200 KB, 100 writes per 5 min) mirrors it, so a wiped
  // localStorage or a second device finds the road already walked.
  //
  // Reconciling: the save with more PROGRESS wins — runs, then wins, then
  // kills — never the newer clock. A tie keeps the local one. A cloud save
  // that beats the local one is adopted at once when no run is on; caught
  // mid-run it waits, and is weighed again against the finished run's save.
  // Writes are debounced to one flush per CLOUD_GAP with a trailing send,
  // and forced when the tab goes dark.
  const CLOUD_GAP = 10000;
  let player = null, pulled = false, pendingCloud = null;
  let lastSent = null, queued = null, flushTimer = 0;

  const progress = m => [m.stats.runs | 0, m.stats.wins | 0, m.stats.totalKills | 0];
  function beats(a, b) { // meta a strictly ahead of meta b
    const pa = progress(a), pb = progress(b);
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
    return false;
  }
  const between = () => state.phase === 'menu' && !state.run && !replay;
  const isSave = c => !!(c && typeof c === 'object' && c.meta && c.meta.stats);

  function adopt(cloud) {
    adoptSave(cloud);   // core.js: state = normalized cloud, saved locally
    applyBlade();       // the adopted meta may wear another edge
    if (activeScreen === 'menu') renderMenu();
  }

  function pullSave(p) {
    player = p;
    if (typeof p.getData !== 'function') return;
    p.getData(['save']).then(d => {
      const cloud = d && d.save;
      if (isSave(cloud)) {
        const normalized = Game.normalizeState(cloud);
        const clean = { rngState: normalized.rngState, meta: normalized.meta };
        lastSent = JSON.stringify(clean); // what the cloud holds — no echo of it
        if (beats(clean.meta, state.meta)) {
          if (between()) adopt(clean); else pendingCloud = clean;
        }
      }
      pulled = true;
      if (queued) flushNow(); // the writes held back while the cloud was unread
    }).catch(e => { console.warn('[yandex] cloud save unavailable:', e && e.message); pulled = true; });
  }

  // The cloud save held back during a run, weighed once the run is over:
  // adopted if it still beats what the run left behind, dropped otherwise.
  function settlePending() {
    const c = pendingCloud; pendingCloud = null;
    if (beats(c.meta, state.meta)) adopt(c); // adopt() saves → sink() → pushed unless equal to lastSent
  }

  // core.js hands every save here (null = a progress reset)
  function sink(payload) {
    const json = JSON.stringify(payload);
    if (json === lastSent) return;
    queued = { json, payload };
    if (pulled && !flushTimer) flushNow();
  }
  function flushNow() {
    if (!queued || !player) return;
    const { json, payload } = queued;
    queued = null; lastSent = json;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = 0; if (queued) flushNow(); }, CLOUD_GAP);
    try {
      player.setData({ save: payload, ts: Date.now() }, true).catch(() => { lastSent = null; });
    } catch (e) { lastSent = null; }
  }
  setSaveSink(sink);

  function sendReady() {
    if (readySent || !ysdk) return;
    readySent = true;
    try { ysdk.features.LoadingAPI && ysdk.features.LoadingAPI.ready(); } catch (e) { /* no-op */ }
  }
  function ready() { readyWanted = true; sendReady(); }

  // Called every frame from the loop with the honest answer: is the player
  // fighting right now? Only the flips reach the SDK.
  function gameplay(on) {
    if (pendingCloud && between()) settlePending(); // the run is over: weigh the held cloud save now
    on = !!on && !document.hidden;
    if (on === playing || !ysdk) return;
    playing = on;
    try {
      const api = ysdk.features.GameplayAPI;
      if (api) on ? api.start() : api.stop();
    } catch (e) { /* no-op */ }
  }

  // Focus lost: the fight goes to its pause screen (the same path as Esc, so
  // the resume grace applies), the music dives, the audio context sleeps.
  function holdWorld() {
    if (state.phase === 'combat' && !paused && !replay) pressEscape();
    gameplay(false);
    Sound.suspend(true);
    // core.js already saved on this same event; a write waiting out the
    // debounce must not die with the tab
    if (queued && pulled) { clearTimeout(flushTimer); flushTimer = 0; flushNow(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) holdWorld();
    else Sound.suspend(false);
  });
  window.addEventListener('blur', holdWorld);
  window.addEventListener('focus', () => Sound.suspend(false));

  // ---------- The break between runs ----------
  // Called only from the dead/victory screens (main.js afterRun): the platform's
  // fullscreen ad, then `go` — the next run or the menu. The platform meters
  // its own frequency (an early call returns onClose(false) at once); AD_GAP
  // is OUR floor on top, so a string of ten-second deaths does not knock on
  // its door every time. Whatever happens — shown, skipped, error,
  // or a callback that never comes — `go` runs exactly once.
  const AD_GAP = 180000; // ms between two ad attempts
  let adAt = -Infinity, adBusy = false;
  function interstitial(go) {
    if (adBusy) return; // a second press while the ad is up: the first one already carries `go`
    if (!ysdk || !ysdk.adv || performance.now() - adAt < AD_GAP) { go(); return; }
    adAt = performance.now();
    adBusy = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true; adBusy = false;
      clearTimeout(guard);
      Sound.suspend(false);
      go();
    };
    // the SDK must answer within a few seconds — opened or refused; silence
    // means the player is left on the death screen for nothing
    let guard = setTimeout(finish, 6000);
    const callbacks = {
      onOpen: () => { clearTimeout(guard); Sound.suspend(true); gameplay(false); },
      onClose: finish, onError: finish,
    };
    try { ysdk.adv.showFullscreenAdv({ callbacks }); } catch (e) { finish(); }
  }

  return { ready, gameplay, interstitial, sdkReady };
})();
