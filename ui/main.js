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
  wayLabel:   ['ПУТЬ', 'WAY'],
  wayPlain:   ['ОБЫЧНЫЙ', 'PLAIN'],
  wayStance:  ['⛩ ТРИ СТОЙКИ', '⛩ THREE STANCES'],
  btnMonthly: ['🌙 СИД МЕСЯЦА', '🌙 MONTHLY SEED'],
  btnDaily:   ['🗓 СИД ДНЯ', '🗓 DAILY SEED'],
  btnBoard:   ['🏅 ДОСКИ', '🏅 BOARDS'],
  boardTitle: ['ДОСКИ ПОЧЁТА', 'LEADERBOARDS'],
  boardSub:   ['сид дня · месяц · кампания · бесконечность', 'daily seed · monthly · campaign · endless'],
  tabDaily:   ['СИД ДНЯ', 'DAILY'],
  tabMonthly: ['МЕСЯЦ', 'MONTHLY'],
  tabCampaign: ['КАМПАНИЯ', 'CAMPAIGN'],
  tabMaster:  ['ТРИ СТОЙКИ', 'THREE STANCES'],
  tabEndless: ['БЕСКОНЕЧНОСТЬ', 'ENDLESS'],
  btnShop:    ['🔩 УЛУЧШЕНИЯ', '🔩 UPGRADES'],
  btnAch:     ['🏆 ТРОФЕИ', '🏆 TROPHIES'],
  btnLog:     ['📓 ЖУРНАЛ', '📓 JOURNAL'],
  logTitle:   ['ЖУРНАЛ', 'JOURNAL'],
  logSub:     ['что удалось вытащить из выгрузок', 'what the uploads managed to keep'],
  btnHelp:    ['❔ КАК ИГРАТЬ', '❔ HOW TO PLAY'],
  choiceSub:  ['выбери имплант', 'choose an implant'],
  choiceHint: ['цифры, клик или геймпад', 'number keys, click, or gamepad'],
  deadTitle:  ['СИСТЕМА ОТКАЗАЛА', 'SYSTEM FAILURE'],
  deadSub:    ['клинок вернётся. всегда возвращается', 'the blade returns. it always does'],
  btnRetry:   ['⟳ ЕЩЁ ЗАБЕГ', '⟳ RUN AGAIN'],
  btnReplay:  ['▶ РЕПЛЕЙ', '▶ REPLAY'],
  btnMenu:    ['МЕНЮ', 'MENU'],
  winTitle:   ['ПУТЬ ПРОЙДЕН', 'THE PATH IS WALKED'],
  winSub:     ['рассвет над аркологией. город свободен', 'dawn over the arcology. the city is free'],
  btnNewPath: ['⟳ НОВЫЙ ПУТЬ', '⟳ NEW PATH'],
  shopTitle:  ['УЛУЧШЕНИЯ', 'UPGRADES'],
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
  btnSettings: ['⚙ НАСТРОЙКИ', '⚙ SETTINGS'],
  btnExit:    ['🚪 ВЫХОД', '🚪 EXIT'],
  settingsTitle: ['НАСТРОЙКИ', 'SETTINGS'],
  setMusic:   ['МУЗЫКА', 'MUSIC'],
  setSfx:     ['ЗВУКИ', 'SOUND FX'],
  setGfx:     ['ГРАФИКА', 'GRAPHICS'],
  gfxAuto:    ['АВТО', 'AUTO'],
  gfxHigh:    ['ВЫСОКАЯ', 'HIGH'],
  gfxMed:     ['СРЕДНЯЯ', 'MEDIUM'],
  gfxLow:     ['НИЗКАЯ', 'LOW'],
  setGfxHint: ['авто само снижает качество, если кадры проседают',
               'auto lowers quality by itself when frames drop'],
  setCalm:    ['СПОКОЙНЫЙ РЕЖИМ', 'CALM MODE'],
  calmOn:     ['ВКЛ', 'ON'],
  calmOff:    ['ВЫКЛ', 'OFF'],
  setFps:     ['СЧЁТЧИК КАДРОВ', 'FPS COUNTER'],
  setFpsHint: ['цифра в углу для тех, кто следит за плавностью', 'a number in the corner, for those who watch the smoothness'],
  setCalmHint: ['без тряски камеры, вспышек и зерна; авто слушает системное «меньше движения»',
                'no camera shake, flashes or grain; auto follows the system’s "reduce motion"'],
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
  warn: ['кредиты, улучшения, трофеи и рекорды — безвозвратно',
         'credits, upgrades, trophies and records — permanently'],
  done: ['ПРОГРЕСС СТЁРТ', 'PROGRESS ERASED'],
};
const RESET_ARM_TIME = 4000; // ms the armed state lasts before it disarms itself

// The help page, paragraph by paragraph: each row is [ru, en], rendered
// through L() so overlay packs translate it per paragraph — a paragraph the
// pack misses falls back to English alone, not the whole page.
const HELP_PARAGRAPHS = [
  [`<b>← A</b> — удар влево · <b>D →</b> — удар вправо. Мышью: <b>ЛКМ</b> — влево, <b>ПКМ</b> — вправо. На сенсоре — тап по половине экрана. <b>Геймпад</b>: крестовина, бамперы, триггеры или стик — удары, <b>START</b> — пауза. <b>Удар в обе стороны</b> (для близнецов): <b>Enter</b> или <b>OK</b> на пульте ТВ, средняя кнопка мыши, <b>Y</b> на геймпаде, на сенсоре — тап двумя пальцами.`,
   `<b>← A</b> — strike left · <b>D →</b> — strike right. Mouse: <b>left button</b> — left, <b>right button</b> — right. On touch — tap the screen half. <b>Gamepad</b>: d-pad, bumpers, triggers or a stick flick — strikes, <b>START</b> — pause. <b>Both sides at once</b> (for twins): <b>Enter</b> or <b>OK</b> on a TV remote, the middle mouse button, <b>Y</b> on a gamepad, a two-finger tap on touch.`],
  [`Бей врага, только когда он <b>в зоне досягаемости</b> (метки на земле). Удар по воздуху — короткий <b>стан</b>, сброс комбо, и пока ты висишь, <b>толпа ускоряется</b>.`,
   `Hit an enemy only when it is <b>within reach</b> (ground markers). Swinging at air — a short <b>stun</b>, a combo reset, and while you hang the <b>crowd speeds up</b>.`],
  [`<b>Дрон</b> умирает с одного удара. <b>Трейсер</b> после удара перемахивает на другую сторону — добей там. <b>Щитовик</b> держит три удара. <b>Метатель</b> кидает сюрикен — отбей его обратно.`,
   `A <b>drone</b> dies in one hit. A <b>tracer</b> vaults to the other side after a hit — finish him there. A <b>shielder</b> takes three hits. A <b>thrower</b> hurls a shuriken — deflect it back.`],
  [`<b>«Путь трёх стоек»</b> — сложный путь. Со второго акта у клинка открываются три <b>стойки</b> — переключай их цифрами 1·2·3, W/S или пробелом (на геймпаде A, на телефоне — полоса по центру экрана). <b>КЛИНОК</b> режет точно и несёт вперёд, <b>ВИХРЬ</b> бьёт всех в зоне разом, но платит одним звеном серии, <b>ПРОБОЙ</b> вкладывает двойной вес в одного. Каждого из толпы берут только две стойки из трёх: дрона не достаёт пробой, трейсер ныряет под вихрь, щитовика не берёт клинок. Неверная стойка не убивает — она просто отталкивает, и ты теряешь темп.`,
   `The <b>Way of Three Stances</b> is the harder road. From the second act on the blade holds three <b>stances</b> — pick them with 1·2·3, cycle with W/S or Space (A on a pad, the middle strip on a phone). <b>BLADE</b> cuts precisely and carries you forward, <b>SWEEP</b> takes everyone in reach at once but pays a single link of the streak, <b>PIERCE</b> puts double weight into one body. Each of the crowd answers to only two of the three: the thrust goes past a drone, a tracer ducks the arc, a plate turns the cut aside. The wrong stance does not kill — it only shoves, and the tempo is what you lose.`],
  [`Элита ломает ритм: <b>фехтовальщик</b> парирует — жди зелёного окна; <b>маятник</b> дважды перелетает дорогу — останови его третьим ударом; <b>близнецы</b> умирают только от одновременного удара обеих кнопок.`,
   `Elites break the rhythm: the <b>fencer</b> parries — wait for the green window; the <b>pendulum</b> crosses the road twice — stop him with the third hit; the <b>twins</b> die only to both buttons at once.`],
  [`<b>Мимик</b> выглядит как дрон, но у зоны вспыхивает истинная суть: <b>плотный</b> — настоящий, бей; <b>полый и холодный</b> — призрак, <b>не бей</b> (сам растает, а удар сквозь него — промах). Проверяет концентрацию, а не привычку.`,
   `A <b>mimic</b> looks like a drone but flashes its true nature near the zone: <b>solid</b> — real, strike it; <b>hollow and cold</b> — a phantom, <b>don't strike</b> (it fades on its own, and a swing through it whiffs). It tests concentration, not habit.`],
  [`В конце акта выходит <b>Страж</b>: ударь его в зоне и повтори последовательность стрелок в темпе. Ошибка или промедление — минус броня, и он зайдёт снова. У каждого стража свой трюк: порывы ветра, <b>глитч-стрелки</b> (бей в противоположную сторону), призыв подмоги.`,
   `A <b>Warden</b> ends each act: strike him in the zone and repeat the arrow sequence in tempo. A mistake or delay costs armor, and he comes again. Each Warden has a signature trick: wind gusts, <b>glitch arrows</b> (strike the opposite way), summoned backup.`],
  [`Со второго акта волна может прийти с <b>мутатором</b> — особым правилом (шквал, туман, дождь стали, блиц). Убийства на такой волне платят больше кредитов.`,
   `From act two a wave may arrive with a <b>mutator</b> — a special rule (squall, fog, steel rain, blitz). Kills on such a wave pay extra credits.`],
  [`После каждой волны — выбор одного из трёх <b>имплантов</b>: они живут ровно один забег. После смерти кредиты остаются — трать их на <b>улучшения</b> — постоянные, которые переживают смерть. Первая победа открывает <b>бесконечность</b>: акты идут по кругу, рекорд — число волн.`,
   `After each wave — pick one of three <b>implants</b>: they live for exactly one run. Credits survive death — spend them on <b>upgrades</b>, the permanent ones that outlive it. The first victory unlocks <b>endless</b>: acts cycle, the record is your wave count.`],
  [`<b>Сид дня</b> — забег на общем для всех сиде: волны у всех одинаковые. <b>Улучшения</b> (постоянные, из магазина) на этот забег отключены — доска сравнивает руки, а не кошельки; обычные импланты после волн работают как всегда. Попыток сколько угодно — на доску дня идёт лучший результат. <b>Сид месяца</b> — то же самое, но бесконечный забег на общем сиде всего календарного месяца; рекорд — волны.`,
   `The <b>daily seed</b> — a run on a seed shared by everyone: identical waves. <b>Upgrades</b> (the shop's permanent ones) are offline for this run — the board compares hands, not wallets; ordinary implants after waves work as always. Attempts are unlimited — the day's board keeps your best result. The <b>monthly seed</b> is the same contract as an endless run on one seed shared for the calendar month; the record is waves.`],
  [`<b>Esc</b> — пауза. На паузе показывают разбор текущей обстановки: правило мутатора волны, а во время боя со стражем — как именно его убивать.`,
   `<b>Esc</b> — pause. The pause screen breaks down the current situation: the wave mutator's rule, and during a Warden fight, exactly how to kill him.`],
];

function applyLang() {
  const lang = Game.getLang();
  const en = lang !== 'ru'; // for the binary assets (logo, help page) every pack language reads the English side
  document.documentElement.lang = lang;
  document.title = en ? 'Cyber Ronin' : 'Кибер-ронин';
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const s = STR[el.dataset.i18nTitle];
    if (!s) continue;
    el.title = L(...s); // the tooltip and the pad cursor
    // ...and the caption under the glyph, where there is one. The strings carry
    // their own emoji ("🔩 УЛУЧШЕНИЯ") — the button already shows it, so the
    // caption takes what follows the first space.
    const cap = el.querySelector('.cap');
    if (cap) cap.textContent = L(...s).replace(/^\S+\s+/, '');
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const pair = STR[el.dataset.i18n];
    if (pair) iconText(el, L(...pair)); // L consults the overlay pack, falls back to English
  }
  const logo = en ? 'CYBER RONIN' : 'КИБЕР-РОНИН';
  for (const el of document.querySelectorAll('#game-title .logo-half')) el.textContent = logo;
  $('help-body').innerHTML = HELP_PARAGRAPHS.map(pr => `<p>${L(...pr)}</p>`).join('');
  $('lang-select').value = lang;
}

// The strings keep their emoji (every language pack carries them, and they
// still read as plain text anywhere a string ends up outside the DOM). On
// screen a leading glyph that has an icon in #icon-sprite is drawn as that icon
// instead — the neon line of the UI set, the same on every platform.
const ICON_OF = { '⚔': 'start', '🗓': 'daily', '🌙': 'moon', '♾': 'endless', '🔩': 'shop', '🏆': 'ach',
  '📓': 'log', '🏅': 'board', '❔': 'help', '⚙': 'settings', '🚪': 'exit', '🎲': 'dice' };
const iconSvg = id => `<svg class="ic"><use href="#i-${id}"/></svg>`;
// A list item's icon: its own symbol (i-<group>-<id>) when the sprite has one,
// the emoji it carries in game.js otherwise — a new item without art still shows.
const itemIcon = (group, it) => document.getElementById(`i-${group}-${it.id}`) ? iconSvg(`${group}-${it.id}`) : it.icon;
function iconText(el, str) {
  const m = /^(\S+)\s+([\s\S]*)$/.exec(str);
  const id = m && ICON_OF[m[1].replace(/\uFE0F/g, '')];
  if (!id) { el.textContent = str; return; }
  el.textContent = '';
  el.insertAdjacentHTML('afterbegin', iconSvg(id));
  el.append(m[2]);
}

// ---------- Screens ----------
const SCREENS = ['menu', 'choice', 'dead', 'victory', 'shop', 'help', 'pause', 'ach', 'log', 'board', 'settings'];
let activeScreen = 'menu';
let shopReturnTo = 'menu'; // which screen the implant shop was opened from

function showScreen(name) {
  activeScreen = name;
  padFocusSet(null); // the pad cursor never survives a screen change
  for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
  $('overlay').style.display = name ? 'block' : 'none';
  if (name === 'menu') { renderMenu(); menuBgStart(); startMenuMusic(); }
  if (name === 'shop') renderShop();
  if (name === 'ach') renderAch();
  if (name === 'board') renderBoardScreen();
  if (name === 'choice') renderChoice();
  if (name === 'pause') renderPauseBrief();
  if (name === 'log') renderLog();
  if (name === 'settings') renderSettings();
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
  padFocusSet(null);
  $('overlay').style.display = 'none';
}

// The UTC calendar date — the daily's key. UTC by decision (2026-07-30): the
// board is shared, so the whole world flips to the new seed at the same
// instant — nobody's evening hands them tomorrow's seed early.
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// The monthly seed's key — same UTC decision as the daily, for the same reason.
function monthStr() {
  return new Date().toISOString().slice(0, 7);
}

// Archive stepping for the boards screen: days for the daily, months for the monthly.
function shiftDay(dateStr, delta) {
  return new Date(Date.parse(dateStr + 'T12:00:00Z') + delta * 864e5).toISOString().slice(0, 10);
}
function shiftMonth(mStr, delta) {
  const [y, m] = mStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 15)).toISOString().slice(0, 7);
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
  // the monthly seed: an endless run on a seed shared for the calendar month —
  // same unlock as endless, same upgrade freeze as the daily
  const bm = $('btn-monthly');
  bm.disabled = !unlocked;
  bm.classList.toggle('locked', !unlocked);
  bm.title = unlocked
    ? L('общий бесконечный сид на весь месяц, улучшения отключены — рекорд в волнах',
        'one shared endless seed for the whole month, upgrades offline — the record is waves')
    : L('открывается после победы во всех шести актах', 'unlocks after clearing all six acts');
  // the daily: retries are free, the board keeps the day's best
  const daily = state.meta[Game.dailySlot(state, Game.wayHard(state))];
  const played = !!(daily && daily.date === todayStr() && daily.done);
  $('btn-daily').title =
    L('общий сид, улучшения отключены — на доску идёт лучший результат дня',
      'a shared seed, upgrades offline — the board keeps the day’s best');
  // the board button exists only while the online piece is configured
  $('btn-board').classList.toggle('hidden', !Board.enabled());
  // The upgrades shelf lights up only when there is something on it you can
  // actually afford right now — a rare, earned signal rather than a permanent
  // badge. A row of quiet icons was being walked past; this is the one of them
  // that has news often enough to be worth saying out loud.
  const canBuy = Game.META.some(m =>
    Game.metaLvl(state, m.id) < m.cap &&
    !(m.way === 'stance' && !Game.wayHard(state)) &&
    state.meta.credits >= Game.metaCost(state, m));
  $('btn-shop').classList.toggle('has-offer', canBuy);
  // the champion's frame: today's №1 on the board of the way you are holding
  Board.champ($('menu-champ'), Board.wayKey(todayStr(), Game.wayHard(state)), () => startGame('daily'));
  renderWay();
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
  // the month's deepest dive, while the ledger still points at the current month
  const monthly = state.meta.monthly;
  const monthlyLine = monthly && monthly.month === monthStr() && monthly.done
    ? '<br>' + F('сид месяца: {n} волн', 'monthly seed: {n} waves',
        { n: (monthly.act - 1) * Game.WAVES_PER_ACT + monthly.wave })
    : '';
  $('menu-stats').innerHTML = st.runs
    ? F('забегов: {r} · побед: {w} · убийств: {k}', 'runs: {r} · wins: {w} · kills: {k}', { r: st.runs, w: st.wins, k: Game.fmt(st.totalKills) }) + '<br>' +
      F('рекорд: {s} · лучшее комбо: {c}', 'best score: {s} · best combo: {c}', { s: Game.fmt(st.bestScore), c: st.bestCombo }) + endlessLine + dailyLine + monthlyLine
    : L('враги идут с двух сторон. у тебя две кнопки. этого достаточно',
        'enemies come from both sides. you have two buttons. that is enough');
}

// ---------- The boards screen ----------
// Three boards behind three tabs; the daily tab always means TODAY's date.
let boardTab = 'daily';
let boardBack = 0; // archive steps behind today: days on the daily tab, months on the monthly

// How deep the archive walker goes. The worker serves any past board; the cap
// only keeps the ‹ button from walking into the empty pre-launch void forever.
const BOARD_BACK_MAX = { daily: 90, monthly: 24 };

function renderBoardScreen() {
  const archival = boardTab === 'daily' || boardTab === 'monthly';
  const key = boardTab === 'daily' ? shiftDay(todayStr(), -boardBack)
    : boardTab === 'monthly' ? shiftMonth(monthStr(), -boardBack)
    : boardTab;
  for (const b of document.querySelectorAll('#board-tabs button')) {
    b.classList.toggle('primary', b.dataset.key === boardTab);
  }
  // the archive walker lives only under the dated tabs
  $('board-nav').classList.toggle('hidden', !archival);
  if (archival) {
    $('board-nav-label').textContent = key;
    $('board-next').disabled = boardBack === 0;
    $('board-prev').disabled = boardBack >= BOARD_BACK_MAX[boardTab];
  }
  Board.view($('menu-board'), Board.wayKey(key, Game.wayHard(state)));
}

function renderShop() {
  disarmReset(); // reopening the screen never leaves the wipe armed
  $('shop-credits').textContent = `${Game.fmt(state.meta.credits)} ㋕`;
  const list = $('shop-list');
  list.innerHTML = '';
  for (const m of Game.META) {
    const lvl = Game.metaLvl(state, m.id);
    // A way's own upgrade stays on the shelf either way — greyed out and
    // saying why, rather than vanishing: a shop that hides its stock teaches
    // nothing, and a player who never sees the line never learns it exists.
    const offWay = m.way === 'stance' && !Game.wayHard(state);
    const cost = Game.metaCost(state, m);
    const maxed = lvl >= m.cap;
    const row = document.createElement('div');
    row.className = 'shop-row' + (offWay ? ' off-way' : '');
    const note = offWay
      ? `<div class="way-note">${L('только на пути трёх стоек', 'sold on the way of three stances only')}</div>`
      : '';
    row.innerHTML =
      `<div class="icon">${itemIcon('mt', m)}</div>` +
      `<div class="body"><div class="name">${Game.T(m, 'name')}</div><div class="desc">${Game.T(m, 'desc')}</div>${note}</div>` +
      `<div class="lvl">${'▮'.repeat(lvl)}${'▯'.repeat(m.cap - lvl)}</div>` +
      `<button class="buy${maxed ? ' maxed' : ''}" ${maxed || offWay || state.meta.credits < cost ? 'disabled' : ''}>` +
      `${maxed ? L('МАКС', 'MAX') : offWay ? '⛩' : Game.fmt(cost) + ' ㋕'}</button>`;
    if (offWay) row.querySelector('.buy').title = L('переключи путь в меню, чтобы купить',
      'switch the way in the menu to buy this');
    if (!maxed && !offWay) {
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
  renderBlades(list);
}

// The equipped palette, straight from meta to the renderer. 'ion' (core:
// null) hands the brush back to the act.
function applyBlade() {
  const b = Game.bladeById(state.meta.blade);
  Scene.setBlade(b.core ? b : null);
  Sprites.retint(b.core || null); // the sprite's own steel takes the color too
}

// The blade rack under the firmware: palettes are bought once and worn — the
// swatch is the icon, the equipped one says so instead of selling itself.
function renderBlades(list) {
  const head = document.createElement('div');
  head.className = 'shop-head';
  head.textContent = L('ЦВЕТ КЛИНКА', 'BLADE COLOR');
  list.appendChild(head);
  for (const b of Game.BLADES) {
    const owned = !b.cost || !!state.meta.blades[b.id];
    const worn = state.meta.blade === b.id;
    const row = document.createElement('div');
    row.className = 'shop-row';
    const sw = b.core
      ? `<span class="blade-swatch" style="background:${b.core};box-shadow:0 0 8px ${b.glow}"></span>`
      : `<span class="blade-swatch blade-ion"></span>`;
    const desc = b.core
      ? L('след, ореол и клинок — в этот цвет', 'the arc, the halo and the edge — in this color')
      : L('цвет акта ведёт клинок, как всегда', 'the act paints the blade, as it always has');
    row.innerHTML =
      `<div class="icon">${sw}</div>` +
      `<div class="body"><div class="name">${Game.T(b, 'name')}</div><div class="desc">${desc}</div></div>` +
      `<button class="buy${worn ? ' maxed' : ''}" ${worn || (!owned && state.meta.credits < b.cost) ? 'disabled' : ''}>` +
      `${worn ? L('НАДЕТ', 'WORN') : owned ? L('НАДЕТЬ', 'WEAR') : Game.fmt(b.cost) + ' ㋕'}</button>`;
    if (!worn) {
      row.querySelector('.buy').addEventListener('click', () => {
        const ok = owned ? Game.setBlade(state, b.id) : Game.buyBlade(state, b.id);
        if (ok) {
          Sound.ensure(); Sound.sfx('buy');
          applyBlade();
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
      `<div class="icon">${itemIcon('ac', a)}</div>` +
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
      ? `<div class="icon">${itemIcon('lg', e)}</div>` +
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
  padSel = -1; // fresh cards, no pad cursor until the pad asks for one
  (r.offers || []).forEach((id, i) => {
    const im = Game.IMPLANTS.find(x => x.id === id);
    const owned = r.implants[id] || 0;
    const card = document.createElement('div');
    card.className = 'implant-card';
    card.innerHTML =
      `<span class="icon">${itemIcon('im', im)}</span>` +
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
  if (left > 0) iconText(rb, F('🎲 ПЕРЕСОБРАТЬ · {n} (R)', '🎲 REROLL · {n} (R)', { n: left }));
}

function rerollChoice() {
  if (Game.rerollOffers(state)) {
    Sound.sfx('buy');
    renderChoice();
  }
}

// The tally: numbers on the run-end screens reel up from zero, row after row,
// with a soft click per step — the arcade habit that makes a payout FELT
// instead of merely displayed. Purely presentational: the DOM already holds
// the final strings, the reel only animates the first number in each cell and
// lands on the exact original text.
let tallyRaf = 0;
function animateTally(elId) {
  cancelAnimationFrame(tallyRaf);
  const NUM = /\d[\d\s]*\d|\d/; // a formatted number: digits with group spaces, ends on a digit
  const jobs = [];
  [...$(elId).querySelectorAll('.v')].forEach((c, i) => {
    const final = c.textContent;
    const m = NUM.exec(final);
    if (!m) return;
    const post = final.slice(m.index + m[0].length);
    if (post.startsWith('-')) return; // a date, not a score — never reel the calendar
    const target = Number(m[0].replace(/\D/g, ''));
    if (!Number.isFinite(target) || target <= 0) return;
    const jb = { c, final, pre: final.slice(0, m.index), post, target,
                 at: 0.15 + i * 0.12, dur: 0.5 };
    c.textContent = jb.pre + '0' + jb.post;
    jobs.push(jb);
  });
  if (!jobs.length) return;
  const t0 = performance.now();
  let lastTick = -1;
  const step = (now) => {
    const t = (now - t0) / 1000;
    let live = false;
    for (const jb of jobs) {
      const k = (t - jb.at) / jb.dur;
      if (k >= 1) { jb.c.textContent = jb.final; continue; }
      live = true;
      if (k < 0) continue; // this row's turn has not come yet
      const e = 1 - Math.pow(1 - k, 3); // fast start, soft landing
      jb.c.textContent = jb.pre + Game.fmt(Math.round(jb.target * e)) + jb.post;
    }
    // the reel's voice: a quiet click every few steps, pitch climbing with time
    if (live && t - lastTick > 0.05) { lastTick = t; Sound.sfx('tally', 1 + t * 0.5); }
    if (live) tallyRaf = requestAnimationFrame(step);
    else for (const jb of jobs) jb.c.textContent = jb.final; // land exactly on the source text
  };
  tallyRaf = requestAnimationFrame(step);
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
  animateTally(elId);
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

// The menu's ambient set: the same engine playing the postcard cut — started
// once, not restarted on every wander back from the shop or the boards.
function startMenuMusic() {
  if (Sound.playingAct() === 'menu') return;
  Sound.startMusic('menu'); // silently a no-op until the first gesture unlocks audio
  Sound.setMenuAct(Game.ACTS[menuBgIdx].id); // the set opens in the postcard's key
}

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
        Sound.setMenuAct(Game.ACTS[menuBgIdx].id); // the music modulates with the view
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

// Стойки: имя, цвет и то, кого эта грамматика берёт. Порядок классов совпадает
// с порядком точек в HUD — дрон, панк, щитовик.
const STANCE_STR = {
  blade:  ['КЛИНОК', 'BLADE'],
  sweep:  ['ВИХРЬ', 'SWEEP'],
  pierce: ['ПРОБОЙ', 'PIERCE'],
};
// The stance palette lives in scene.js (STANCE_HUE): the canvas paints halos,
// seals and chain digits with it, so the chips must read the same source —
// a second copy of the hexes here once waited to drift on the first retune.
const STANCE_COLOR = Scene.STANCE_HUE;
const STANCE_CLASSES = ['drone', 'punk', 'shield'];

function doStance(idx) {
  if (paused || replay || state.phase !== 'combat') return;
  Sound.ensure();
  const ev = Game.setStance(state, idx);
  if (ev.type !== 'stance') return; // cooling down, or already held — no sound, no lie
  Sound.sfx('stance' + (idx + 1));
  Pad.impact(0.2, 25);
  Scene.stanceFlash(STANCE_COLOR[ev.stance]);
  renderStance();
}

// The ring is the simulation's business: it knows which grammars this run has
// earned and steps over the rest. Counting the index here left W and S dead the
// moment the next stance in line happened to be locked.
function doStanceCycle(dir) {
  if (paused || replay || state.phase !== 'combat') return;
  Sound.ensure();
  const ev = Game.cycleStance(state, dir);
  if (ev.type !== 'stance') return;
  Sound.sfx('stance' + (ev.idx + 1));
  Pad.impact(0.2, 25);
  Scene.stanceFlash(STANCE_COLOR[ev.stance]);
  renderStance();
}

// The chips are built once and then only re-lit: they are the legend, the
// keypad hint and — on a phone — the buttons, so they live for the whole run.
function buildStanceChips() {
  const box = $('hud-stance');
  box.innerHTML = '';
  Game.STANCES.forEach((st, i) => {
    const chip = document.createElement('div');
    chip.className = 'stance-chip';
    chip.style.setProperty('--chip', STANCE_COLOR[st]);
    box.appendChild(chip);
    chip.innerHTML = `<span class="key">${i + 1}</span><span class="nm"></span>` +
      `<span class="dots">${STANCE_CLASSES.map(() => '<i></i>').join('')}</span>`;
    // a tap on a chip must never double as a strike on that half of the screen
    chip.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); doStance(i); });
  });
  renderStance();
}

// The act that hands each grammar over — for the lock's own explanation.
const STANCE_OPENS = [0, Game.STANCE_ACT, Game.PIERCE_ACT];

function renderStance() {
  const cur = state.run ? state.run.stance : 'blade';
  const box = $('hud-stance');
  // The chips belong to the harder way, not to the act that finishes teaching
  // it: on the stance road the first act now shows the vocabulary from the
  // first wave — the held grammar lit, the two still closed dimmed and saying
  // which act opens them. It cannot be switched there (only the blade is
  // unlocked, so setStance and the ring both refuse), and that is the point:
  // the primer act shows the shape of the road without handing over its rules.
  const on = !!(state.run && state.run.hard);
  box.classList.toggle('hidden', !on);
  if (!on) return;
  if (box.childElementCount !== Game.STANCES.length) { buildStanceChips(); return; }
  const every = Game.MOMENTUM_EVERY[Game.metaLvl(state, 'mmomentum')] || 0;
  const charged = every > 0 && state.run && (state.run.sameStance + 1) % every === 0;
  Game.STANCES.forEach((st, i) => {
    const chip = box.children[i];
    const open = Game.stanceUnlocked(state.run, i);
    chip.classList.toggle('locked', !open);
    chip.title = open ? '' : F('открывается в акте {a}', 'opens in act {a}',
      { a: romanAct(STANCE_OPENS[i]) });
    chip.classList.toggle('on', open && st === cur);
    // Blade Momentum: the held grammar lights up when the next press is charged
    chip.classList.toggle('charged', charged && st === cur);
    chip.querySelector('.nm').textContent = L(...STANCE_STR[st]);
    const dots = chip.querySelector('.dots').children;
    STANCE_CLASSES.forEach((type, j) => {
      dots[j].className = Game.stanceBites(type, st) ? '' : 'off';
      dots[j].style.color = Scene.enemyColor(type);
      dots[j].title = Game.T(Game.ENEMY_TYPES[type], 'name');
    });
  });
}

let shownStance = null; // last stance painted — the HUD repaints only on change

function updateHud() {
  const stanceKey = state.run ? state.run.stance + state.run.act + '|' + state.run.sameStance : null;
  if (stanceKey !== shownStance) {
    shownStance = stanceKey;
    renderStance();
  }
  if (state.run) $('hud-stance').classList.toggle('cooling', state.run.stanceCd > 0);
  // the vocabulary is named on the act that opens it — but only once the act's
  // own banner has left the screen, so the two never talk over each other
  const bannerUp = !$('act-banner').classList.contains('hidden');
  if (!cinema && !bannerUp && Game.stancesOn(state.run)) teachStancesOnce();
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
    // the last pip already reads as danger on screen — say it in the mix too,
    // and let the frame's edges breathe red along with it
    Sound.setPeril(r.hp === 1);
    Scene.setPeril(r.hp === 1);
  }
  if (r.combo !== hudCombo) {
    const grew = r.combo > hudCombo;
    hudCombo = r.combo;
    // the arrangement follows the streak: layers build as the flow deepens and
    // fall away the instant it breaks
    Sound.setTier(comboTier(r.combo));
    // milestone streaks get the drop — the whole track goes under and slams back,
    // and the picture answers: a gold flash, a ring bursting from the hero, a
    // breath of zoom and the streak's number floating over his head. The loudest
    // achievement of a run finally LOOKS different from an ordinary kill.
    if (grew && MILESTONES.includes(r.combo)) {
      Sound.dropMusic(r.combo >= 50 ? 1.3 : 1);
      slowmo = Math.max(slowmo, 0.45); // the picture stretches with the sound
      Scene.flash('#ffd94d', 0.12);
      Scene.punch(0.03);
      Scene.heroShock('#ffd94d');
      Scene.floatText('×' + r.combo, 0, 0, '#ffd94d');
      Pad.impact(0.6, 130);
    }
    const el = $('combo-num');
    el.textContent = r.combo;
    el.classList.toggle('hot', r.combo >= 20);
    el.classList.remove('pop', 'glitch');
    void el.offsetWidth;
    el.classList.add('pop');
    // every tenth link of the streak, not every hit — see the keyframes
    if (grew && r.combo && r.combo % 10 === 0) el.classList.add('glitch');
    // the streak's exchange rate — the half of the combo the HUD never said:
    // kills pay base × this (Game.comboMult). Shown from the first rung up;
    // ×1 is not information. Pops only when a new rung is taken.
    const mult = Game.comboMult(r.combo);
    const mel = $('combo-mult');
    mel.classList.toggle('hidden', mult <= 1);
    if (mult > 1) {
      mel.textContent = '×' + (mult % 1 ? mult.toFixed(1) : mult);
      if (grew && r.combo % 10 === 0) {
        mel.classList.remove('pop');
        void mel.offsetWidth;
        mel.classList.add('pop');
      }
    }
  }
  // stasis counter: connected presses left until the zone-freezing discharge
  const se = Game.stasisEvery(state);
  const execKey = se ? `${r.stasisHits % se}/${se}` : 'off';
  if (execKey !== hudExec) {
    hudExec = execKey;
    const el = $('hud-exec');
    if (execKey === 'off') el.classList.add('hidden');
    else {
      el.classList.remove('hidden');
      $('exec-count').textContent = execKey;
      el.classList.toggle('ready', r.stasisHits % se === se - 1);
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
      $('hud-mut-icon').innerHTML = itemIcon('mu', mut);
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
let resumeT = 0;   // resume grace: the world stands frozen under the 3-2-1
let perilBeatT = 0; // countdown to the next peril heartbeat in the palms
const RESUME_GRACE = 0.9; // three counts of 0.3s — long enough to re-grip, short enough to not annoy
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
  slowmo = hitstop = choiceDelay = simAcc = resumeT = 0;
  $('resume-count').classList.add('hidden');
  warpCur = 1;
  hudCombo = -1; hudArmor = ''; hudMut = '';
  hideScreens();
  $('menu-fade').style.opacity = '0'; // a mid-dip kaleidoscope must not veil the ghost
  $('hud').classList.remove('hidden');
  $('replay-badge').classList.remove('hidden');
  $('replay-exit').classList.remove('hidden');
  replayBadge();
  Scene.setAct(Game.ACTS[0].id);
  Sound.transitionMusic(Game.ACTS[0].id);
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
    Sound.transitionMusic(actData(act).id);
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

// A run ended and the player moves on — to the next run or the menu. The
// platform may put a break here (the Yandex interstitial); every other build
// goes straight through. Only off the dead/victory screens, never a cold start
// from the menu, and never mid-run.
function afterRun(go) {
  if (activeScreen === 'dead' || activeScreen === 'victory') Yandex.interstitial(go);
  else go();
}

function startGame(mode) { afterRun(() => launchRun(mode)); }

function launchRun(mode) {
  Sound.ensure();
  if (mode === 'daily') Game.startDaily(state, todayStr());
  else if (mode === 'monthly') Game.startMonthly(state, monthStr());
  paused = false;
  slowmo = hitstop = choiceDelay = resumeT = 0;
  $('resume-count').classList.add('hidden');
  warpCur = 1;
  hudCombo = -1; hudArmor = ''; hudMut = '';
  if (mode !== 'daily' && mode !== 'monthly') Game.startRun(state, mode);
  menuBgStop(); // the postcard reel ends — the road itself begins
  Scene.setAct(Game.ACTS[0].id);
  // the menu set hands the street its decks mid-bar instead of cutting out
  Sound.transitionMusic(Game.ACTS[0].id);
  hideScreens();
  $('hud').classList.remove('hidden');
  saveState();
  // the campaign opens on a travelling shot (combat is frozen under it — see
  // the cinema guard in the loop); endless and the daily cut straight to the
  // fight — the daily's banner names its rules instead of the act
  if (mode === 'endless') showActBanner(1);
  else if (mode === 'daily') {
    popBanner(L('СИД ДНЯ', 'DAILY SEED'), todayStr(),
      L('общий сид · улучшения отключены · лучший результат — на доску',
        'shared seed · upgrades offline · your best goes on the board'));
  } else if (mode === 'monthly') {
    popBanner(L('СИД МЕСЯЦА', 'MONTHLY SEED'), monthStr(),
      L('общий сид · улучшения отключены · рекорд — волны',
        'shared seed · upgrades offline · the record is waves'));
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
    Sound.transitionMusic(id);
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
      Sound.transitionMusic(actData(r.act).id);
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
      Scene.corpse(ev.side, ev.dist, ev.enemy, 1);
      Scene.burst(ev.side, ev.dist, ev.chain ? '#baff4d' : '#ff5c9e');
      Sound.sfx('kill', comboPitch(), sidePan(ev.side, ev.dist), ev.enemy);
      comboNote(0.15);
      Pad.impact(0.45, 55);
      hitstop = Math.max(hitstop, 0.045);
      if (ev.surge) Scene.floatText(L('ИНЕРЦИЯ', 'MOMENTUM'), ev.side, ev.dist + 45, '#bfefff');
      if (ev.vamp) {
        Scene.floatText(L('+БРОНЯ', '+ARMOR'), ev.side, 60, '#2dff8f');
        Sound.sfx('vamp');
      }
      break;
    case 'hit':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, Math.min(ev.dist, Game.range(state)), '#ffd98a', 6);
      Sound.sfx('slash', comboPitch(), sidePan(ev.side, ev.dist), ev.enemy);
      // the pendulum's crossing gets its own whoosh, panned toward where he
      // LANDS — the ear tracks the flight even when the eye is busy
      if (ev.enemy === 'adapt') Sound.sfx('pendswing', 1, sidePan(-ev.side, 150));
      comboNote(0.09); // a plain hit sings quieter than a kill
      Pad.impact(0.2, 35);
      break;
    case 'reflect':
      Scene.slash(ev.side, true);
      Scene.floatText(L('ОТБИТО!', 'DEFLECTED!'), ev.side, ev.dist, '#26d6ff');
      Sound.sfx('reflect', comboPitch(), sidePan(ev.side, ev.dist));
      comboNote(0.12);
      Pad.impact(0.3, 45);
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
      Pad.impact(0.25, 40);
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
      Scene.punch(0.025);
      Pad.impact(0.7, 90);
      hitstop = Math.max(hitstop, 0.07);
      break;
    case 'glance':
      // the press connected and did nothing: the body is shoved back and the
      // hand is holding the wrong grammar. Said out loud until the player has
      // switched a few times on their own.
      Scene.slash(ev.side, false);
      Scene.burst(ev.side, ev.dist, ev.held ? '#7fd0ff' : '#7f8ca8', ev.held ? 10 : 5);
      Sound.sfx('glance', 1, sidePan(ev.side, ev.dist));
      if (ev.held) Scene.floatText(L('ЗАМЕР', 'HELD'), ev.side, ev.dist, '#7fd0ff');
      if ((state.meta.stats.stanceSwitches || 0) < Game.TEACH_STANCE) {
        // name the way OUT, not just the failure: the two grammars that do bite
        // this body, in the order the chips sit on screen
        const works = Game.STANCES
          .map((st, i) => (Game.stanceBites(ev.enemy, st) ? `${i + 1} ${L(...STANCE_STR[st])}` : null))
          .filter(Boolean).join(L('  ИЛИ  ', '  OR  '));
        Scene.floatText(L('СТОЙКА НЕ БЕРЁТ ЕГО', 'THIS STANCE WON\u2019T BITE'), ev.side, ev.dist, '#9fb8d8');
        Scene.floatText(works, ev.side, ev.dist + 55, '#cfe6ff');
      }
      break;
    case 'ghostMiss':
      // an execute stole the press's target: a light slash, no penalty, no drama
      Scene.slash(ev.side, false);
      break;
    case 'buffered':
      // the early press hangs in the buffer — deliberately silent: the swing
      // itself fires a few ticks later as a full kill/hit/miss event
      break;
    case 'miss':
      Scene.slash(ev.side, false);
      Scene.floatText(L('ПРОМАХ', 'MISS'), ev.side, 80, '#ff5c7a');
      // the surge arrives with act II — name the rushing crowd the first few
      // times it actually rushes, then let the streaks speak for themselves
      if (Game.surgeMult(state.run) > 1 && (state.meta.stats.surges || 0) <= Game.TEACH_SURGE) {
        Scene.floatText(L('ТОЛПА ЧУЕТ КРОВЬ', 'THE CROWD SMELLS BLOOD'), -ev.side, 200, '#ff5c7a');
      }
      Sound.sfx('miss', 1, sidePan(ev.side, 120));
      Sound.duckMusic(); // the track drops out from under the failed swing
      Scene.shake(7);
      Scene.flash('#ff2d4e', 0.14);
      Pad.impact(0.15, 80); // a dull, hollow buzz — nothing like a landed blow
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
      Pad.impact(0.3, 40);
      hitstop = Math.max(hitstop, 0.02);
      break;
    case 'qteHit':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, Math.min(ev.dist, Game.range(state)), '#ffffff', 5);
      // an arrival trace on the new side — shows where the Warden leapt
      if (ev.nextSide !== undefined) Scene.burst(ev.nextSide, ev.dist, ev.nextGlitch ? '#ff4de0' : '#ff3b3b', 5);
      Sound.sfx('slash', Sound.rung(ev.idx), sidePan(ev.side, ev.dist)); // the chain climbs the ladder, a rung per link
      Pad.impact(0.3, 40);
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
    case 'qteGlance':
      // the right side in the wrong word: the chain does not move, and the
      // clock does — the cost of reading the grammar late
      Scene.slash(ev.side, false);
      Scene.burst(ev.side, ev.dist, '#9fb8d8', 6);
      Sound.sfx('glance', 1, sidePan(ev.side, ev.dist));
      Scene.floatText(String(ev.gram + 1), ev.side, 150, STANCE_COLOR[Game.STANCES[ev.gram]]);
      break;
    case 'bossStagger':
      Scene.slash(ev.side, true);
      Scene.burst(ev.side, ev.dist, '#ff3b3b', 22);
      Scene.floatText(L('ФАЗА ПРОБИТА', 'PHASE DOWN'), ev.side, ev.dist, '#ffb42d');
      Sound.sfx('kill');
      Scene.shake(8);
      Pad.impact(0.6, 80);
      hitstop = Math.max(hitstop, 0.08);
      if (ev.summoned) {
        // Core Shogun called in backup
        Scene.floatText(L('ПОДМОГА!', 'BACKUP!'), -ev.side, 200, '#ff3b3b');
        Sound.sfx('windup');
      }
      break;
    case 'bossDead':
      Scene.slash(ev.side, true);
      Scene.corpse(ev.side, ev.dist, Scene.bossSpriteType(ev.kind), 1.8); // his own body comes apart
      Scene.burst(ev.side, ev.dist, '#ffffff', 40);
      Scene.burst(ev.side, ev.dist, '#ff3b3b', 20);
      Scene.floatText(L('СТРАЖ ПАЛ', 'WARDEN DOWN'), ev.side, ev.dist, '#ffb42d');
      Scene.flash('#ffffff', 0.25);
      Scene.punch(0.05);
      Sound.sfx('bossdead');
      Pad.impact(1, 250);
      slowmo = Math.max(slowmo, 1.0);
      hitstop = Math.max(hitstop, 0.1);
      break;
  }
  // the strike also deflected shuriken(s) in the zone
  if (ev.reflected && (ev.type === 'kill' || ev.type === 'hit')) {
    Scene.floatText(L('ОТБИТО!', 'DEFLECTED!'), ev.side, 110, '#26d6ff');
    Sound.sfx('reflect', comboPitch(), sidePan(ev.side, ev.dist));
  }
  // the armed press discharged: the struck side's zone flashes cold and stands still
  if (ev.stasis) {
    Scene.flash('#9fe8ff', 0.1);
    Scene.floatText(L('СТАЗИС', 'STASIS'), ev.side, 130, '#9fe8ff');
    for (const o of state.run.enemies) {
      if (!o.dead && o.hold > 0) Scene.burst(o.side, o.dist, '#9fe8ff', 8);
    }
    Sound.sfx('stasis', 1, sidePan(ev.side, ev.dist));
    Pad.impact(0.5, 70);
  }
  // the slash reached an open fencer behind the target
  if (ev.opened) {
    Scene.floatText(L('ОКНО!', 'OPENING!'), ev.opened.side, ev.opened.dist, '#2dff8f');
    handleStrikeEvent(ev.opened);
  }
  // The rest of the arc. The engine has always reported these (res.swept) and
  // NOTHING here ever read the field: every body the sweep took beyond the
  // first one died in total silence — no corpse, no burst, no sound, just a
  // silhouette gone from the road. That is what made the arc unreadable, and
  // why finishing a shielder looked like it killed the man queued behind him
  // for no reason. They are presented one rank quieter than the target so the
  // swing still has a centre: their own corpse and burst where they stand, a
  // softer sound, and none of the streak's punctuation — the hitstop, the pad
  // and the combo note belong to the press, not to what the press swept up.
  for (const sub of ev.swept || []) {
    const pan = sidePan(sub.side, sub.dist);
    if (sub.type === 'kill') {
      Scene.corpse(sub.side, sub.dist, sub.enemy, 1, false);
      Scene.burst(sub.side, sub.dist, '#ff5c9e', 12);
      Sound.sfx('kill', comboPitch(), pan, sub.enemy);
    } else if (sub.type === 'hit') {
      Scene.burst(sub.side, Math.min(sub.dist, Game.range(state)), '#ffd98a', 5);
      Sound.sfx('slash', comboPitch(), pan, sub.enemy);
    }
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
          '<b>Трейсер</b> после удара перемахивает на другую сторону, <b>щитовик</b> держит три удара, <b>метатель</b> кидает сюрикен — его можно отбить тем же ударом.',
          'Элита ломает ритм: <b>фехтовальщик</b> — только в зелёное окно, <b>маятник</b> — дважды перелетает, третий его останавливает, <b>близнецы</b> — обе кнопки одновременно.'],
  en: { lines: ['Strike only when an enemy is <b>within reach</b> — the ground markers show it. Swinging at air stuns you, resets the combo and <b>speeds the crowd up</b> for as long as the stun — a miss costs both time and ground.',
                'A <b>tracer</b> vaults to the other side after a hit, a <b>shielder</b> takes three, a <b>thrower</b> hurls a shuriken — the same strike deflects it.',
                'Elites break the rhythm: the <b>fencer</b> only in the green window, the <b>pendulum</b> crosses twice and falls to the third, the <b>twins</b> both buttons at once.'] },
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
    title = `${itemIcon('mu', mut)} ${Game.T(mut, 'name')}`;
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
    case 'sealTell':
      // the first sealed bodies name their own rule: a mark that answers one
      // grammar and no other is not guessable, so it is said once
      if ((state.meta.stats.sealKills || 0) < Game.TEACH_STANCE) {
        Scene.floatText(L('ПЕЧАТЬ', 'SEAL'), ev.side, ev.dist, '#ffffff');
        Scene.floatText(L('ТОЛЬКО ЭТА СТОЙКА', 'THIS STANCE ONLY'), ev.side, ev.dist + 55, '#cfe6ff');
      }
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
      // a light dip under the far blade — the Warden's set takes over from
      // the next bar, this just clears the air for the draw itself
      Sound.duckMusic(0.3, 0.3, 0.8);
      // the detonation moved from the ears to the eyes: the sound stays a
      // quiet blade, the SCREEN explodes — flash, debris on his horizon,
      // and a proper quake underfoot
      Scene.flash('#ffffff', 0.09);
      Scene.burst(ev.side, 320, '#ff3b3b', 30);
      Scene.burst(ev.side, 300, '#ffffff', 16);
      Scene.shake(9);
      break;
    }
    case 'bossGustWarn':
      // the howl: the only warning before the chain timer is compressed
      Sound.sfx('gust', 1, sidePan(ev.side, 150));
      Scene.floatText(L('ВЕТЕР', 'WIND'), ev.side, 150, '#bfefff');
      Scene.shake(3);
      break;
    case 'roadWarn':
      // the road's weather telegraph — the same vocabulary the Maglev Warden
      // taught: a howl before wind, a creak before the deck tilts, a crackle
      // of static before the hall's light stutters
      if (ev.kind === 'wind') {
        Sound.sfx('gust', 1, 0);
        Scene.floatText(L('ВЕТЕР', 'WIND'), 0, 220, '#bfefff');
        Scene.shake(3);
      } else if (ev.kind === 'roll') {
        Sound.sfx('pendswing', 1, sidePan(ev.dir, 200));
        Scene.floatText(L('КРЕН', 'TILT'), ev.dir, 220, '#ffd98a');
        Scene.shake(2);
      } else {
        Sound.sfx('glance', 1, 0);
        Scene.flash('#26d6ff', 0.06);
      }
      break;
    case 'road':
      if (ev.kind === 'wind') {
        Scene.gust(-1, 380);
        Scene.gust(1, 380);
        Sound.sfx('gust', 1, 0);
        Scene.shake(4);
      } else if (ev.kind === 'roll') {
        Scene.gust(ev.dir, 350); // streaks pour down the tilted side
        Scene.shake(5);
      } else {
        // lights out: the veil itself is drawn by the scene (roadVeil)
        Scene.flash('#0a1220', 0.12);
        Sound.sfx('glance', 0.8, 0);
      }
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
    case 'bufferedStrike':
      // a queued early press landed (or expired) inside the tick — it carries
      // a full strike event and deserves the same sound and light
      handleStrikeEvent(ev.ev);
      break;
    case 'reflectKill':
      Scene.burst(ev.side, ev.dist, '#26d6ff');
      Scene.corpse(ev.side, ev.dist, ev.enemy || 'thrower');
      // the re-aimed blade names its work — the implant's payoff must be readable
      if (ev.icept) Scene.floatText(L('ПЕРЕХВАТ', 'INTERCEPTED'), ev.side, ev.dist, '#26d6ff');
      Sound.sfx('kill', 1, sidePan(ev.side, ev.dist), ev.enemy || 'thrower');
      Pad.impact(0.4, 55);
      break;
    case 'reflectHit':
      // the returning blade bit a tougher walker — spent, but the plate rang
      Scene.burst(ev.side, ev.dist, '#26d6ff', 6);
      Sound.sfx('block', 1, sidePan(ev.side, ev.dist));
      Pad.impact(0.2, 35);
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
      Pad.impact(0.8, 160);
      hitstop = Math.max(hitstop, 0.09);
      break;
    case 'hurt':
      lastHurtSide = ev.side || 1;
      Scene.heroHurt();
      Scene.flash('#ff2d4e', 0.35);
      Scene.shake(14);
      Scene.punch(0.04);
      Sound.sfx('hurt', 1, sidePan(ev.side, 60));
      Pad.impact(1, 220); // the heaviest thud in the game — losing armor must be felt
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
      Pad.impact(1, 450); // one long roll under the shutdown
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
  if (resumeT > 0) return; // the world is frozen under the resume countdown
  Sound.ensure();
  handleStrikeEvent(Game.strike(state, side));
  updateHud();
}

// Both sides in one press — the chord as a single button (Enter / a TV remote's
// OK, the middle mouse button, the pad's Y). Two presses at the same instant:
// for a twin pair that is a chord with zero gap; for anything else it is
// exactly what a very fast ←→ already does, so the button grants no new power,
// it only removes the two-thumbs-in-180-ms problem (a remote has one thumb on
// the arrows, and an IR remote sends the second code ~0.1 s after the first).
// The nearer side swings first, so a hit is never lost to the empty side's stun.
function doStrikeBoth() {
  if (paused || replay || state.phase !== 'combat') return;
  if (resumeT > 0) return;
  Sound.ensure();
  const near = side => {
    let d = Infinity;
    for (const e of state.run.enemies) if (!e.dead && e.side === side && e.dist < d) d = e.dist;
    return d;
  };
  const first = near(1) < near(-1) ? 1 : -1;
  handleStrikeEvent(Game.strike(state, first));
  if (state.phase === 'combat') handleStrikeEvent(Game.strike(state, -first));
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
// One resume path for every device (Esc, the pause button, the pad's A):
// leaving a combat pause arms the 3-2-1 grace — the loop keeps the world
// frozen under it, so nobody dies in the first frame after the kitchen.
function resumeGame() {
  paused = false;
  hideScreens();
  Sound.pauseMusic(false); // the track surfaces with the world
  if (state.phase === 'combat' && !replay) resumeT = RESUME_GRACE;
}

// Esc and the gamepad's START share one meaning: pause, or step back a screen.
function pressEscape() {
  // in the viewer Esc is a pause, not an exit — the pause screen's «выйти»
  // (quitToMenu, guarded there) is what leaves the ghost
  if (replay) {
    const hint = document.querySelector('[data-i18n="pauseHint"]');
    if (!paused) {
      paused = true;
      Sound.pauseMusic(true);
      if (hint) hint.textContent = L('реплей на паузе · ESC — продолжить · «выйти» вернёт назад',
                                     'replay paused · ESC to resume · "quit" returns you back');
      showScreen('pause');
    } else {
      paused = false;
      Sound.pauseMusic(false);
      if (hint) hint.textContent = L(...STR.pauseHint);
      hideScreens();
    }
    return;
  }
  if (state.phase === 'combat' && !paused) {
    paused = true;
    Sound.pauseMusic(true); // the kitchen holds the track underwater
    resumeT = 0; // pausing mid-countdown discards the countdown
    $('resume-count').classList.add('hidden');
    const hint = document.querySelector('[data-i18n="pauseHint"]');
    if (hint) hint.textContent = L(...STR.pauseHint); // a replay pause may have left its text
    showScreen('pause');
  }
  else if (paused) resumeGame();
  else if (activeScreen === 'shop' || activeScreen === 'help') showScreen(shopReturnTo);
  else if (activeScreen === 'ach' || activeScreen === 'log' || activeScreen === 'board') showScreen('menu');
}

// TV browsers (Tizen, webOS, set-top boxes) often hand remote keys over with an
// empty e.code and only the legacy keyCode; Back has its own codes per vendor.
const TV_KEYS = { 37: 'ArrowLeft', 39: 'ArrowRight', 38: 'ArrowUp', 40: 'ArrowDown',
  13: 'Enter', 8: 'Backspace', 10009: 'Escape', 461: 'Escape' };
// On a screen the arrows and Enter drive the pad's button cursor (padNav*), so a
// TV remote — arrows, OK, Back and nothing else — reaches every menu.
const SCREEN_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  Enter: 'confirm', NumpadEnter: 'confirm' };
// a focused text field or dropdown owns its keys; buttons and sliders do not —
// the cursor drives those itself (and Enter's native click is suppressed below)
const ownsKeys = el => !!el && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ||
  (el.tagName === 'INPUT' && el.type !== 'range'));

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const code = e.code || TV_KEYS[e.keyCode] || '';
  if (activeScreen === 'choice' && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(code)) {
    choose(Number(code.slice(-1)) - 1);
    return;
  }
  if (activeScreen === 'choice' && code === 'KeyR') { rerollChoice(); return; }
  if (cinema) { endCinema(); return; } // any key skips the travelling shot
  if (replay && code === 'Space') { cycleReplaySpeed(); return; }
  if (code === 'Escape' || (code === 'Backspace' && !ownsKeys(document.activeElement))) { pressEscape(); return; }
  if (activeScreen && activeScreen !== 'choice' && !replay && SCREEN_KEYS[code] && !ownsKeys(document.activeElement)) {
    e.preventDefault(); // no page scroll under the arrows, no second (native) click on Enter
    // a button the mouse left focused is where Enter should land
    const el = document.activeElement;
    if (SCREEN_KEYS[code] === 'confirm' && el && el.tagName === 'BUTTON' && el !== padFocus &&
        padNavList().includes(el)) padFocusSet(el);
    handlePadAction(SCREEN_KEYS[code]);
    return;
  }
  if (activeScreen === 'choice' && SCREEN_KEYS[code]) { e.preventDefault(); handlePadAction(SCREEN_KEYS[code]); return; }
  // stances: the digits pick one outright, Space walks the ring for hands that
  // would rather keep a thumb on one key. The whole block only exists in
  // combat: an unguarded `return` here once swallowed Space on the menu and
  // made the Space-to-start branch below unreachable.
  if (state.phase === 'combat' && !paused && !replay) {
    if (code === 'Digit1' || code === 'Numpad1') { doStance(0); return; }
    if (code === 'Digit2' || code === 'Numpad2') { doStance(1); return; }
    if (code === 'Digit3' || code === 'Numpad3') { doStance(2); return; }
    if (code === 'Space' || code === 'KeyS' || code === 'ArrowDown') { doStanceCycle(1); return; }
    if (code === 'KeyW' || code === 'ArrowUp') { doStanceCycle(-1); return; }
  }
  // hidden wave skip — the run stops counting toward records from here on
  if (code === 'KeyK' && e.ctrlKey && e.shiftKey) {
    e.preventDefault();
    doSkipWave();
    return;
  }
  if (code === 'ArrowLeft' || code === 'KeyA') doStrike(-1);
  else if (code === 'ArrowRight' || code === 'KeyD') doStrike(1);
  else if ((code === 'Enter' || code === 'NumpadEnter') && state.phase === 'combat' && !activeScreen) doStrikeBoth();
  else if ((code === 'Enter' || code === 'Space') && activeScreen === 'menu') startGame();
});

$('scene').addEventListener('pointerdown', e => {
  // On touch the tap IS the strike — never let the browser turn it into a
  // scroll/zoom gesture (pairs with touch-action: none on #scene).
  if (e.pointerType !== 'mouse') { e.preventDefault(); Pad.noteTouch(); }
  if (cinema) { endCinema(); return; } // a tap skips the travelling shot
  if (state.phase !== 'combat' || paused) return;
  // A mouse has two buttons, so use them directly: left button strikes left, right
  // strikes right, wherever the cursor is. Touch and pen have no such split, so they
  // keep the screen-half mapping (tap the side you mean).
  let side;
  if (e.pointerType === 'mouse') {
    if (e.button === 0) side = -1;
    else if (e.button === 2) side = 1;
    else if (e.button === 1) { e.preventDefault(); doStrikeBoth(); return; } // the wheel: both sides
    else return; // extra buttons do nothing
  } else {
    side = e.clientX < window.innerWidth / 2 ? -1 : 1;
  }
  doStrike(side);
});
// The right button is a strike, not a menu request — suppress the context menu over
// the play field so the right-click lands as an attack instead of a popup.
$('scene').addEventListener('contextmenu', e => e.preventDefault());

// ---------- Gamepad ----------
// Presses arrive through Pad.poll() in the loop — the Gamepad API has no
// events for buttons. Strikes go through the same doStrike as every other
// device; the card cursor below exists only for the choice screen, where a
// pad has no pointer and no digit row.
let padSel = -1; // highlighted implant card; -1 until the pad touches the screen

function padSelMove(d) {
  const cards = document.querySelectorAll('#choice-cards .implant-card');
  if (!cards.length) return;
  padSel = padSel < 0 ? (d > 0 ? 0 : cards.length - 1) : (padSel + d + cards.length) % cards.length;
  cards.forEach((c, i) => c.classList.toggle('pad-sel', i === padSel));
}

// The button cursor for every other screen (menu, shop, pause…): up/down —
// or left/right, whichever the thumb prefers — walks the screen's live
// buttons in DOM order, A presses the lit one. Buttons stay ordinary DOM
// buttons — the cursor clicks them, so pad, mouse and touch share one path.
let padFocus = null; // the button under the pad cursor, or null

function padFocusSet(b) {
  if (padFocus) padFocus.classList.remove('pad-focus');
  padFocus = b || null;
  if (padFocus) {
    padFocus.classList.add('pad-focus');
    padFocus.scrollIntoView({ block: 'nearest' }); // long screens (shop, journal) scroll
  }
}

function padNavList() {
  if (!activeScreen) return [];
  // offsetParent filters everything display:none — .hidden buttons, collapsed rows
  return [...$('screen-' + activeScreen).querySelectorAll('button, input[type="range"]')]
    .filter(b => !b.disabled && b.offsetParent !== null);
}

function padNavMove(d) {
  const list = padNavList();
  if (!list.length) return;
  const i = list.indexOf(padFocus);
  padFocusSet(list[i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length]);
}

function padNavConfirm() {
  if (padFocus && document.contains(padFocus)) {
    // a click may rebuild the screen (buying an upgrade re-renders the shop) —
    // put the cursor back where the list now has a same-numbered button
    const i = padNavList().indexOf(padFocus);
    padFocus.click();
    if (!document.contains(padFocus)) {
      const after = padNavList();
      padFocusSet(after.length ? after[Math.min(Math.max(i, 0), after.length - 1)] : null);
    }
    return;
  }
  // no cursor yet: the screen's primary action, same as ENTER would mean
  if (activeScreen === 'menu') startGame();
  else if (activeScreen === 'dead') startGame(
    state.run && state.run.monthly ? 'monthly' : state.run && state.run.endless ? 'endless'
      : state.run && state.run.daily ? 'daily' : undefined);
  else if (activeScreen === 'victory') startGame();
  else if (activeScreen === 'pause') resumeGame();
  else padNavMove(1); // shop, help, boards…: the first press summons the cursor
}

function handlePadAction(a) {
  Sound.ensure();
  if (cinema) { endCinema(); return; } // any button skips the travelling shot
  if (a === 'start') { pressEscape(); return; }
  if (activeScreen === 'choice') {
    if (a === 'left' || a === 'right') padSelMove(a === 'left' ? -1 : 1);
    // a blind confirm only summons the cursor — choosing an implant unseen
    // because a button bounced would be theft
    else if (a === 'confirm') { if (padSel < 0) padSelMove(1); else choose(padSel); }
    else if (a === 'alt') rerollChoice();
    return;
  }
  if (replay && !paused) { if (a === 'confirm' || a === 'alt') cycleReplaySpeed(); return; }
  if (activeScreen) { // every other screen, the pause included, walks by cursor
    // a slider under the cursor claims left/right for its value; up/down still walk
    if (padFocus && padFocus.type === 'range' && (a === 'left' || a === 'right')) {
      padFocus.value = +padFocus.value + (a === 'left' ? -1 : 1) * (+padFocus.step || 1);
      padFocus.dispatchEvent(new Event('input'));
      padFocus.dispatchEvent(new Event('change'));
      return;
    }
    if (a === 'up' || a === 'left') padNavMove(-1);
    else if (a === 'down' || a === 'right') padNavMove(1);
    else if (a === 'confirm') padNavConfirm();
    return;
  }
  if (a === 'left') doStrike(-1);
  else if (a === 'right') doStrike(1);
  else if (a === 'confirm' || a === 'down') doStanceCycle(1); // A / d-pad down walks the ring
  else if (a === 'alt') doStrikeBoth();                     // Y: both sides at once
  else if (a === 'up') doStanceCycle(-1);
}

window.addEventListener('gamepadconnected', () => {
  popBanner('🎮', L('ГЕЙМПАД', 'GAMEPAD'),
    L('крестовина или бамперы — удары · Y — в обе стороны · START — пауза', 'd-pad or bumpers strike · Y both sides · START pauses'));
});

// ---------- The way ----------
// A standing choice that colours every road below it. Changing it mid-menu is
// free; it only ever reads at the moment a run starts.
function refreshMenuChamp() {
  if (!Board.enabled || !Board.enabled()) return;
  Board.champ($('menu-champ'), Board.wayKey(todayStr(), Game.wayHard(state)), () => startGame('daily'));
}

function renderWay() {
  const stance = Game.wayHard(state);
  const row = $('btn-way');
  row.classList.toggle('stance', stance);
  row.querySelector('.val').textContent = L(...STR[stance ? 'wayStance' : 'wayPlain']);
  row.title = stance
    ? L('нажми, чтобы вернуться на обычный путь', 'click for the plain way')
    : L('нажми, чтобы взять три стойки', 'click to take the three stances');
  const hint = $('way-hint');
  hint.classList.toggle('stance', stance);
  hint.textContent = stance
    ? L('сложный путь: три стойки, и каждого врага берут не все',
        'the harder road: three stances, and not every one of them bites')
    : L('стороны и зона — как задумано с самого начала',
        'sides and reach — the game as it was meant');
  // the daily champion frame belongs to the way you are looking at
  refreshMenuChamp();
}

function setWay(way) {
  Game.setWay(state, way);
  saveState();
  Sound.sfx('ui');
  renderWay();
}

$('btn-way').addEventListener('click', () => setWay(Game.wayHard(state) ? 'plain' : 'stance'));

// Screen buttons
$('btn-start').addEventListener('click', () => startGame());
$('btn-endless').addEventListener('click', () => {
  if (state.meta.stats.wins >= 1) startGame('endless');
});
$('btn-monthly').addEventListener('click', () => {
  if (state.meta.stats.wins >= 1) startGame('monthly');
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
// the touch pause: phones have neither ESC nor START. stopPropagation keeps
// the tap from doubling as a strike on the screen half under the button.
$('btn-pause-touch').addEventListener('pointerdown', e => {
  e.stopPropagation();
  e.preventDefault();
  pressEscape();
});

$('replay-badge').addEventListener('pointerdown', e => e.stopPropagation());
$('replay-exit').addEventListener('pointerdown', e => e.stopPropagation());
for (const b of document.querySelectorAll('#board-tabs button')) {
  b.addEventListener('click', () => { boardTab = b.dataset.key; boardBack = 0; renderBoardScreen(); });
}
$('board-prev').addEventListener('click', () => { boardBack++; renderBoardScreen(); });
$('board-next').addEventListener('click', () => { boardBack = Math.max(0, boardBack - 1); renderBoardScreen(); });
$('btn-retry').addEventListener('click', () => startGame(
  state.run && state.run.monthly ? 'monthly' : state.run && state.run.endless ? 'endless'
    : state.run && state.run.daily ? 'daily' : undefined));
$('btn-victory-retry').addEventListener('click', () => startGame());
$('btn-shop').addEventListener('click', () => { shopReturnTo = 'menu'; showScreen('shop'); });
$('btn-dead-shop').addEventListener('click', () => { shopReturnTo = 'dead'; showScreen('shop'); });
$('btn-shop-back').addEventListener('click', () => showScreen(shopReturnTo));

// ---------- Settings ----------
// The screen edits `settings` (core.js) live: the bus gain answers while the
// slider still moves, the scene re-renders under the chosen tier next frame.
// Saved on release, not on every input — a drag is one write, not fifty.
function renderSettings() {
  for (const [id, v] of [['set-music', settings.musicVol], ['set-sfx', settings.sfxVol]]) {
    $(id).value = Math.round(v * 100);
    $(id + '-val').textContent = Math.round(v * 100) + '%';
  }
  for (const b of document.querySelectorAll('#gfx-tabs button'))
    b.classList.toggle('primary', b.dataset.gfx === settings.gfx);
  for (const b of document.querySelectorAll('#calm-tabs button'))
    b.classList.toggle('primary', b.dataset.calm === settings.calm);
  for (const b of document.querySelectorAll('#fps-tabs button'))
    b.classList.toggle('primary', (b.dataset.fps === 'on') === settings.fps);
}

// The frame counter is a diagnostic, not a HUD element: off unless asked for,
// so a store page and a first launch never show a debug-looking number.
function applyFps() { $('fps').classList.toggle('hidden', !settings.fps); }

// ---------- Calm mode ----------
// One switch for players whom motion hurts: no camera shake, no full-screen
// flashes, no film grain. 'auto' defers to the OS-level "reduce motion" —
// the setting a player made once, for every program at once — and follows it
// live if it changes while the game is open. Impact and grain route through
// Scene.setFx, the CSS glitches through a body class.
const calmQuery = matchMedia('(prefers-reduced-motion: reduce)');

function applyCalm() {
  const calm = settings.calm === 'on' || (settings.calm === 'auto' && calmQuery.matches);
  Scene.setFx('impact', !calm);
  Scene.setFx('grain', !calm);
  document.body.classList.toggle('calm', calm);
}
calmQuery.addEventListener('change', applyCalm);

function bindVolume(id, key) {
  const el = $(id);
  el.addEventListener('input', () => {
    settings[key] = el.value / 100;
    Sound.setFlag(key, settings[key]);
    $(id + '-val').textContent = el.value + '%';
  });
  // the tick doubles as a probe: on the sfx slider you hear the level you set
  el.addEventListener('change', () => { saveSettings(); Sound.sfx('ui'); });
  // the slider must not feed the strike handler underneath it
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('keydown', e => e.stopPropagation());
}
bindVolume('set-music', 'musicVol');
bindVolume('set-sfx', 'sfxVol');

for (const b of document.querySelectorAll('#gfx-tabs button')) {
  b.addEventListener('click', () => {
    settings.gfx = b.dataset.gfx;
    Scene.setQuality(settings.gfx);
    saveSettings();
    Sound.sfx('ui');
    renderSettings();
  });
}

for (const b of document.querySelectorAll('#calm-tabs button')) {
  b.addEventListener('click', () => {
    settings.calm = b.dataset.calm;
    applyCalm();
    saveSettings();
    Sound.sfx('ui');
    renderSettings();
  });
}
for (const b of document.querySelectorAll('#fps-tabs button')) {
  b.addEventListener('click', () => {
    settings.fps = b.dataset.fps === 'on';
    applyFps();
    saveSettings();
    Sound.sfx('ui');
    renderSettings();
  });
}
$('btn-settings').addEventListener('click', () => showScreen('settings'));
$('btn-set-back').addEventListener('click', () => showScreen('menu'));

// The desktop shell's quit: only the Electron wrapper defines CR_SHELL, so in
// a browser the button stays hidden and the menu is byte-identical to itch.
if (window.CR_SHELL) {
  $('btn-exit').classList.remove('hidden');
  $('btn-exit').addEventListener('click', () => window.CR_SHELL.quit());
}

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
  applyBlade();     // the wiped meta wears the stock edge again
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
// The dropdown's options come from the LANGS roster (lang.js) — built once,
// before the initial applyLang() below sets the current value.
for (const { code, label } of LANGS) {
  const o = document.createElement('option');
  o.value = code;
  o.textContent = label;
  $('lang-select').appendChild(o);
}
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
const endToMenu = () => afterRun(() => { state.run = null; state.phase = 'menu'; showScreen('menu'); $('hud').classList.add('hidden'); });
$('btn-dead-menu').addEventListener('click', endToMenu);
$('btn-victory-menu').addEventListener('click', endToMenu);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-quit').addEventListener('click', quitToMenu);

// ---------- Achievements: periodic check and toasts ----------
let achTimer = 0;
// The first run names the vocabulary once. Everything else about stances is
// readable from the chips, but "there are three of these and you choose" has to
// be said out loud a single time — after that the screen speaks for itself.
// Each grammar is named on the act that hands it over, and never twice. The
// vocabulary arrives one word at a time — three rules in one breath was the
// load that made the whole thing hard.
function teachStancesOnce() {
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const how = touch ? L('жми стойку внизу экрана', 'tap a stance below')
                    : L('цифры 1 · 2 · 3', 'keys 1 · 2 · 3');
  const names = n => Game.STANCES.slice(0, n).map((st, i) => `${i + 1} ${L(...STANCE_STR[st])}`).join('   ');
  if (!state.meta.stanceTaught && Game.stancesOn(state.run)) {
    state.meta.stanceTaught = true;
    saveState();
    popBanner(L('КЛИНОК ВСПОМНИЛ ВИХРЬ', 'THE BLADE REMEMBERS THE SWEEP'), names(2),
      L(`${how} — пластина не берётся точным резом, а цифра над врагом подскажет`,
        `${how} — a plate turns the cut aside, and the digit above a body names the answer`));
    return;
  }
  if (!state.meta.pierceTaught && Game.stanceUnlocked(state.run, 2)) {
    state.meta.pierceTaught = true;
    saveState();
    popBanner(L('КЛИНОК ВСПОМНИЛ ПРОБОЙ', 'THE BLADE REMEMBERS THE THRUST'), names(3),
      L('тяжёлый выпад бьёт вдвое, но мимо юрких',
        'the heavy thrust lands twice over — and goes past the nimble'));
  }
}

const toastQueue = [];
let toastBusy = false;

function pumpToasts() {
  if (toastBusy || !toastQueue.length) return;
  toastBusy = true;
  const a = toastQueue.shift();
  const el = $('toast');
  // a journal fragment has no reward — it is announced, not awarded
  el.innerHTML = a.reward === undefined
    ? `${itemIcon('lg', a)} <b>${Game.T(a, 'name')}</b> · ${L('запись открыта', 'entry recovered')}`
    : `${itemIcon('ac', a)} <b>${Game.T(a, 'name')}</b> · +${a.reward} ㋕`;
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

// ---------- Zone-entry glints ----------
// The moment an approacher crosses into reach it catches the light and ticks.
// Detection reads the simulation state per frame, so it is purely cosmetic:
// nothing to record, and a ghost's crowd glints exactly like the live one did.
const zoneSeen = new WeakSet(); // walkers currently inside the zone
let bossWasIn = false;
function trackZoneEntries() {
  const r = state.run;
  if (!r || state.phase !== 'combat') { bossWasIn = false; return; }
  const rg = Game.range(state);
  // The glint belongs to the crosser that makes an empty side hot again —
  // "a target appeared, react". The queue filing in behind the first one
  // enters silently: the picture already says the side is busy, and a cue
  // per crosser turns dense waves into a woodpecker. Revealed holograms
  // neither receive the cue nor count as occupiers — a real enemy stepping
  // in past a phantom is still the first thing worth answering.
  const occupied = { '-1': 0, 1: 0 };
  for (const e of r.enemies) {
    if (e.kind === 'proj' || e.dead || !zoneSeen.has(e)) continue;
    if (e.dist <= rg && !(e.phantom && e.revealed)) occupied[e.side]++;
  }
  for (const e of r.enemies) {
    if (e.kind === 'proj' || e.dead) continue;
    const inz = e.dist <= rg;
    if (inz && !zoneSeen.has(e)) {
      zoneSeen.add(e);
      if (!(e.phantom && e.revealed) && !occupied[e.side]++) {
        Scene.glint(e.id);
        Sound.sfx('zone', 1, sidePan(e.side, e.dist));
      }
    } else if (!inz && zoneSeen.has(e)) {
      zoneSeen.delete(e); // knocked back out — the next crossing may glint again
    }
  }
  const b = r.boss;
  const bin = !!(b && b.state === 'walk' && b.dist <= rg);
  if (bin && !bossWasIn) {
    Scene.glint('boss');
    Sound.sfx('zone', 0.8, sidePan(b.side, b.dist)); // a heavier crosser, a lower tick
  }
  bossWasIn = bin;
}

// ---------- Loop ----------
let lastT = 0;

// The always-on FPS readout. Fed the RAW frame gap, not rawDt: rawDt is
// clamped at 50ms for the sim's sake, which would floor the readout at 20 —
// exactly the range where an honest number matters most.
let fpsAvg = 60, fpsT = 0;

function fpsFrame(gap) {
  if (!(gap > 0) || gap > 0.5) return; // first frame, or a tab that was asleep
  fpsAvg += (1 / gap - fpsAvg) * 0.1;
  fpsT += gap;
  if (fpsT >= 0.5) { // twice a second: readable, not a blur
    fpsT = 0;
    $('fps').textContent = fpsAvg.toFixed(0) + ' FPS';
  }
}

function loop(t) {
  requestAnimationFrame(loop);
  const frameGap = (t - lastT) / 1000;
  const rawDt = Math.min(0.05, frameGap || 0);
  lastT = t;
  fpsFrame(frameGap); // before the pause bail-out: the counter stays live on pause
  Debug.frame(rawDt);
  // the platform hears the truth every frame: fighting, or not (dedupes inside)
  Yandex.gameplay(state.phase === 'combat' && !paused && !replay);
  // pad presses must land even on pause and menu screens — START unpauses,
  // A starts a run — so the poll lives above the bail-out
  for (const a of Pad.poll()) handlePadAction(a);
  if (paused) return;

  // hitstop and slow-mo slow the game, but not the screen timers
  let dt = rawDt;
  if (hitstop > 0) { hitstop -= rawDt; dt = 0; }
  if (slowmo > 0) { slowmo -= rawDt; dt *= 0.3; }

  // Empty-approach fast-forward: threats far — the world speeds up, near — normal.
  // Double smoothing against jolts: smoothstep over distance (soft edges of
  // acceleration and braking) + exponential over time (no frame-to-frame jumps).
  let warpTarget = 1;
  // Not under a travelling shot: combat is frozen there but the scene clock is
  // not, and the intro opens with the crowd far away — full fast-forward. The
  // hero's cutscene run is timed in scene seconds, so the warp played it at
  // 5.5x: a calm jog turned into mincing every single campaign start.
  if (state.phase === 'combat' && !cinema && slowmo <= 0 && hitstop <= 0 && !Debug.noWarp) {
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
  // Resume grace: the world stands frozen while the 3-2-1 ticks. Placed after
  // the warp so the fast-forward cannot override the freeze; strikes are blocked
  // in doStrike, so the frozen crowd cannot be farmed.
  if (resumeT > 0) {
    resumeT -= rawDt;
    const rc = $('resume-count');
    if (resumeT <= 0) rc.classList.add('hidden');
    else {
      const n = String(Math.ceil(resumeT / (RESUME_GRACE / 3)));
      if (rc.textContent !== n) {
        rc.textContent = n;
        rc.classList.remove('hidden');
        rc.style.animation = 'none';
        void rc.offsetWidth; // restart the pop on each new digit
        rc.style.animation = '';
      }
      dt = 0;
    }
  }

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

  trackZoneEntries();
  // The Warden's shadow over the arrangement, derived rather than event-chased:
  // spawn, chain, phase break, death, quit and the replay viewer all reduce to
  // this one line. The scheduler picks the state up on its next grid step.
  const duelBoss = state.phase === 'combat' && state.run && state.run.boss;
  Sound.setDuel(duelBoss ? duelBoss.state : null, duelBoss ? duelBoss.kind : 0);
  if (state.phase === 'combat') updateHud();
  // the peril heartbeat in the palms: one heavy pulse a second while the hero
  // stands one hit from death — pairs with the red breathing and the choked mix
  if (state.phase === 'combat' && !replay && state.run && state.run.hp === 1) {
    perilBeatT -= rawDt;
    if (perilBeatT <= 0) { perilBeatT = 0.95; Pad.impact(0.35, 70); }
  } else perilBeatT = 0;
  if (!replayActive) checkAch(rawDt);
  // The sub-step remainder: how far between the last tick and the next the
  // frame lands. The renderer lerps pd→dist by it — on >60 Hz panels this is
  // what turns the 60 Hz sim quanta back into smooth motion.
  Scene.setWarp(warpCur); // the stride keeps its cadence under the fast-forward
  Scene.render(state, dt, rawDt, Math.min(1, simAcc / Game.STEP));
}

// ---------- Startup ----------
// The browser unlocks audio only on a user gesture: the first press of any
// kind wakes the context, and if we are still standing on the menu, its
// ambient set starts right then instead of waiting for a run.
const wakeMenuMusic = () => {
  Sound.ensure();
  if (state.phase === 'menu' && activeScreen === 'menu') startMenuMusic();
};
document.addEventListener('pointerdown', wakeMenuMusic);
document.addEventListener('keydown', wakeMenuMusic);

applyLang();
applyBlade(); // the equipped palette paints the edge from the first frame
// device settings take effect before the first frame is drawn or heard
Sound.setFlag('musicVol', settings.musicVol);
Sound.setFlag('sfxVol', settings.sfxVol);
Scene.setQuality(settings.gfx);
applyCalm();
applyFps();
$('game-version').textContent = 'v' + Game.VERSION;
showScreen('menu');

// splash: melts once sprites are ready (min 0.7s shown, max 2.5s)
const splashStart = performance.now();
(function hideSplash() {
  const elapsed = performance.now() - splashStart;
  if ((Sprites.ready() && elapsed > 700) || elapsed > 2500) {
    $('splash').classList.add('gone');
    setTimeout(() => $('splash').remove(), 600);
    Yandex.ready(); // the platform's «loaded»: the menu is under the finger
  } else setTimeout(hideSplash, 100);
})();
requestAnimationFrame(loop);

// PWA: offline shell + install prompt. Only over http(s) — file:// (the smoke
// test, the single-file dist a friend got) has no service workers, and a hosted
// dist without sw.js just fails the fetch — both land in the silent catch.
// The Yandex build lives in a foreign iframe with no sw.js beside it — skip.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.CR_YANDEX) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
