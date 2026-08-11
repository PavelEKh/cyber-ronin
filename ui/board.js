'use strict';
// The online leaderboards — the game's one optional network piece. Three
// boards, one client: the daily seed (key = the seed date), the campaign and
// endless all-time boards (keys 'campaign'/'endless'). game.js knows nothing
// about any of it; main.js calls Board.runEnd() when an end screen opens and
// Board.view() from the menu's boards screen. Unconfigured (BOARD_URL empty)
// or unreachable, the module degrades to silence: no requests, no UI, no
// console errors.
//
// Identity is a random anonymous pid in localStorage — the worker upserts by
// (board, pid), so resubmits and renames are safe and farming is not. Names of
// OTHER players are untrusted input: everything renders via textContent.

const Board = (() => {
  // The deployed worker (see worker/README.md). Empty string disables the
  // whole feature: no requests, no UI.
  const BOARD_URL = 'https://cyber-ronin-daily.kamnnm.workers.dev';

  const PID_KEY = 'cyber-ronin-pid';
  const NAME_KEY = 'cyber-ronin-name';
  const NAME_MAX = 16;

  const enabled = () => !!BOARD_URL;

  function pid() {
    let v = localStorage.getItem(PID_KEY);
    if (!/^[0-9a-f]{16}$/.test(v || '')) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      v = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem(PID_KEY, v); } catch (e) { /* incognito: a session-long identity */ }
    }
    return v;
  }

  function getName() {
    const saved = (localStorage.getItem(NAME_KEY) || '').trim();
    return saved || L('ронин-', 'ronin-') + pid().slice(0, 4);
  }

  function setName(name) {
    const clean = name.trim().slice(0, NAME_MAX);
    try { localStorage.setItem(NAME_KEY, clean); } catch (e) { /* no save */ }
    return getName();
  }

  async function api(method, key, body) {
    const url = `${BOARD_URL}/board/${key}` + (method === 'GET' ? `?pid=${pid()}` : '');
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`board ${res.status}`);
    return res.json();
  }

  // a monthly board key ('YYYY-MM') — the daily's long-form sibling
  // The way lives in the key: a stance run never lands on a plain board, and a
  // date keeps its shape under the prefix so the archive walker still parses it.
  const STANCE_PREFIX = 's:';
  const bare = key => (key.startsWith(STANCE_PREFIX) ? key.slice(STANCE_PREFIX.length) : key);
  const isStanceKey = key => key.startsWith(STANCE_PREFIX);
  const wayKey = (key, hard) => (hard ? STANCE_PREFIX + key : key);
  const isMonth = key => /^\d{4}-\d{2}$/.test(bare(key));

  const boardTitle = key => (b =>
    b === 'endless' ? L('ДОСКА БЕСКОНЕЧНОСТИ', 'ENDLESS BOARD') :
    b === 'campaign' ? L('ДОСКА КАМПАНИИ', 'CAMPAIGN BOARD') :
    isMonth(b) ? L('ТАБЛИЦА МЕСЯЦА', 'BOARD OF THE MONTH') :
    L('ТАБЛИЦА ДНЯ', 'BOARD OF THE DAY'))(bare(key));

  // Which way's ledger this is. It used to be a bare '⛩' glued in front of the
  // title — present, and missed: a mark you have to already know cannot teach
  // the split, and the plain board said nothing at all, so its silence had to
  // be read as the answer. Both boards now name their road out loud, and the
  // line carries the same gold the harder way wears everywhere else.
  const wayLine = (parent, key) => {
    const el = div('board-way' + (isStanceKey(key) ? ' stance' : ''),
      isStanceKey(key) ? '⛩ ' + L('ПУТЬ ТРЁХ СТОЕК', 'WAY OF THREE STANCES')
                       : '⚔ ' + L('ОБЫЧНЫЙ ПУТЬ', 'THE PLAIN WAY'));
    parent.appendChild(el);
  };

  // ---------- Rendering ----------
  // Built with createElement/textContent on purpose: player names are the one
  // string on screen that other people wrote.

  const div = (cls, text) => {
    const el = document.createElement('div');
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  function renderRows(container, key, data, withEditor) {
    container.textContent = '';
    container.appendChild(div('board-title', boardTitle(key)));
    wayLine(container, key);
    // namesakes on the visible list get their public pid tag — two «ронин»
    // must not read as one player
    const dupes = {};
    for (const row of data.top) dupes[row.name] = (dupes[row.name] || 0) + 1;
    const list = div('board-list');
    data.top.forEach((row, i) => {
      const r = div('board-row' + (row.me ? ' me' : ''));
      r.appendChild(div('rank', `${i + 1}`));
      const name = div('name', row.name);
      if (dupes[row.name] > 1 && row.tag) {
        name.appendChild(div('tag', `#${row.tag}`));
      }
      r.appendChild(name);
      // the endless-family boards count waves; the others show how deep the run went
      r.appendChild(div('detail', bare(key) === 'endless' || isMonth(key)
        ? Game.F('волна {n}', 'wave {n}', { n: (row.act - 1) * Game.WAVES_PER_ACT + row.wave })
        : (row.victory ? '✓' : `${L('акт', 'act')} ${row.act}`)));
      r.appendChild(div('score', Game.fmt(row.score)));
      // the row's tape: fetch, unpack, hand to the viewer in main.js
      if (row.rep && row.tag) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'board-play';
        play.textContent = '▶';
        play.title = L('посмотреть реплей', 'watch the replay');
        play.addEventListener('click', () => watchGhost(key, row, play));
        r.appendChild(play);
      } else r.appendChild(div('detail', ''));
      list.appendChild(r);
    });
    if (!data.top.length) list.appendChild(div('board-empty', L('здесь ещё никого — ты первый', 'no one here yet — you are first')));
    container.appendChild(list);
    const foot = div('board-foot');
    foot.textContent = Game.F('игроков: {n}', 'players: {n}', { n: data.total }) +
      (data.rank ? ` · ${L('ты', 'you')} #${data.rank}` : '');
    container.appendChild(foot);
    if (withEditor) container.appendChild(renderNameEditor(container));
  }

  // A one-line rename control: the upsert keeps the score, changes the label.
  function renderNameEditor(container) {
    const wrap = div('board-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.value = getName();
    input.placeholder = L('имя на доске', 'name on the board');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cyber-btn mini';
    btn.textContent = L('СМЕНИТЬ ИМЯ', 'RENAME');
    btn.addEventListener('click', () => {
      setName(input.value);
      const st = lastSubmit;
      if (st) runEnd(container, st); // resubmit under the new name, re-render
    });
    // typing must not strike left/right underneath the input
    input.addEventListener('keydown', e => e.stopPropagation());
    wrap.appendChild(input);
    wrap.appendChild(btn);
    return wrap;
  }

  let lastSubmit = null; // the state whose result the board last showed

  // Fetch a row's tape and hand it to the replay viewer (startReplayView lives
  // in main.js — scripts share scope, the reference resolves at click time).
  async function watchGhost(key, row, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`${BOARD_URL}/replay/${key}/${row.tag}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`replay ${res.status}`);
      const rec = Game.unpackRec((await res.json()).replay);
      if (!rec || rec.v !== Game.REPLAY_EPOCH) {
        // an honest refusal beats a silently diverging ghost
        btn.textContent = '✕';
        btn.title = L('реплей от другой версии игры', 'a replay from another game version');
        return;
      }
      btn.disabled = false;
      startReplayView(rec, row.name);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '…';
      btn.title = L('реплей недоступен', 'the replay is unreachable');
    }
  }

  // The finished run's board key and payload — or null when there is nothing
  // honest to submit. The daily reports its BEST-of-day from the meta ledger;
  // campaign and endless report the run itself.
  function runResult(s) {
    const r = s.run;
    if (!enabled() || !r || r.cheated) return null;
    // the tape rides along only when THIS run is the entry being reported —
    // a sealed recording of the exact numbers the board will show
    const tape = r.rec && r.rec.T !== undefined ? Game.packRec(r.rec) : null;
    if (r.daily) {
      const d = s.meta[Game.dailySlot(s, r.hard)];
      if (!d || !d.done) return null;
      return {
        key: wayKey(d.date, r.hard),
        entry: {
          score: d.score, act: Math.max(1, d.act), wave: Math.max(1, d.wave), victory: !!d.victory,
          // an earlier run today may hold the best — its tape was sent back then
          replay: r.score === d.score ? tape : undefined,
        },
      };
    }
    if (r.monthly) {
      const m = s.meta[Game.monthlySlot(s, r.hard)];
      if (!m || !m.done) return null;
      // the tape rides along only when THIS run holds the month's best
      const best = (m.act - 1) * Game.WAVES_PER_ACT + m.wave;
      const mine = (r.act - 1) * Game.WAVES_PER_ACT + r.wave;
      return {
        key: wayKey(m.month, r.hard),
        entry: {
          score: m.score, act: Math.max(1, m.act), wave: Math.max(1, m.wave), victory: false,
          replay: mine === best && r.score === m.score ? tape : undefined,
        },
      };
    }
    return {
      key: wayKey(r.endless ? 'endless' : 'campaign', r.hard),
      entry: { score: r.score, act: r.act, wave: r.wave, victory: s.phase === 'victory', replay: tape || undefined },
    };
  }

  // The entry point for end screens: submit the run's result (idempotent —
  // the worker keeps the best) and render its board. Silent on any failure.
  async function runEnd(container, s) {
    const res = runResult(s);
    container.classList.toggle('hidden', !res);
    if (!res) return;
    lastSubmit = s;
    container.textContent = '';
    container.appendChild(div('board-title', boardTitle(res.key) + '…'));
    wayLine(container, res.key);
    try {
      await api('POST', res.key, { pid: pid(), name: getName(), ...res.entry });
      champCache = null; // the menu's frame must catch a possible new leader
      renderRows(container, res.key, await api('GET', res.key), true);
    } catch (e) {
      // offline or the worker is down — the board simply is not there today
      container.classList.add('hidden');
    }
  }

  // Quitting to the menu still offers the run to its board — fire and forget,
  // nothing to render (the daily ledger is written by abandonRun before this).
  function submitQuiet(s) {
    const res = runResult(s);
    if (!res) return;
    api('POST', res.key, { pid: pid(), name: getName(), ...res.entry })
      .then(() => { champCache = null; })
      .catch(() => {});
  }

  // ---------- The champion's frame ----------
  // The daily's №1 on the main menu: the crown, the tape, the challenge.
  // The board answer is cached for a couple of minutes so menu visits don't
  // hammer the worker; a submitted result drops the cache, so a new leader
  // shows the moment you return to the menu.
  let champCache = null; // { key, data, ts }
  const CHAMP_TTL = 2 * 60 * 1000;

  const champBtn = (cls, text, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };

  async function champ(container, key, onChallenge) {
    if (!enabled()) { container.classList.add('hidden'); return; }
    let data;
    try {
      if (champCache && champCache.key === key && Date.now() - champCache.ts < CHAMP_TTL) {
        data = champCache.data;
      } else {
        data = await api('GET', key);
        champCache = { key, data, ts: Date.now() };
      }
    } catch (e) {
      // offline or the worker is down — the menu simply has no frame today
      container.classList.add('hidden');
      return;
    }
    const top = data.top[0];
    container.textContent = '';
    container.classList.toggle('me', !!(top && top.me));
    if (!top) {
      // an empty throne is itself an invitation
      container.appendChild(div('champ-title', '👑 ' + L('СИД ДНЯ', 'DAILY SEED')));
      container.appendChild(div('champ-empty', L('трон пуст — займи его первым', 'the throne is empty — take it first')));
      container.appendChild(div('champ-detail', Game.F('играли сегодня: {n}', 'played today: {n}', { n: data.total })));
      const act = div('champ-actions');
      act.appendChild(champBtn('cyber-btn mini primary', L('⚔ ЗАНЯТЬ ТРОН', '⚔ TAKE THE THRONE'), onChallenge));
      container.appendChild(act);
      container.classList.remove('hidden');
      return;
    }
    container.appendChild(div('champ-title', '👑 ' + (top.me
      ? L('ТЫ ДЕРЖИШЬ СИД ДНЯ', 'YOU HOLD THE DAILY SEED')
      : L('ЛИДЕР СИДА ДНЯ', 'DAILY SEED CHAMPION'))));
    container.appendChild(div('champ-name', top.name));
    container.appendChild(div('champ-score', Game.fmt(top.score)));
    container.appendChild(div('champ-detail',
      (top.victory ? '✓ ' + L('полный проход', 'full clear') : `${L('акт', 'act')} ${top.act}`) +
      ` · ${Game.F('играли сегодня: {n}', 'played today: {n}', { n: data.total })}` +
      (data.rank && !top.me ? ` · ${L('ты', 'you')} #${data.rank}` : '')));
    const act = div('champ-actions');
    // the champion's tape rides the same route as a board row's ▶
    if (top.rep && top.tag) {
      act.appendChild(champBtn('cyber-btn mini', L('▶ РЕПЛЕЙ', '▶ REPLAY'),
        e => watchGhost(key, top, e.currentTarget)));
    }
    act.appendChild(champBtn('cyber-btn mini primary', top.me
      ? L('⚔ ЗАКРЕПИТЬ РЕКОРД', '⚔ EXTEND THE LEAD')
      : L('⚔ ПОБИТЬ РЕКОРД', '⚔ BEAT THE RECORD'), onChallenge));
    container.appendChild(act);
    container.classList.remove('hidden');
  }

  // Read-only view for the menu's boards screen: no submission and no name
  // editor (a rename rides on a result — it happens after a run).
  async function view(container, key) {
    container.textContent = '';
    container.appendChild(div('board-title', boardTitle(key) + '…'));
    wayLine(container, key);
    try {
      renderRows(container, key, await api('GET', key), false);
    } catch (e) {
      container.textContent = '';
      container.appendChild(div('board-empty',
        L('доска недоступна — офлайн или сервер молчит', 'the board is unreachable — offline or the server is silent')));
    }
  }

  return { enabled, wayKey, isStanceKey, runEnd, submitQuiet, view, champ, getName, setName };
})();
