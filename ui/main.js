'use strict';
// Game loop, input, screens and HUD. Combat logic lives in game.js, rendering in scene.js.

// ---------- Localization ----------
const L = Game.L; // L('rus', 'eng') — a string for the current language
const F = Game.F; // F(ruTpl, enTpl, params) — interpolated strings, pack-translatable

// static elements: data-i18n → [ru, en]
const STR = {
  tagline:    ['путь клинка через неоновый город', 'a blade\u2019s path through the neon city'],
  btnStart:   ['⚔ В БОЙ', '⚔ FIGHT'],
  btnEndless: ['♾ БЕСКОНЕЧНОСТЬ', '♾ ENDLESS'],
  btnDaily:   ['🗓 СИД ДНЯ', '🗓 DAILY SEED'],
  btnBoard:   ['🏅 ДОСКИ', '🏅 BOARDS'],
  boardTitle: ['ДОСКИ ПОЧЁТА', 'LEADERBOARDS'],
  boardSub:   ['сид дня · кампания · бесконечность', 'daily seed · campaign · endless'],
  tabDaily:   ['СИД ДНЯ', 'DAILY'],
  tabCampaign: ['КАМПАНИЯ', 'CAMPAIGN'],
  tabEndless: ['БЕСКОНЕЧНОСТЬ', 'ENDLESS'],
  btnShop:    ['💾 ПРОШИВКА', '💾 FIRMWARE'],
  btnAch:     ['🏆 ТРОФЕИ', '🏆 TROPHIES'],
  btnLog:     ['📓 ЖУРНАЛ', '📓 JOURNAL'],
  logTitle:   ['ЖУРНАЛ', 'JOURNAL'],
  logSub:     ['что удалось вытащить из выгрузок', 'what the uploads managed to keep'],
  btnHelp:    ['❔ КАК ИГРАТЬ', '❔ HOW TO PLAY'],
  choiceSub:  ['выбери имплант', 'choose an implant'],
  choiceHint: ['цифры или клик', 'number keys or click'],
  deadTitle:  ['СИСТЕМА ОТКАЗАЛА', 'SYSTEM FAILURE'],
  deadSub:    ['клинок вернётся. всегда возвращается', 'the blade returns. it always does'],
  btnRetry:   ['⟳ ЕЩЁ ЗАБЕГ', '⟳ RUN AGAIN'],
  btnReplay:  ['▶ РЕПЛЕЙ', '▶ REPLAY'],
  btnMenu:    ['МЕНЮ', 'MENU'],
  winTitle:   ['ПУТЬ ПРОЙДЕН', 'THE PATH IS WALKED'],
  winSub:     ['рассвет над аркологией. город свободен', 'dawn over the arcology. the city is free'],
  btnNewPath: ['⟳ НОВЫЙ ПУТЬ', '⟳ NEW PATH'],
  shopTitle:  ['ПРОШИВКА', 'FIRMWARE'],
  shopSub:    ['постоянные улучшения серии — переживают смерть экземпляра', 'the series’ permanent upgrades — they survive the instance'],
  btnBack:    ['НАЗАД', 'BACK'],
  helpTitle:  ['КАК ИГРАТЬ', 'HOW TO PLAY'],
  achTitle:   ['ТРОФЕИ', 'TROPHIES'],
  pauseTitle: ['ПАУЗА', 'PAUSED'],
  btnResume:  ['ПРОДОЛЖИТЬ', 'RESUME'],
  btnQuit:    ['ВЫЙТИ В МЕНЮ', 'QUIT TO MENU'],
  pauseHint:  ['кредиты забега не сгорают', 'run credits are kept'],
  combo:      ['КОМБО', 'COMBO'],
  loading:    ['ЗАГРУЗКА…', 'LOADING…'],
  btnReset:   ['⌫ СБРОСИТЬ ПРОГРЕСС', '⌫ RESET PROGRESS'],
};

// ---------- Story ----------
// Kage Corp's own log, one line per death, in the order they were filed. The
// tone is deliberately clerical: the system that just lost you does not mourn,
// it reconciles. The sequence runs out after ten and settles forever on the
// line this screen has always shown — the blade gets the last word over the
// paperwork, and the loop the player is living becomes the joke's punchline.
const DEATH_LOG = [
  ['экземпляр №{n} снят с довольствия. выгрузка памяти — 41%',
   'unit no.{n} struck off supply. memory upload — 41%'],
  ['отказ подтверждён. клинок цел, носитель — нет',
   'failure confirmed. the blade is intact, the carrier is not'],
  ['сборка следующего экземпляра начата до окончания отчёта',
   'assembly of the next unit began before this report was filed'],
  ['выгружено: рефлексы, счета, привычки. не выгружено: всё остальное',
   'uploaded: reflexes, ledgers, habits. not uploaded: everything else'],
  ['серия «Ронин» — расходная. это не дефект, это спецификация',
   'the Ronin series is consumable. that is not a defect, that is the spec'],
  ['жалоб на боль не поступало. датчик боли в спецификацию не входит',
   'no complaints of pain received. a pain sensor is not in the spec'],
  ['оператор смены отметил: «этот дошёл дальше». пометка удалена как нерелевантная',
   'shift operator noted: "this one got further". note deleted as irrelevant'],
  ['клиент платит не за экземпляры. клиент платит за подъём',
   'the client does not pay for units. the client pays for the ascent'],
  ['в архиве три копии этой памяти. активной остаётся одна',
   'the archive holds three copies of this memory. exactly one stays active'],
  ['протокол «Возвращение» отработал штатно',
   'protocol Return completed nominally'],
];

const DEATH_TAIL = ['клинок вернётся. всегда возвращается', 'the blade returns. it always does'];

// What each Warden is, said in the ronin's voice — shown instead of the
// mechanical hint once the player has met that Warden enough times to know it.
const BOSS_VOICE = [
  { sub: 'предыдущая серия. он всё ещё патрулирует маршрут, которого больше нет',
    en: { sub: 'the previous series. he is still patrolling a route that no longer exists' } },
  { sub: 'его несёт ветром, а не волей. меня — контрактом',
    en: { sub: 'the wind carries him, not his will. mine is a contract' } },
  { sub: 'он собран из чужой памяти. потому и не помнит, где право',
    en: { sub: 'he is assembled from other people’s memory. that is why he forgets which way is right' } },
  { sub: 'ядро зовёт подмогу голосом мастера. голос — всё, что от мастера осталось',
    en: { sub: 'the core calls for backup in the master’s voice. the voice is all that is left of him' } },
  { sub: 'он раздаёт клинки, как долги. возвращай с процентами',
    en: { sub: 'he hands out blades like debts. return them with interest' } },
  { sub: 'подделка держится, пока в неё верят. я перестал',
    en: { sub: 'a fake holds as long as it is believed. i stopped' } },
];

// Victory keeps its original line the first time. After that the summit stops
// being an ending — which is exactly when endless mode is already unlocked.
const WIN_SUB = ['ты снова на вершине. значит, вершина не была выходом',
                 'you are on the summit again. so the summit was not a way out'];

function deathLine() {
  const n = state.meta.stats.runs;
  const i = Math.max(0, n - 1);
  const pair = i < DEATH_LOG.length ? DEATH_LOG[i] : DEATH_TAIL;
  return L(pair[0], pair[1]).replace('{n}', Game.fmt(n));
}

// Progress wipe: armed by the first click, fired by the second. The warning
// spells out exactly what is lost, because none of it can be recovered.
const RESET_STR = {
  arm:  ['НАЖМИ ЕЩЁ РАЗ, ЧТОБЫ СТЕРЕТЬ', 'CLICK AGAIN TO ERASE'],
  warn: ['кредиты, прошивка, трофеи и рекорды — безвозвратно',
         'credits, firmware, trophies and records — permanently'],
  done: ['ПРОГРЕСС СТЁРТ', 'PROGRESS ERASED'],
};
const RESET_ARM_TIME = 4000; // ms the armed state lasts before it disarms itself

// The help page, paragraph by paragraph: each row is [ru, en], rendered
// through L() so overlay packs translate it per paragraph — a paragraph the
// pack misses falls back to English alone, not the whole page.
const HELP_PARAGRAPHS = [
  [`<b>← A</b> — удар влево · <b>D →</b> — удар вправо. Мышью: <b>ЛКМ</b> — влево, <b>ПКМ</b> — вправо. На сенсоре — тап по половине экрана.`,
   `<b>← A</b> — strike left · <b>D →</b> — strike right. Mouse: <b>left button</b> — left, <b>right button</b> — right. On touch — tap the screen half.`],
  [`Бей врага, только когда он <b>в зоне досягаемости</b> (метки на земле). Удар по воздуху — короткий <b>стан</b>, сброс комбо, и пока ты висишь, <b>толпа ускоряется</b>.`,
   `Hit an enemy only when it is <b>within reach</b> (ground markers). Swinging at air — a short <b>stun</b>, a combo reset, and while you hang the <b>crowd speeds up</b>.`],
  [`<b>Дрон</b> умирает с одного удара. <b>Панк</b> после удара перелетает на другую сторону — добей там. <b>Щитовик</b> держит три удара. <b>Метатель</b> кидает сюрикен — отбей его обратно.`,
   `A <b>drone</b> dies in one hit. A <b>punk</b> flips to the other side after a hit — finish him there. A <b>shielder</b> takes three hits. A <b>thrower</b> hurls a shuriken — deflect it back.`],
  [`Элита ломает ритм: <b>фехтовальщик</b> парирует — жди зелёного окна; <b>адаптант</b> блокирует чередование — бей дважды с одной стороны; <b>близнецы</b> умирают только от одновременного удара обеих кнопок.`,
   `Elites break the rhythm: the <b>fencer</b> parries — wait for the green window; the <b>adapter</b> blocks alternation — strike twice from one side; the <b>twins</b> die only to both buttons at once.`],
  [`<b>Мимик</b> выглядит как дрон, но у зоны вспыхивает истинная суть: <b>плотный</b> — настоящий, бей; <b>полый и холодный</b> — призрак, <b>не бей</b> (сам растает, а удар сквозь него — промах). Проверяет концентрацию, а не привычку.`,
   `A <b>mimic</b> looks like a drone but flashes its true nature near the zone: <b>solid</b> — real, strike it; <b>hollow and cold</b> — a phantom, <b>don't strike</b> (it fades on its own, and a swing through it whiffs). It tests concentration, not habit.`],
  [`В конце акта выходит <b>Страж</b>: ударь его в зоне и повтори последовательность стрелок в темпе. Ошибка или промедление — минус броня, и он зайдёт снова. У каждого стража свой трюк: порывы ветра, <b>глитч-стрелки</b> (бей в противоположную сторону), призыв подмоги.`,
   `A <b>Warden</b> ends each act: strike him in the zone and repeat the arrow sequence in tempo. A mistake or delay costs armor, and he comes again. Each Warden has a signature trick: wind gusts, <b>glitch arrows</b> (strike the opposite way), summoned backup.`],
  [`Со второго акта волна может прийти с <b>мутатором</b> — особым правилом (шквал, туман, дождь стали, блиц). Убийства на такой волне платят больше кредитов.`,
   `From act two a wave may arrive with a <b>mutator</b> — a special rule (squall, fog, steel rain, blitz). Kills on such a wave pay extra credits.`],
  [`После каждой волны — выбор одного из трёх <b>имплантов</b>: они живут ровно один забег. После смерти кредиты остаются — трать их на <b>прошивку</b>, постоянные улучшения, которые переживают смерть. Первая победа открывает <b>бесконечность</b>: акты идут по кругу, рекорд — число волн.`,
   `After each wave — pick one of three <b>implants</b>: they live for exactly one run. Credits survive death — spend them on <b>firmware</b>, the permanent upgrades that outlive it. The first victory unlocks <b>endless</b>: acts cycle, the record is your wave count.`],
  [`<b>Сид дня</b> — забег на общем для всех сиде: волны у всех одинаковые. <b>Прошивка</b> (постоянные улучшения из магазина) на этот забег отключена — доска сравнивает руки, а не кошельки; обычные импланты после волн работают как всегда. Попыток сколько угодно — на доску дня идёт лучший результат.`,
   `The <b>daily seed</b> — a run on a seed shared by everyone: identical waves. <b>Firmware</b> (the shop's permanent upgrades) is offline for this run — the board compares hands, not wallets; ordinary implants after waves work as always. Attempts are unlimited — the day's board keeps your best result.`],
  [`<b>Esc</b> — пауза. На паузе показывают разбор текущей обстановки: правило мутатора волны, а во время боя со стражем — как именно его убивать.`,
   `<b>Esc</b> — pause. The pause screen breaks down the current situation: the wave mutator's rule, and during a Warden fight, exactly how to kill him.`],
];

function applyLang() {
  const lang = Game.getLang();
  const en = lang !== 'ru'; // for the binary assets (logo, help page) every pack language reads the English side
  document.documentElement.lang = lang;
  document.title = en ? 'Cyber Ronin' : 'Кибер-ронин';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const pair = STR[el.dataset.i18n];
    if (pair) el.textContent = L(...pair); // L consults the overlay pack, falls back to English
  }
  const logo = en ? 'CYBER RONIN' : 'КИБЕР-РОНИН';
  for (const el of document.querySelectorAll('#game-title .logo-half')) el.textContent = logo;
  $('help-body').innerHTML = HELP_PARAGRAPHS.map(pr => `<p>${L(...pr)}</p>`).join('');
  $('lang-select').value = lang;
}

// ---------- Screens ----------
const SCREENS = ['menu', 'choice', 'dead', 'victory', 'shop', 'help', 'pause', 'ach', 'log', 'board'];
let activeScreen = 'menu';
let shopReturnTo = 'menu'; // which screen the implant shop was opened from

function showScreen(name) {
  activeScreen = name;
  for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
  $('overlay').style.display = name ? 'block' : 'none';
  if (name === 'menu') { renderMenu(); menuBgStart(); }
  if (name === 'shop') renderShop();
  if (name === 'ach') renderAch();
  if (name === 'board') renderBoardScreen();
  if (name === 'choice') renderChoice();
  if (name === 'pause') renderPauseBrief();
  if (name === 'log') renderLog();
  if (name === 'dead') {
    renderEndStats('dead-stats');
    $('dead-sub').textContent = deathLine();
    $('btn-replay-dead').classList.toggle('hidden', !canReplay());
    Board.runEnd($('dead-board'), state);
  }
  if (name === 'victory') {
    renderEndStats('victory-stats');
    $('btn-replay-victory').classList.toggle('hidden', !canReplay());
    Board.runEnd($('victory-board'), state);
    // the shipped line stands for the first clear; after that the summit speaks
    $('victory-sub').textContent = state.meta.stats.wins > 1
      ? L(...WIN_SUB) : L(...STR.winSub);
  }
}

function hideScreens() {
  activeScreen = null;
  $('overlay').style.display = 'none';
}

// The UTC calendar date — the daily's key. UTC by decision (2026-07-30): the
// board is shared, so the whole world flips to the new seed at the same
// instant — nobody's evening hands them tomorrow's seed early.
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function renderMenu() {
  const st = state.meta.stats;
  $('menu-credits').textContent = `${Game.fmt(state.meta.credits)} ㋕`;
  // endless unlocks with the first full clear
  const unlocked = st.wins >= 1;
  const be = $('btn-endless');
  be.disabled = !unlocked;
  be.classList.toggle('locked', !unlocked);
  be.title = unlocked ? '' : L('открывается после победы во всех шести актах',
    'unlocks after clearing all six acts');
  // the daily: retries are free, the board keeps the day's best
  const daily = state.meta.daily;
  const played = !!(daily && daily.date === todayStr() && daily.done);
  $('btn-daily').title =
    L('общий сид, прошивка отключена — на доску идёт лучший результат дня',
      'a shared seed, firmware offline — the board keeps the day’s best');
  // the board button exists only while the online piece is configured
  $('btn-board').classList.toggle('hidden', !Board.enabled());
  // the journal stays off the menu until it has something in it: a fresh player
  // gets the menu exactly as before, and the button appearing after the first
  // death is itself the first beat of the story
  $('btn-log').classList.toggle('hidden', !Object.keys(state.meta.story.log).length);
  const endlessLine = st.bestEndless
    ? '<br>' + F('бесконечность: {n} волн', 'endless: {n} waves', { n: st.bestEndless })
    : '';
  // today's best under the records — once the day has at least one finished run
  const dailyLine = played
    ? '<br>' + F('сид дня: лучший {s} · акт {a}', 'daily seed: best {s} · act {a}', { s: Game.fmt(daily.score), a: romanAct(daily.act) }) +
      (daily.victory ? ' · ✓' : '')
    : '';
  $('menu-stats').innerHTML = st.runs
    ? F('забегов: {r} · побед: {w} · убийств: {k}', 'runs: {r} · wins: {w} · kills: {k}', { r: st.runs, w: st.wins, k: Game.fmt(st.totalKills) }) + '<br>' +
      F('рекорд: {s} · лучшее комбо: {c}', 'best score: {s} · best combo: {c}', { s: Game.fmt(st.bestScore), c: st.bestCombo }) + endlessLine + dailyLine
    : L('враги идут с двух сторон. у тебя две кнопки. этого достаточно',
        'enemies come from both sides. you have two buttons. that is enough');
}

// ---------- The boards screen ----------
// Three boards behind three tabs; the daily tab always means TODAY's date.
let boardTab = 'daily';

function renderBoardScreen() {
  const key = boardTab === 'daily' ? todayStr() : boardTab;
  for (const b of document.querySelectorAll('#board-tabs button')) {
    b.classList.toggle('primary', b.dataset.key === boardTab);
  }
  Board.view($('menu-board'), key);
}

function renderShop() {
  disarmReset(); // reopening the screen never leaves the wipe armed
  $('shop-credits').textContent = `${Game.fmt(state.meta.credits)} ㋕`;
  const list = $('shop-list');
  list.innerHTML = '';
  for (const m of Game.META) {
    const lvl = Game.metaLvl(state, m.id);
    const cost = Game.metaCost(state, m);
    const maxed = lvl >= m.cap;
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML =
      `<div class="icon">${m.icon}</div>` +
      `<div class="body"><div class="name">${Game.T(m, 'name')}</div><div class="desc">${Game.T(m, 'desc')}</div></div>` +
      `<div class="lvl">${'▮'.repeat(lvl)}${'▯'.repeat(m.cap - lvl)}</div>` +
      `<button class="buy${maxed ? ' maxed' : ''}" ${maxed || state.meta.credits < cost ? 'disabled' : ''}>` +
      `${maxed ? L('МАКС', 'MAX') : Game.fmt(cost) + ' ㋕'}</button>`;
    if (!maxed) {
      row.querySelector('.buy').addEventListener('click', () => {
        if (Game.buyMeta(state, m.id)) {
          Sound.ensure(); Sound.sfx('buy');
          saveState();
          renderShop();
        }
      });
    }
    list.appendChild(row);
  }
}

function renderAch() {
  const list = $('ach-list');
  let open = 0;
  list.innerHTML = '';
  for (const a of Game.ACHIEVEMENTS) {
    const got = !!state.meta.ach[a.id];
    if (got) open++;
    const v = Math.min(a.value(state), a.target);
    const row = document.createElement('div');
    row.className = 'ach-row' + (got ? '' : ' locked');
    row.innerHTML =
      `<div class="icon">${a.icon}</div>` +
      `<div class="body"><div class="name">${Game.T(a, 'name')}</div><div class="desc">${Game.T(a, 'desc')}</div></div>` +
      `<div class="prog">${got ? '✓ +' + a.reward + ' ㋕' : Game.fmt(v) + '/' + Game.fmt(a.target)}</div>`;
    list.appendChild(row);
  }
  $('ach-summary').textContent = F('открыто {n} из {m}', '{n} of {m} unlocked', { n: open, m: Game.ACHIEVEMENTS.length });
}

// The journal. Locked fragments are listed but redacted: a page of blanks says
// "there is more of this" without saying what, which is the whole point of
// keeping the story optional.
function renderLog() {
  const list = $('log-list');
  let open = 0;
  list.innerHTML = '';
  for (const e of Game.LOG) {
    const got = !!state.meta.story.log[e.id];
    if (got) open++;
    const row = document.createElement('div');
    row.className = 'log-row' + (got ? '' : ' locked');
    row.innerHTML = got
      ? `<div class="icon">${e.icon}</div>` +
        `<div class="body"><div class="name">${Game.T(e, 'name')}</div>` +
        `<div class="text">${Game.T(e, 'text')}</div></div>`
      : `<div class="icon">▮</div>` +
        `<div class="body"><div class="name">${L('ЗАПИСЬ ЗАКРЫТА', 'ENTRY SEALED')}</div>` +
        `<div class="text">${'▮'.repeat(18 + (e.id.length % 9) * 3)}</div></div>`;
    list.appendChild(row);
  }
  $('log-summary').textContent = F('открыто {n} из {m} записей', '{n} of {m} recovered', { n: open, m: Game.LOG.length });
}

function renderChoice() {
  const r = state.run;
  const cleared = r.wave >= Game.WAVES_PER_ACT;
  $('choice-title').textContent = cleared
    ? F('АКТ {a} ПРОЙДЕН', 'ACT {a} CLEARED', { a: romanAct(r.act) })
    : L('ВОЛНА ЗАЧИЩЕНА', 'WAVE CLEARED');
  const cards = $('choice-cards');
  cards.innerHTML = '';
  (r.offers || []).forEach((id, i) => {
    const im = Game.IMPLANTS.find(x => x.id === id);
    const owned = r.implants[id] || 0;
    const card = document.createElement('div');
    card.className = 'implant-card';
    card.innerHTML =
      `<span class="icon">${im.icon}</span>` +
      `<div class="name">${Game.T(im, 'name')}</div>` +
      `<div class="desc">${Game.T(im, 'desc')}</div>` +
      (owned ? `<div class="owned">${L('установлено', 'installed')}: ${owned}/${im.stack}</div>` : '') +
      `<span class="key">${i + 1}</span>`;
    card.addEventListener('click', () => choose(i));
    cards.appendChild(card);
  });
  // Reassembly: the reroll button lives only while charges remain
  const left = Game.metaLvl(state, 'mreroll') - (r.rerollsUsed || 0);
  const rb = $('btn-reroll');
  rb.classList.toggle('hidden', left <= 0);
  if (left > 0) rb.textContent = F('🎲 ПЕРЕСОБРАТЬ · {n} (R)', '🎲 REROLL · {n} (R)', { n: left });
}

function rerollChoice() {
  if (Game.rerollOffers(state)) {
    Sound.sfx('buy');
    renderChoice();
  }
}

function renderEndStats(elId) {
  const r = state.run;
  if (!r) return;
  const report = Game.deathReport(state);
  const rows = [
    r.endless
      ? [L('Бесконечность', 'Endless'), F('волна {n}', 'wave {n}', { n: Game.endlessWave(r) })]
      : [L('Акт', 'Act'), `${romanAct(r.act)} · ${L('волна', 'wave')} ${r.wave}`],
    [L('Счёт', 'Score'), Game.fmt(r.score)],
    [L('Убийств', 'Kills'), Game.fmt(r.kills)],
    [L('Лучшее комбо', 'Best combo'), String(r.bestCombo)],
  ];
  if (r.daily) rows.unshift([L('Сид дня', 'Daily seed'), state.meta.daily ? state.meta.daily.date : '', 'gold']);
  // the debrief: how clean the hands were, and — on the death screen — who ended it
  if (report && report.presses >= 10) {
    rows.push([L('Точность', 'Accuracy'),
      `${Math.round(report.accuracy * 100)}%` +
      (report.misses ? ` · ${L('промахов', 'misses')}: ${report.misses}` : '')]);
  }
  if (report && elId === 'dead-stats' && report.killer) {
    rows.push([L('Убийца', 'Killer'),
      `${Game.causeName(report.killer.cause)} · ${L('акт', 'act')} ${romanAct(report.killer.act)}`, 'danger']);
    // the main threat: the source that wounded most, when it was not a lone hit
    const top = Object.keys(report.counts).sort((a, b) => report.counts[b] - report.counts[a])[0];
    if (top && report.counts[top] >= 2) {
      rows.push([L('Главная угроза', 'Main threat'),
        `${Game.causeName(top)} · ${report.counts[top]}×`]);
    }
  }
  rows.push(
    // a tainted run banks nothing — say so instead of showing credits that never arrived
    r.cheated
      ? [L('Кредиты на счёт', 'Credits banked'), L('— забег без зачёта', '— run does not count')]
      : [L('Кредиты на счёт', 'Credits banked'), `+${Game.fmt(r.credits)} ㋕`, 'gold'],
    [L('Всего кредитов', 'Total credits'), `${Game.fmt(state.meta.credits)} ㋕`, 'gold'],
  );
  $(elId).innerHTML = rows.map(([k, v, cls]) =>
    `<div class="k">${k}</div><div class="v ${cls || ''}">${v}</div>`).join('');
  // the one piece of advice under the numbers, chosen by what actually went wrong
  if (elId === 'dead-stats') {
    const tipEl = $('dead-tip');
    if (report && report.tip) {
      tipEl.innerHTML = `▲ ${Game.T(report.tip, 'text')}`;
      tipEl.classList.remove('hidden');
    } else tipEl.classList.add('hidden');
  }
}

// ---------- Act banner ----------
let bannerTimer = null;
let mutBannerTimer = null;

function popBanner(kicker, name, sub) {
  $('act-banner-kicker').textContent = kicker;
  $('act-banner-name').textContent = name;
  $('act-banner-sub').textContent = sub;
  const el = $('act-banner');
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth; // restart the animation
  el.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// in endless mode the four locations cycle
const actData = act => Game.ACTS[(act - 1) % Game.ACTS.length];

// ---------- Menu kaleidoscope ----------
// The menu background is a slow travelling shot through the road's locations:
// no hero, no combat band (scene.js skips both in the menu phase), a new act
// every dozen seconds through a dip to black. It opens on a random act that is
// NOT the street — the first thing a player sees should be a promise of the
// road, not the scene they are about to start in.
const MENU_BG_EVERY = 12000; // ms per location
const MENU_BG_DIP = 700;     // ms of the dip (must match #menu-fade transition)
let menuBgTimer = null;
let menuBgIdx = 1 + Math.floor(Math.random() * (Game.ACTS.length - 1)); // 1..5 — anything but street

function menuBgStart() {
  if (menuBgTimer) return;
  Scene.setAct(Game.ACTS[menuBgIdx].id);
  menuBgTimer = setInterval(() => {
    if (state.phase !== 'menu') return; // a run started under us — the timer dies next stop
    $('menu-fade').style.opacity = '1';
    setTimeout(() => {
      // re-check: the dip may have outlived the menu
      if (state.phase === 'menu') {
        menuBgIdx = (menuBgIdx + 1) % Game.ACTS.length;
        Scene.setAct(Game.ACTS[menuBgIdx].id);
      }
      $('menu-fade').style.opacity = '0';
    }, MENU_BG_DIP);
  }, MENU_BG_EVERY);
}

function menuBgStop() {
  clearInterval(menuBgTimer);
  menuBgTimer = null;
  $('menu-fade').style.opacity = '0';
}

function showActBanner(act) {
  const a = actData(act);
  popBanner(F('АКТ {a}', 'ACT {a}', { a: romanAct(act) }), Game.T(a, 'name').toUpperCase(), Game.T(a, 'sub'));
}

// The mutated-wave banner; waits out the act banner when both fire at once.
function showMutatorBanner(delayed) {
  clearTimeout(mutBannerTimer);
  const r = state.run;
  if (!r || !r.mutator) return;
  const mutId = r.mutator;
  const show = () => {
    const r2 = state.run;
    if (!r2 || r2.mutator !== mutId || state.phase !== 'combat') return;
    const m = Game.MUTATORS.find(x => x.id === mutId);
    popBanner(L('МУТАТОР ВОЛНЫ', 'WAVE MUTATOR'), Game.T(m, 'name'),
      Game.T(m, 'desc') + ' · ' + L('награда +30%', 'reward +30%'));
    Sound.sfx('stance');
  };
  if (delayed) mutBannerTimer = setTimeout(show, 2800);
  else show();
}

// ---------- HUD ----------
let hudCombo = -1, hudArmor = '', hudExec = '', hudMut = '';

function updateHud() {
  const r = state.run;
  if (!r) return;
  const maxHp = Game.maxHp(state);
  const armorKey = r.hp + '/' + maxHp;
  if (armorKey !== hudArmor) {
    // how many plates went out in this update — rebuilding the row would wipe
    // any running animation, so the ones just lost are marked as they are built
    const prevHp = Number((hudArmor.split('/')[0] ?? r.hp));
    const lost = hudArmor && Number.isFinite(prevHp) ? prevHp - r.hp : 0;
    hudArmor = armorKey;
    let html = '';
    for (let i = 0; i < maxHp; i++) {
      let cls;
      if (i < r.hp) cls = r.hp === 1 ? 'armor-pip last' : 'armor-pip';
      else cls = i < r.hp + lost ? 'armor-pip empty chip' : 'armor-pip empty';
      html += `<div class="${cls}"></div>`;
    }
    $('hud-armor').innerHTML = html;
    // the last pip already reads as danger on screen — say it in the mix too
    Sound.setPeril(r.hp === 1);
  }
  if (r.combo !== hudCombo) {
    const grew = r.combo > hudCombo;
    hudCombo = r.combo;
    // the arrangement follows the streak: layers build as the flow deepens and
    // fall away the instant it breaks
    Sound.setTier(comboTier(r.combo));
    // milestone streaks get the drop — the whole track goes under and slams back
    if (grew && MILESTONES.includes(r.combo)) {
      Sound.dropMusic(r.combo >= 50 ? 1.3 : 1);
      slowmo = Math.max(slowmo, 0.45); // the picture stretches with the sound
    }
    const el = $('combo-num');
    el.textContent = r.combo;
    el.classList.toggle('hot', r.combo >= 20);
    el.classList.remove('pop', 'glitch');
    void el.offsetWidth;
    el.classList.add('pop');
    // every tenth link of the streak, not every hit — see the keyframes
    if (grew && r.combo && r.combo % 10 === 0) el.classList.add('glitch');
  }
  // execute counter: hits left until the guaranteed one-shot
  const execKey = r.implants.berserk ? String(r.execHits % Game.EXEC_EVERY) : 'off';
  if (execKey !== hudExec) {
    hudExec = execKey;
    const el = $('hud-exec');
    if (execKey === 'off') el.classList.add('hidden');
    else {
      el.classList.remove('hidden');
      $('exec-count').textContent = `${execKey}/${Game.EXEC_EVERY}`;
      el.classList.toggle('ready', Number(execKey) === Game.EXEC_EVERY - 1);
    }
  }
  // endless counts total waves; a skipped-wave run is marked as out of contention
  $('hud-act').textContent = (r.endless
    ? F('ВОЛНА {n} · ∞', 'WAVE {n} · ∞', { n: Game.endlessWave(r) })
    : F('АКТ {a} · ВОЛНА {w}/{t}', 'ACT {a} · WAVE {w}/{t}', { a: romanAct(r.act), w: r.wave, t: Game.WAVES_PER_ACT }))
    + (r.cheated ? L(' · БЕЗ ЗАЧЁТА', ' · NO RECORD') : '');
  // a mutated wave keeps a lit badge up the whole wave — the banner is easy to miss
  const mutKey = (r.mutator || '') + '|' + Game.getLang();
  if (mutKey !== hudMut) {
    hudMut = mutKey;
    // A mutator can change the weather over a location without touching what the
    // location IS — that is the whole point of the air/weather split in scene.js.
    // Fog gets haze in the air on top of its own veil; anything else hands the
    // weather back to whatever the scene declares.
    Scene.setWeather(Game.mutHas(r, 'fog') ? ['fog'] : null);
    const el = $('hud-mut');
    const mut = r.mutator ? Game.MUTATORS.find(x => x.id === r.mutator) : null;
    el.classList.toggle('hidden', !mut);
    if (mut) {
      $('hud-mut-icon').textContent = mut.icon;
      $('hud-mut-name').textContent = Game.T(mut, 'name');
    }
  }
  $('hud-score').textContent = Game.fmt(r.score);
  $('hud-credits').textContent = `${Game.fmt(r.credits)} ㋕`;
}

// ---------- Run control ----------
let paused = false;
let slowmo = 0;    // seconds of slow-mo left (end of wave)
let hitstop = 0;   // seconds of frame freeze (hit juiciness)
let warpCur = 1;   // smoothed fast-forward multiplier for the empty approach
let dtSmooth = 1 / 60; // rolling frame time — see the note where the warp is applied
let choiceDelay = 0; // delay before the choice screen — let the effects play out
let simAcc = 0;    // real time accumulated toward the next fixed step

// ---------- Replay viewer ----------
// Watching a run: `state` is swapped for a reconstruction and the recording's
// presses are fed into it tick by tick; the real state waits in `replay.saved`.
// Input is the ghost's, the camera and effects are live, the save file is
// fenced off (replayActive in core.js).
let replay = null; // { rec, i: action cursor, saved: real state, savedScreen, lastAct }

function canReplay() {
  return !!(state.run && state.run.rec && state.run.rec.T !== undefined && !state.run.cheated);
}

// Watch a recording: one's own last run (no args) or a board row's ghost
// (rec + the player's name for the badge). The viewer returns to whatever
// screen it was opened from.
function startReplayView(rec, label) {
  if (replay) return;
  if (!rec) {
    if (!canReplay()) return;
    rec = state.run.rec;
  }
  Sound.ensure();
  if (cinema) endCinema(); // a lingering travelling shot must not eat the viewer's keys
  replay = {
    rec, i: 0, saved: state, lastAct: 1, label, speed: 1,
    savedScreen: activeScreen || 'menu',
  };
  replayActive = true;
  state = Game.replayState(rec);
  paused = false;
  slowmo = hitstop = choiceDelay = simAcc = 0;
  warpCur = 1;
  hudCombo = -1; hudArmor = ''; hudMut = '';
  hideScreens();
  $('menu-fade').style.opacity = '0'; // a mid-dip kaleidoscope must not veil the ghost
  $('hud').classList.remove('hidden');
  $('replay-badge').classList.remove('hidden');
  $('replay-exit').classList.remove('hidden');
  replayBadge();
  Scene.setAct(Game.ACTS[0].id);
  Sound.startMusic(Game.ACTS[0].id);
  showActBanner(1);
}

function replayBadge() {
  $('replay-badge-note').textContent =
    (replay.label ? replay.label + ' · ' : '') + replay.speed + '×';
}

// SPACE cycles the playback speed — on top of the built-in empty-approach
// fast-forward, so 4× mostly compresses the fighting itself.
function cycleReplaySpeed() {
  replay.speed = replay.speed >= 4 ? 1 : replay.speed * 2;
  replayBadge();
}

function endReplayView() {
  if (!replay) return;
  state = replay.saved;
  const scr = replay.savedScreen;
  replay = null;
  replayActive = false;
  paused = false; // the viewer may end while its pause screen is up
  $('replay-badge').classList.add('hidden');
  $('replay-exit').classList.add('hidden');
  $('hud').classList.add('hidden');
  Sound.stopMusic();
  hudCombo = -1; hudArmor = ''; hudMut = '';
  if (state.run) Scene.setAct(actData(state.run.act).id);
  showScreen(scr);
}

// Feed the actions due at this tick — every strike result goes through the
// live effect handler, so the ghost's blade slashes and sings like a real one.
// A choice the feed just answered may have crossed an act border — move the
// scenery with the ghost.
function replayFeedStep() {
  replay.i = Game.replayFeed(state, replay.rec, replay.i, handleStrikeEvent);
  const act = state.run && state.run.act;
  if (act && act !== replay.lastAct) {
    replay.lastAct = act;
    Scene.setAct(actData(act).id);
    Sound.startMusic(actData(act).id);
    showActBanner(act);
    showMutatorBanner(true);
  }
}

// The recording's seal: a quit run ends mid-air, a finished one on its death
// or victory frame — either way the viewer returns to the real screen.
function replayWatchEnd() {
  if (replay.ending) return;
  const done = state.phase === 'dead' || state.phase === 'victory' ||
    (state.run && state.run.ticks >= replay.rec.T);
  if (done) {
    replay.ending = true;
    setTimeout(endReplayView, state.phase === 'combat' ? 400 : 1600);
  }
}

function startGame(mode) {
  Sound.ensure();
  if (mode === 'daily') Game.startDaily(state, todayStr());
  paused = false;
  slowmo = hitstop = choiceDelay = 0;
  warpCur = 1;
  hudCombo = -1; hudArmor = ''; hudMut = '';
  if (mode !== 'daily') Game.startRun(state, mode);
  menuBgStop(); // the postcard reel ends — the road itself begins
  Scene.setAct(Game.ACTS[0].id);
  Sound.startMusic(Game.ACTS[0].id);
  hideScreens();
  $('hud').classList.remove('hidden');
  saveState();
  // the campaign opens on a travelling shot (combat is frozen under it — see
  // the cinema guard in the loop); endless and the daily cut straight to the
  // fight — the daily's banner names its rules instead of the act
  if (mode === 'endless') showActBanner(1);
  else if (mode === 'daily') {
    popBanner(L('СИД ДНЯ', 'DAILY SEED'), todayStr(),
      L('общий сид · прошивка отключена · лучший результат — на доску',
        'shared seed · firmware offline · your best goes on the board'));
  } else startCinema(CINE_INTRO, () => showActBanner(1));
}

function quitToMenu() {
  // «выйти» during a replay leaves the VIEWER, not a run — the ghost's state
  // must never reach abandonRun or the boards
  if (replay) { endReplayView(); return; }
  // the quitting run is still offered to its board: snapshot it, let
  // abandonRun write the daily ledger, then submit against the fresh meta
  const quitRun = state.run;
  Game.abandonRun(state);
  if (quitRun) Board.submitQuiet({ ...state, run: quitRun, phase: 'dead' });
  Sound.stopMusic();
  paused = false;
  $('hud').classList.add('hidden');
  saveState();
  showScreen('menu');
}

// ---------- Cutscene between acts ----------
// The boss falls, the slow-mo beat lands — and instead of a menu the frame
// letterboxes: the ronin runs on through the old act's scenery while one line
// bridges the road to the next. Any input skips it. Endless mode never sees
// one: rhythm is king there, and the transitions repeat every few waves.
const CINE_LINES = { // keyed by the DESTINATION act id
  market: { ru: 'Глубже в квартал. Там, где торгуют копиями, оригинал проходит незамеченным.',
            en: 'Deeper into the ward. Where copies are traded, an original walks unseen.' },
  train:  { ru: 'Хребет города. Единственная дорога наверх — та, что городу не принадлежит.',
            en: 'The city\'s spine. The only road up is the one the city does not own.' },
  ship:   { ru: 'Магистраль обрывается у воды. Дальше — груз, который охраняет себя сам.',
            en: 'The line ends at the water. From here on — cargo that guards itself.' },
  server: { ru: 'Грузовой терминал аркологии. Сталь — в трюме, копии — в стойках.',
            en: 'The arcology freight terminal. Steel in the hold, copies in the racks.' },
  garden: { ru: 'Последний подъём. Наверху — единственное живое место во всём здании.',
            en: 'The last climb. At the top — the one living place in the whole building.' },
};

// The run's own bookends, same voice as the bridges between acts.
const CINE_INTRO = { ru: 'Ночная смена начинается. Контракт активен, маршрут — наверх.',
                     en: 'The night shift begins. The contract is live; the route leads up.' };
const CINE_FINAL = { ru: 'Вершина. Смена окончена — и впервые никто не выгружает клинок обратно.',
                     en: 'The summit. The shift is over — and for once no one uploads the blade back.' };

let cinema = null;   // { timers, onEnd } while the travelling shot is running
let cineArrived = 0; // act whose scenery+banner a transition shot already presented

// One line over a letterboxed travelling shot, then onEnd does the editing —
// what the cut lands on differs between the intro, a transition and the finale.
function startCinema(line, onEnd) {
  if (!state.run || cinema) return;
  // the frozen-clock harness (visual.sh) must see the arrival, never the shot:
  // a timer-driven overlay under a frozen clock is a race in a screenshot
  if (typeof Debug !== 'undefined' && Debug.frozen) { if (onEnd) onEnd(); return; }
  cinema = { timers: [], onEnd };
  document.body.classList.add('cinema');
  $('cine').classList.add('on');
  Scene.setCinema(true);
  const el = $('cine-text');
  el.textContent = '';
  const text = line ? Game.T({ sub: line.ru, en: { sub: line.en } }, 'sub') : '';
  let i = 0;
  const typer = setInterval(() => {
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(typer);
  }, 26);
  cinema.timers.push(typer);
  cinema.timers.push(setTimeout(endCinema, 1100 + text.length * 26 + 1500));
}

function endCinema(runEnd = true) {
  if (!cinema) return;
  for (const tm of cinema.timers) { clearTimeout(tm); clearInterval(tm); }
  const onEnd = cinema.onEnd;
  cinema = null;
  $('cine').classList.remove('on');
  document.body.classList.remove('cinema');
  Scene.setCinema(false);
  if (runEnd && onEnd) onEnd();
}

// Debug panel: preview any travelling shot in place. The line plays over the
// CURRENT scenery and the cut edits nothing — switch acts separately to see a
// bridge over its own road. Restarting an active preview tears the old one
// down without letting it edit.
function debugCinema(kind) {
  if (!state.run) return;
  endCinema(false);
  const line = kind === 'intro' ? CINE_INTRO
             : kind === 'final' ? CINE_FINAL
             : CINE_LINES[kind];
  startCinema(line, null);
}

// A transition shot: ends on the cut into the next act's scenery.
function startActCinema(next) {
  if (state.phase !== 'choice') return;
  startCinema(CINE_LINES[Game.ACTS[next - 1].id], () => {
    // the cut itself: a dark blink while the world is swapped underneath
    Scene.flash('#05040c', 0.9);
    const id = Game.ACTS[next - 1].id;
    Scene.setAct(id);
    Sound.startMusic(id);
    showActBanner(next);
    cineArrived = next;
    if (state.phase === 'choice') showScreen('choice');
  });
}

function choose(i) {
  const r = state.run;
  const prevAct = r.act;
  if (!Game.chooseImplant(state, i)) return;
  Sound.sfx('choice');
  hudArmor = ''; // max armor may have changed
  hideScreens();
  const actChanged = r.act !== prevAct;
  if (actChanged) {
    if (cineArrived === r.act) {
      cineArrived = 0; // the cutscene already swapped the scenery and ran the banner
    } else {
      Scene.setAct(actData(r.act).id);
      Sound.startMusic(actData(r.act).id);
      showActBanner(r.act);
    }
  }
  showMutatorBanner(actChanged); // after the act banner, if both fire
  saveState();
}

// ---------- Handling logic events ----------
const ACCENT = () => '#26d6ff';

// Combat sound pitch climbs one rung of the track's Phrygian ladder per hit and
// drops on reset. Snapping to the scale (rather than sliding continuously up an
// octave) is what turns a streak from "the pitch is rising" into an actual run
// of notes in the key the music is already playing.
const comboPitch = () => {
  const c = state.run ? state.run.combo : 0;
  // the debug panel can drop back to the old continuous slide for an A/B
  return Sound.flags().quantPitch ? Sound.rung(c) : Math.pow(2, Math.min(c, 30) / 30);
};

// The melodic voice that rides on top of the impact sfx. vol scales with the
// weight of the event, so kills sing over plain hits.
const comboNote = (vol) => Sound.note(state.run ? state.run.combo : 0, vol);

// Where a sound sits in the stereo field. Enemies approach along a line from
// their side toward the hero at centre, so distance narrows the image: a far
// strike is out at the edge, a close one has almost arrived on top of you.
// Never returns 0 for a real side — the cue must stay unmistakable.
const sidePan = (side, dist) => {
  if (!side) return 0;
  const far = Math.min((dist === undefined ? 400 : dist) / 500, 1);
  return side * (0.5 + 0.5 * far);
};

// Streak lengths that earn a drop. Sparse on purpose: the effect is loud, and
// it stops reading as a reward the moment it becomes routine.
const MILESTONES = [10, 25, 50, 100];

// Combo thresholds where the arrangement gains a layer — see Sound.setTier.
const TIER_AT = [6, 16, 30];
const comboTier = (c) => TIER_AT.filter((t) => c >= t).length;

function handleStrikeEvent(ev) {
  switch (ev.type) {
    case 'kill':
      Scene.slash(ev.side, true);
      Scene.corpse(ev.side, ev.dist, ev.enemy);
      if (ev.exec) {
        // execute: a fatter burst, longer hitstop, its own tag
        Scene.burst(ev.side, ev.dist, '#ffffff', 26);
        Scene.floatText(L('КАЗНЬ', 'EXECUTED'), ev.side, ev.dist, '#ff2d4e');
        Scene.flash('#ffffff', 0.1);
        Sound.sfx('exec', 1, sidePan(ev.side, ev.dist), ev.enemy);
        hitstop = Math.max(hitstop, 0.09);
      } else {
        Scene.burst(ev.side, ev.dist, ev.chain ? '#baff4d' : '#ff5c9e');
        Sound.sfx('kill', comboPitch(), sidePan(ev.side, ev.dist), ev.enemy);
        comboNote(0.15);
        hitstop = Math.max(hitstop, 0.045);
      }
      if (ev.vamp) {
        Scene.floatText(L('+БРОНЯ', '+ARMOR'), ev.side, 60, '#2dff8f');
        Sound.sfx('vamp');
      }
      break;
    case 'hit':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, Math.min(ev.dist, Game.range(state)), '#ffd98a', 6);
      Sound.sfx('slash', comboPitch(), sidePan(ev.side, ev.dist), ev.enemy);
      comboNote(0.09); // a plain hit sings quieter than a kill
      break;
    case 'reflect':
      Scene.slash(ev.side, true);
      Scene.floatText(L('ОТБИТО!', 'DEFLECTED!'), ev.side, ev.dist, '#26d6ff');
      Sound.sfx('reflect', comboPitch(), sidePan(ev.side, ev.dist));
      comboNote(0.12);
      break;
    case 'parried':
      Scene.slash(ev.side, false);
      Scene.floatText(L('ПАРИРОВАНО', 'PARRIED'), ev.side, ev.dist, '#c9a2ff');
      Sound.sfx('parry', 1, sidePan(ev.side, ev.dist));
      Scene.flash('#c9a2ff', 0.1);
      // the riposte lands — the hurt event carries the shake and the red
      (ev.events || []).forEach(handleTickEvent);
      break;
    case 'blocked':
      Scene.slash(ev.side, true);
      Scene.floatText(L('БЛОК', 'BLOCKED'), ev.side, ev.dist, '#b4ff3d');
      Sound.sfx('block', 1, sidePan(ev.side, ev.dist));
      break;
    case 'phantomWhiff':
      // swung through a hologram — the swing catches nothing. Read as a miss, but
      // named, so the lesson lands: that one was a phantom, you should have held.
      Scene.slash(ev.side, false);
      Scene.phantomScatter(ev.side, ev.dist);
      Scene.floatText(L('ФАНТОМ', 'PHANTOM'), ev.side, ev.dist, '#7fd0ff');
      Sound.sfx('miss', 1, sidePan(ev.side, ev.dist));
      Sound.duckMusic();
      Scene.shake(6);
      Scene.flash('#3aa0ff', 0.12);
      break;
    case 'twinTouch':
      Scene.slash(ev.side, true);
      Sound.sfx('twintouch', 1, sidePan(ev.side, ev.dist));
      // the chord window is 0.12s — too short to read, so the call to action goes
      // on the side still waiting, not on the one just struck
      if (state.meta.stats.chords < Game.TEACH_CHORDS) {
        Scene.floatText(L('И ВТОРУЮ!', 'AND THE OTHER!'), -ev.side, ev.dist, '#ffd94d');
      }
      break;
    case 'twinKill':
      Scene.slash(ev.side, true);
      Scene.corpse(ev.side, ev.dist, 'twin');
      Scene.corpse(-ev.side, ev.dist, 'twin');
      Scene.burst(ev.side, ev.dist, '#ffd94d', 18);
      Scene.burst(-ev.side, ev.dist, '#ffd94d', 18);
      Scene.floatText(L('РЕЗОНАНС!', 'RESONANCE!'), ev.side, ev.dist, '#ffd94d');
      Sound.sfx('twinkill');
      hitstop = Math.max(hitstop, 0.07);
      break;
    case 'ghostMiss':
      // an execute stole the press's target: a light slash, no penalty, no drama
      Scene.slash(ev.side, false);
      break;
    case 'miss':
      Scene.slash(ev.side, false);
      Scene.floatText(L('ПРОМАХ', 'MISS'), ev.side, 80, '#ff5c7a');
      Sound.sfx('miss', 1, sidePan(ev.side, 120));
      Sound.duckMusic(); // the track drops out from under the failed swing
      Scene.shake(7);
      Scene.flash('#ff2d4e', 0.14);
      break;
    case 'stunned':
      Sound.sfx('stunned');
      break;
    case 'qteStart':
      // the opening strike IS the chain's first link — present it as a full hit
      Sound.sfx('qtestart');
      Sound.sfx('slash');
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, Math.min(ev.dist, Game.range(state)), '#ffffff', 5);
      // a lying link leaves the corrupt-magenta trace, never the fencer's green
      if (ev.nextSide !== undefined) Scene.burst(ev.nextSide, ev.dist, ev.nextGlitch ? '#ff4de0' : '#ff3b3b', 5);
      hitstop = Math.max(hitstop, 0.02);
      break;
    case 'qteHit':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, Math.min(ev.dist, Game.range(state)), '#ffffff', 5);
      // an arrival trace on the new side — shows where the Warden leapt
      if (ev.nextSide !== undefined) Scene.burst(ev.nextSide, ev.dist, ev.nextGlitch ? '#ff4de0' : '#ff3b3b', 5);
      Sound.sfx('slash', Sound.rung(ev.idx), sidePan(ev.side, ev.dist)); // the chain climbs the ladder, a rung per link
      hitstop = Math.max(hitstop, 0.02);
      break;
    case 'qteFail':
      Scene.floatText(L('СБОЙ', 'FAULT'), ev.side, 120, '#ff5c7a');
      // fell for a lying link — name the rule instead of just punishing
      if (ev.glitch && state.meta.stats.glitchHits < Game.TEACH_GLITCH) {
        Scene.floatText(L('ЗВЕНО ЛГАЛО — БЕЙ НАОБОРОТ', 'THE LINK LIED — STRIKE OPPOSITE'),
          -ev.side, 210, '#ff4de0');
      }
      (ev.events || []).forEach(handleTickEvent);
      break;
    case 'bossStagger':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, ev.dist, '#ff3b3b', 22);
      Scene.floatText(L('ФАЗА ПРОБИТА', 'PHASE DOWN'), ev.side, ev.dist, '#ffb42d');
      Sound.sfx('kill');
      Scene.shake(8);
      hitstop = Math.max(hitstop, 0.08);
      if (ev.summoned) {
        // Core Shogun called in backup
        Scene.floatText(L('ПОДМОГА!', 'BACKUP!'), -ev.side, 200, '#ff3b3b');
        Sound.sfx('windup');
      }
      break;
    case 'bossDead':
      Scene.slash(ev.side, true);
      Scene.corpse(ev.side, ev.dist, 'boss', 1.8);
      Scene.burst(ev.side, ev.dist, '#ffffff', 40);
      Scene.burst(ev.side, ev.dist, '#ff3b3b', 20);
      Scene.floatText(L('СТРАЖ ПАЛ', 'WARDEN DOWN'), ev.side, ev.dist, '#ffb42d');
      Scene.flash('#ffffff', 0.25);
      Sound.sfx('bossdead');
      slowmo = Math.max(slowmo, 1.0);
      hitstop = Math.max(hitstop, 0.1);
      break;
  }
  // the strike also deflected shuriken(s) in the zone
  if (ev.reflected && (ev.type === 'kill' || ev.type === 'hit')) {
    Scene.floatText(L('ОТБИТО!', 'DEFLECTED!'), ev.side, 110, '#26d6ff');
    Sound.sfx('reflect', comboPitch(), sidePan(ev.side, ev.dist));
  }
  if (ev.chained) {
    Scene.bolt(ev.side, Math.min(ev.dist, Game.range(state)), ev.chained.dist);
    Sound.sfx('chain');
    handleStrikeEvent(ev.chained);
  }
  // the slash reached an open fencer behind the target
  if (ev.opened) {
    Scene.floatText(L('ОКНО!', 'OPENING!'), ev.opened.side, ev.opened.dist, '#2dff8f');
    handleStrikeEvent(ev.opened);
  }
}

const BOSS_NAMES = [
  { name: 'РОНИН-БЕТА',   en: { name: 'RONIN BETA' } },
  { name: 'СТРАЖ МАГЛЕВА', en: { name: 'MAGLEV WARDEN' } },
  { name: 'АДМИН-ОНИ',    en: { name: 'ADMIN ONI' } },
  { name: 'СЁГУН ЯДРА',   en: { name: 'CORE SHOGUN' } },
  { name: 'ОРУЖЕЙНИК',    en: { name: 'THE ARMORER' } },
  { name: 'ДВОЙНИК',      en: { name: 'THE DOUBLE' } },
];

// each Warden's banner hints at his signature trick
const BOSS_SUBS = [
  { sub: 'ударь его в зоне и повтори последовательность',
    en: { sub: 'strike him in the zone and repeat the sequence' } },
  { sub: 'порывы ветра бросают его вперёд',
    en: { sub: 'wind gusts hurl him forward' } },
  { sub: 'глитч-стрелки лгут — бей в противоположную сторону',
    en: { sub: 'glitch arrows lie — strike the opposite way' } },
  { sub: 'пробитая фаза призывает подмогу',
    en: { sub: 'a broken phase summons backup' } },
  { sub: 'отбей его клинок обратно — сгорит звено его цепи',
    en: { sub: 'deflect his blade back — it burns a link of his chain' } },
  { sub: 'настоящий один — вспышка на входе в зону выдаст полого',
    en: { sub: 'only one is real — the flash at the zone edge exposes the hollow' } },
];

// How to actually kill each Warden — shown on pause while he is on the field.
// First line is the shared QTE rule, the rest is the kind's signature trick.
const BOSS_TIPS = [
  { lines: ['Дождись, пока страж войдёт в <b>зону удара</b>, и ударь — это первое звено цепочки.',
            'Дальше повторяй показанные стрелки <b>в темпе</b>: каждая ошибка или промедление стоит брони, и он отходит на новый заход.',
            'Ронин-бета не мухлюет: стрелки честные, время на нажатие самое щедрое во всей игре. Это тренировка ритма.'],
    en: { lines: ['Wait until the Warden steps <b>into your strike zone</b> and hit him — that is the chain’s first link.',
                  'Then repeat the shown arrows <b>in tempo</b>: every mistake or delay costs armor, and he backs off for a fresh approach.',
                  'Ronin Beta plays fair: the arrows are honest and the press window is the most generous in the game. This is your rhythm drill.'] } },
  { lines: ['Правило то же: удар в зоне, затем повтор стрелок в темпе.',
            '<b>Порывы ветра</b> швыряют его вперёд втрое быстрее — он входит в зону раньше привычного ритма. Не считай секунды, смотри на метки зоны.',
            'Ветер достаёт и до цепочки: на вой ветра полоса таймера <b>подсвечивает кусок, который сейчас оторвёт</b>. Услышал вой — дожимай остаток быстрее.',
            'Ветер может пронести его через <b>первую четверть зоны</b> на полной скорости — лишь глубже порыв гаснет, и на последнее нажатие он не приходит: время на ответ будет, но запаса — нет.'],
    en: { lines: ['Same rule: strike him in the zone, then repeat the arrows in tempo.',
                  '<b>Wind gusts</b> hurl him forward at triple speed — he enters the zone ahead of the usual rhythm. Do not count seconds, watch the zone markers.',
                  'The wind reaches the chain too: on the howl the timer bar <b>lights up the slice it is about to tear off</b>. Hear the howl — finish the rest faster.',
                  'The wind can carry him through the <b>first quarter of the zone</b> at full speed — only deeper does the gust die, and it never lands on the final press: you will get time to answer, but no slack.'] } },
  { lines: ['Правило то же: удар в зоне, затем повтор стрелок в темпе.',
            'Часть стрелок — <b>глитч-звенья</b>: малиновые, с дугой разворота над ними. Такая стрелка лжёт — бей в <b>противоположную</b> сторону.',
            'Белые стрелки — как есть. Читай каждое звено отдельно, а не всю цепочку разом.'],
    en: { lines: ['Same rule: strike him in the zone, then repeat the arrows in tempo.',
                  'Some arrows are <b>glitch links</b>: magenta, with a reversal arc drawn over them. Such an arrow lies — strike the <b>opposite</b> side.',
                  'White arrows mean what they show. Read each link on its own instead of memorising the whole chain.'] } },
  { lines: ['Правило то же: удар в зоне, затем повтор стрелок в темпе.',
            'У сёгуна <b>три фазы</b>, и каждая пробитая <b>призывает подмогу</b> — после стагтера на поле появляются рядовые.',
            'Вычисти призванных до того, как он подойдёт снова: во время цепочки отвлечься на них уже не выйдет.'],
    en: { lines: ['Same rule: strike him in the zone, then repeat the arrows in tempo.',
                  'The Shogun has <b>three phases</b>, and every broken one <b>summons backup</b> — minions appear after each stagger.',
                  'Clear the summons before he closes again: once the chain starts you cannot break away to deal with them.'] } },
  { lines: ['Правило то же: удар в зоне, затем повтор стрелок в темпе.',
            'На подходе он <b>мечет сюрикены</b> — только издалека, весь полёт читается. Отбивай их обычным ударом в зоне.',
            '<b>Отбитый клинок летит обратно</b>: долетев до стража, он <b>сжигает звено</b> его следующей цепи — дуэль становится короче.',
            'Но он учится: <b>каждый следующий клинок он отбивает обратно на раз больше</b> — первый не отбивает вовсе, второй раз, третий два. Ралли кончается, только когда клинок долетает, и каждый возврат чуть быстрее.',
            'С первым нажатием дуэли он отзывает клинки из воздуха: во время цепочки безответного урона не бывает — и в цепи он не парирует.'],
    en: { lines: ['Same rule: strike him in the zone, then repeat the arrows in tempo.',
                  'On approach he <b>hurls shurikens</b> — only from deep field, the whole flight is readable. Deflect them with an ordinary in-zone strike.',
                  'A <b>deflected blade flies back</b>: reaching the Warden, it <b>burns a link</b> out of his next chain — the duel gets shorter.',
                  'But he learns: <b>each successive blade he bats back one more time</b> — the first never, the second once, the third twice. The rally ends only when a blade lands, and every return is a shade faster.',
                  'At the duel’s first press he recalls the blades still in the air: no unanswerable damage during the chain — and mid-chain he never parries.'] } },
  { lines: ['Правило то же: удар в зоне, затем повтор стрелок в темпе.',
            'Он идёт <b>двумя зеркальными силуэтами</b> — настоящий один, и весь подход они неотличимы. <b>Вспышка бьёт в момент входа в зону</b>: полый мерцает и дрожит, как сломанная проекция. Мимики научили виду, фехтовальщик — темпу.',
            'После вспышки удар по полому — <b>вивф</b>: стан и сброс комбо, как за фантома мимика. Читай быстро, бей плотного.',
            'Каждый новый заход он <b>заново бросает монетку</b>, с какой стороны идти настоящему — прошлое чтение не переносится.'],
    en: { lines: ['Same rule: strike him in the zone, then repeat the arrows in tempo.',
                  'He walks in as <b>two mirrored silhouettes</b> — one is real, and they are indistinguishable for the whole approach. <b>The flash hits the moment he crosses into the zone</b>: the hollow one flickers and shivers like a broken projection. The mimics taught the look, the fencer taught the tempo.',
                  'After the flash, striking the hollow one is a <b>whiff</b>: a stun and a wiped combo, same as a mimic phantom. Read fast, strike the solid one.',
                  'Every fresh approach he <b>flips the coin again</b> on which side the real one takes — a past read does not carry over.'] } },
];

// Fallback advice when nothing special is going on — the fundamentals.
const BASE_TIPS = {
  lines: ['Бей только когда враг <b>в зоне досягаемости</b> — метки на земле. Удар по воздуху даёт стан, сбрасывает комбо и <b>разгоняет толпу</b> на время стана — промах отнимает и время, и дистанцию.',
          '<b>Панк</b> после удара перелетает на другую сторону, <b>щитовик</b> держит три удара, <b>метатель</b> кидает сюрикен — его можно отбить тем же ударом.',
          'Элита ломает ритм: <b>фехтовальщик</b> — только в зелёное окно, <b>адаптант</b> — два удара подряд с одной стороны, <b>близнецы</b> — обе кнопки одновременно.'],
  en: { lines: ['Strike only when an enemy is <b>within reach</b> — the ground markers show it. Swinging at air stuns you, resets the combo and <b>speeds the crowd up</b> for as long as the stun — a miss costs both time and ground.',
                'A <b>punk</b> flips to the other side after a hit, a <b>shielder</b> takes three, a <b>thrower</b> hurls a shuriken — the same strike deflects it.',
                'Elites break the rhythm: the <b>fencer</b> only in the green window, the <b>adapter</b> two hits from one side, the <b>twins</b> both buttons at once.'] },
};

// Pause is the only calm moment in a run — spend it telling the player what
// they are actually up against: the Warden's trick, the wave's mutator, or the basics.
function renderPauseBrief() {
  const r = state.run;
  const el = $('pause-brief');
  el.className = '';
  if (!r) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  let tag, title, src, reward = '';
  if (r.boss) {
    const kind = r.boss.kind || Game.bossKind(r.act);
    el.classList.add('boss');
    tag = L('СТРАЖ НА ПОЛЕ · КАК УБИТЬ', 'WARDEN ON THE FIELD · HOW TO KILL');
    title = Game.T(BOSS_NAMES[kind - 1], 'name');
    src = BOSS_TIPS[kind - 1];
  } else if (r.mutator) {
    const mut = Game.MUTATORS.find(x => x.id === r.mutator);
    el.classList.add('mut');
    tag = L('МУТАТОР ВОЛНЫ', 'WAVE MUTATOR');
    title = `${mut.icon} ${Game.T(mut, 'name')}`;
    src = { lines: [Game.T(mut, 'desc'), Game.T(mut, 'tip')] };
    const pct = Math.round((Game.mutCredit(r) - 1) * 100);
    reward = F('награда за убийства на этой волне +{n}%', 'kills on this wave pay +{n}% credits', { n: pct });
  } else {
    tag = L('ОБЫЧНАЯ ВОЛНА', 'PLAIN WAVE');
    title = L('ОСНОВЫ', 'FUNDAMENTALS');
    src = BASE_TIPS;
  }

  const lines = Game.T(src, 'lines');
  const tainted = r.cheated
    ? L('в этом забеге пропускалась волна — рекорды, трофеи и кредиты не начисляются',
        'a wave was skipped in this run — no records, trophies or credits are banked')
    : '';
  el.innerHTML =
    `<div class="brief-tag">${tag}</div>` +
    `<div class="brief-title">${title}</div>` +
    lines.map(t => `<div class="brief-text">${t}</div>`).join('') +
    (reward ? `<div class="brief-reward">▲ ${reward}</div>` : '') +
    (tainted ? `<div class="brief-tainted">✱ ${tainted}</div>` : '');
}

let lastHurtSide = 1; // side of the last hit taken — for the hero death animation

function handleTickEvent(ev) {
  switch (ev.type) {
    case 'windup':
      Sound.sfx('windup', 1, sidePan(ev.side, ev.dist));
      break;
    case 'stance':
      Sound.sfx('stance', 1, sidePan(ev.side, ev.dist));
      break;
    case 'fencerOpen':
      Sound.sfx('open', 1, sidePan(ev.side, ev.dist));
      break;
    case 'fencerMiss':
      Sound.sfx('throw', 1, sidePan(ev.side, ev.dist)); // the whoosh of a lunge into thin air
      break;
    case 'mimicReveal':
      // the tell: a short click as its true nature surfaces. The phantom gets a
      // colder cue and, while the rule is new, a word — hold, don't strike.
      Sound.sfx(ev.phantom ? 'stance' : 'open', 1, sidePan(ev.side, ev.dist));
      if (ev.phantom) {
        Scene.floatText(L('ПРИЗРАК?', 'PHANTOM?'), ev.side, ev.dist, '#7fd0ff');
        if ((state.meta.stats.mimicReads || 0) < Game.TEACH_MIMIC) {
          Scene.floatText(L('ПОЛЫЙ — НЕ БЕЙ', 'HOLLOW — DON\'T STRIKE'), ev.side, ev.dist + 60, '#7fd0ff');
        }
      }
      break;
    case 'phantomFade':
      // read correctly and left alone — no penalty, and it keeps the combo going, so
      // it sings with the chain like a landed hit (the pitch rises with the combo it
      // just bumped)
      Sound.sfx('reflect', comboPitch(), sidePan(ev.side, 90));
      comboNote(0.1);
      Scene.phantomScatter(ev.side, 40);
      break;
    case 'twinKnock':
      // the lone press resolved as a miss — read it as one
      Sound.sfx('miss', 1, sidePan(ev.side || 1, 120));
      Sound.duckMusic();
      Scene.shake(7);
      Scene.flash('#ff2d4e', 0.14);
      Scene.floatText(L('ПРОМАХ', 'MISS'), ev.side || 1, 80, '#ff5c7a');
      // say WHY, not just that it failed
      if (state.meta.stats.chords < Game.TEACH_CHORDS) {
        Scene.floatText(L('НУЖНЫ ОБЕ СРАЗУ', 'BOTH AT ONCE'), 1, 150, '#ffd94d');
      }
      break;
    case 'throw':
      Sound.sfx('throw', 1, sidePan(ev.side, ev.dist));
      break;
    case 'bossThrow':
      Sound.sfx('throw', 1, sidePan(ev.side, ev.dist));
      break;
    case 'bossBurn':
      // the deflected blade lands: a link of the next chain burns out
      Scene.burst(ev.side, ev.dist, '#ffb42d');
      Scene.floatText(L('ЗВЕНО СОЖЖЕНО', 'LINK BURNED'), ev.side, ev.dist, '#ffb42d');
      Sound.sfx('exec', 1, sidePan(ev.side, ev.dist));
      break;
    case 'bossParry':
      // the Armorer bats the return straight back — the rally grows
      Sound.sfx('parry', 1, sidePan(ev.side, ev.dist));
      Scene.burst(ev.side, ev.dist, '#ffc266');
      Scene.floatText(L('ОТБИТО', 'PARRIED'), ev.side, ev.dist, '#ffc266');
      Scene.shake(3);
      break;
    case 'bossReveal':
      // the same cold cue the mimics taught: the hollow silhouette clicks open
      Sound.sfx('stance', 1, sidePan(-ev.side, ev.dist));
      Scene.floatText(L('ПРИЗРАК?', 'PHANTOM?'), -ev.side, ev.dist, '#7fd0ff');
      break;
    case 'bossPhantomMiss':
      // swung at the projection — the mimic whiff at Warden scale
      Scene.slash(ev.side, false);
      Scene.phantomScatter(ev.side, ev.dist);
      Scene.floatText(L('ФАНТОМ', 'PHANTOM'), ev.side, ev.dist, '#7fd0ff');
      Sound.sfx('miss', 1, sidePan(ev.side, ev.dist));
      Sound.duckMusic();
      Scene.shake(6);
      Scene.flash('#3aa0ff', 0.12);
      break;
    case 'bossSpawn': {
      const kind = ev.kind || Game.bossKind(ev.act);
      // the banner teaches the trick while the Warden is new and speaks once he
      // is not — the pause screen keeps the full mechanical briefing either way
      const known = (ev.seen || 0) > Game.BOSS_VOICE_AFTER;
      popBanner(L('СТРАЖ АКТА', 'ACT WARDEN'),
        Game.T(BOSS_NAMES[kind - 1], 'name'),
        Game.T((known ? BOSS_VOICE : BOSS_SUBS)[kind - 1], 'sub'));
      Sound.sfx('boss');
      Scene.shake(6);
      break;
    }
    case 'bossGustWarn':
      // the howl: the only warning before the chain timer is compressed
      Sound.sfx('gust', 1, sidePan(ev.side, 150));
      Scene.floatText(L('ВЕТЕР', 'WIND'), ev.side, 150, '#bfefff');
      Scene.shake(3);
      break;
    case 'bossGust':
      // Maglev Warden: the wind hurls him forward, or claws at the chain itself
      Scene.gust(ev.side, ev.dist);
      Sound.sfx('gust', 1, sidePan(ev.side, ev.dist));
      Scene.shake(ev.at === 'qte' ? 9 : 5);
      break;
    case 'qteFail':
      Scene.floatText(L('СБОЙ', 'FAULT'), ev.side, 120, '#ff5c7a');
      break;
    case 'reflectKill':
      Scene.burst(ev.side, ev.dist, '#26d6ff');
      Scene.corpse(ev.side, ev.dist, 'thrower');
      Sound.sfx('kill', 1, sidePan(ev.side, ev.dist), 'thrower');
      break;
    case 'vamp':
      Scene.floatText(L('+БРОНЯ', '+ARMOR'), 1, 60, '#2dff8f');
      Sound.sfx('vamp');
      break;
    case 'guardSave':
      // the Emergency Capacitor fired: the red of the wound is already on
      // screen — the green discharge lands on top and names the rescue
      Scene.floatText(L('КОНДЕНСАТОР!', 'CAPACITOR!'), ev.side || 1, 130, '#2dff8f');
      Scene.flash('#2dff8f', 0.22);
      Scene.shake(10);
      Sound.sfx('vamp');
      hitstop = Math.max(hitstop, 0.09);
      break;
    case 'hurt':
      lastHurtSide = ev.side || 1;
      Scene.heroHurt();
      Scene.flash('#ff2d4e', 0.35);
      Scene.shake(14);
      Sound.sfx('hurt', 1, sidePan(ev.side, 60));
      Sound.duckMusic(0.04, 0.3, 0.5); // taking a hit collapses it harder and longer
      // contact death: an enemy that reached the hero falls too
      if (ev.enemy) Scene.corpse(ev.side, ev.dist || 40, ev.enemy);
      break;
    case 'waveSkipped':
      popBanner(L('ВОЛНА ПРОПУЩЕНА', 'WAVE SKIPPED'),
        L('ПРИЗРАК', 'GHOST'),
        L('забег больше не идёт в зачёт', 'this run no longer counts'));
      Sound.sfx('stance');
      break;
    case 'waveClear':
    case 'actClear':
      slowmo = 0.9;
      choiceDelay = 1.0;
      Sound.sfx('wave');
      // deep endless with the implant pool exhausted: the next wave started
      // by itself inside the tick — handle the act/wave transition here
      if (ev.auto && state.run) {
        hudArmor = '';
        if (ev.type === 'actClear') {
          Scene.setAct(actData(state.run.act).id);
          Sound.startMusic(actData(state.run.act).id);
          showActBanner(state.run.act);
        }
        showMutatorBanner(ev.type === 'actClear');
        saveState();
      } else if (ev.type === 'actClear' && state.run && !state.run.endless &&
                 !replay && state.run.act < Game.ACTS.length) {
        // campaign transition: the cinema opens the choice screen itself,
        // after the slow-mo beat has landed (a replay moves scenery by itself)
        choiceDelay = 0;
        setTimeout(() => startActCinema(state.run.act + 1), 900);
      }
      break;
    case 'dead':
      Sound.stopMusic();
      Sound.sfx('dead');
      // the killing blow already fired a full-strength hurt flash a moment ago;
      // overwrite it with a weak one so the death animation is not hidden behind
      // a red screen for its first quarter second
      Scene.flash('#ff2d4e', 0.12);
      Scene.heroDie(lastHurtSide);
      Scene.shake(18);
      choiceDelay = 1.6; // let the death animation finish before the screen
      saveState();
      break;
    case 'victory':
      Sound.stopMusic();
      Sound.sfx('victory');
      slowmo = 1.2;
      // the last travelling shot instead of a jump cut to the stats — the
      // slow-mo beat lands first, then the summit line (not for a ghost:
      // its viewer returns to the real screen on its own)
      choiceDelay = 0;
      if (!replay) {
        setTimeout(() => startCinema(CINE_FINAL, () => {
          $('hud').classList.add('hidden');
          showScreen('victory');
        }), 1400);
      }
      saveState();
      break;
  }
}

function doStrike(side) {
  if (paused || replay || state.phase !== 'combat') return; // a ghost fights alone
  Sound.ensure();
  handleStrikeEvent(Game.strike(state, side));
  updateHud();
}

// The hidden skip (Ctrl+Shift+K). Deliberately undocumented in the help screen,
// but never silent: the banner and the HUD say the run stopped counting.
function doSkipWave() {
  if (paused || replay || state.phase !== 'combat') return;
  Sound.ensure();
  const ev = Game.skipWave(state);
  if (!ev) return;
  for (const x of ev) handleTickEvent(x);
  updateHud();
  saveState();
}

// ---------- Input ----------
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const code = e.code;
  if (activeScreen === 'choice' && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(code)) {
    choose(Number(code.slice(-1)) - 1);
    return;
  }
  if (activeScreen === 'choice' && code === 'KeyR') { rerollChoice(); return; }
  if (cinema) { endCinema(); return; } // any key skips the travelling shot
  if (replay && code === 'Space') { cycleReplaySpeed(); return; }
  if (code === 'Escape') {
    // in the viewer Esc is a pause, not an exit — the pause screen's «выйти»
    // (quitToMenu, guarded there) is what leaves the ghost
    if (replay) {
      const hint = document.querySelector('[data-i18n="pauseHint"]');
      if (!paused) {
        paused = true;
        if (hint) hint.textContent = L('реплей на паузе · ESC — продолжить · «выйти» вернёт назад',
                                       'replay paused · ESC to resume · "quit" returns you back');
        showScreen('pause');
      } else {
        paused = false;
        if (hint) hint.textContent = L(...STR.pauseHint);
        hideScreens();
      }
      return;
    }
    if (state.phase === 'combat' && !paused) {
      paused = true;
      const hint = document.querySelector('[data-i18n="pauseHint"]');
      if (hint) hint.textContent = L(...STR.pauseHint); // a replay pause may have left its text
      showScreen('pause');
    }
    else if (paused) { paused = false; hideScreens(); }
    else if (activeScreen === 'shop' || activeScreen === 'help') showScreen(shopReturnTo);
    else if (activeScreen === 'ach' || activeScreen === 'log' || activeScreen === 'board') showScreen('menu');
    return;
  }
  // hidden wave skip — the run stops counting toward records from here on
  if (code === 'KeyK' && e.ctrlKey && e.shiftKey) {
    e.preventDefault();
    doSkipWave();
    return;
  }
  if (code === 'ArrowLeft' || code === 'KeyA') doStrike(-1);
  else if (code === 'ArrowRight' || code === 'KeyD') doStrike(1);
  else if ((code === 'Enter' || code === 'Space') && activeScreen === 'menu') startGame();
});

$('scene').addEventListener('pointerdown', e => {
  // On touch the tap IS the strike — never let the browser turn it into a
  // scroll/zoom gesture (pairs with touch-action: none on #scene).
  if (e.pointerType !== 'mouse') e.preventDefault();
  if (cinema) { endCinema(); return; } // a tap skips the travelling shot
  if (state.phase !== 'combat' || paused) return;
  // A mouse has two buttons, so use them directly: left button strikes left, right
  // strikes right, wherever the cursor is. Touch and pen have no such split, so they
  // keep the screen-half mapping (tap the side you mean).
  let side;
  if (e.pointerType === 'mouse') {
    if (e.button === 0) side = -1;
    else if (e.button === 2) side = 1;
    else return; // middle / extra buttons do nothing
  } else {
    side = e.clientX < window.innerWidth / 2 ? -1 : 1;
  }
  doStrike(side);
});
// The right button is a strike, not a menu request — suppress the context menu over
// the play field so the right-click lands as an attack instead of a popup.
$('scene').addEventListener('contextmenu', e => e.preventDefault());

// Screen buttons
$('btn-start').addEventListener('click', () => startGame());
$('btn-endless').addEventListener('click', () => {
  if (state.meta.stats.wins >= 1) startGame('endless');
});
$('btn-daily').addEventListener('click', () => startGame('daily'));
$('btn-board').addEventListener('click', () => showScreen('board'));
$('btn-board-back').addEventListener('click', () => showScreen('menu'));
$('btn-reroll').addEventListener('click', rerollChoice);
$('btn-replay-dead').addEventListener('click', () => startReplayView());
$('btn-replay-victory').addEventListener('click', () => startReplayView());
// the badge is the speed control, the ✕ leaves the ghost — phones have neither SPACE nor ESC
$('replay-badge').addEventListener('click', () => { if (replay) cycleReplaySpeed(); });
$('replay-exit').addEventListener('click', () => endReplayView());
$('replay-badge').addEventListener('pointerdown', e => e.stopPropagation());
$('replay-exit').addEventListener('pointerdown', e => e.stopPropagation());
for (const b of document.querySelectorAll('#board-tabs button')) {
  b.addEventListener('click', () => { boardTab = b.dataset.key; renderBoardScreen(); });
}
$('btn-retry').addEventListener('click', () => startGame(
  state.run && state.run.endless ? 'endless' : state.run && state.run.daily ? 'daily' : undefined));
$('btn-victory-retry').addEventListener('click', () => startGame());
$('btn-shop').addEventListener('click', () => { shopReturnTo = 'menu'; showScreen('shop'); });
$('btn-dead-shop').addEventListener('click', () => { shopReturnTo = 'dead'; showScreen('shop'); });
$('btn-shop-back').addEventListener('click', () => showScreen(shopReturnTo));

// ---------- Progress reset ----------
let resetArmed = false;
let resetTimer = null;

function disarmReset() {
  clearTimeout(resetTimer);
  resetArmed = false;
  const btn = $('btn-reset');
  if (!btn) return;
  btn.classList.remove('armed');
  btn.textContent = L(...STR.btnReset);
  $('reset-warn').classList.add('hidden');
}

function armReset() {
  resetArmed = true;
  const btn = $('btn-reset');
  btn.classList.add('armed');
  btn.textContent = L(...RESET_STR.arm);
  const warn = $('reset-warn');
  warn.textContent = L(...RESET_STR.warn);
  warn.classList.remove('hidden');
  // disarms itself: a click left forgotten on screen must not stay live
  clearTimeout(resetTimer);
  resetTimer = setTimeout(disarmReset, RESET_ARM_TIME);
}

$('btn-reset').addEventListener('click', () => {
  Sound.ensure();
  if (!resetArmed) { armReset(); Sound.sfx('ui'); return; }
  clearTimeout(resetTimer);
  resetArmed = false;
  Game.resetProgress(state);
  clearSave();      // drop the stored save, do not rewrite it
  hudCombo = -1; hudArmor = ''; hudMut = '';
  $('hud').classList.add('hidden');
  Sound.stopMusic();
  Sound.sfx('dead');
  shopReturnTo = 'menu'; // the dead screen we may have come from is gone now
  showScreen('menu');
  $('menu-stats').textContent = L(...RESET_STR.done);
});
$('btn-help').addEventListener('click', () => { shopReturnTo = 'menu'; showScreen('help'); });
$('btn-ach').addEventListener('click', () => showScreen('ach'));
$('btn-log').addEventListener('click', () => showScreen('log'));
$('btn-log-back').addEventListener('click', () => showScreen('menu'));
$('lang-select').addEventListener('change', e => {
  const next = e.target.value;
  Game.setLang(next);
  saveLang(next);
  Sound.sfx('ui');
  applyLang();
  if (activeScreen) showScreen(activeScreen); // re-render the current screen
});
// the dropdown must not feed the strike handler underneath it
$('lang-select').addEventListener('pointerdown', e => e.stopPropagation());
$('lang-select').addEventListener('keydown', e => e.stopPropagation());
$('btn-ach-back').addEventListener('click', () => showScreen('menu'));
$('btn-help-back').addEventListener('click', () => showScreen('menu'));
$('btn-dead-menu').addEventListener('click', () => { state.run = null; state.phase = 'menu'; showScreen('menu'); $('hud').classList.add('hidden'); });
$('btn-victory-menu').addEventListener('click', () => { state.run = null; state.phase = 'menu'; showScreen('menu'); $('hud').classList.add('hidden'); });
$('btn-resume').addEventListener('click', () => { paused = false; hideScreens(); });
$('btn-quit').addEventListener('click', quitToMenu);

// ---------- Achievements: periodic check and toasts ----------
let achTimer = 0;
const toastQueue = [];
let toastBusy = false;

function pumpToasts() {
  if (toastBusy || !toastQueue.length) return;
  toastBusy = true;
  const a = toastQueue.shift();
  const el = $('toast');
  // a journal fragment has no reward — it is announced, not awarded
  el.innerHTML = a.reward === undefined
    ? `📓 <b>${Game.T(a, 'name')}</b> · ${L('запись открыта', 'entry recovered')}`
    : `🏆 <b>${Game.T(a, 'name')}</b> · +${a.reward} ㋕`;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  Sound.sfx('buy');
  setTimeout(() => { el.classList.add('hidden'); toastBusy = false; pumpToasts(); }, 2700);
}

function checkAch(rawDt) {
  achTimer += rawDt;
  if (achTimer < 1) return;
  achTimer = 0;
  const fresh = Game.checkAchievements(state);
  const story = Game.checkLog(state);
  if (fresh.length || story.length) {
    toastQueue.push(...fresh, ...story);
    pumpToasts();
    saveState();
    if (activeScreen === 'menu') renderMenu(); // menu credits may have changed
  }
}

// ---------- Loop ----------
let lastT = 0;

function loop(t) {
  requestAnimationFrame(loop);
  const rawDt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  Debug.frame(rawDt); // before the pause bail-out: the readout stays live on pause
  if (paused) return;

  // hitstop and slow-mo slow the game, but not the screen timers
  let dt = rawDt;
  if (hitstop > 0) { hitstop -= rawDt; dt = 0; }
  if (slowmo > 0) { slowmo -= rawDt; dt *= 0.3; }

  // Empty-approach fast-forward: threats far — the world speeds up, near — normal.
  // Double smoothing against jolts: smoothstep over distance (soft edges of
  // acceleration and braking) + exponential over time (no frame-to-frame jumps).
  let warpTarget = 1;
  if (state.phase === 'combat' && slowmo <= 0 && hitstop <= 0 && !Debug.noWarp) {
    // threshold on time-to-contact: beyond 3.3s — full fast-forward, under 1.5s — normal
    const eta = Game.threatEta(state);
    const k = Math.min(1, Math.max(0, (eta - 1.5) / 1.8));
    warpTarget = 1 + 4.5 * k * k * (3 - 2 * k);
  }
  warpCur += (warpTarget - warpCur) * Math.min(1, rawDt / 0.12);
  if (Math.abs(warpCur - warpTarget) < 0.01) warpCur = warpTarget;
  // Vsync jitter of a millisecond or two is invisible at normal speed and very
  // visible multiplied by five and a half: the crowd advances a different amount
  // each frame and the approach shimmers. Drive the warped part of the step from
  // a rolling average instead of the raw measurement. It averages out to real
  // time, so nothing drifts, but the frame-to-frame variance goes away.
  dtSmooth += (rawDt - dtSmooth) * 0.12;
  if (slowmo <= 0) dt = warpCur > 1.01 ? dtSmooth * warpCur : dt * warpCur;

  dt = Debug.timeDt(dt); // debug panel time controls — a no-op while the panel is idle
  if (replay) dt *= replay.speed; // the viewer's own fast-forward

  // Integrate in EXACT quanta of Game.STEP through an accumulator.
  //
  // Fixed steps are what make replays possible: the whole timeline becomes an
  // integer tick counter, and a recorded press lands on the same tick on every
  // machine. The fast-forward, slow-mo and hitstop only change how many steps
  // play per real frame — never what happens inside one. The sub-step
  // remainder carries to the next frame, so nothing drifts. (This also keeps
  // the old anti-lurch property: an 88ms warped frame is six whole steps, not
  // one torn jump.)
  //
  // under a cutscene the simulation holds its breath: the intro plays over a
  // combat-phase run, and enemies advancing behind the letterbox would be theft
  if (cinema) simAcc = 0; else simAcc = Math.min(simAcc + dt, 0.35);
  while (simAcc >= Game.STEP) {
    if (replay) replayFeedStep(); // the ghost's presses land before the step
    for (const ev of Game.tick(state, Game.STEP)) handleTickEvent(ev);
    simAcc -= Game.STEP;
    // an event in that step put time under its own control — hand it over
    // (the remainder is discarded, exactly as the old slicer did)
    if (hitstop > 0 || slowmo > 0) { simAcc = 0; break; }
  }
  if (replay) replayWatchEnd();

  // deferred screen after a wave/run ends — let the slow-mo play out
  // (a replay never opens screens: its choices are fed from the recording and
  // its ending returns the viewer to the real one)
  if (choiceDelay > 0 && !replay) {
    choiceDelay -= rawDt;
    if (choiceDelay <= 0) {
      if (state.phase === 'choice') showScreen('choice');
      else if (state.phase === 'dead' || state.phase === 'victory') {
        $('hud').classList.add('hidden');
        showScreen(state.phase);
      }
    }
  }

  if (state.phase === 'combat') updateHud();
  if (!replayActive) checkAch(rawDt);
  Scene.render(state, dt);
}

// ---------- Startup ----------
applyLang();
$('game-version').textContent = 'v' + Game.VERSION;
showScreen('menu');

// splash: melts once sprites are ready (min 0.7s shown, max 2.5s)
const splashStart = performance.now();
(function hideSplash() {
  const elapsed = performance.now() - splashStart;
  if ((Sprites.ready() && elapsed > 700) || elapsed > 2500) {
    $('splash').classList.add('gone');
    setTimeout(() => $('splash').remove(), 600);
  } else setTimeout(hideSplash, 100);
})();
requestAnimationFrame(loop);

// PWA: offline shell + install prompt. Only over http(s) — file:// (the smoke
// test, the single-file dist a friend got) has no service workers, and a hosted
// dist without sw.js just fails the fetch — both land in the silent catch.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
