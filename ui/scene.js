'use strict';
// Scene rendering: act background, hero, enemies, effects. Everything is drawn in code,
// no assets. Logic distances (units) are converted to pixels via unitPx.

const Scene = (() => {
  const cv = $('scene');
  const ctx = cv.getContext('2d');

  let W = 0, H = 0, DPR = 1, groundY = 0, cx = 0, unitPx = 1, S = 1;
  let SPR = 2, SPR_BOSS = 4; // whole-pixel sprite scale, and the Warden's double
  // Floor on pixels-per-unit. The strike zone is a fixed FRACTION of the approach
  // (BASE_RANGE / SPAWN_DIST ≈ 17%), so on a narrow screen — a phone held upright
  // above all — it collapses to a sliver you can barely read or time against. Below
  // this floor px/unit stops shrinking with the width: the whole approach no longer
  // fits (enemies spawn off-screen and slide in), but the zone stays a usable size.
  // At 0.46 the zone is ~69px each side of centre even on a 390px-wide portrait
  // phone. The floor only bites under ~840px wide; every wider layout is untouched.
  const MIN_UNIT_PX = 0.46;

  // Adaptive render scale: watchFrameRate steps it down while frames stay slow
  // (itch iframes on hi-DPI screens and 4K fullscreens melt fill rate long
  // before the sim breaks a sweat). Layout math stays in CSS pixels — only the
  // backing store shrinks, softening the image instead of dropping frames.
  const RES_STEPS = [1, 0.8, 0.66, 0.5];
  let resStep = 0;
  // hard ceiling on backing-store area even at full quality: ~1440p-worth of
  // pixels; beyond that the neon look gains nothing and the bloom pays double
  const PIXEL_BUDGET = 3500000;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    const cap = Math.min(1, Math.sqrt(PIXEL_BUDGET / (W * H * DPR * DPR)));
    const k = DPR * Math.min(cap, RES_STEPS[resStep]);
    cv.width = Math.round(W * k);
    cv.height = Math.round(H * k);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(k, 0, 0, k, 0, 0);
    groundY = H * horizonOf();
    cx = W / 2;
    // On a wide screen the enemy's whole path fits in the half-width; on a narrow
    // one the floor takes over so the strike zone stays usable (see MIN_UNIT_PX).
    unitPx = Math.max((W / 2 - 24) / Game.SPAWN_DIST, MIN_UNIT_PX);
    // Figure scale, bound to BOTH axes.
    //
    // Height alone decides how big a figure can look; width decides how much room
    // there is between them, because unitPx above squeezes the enemy's whole
    // approach into the available width. Scaling on height only therefore broke on
    // tall narrow windows: at 800x900 the height drove the figures up while the
    // world was compressed sideways, and they overlapped by a factor of two.
    //
    // W/1600 keeps a figure at ~0.9 of the gap the wave generator leaves between
    // queued enemies (FOLLOW_GAP), just under the point where they touch. The
    // ceiling only binds above 4K; the floor only on windows narrower than a
    // phone in landscape, where no scale can fit both a readable figure and a gap.
    S = Math.min(2.2, Math.max(0.42, Math.min(H / 800, W / 1600)));
    // Sprite scale is SNAPPED TO A WHOLE NUMBER. Drawn at a fractional scale with
    // smoothing off, a source pixel lands on the screen as 3px on one row and 4px
    // on the next — at 1366x768 it was 1px against 2px, which visibly warps the
    // figure. An integer step makes every source pixel exactly N by N whatever
    // fractional x the sprite is standing on. The Warden runs at exactly twice the
    // grid, so he is bigger without being a different resolution.
    SPR = Math.max(1, Math.round(1.9 * S));
    SPR_BOSS = SPR * 2;
    bgCache = null; // regenerate the static background
    gradCache = {}; // gradients bake in groundY/S — stale ones would misplace light
  }
  // Coalesced to one resize per frame: a window drag or a phone rotation fires a
  // burst of events, and every uncoalesced call reallocates the canvas and throws
  // away bgCache — a full geometry rebuild per event, felt as jank mid-gesture.
  let resizeQueued = false;
  const queueResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  };
  window.addEventListener('resize', queueResize);
  // phones: rotation is the resize that matters, and some browsers fire it
  // without (or before) a resize event
  window.addEventListener('orientationchange', queueResize);

  // The camera is hard-locked to the hero: a dash changes worldX instantly (logic),
  // while worldVis catches up smoothly — camPx slides the whole world under the hero.
  let worldVis = 0, camPx = 0;
  let driftPx = 0; // world the scene has carried past on its own — see SCENES.drift
  // Two scrolls, because a moving location splits the frame in half.
  //
  //   worldScroll — the hero's progress plus the scene's drift. Everything he is
  //                 travelling THROUGH: the city, the sky, the pylons, the wires.
  //   deckScroll  — his progress alone. Everything he is travelling ON: the
  //                 surface under his feet and whatever lies on it.
  //
  // On a maglev roof the city has to tear past while the plates he is standing on
  // stay put — they are moving with him at the same speed. Feeding both from one
  // value would slide the roof out from under him at 400 km/h.
  // Where drift is 0 the two are identical, which is every location on the ground.
  const worldScroll = () => worldVis * unitPx + driftPx + cineTravel;
  // cineTravel is the cutscene's own mileage: it enters BOTH clocks below the
  // way the hero's real progress does, so the deck underfoot streams 1:1 and
  // the city recedes by its parallax — a genuine run, not a treadmill. (The
  // first version boosted drift instead, which moves the WORLD but not the
  // deck — on the train and the ship the hero visibly ran in place.)
  let cineTravel = 0;
  const deckScroll = () => worldVis * unitPx + cineTravel;
  // the zone markers' own smoothed camera offset: camPx JUMPS at the dash moment
  // (to keep enemies still), so markers glued to it would jump too — instead they
  // whip toward truth about twice as fast as the world camera settles
  let zonePx = 0;
  let reflectPass = false; // drawing the wet-ground reflection — no side effects allowed
  // Cutscene mode: the world streams past under its own power and the hero
  // holds a run — the scene becomes a travelling shot between two acts.
  let cinemaMode = false;
  function setCinema(on) { cinemaMode = !!on; }

  // Canvas shadow is the most expensive 2D op there is, and the reflection pass
  // was paying it twice: every figure redrawn into the mirror kept its full
  // shadowBlur at globalAlpha 0.15, where the glow cannot be seen at all. The
  // blur is set in dozens of places across the figure code, so instead of
  // threading a flag through all of them, the property itself is intercepted:
  // while reflectPass is up, any blur written to the context becomes 0.
  // (save/restore bypasses the setter, but the pass is wrapped in its own
  // save/restore, so no zero ever leaks out of the mirror.)
  {
    const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
    if (desc && desc.get && desc.set) {
      Object.defineProperty(ctx, 'shadowBlur', {
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, reflectPass ? 0 : v); },
      });
    }
  }

  // Act- and size-static gradients, built once and reused. A frame used to
  // allocate a dozen fresh gradient objects 60 times a second — pure GC churn:
  // the stops depend only on the act palette and the canvas geometry, both of
  // which survive for minutes. Dropped whenever either input changes.
  let gradCache = {};
  const grad = (key, make) => gradCache[key] || (gradCache[key] = make());

  const X = (side, dist) => cx + camPx + side * dist * unitPx;

  // ---------- Act palettes ----------
  // An act's accents are its voice: the sky glow, the signs, the ground edge and
  // — the part that matters — the strike zone. They are therefore forbidden to
  // borrow a hue that already MEANS something on the field:
  //
  //   orange — punk        blue   — shielder     green  — thrower, and the
  //   violet — fencer      lime   — adapter               fencer's open window
  //   yellow — twins, BLOCKED                    magenta — a lying glitch link
  //   red    — the Warden and damage             white   — a landed hit
  //
  // Act III used to be lit in #2dff8f and #baff4d, which are letter for letter
  // the thrower's halo and the adapter's halo: a green wall with green enemies
  // standing in front of it, and a green strike zone drawn over both. It runs on
  // azure now; its identity stays where it belongs, in the falling code.
  // Act IV's #b98bff was the fencer's violet for the same reason.
  // `signs` — the pool of glyphs a random sign is spelled from. `words` — signs
  // that actually say something: the story is told on the walls as well as on
  // the screens, and a player who reads Japanese gets it for free. About a third
  // of the signs come from here; the rest stay noise, because a street where
  // every sign is meaningful is a street that is trying to be read.
  // ---------- Locations ----------
  // Every location is described here, and only here. A scene lists the layers it
  // is made of; the renderer walks that list instead of branching on the act id.
  //
  // This replaced a model where the default was "outdoor neon city" and anything
  // else was an exception carved out at the draw site. That model leaked: the
  // sealed server hall had stars, a moon, a city skyline, rooftop antennas and
  // puddles on its floor, because nothing had ever said it should not. Each
  // omission had to be found by eye and patched with another conditional.
  //
  // Under a list you cannot leak by default — a layer that is not named does not
  // run. "Does the hall have puddles?" is answered by reading one array.
  //
  //   drift — world units per second the scene moves on its own, independent of
  //           the hero. 0 everywhere the ground is still; a moving vehicle sets
  //           it and the whole parallax stack follows.
  const SCENES = {
    street: {
      style: { top: '#0b0716', mid: '#1c1030', accent: '#ff2d78', accent2: '#26d6ff',
               signs: 'ラメンバー酒忍夜',
               words: ['影', '刃', '夜勤', '酒', '影狩'] },   // shadow · blade · night shift · sake · shadow hunt
      drift: 0,
      landmark: 'pagoda',
      layers: ['sky', 'stars', 'moon', 'skyline', 'cityGlow', 'farRow', 'haze',
               'nearRow', 'windows', 'signs', 'traffic', 'roofs', 'cables', 'landmark',
               'puddles', 'rig', 'rigCables'],
      weather: ['rain'],
    },
    // A market alley: the street's machinery turned denser and warmer. Lantern
    // strings hang where the street hangs bare cables, every other wall wears a
    // sign, and a third of them talk about the act's own lesson — 本物/偽物,
    // genuine and fake, because this is where the mimics first walk in.
    market: {
      style: { top: '#1a0a14', mid: '#3a1626', accent: '#ff5ca8', accent2: '#ffd27d',
               glow: '3a', // the market's own light pollution — much thicker than the street's
               signs: '市場安売買肉魚麺茶湯',
               words: ['安売', '本物', '偽物', '麺', '市場'] }, // sale · genuine · FAKE · noodles · market
      drift: 0,
      landmark: 'eatery',
      deck: 'paved',      // warm worn stone underfoot, not the street's neon grid
      layers: ['sky', 'stars', 'skyline', 'cityGlow', 'farRow', 'haze',
               'nearRow', 'windows', 'signs', 'lanterns', 'traffic', 'roofs', 'cables',
               'landmark', 'stalls', 'crowd', 'nobori', 'canopy', 'puddles', 'rig', 'rigCables'],
      // no moon (the sky is a slot over the alley), and no rain — the market is a
      // DRY warm night: what rises from it is grill sparks, not what falls on it
      air: ['motes'],
      weather: [],
    },
    train: {
      style: { top: '#04070f', mid: '#101d38', accent: '#ffb42d', accent2: '#4dc9ff',
               signs: '特急東駅出口速',
               words: ['特急', '出口', '上昇', '無人'] },      // express · exit · ascent · unmanned
      // "The city rushes past at 400 km/h" — so it has to actually rush past,
      // standing still included. Before drift existed the skyline only moved when
      // the hero walked, which quietly made the express a parked train.
      // World units per second. Screen speed is drift × unitPx × the layer's
      // parallax factor, and unitPx is ~0.43 at 1280 wide — so the number has to
      // be large to read as motion. This puts the near row near 200 px/s and the
      // distant skyline near 25, which is the spread that sells depth.
      drift: 1250,
      landmark: 'pylons',
      deck: 'train',      // the surface underfoot is car roofs, not roadway
      horizon: 0.80,      // lower than street level: the car's far side goes above him
      sway: 0.9,          // the carriage rides; amplitude in px, kept tiny on purpose
      layers: ['sky', 'stars', 'moon', 'skyline', 'cityGlow', 'farRow', 'haze',
               'nearRow', 'windows', 'signs', 'traffic', 'roofs', 'cables', 'landmark',
               'rig', 'rigCables'],
      air: ['speed'],      // the roof is always moving; this never varies
      weather: [],
    },
    // A crewless cargo ship crossing the bay. The world plane is the far shore:
    // a squashed skyline, harbor cranes, and between it and us — the sea, a band
    // of water that crops the city's feet the way the roof's parapet crops its
    // towers. The deck plane is what the hero stands on: plating, hatch strips
    // and container stacks riding the deck clock. The ship sails (drift) and
    // rolls (sway); no rain — the wind ate it.
    ship: {
      style: { top: '#040a12', mid: '#0d2030', accent: '#ffc266', accent2: '#3fd9e8',
               signs: '貨海港重運影無',
               words: ['貨物', '無人', '海運', '影'] },        // cargo · unmanned · shipping · shadow
      drift: 300,
      sway: 1.3,
      horizon: 0.76,
      deck: 'ship',
      profile: 'containers', // the near plane is cargo on OUR deck, not a city row
      landmark: 'cranes',
      layers: ['sky', 'stars', 'moon', 'skyline', 'cityGlow', 'farRow', 'sea',
               'haze', 'traffic', 'landmark'],
      weather: [],
    },
    // The one sealed location. No sky, therefore no stars, no moon, no skyline
    // and no roofs; a ceiling and an end wall stand in for them, and the floor
    // is dry. Audio splits on the same line — see ACT_SPACE in audio.js.
    server: {
      style: { top: '#03101c', mid: '#05192b', accent: '#19c8ff', accent2: '#6fd8ff',
               signs: 'データ禁止電脳',
               words: ['記憶', '複製', '影', '禁止', '在庫'] }, // memory · copy · shadow · forbidden · stock
      drift: 0,
      indoor: true,
      landmark: 'columns',
      profile: 'racks',   // the rows are cabinets, not buildings
      layers: ['sky', 'hallWall', 'cityGlow', 'farRow', 'haze', 'nearRow',
               'windows', 'signs', 'traffic', 'landmark', 'ceiling', 'rig'],
      air: ['datafall'],   // the hall's own character, not weather
      weather: [],
    },
    garden: {
      style: { top: '#120616', mid: '#2a1035', accent: '#ff7ad9', accent2: '#9be3ff',
               signs: '禅庭月静花夢',
               words: ['禅', '夢', '主', '静'] },              // zen · dream · master · silence
      drift: 0,
      // No puddles: nothing falls on this roof but petals. They survived here for
      // the same reason they survived in the server hall — the layer used to be
      // unconditional, so a place got water without ever asking for it.
      layers: ['sky', 'stars', 'moon', 'skyline', 'cityGlow', 'farRow', 'haze',
               'nearRow', 'windows', 'signs', 'traffic', 'roofs', 'cables',
               // Not 'landmark': up here the torii and the sakura stand on OUR roof,
               // so they have to be painted after the parapet. Drawn with the city
               // they came out cropped at the wall — a tree with no visible foot,
               // which reads as standing on the far side of the edge, in mid-air.
               // No 'rig': nothing spans an open roof. The near plane is instead a
               // sakura branch drooping into the top-left corner (see drawBranch).
               'deckLandmark', 'branch'],
      landmark: 'torii',
      weather: ['petals'],
      // The act always called itself a roof; now it is drawn as one. A rooftop is
      // sold by what you can see PAST it — the city here is towers that top out
      // below the parapet, so the whole skyline is squashed towards the horizon
      // and the wall crops their bases. See ROOF_ABOVE and SKYLINE_K.
      deck: 'roof',
    },
  };

  const scene = () => SCENES[actId] || SCENES.street;
  // Is this layer part of the current location? The only question the draw code
  // should ever ask about what a scene contains.
  const has = (layer) => scene().layers.indexOf(layer) >= 0;

  // Colours stay reachable under the old name: a good deal of code outside the
  // background reads the act's accents (the range markers, the blade trail, the
  // HUD tint), and none of that cares about layers.
  const ACT_STYLE = {};
  for (const id of Object.keys(SCENES)) {
    ACT_STYLE[id] = SCENES[id].style;
    ACT_STYLE[id].indoor = !!SCENES[id].indoor;
  }

  // Post-processing and near-plane switches. Kept public so the debug panel can
  // flip them one at a time — an effect you cannot turn off is an effect you
  // cannot judge.
  const fx0 = { bloom: true, signLight: true, foreground: true, grain: true };

  // Top strip owned by the HUD (armor pips, the 44px combo counter, the act and
  // score lines): CSS pixels, fixed, because the HUD is DOM and does not scale
  // with the scene. Nothing bright in the near plane may live above this line.
  const HUD_SAFE = 112;
  let actId = 'street';

  // Where the ground line sits, as a fraction of height. Standing on a vehicle
  // wants the action lower in frame than standing in a street: the carriage's
  // far side has to fit above the hero, or he reads as perched on the edge of the
  // roof rather than walking along it. Everything positional derives from
  // groundY, so moving it moves the hero, the enemies and their markers together.
  const horizonOf = () => (SCENES[actId] && SCENES[actId].horizon) || 0.74;

  // ---------- Static act decorations (cache) ----------
  // The generation itself lives in bgcache.js — canvas-free, one seeded stream per
  // layer, node-testable. This is only the glue: gather the current act's frame
  // dimensions and style and hand them over.
  let bgCache = null;

  function buildBgCache() {
    const sc = scene();
    bgCache = BgCache.compute({
      W, H, groundY, S, HUD_SAFE, ceilH: CEIL_H(),
      actId, deck: sc.deck, profile: sc.profile,
      layers: sc.layers, style: ACT_STYLE[actId],
    });
  }

  // ---------- Weather/atmosphere ----------
  let weather = [];
  let traffic = []; // air traffic: lights with glowing trails
  let rainRings = [], lastRainRing = 0; // raindrop rings in puddles

  function initTraffic() {
    traffic = [];
    for (let i = 0; i < 6; i++) {
      const depth = 0.06 + Math.random() * 0.24; // depth = speed and size
      traffic.push({
        x: Math.random() * W,
        y: H * (0.06 + Math.random() * 0.3),
        v: (14 + Math.random() * 30) * (Math.random() < 0.5 ? 1 : -1),
        depth,
        color: ['#ff5c6e', '#26d6ff', '#ffd98a'][i % 3],
      });
    }
  }

  function drawTraffic(t, dt) {
    ctx.save();
    for (const p of traffic) {
      p.x += p.v * dt;
      if (p.x < -60) p.x = W + 50;
      if (p.x > W + 60) p.x = -50;
      const size = 1 + p.depth * 5;
      const dir = Math.sign(p.v);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.16 + p.depth * 0.4;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dir * (10 + p.depth * 60), p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Atmosphere ----------
  // Each effect owns its own particles and knows nothing about which location
  // uses it; a scene names what it runs, and several can run at once. That is the
  // point of the split — the old model had one `prop` string per act, so a place
  // could have rain or streaks but never both, and never neither.
  //
  // Two lists, because they change on different clocks:
  //   air     — what the place permanently is. Streaks on a speeding roof, code
  //             falling in a server hall. Intrinsic; never varies.
  //   weather — what is happening to it right now. Swappable at runtime by
  //             setWeather(), which is what a wave mutator needs.
  const EFFECTS = {
    rain: {
      density: 90,
      draw(pool, t, dt) {
        ctx.strokeStyle = 'rgba(140, 180, 255, 0.28)';
        ctx.lineWidth = 1;
        for (const p of pool) {
          p.y += p.v * 720 * dt;
          p.x -= p.v * 120 * dt;
          if (p.y > H) { p.y = -20; p.x = Math.random() * (W + 100); }
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 2.5, p.y + 14 * p.v);
          ctx.stroke();
        }
      },
    },
    speed: { // horizontal streaks — the city rushes past
      density: 26,
      draw(pool, t, dt) {
        for (const p of pool) {
          p.x -= p.v * 1500 * dt;
          if (p.x < -160) { p.x = W + 60; p.y = Math.random() * groundY; }
          ctx.strokeStyle = `rgba(120, 200, 255, ${0.06 + 0.14 * p.v * 0.5})`;
          ctx.lineWidth = 1 + p.v;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 90 + 80 * p.v, p.y);
          ctx.stroke();
        }
      },
    },
    datafall: {
      density: 30,
      draw(pool, t, dt) {
        ctx.font = '13px monospace';
        for (const p of pool) {
          p.y += p.v * 190 * dt;
          if (p.y > H) {
            p.y = -20; p.x = Math.random() * W;
            p.ch = String.fromCharCode(0x30a0 + Math.floor(Math.random() * 90));
          }
          // teal, not the thrower's exact #2dff8f: the code is scenery and must
          // not read as an enemy halo hanging in the air
          ctx.fillStyle = `rgba(58, 235, 198, ${0.09 + 0.16 * Math.sin(p.ph + t * 3) ** 2})`;
          ctx.fillText(p.ch, p.x, p.y);
        }
      },
    },
    // Haze for the fog mutator. The mutator already has its veil — a hard curtain
    // at the materialisation edge, which is gameplay. This is the air in between,
    // which is atmosphere. Switched on by setWeather(), the case the air/weather
    // split was built for.
    fog: {
      density: 22,
      draw(pool, t, dt) {
        for (const p of pool) {
          p.x += (0.25 + p.v * 0.5) * 26 * dt;
          if (p.x > W + 240) p.x = -240;
          const y = p.y * 0.55 + groundY * 0.35;
          const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 150 + p.v * 90);
          g.addColorStop(0, `rgba(150, 180, 210, ${0.035 + 0.02 * Math.sin(t * 0.5 + p.ph)})`);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.fillRect(p.x - 250, y - 250, 500, 500);
        }
      },
    },
    motes: { // grill sparks and paper ash climbing out of the stall row
      density: 34,
      draw(pool, t, dt) {
        for (const p of pool) {
          p.y -= (18 + p.v * 30) * dt;
          p.x += Math.sin(t * 1.1 + p.ph) * 26 * dt;
          if (p.y < -8) { p.y = H * (0.72 + Math.random() * 0.2); p.x = Math.random() * W; }
          const a = 0.18 + 0.3 * Math.sin(t * 2.6 + p.ph) ** 2;
          ctx.fillStyle = `rgba(255, ${170 + Math.floor(60 * p.v * 0.5)}, 90, ${a.toFixed(2)})`;
          ctx.fillRect(p.x, p.y, 1.6 + p.v, 1.6 + p.v);
        }
      },
    },
    petals: {
      density: 40,
      draw(pool, t, dt) {
        for (const p of pool) {
          p.y += p.v * 60 * dt;
          p.x += Math.sin(t * 1.4 + p.ph) * 50 * dt;
          if (p.y > H) { p.y = -10; p.x = Math.random() * W; }
          ctx.fillStyle = 'rgba(255, 122, 217, 0.5)';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(t + p.ph) * 1.2);
          ctx.fillRect(-3, -1.6, 6, 3.2);
          ctx.restore();
        }
      },
    },
  };

  let weatherOverride = null; // set by setWeather(); null means "whatever the scene says"

  function makePool(n) {
    const pool = [];
    for (let i = 0; i < n; i++) {
      pool.push({
        x: Math.random() * W,
        y: Math.random() * H,
        v: 0.5 + Math.random(),
        ph: Math.random() * 7,
        ch: String.fromCharCode(0x30a0 + Math.floor(Math.random() * 90)),
      });
    }
    return pool;
  }

  // Accepts 'rain' or { kind: 'rain', density: 140 } — a mutator can ask for the
  // same effect heavier without a second entry in the registry.
  function addEffect(spec) {
    const s = typeof spec === 'string' ? { kind: spec } : spec;
    const fx = EFFECTS[s.kind];
    if (!fx) return; // an unknown name is a typo in a scene, not a reason to die
    weather.push({ fx, pool: makePool(s.density || fx.density) });
  }

  function initWeather() {
    weather = [];
    const sc = scene();
    for (const a of sc.air || []) addEffect(a);
    for (const w of weatherOverride || sc.weather || []) addEffect(w);
  }

  // Replace the weather without touching the location's permanent air. Pass null
  // to fall back to whatever the scene declares.
  function setWeather(list) {
    weatherOverride = list;
    initWeather();
  }

  // Is this effect running right now? Asked by anything that has to react to the
  // weather rather than draw it — puddle rings only make sense while it rains,
  // and after setWeather() that is a runtime question, not a property of the act.
  const running = (kind) => weather.some(w => w.fx === EFFECTS[kind]);

  function drawWeather(t, dt) {
    ctx.save();
    for (const w of weather) w.fx.draw(w.pool, t, dt);
    ctx.restore();
  }

  // ---------- The indoor shell: what replaces the sky ----------
  // Everything a sealed hall needs and an open sky cannot give: a ceiling that
  // closes the top of the frame, an end wall that stops the depth, and service
  // runs overhead. Deliberately all rectangles and gradients — the same
  // procedural vocabulary the rest of the background uses.
  //
  // The ceiling is the load-bearing part. A room reads as a room because the
  // frame is capped, not because of what hangs from it.
  // Deep enough that the readable part clears HUD_SAFE — see drawHallCeiling.
  const CEIL_H = () => Math.round(H * 0.30);

  function drawHallWall(t, tile, P) {
    const st = ACT_STYLE[actId];
    const ceilH = CEIL_H();

    // the far end of the hall: the room has to stop somewhere
    const wall = ctx.createLinearGradient(0, ceilH, 0, groundY);
    wall.addColorStop(0, 'rgba(2, 9, 16, 0.92)');
    wall.addColorStop(1, 'rgba(3, 14, 24, 0.55)');
    ctx.fillStyle = wall;
    ctx.fillRect(0, ceilH, W, groundY - ceilH);
    // a faint grid of racks on that far wall, too distant to resolve
    ctx.fillStyle = 'rgba(25, 200, 255, 0.045)';
    for (let x = 0; x < W; x += 46) {
      for (let y = ceilH + 18; y < groundY - 40; y += 26) ctx.fillRect(x + 6, y, 30, 12);
    }

  }

  function drawHallCeiling(t, tile, P) {
    const st = ACT_STYLE[actId];
    const ceilH = CEIL_H();

    // A ceiling is a mass seen from underneath, and in a side view its beams run
    // ACROSS the line of sight — so they read as horizontal bands, compressed
    // together as they recede. An earlier pass drew them as vertical ribs with a
    // bright edge along the bottom, which is the exact anatomy of a railing:
    // posts plus a handrail. Verticals up here read as things standing on
    // something; only horizontals read as something overhead.
    //
    // Depth runs from y=0 (directly above the camera) to y=ceilH (where the
    // ceiling meets the far wall). Spacing follows 1-(1-u)^2 so the gaps shrink
    // toward the far edge — that compression is what sells the plane as receding
    // rather than as a flat band stuck to the top of the frame.
    const beams = 9;
    const depthY = (u) => ceilH * (1 - (1 - u) * (1 - u));

    // the underside itself: lit where it is close, falling into dark as it goes
    const cg = ctx.createLinearGradient(0, 0, 0, ceilH);
    cg.addColorStop(0, 'rgba(12, 26, 38, 0.97)');
    cg.addColorStop(0.65, 'rgba(6, 16, 26, 0.96)');
    cg.addColorStop(1, 'rgba(2, 8, 14, 0.98)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, ceilH);

    ctx.save();
    for (let i = 0; i < beams; i++) {
      const u = i / (beams - 1);
      const y = depthY(u);
      const th = Math.max(1.5, 9 * (1 - u * 0.8)); // near beams are thicker
      // the beam's own underside, with a lit leading edge and a shadow behind:
      // that pairing is what gives a bar depth instead of leaving it a stripe
      ctx.fillStyle = `rgba(20, 42, 60, ${0.75 - u * 0.35})`;
      ctx.fillRect(0, y, W, th);
      ctx.fillStyle = `rgba(38, 74, 100, ${0.5 - u * 0.3})`;
      ctx.fillRect(0, y, W, Math.max(1, th * 0.3));
      ctx.fillStyle = `rgba(0, 4, 9, ${0.5 - u * 0.25})`;
      ctx.fillRect(0, y + th, W, Math.max(1, th * 0.5));

      // light troughs recessed INTO the gap between beams, not hung under them:
      // a fixture that floats free of the surface reads as a separate object
      if (i > 0 && i < beams - 1 && i % 2 === 1) {
        const gap = depthY((i + 1) / (beams - 1)) - y;
        const ly = y + gap * 0.35, lh = Math.max(1.5, gap * 0.28);
        const flick = Math.sin(t * 1.3 + i * 2.1) > 0.97 ? 0.35 : 1;
        ctx.globalAlpha = (0.5 - u * 0.28) * flick;
        ctx.fillStyle = st.accent2;
        ctx.fillRect(W * 0.06, ly, W * 0.88, lh);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // Where the ceiling meets the far wall: a shadow, not a highlight. A bright
    // line here is the handrail again — the junction of two planes going away
    // from you is the darkest part of the room, never the brightest.
    ctx.save();
    const jg = ctx.createLinearGradient(0, ceilH - 14, 0, ceilH + 6);
    jg.addColorStop(0, 'transparent');
    jg.addColorStop(1, 'rgba(0, 3, 7, 0.85)');
    ctx.fillStyle = jg;
    ctx.fillRect(0, ceilH - 14, W, 20);
    ctx.restore();

    // the pool of light the ceiling throws down the far wall
    ctx.save();
    ctx.globalAlpha = 0.1;
    const spill = ctx.createLinearGradient(0, ceilH, 0, ceilH + H * 0.12);
    spill.addColorStop(0, st.accent2);
    spill.addColorStop(1, 'transparent');
    ctx.fillStyle = spill;
    ctx.fillRect(0, ceilH, W, H * 0.12);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- Act landmarks: a unique dominant on its own layer ----------
  // ---------- Act landmarks ----------
  // The dominant of each location. This used to be one chain of `if (actId ===
  // ...)` four branches deep, so adding a location meant editing a conditional
  // every other location also lived inside. A scene names its landmark now and
  // the drawing is looked up.
  const LANDMARKS = {
    pagoda(tile, t, P) {

      // pagoda skyscraper with neon tiers
      for (const off of [0, -P]) {
        const x = tile(P * 0.55, 0.35) + off;
        if (x < -240 || x > W + 60) continue;
        const baseW = 150;
        let w = baseW, y = groundY, h;
        ctx.save();
        for (let i = 0; i < 6; i++) {
          h = 62 - i * 6;
          ctx.fillStyle = 'rgba(7, 7, 18, 0.92)';
          ctx.fillRect(x + (baseW - w) / 2, y - h, w, h);
          const rw = w + 28, rx = x + (baseW - rw) / 2;
          ctx.beginPath();
          ctx.moveTo(rx - 7, y - h);
          ctx.quadraticCurveTo(x + baseW / 2, y - h - 18, rx + rw + 7, y - h);
          ctx.lineTo(rx + rw - 12, y - h + 9);
          ctx.lineTo(rx + 12, y - h + 9);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 45, 120, 0.45)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(rx - 7, y - h);
          ctx.quadraticCurveTo(x + baseW / 2, y - h - 18, rx + rw + 7, y - h);
          ctx.stroke();
          // warm tier windows
          ctx.fillStyle = 'rgba(255, 210, 150, 0.25)';
          for (let wx = x + (baseW - w) / 2 + 8; wx < x + (baseW + w) / 2 - 8; wx += 12) {
            ctx.fillRect(wx, y - h + 14, 4, 6);
          }
          y -= h + 12; w -= 16;
        }
        // spire with a beacon
        ctx.strokeStyle = 'rgba(255, 45, 120, 0.7)';
        ctx.beginPath();
        ctx.moveTo(x + baseW / 2, y);
        ctx.lineTo(x + baseW / 2, y - 30);
        ctx.stroke();
        if (Math.sin(t * 2.2) > 0.4) {
          ctx.fillStyle = '#ff2d78';
          ctx.shadowColor = '#ff2d78';
          ctx.shadowBlur = 8;
          ctx.fillRect(x + baseW / 2 - 2, y - 34, 4, 4);
        }
        ctx.restore();
      }
    },
    pylons(tile, t, P) {

      // maglev pylons rush past in the near row
      ctx.save();
      for (let px = 0; px < P; px += 300) {
        const x = tile(px, 0.6);
        for (const xx of [x, x - P]) {
          if (xx < -120 || xx > W + 120) continue;
          ctx.fillStyle = 'rgba(6, 8, 18, 0.95)';
          ctx.fillRect(xx, H * 0.16, 12, groundY - H * 0.16);
          ctx.fillRect(xx - 4, H * 0.16, 74, 8); // cantilever arm
          ctx.strokeStyle = 'rgba(77, 201, 255, 0.5)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(xx + 66, H * 0.16 + 8);
          ctx.lineTo(xx + 66, H * 0.16 + 26);
          ctx.stroke();
          if (Math.sin(t * 3 + px) > 0.5) {
            ctx.fillStyle = '#ff4d5e';
            ctx.fillRect(xx + 2, H * 0.16 - 4, 4, 4);
          }
        }
      }
      ctx.restore();
    },
    columns(tile, t, P) {

      // colossal server columns with running lights
      ctx.save();
      for (let px = 0; px < P; px += 430) {
        const x = tile(px, 0.42);
        for (const xx of [x, x - P]) {
          if (xx < -140 || xx > W + 40) continue;
          // the racks stop at the ceiling instead of running through it —
          // a column that pierces its own roof unbuilds the room
          const top = CEIL_H();
          ctx.fillStyle = 'rgba(4, 12, 8, 0.96)';
          ctx.fillRect(xx, top, 150, groundY - top);
          ctx.fillStyle = 'rgba(2, 8, 5, 0.9)';
          for (let sy = top + 14; sy < groundY - 10; sy += 34) {
            ctx.fillRect(xx + 6, sy, 138, 3); // rack seams
          }
          for (let sy = top + 22; sy < groundY - 12; sy += 17) {
            const on = Math.sin(t * 4 + sy * 0.7 + px) > 0.1;
            ctx.fillStyle = on ? 'rgba(45, 255, 143, 0.55)' : 'rgba(45, 255, 143, 0.12)';
            ctx.fillRect(xx + 14 + ((sy * 13) % 108), sy, 5, 2.4);
          }
        }
      }
      ctx.restore();
    },
    torii(tile, t, P) {

      // giant torii and a neon sakura
      for (const off of [0, -P]) {
        const x = tile(P * 0.5, 0.35) + off;
        if (x < -320 || x > W + 60) continue;
        const h = H * 0.56, y0 = groundY, pw = 24, span = 270;
        ctx.save();
        ctx.fillStyle = 'rgba(34, 9, 17, 0.97)';
        ctx.strokeStyle = 'rgba(255, 61, 94, 0.55)';
        ctx.lineWidth = 1.6;
        for (const px of [x, x + span - pw]) {
          ctx.fillRect(px, y0 - h + 26, pw, h - 26);
          ctx.strokeRect(px, y0 - h + 26, pw, h - 26);
        }
        // lower crossbeam
        ctx.fillRect(x - 10, y0 - h + 44, span + 20, 13);
        // upper one, with lifted ends
        ctx.beginPath();
        ctx.moveTo(x - 34, y0 - h + 10);
        ctx.quadraticCurveTo(x + span / 2, y0 - h - 16, x + span + 34 - pw + pw, y0 - h + 10);
        ctx.lineTo(x + span + 26, y0 - h + 26);
        ctx.lineTo(x - 26, y0 - h + 26);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // a neon sakura nearby
        const tx = x + span + 90;
        ctx.strokeStyle = 'rgba(20, 8, 12, 0.95)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(tx, groundY);
        ctx.quadraticCurveTo(tx + 14, groundY - 70, tx - 12, groundY - 130);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 122, 217, 0.30)';
        for (let i = 0; i < 26; i++) {
          const a = i * 2.4, r = 18 + (i * 37) % 52;
          ctx.beginPath();
          ctx.arc(tx - 12 + Math.cos(a) * r, groundY - 150 + Math.sin(a) * r * 0.55, 5 + (i % 3) * 3, 0, 7);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ,eatery(tile, t, P) {
      // The market's anchor: a two-story corner noodle house. Everything the
      // stalls do, done bigger — a glowing ground-floor opening under a noren,
      // a cook and two late eaters in silhouette, dried goods on hooks, a
      // roof vent breathing steam, and the big bowl neon over the door.
      for (const off of [0, -P]) {
        const x = tile(P * 0.5, 0.35) + off;
        if (x < -340 || x > W + 90) continue;
        const bw = 195, h = H * 0.34, y0 = groundY, topY = y0 - h;
        ctx.save();
        // body and roof lip
        ctx.fillStyle = 'rgba(26, 10, 18, 0.97)';
        ctx.fillRect(x, topY, bw, h);
        ctx.fillStyle = 'rgba(16, 6, 12, 0.97)';
        ctx.fillRect(x - 9, topY - 7, bw + 18, 9);
        // roof vent, breathing steam
        const vx = x + bw * 0.74;
        ctx.fillRect(vx, topY - 24, 12, 18);
        ctx.fillStyle = 'rgba(220, 230, 240, 0.10)';
        for (let i = 0; i < 3; i++) {
          const k = ((t * 0.35 + i / 3) % 1);
          const puffX = vx + 6 + Math.sin(t * 0.8 + i * 2.1) * 6 * k;
          ctx.beginPath();
          ctx.arc(puffX, topY - 28 - k * 34, 4 + k * 7, 0, 7);
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // upstairs: two rows of warm windows, one of them always awake
        for (let r = 0; r < 2; r++) {
          for (let wxx = x + 14; wxx < x + bw - 18; wxx += 26) {
            const wy = topY + 12 + r * 26;
            const on = ((wxx * 7 + r * 13) % 10) > 2;
            ctx.fillStyle = on ? 'rgba(255, 214, 150, 0.30)' : 'rgba(70, 46, 52, 0.5)';
            ctx.fillRect(wxx, wy, 12, 15);
          }
        }
        // the ground floor: a box of light twice the stalls' size
        const opTop = y0 - h * 0.44, opL = x + 10, opW = bw - 20;
        ctx.fillStyle = grad('eateryLight', () => {
          const g = ctx.createLinearGradient(0, opTop, 0, y0);
          g.addColorStop(0, 'rgba(255, 205, 130, 0.55)');
          g.addColorStop(0.6, 'rgba(255, 180, 110, 0.30)');
          g.addColorStop(1, 'rgba(255, 160, 90, 0.07)');
          return g;
        });
        ctx.fillRect(opL, opTop, opW, y0 - opTop);
        // noren: short curtain strips over the opening, each swaying alone
        ctx.fillStyle = 'rgba(64, 40, 112, 0.95)';
        const seg = opW / 5;
        for (let i = 0; i < 5; i++) {
          const swx = Math.sin(t * 1.5 + i * 1.9) * 1.6;
          ctx.beginPath();
          ctx.moveTo(opL + i * seg + 1, opTop);
          ctx.lineTo(opL + (i + 1) * seg - 2, opTop);
          ctx.lineTo(opL + (i + 1) * seg - 2 + swx, opTop + 17);
          ctx.lineTo(opL + i * seg + 1 + swx, opTop + 17);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255, 235, 200, 0.7)';
        ctx.font = `bold ${Math.round(10 * S)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('麺', opL + seg * 2.5, opTop + 13);
        // dried goods on hooks, dark against the glow
        ctx.strokeStyle = 'rgba(12, 6, 10, 0.9)';
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(14, 7, 12, 0.95)';
        for (const [gx, gl, gw] of [[0.72, 10, 5], [0.79, 13, 4], [0.86, 9, 6]]) {
          const hx = opL + opW * gx;
          ctx.beginPath(); ctx.moveTo(hx, opTop + 17); ctx.lineTo(hx, opTop + 17 + 5); ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(hx, opTop + 22 + gl / 2, gw / 2, gl / 2, 0.15, 0, 7);
          ctx.fill();
        }
        // the counter, the cook behind it, two eaters hunched over bowls
        const cH = h * 0.15;
        ctx.fillStyle = 'rgba(12, 7, 13, 0.95)';
        ctx.fillRect(opL - 2, y0 - cH, opW + 4, cH);
        ctx.fillStyle = 'rgba(255, 205, 130, 0.20)';
        ctx.fillRect(opL - 2, y0 - cH, opW + 4, 1.5);
        ctx.fillStyle = 'rgba(12, 6, 10, 0.96)';
        const cookX = opL + opW * 0.5, cookBob = Math.sin(t * 1.1) * 1.2;
        ctx.beginPath(); // the cook: taller, arms busy at the pot
        ctx.moveTo(cookX - 9, y0 - cH);
        ctx.quadraticCurveTo(cookX - 9, y0 - cH - 21 + cookBob, cookX, y0 - cH - 22 + cookBob);
        ctx.quadraticCurveTo(cookX + 9, y0 - cH - 21 + cookBob, cookX + 9, y0 - cH);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(cookX, y0 - cH - 26 + cookBob, 4.4, 0, 7); ctx.fill();
        for (const [ex, ep] of [[0.2, 1.3], [0.82, 4.1]]) {
          const px2 = opL + opW * ex, eb = Math.sin(t * 0.9 + ep) * 1;
          ctx.beginPath(); // an eater: a round back over a bowl
          ctx.ellipse(px2, y0 - cH - 8 + eb, 7.5, 9.5, 0.5 * (ex < 0.5 ? 1 : -1), 0, 7);
          ctx.fill();
          ctx.beginPath(); ctx.arc(px2 + (ex < 0.5 ? 5 : -5), y0 - cH - 16 + eb, 3.6, 0, 7); ctx.fill();
        }
        // the big bowl neon on its bracket, blinking like every sign in town
        const nx = x + bw + 4, ny = topY + h * 0.30;
        const flick = 0.7 + 0.3 * Math.sin(t * 8.5);
        ctx.strokeStyle = 'rgba(20, 8, 14, 0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + bw, ny - 6); ctx.lineTo(nx + 17, ny - 6); ctx.stroke();
        ctx.globalAlpha = flick;
        ctx.strokeStyle = '#ffd27d';
        ctx.shadowColor = '#ffd27d';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(nx + 17, ny + 8, 13, 0, Math.PI); ctx.stroke(); // the bowl
        ctx.beginPath(); ctx.moveTo(nx + 6, ny + 8); ctx.lineTo(nx + 28, ny + 8); ctx.stroke();
        ctx.beginPath(); // chopsticks
        ctx.moveTo(nx + 10, ny - 10); ctx.lineTo(nx + 22, ny + 2);
        ctx.moveTo(nx + 16, ny - 12); ctx.lineTo(nx + 26, ny + 0);
        ctx.stroke();
        ctx.strokeStyle = '#ff5ca8';
        ctx.shadowColor = '#ff5ca8';
        ctx.lineWidth = 1.6;
        for (const sx2 of [nx + 11, nx + 17, nx + 23]) {
          ctx.beginPath(); // steam squiggles over the bowl
          ctx.moveTo(sx2, ny - 2);
          ctx.quadraticCurveTo(sx2 + 3, ny - 8, sx2, ny - 14);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        // protruding side signs on the left edge, stacked market-style
        ctx.textAlign = 'center';
        for (const [sy, txt, col] of [[topY + 20, '拉麺', '#ff5ca8'], [topY + 58, '湯', '#ffd27d']]) {
          const sflick = 0.6 + 0.4 * Math.sin(t * 7 + sy);
          ctx.fillStyle = 'rgba(20, 8, 14, 0.95)';
          ctx.fillRect(x - 26, sy, 26, 30);
          ctx.globalAlpha = sflick;
          ctx.strokeStyle = col;
          ctx.strokeRect(x - 25, sy + 1, 24, 28);
          ctx.fillStyle = col;
          ctx.shadowColor = col;
          ctx.shadowBlur = 8;
          ctx.font = `bold ${Math.round(11 * S)}px sans-serif`;
          for (let i = 0; i < txt.length; i++) ctx.fillText(txt[i], x - 13, sy + 13 + i * 12);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    },
    cranes(tile, t, P) {
      // harbor gantry cranes on the far shore, feet at the waterline
      const seaTop = groundY - H * SEA_H;
      ctx.save();
      for (const px of [P * 0.22, P * 0.68]) {
        const x = tile(px, 0.3);
        for (const xx of [x, x - P]) {
          if (xx < -220 || xx > W + 220) continue;
          const ch = H * 0.30, legs = 66, jib = 150;
          const y0 = seaTop + 4;
          ctx.fillStyle = 'rgba(6, 10, 18, 0.94)';
          ctx.strokeStyle = 'rgba(6, 10, 18, 0.94)';
          ctx.lineWidth = 6;
          // portal legs
          ctx.beginPath();
          ctx.moveTo(xx, y0); ctx.lineTo(xx + 16, y0 - ch);
          ctx.moveTo(xx + legs, y0); ctx.lineTo(xx + legs - 16, y0 - ch);
          ctx.stroke();
          ctx.fillRect(xx - 4, y0 - ch - 8, legs + 8, 10); // machinery deck
          // jib reaching over the water
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(xx - jib * 0.55, y0 - ch - 26);
          ctx.lineTo(xx + legs + jib * 0.45, y0 - ch + 2);
          ctx.stroke();
          // tie cables
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(10, 16, 26, 0.9)';
          ctx.beginPath();
          ctx.moveTo(xx + legs / 2, y0 - ch - 30);
          ctx.lineTo(xx - jib * 0.5, y0 - ch - 25);
          ctx.moveTo(xx + legs / 2, y0 - ch - 30);
          ctx.lineTo(xx + legs + jib * 0.4, y0 - ch);
          ctx.stroke();
          // aircraft beacon on the jib tip
          if (Math.sin(t * 2.4 + px) > 0.35) {
            ctx.fillStyle = '#ff4d5e';
            ctx.shadowColor = '#ff4d5e';
            ctx.shadowBlur = 7;
            ctx.fillRect(xx - jib * 0.55 - 2, y0 - ch - 30, 4, 4);
            ctx.shadowBlur = 0;
          }
        }
      }
      ctx.restore();
    },
  };

  function drawLandmark(tile, t) {
    const P = bgCache.P;
    const fn = LANDMARKS[scene().landmark];
    if (fn) fn(tile, t, P);
  }

  // ---------- Background ----------
  // ---------- Background layers ----------
  // One function per layer, each taking the shared draw context `bg`. Named `bg`
  // and not `c` because a cables loop inside one of them binds `c` and would
  // shadow it silently.
  //
  // This is a move, nothing else: every call below reproduces the condition the
  // block was already under. Three of these had no condition at all and were
  // simply running for every location — traffic, the near row's base fill and the
  // signs. They are layers now too, which is what makes the set complete; giving
  // them real per-scene gates is a separate change.
  // Where the far shore's feet are: on a water act the world's rows stand ON
  // the waterline — silhouettes that continue down into the bay read as a
  // drowned city, not a city across the water.
  const shoreY = () => has('sea') ? groundY - H * SEA_H : groundY;

  const LAYERS = {
    sky(bg) {
    ctx.fillStyle = grad('sky', () => {
      const g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, bg.st.top);
      g.addColorStop(1, bg.st.mid);
      return g;
    });
    ctx.fillRect(0, 0, W, groundY);
    },
    stars(bg) {
    // stars: twinkle, occasionally fade out (megacity smog)
      ctx.save();
      ctx.fillStyle = '#dfe9ff';
      for (const sp of bgCache ? bgCache.stars : []) {
        ctx.globalAlpha = Math.max(0, 0.14 + 0.3 * Math.sin(bg.t * 0.9 + sp.ph) ** 3);
        ctx.fillRect(sp.x, sp.y, sp.r, sp.r);
      }
      ctx.restore();
    },
    moon(bg) {
    // the scarlet cut moon — the game's emblem right in the sky
    ctx.save();
    const moonX = W * 0.68, moonY = H * 0.24, moonR = Math.min(W, H) * 0.11;
    ctx.fillStyle = grad('moonHalo', () => {
      const g = ctx.createRadialGradient(moonX, moonY, moonR * 0.2, moonX, moonY, moonR * 2.4);
      g.addColorStop(0, 'rgba(201, 36, 58, 0.4)');
      g.addColorStop(1, 'transparent');
      return g;
    });
    ctx.fillRect(moonX - moonR * 2.5, moonY - moonR * 2.5, moonR * 5, moonR * 5);
    // disc halves shifted apart along the cut line (slope k)
    const k = -0.12, dxm = moonR * 0.045;
    for (const [top, off] of [[true, -dxm], [false, dxm]]) {
      ctx.save();
      ctx.beginPath();
      if (top) {
        ctx.moveTo(moonX - moonR * 2, moonY - moonR * 2);
        ctx.lineTo(moonX + moonR * 2, moonY - moonR * 2);
        ctx.lineTo(moonX + moonR * 2, moonY + k * moonR * 2);
        ctx.lineTo(moonX - moonR * 2, moonY - k * moonR * 2);
      } else {
        ctx.moveTo(moonX - moonR * 2, moonY - k * moonR * 2);
        ctx.lineTo(moonX + moonR * 2, moonY + k * moonR * 2);
        ctx.lineTo(moonX + moonR * 2, moonY + moonR * 2);
        ctx.lineTo(moonX - moonR * 2, moonY + moonR * 2);
      }
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = '#a41f33';
      ctx.beginPath();
      ctx.arc(moonX + off, moonY, moonR, 0, 7);
      ctx.fill();
      // a light shade on the lower half — volume
      if (!top) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = bg.st.top;
        ctx.beginPath();
        ctx.arc(moonX + off - moonR * 0.25, moonY - moonR * 0.15, moonR * 0.9, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
    // the blade's trail through the disc
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#eafcff';
    ctx.shadowColor = '#26d6ff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(moonX - moonR * 1.3, moonY - k * moonR * 1.3);
    ctx.lineTo(moonX + moonR * 1.3, moonY + k * moonR * 1.3);
    ctx.stroke();
    ctx.restore();
    },
    // Indoors the fourth plane is the far end of the hall: the room has to stop
    // somewhere, and that wall is what tells you it does.
    hallWall(bg) {
      drawHallWall(bg.t, bg.tile, bg.P);
    },
    // ultra-far skyline — the fourth plane, almost dissolved into the sky
    skyline(bg) {
      const by = shoreY();
      ctx.fillStyle = 'rgba(10, 10, 26, 0.3)';
      for (const b of bgCache.farfar) {
        const sx = bg.tile(b.x, 0.05);
        ctx.fillRect(sx, by - b.h, b.w, b.h);
        ctx.fillRect(sx - bg.P, by - b.h, b.w, b.h);
      }
    },
    cityGlow(bg) {
    // city glow above the horizon — light pollution in the act's color. Indoors
    const glowH = H * (scene().indoor ? 0.16 : 0.3);
    const gby = shoreY();
    ctx.fillStyle = grad('cityGlow' + (scene().indoor ? ':in' : ''), () => {
      const g = ctx.createLinearGradient(0, gby - glowH, 0, gby);
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, bg.st.accent + (bg.st.glow || '22'));
      return g;
    });
    ctx.fillRect(0, gby - glowH, W, glowH);
    },
    traffic(bg) {

    drawTraffic(bg.t, bg.dt);
    },
    farRow(bg) {
    // city/rack silhouettes (far layer — 0.12, near — 0.35)
    const by = shoreY();
    ctx.fillStyle = 'rgba(8, 8, 20, 0.55)';
    for (const b of bgCache.far) {
      const sx = bg.tile(b.x, 0.12);
      ctx.fillRect(sx, by - b.h, b.w, b.h);
      ctx.fillRect(sx - bg.P, by - b.h, b.w, b.h);
    }
    },
    haze(bg) {
    // aerial-perspective haze over the far layer
    const hby = shoreY();
    ctx.fillStyle = grad('haze', () => {
      const g = ctx.createLinearGradient(0, hby - H * 0.4, 0, hby);
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, bg.st.mid + 'aa');
      return g;
    });
    ctx.fillRect(0, hby - H * 0.4, W, H * 0.4);
    },
    nearRow(bg) {

    ctx.fillStyle = 'rgba(5, 5, 14, 0.92)';
    for (const b of bgCache.near) {
      const sx = bg.tile(b.x, 0.35);
      ctx.fillRect(sx, groundY - b.h, b.w, b.h);
      ctx.fillRect(sx - bg.P, groundY - b.h, b.w, b.h);
    }
    // A cabinet is a stack of rack units, and the horizontal seams between them
    // are the giveaway: buildings have scattered windows, racks have rules. The
    // top cap and the side rails finish the read as furniture, not architecture.
    if (has('nearRow')) {
      ctx.save();
      for (const b of bgCache.near) {
        if (!b.rack) continue;
        const sx = bg.tile(b.x, 0.35);
        for (const xx of [sx, sx - bg.P]) {
          if (xx < -b.w || xx > W) continue;
          const top = groundY - b.h;
          ctx.fillStyle = 'rgba(16, 30, 40, 0.55)';
          ctx.fillRect(xx, top, b.w, 3);                 // the cap
          ctx.fillStyle = 'rgba(12, 24, 33, 0.45)';
          ctx.fillRect(xx, top, 2, b.h);                 // rails down both sides
          ctx.fillRect(xx + b.w - 2, top, 2, b.h);
          ctx.fillStyle = 'rgba(10, 20, 28, 0.5)';
          for (let sy = top + 15; sy < groundY - 8; sy += 15) {
            ctx.fillRect(xx + 3, sy, b.w - 6, 1.5);      // unit seams
          }
        }
      }
      ctx.restore();
    }
    },
    roofs(bg) {

    ctx.save();
    ctx.strokeStyle = 'rgba(4, 5, 12, 0.9)';
    ctx.lineWidth = 1.4;
    for (const c of bgCache.cables) {
      for (const off of [0, -bg.P]) {
        const x1 = bg.tile(c.x1, 0.35) + off, x2 = bg.tile(c.x2, 0.35) + off;
        if (x2 - x1 <= 0 || x2 - x1 > 300) continue; // gap at the bg.tile seam
        ctx.beginPath();
        ctx.moveTo(x1, c.y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(c.y1, c.y2) + c.sag, x2, c.y2);
        ctx.stroke();
      }
    }
    // roofs: antennas with beacons and flickering billboards
    for (const rf of bgCache.roofs) {
      for (const off of [0, -bg.P]) {
        const rx = bg.tile(rf.x, 0.35) + off;
        if (rx < -80 || rx > W + 80) continue;
        if (rf.type === 'ant') {
          ctx.strokeStyle = 'rgba(4, 5, 12, 0.95)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(rx, rf.y);
          ctx.lineTo(rx, rf.y - rf.h);
          ctx.stroke();
          if (rf.beacon && Math.sin(bg.t * 1.7 + rf.ph) > 0.55) {
            ctx.fillStyle = '#ff4d5e';
            ctx.shadowColor = '#ff4d5e';
            ctx.shadowBlur = 7;
            ctx.fillRect(rx - 1.5, rf.y - rf.h - 3, 3, 3);
            ctx.shadowBlur = 0;
          }
        } else {
          const flick = 0.5 + 0.3 * Math.sin(bg.t * 2.2 + rf.ph) + (Math.sin(bg.t * 9 + rf.ph * 3) > 0.93 ? -0.35 : 0);
          ctx.fillStyle = rf.color + '2a';
          ctx.strokeStyle = rf.color;
          ctx.globalAlpha = Math.max(0.15, flick);
          ctx.shadowColor = rf.color;
          ctx.shadowBlur = 10;
          ctx.fillRect(rx, rf.y, rf.w, rf.h);
          ctx.strokeRect(rx, rf.y, rf.w, rf.h);
          // running scan stripe
          const scan = rf.y + ((bg.t * 14 + rf.ph * 5) % rf.h);
          ctx.globalAlpha = Math.max(0.1, flick * 0.7);
          ctx.fillStyle = rf.color;
          ctx.fillRect(rx, scan, rf.w, 1.6);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.restore();
    },
    windows(bg) {
    // windows and LEDs (ride along with the near layer)
    for (const wd of bgCache.windows) {
      if (!wd.lit) continue;
      ctx.fillStyle = actId === 'server'
        ? `rgba(45, 255, 143, ${0.25 + 0.25 * Math.sin(bg.t * 2 + wd.x) ** 2})`
        : 'rgba(255, 220, 160, 0.22)';
      const sx = bg.tile(wd.x, 0.35);
      ctx.fillRect(sx, wd.y, 5, 7);
      ctx.fillRect(sx - bg.P, wd.y, 5, 7);
    }
    },
    signs(bg) {
    // signs: vertical neon text with flicker
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(15 * S)}px sans-serif`;
    for (const sg of bgCache.signs) {
      const flick = 0.65 + 0.35 * Math.sin(bg.t * 9 + sg.ph);
      const dead = Math.sin(bg.t * 0.7 + sg.ph * 3) > 0.985; // rare power dropout
      ctx.globalAlpha = dead ? 0.12 : 0.55 * flick + 0.3;
      ctx.fillStyle = sg.color;
      ctx.shadowColor = sg.color;
      ctx.shadowBlur = 12;
      const sgx = bg.tile(sg.x, 0.35);
      for (let i = 0; i < sg.text.length; i++) {
        ctx.fillText(sg.text[i], sgx, sg.y + i * 17 * S);
        ctx.fillText(sg.text[i], sgx - bg.P, sg.y + i * 17 * S);
      }
    }
    ctx.restore();
    },
    ceiling(bg) {
    drawHallCeiling(bg.t, bg.tile, bg.P);
    },
    // The bay between the far shore and our hull: a dark band that crops the
    // city's feet, carrying the shore's glow and a field of drifting glints.
    sea(bg) {
      const seaTop = groundY - H * SEA_H;
      const depth = groundY - seaTop;
      ctx.fillStyle = grad('seaBody', () => {
        const g = ctx.createLinearGradient(0, seaTop, 0, groundY);
        g.addColorStop(0, '#0a1c2a');
        g.addColorStop(0.25, '#071322');
        g.addColorStop(1, '#030810');
        return g;
      });
      ctx.fillRect(0, seaTop, W, depth);
      // the far shore's light lies on the water at the horizon line
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad('seaShine', () => {
        const g = ctx.createLinearGradient(0, seaTop, 0, seaTop + depth * 0.45);
        g.addColorStop(0, bg.st.accent2 + '3d');
        g.addColorStop(1, 'transparent');
        return g;
      });
      ctx.fillRect(0, seaTop, W, depth * 0.45);
      ctx.restore();
      // the quay: the dark edge the far city stands on, dotted with dock lights
      ctx.save();
      ctx.fillStyle = 'rgba(5, 8, 14, 0.98)';
      ctx.fillRect(0, seaTop - 3, W, 3.6);
      for (const q of bgCache.quay) {
        const a = 0.35 + 0.2 * Math.sin(bg.t * 1.9 + q.ph);
        ctx.fillStyle = `rgba(255, 194, 102, ${a.toFixed(2)})`;
        for (const sx of [bg.tile(q.x, 0.12), bg.tile(q.x, 0.12) - bg.P]) {
          if (sx < -10 || sx > W + 10) continue;
          ctx.fillRect(sx, seaTop - 4.6, 1.8, 1.8);
        }
      }
      ctx.restore();
      // the waterline: one bright thread where the shore meets its reflection
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = bg.st.accent2;
      ctx.fillRect(0, seaTop - 0.5, W, 1);
      ctx.restore();
      // the city lies in the water: every far tower smears a wavering streak
      // of its light down into the bay — a drowned building would not
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bgCache.far) {
        const w2 = b.w * 0.44;
        const len = Math.min(depth * 0.7, b.h * 0.5);
        const wob = Math.sin(bg.t * 0.8 + b.x) * 2.2;
        ctx.globalAlpha = 0.5 + 0.18 * Math.sin(bg.t * 1.3 + b.x * 0.7);
        ctx.fillStyle = grad('cityRefl', () => {
          const g = ctx.createLinearGradient(0, seaTop, 0, seaTop + depth * 0.7);
          g.addColorStop(0, bg.st.accent2 + '14');
          g.addColorStop(1, 'transparent');
          return g;
        });
        for (const sx of [bg.tile(b.x, 0.12), bg.tile(b.x, 0.12) - bg.P]) {
          if (sx + b.w < -30 || sx > W + 30) continue;
          ctx.fillRect(sx + (b.w - w2) / 2 + wob, seaTop, w2, len);
        }
      }
      ctx.restore();
      // the moon lies on the bay: a broken column of ripple-bands under the disc
      if (has('moon')) {
        ctx.save();
        const mx = W * 0.68, mw = Math.min(W, H) * 0.055;
        ctx.fillStyle = 'rgba(230, 120, 140, 0.10)';
        for (let i = 0; i < 9; i++) {
          const k = i / 9;
          const y = seaTop + 3 + k * (depth - 8);
          const sway2 = Math.sin(bg.t * 0.9 + i * 1.7) * mw * 0.35;
          const w2 = mw * (0.5 + k * 0.9) * (0.7 + 0.3 * Math.sin(i * 2.3));
          ctx.fillRect(mx - w2 / 2 + sway2, y, w2, 2 + k * 2);
        }
        ctx.restore();
      }
      // glints: short strokes, nearer water sliding faster — the parallax IS the wave
      ctx.save();
      for (const wv of bgCache.waves) {
        const y = seaTop + 3 + wv.k * (depth - 6) + Math.sin(bg.t * 1.1 + wv.ph) * 1.2;
        const a = 0.10 + 0.24 * wv.k + 0.10 * Math.sin(bg.t * 1.7 + wv.ph) ** 2;
        ctx.strokeStyle = `rgba(120, 210, 230, ${a.toFixed(3)})`;
        ctx.lineWidth = 1 + wv.k;
        for (const sx of [bg.tile(wv.x, wv.par), bg.tile(wv.x, wv.par) - bg.P]) {
          if (sx < -80 || sx > W + 80) continue;
          ctx.beginPath();
          ctx.moveTo(sx, y);
          ctx.lineTo(sx + wv.len * (0.6 + wv.k), y);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    // The stall row: counters under scalloped awnings, a warm bulb under each
    // canopy, goods in silhouette, steam over the noodle pots. Drawn at 0.5
    // parallax — in front of every building, just behind the fight.
    stalls(bg) {
      ctx.save();
      for (const stl of bgCache.stalls) {
        for (const sx of [bg.tile(stl.x, 0.5), bg.tile(stl.x, 0.5) - bg.P]) {
          if (sx + stl.w < -40 || sx > W + 40) continue;
          const y0 = groundY, topY = y0 - stl.h;
          const counterH = stl.h * 0.42;
          const awnB = topY + 21; // awning bottom — the lit opening starts here
          // A night stall is a BOX OF LIGHT: the opening between canopy and
          // counter glows warm, and everything in it reads as silhouette.
          const flick = 0.75 + 0.25 * Math.sin(bg.t * 2.3 + stl.ph);
          ctx.fillStyle = grad('stallLight', () => {
            const g = ctx.createLinearGradient(0, awnB, 0, y0);
            g.addColorStop(0, 'rgba(255, 205, 130, 0.52)');
            g.addColorStop(0.55, 'rgba(255, 180, 110, 0.30)');
            g.addColorStop(1, 'rgba(255, 160, 90, 0.08)');
            return g;
          });
          ctx.globalAlpha = flick;
          ctx.fillRect(sx + 2, awnB, stl.w - 4, y0 - awnB);
          ctx.globalAlpha = 1;
          // poles
          ctx.fillStyle = 'rgba(10, 6, 12, 0.96)';
          ctx.fillRect(sx + 1, topY + 8, 3.5, stl.h - 8);
          ctx.fillRect(sx + stl.w - 4.5, topY + 8, 3.5, stl.h - 8);
          // counter: a dark slab whose face still catches the stall's own light
          ctx.fillStyle = 'rgba(12, 7, 13, 0.94)';
          ctx.fillRect(sx, y0 - counterH, stl.w, counterH);
          ctx.fillStyle = 'rgba(255, 195, 120, 0.12)';
          ctx.fillRect(sx + 2, y0 - counterH + 2, stl.w - 4, counterH - 4);
          ctx.fillStyle = 'rgba(255, 205, 130, 0.22)';
          ctx.fillRect(sx, y0 - counterH, stl.w, 1.5); // lit counter lip
          ctx.fillStyle = 'rgba(8, 5, 10, 0.97)';
          for (const cr of stl.crates) {
            ctx.fillRect(sx + cr.dx, y0 - counterH - cr.h, cr.w, cr.h);
          }
          // the keeper, dark against their own light, swaying at their pot
          if (stl.keeper) {
            const kp = stl.keeper;
            const kx = sx + kp.dx * stl.w;
            const bob = Math.sin(bg.t * 0.9 + kp.ph) * 1.3;
            const shY = y0 - counterH - kp.h * 0.62 + bob;
            ctx.fillStyle = 'rgba(12, 6, 10, 0.96)';
            ctx.beginPath(); // shoulders
            ctx.moveTo(kx - kp.h * 0.42, y0 - counterH);
            ctx.quadraticCurveTo(kx - kp.h * 0.40, shY, kx, shY);
            ctx.quadraticCurveTo(kx + kp.h * 0.40, shY, kx + kp.h * 0.42, y0 - counterH);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath(); // head
            ctx.arc(kx + bob * 0.4, shY - kp.h * 0.16, kp.h * 0.19, 0, 7);
            ctx.fill();
          }
          // awning: canvas with a scalloped lit edge
          const awnY = topY + 8, awnDrop = 9;
          ctx.fillStyle = ['rgba(164, 36, 62, 0.96)', 'rgba(152, 108, 32, 0.96)',
                           'rgba(54, 34, 76, 0.96)'][stl.tone];
          ctx.beginPath();
          ctx.moveTo(sx - 4, awnY);
          ctx.lineTo(sx + stl.w + 4, awnY);
          ctx.lineTo(sx + stl.w + 1, awnY + awnDrop);
          const sc = 4; // scallops
          for (let k = sc; k >= 0; k--) {
            const bx = sx + 1 + (stl.w - 2) * k / sc;
            ctx.quadraticCurveTo(bx + (stl.w - 2) / sc / 2 - 2, awnY + awnDrop + 5,
                                 bx - 1, awnY + awnDrop);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 210, 125, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
          // the bulb under the canopy, breathing
          const bxc = sx + stl.w / 2, byc = awnY + awnDrop + 7;
          const a = 0.6 + 0.22 * Math.sin(bg.t * 2.3 + stl.ph);
          ctx.fillStyle = `rgba(255, 214, 140, ${a.toFixed(2)})`;
          ctx.shadowColor = '#ffd27d';
          ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(bxc, byc, 3.2, 0, 7); ctx.fill();
          ctx.shadowBlur = 0;
          // steam over the pot: two wisps leaning with their own phase
          if (stl.steam) {
            ctx.strokeStyle = 'rgba(220, 230, 240, 0.13)';
            ctx.lineWidth = 3;
            for (const [off, phk] of [[stl.w * 0.32, 0], [stl.w * 0.62, 2.4]]) {
              const wx = sx + off, wob = Math.sin(bg.t * 1.6 + stl.ph + phk);
              ctx.beginPath();
              ctx.moveTo(wx, y0 - counterH - 4);
              ctx.quadraticCurveTo(wx + 5 * wob, y0 - counterH - 18,
                                   wx - 4 * wob, y0 - counterH - 30 - 4 * wob);
              ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    },
    // Tarps over the alley: the market's roof. Translucent and unlit, so they
    // may cross the HUD band; their sagging edges are the only soft line the
    // top of the frame has.
    canopy(bg) {
      ctx.save();
      for (const cp of bgCache.canopy) {
        for (const sx of [bg.tile(cp.x, 0.5), bg.tile(cp.x, 0.5) - bg.P]) {
          if (sx + cp.w < -40 || sx > W + 40) continue;
          const sag = Math.sin(bg.t * 0.7 + cp.ph) * 1.6;
          const dropY = cp.drop + sag;
          ctx.fillStyle = ['rgba(120, 30, 48, 0.42)', 'rgba(122, 88, 30, 0.42)',
                           'rgba(44, 28, 66, 0.46)'][cp.tone];
          ctx.beginPath();
          ctx.moveTo(sx - 3, -4);
          ctx.lineTo(sx + cp.w + 3, -4);
          ctx.lineTo(sx + cp.w, dropY);
          ctx.quadraticCurveTo(sx + cp.w * 0.5, dropY + 14 + sag, sx, dropY);
          ctx.closePath();
          ctx.fill();
          // the lit hem — the stall light reaching the cloth's underside
          ctx.strokeStyle = 'rgba(255, 205, 130, 0.20)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx + cp.w, dropY);
          ctx.quadraticCurveTo(sx + cp.w * 0.5, dropY + 14 + sag, sx, dropY);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    // The shoppers. Everything about them is the negation of an enemy: a head
    // shorter than any fighter, matte dark with no halo, standing still but
    // alive — weight shifting, a slight lean into the counter, a bag in hand.
    crowd(bg) {
      ctx.save();
      ctx.fillStyle = 'rgba(13, 7, 12, 0.96)';
      for (const c of bgCache.crowd) {
        for (const sx of [bg.tile(c.x, 0.5), bg.tile(c.x, 0.5) - bg.P]) {
          if (sx < -30 || sx > W + 30) continue;
          const y0 = groundY, h = c.h;
          const sway2 = Math.sin(bg.t * 0.7 + c.ph) * 1.1;
          const bob = Math.sin(bg.t * 1.6 + c.ph) * 0.5;
          ctx.save();
          ctx.translate(sx + sway2 * 0.4, 0);
          // legs — planted, never striding
          ctx.fillRect(-2.6, y0 - h * 0.42, 2.2, h * 0.42);
          ctx.fillRect(0.8, y0 - h * 0.44, 2.2, h * 0.44);
          // torso leaning gently toward whatever is on the counter
          ctx.beginPath();
          ctx.moveTo(-4.4, y0 - h * 0.40);
          ctx.lineTo(4.4, y0 - h * 0.40);
          ctx.lineTo(3.1 + c.flip * 1.5, y0 - h * 0.88 + bob);
          ctx.lineTo(-3.1 + c.flip * 1.5, y0 - h * 0.88 + bob);
          ctx.closePath();
          ctx.fill();
          // head
          ctx.beginPath();
          ctx.arc(c.flip * 1.7, y0 - h * 0.94 + bob, h * 0.105, 0, 7);
          ctx.fill();
          // the evening's haul
          if (c.bag) ctx.fillRect(c.flip * 5.6, y0 - h * 0.3 + bob * 0.5, 4.5, 6.5);
          ctx.restore();
        }
      }
      ctx.restore();
    },
    // Nobori: vertical cloth banners on poles along the stall line. Nothing else
    // in the game hangs cloth — the soft swaying rectangle against hard neon is
    // the alley's own signature.
    nobori(bg) {
      ctx.save();
      ctx.textAlign = 'center';
      for (const nb of bgCache.nobori) {
        for (const sx of [bg.tile(nb.x, 0.5), bg.tile(nb.x, 0.5) - bg.P]) {
          if (sx < -40 || sx > W + 40) continue;
          const y0 = groundY, topY = y0 - nb.h;
          const sway2 = Math.sin(bg.t * 1.4 + nb.ph) * 2.2;
          // pole and the short arm the cloth hangs from
          ctx.strokeStyle = 'rgba(10, 6, 12, 0.96)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(sx, y0);
          ctx.lineTo(sx, topY - 6);
          ctx.lineTo(sx + nb.w + 3, topY - 6);
          ctx.stroke();
          // the cloth: hangs from the arm, its free bottom edge swaying
          const cl = ['rgba(196, 44, 76, 0.93)', 'rgba(222, 162, 62, 0.93)',
                      'rgba(84, 52, 128, 0.93)'][nb.tone];
          ctx.fillStyle = cl;
          ctx.beginPath();
          ctx.moveTo(sx + 2, topY - 4);
          ctx.lineTo(sx + 2 + nb.w, topY - 4);
          ctx.lineTo(sx + 2 + nb.w + sway2, y0 - nb.h * 0.28);
          ctx.quadraticCurveTo(sx + 2 + nb.w * 0.5 + sway2 * 1.6, y0 - nb.h * 0.2,
                               sx + 2 + sway2, y0 - nb.h * 0.26);
          ctx.closePath();
          ctx.fill();
          // glyphs down the cloth, lit by the stalls below
          ctx.fillStyle = 'rgba(255, 235, 200, 0.8)';
          ctx.font = `bold ${Math.round(13 * S)}px sans-serif`;
          for (let i = 0; i < nb.text.length; i++) {
            ctx.fillText(nb.text[i], sx + 2 + nb.w / 2 + sway2 * 0.4 * i,
                         topY + 16 + i * 17 * S);
          }
        }
      }
      ctx.restore();
    },
    // Market lantern strings: the cables' festive cousins, hung between the same
    // buildings, each lamp a small warm sun breathing on its own phase.
    lanterns(bg) {
      ctx.save();
      for (const ln of bgCache.lanterns) {
        for (const off of [0, -bg.P]) {
          const x1 = bg.tile(ln.x1, 0.35) + off, x2 = x1 + (ln.x2 - ln.x1);
          if (Math.max(x1, x2) < -60 || Math.min(x1, x2) > W + 60) continue;
          const midX = (x1 + x2) / 2, midY = (ln.y1 + ln.y2) / 2 + ln.sag;
          ctx.strokeStyle = 'rgba(8, 5, 12, 0.85)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x1, ln.y1);
          ctx.quadraticCurveTo(midX, midY + ln.sag, x2, ln.y2);
          ctx.stroke();
          for (const lp of ln.lamps) {
            // a point on the same quadratic, plus a tiny personal sway
            const f = lp.f, omf = 1 - f;
            const lx = omf * omf * x1 + 2 * omf * f * midX + f * f * x2 +
                       Math.sin(bg.t * 1.2 + lp.ph) * 1.6;
            const ly = omf * omf * ln.y1 + 2 * omf * f * (midY + ln.sag) + f * f * ln.y2 + 3;
            const a = 0.5 + 0.22 * Math.sin(bg.t * 1.9 + lp.ph);
            ctx.fillStyle = `rgba(${lp.warm ? '255, 210, 125' : '255, 92, 168'}, ${a.toFixed(2)})`;
            ctx.shadowColor = lp.warm ? '#ffd27d' : '#ff5ca8';
            ctx.shadowBlur = 9;
            ctx.beginPath();
            ctx.ellipse(lx, ly, lp.r * 0.78, lp.r, 0, 0, 7);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }
      ctx.restore();
    },
    landmark(bg) {
    drawLandmark(bg.tile, bg.t); // the act's dominant — before weather
    },
  };

  function drawBg(t, dt) {
    const st = ACT_STYLE[actId];
    if (!bgCache) buildBgCache();

    // Parallax: layers move at different speeds relative to how far the world has
    // travelled. That distance is the hero's own progress plus the scene's drift
    // — a location that moves under its own power (a train roof, a lift, a barge)
    // sets `drift` and the whole stack follows, with no special case anywhere in
    // the draw code. Standing still on a moving train still scrolls the city.
    const P = bgCache.P;
    const scrollPx = worldScroll();
    const tile = (x, factor) => {
      let sx = (x - scrollPx * factor) % P;
      if (sx < 0) sx += P;
      return sx;
    };
    const bg = { t, dt, st, P, tile };
    LAYERS.sky(bg);
    if (has('stars')) LAYERS.stars(bg);
    if (has('moon')) LAYERS.moon(bg);




    if (has('hallWall')) LAYERS.hallWall(bg);
    else if (has('skyline')) LAYERS.skyline(bg);
    if (has('cityGlow')) LAYERS.cityGlow(bg);
    if (has('sea')) LAYERS.sea(bg);
    if (has('traffic')) LAYERS.traffic(bg);
    if (has('farRow')) LAYERS.farRow(bg);
    if (has('haze')) LAYERS.haze(bg);
    if (has('nearRow')) LAYERS.nearRow(bg);
    if (has('roofs') || has('cables')) LAYERS.roofs(bg);
    if (has('windows')) LAYERS.windows(bg);
    if (has('signs')) LAYERS.signs(bg);
    if (has('lanterns')) LAYERS.lanterns(bg);
    if (has('stalls')) LAYERS.stalls(bg);
    if (has('crowd')) LAYERS.crowd(bg);
    if (has('nobori')) LAYERS.nobori(bg);
    if (has('canopy')) LAYERS.canopy(bg);
    if (has('ceiling')) LAYERS.ceiling(bg);
    if (has('landmark')) LAYERS.landmark(bg);


    drawWeather(t, dt);

    // Grades the CITY only: everything after this line is the floor — its neon
    // edge, the moon trail, the sign reflections — and dimming those would take
    // away the very surface the fighters stand on.
    drawDepthGrade();

    // ground
    ctx.fillStyle = grad('ground', () => {
      const g = ctx.createLinearGradient(0, groundY, 0, H);
      g.addColorStop(0, '#0a0a18');
      g.addColorStop(1, '#030309');
      return g;
    });
    ctx.fillRect(0, groundY, W, H - groundY);
    // ground edge — a neon line
    ctx.save();
    ctx.strokeStyle = st.accent2;
    ctx.globalAlpha = 0.5;
    ctx.shadowColor = st.accent2;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
    ctx.restore();
    // moon reflection on the wet ground — a vertical trail
    ctx.save();
    // A vertical gradient in a plain rect used to be enough here, because the
    // asphalt around it was bright enough to hide the rect's straight sides.
    // With the ground graded down they read as a lit box on the road, so the
    // trail fades on BOTH axes: a circular falloff stretched into the depth.
    const mrx = W * 0.68;
    const mrw = Math.min(W, H) * 0.075;
    ctx.save();
    ctx.translate(mrx, groundY);
    ctx.scale(1, (H - groundY) / mrw);
    ctx.fillStyle = grad('moonTrail', () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, mrw);
      g.addColorStop(0, 'rgba(232, 244, 255, 0.13)');
      g.addColorStop(1, 'transparent');
      return g;
    });
    ctx.fillRect(-mrw, 0, mrw * 2, mrw);
    ctx.restore();
    ctx.restore();
    // Sign light on the wet ground. The signs used to glow strictly into
    // themselves — the city was lit, the street below it was not, and the two
    // read as separate drawings. Each sign now puts an additive pool on the
    // asphalt under it plus the narrow mirror streak it always had, and the pool
    // breathes on the sign's own phase, so the road flickers when the neon does.
    ctx.save();
    for (const sg of bgCache.signs) {
      const flick = 0.62 + 0.38 * Math.sin(sg.ph + t * 2.4) ** 2;
      for (const sgx of [tile(sg.x, 0.35), tile(sg.x, 0.35) - P]) {
        if (sgx < -240 || sgx > W + 240) continue;
        if (fx0.signLight) {
          // A wash down the road, not a puck of colour on it. The first version
          // was a wide bright ellipse and read exactly like one: a coloured oval
          // painted on the asphalt. Light on a wet road runs AWAY from the
          // viewer — narrow, long, and weak enough that you notice the road is
          // lit rather than noticing the light itself.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.055 * flick;
          const depth = Math.max(40, H - groundY);
          ctx.save();
          ctx.translate(sgx, groundY);
          ctx.scale(1, depth / (58 * S));
          // built at the origin, so one gradient serves every copy of every
          // sign of this colour — this used to be a fresh radial per sign
          // per visible copy per frame, the worst allocator in the file
          ctx.fillStyle = grad('signPool:' + sg.color, () => {
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 58 * S);
            g.addColorStop(0, sg.color);
            g.addColorStop(0.5, sg.color + '80');
            g.addColorStop(1, 'transparent');
            return g;
          });
          ctx.fillRect(-58 * S, 0, 116 * S, 58 * S);
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 0.08 * flick;
        ctx.fillStyle = sg.color;
        ctx.fillRect(sgx - 5 * S, groundY + 2, 10 * S, (H - groundY) * 0.5);
      }
    }
    ctx.restore();
  }

  // Stall bulbs put their own warm pools on the pavement — the market's floor is
  // lit by commerce, not by the city. Called from the paved deck, which paints
  // the stone first and would otherwise bury them.
  function drawStallPools(t) {
    if (!bgCache || !bgCache.stalls.length) return;
    const P = bgCache.P;
    const scrollPx = worldScroll();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const stl of bgCache.stalls) {
      let m = (stl.x - scrollPx * 0.5) % P;
      if (m < 0) m += P;
      for (const sx of [m, m - P]) {
        if (sx + stl.w < -80 || sx > W + 80) continue;
        const a = 0.5 + 0.2 * Math.sin(t * 2.3 + stl.ph);
        ctx.globalAlpha = 0.22 * a;
        ctx.save();
        ctx.translate(sx + stl.w / 2, groundY + 3);
        ctx.scale(1, 0.22);
        ctx.fillStyle = grad('stallPool', () => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70 * S);
          g.addColorStop(0, '#ffd68c');
          g.addColorStop(1, 'transparent');
          return g;
        });
        ctx.beginPath(); ctx.arc(0, 0, 70 * S, 0, 7); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---------- Depth grade: the figures against the city ----------
  // The fighters stand in the busiest strip of the whole frame: the mid-ground
  // towers put their lit windows at exactly figure height and at figure
  // brightness, so a dark silhouette had nothing to be a silhouette against.
  // Sinking that strip toward black — and the frame's corners with it — costs
  // two gradients and buys the readability of the entire combat line.
  //
  // Both land on the city and nothing else. Fighters, the strike zone and the
  // effects are drawn later and keep their full contrast: an enemy dimmed
  // because he is near the screen edge would be a fairness bug, not a look, and
  // the edge is exactly where he is first read.
  function drawDepthGrade() {
    const top = groundY - 215 * S;
    ctx.fillStyle = grad('gradeBand', () => {
      const g = ctx.createLinearGradient(0, top, 0, groundY + 4);
      g.addColorStop(0, 'rgba(3, 3, 10, 0)');
      g.addColorStop(0.45, 'rgba(3, 3, 10, 0.38)');
      g.addColorStop(1, 'rgba(3, 3, 10, 0.72)');
      return g;
    });
    ctx.fillRect(0, top, W, groundY + 4 - top);
    // vignette centred on the hero, not on the canvas: the action line sits at
    // 0.74 of the height, and a geometric centre would darken the ground instead
    const vy = groundY - 70 * S;
    ctx.fillStyle = grad('vignette', () => {
      const g = ctx.createRadialGradient(cx, vy, Math.min(W, H) * 0.26, cx, vy, Math.max(W, H) * 0.78);
      g.addColorStop(0, 'rgba(2, 2, 8, 0)');
      g.addColorStop(1, 'rgba(2, 2, 8, 0.58)');
      return g;
    });
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- Bottom part: water/parapet ----------
  // Drawn OVER the reflections: depth fade, drifting ripples
  // and the parapet edge in the extreme foreground (parallax 1.25).
  // ---------- The maglev deck ----------
  // What you are standing on when the location moves: car roofs, seen in the same
  // receding perspective as the roadway it replaces.
  //
  // Two clocks meet here, and keeping them apart is the whole trick. The plates,
  // seams and vents ride deckScroll — they travel with the hero because he is on
  // them. What shows THROUGH the coupling gaps rides worldScroll, so the guideway
  // tears past at full speed. Standing still, the deck is motionless and the slots
  // between cars are a blur: exactly the view from a train roof.
  const CAR_LEN = 975;     // px of deck travel per carriage
  let deckPhase = 0;       // set on entry so an act does not open on a coupling gap

  // Distance from the last coupling seam, in deck pixels. Everything that repeats
  // per carriage measures from this, so shifting the phase moves seams, LEDs and
  // flank furniture together.
  const carOffset = () => ((deckScroll() + deckPhase) % CAR_LEN + CAR_LEN) % CAR_LEN;

  // Put the hero mid-carriage. A seam sits at screen x = -carOffset() + n·CAR_LEN,
  // so for the centre of the screen to be half a car from one, the offset has to
  // be CAR_LEN/2 - cx. Called when the act begins; after that the phase rides the
  // deck like everything else, and the seams walk past as the hero moves.
  function alignDeck() {
    deckPhase = 0;
    if (scene().deck !== 'train') return;
    const want = CAR_LEN / 2 - cx;
    deckPhase = want - deckScroll();
  }
  // The reference's ribs run diagonally because its camera is three-quarter. Ours
  // is straight-on — the ground grid fans symmetrically about centre and the city
  // is a flat silhouette — and in that projection lengthwise members are
  // HORIZONTAL. Borrowing the diagonal also meant no rib could cross the frame: at
  // 0.22 over a 115px band a rib leaves the decking after ~520px, so the planking
  // only ever appeared in a patch around the hero.
  //
  // Cross-members are the ones that fan, spreading out from centre with depth —
  // the same law the roadway grid already uses.
  // The roadway grid fans 0.3 -> 1.7 with depth, which is right for a ground plane
  // running to the horizon. A carriage is a bounded object: at that strength its
  // leading and trailing cuts get visibly different slants and every car comes out
  // a different parallelogram. Nearly parallel keeps the shape honest and still
  // reads as a plane lying down.
  const spreadK = (x, k) => cx + (x - cx) * (0.94 + 0.12 * k);

  // How deep the roof is, as fractions of frame height, split around the hero.
  //
  // These are the numbers that decide whether the thing reads as a train or as a
  // plaza. The hero is ~65px for 1.8m, so a metre is ~36px; a carriage is about
  // 3m across, which is ~115px of visible roof. Running the decking from the far
  // beam all the way to the bottom of the frame gave 248px — near seven metres —
  // and no amount of surface detail talks you out of a surface that wide.
  //
  // So the roof gets a NEAR edge too, and below it the drop. Both edges visible
  // is what fixes the scale: you can see the whole width of the thing you are on.
  const DECK_ABOVE = 0.063; // roof visible behind the hero
  const DECK_BELOW = 0.097; // roof visible in front of him

  function drawTrainDeck(t) {
    const st = ACT_STYLE[actId];
    const beamH = Math.max(13, H * 0.030);
    const deckTop = groundY - H * DECK_ABOVE;   // far edge of the roof
    const deckEnd = groundY + H * DECK_BELOW;   // near edge of the roof
    const beamY = deckTop - beamH;              // the car's far side
    const depth = deckEnd - deckTop;

    // ---- below the near edge: the drop, with the ground tearing past on world time
    const voidG = ctx.createLinearGradient(0, deckEnd, 0, H);
    voidG.addColorStop(0, 'rgba(0, 1, 3, 0.99)');
    voidG.addColorStop(1, 'rgba(4, 7, 15, 0.97)');
    ctx.fillStyle = voidG;
    ctx.fillRect(0, deckEnd, W, H - deckEnd);
    // Nothing moves down here. Streaking the guideway through the drop looked
    // like something loose running along the bottom of the frame: it is the one
    // band the eye has no reason to be in, so motion there reads as a fault
    // rather than as speed. The city and the coupling gaps carry that already.

    // ---- the roof plating
    const plate = ctx.createLinearGradient(0, deckTop, 0, deckEnd);
    plate.addColorStop(0, 'rgba(15, 19, 32, 0.97)');
    plate.addColorStop(0.5, 'rgba(25, 30, 47, 0.96)');
    plate.addColorStop(1, 'rgba(13, 17, 28, 0.97)');
    ctx.fillStyle = plate;
    ctx.fillRect(0, deckTop, W, depth);

    ctx.save();
    // Clip exactly to the decking. This used to allow 40px of overhang so the
    // ribs' lit crowns would not be cut — but the beam is only ~22px thick, so
    // the ribs came out the top of it as loose stripes over the city.
    ctx.beginPath(); ctx.rect(0, deckTop, W, depth); ctx.clip();

    // ribs at roughly 25cm, derived from the depth rather than a fixed count so
    // the spacing stays honest if the proportions are ever retuned
    const RIBS = Math.max(6, Math.round(depth / 9));
    for (let i = 1; i <= RIBS; i++) {
      const k = i / RIBS;
      const y = deckTop + depth * k * k;
      ctx.strokeStyle = `rgba(2, 4, 10, ${0.4 + 0.22 * k})`;
      ctx.lineWidth = 1 + 0.9 * k;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.strokeStyle = `rgba(140, 168, 205, ${0.09 + 0.12 * k})`;
      ctx.lineWidth = 1;
      const yl = y - 1.1 - k * 0.5;
      ctx.beginPath(); ctx.moveTo(0, yl); ctx.lineTo(W, yl); ctx.stroke();
    }

    // Status lights sit along the car's EDGE — in the reference they run down the
    // lip of a raised section, not sprinkled over the whole roof. Sparse, and
    // kept inside the carriage so none lands in a coupling gap.
    const ledOff = carOffset();
    const ledY = deckEnd - 7;
    for (let g = -ledOff - CAR_LEN; g < W + CAR_LEN * 2; g += CAR_LEN) {
      for (let n = 0; n < 5; n++) {
        const x = spreadK(g + CAR_LEN * (0.3 + n * 0.1), 1);
        if (x < -20 || x > W + 20) continue;
        ctx.fillStyle = 'rgba(90, 240, 150, 0.45)';
        ctx.fillRect(x, ledY, 3, 3);
      }
    }
    ctx.restore();

    // ---- the near edge: a thin lip and the shadow the car casts into the air
    ctx.save();
    ctx.fillStyle = 'rgba(70, 84, 106, 0.85)';
    ctx.fillRect(0, deckEnd - 2, W, 3);
    ctx.fillStyle = 'rgba(150, 175, 210, 0.22)';
    ctx.fillRect(0, deckEnd - 2, W, 1);
    const lipShadow = ctx.createLinearGradient(0, deckEnd + 1, 0, deckEnd + 22);
    lipShadow.addColorStop(0, 'rgba(0, 1, 4, 0.85)');
    lipShadow.addColorStop(1, 'transparent');
    ctx.fillStyle = lipShadow;
    ctx.fillRect(0, deckEnd + 1, W, 22);
    ctx.restore();

    // ---- the body below the near lip.
    //
    // Strictly, from above the roof plane the car's own flank is hidden — but a
    // bare drop under the lip leaves the roof floating with nothing holding it
    // up. A sliver of side panel with the carriage lit from within is what says
    // there is a vehicle down there, and the lit windows are the single most
    // train-like thing available once the wheels are gone.
    ctx.save();
    const bodyH = H * 0.055;
    const body = ctx.createLinearGradient(0, deckEnd, 0, deckEnd + bodyH);
    body.addColorStop(0, 'rgba(21, 26, 38, 0.98)');
    body.addColorStop(0.55, 'rgba(13, 17, 27, 0.98)');
    body.addColorStop(1, 'rgba(2, 4, 9, 0.98)');
    ctx.fillStyle = body;
    ctx.fillRect(0, deckEnd, W, bodyH);
    // Furniture is placed PER CARRIAGE, at fractions of the car's own length with
    // a margin at both ends. Laid out on a global grid, as it was, panels sat
    // wherever they fell and got sliced in half by the coupling gaps — and there
    // were far too many of them besides.
    const carOff = carOffset();
    for (let g = -carOff - CAR_LEN; g < W + CAR_LEN * 2; g += CAR_LEN) {
      for (const at of [0.22, 0.55, 0.8]) {
        const x = spreadK(g + CAR_LEN * at, 1);
        if (x < -120 || x > W + 120) continue;
        ctx.fillStyle = 'rgba(30, 37, 52, 0.65)';
        ctx.fillRect(x, deckEnd + bodyH * 0.2, 52, bodyH * 0.3);
        ctx.fillStyle = 'rgba(6, 9, 16, 0.55)';
        for (let v = 0; v < 4; v++) {
          ctx.fillRect(x + 4 + v * 13, deckEnd + bodyH * 0.23, 6, bodyH * 0.24);
        }
      }
      // one marker lamp per car, low on the flank
      const mx = spreadK(g + CAR_LEN * 0.5, 1);
      if (mx > -40 && mx < W + 40) {
        ctx.fillStyle = 'rgba(120, 200, 255, 0.22)';
        ctx.fillRect(mx, deckEnd + bodyH * 0.72, 16, 2);
      }
    }
    // The same magnetic cushion on the NEAR side: light spilling from under the car's
    // own flank into the drop. The far edge alone read as a vehicle lit along one side;
    // with both, the whole car floats — the levitation is under all of it, not just the
    // rim by the horizon. Brightest at the hull's underside, bleeding down into the void.
    const cushY = deckEnd + bodyH;
    ctx.globalCompositeOperation = 'lighter';
    const nearLift = ctx.createLinearGradient(0, cushY - 2, 0, cushY + 32);
    nearLift.addColorStop(0, st.accent2 + 'a6');
    nearLift.addColorStop(0.28, st.accent2 + '2e');
    nearLift.addColorStop(1, 'transparent');
    ctx.fillStyle = nearLift;
    ctx.fillRect(0, cushY - 2, W, 34);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, cushY - 1, W, 2); // the hot core hugging the underside
    ctx.restore();

    // ---- the far side: a smooth mag-tech shell with a top face, not riveted steel
    ctx.save();
    const topH = Math.max(3, beamH * 0.28);
    const face = ctx.createLinearGradient(0, beamY + topH, 0, beamY + beamH);
    face.addColorStop(0, 'rgba(44, 52, 68, 0.99)');
    face.addColorStop(0.45, 'rgba(31, 38, 52, 0.99)');
    face.addColorStop(1, 'rgba(14, 18, 27, 0.99)');
    ctx.fillStyle = face;
    ctx.fillRect(0, beamY + topH, W, beamH - topH);
    const cap = ctx.createLinearGradient(0, beamY, 0, beamY + topH);
    cap.addColorStop(0, 'rgba(96, 112, 138, 0.95)');
    cap.addColorStop(1, 'rgba(58, 68, 88, 0.97)');
    ctx.fillStyle = cap;
    ctx.fillRect(0, beamY, W, topH);
    ctx.fillStyle = 'rgba(150, 172, 205, 0.3)';
    ctx.fillRect(0, beamY, W, 1);
    ctx.fillStyle = 'rgba(6, 9, 15, 0.5)';
    ctx.fillRect(0, beamY + topH, W, 1.5);
    // A lit waistline runs the length of the car — a smooth mag-tech shell, not
    // riveted steel. Rivets are the anatomy of an old mechanical train; a maglev is
    // a clean panel lit from within, and this strip is what carries that read. The
    // coupling gaps punch through it below, so each carriage gets its own segment.
    const stripY = beamY + topH + (beamH - topH) * 0.42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const strip = ctx.createLinearGradient(0, stripY - 3.5, 0, stripY + 4.5);
    strip.addColorStop(0, 'transparent');
    strip.addColorStop(0.5, st.accent2);
    strip.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = strip;
    ctx.fillRect(0, stripY - 3.5, W, 8);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, stripY, W, 1.2);
    ctx.restore();
    const cast = ctx.createLinearGradient(0, beamY + beamH, 0, beamY + beamH + beamH * 1.1);
    cast.addColorStop(0, 'rgba(0, 2, 6, 0.55)');
    cast.addColorStop(1, 'transparent');
    ctx.fillStyle = cast;
    ctx.fillRect(0, beamY + beamH, W, beamH * 1.1);
    ctx.restore();

    // ---- The coupling gaps, punched through everything.
    //
    // Drawn last and spanning the full body — far beam, decking and near lip —
    // because a carriage ends there. Cut only through the decking, as they were
    // at first, the two edges ran on unbroken across the gap and the train became
    // one continuous object with slots milled into its top.
    ctx.save();
    const off = carOffset();
    const flankEnd = deckEnd + H * 0.055;
    for (let g = -off - CAR_LEN; g < W + CAR_LEN * 2; g += CAR_LEN) {
      const wSlot = 20;
      // Across the roof the gap is a cross-member, so it fans with depth like the
      // roadway grid. Down the flank it must be plumb: that face is a vertical
      // plane, and carrying the roof's diagonal onto it sheared the carriage.
      const x0t = spreadK(g, 0), x1t = spreadK(g + wSlot, 0);
      const x0b = spreadK(g, 1), x1b = spreadK(g + wSlot, 1);
      ctx.beginPath();
      ctx.moveTo(x0t, beamY); ctx.lineTo(x1t, beamY);
      ctx.lineTo(x1b, deckEnd); ctx.lineTo(x1b, flankEnd);
      ctx.lineTo(x0b, flankEnd); ctx.lineTo(x0b, deckEnd);
      ctx.closePath();
      ctx.fillStyle = 'rgba(1, 2, 6, 0.98)';
      ctx.fill();
      // the next carriage's leading face catching light
      ctx.strokeStyle = 'rgba(120, 205, 235, 0.26)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1t, beamY); ctx.lineTo(x1b, deckEnd); ctx.lineTo(x1b, flankEnd);
      ctx.stroke();
    }
    ctx.restore();

    // The magnetic cushion the car floats on — no wheels, it rides a field of light.
    // This is the single strongest "maglev, not train" cue, so it is a real glow now,
    // not a hint: a bright band of levitation light escaping from under the far side,
    // brightest right at the hull and bleeding up toward the city.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lift = ctx.createLinearGradient(0, beamY - 34, 0, beamY + 2);
    lift.addColorStop(0, 'transparent');
    lift.addColorStop(0.7, st.accent2 + '30');
    lift.addColorStop(1, st.accent2 + 'b0');
    ctx.fillStyle = lift;
    ctx.fillRect(0, beamY - 34, W, 36);
    // the hot core of the cushion, a thin bright line hugging the hull
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, beamY - 1.5, W, 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- Rooftop deck (the summit act) ----------
  // The train's problem was that its roof is NARROW: both edges had to be in frame
  // or the scale lied. A rooftop has the opposite problem — it is wide, and the
  // only edge that matters is the far one, because that edge is what tells you how
  // high you are. So the surface runs from just behind the hero to the bottom of
  // the frame, exactly like the roadway it replaces, and all the work goes into the
  // parapet: a wall that crops the towers behind it off at the ankles.
  // ROOF_ABOVE stays small on purpose. The slab is opaque and it is painted after
  // the landmark, so every pixel of roof above the ground line eats the foot of the
  // torii and the base of the sakura's trunk — a tree cut off at the ankle reads as
  // buried, not as standing behind something. A hint of surface is enough; the wall
  // does the actual work of saying "edge".
  //
  // The parapet's height is then bounded from the other side: it must stay under the
  // shortest silhouette in the ultra-far row (SKYLINE_K · 0.10 · H) or that whole
  // plane disappears behind it and the skyline comes out gap-toothed.
  // The first pass made this wall 18px and the roof read as a plaza: the towers
  // were cropped exactly at the ground line, which is also where a building standing
  // on our own level would meet it, so nothing said they were below us. The wall has
  // to be thick enough to eat a visible bite out of them.
  const ROOF_ABOVE = 0.012;  // roof surface visible behind the hero, as a share of H
  const PARAPET_H = 0.042;   // the wall beyond it, measured up from that surface
  const SEA_H = 0.105;       // the bay's water band, from the ground line up
  const SHIP_ABOVE = 0.014;  // ship deck visible past the hero before the railing

  // The leviathan's deck: hull edge and railing at the horizon, welded plating
  // running aft, and container stacks riding the deck clock — they are cargo on
  // OUR ship, so they travel with the hero, and the gaps between stacks are
  // where the bay shows through.
  function drawShipDeck(t) {
    const st = ACT_STYLE[actId];
    const deckTop = groundY - H * SHIP_ABOVE;
    const depth = H - deckTop;
    const dsp = (x, sp) => { const m = ((x - deckScroll()) % sp + sp) % sp; return m; };

    // ---- container stacks first: they stand behind the railing line
    ctx.save();
    const P = bgCache.P;
    for (const cg of bgCache.cargo) {
      const m = ((cg.x - deckScroll()) % P + P) % P;
      for (const sx of [m, m - P]) {
        if (sx + cg.w < -40 || sx > W + 40) continue;
        for (let tier = 0; tier < cg.tiers; tier++) {
          const bh = 24 * S, by = deckTop + 2 - (tier + 1) * bh;
          // solid steel first, ribs second: the box must read as mass, not wireframe
          ctx.fillStyle = ['#1a2836', '#2b202e', '#1a2e2b'][cg.tone];
          ctx.fillRect(sx, by, cg.w, bh);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          for (let rx = sx + 5; rx < sx + cg.w - 5; rx += 9) {
            ctx.fillRect(rx, by + 2, 2.5, bh - 4); // corrugation
          }
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillRect(sx, by, cg.w, 2); // moonlit top edge
          ctx.strokeStyle = 'rgba(63, 217, 232, 0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, by + 0.5, cg.w - 1, bh - 1);
        }
        if (cg.glyph) {
          ctx.fillStyle = 'rgba(255, 194, 102, 0.4)';
          ctx.font = `${Math.round(13 * S)}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.fillText(cg.glyph, sx + 8, deckTop - 24 * S * (cg.tiers - 1) - 8);
        }
        // lashing rods: the stack is tied INTO the ship, not parked on it
        const topL = deckTop + 2 - cg.tiers * 24 * S;
        ctx.strokeStyle = 'rgba(120, 130, 145, 0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + 3, topL + 3);
        ctx.lineTo(sx - 14, deckTop + 2);
        ctx.moveTo(sx + cg.w - 3, topL + 3);
        ctx.lineTo(sx + cg.w + 14, deckTop + 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ---- the fore-mast: the deck's one vertical, standing against the bay
    ctx.save();
    const P2 = bgCache.P;
    for (const pr of bgCache.deckProps) {
      if (pr.type !== 'mast') continue;
      const m2 = ((pr.x - deckScroll()) % P2 + P2) % P2;
      for (const sx of [m2, m2 - P2]) {
        if (sx < -120 || sx > W + 120) continue;
        const mh = H * 0.30, baseY = deckTop + 2, topM = baseY - mh;
        ctx.fillStyle = 'rgba(7, 9, 15, 0.97)';
        ctx.fillRect(sx - 2.2, topM, 4.4, mh);
        ctx.fillRect(sx - 20, topM + 14, 40, 3.5); // cross-arm
        ctx.fillRect(sx - 1.5, topM - 8, 3, 8);    // top stub
        // stays down to the deck
        ctx.strokeStyle = 'rgba(7, 9, 15, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - 20, topM + 16); ctx.lineTo(sx - 44, baseY);
        ctx.moveTo(sx + 20, topM + 16); ctx.lineTo(sx + 44, baseY);
        ctx.stroke();
        // masthead beacon
        if (Math.sin(t * 2.1 + pr.ph) > 0.35) {
          ctx.fillStyle = '#ff4d5e';
          ctx.shadowColor = '#ff4d5e';
          ctx.shadowBlur = 8;
          ctx.fillRect(sx - 2, topM - 12, 4, 4);
          ctx.shadowBlur = 0;
        }
        // the working floodlight on the cross-arm, washing its patch of deck
        const lampY = topM + 19;
        ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
        ctx.fillRect(sx + 14, lampY - 2, 5, 4);
        ctx.fillStyle = grad('mastCone', () => {
          const g = ctx.createLinearGradient(0, lampY, 0, H * 0.9);
          g.addColorStop(0, 'rgba(200, 230, 255, 0.055)');
          g.addColorStop(1, 'transparent');
          return g;
        });
        ctx.beginPath();
        ctx.moveTo(sx + 16, lampY);
        ctx.lineTo(sx + 16 - 34, H * 0.9);
        ctx.lineTo(sx + 16 + 58, H * 0.9);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // ---- hull edge + railing
    ctx.save();
    ctx.fillStyle = 'rgba(6, 8, 14, 0.995)';
    ctx.fillRect(0, deckTop - 3 * S, W, 3 * S); // bulwark lip
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, deckTop - 3 * S, W, 1.2); // the line the eye reads as the edge
    ctx.globalAlpha = 1;
    const rsp = 96;
    for (let rx = -dsp(0, rsp); rx < W + rsp; rx += rsp) {
      ctx.fillStyle = 'rgba(8, 10, 16, 0.9)';
      ctx.fillRect(rx, deckTop - 14 * S, 2.2, 11 * S); // stanchion
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, deckTop - 14 * S, W, 1); // top rail
    ctx.restore();

    // ---- plating
    ctx.fillStyle = grad('shipDeck', () => {
      const g = ctx.createLinearGradient(0, deckTop, 0, H);
      g.addColorStop(0, '#0d1119');
      g.addColorStop(1, '#04060a');
      return g;
    });
    ctx.fillRect(0, deckTop, W, depth);
    // shore light spilling over the plating
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad('shipSpill', () => {
      const g = ctx.createLinearGradient(0, deckTop, 0, deckTop + depth * 0.3);
      g.addColorStop(0, st.accent + '16');
      g.addColorStop(1, 'transparent');
      return g;
    });
    ctx.fillRect(0, deckTop, W, depth * 0.3);
    ctx.restore();
    // weld seams: horizontals bunch toward the far edge, verticals ride the deck
    ctx.save();
    ctx.strokeStyle = '#000';
    for (let i = 1; i <= 5; i++) {
      const k = i / 5;
      ctx.globalAlpha = 0.24 + 0.18 * k;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, deckTop + k * k * depth);
      ctx.lineTo(W, deckTop + k * k * depth);
      ctx.stroke();
    }
    const psp = 148;
    ctx.globalAlpha = 0.3;
    for (let px2 = -dsp(0, psp); px2 < W + psp; px2 += psp) {
      ctx.beginPath();
      ctx.moveTo(px2, deckTop);
      ctx.lineTo(px2 + (px2 - cx) * 0.10, H);
      ctx.stroke();
    }
    // lashing strips: paired dim rows where the containers would be tied down
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = st.accent;
    for (const ky of [0.32, 0.36, 0.72, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(0, deckTop + ky * depth);
      ctx.lineTo(W, deckTop + ky * depth);
      ctx.stroke();
    }
    ctx.restore();

    // ---- wet steel: container light smeared down the plating under each stack
    ctx.save();
    for (const cg of bgCache.cargo) {
      const m3 = ((cg.x - deckScroll()) % P + P) % P;
      for (const sx of [m3, m3 - P]) {
        if (sx + cg.w < -40 || sx > W + 40) continue;
        ctx.fillStyle = grad('wetSmear', () => {
          const g = ctx.createLinearGradient(0, deckTop, 0, deckTop + 34);
          g.addColorStop(0, 'rgba(63, 217, 232, 0.05)');
          g.addColorStop(1, 'transparent');
          return g;
        });
        ctx.fillRect(sx + cg.w * 0.1, deckTop, cg.w * 0.8, 34);
      }
    }
    ctx.restore();

    // ---- bollards, winches and bay stencils: the deck's working clutter
    ctx.save();
    for (const pr of bgCache.deckProps) {
      if (pr.type === 'mast') continue;
      const m3 = ((pr.x - deckScroll()) % P + P) % P;
      for (const sx of [m3, m3 - P]) {
        if (sx < -80 || sx > W + 80) continue;
        if (pr.type === 'bollard') {
          const y = deckTop + 9 * S;
          ctx.fillStyle = 'rgba(7, 9, 15, 0.96)';
          for (const bx of [sx - 8, sx + 8]) {
            ctx.fillRect(bx - 2.5, y - 8, 5, 9);   // post
            ctx.fillRect(bx - 4.5, y - 10, 9, 3);  // cap
          }
          // the rope coil beside the pair
          ctx.strokeStyle = 'rgba(96, 84, 72, 0.55)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.ellipse(sx + 22, y + 2, 8, 3.2, 0, 0, 7);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(sx + 22, y + 2, 4.5, 1.8, 0, 0, 7);
          ctx.stroke();
        } else if (pr.type === 'winch') {
          const y = deckTop + 10 * S;
          ctx.fillStyle = 'rgba(7, 9, 15, 0.96)';
          ctx.fillRect(sx - 11, y - 11, 22, 13);   // drum housing
          ctx.beginPath(); ctx.arc(sx - 11, y - 4.5, 6.2, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(sx + 11, y - 4.5, 6.2, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(96, 84, 72, 0.5)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); // cable running off to the railing
          ctx.moveTo(sx, y - 11);
          ctx.quadraticCurveTo(sx + 26, y - 16, sx + 44, deckTop - 3 * S);
          ctx.stroke();
        } else if (pr.type === 'stencil') {
          // bay number painted on the plates, foreshortened and half worn away
          ctx.save();
          ctx.translate(sx, deckTop + depth * 0.42);
          ctx.scale(1, 0.55);
          ctx.font = `bold ${Math.round(34 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255, 194, 102, 0.11)';
          ctx.fillText((pr.n < 10 ? '0' : '') + pr.n, 0, 0);
          ctx.restore();
          ctx.strokeStyle = 'rgba(255, 194, 102, 0.07)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx - 46, deckTop + depth * 0.47);
          ctx.lineTo(sx + 46, deckTop + depth * 0.47);
          ctx.stroke();
        }
      }
    }
    // hazard hatching along the near edge of the frame — the deck ends somewhere
    const hz = H - 20;
    ctx.globalAlpha = 0.35;
    const hsp = 30;
    const hoff = (deckScroll() % hsp + hsp) % hsp;
    ctx.strokeStyle = 'rgba(255, 194, 102, 0.16)';
    ctx.lineWidth = 5;
    for (let hx = -hoff - hsp; hx < W + hsp; hx += hsp) {
      ctx.beginPath();
      ctx.moveTo(hx, H);
      ctx.lineTo(hx + 14, hz);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The market's floor: worn warm stone in a running bond, wet enough to keep
  // its reflections. Deliberately NOT the street's synthwave grid — the lower
  // third of the frame is where the two acts used to be twins.
  function drawPavedDeck(t) {
    const gh = H - groundY;
    ctx.fillStyle = grad('pavedBase', () => {
      const g = ctx.createLinearGradient(0, groundY, 0, H);
      g.addColorStop(0, '#191016');
      g.addColorStop(1, '#070409');
      return g;
    });
    ctx.fillRect(0, groundY, W, gh);
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 110, 90, 1)';
    ctx.lineWidth = 1;
    // course lines bunching toward the horizon
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      const k = i / 8;
      rows.push(groundY + k * k * gh);
      ctx.globalAlpha = 0.05 + 0.09 * k;
      ctx.beginPath();
      ctx.moveTo(0, rows[i - 1]);
      ctx.lineTo(W, rows[i - 1]);
      ctx.stroke();
    }
    // running bond: joints offset half a stone on alternating courses, riding
    // the deck clock so the floor walks with the hero
    for (let i = 0; i < rows.length - 1; i++) {
      const y1 = rows[i], y2 = rows[i + 1];
      const k = (i + 1) / 8;
      const sp = 60 + 150 * k; // nearer courses use bigger stones
      const phase = (i % 2) * sp / 2;
      const off = ((deckScroll() * (0.6 + 0.4 * k) + phase) % sp + sp) % sp;
      ctx.globalAlpha = 0.045 + 0.075 * k;
      for (let jx = -off; jx < W + sp; jx += sp) {
        ctx.beginPath();
        ctx.moveTo(jx, y1);
        ctx.lineTo(jx + (jx - cx) * 0.06, y2);
        ctx.stroke();
      }
    }
    ctx.restore();
    drawStallPools(t);
  }

  function drawRoofDeck(t) {
    const st = ACT_STYLE[actId];
    const deckTop = groundY - H * ROOF_ABOVE;
    const capY = deckTop - H * PARAPET_H;
    const capH = Math.max(4, 6 * S);
    const depth = H - deckTop;

    // ---- the parapet: the one opaque thing between us and the city
    ctx.save();
    // The face is in its own shadow — darker than anything behind it, so the towers
    // it crops stay legible right up to the cut.
    const wallG = ctx.createLinearGradient(0, capY, 0, deckTop);
    wallG.addColorStop(0, 'rgba(11, 9, 18, 0.995)');
    wallG.addColorStop(1, 'rgba(4, 3, 8, 0.995)');
    ctx.fillStyle = wallG;
    ctx.fillRect(0, capY, W, deckTop - capY);
    // Coping — the top face, the one surface up here angled to catch the moon. It
    // also takes over the job the neon horizon line used to do (it is the line the
    // eye reads as "ground level"), so it keeps the accent, laid on a stone edge
    // instead of floating in the air.
    ctx.fillStyle = 'rgba(31, 27, 44, 0.995)';
    ctx.fillRect(0, capY, W, capH);
    ctx.globalAlpha = 0.46;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, capY, W, 1.3);
    // a hard shadow under the lip, so the cap reads as sitting proud of the face
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, capY + capH, W, 1.4);
    // Coping joints. They ride the deck clock like everything else the hero stands
    // on — the wall is part of his roof, not part of the city, and when he moves it
    // has to move with him or the roof turns into a painted backdrop.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    const jsp = 132;
    const joff = (deckScroll() % jsp + jsp) % jsp;
    for (let jx = -joff; jx < W + jsp; jx += jsp) {
      ctx.fillRect(jx, capY, 1.2, deckTop - capY);
    }
    ctx.restore();

    // ---- the surface
    const g = ctx.createLinearGradient(0, deckTop, 0, H);
    g.addColorStop(0, '#0f0e18');
    g.addColorStop(1, '#050508');
    ctx.fillStyle = g;
    ctx.fillRect(0, deckTop, W, depth);
    // City light spilling over the parapet onto the concrete. Without it the wall
    // and the slab read as two unrelated flat greys stacked on each other.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spill = ctx.createLinearGradient(0, deckTop, 0, deckTop + depth * 0.34);
    spill.addColorStop(0, st.accent + '1c');
    spill.addColorStop(1, 'transparent');
    ctx.fillStyle = spill;
    ctx.fillRect(0, deckTop, W, depth * 0.34);
    ctx.restore();

    // ---- slab joints. Same perspective law as the roadway grid: horizontals bunch
    // towards the far edge with k*k, verticals fan out from centre with depth. What
    // changes is the reading — dim, cool grey and wider apart, so it says poured
    // concrete rather than synthwave floor.
    ctx.save();
    ctx.strokeStyle = '#7f8aa8';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      ctx.globalAlpha = 0.020 + 0.030 * k;
      const y = deckTop + k * k * depth;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    const gsp = 210;
    const goff = (deckScroll() % gsp + gsp) % gsp;
    for (let gx = -goff - gsp * 7; gx < W + gsp * 7; gx += gsp) {
      const dx = gx - cx;
      ctx.globalAlpha = 0.035;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.3, deckTop);
      ctx.lineTo(cx + dx * 1.7, H);
      ctx.stroke();
    }
    ctx.restore();

    // ---- moonlight on dry stone: a wash, not a mirror trail. The road version
    // reflects because it is wet; this one only lightens the slab it falls on.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(W * 0.68, deckTop);
    ctx.scale(1, depth / (H * 0.10));
    const mg = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.16);
    mg.addColorStop(0, 'rgba(214, 232, 255, 0.055)');
    mg.addColorStop(1, 'transparent');
    ctx.fillStyle = mg;
    ctx.fillRect(-H * 0.16, 0, H * 0.32, H * 0.16);
    ctx.restore();

    // ---- what stands on the roof with us, over the parapet rather than behind it.
    // Same parallax and the same tiling as the city version — only the moment of
    // painting differs, so the torii keeps its place in the depth stack.
    if (has('deckLandmark') && bgCache) {
      const P = bgCache.P;
      drawLandmark((x, factor) => {
        let sx = (x - worldScroll() * factor) % P;
        if (sx < 0) sx += P;
        return sx;
      }, t);
    }

    // ---- the petals that already landed
    if (bgCache && bgCache.fallen.length) {
      const P = bgCache.P;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 122, 217, 1)';
      for (const p of bgCache.fallen) {
        const y = deckTop + p.k * p.k * depth;
        const sc = 0.45 + p.k * 1.25;   // farther up the slab is farther away
        let sx = (p.x - deckScroll()) % P;
        if (sx < 0) sx += P;
        for (const xx of [sx, sx - P]) {
          if (xx < -20 || xx > W + 20) continue;
          ctx.globalAlpha = 0.13 + 0.20 * p.k;
          ctx.beginPath();
          // squashed on Y because we look across the floor, not down at it
          ctx.ellipse(xx, y, p.sz * sc, p.sz * sc * 0.42, p.rot, 0, 7);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function drawGroundFx(t) {
    const st = ACT_STYLE[actId];
    // reflections fade with depth
    const fade = ctx.createLinearGradient(0, groundY, 0, groundY + 150);
    fade.addColorStop(0, 'rgba(3, 3, 9, 0)');
    fade.addColorStop(1, 'rgba(3, 3, 9, 0.9)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, groundY, W, H - groundY);

    if (scene().deck === 'train') { drawTrainDeck(t); }
    else if (scene().deck === 'roof') { drawRoofDeck(t); }
    else if (scene().deck === 'ship') { drawShipDeck(t); }
    else if (scene().deck === 'paved') { drawPavedDeck(t); }
    else {
    // synthwave perspective: horizontals bunch toward the horizon, verticals fly 1:1
    ctx.save();
    ctx.strokeStyle = st.accent2;
    ctx.lineWidth = 1;
    const gh = H - groundY;
    for (let i = 1; i <= 7; i++) {
      const k = i / 7;
      ctx.globalAlpha = 0.022 + 0.05 * k;
      ctx.beginPath();
      ctx.moveTo(0, groundY + k * k * gh);
      ctx.lineTo(W, groundY + k * k * gh);
      ctx.stroke();
    }
    const gsp = 150;
    const goff = (deckScroll() % gsp + gsp) % gsp;
    for (let gx = -goff - gsp * 7; gx < W + gsp * 7; gx += gsp) {
      const dx = gx - cx;
      ctx.globalAlpha = 0.045;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.3, groundY);
      ctx.lineTo(cx + dx * 1.7, H);
      ctx.stroke();
    }
    ctx.restore();
    }

    // puddles: bright mirror patches with a neon rim + rain rings
    if (bgCache) {
      const P = bgCache.P;
      ctx.save();
      for (const pd of bgCache.puddles) {
        let sx = (pd.x - deckScroll()) % P;
        if (sx < 0) sx += P;
        for (const xx of [sx, sx - P]) {
          if (xx < -pd.w - 40 || xx > W + 40) continue;
          ctx.globalAlpha = 0.10;
          ctx.fillStyle = st.mid;
          ctx.beginPath();
          ctx.ellipse(xx, pd.y, pd.w / 2, pd.h / 2, 0, 0, 7);
          ctx.fill();
          ctx.globalAlpha = 0.14;
          ctx.strokeStyle = st.accent2;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(xx, pd.y, pd.w / 2, pd.h / 2, 0, Math.PI * 1.05, Math.PI * 1.95);
          ctx.stroke();
        }
      }
      // raindrop rings, while it is actually raining
      if (running('rain')) {
        if (t - lastRainRing > 0.09) {
          lastRainRing = t;
          const pd = bgCache.puddles[(Math.random() * bgCache.puddles.length) | 0];
          rainRings.push({ px: pd.x + (Math.random() - 0.5) * pd.w * 0.8, py: pd.y, t0: t });
        }
        for (const rr2 of rainRings) {
          const k = (t - rr2.t0) / 0.7;
          if (k >= 1) continue;
          let sx = (rr2.px - deckScroll()) % P;
          if (sx < 0) sx += P;
          ctx.globalAlpha = 0.22 * (1 - k);
          ctx.strokeStyle = '#bfefff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(sx, rr2.py, 2 + k * 16, (2 + k * 16) * 0.3, 0, 0, 7);
          ctx.stroke();
        }
        rainRings = rainRings.filter(r => t - r.t0 < 0.7);
      }
      ctx.restore();
    }

    // ripples: dark streaks drift, occasionally with a light edge
    ctx.save();
    for (let i = 0; i < 14; i++) {
      const y = groundY + 8 + (i * 37) % Math.max(20, H - groundY - 16);
      const sp = 6 + (i % 3) * 5;
      const x = ((i * 211 + t * sp * 6) % (W + 240)) - 120;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#04040c';
      ctx.fillRect(x, y, 60 + (i % 4) * 30, 1.6);
      if (i % 3 === 0) {
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = st.accent2;
        ctx.fillRect(x + 26, y + 1.6, 44, 1);
      }
    }
    ctx.restore();
    // parapet: a dark strip with a neon edge
    const curbH = 15 * S;
    ctx.fillStyle = '#030308';
    ctx.fillRect(0, H - curbH, W, curbH);
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = st.accent2;
    ctx.fillRect(0, H - curbH, W, 1.6);
    ctx.restore();
  }

  // ---------- Near plane ----------
  // Drawn last of the world layers, over the fighters, at parallax 1.3 — faster
  // than anything else on screen, which is the whole point: a plane that slides
  // past quicker than the city is a plane the eye places in front of it. Stays
  // in the top third; see the rig's note in buildBgCache for why.
  // A sakura branch framing the top-left corner. Foreground foliage: it lives in the
  // upper region, never reaches the fighting band, and it does not scroll — the whole
  // limb rotates a few hundredths of a radian about its corner anchor, so the tips
  // (farthest from the pivot) drift most, exactly as a real branch would. Drawn after
  // the fighters, so it reads as the nearest thing on screen.
  function drawBranch(t) {
    if (!fx0.foreground || !has('branch') || !bgCache || !bgCache.branch.limb.length) return;
    const br = bgCache.branch;
    const th = Math.sin(t * 0.55) * 0.026 + Math.sin(t * 1.7) * 0.011; // sway angle
    const ax = br.limb[0].x * W, ay = br.limb[0].y * H;
    const cs = Math.cos(th), sn = Math.sin(th);
    const M = n => {
      const x = n.x * W - ax, y = n.y * H - ay;
      return { x: ax + x * cs - y * sn, y: ay + x * sn + y * cs };
    };

    ctx.save();
    // limb: a dark tapering silhouette from the corner outward
    ctx.strokeStyle = 'rgba(10, 6, 12, 0.97)';
    ctx.lineCap = 'round';
    for (let i = 0; i < br.limb.length - 1; i++) {
      const a = M(br.limb[i]), b = M(br.limb[i + 1]);
      ctx.lineWidth = (14 - i * 1.7) * S;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // twigs, thinner
    ctx.strokeStyle = 'rgba(12, 7, 13, 0.96)';
    for (const tw of br.twigs) {
      const a = M({ x: tw.x1, y: tw.y1 }), b = M({ x: tw.x2, y: tw.y2 });
      ctx.lineWidth = Math.max(2.2, tw.w * 1.3) * S;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // blossoms: a soft dark mass with brighter petals catching the moon on top of it
    for (const bl of br.blossoms) {
      const p = M(bl);
      // the cluster breathes on its own phase and drifts a hair extra at the tips
      const breath = 0.85 + 0.15 * Math.sin(bl.ph + t * 1.3);
      const r = bl.r * W * breath;
      const px = p.x + Math.sin(t * 1.4 + bl.ph) * bl.lean * 2.2 * S;
      // shadowed underside of the cluster
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(74, 26, 54, 1)';
      ctx.beginPath();
      ctx.arc(px, p.y, r, 0, 7);
      ctx.fill();
      // lit petals — a few overlapping blobs, moon side brighter
      for (let k = 0; k < 5; k++) {
        const a = bl.ph + k * 1.257;
        const rr2 = r * (0.42 + (k % 3) * 0.12);
        const dx = Math.cos(a) * r * 0.5, dy = Math.sin(a) * r * 0.5;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = 'rgba(255, 122, 217, 1)';
        ctx.beginPath();
        ctx.arc(px + dx, p.y + dy, rr2, 0, 7);
        ctx.fill();
      }
      // a single bright core
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(255, 190, 235, 1)';
      ctx.beginPath();
      ctx.arc(px, p.y - r * 0.15, r * 0.28, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawForeground(t) {
    // 'rig' was declared by every scene and queried by none — the rail and its
    // hangers drew unconditionally, which is exactly the leak the layer list exists
    // to prevent. It only became visible when a location had no ceiling to hang
    // them from: an open roof with a beam across the top of the sky.
    if (!fx0.foreground || !bgCache || !has('rig')) return;
    const P = bgCache.P;
    const st = ACT_STYLE[actId];
    const tf = x => { let s = (x - worldScroll() * 1.3) % P; if (s < 0) s += P; return s; };
    const railH = 15 * S;
    ctx.save();
    // the rail is pure silhouette — it used to carry a neon underline, which ran
    // straight behind the armor pips and read as part of the HUD
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, W, railH);

    const rig = bgCache.fg;
    // Cables between neighbouring hangers. Skipped indoors: a line slung between
    // two uprights is the anatomy of a railing, and the new ceiling above it
    // does not need help being misread as one.
    if (has('rigCables')) {
    ctx.strokeStyle = '#02020a';
    ctx.lineWidth = 1.6 * S;
    for (let i = 0; i < rig.length; i++) {
      const a = rig[i], b = rig[(i + 1) % rig.length];
      for (const off of [0, -P]) {
        const x1 = tf(a.x) + off;
        let x2 = tf(b.x) + off;
        if (x2 < x1) x2 += P; // the pair that wraps around the seam
        if (x2 - x1 > 460 || x1 > W + 60 || x2 < -60) continue;
        const y1 = railH + a.h * 0.55 * S, y2 = railH + b.h * 0.55 * S;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 34 * S, x2, y2);
        ctx.stroke();
      }
    }
    }

    for (const g of rig) {
      for (const off of [0, -P]) {
        const x = tf(g.x) + off;
        if (x < -40 || x > W + 40) continue;
        const h = g.h * S;
        ctx.fillStyle = '#02020a';
        ctx.fillRect(x - g.w * S / 2, railH, g.w * S, h);
        if (!g.lamp) continue;
        // the lamp: a dark housing with the act's light under it. The glow is
        // additive and feeds the bloom pass, so the near plane lights up too.
        const ly = railH + h;
        ctx.fillRect(x - 7 * S, ly, 14 * S, 9 * S);
        const flick = 0.65 + 0.35 * Math.sin(g.ph + t * 1.7) ** 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.34 * flick;
        const lg = ctx.createRadialGradient(x, ly + 9 * S, 0, x, ly + 9 * S, 30 * S);
        lg.addColorStop(0, g.color);
        lg.addColorStop(1, 'transparent');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(x, ly + 9 * S, 30 * S, 0, 7);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.85 * flick;
        ctx.fillRect(x - 5 * S, ly + 8 * S, 10 * S, 2.4 * S);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  // ---------- Bloom ----------
  // Neon that does not bleed is not neon. A true threshold pass would mean
  // reading pixels back every frame, so the frame is CUBED against itself
  // instead: drawn into a quarter-size buffer, then multiplied by itself twice.
  // 1.0 stays 1.0 while 0.3 drops to 0.027 — a threshold in everything but
  // name. Squaring alone was not enough: at 0.62 alpha the mid-dark sky and the
  // wet ground still contributed a few percent each, and a few percent
  // everywhere is exactly what "washed out" means. The result comes back
  // blurred and additive.
  // The blur happens on the QUARTER-SIZE buffer, never on the finished frame.
  // Blurring at full size measured 29 ms a frame in software rasterisation; the
  // same visual radius costs a sixteenth of the area down here, and the bilinear
  // upscale on the way back spreads it further for free.
  let bloomCv = null, bloomCtx = null, blurCv = null, blurCtx = null, bloomOk = true;

  // Bloom is the only effect here with a price tag worth watching: measured in
  // software rasterisation it is ~14 ms a frame against ~1 ms for everything
  // else combined. On any GPU that is nothing, but a machine without one should
  // not be asked to choose between neon and a playable frame rate — so if the
  // achieved frame interval stays bad for a full second of real play, bloom
  // drops itself and never comes back this session. The panel can still force
  // it on; a manual toggle clears the verdict.
  let frameLast = 0, frameSlow = 0, bloomGaveUp = false;

  function watchFrameRate() {
    const now = performance.now();
    const gap = now - frameLast;
    frameLast = now;
    if (gap <= 0 || gap > 250) return; // first frame, or a tab that was asleep
    // 40 ms, not 26: a display running at 30 Hz hands out 33 ms gaps however
    // fast the machine is, and dropping the neon on a healthy 30 Hz laptop
    // would be a false positive. Below 25 fps nothing is healthy.
    frameSlow = gap > 40 ? frameSlow + gap : 0;
    if (frameSlow > 1200) {
      frameSlow = 0;
      // the degradation ladder, one rung per slow-second: first the bloom (the
      // only post pass with a real price), then the render scale, step by step
      // down to half resolution. Light, silhouettes and grain always stay —
      // they cost nothing measurable and carry the look.
      if (!bloomGaveUp) {
        bloomGaveUp = true;
        fx0.bloom = false;
      } else if (resStep < RES_STEPS.length - 1) {
        resStep++;
        resize();
      }
    }
  }

  function drawBloom() {
    if (!fx0.bloom || !bloomOk) return;
    const bw = Math.max(2, Math.round(W / 4)), bh = Math.max(2, Math.round(H / 4));
    if (!bloomCv || bloomCv.width !== bw || bloomCv.height !== bh) {
      bloomCv = document.createElement('canvas');
      blurCv = document.createElement('canvas');
      bloomCv.width = blurCv.width = bw;
      bloomCv.height = blurCv.height = bh;
      bloomCtx = bloomCv.getContext('2d');
      blurCtx = blurCv.getContext('2d');
      if (!bloomCtx || !blurCtx || !('filter' in blurCtx)) { bloomOk = false; return; }
    }
    const b = bloomCtx;
    b.globalCompositeOperation = 'copy';
    b.drawImage(cv, 0, 0, bw, bh);
    b.globalCompositeOperation = 'multiply';
    b.drawImage(cv, 0, 0, bw, bh);
    b.drawImage(cv, 0, 0, bw, bh);
    blurCtx.globalCompositeOperation = 'copy';
    blurCtx.filter = `blur(${Math.max(1, Math.round(1.6 * S))}px)`;
    blurCtx.drawImage(bloomCv, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(blurCv, 0, 0, W, H);
    ctx.restore();
  }

  // ---------- Chromatic aberration: tried, cut ----------
  // Two versions were built and both were wrong for this game.
  //
  // Additive (tinted copies of the frame added back over it) is not aberration
  // at all: red and blue are already in the picture, so adding them again lifts
  // every black and washes the frame magenta.
  //
  // Correct (rebuild the frame from its three channels, each drawn at its own
  // scale) has no wash — but it resamples the entire frame twice, and this game
  // snaps sprite scale to whole numbers precisely so that one source pixel lands
  // as exactly N by N on screen (see resize()). At the edges the fighters came
  // out ghosted and the pixel grid came out soft: a post effect cannot be
  // allowed to undo the rule the whole look is built on. Grain stays; it only
  // adds noise and resamples nothing.

  // ---------- Film grain ----------
  // Baked once into a canvas a little larger than the viewport and slid to a
  // random offset every frame — one draw call, no per-pixel work at runtime.
  // Sparse and dim on purpose: grain you can name is grain that is too strong.
  let grainCv = null;

  function buildGrain() {
    const gw = Math.ceil(W) + 64, gh = Math.ceil(H) + 64;
    grainCv = document.createElement('canvas');
    grainCv.width = gw;
    grainCv.height = gh;
    const g = grainCv.getContext('2d');
    const im = g.createImageData(gw, gh);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() < 0.16) {
        const v = 90 + Math.random() * 165;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  }

  function drawGrain() {
    if (!fx0.grain) return;
    if (!grainCv || grainCv.width < W || grainCv.height < H) buildGrain();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.045;
    ctx.drawImage(grainCv, -Math.floor(Math.random() * 64), -Math.floor(Math.random() * 64));
    ctx.restore();
  }

  // ---------- Strike zone ----------
  // Explicit borders: light pillars, inward brackets and a ground band.
  // active — a target is in the zone: the borders flare up.
  function drawRange(st, rangePx, t, active) {
    ctx.save();
    // the markers live in the WORLD, not on the hero: while the camera catches up
    // after a dash, enemies are drawn world-shifted — markers anchored to the hero
    // would lie about who is actually within reach. zonePx (not raw camPx) keeps
    // the correction a fast whip instead of a one-frame jump.
    const c0 = cx + zonePx;
    const pulse = active
      ? 0.8 + 0.2 * Math.sin(t * 8)
      : 0.42 + 0.12 * Math.sin(t * 4);
    // Stage light: one pool per border, nothing in between.
    //
    // "Strike only inside the zone" is the game's single rule, and it used to be
    // stated by two thin brackets while the background shouted. The first fix
    // was one ellipse spanning the whole zone, filled with a radial gradient
    // whose BRIGHTEST stop was the outer one — and a gradient that peaks at its
    // own edge, clipped by an ellipse path, draws exactly what that sounds like:
    // the outline of an ellipse, arcing over the hero's head. The shape was
    // visible, the light was not.
    //
    // Each border now gets a pool that fades to fully transparent well inside
    // its own path, so there is no boundary left anywhere to catch the eye — and
    // the light lands where the decision is actually made, on the borders.
    ctx.save();
    ctx.globalAlpha = pulse * (active ? 0.85 : 0.6);
    ctx.translate(c0, groundY + 2);
    ctx.scale(1, 0.3); // a circle flattened into a pool: the falloff stays even
    // rangePx changes when a range implant lands, so it is part of the key;
    // one origin-centred gradient then serves both borders via translate
    const pr = rangePx * 0.66;
    const pool = grad('zonePool:' + Math.round(rangePx), () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      g.addColorStop(0, st.accent + '38');
      g.addColorStop(0.5, st.accent + '14');
      g.addColorStop(1, 'transparent');
      return g;
    });
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * rangePx, 0);
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, 7);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    // zone band on the ground: glows at the borders, faint at the center.
    // Built around x=0 and translated to c0, because c0 follows the camera
    // every frame — baked-in absolute coords would pin the band in place.
    ctx.globalAlpha = pulse;
    ctx.save();
    ctx.translate(c0, 0);
    ctx.fillStyle = grad('zoneBand:' + Math.round(rangePx), () => {
      const g = ctx.createLinearGradient(-rangePx, 0, rangePx, 0);
      g.addColorStop(0, st.accent + '77');
      g.addColorStop(0.12, st.accent + '22');
      g.addColorStop(0.5, st.accent + '11');
      g.addColorStop(0.88, st.accent + '22');
      g.addColorStop(1, st.accent + '77');
      return g;
    });
    ctx.fillRect(-rangePx, groundY - 2, rangePx * 2, 13 * S);
    ctx.restore();
    // the lit floor line: reads at a glance where the ground stops being safe
    ctx.globalAlpha = pulse * (active ? 0.9 : 0.55);
    ctx.fillStyle = active ? '#ffffff' : st.accent;
    ctx.fillRect(c0 - rangePx, groundY - 1, rangePx * 2, 1.4 * S);
    for (const side of [-1, 1]) {
      const x = c0 + side * rangePx;
      // a pillar of light rising from the border
      const beamH = 110 * S;
      ctx.globalAlpha = pulse * 0.8;
      ctx.fillStyle = grad('zoneBeam:' + (active ? 'a' : 'i'), () => {
        const g = ctx.createLinearGradient(0, groundY, 0, groundY - beamH);
        g.addColorStop(0, st.accent + (active ? '88' : '66'));
        g.addColorStop(1, 'transparent');
        return g;
      });
      ctx.fillRect(x - 3 * S, groundY - beamH, 6 * S, beamH);
      // the border itself and a bracket pointing into the zone
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = active ? '#ffffff' : st.accent;
      ctx.shadowColor = st.accent;
      ctx.shadowBlur = active ? 18 : 12;
      ctx.lineWidth = 3.2 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, groundY - 26 * S);
      ctx.lineTo(x, groundY + 8 * S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - side * 12 * S, groundY - 26 * S);
      ctx.lineTo(x, groundY - 26 * S);
      ctx.moveTo(x - side * 12 * S, groundY + 8 * S);
      ctx.lineTo(x, groundY + 8 * S);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Figures ----------
  // Stick figure. o: { color, phase — step phase, face — looking direction (-1|1),
  // pose — 'run'|'idle'|'throw'|'shield', glow }
  function stickman(x, y, o) {
    const s = (o.scale || 1) * S;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(o.face || 1, 1);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 3.2 * s;
    ctx.lineCap = 'round';
    ctx.shadowColor = o.glow || o.color;
    ctx.shadowBlur = 10;

    const ph = o.phase || 0;
    const legA = o.pose === 'run' ? Math.sin(ph) * 0.7 : 0.25;
    const bob = o.pose === 'run' ? Math.abs(Math.sin(ph)) * 2.5 * s : 0;
    const hipY = -26 * s - bob, headY = -52 * s - bob;

    ctx.beginPath();
    // legs
    ctx.moveTo(0, hipY);
    ctx.lineTo(Math.sin(legA) * 13 * s, 0);
    ctx.moveTo(0, hipY);
    ctx.lineTo(-Math.sin(legA) * 13 * s, 0);
    // torso leaning forward while running
    const leanX = o.pose === 'run' ? 4 * s : 0;
    ctx.moveTo(0, hipY);
    ctx.lineTo(leanX, headY + 8 * s);
    // arms
    if (o.pose === 'throw') {
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(16 * s, headY + 2 * s); // wind-up
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(-8 * s, hipY + 4 * s);
    } else if (o.pose === 'shield') {
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(13 * s, headY + 18 * s);
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(-7 * s, hipY);
    } else {
      const armA = o.pose === 'run' ? Math.sin(ph + Math.PI) * 0.6 : 0.3;
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(Math.sin(armA) * 11 * s + 6 * s, hipY + 2 * s);
      ctx.moveTo(leanX, headY + 14 * s);
      ctx.lineTo(-Math.sin(armA) * 11 * s + 2 * s, hipY + 2 * s);
    }
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.arc(leanX, headY, 6.5 * s, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  // A figure needs something dark directly under it, or it reads as hovering a
  // few pixels above the asphalt: the wet-ground reflection proves there IS a
  // floor, but not that the feet are touching it.
  //
  // Drawn AFTER groundGlow, which is the whole trick. The halo is light spilling
  // around the figure; under the soles nothing spills, because the figure is in
  // the way. Drawn first, the shadow was simply painted over by the halo and the
  // feet went on floating in a cyan puddle.
  //
  // Skipped on the reflection pass — a shadow inside a mirror image is a shadow
  // hanging in the sky.
  function contactShadow(x, r, k) {
    if (reflectPass) return;
    ctx.save();
    // k used to be baked into the stops; multiplying globalAlpha lands on the
    // same pixels and keeps the gradient cacheable by radius alone. The boss's
    // radius animates through a jump, but only across a few dozen whole pixels,
    // so the rounded key stays bounded.
    if (k !== undefined) ctx.globalAlpha *= k;
    ctx.translate(x, groundY);
    ctx.fillStyle = grad('cShadow:' + Math.round(r), () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
      g.addColorStop(0.55, 'rgba(0, 0, 0, 0.26)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return g;
    });
    ctx.beginPath();
    ctx.ellipse(0, 1, r, r * 0.22, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function groundGlow(x, color, r) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.fillStyle = grad('gGlow:' + color + ':' + Math.round(r), () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, color + '2e');
      g.addColorStop(1, 'transparent');
      return g;
    });
    ctx.beginPath();
    ctx.ellipse(0, 2, r, r * 0.25, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  // scratch canvas where the hollow mimic's shell is etched each frame
  let phantomCv = null, phantomCtx = null;

  // ---------- Hero death ----------
  let heroDeath = null; // {t0, side} — the side the killing blow came from

  function heroDie(side) {
    heroDeath = { t0: fx.t, side: side || 1 };
  }

  function drawHeroDeath() {
    const k = fx.t - heroDeath.t0;
    const dir = -heroDeath.side; // falls away from the blow
    groundGlow(cx, '#ff2d4e', 60 * S);

    // the katana flies from the hand, spins and comes to rest on the ground
    const kk = Math.min(1, k / 0.45);
    ctx.save();
    ctx.strokeStyle = '#26d6ff';
    ctx.shadowColor = '#26d6ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.4 * S;
    ctx.lineCap = 'round';
    if (kk < 1) {
      const kx = cx + dir * (30 + 95 * kk) * S;
      const ky = groundY - (40 * (1 - kk) + 55 * Math.sin(Math.PI * kk)) * S;
      ctx.translate(kx, ky);
      ctx.rotate(dir * kk * 9);
    } else {
      ctx.translate(cx + dir * 125 * S, groundY - 2);
      ctx.rotate(0.06 * dir);
      ctx.globalAlpha = 0.8;
    }
    ctx.beginPath();
    ctx.moveTo(-19 * S, 0);
    ctx.lineTo(19 * S, 0);
    ctx.stroke();
    ctx.restore();

    // the body: a flickering recoil → fall around the feet → glitch dissolve
    const fall = Math.min(1, Math.max(0, (k - 0.2) / 0.45));
    const ease = fall * fall * (3 - 2 * fall);
    const flicker = k < 0.2 && Math.floor(fx.t * 24) % 2;
    const dissolve = Math.max(0, Math.min(1, (k - 0.8) / 0.7));
    // The fall is carried by drawn poses now (recoil → knee → over → still), so
    // there is no rotation here at all. It used to spin one standing frame about
    // the toes, and a pose that never changes reads as a felled plank however it
    // is transformed. Only a small slide in the direction of the blow remains.
    const dfr = Math.min(7, Math.floor(k / 0.115));
    ctx.save();
    ctx.translate(cx, groundY);
    ctx.translate(dir * ease * 7 * S, 0);
    ctx.globalAlpha = (1 - dissolve * 0.75) * (flicker ? 0.45 : 1);
    if (!Sprites.ready() ||
        !Sprites.draw(ctx, 'hero', 'death', dfr, 0, 0, SPR, heroDeath.side,
          flicker ? 'rgba(255,45,78,0.8)' : null)) {
      stickman(0, 0, { color: flicker ? '#ff5c7a' : '#eaf6ff', face: heroDeath.side, pose: 'idle' });
    }
    ctx.restore();

    // glitch noise on the body and data sparks drifting upward
    if (k > 0.4 && k < 2.5) {
      if (Math.random() < 0.45) {
        ctx.save();
        ctx.fillStyle = Math.random() < 0.5 ? '#ff2d4e' : '#26d6ff';
        ctx.globalAlpha = 0.6 * (1 - dissolve * 0.6);
        ctx.fillRect(cx + dir * Math.random() * 60 * S - 10 * S,
          groundY - Math.random() * 40 * S, 10 * S, 2.4 * S);
        ctx.restore();
      }
      if (Math.random() < 0.35) {
        fx.parts.push({
          kind: 'ember',
          x: cx + dir * Math.random() * 60 * S,
          y: groundY - Math.random() * 25 * S,
          vx: (Math.random() - 0.5) * 16,
          vy: -45 - Math.random() * 55,
          life: 0.8, age: 0, color: '#26d6ff',
        });
      }
    }
  }

  // ---------- Hero ----------
  let lastSlash = { side: 1, t: -9 }; // t — an fx.t timestamp
  let heroHurtT = -9; // moment of the last wound — for HURT frames

  function heroHurt() { heroHurtT = fx.t; }

  function drawHero(run, t, stunFrac, execReady, chainReady) {
    const st = ACT_STYLE[actId];
    const stunned = run && run.stun > 0;
    // stun indicator: a melting red arc under the hero — shows how long we hang
    if (stunFrac > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff2d4e';
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = '#ff2d4e';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 4 * S;
      ctx.beginPath();
      ctx.arc(cx, groundY + 10 * S, 30 * S, Math.PI * (0.5 - 0.5 * stunFrac), Math.PI * (0.5 + 0.5 * stunFrac));
      ctx.stroke();
      // glitch noise around the hero
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ff2d4e';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(cx - 24 * S + Math.random() * 48 * S, groundY - 70 * S + Math.random() * 70 * S, 10 * S, 2 * S);
      }
      ctx.restore();
    }
    const age = t - lastSlash.t;
    const slashing = age < 0.16;
    const face = cinemaMode ? 1 : (slashing ? lastSlash.side : (lastSlash.side || 1));
    const color = stunned && Math.floor(t * 20) % 2 ? '#ff5c7a' : '#eaf6ff';

    groundGlow(cx, st.accent2, 60 * S);
    contactShadow(cx, 26 * S);

    // ---------- sprite hero (the pixel cyber ronin) ----------
    if (Sprites.ready()) {
      const scale = SPR;
      // halo: colored by charged implants, blinks red while stunned
      const glow = stunned && Math.floor(t * 20) % 2 ? 'rgba(255,45,78,0.85)'
        : execReady ? 'rgba(255,45,78,0.8)'
        : chainReady ? 'rgba(186,255,77,0.8)'
        : 'rgba(38,214,255,0.55)';
      let name = 'idle', idx;
      const hurtAge = t - heroHurtT;
      if (age < 0.25) {
        name = 'attack';
        idx = Math.min(6, Math.floor(age / 0.036));
      } else if (cinemaMode || Math.abs(camPx) > 5) {
        name = 'run'; // a dash still settling, or the cutscene's travelling shot
        idx = cinemaMode ? Math.floor(t * 9) : Math.floor(Math.abs(worldVis) / 7);
      } else if (hurtAge < 0.32) {
        name = 'hurt';
        idx = Math.min(3, Math.floor(hurtAge / 0.08));
      } else {
        idx = Math.floor(t * 10); // idle-stance breathing
      }
      if (Sprites.draw(ctx, 'hero', name, idx, cx, groundY, scale, face, glow)) {
        // sparks of charged implants near the blade
        if ((execReady || chainReady) && !reflectPass && Math.random() < 0.3) {
          fx.parts.push({
            kind: 'ember',
            x: cx + face * (14 + Math.random() * 14) * S,
            y: groundY - (20 + Math.random() * 16) * S,
            vx: (Math.random() - 0.5) * 20,
            vy: -30 - Math.random() * 40,
            life: 0.5 + Math.random() * 0.3,
            age: 0, color: execReady ? '#ff5c6e' : '#baff4d',
          });
        }
        return;
      }
    }

    // ---------- fallback: the drawn hero (until sprites load) ----------
    const s = S;
    ctx.save();
    ctx.translate(cx, groundY);
    ctx.scale(face, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.6 * s;
    ctx.lineCap = 'round';
    ctx.shadowColor = st.accent2;
    ctx.shadowBlur = 14;

    const lunge = slashing ? (1 - age / 0.16) * 10 * s : 0;
    const sway = Math.sin(t * 2.2) * 1.5 * s;
    const hipY = -28 * s, headY = -56 * s;

    ctx.beginPath();
    // stance: legs wide
    ctx.moveTo(lunge * 0.4, hipY);
    ctx.lineTo(16 * s + lunge, 0);
    ctx.moveTo(lunge * 0.4, hipY);
    ctx.lineTo(-13 * s, 0);
    // torso
    ctx.moveTo(lunge * 0.4, hipY);
    ctx.lineTo(sway * 0.4 + lunge * 0.6, headY + 9 * s);
    ctx.stroke();
    // head with a ronin topknot
    ctx.beginPath();
    ctx.arc(sway * 0.4 + lunge * 0.6, headY, 7 * s, 0, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sway * 0.4 + lunge * 0.6 - 5 * s, headY - 3 * s);
    ctx.lineTo(sway * 0.4 + lunge * 0.6 - 14 * s - sway, headY - 1 * s + Math.sin(t * 3) * 2 * s);
    ctx.stroke();
    // arms and katana
    const shoulderX = sway * 0.4 + lunge * 0.6, shoulderY = headY + 14 * s;
    ctx.beginPath();
    // charged implants tint the blade: execute — red, discharge — acid
    // (execute takes priority, but the discharge crackle shows either way)
    const bladePulse = 0.5 + 0.5 * Math.sin(t * 11);
    const bladeColor = execReady ? (bladePulse > 0.5 ? '#ff6577' : '#ffd6dc')
      : chainReady ? (bladePulse > 0.5 ? '#baff4d' : '#eaffc4')
      : st.accent2;
    const bladeGlow = execReady ? '#ff2d4e' : chainReady ? '#baff4d' : (slashing ? '#ffffff' : st.accent2);
    const bladeBlur = (execReady || chainReady) ? 20 + 8 * bladePulse : (slashing ? 18 : 12);
    // electric crackle on the blade when the discharge bolt is armed
    function bladeCrackle(x1, y1, x2, y2) {
      if (!chainReady || Math.random() > 0.3) return;
      const k = 0.2 + Math.random() * 0.7;
      const px = x1 + (x2 - x1) * k, py = y1 + (y2 - y1) * k;
      ctx.save();
      ctx.strokeStyle = '#dfff9a';
      ctx.shadowColor = '#baff4d';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.4 * s;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(px - 6 * s, py + (Math.random() - 0.5) * 8 * s);
      ctx.lineTo(px, py + (Math.random() - 0.5) * 6 * s);
      ctx.lineTo(px + 6 * s, py + (Math.random() - 0.5) * 8 * s);
      ctx.stroke();
      ctx.restore();
    }
    let tipX, tipY; // blade tip in world coordinates — for sparks
    if (slashing) {
      // lunge: both hands on the blade, blade horizontal forward
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(20 * s + lunge, shoulderY + 6 * s);
      ctx.stroke();
      ctx.strokeStyle = bladeColor;
      ctx.shadowColor = bladeGlow;
      ctx.shadowBlur = bladeBlur;
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      ctx.moveTo(20 * s + lunge, shoulderY + 6 * s);
      ctx.lineTo(58 * s + lunge, shoulderY - 2 * s);
      ctx.stroke();
      bladeCrackle(20 * s + lunge, shoulderY + 6 * s, 58 * s + lunge, shoulderY - 2 * s);
      tipX = cx + face * (58 * s + lunge);
      tipY = groundY + shoulderY - 2 * s;
    } else {
      // stance: the katana raised behind the back
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(12 * s, hipY + 2 * s);
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(-6 * s, hipY - 2 * s);
      ctx.stroke();
      ctx.strokeStyle = bladeColor;
      ctx.shadowColor = bladeGlow;
      ctx.shadowBlur = bladeBlur;
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.moveTo(12 * s, hipY + 2 * s);
      ctx.lineTo(30 * s, hipY - 30 * s - sway);
      ctx.stroke();
      bladeCrackle(12 * s, hipY + 2 * s, 30 * s, hipY - 30 * s - sway);
      tipX = cx + face * 30 * s;
      tipY = groundY + hipY - 30 * s - sway;
    }
    ctx.restore();
    // ember sparks off the charged blade
    if (execReady && Math.random() < 0.35) {
      fx.parts.push({
        kind: 'ember',
        x: tipX + (Math.random() - 0.5) * 8 * s,
        y: tipY + Math.random() * 20 * s,
        vx: (Math.random() - 0.5) * 20,
        vy: -30 - Math.random() * 40,
        life: 0.5 + Math.random() * 0.4,
        age: 0, color: '#ff5c6e',
      });
    }
  }

  // ---------- Enemies ----------
  // enemy visual state: on a side change we play a somersault
  const enemyVis = new Map(); // id -> {side, x, roll: {fromX, t0}|null}

  // sprite humanoid config: halo colour per type (the drone is its own sprite).
  // Size is no longer per-type — every humanoid draws at the whole-pixel SPR scale
  // Single source of truth for a type's identity colour. The sprite halo (glow),
  // the corpse tint and the vector-fallback strokes all read from here, so a colour
  // is defined ONCE. It used to live in three drifting copies — SPRITE_CONF,
  // CORPSE_COLORS and inline literals in drawEnemy. State colours (the fencer's green
  // window, a touched twin's white, a thrower's wind-up flash) are NOT identity and
  // stay inline where they are chosen.
  const ENEMY_STYLE = {
    drone:   { color: '#ff5c9e', glow: 'rgba(255,92,158,0.50)' },
    punk:    { color: '#ff8d4d', glow: 'rgba(255,141,77,0.45)' },
    shield:  { color: '#3f6bff', glow: 'rgba(63,107,255,0.45)' },
    thrower: { color: '#2dff8f', glow: 'rgba(45,255,143,0.45)' },
    fencer:  { color: '#c9a2ff', glow: 'rgba(201,162,255,0.45)' },
    adapt:   { color: '#b4ff3d', glow: 'rgba(180,255,61,0.45)' },
    twin:    { color: '#ffd94d', glow: 'rgba(255,217,77,0.45)' },
    mimic:   { color: '#ff5c9e', glow: 'rgba(255,92,158,0.50)' }, // wears the drone's look on purpose
    boss:    { color: '#ff3b3b', glow: 'rgba(255,59,59,0.55)' },
  };
  const eColor = (t) => (ENEMY_STYLE[t] || ENEMY_STYLE.drone).color;
  // The humanoid-sprite types carry a halo; drone/mimic/boss draw themselves and
  // are absent here on purpose (their presence gates the shared-sprite path).
  const SPRITE_CONF = Object.fromEntries(
    ['punk', 'shield', 'thrower', 'fencer', 'adapt', 'twin']
      .map((t) => [t, { glow: ENEMY_STYLE[t].glow }]));

  function drawEnemy(e, t, run) {
    // FOG mutator: everything beyond the veil is invisible — enemies materialize
    if (run && Game.mutHas(run, 'fog') && e.dist > Game.FOG_DIST) return;
    const st = ACT_STYLE[actId];
    let x = X(e.side, e.dist);
    // Miss surge: while the hero hangs, the crowd rushes — speed streaks trail
    // behind every walker so the lost ground is seen, not just suffered.
    if (run && run.stun > 0 && e.kind !== 'proj' && !e.dead) {
      const face = e.side > 0 ? -1 : 1; // they move toward the centre
      ctx.save();
      ctx.strokeStyle = '#ff5c7a';
      ctx.shadowColor = '#ff5c7a';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.8 * S;
      for (let i = 0; i < 3; i++) {
        const y = groundY - (16 + i * 17) * S;
        const len = (14 + ((i * 7 + Math.floor(t * 30 + e.id)) % 12)) * S;
        ctx.globalAlpha = 0.5 - i * 0.11;
        ctx.beginPath();
        ctx.moveTo(x - face * 12 * S, y);
        ctx.lineTo(x - face * (12 * S + len), y);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (e.kind === 'proj') {
      const color = e.reflected ? st.accent2 : '#ff4d5e';
      const y = groundY - 40 * S;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5 * S;
      // trail
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const dir = e.reflected ? -e.side : e.side;
      ctx.lineTo(x + dir * 34 * S, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // spinning star
      ctx.translate(x, y);
      ctx.rotate(t * 18);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(9 * S, 0);
        ctx.stroke();
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
      return;
    }

    // somersault: an enemy knocked across flies in an arc with a spin
    let vis = enemyVis.get(e.id);
    if (!vis) { vis = { side: e.side, x, roll: null }; enemyVis.set(e.id, vis); }
    if (vis.side !== e.side) {
      vis.roll = { fromX: vis.x, t0: t };
      vis.side = e.side;
    }
    let rollK = 0, rollSpin = 0;
    if (vis.roll) {
      const k = (t - vis.roll.t0) / 0.3;
      if (k >= 1) vis.roll = null;
      else {
        const dir = Math.sign(x - vis.roll.fromX) || 1;
        x = vis.roll.fromX + (x - vis.roll.fromX) * k;
        rollK = Math.sin(Math.PI * k);
        rollSpin = k * Math.PI * 2 * dir;
      }
    } else {
      // knockback (pushback, kill rollback, mercy retreat) jolts dist instantly —
      // on screen the enemy skids backward instead of teleporting
      if (!vis.slide && (x - vis.x) * e.side > 10 * S) vis.slide = { fromX: vis.x, t0: t };
      if (vis.slide) {
        const k = (t - vis.slide.t0) / 0.22;
        if (k >= 1) vis.slide = null;
        else x = vis.slide.fromX + (x - vis.slide.fromX) * (1 - (1 - k) * (1 - k));
      }
    }
    vis.x = x;

    const face = -e.side; // runs toward the center
    const ph = e.dist / 16; // step phase from distance — leg speed matches movement speed
    groundGlow(x, st.accent, 40 * S);
    // the drone flies: a small, faint shadow instead of a footprint. A mimic wears
    // the same disguise, so it hovers too.
    const flying = e.type === 'drone' || e.type === 'mimic';
    contactShadow(x, (flying ? 14 : 21) * S, flying ? 0.45 : 1);

    // sprite humanoid; mechanical overlays (shields, «!», pips) are drawn afterwards on top
    const conf = SPRITE_CONF[e.type];
    let spriteDrawn = false;
    if (conf && Sprites.ready()) {
      let anim = 'run', idx = Math.floor(e.dist / 6), glow = conf.glow;
      // shielder: the halo fades as his slab is broken — 3 hits bright, 1 hit dim
      if (e.type === 'shield') glow = `rgba(63,107,255,${(0.14 + 0.16 * e.hits).toFixed(2)})`;
      if (run && run.boss && run.boss.state === 'qte') {
        // duel focus: summons freeze while the QTE shred runs — they stand and watch
        anim = 'idle'; idx = Math.floor(t * 8);
      } else if (e.type === 'thrower' && e.windup !== undefined && !e.thrown) {
        anim = 'idle'; idx = Math.floor(t * 10);
        if (Math.floor(t * 14) % 2) glow = 'rgba(255,255,255,0.85)'; // wind-up blinking
      } else if (e.type === 'fencer' && e.fstate) {
        anim = 'idle'; idx = Math.floor(t * 8);
        if (e.fstate === 'open' && Math.floor(t * 14) % 2) glow = 'rgba(45,255,143,0.9)'; // the window
      } else if (e.type === 'twin' && run && run.twinPress &&
                 run.twinPress.pair === e.pair && run.twinPress.side === e.side) {
        glow = 'rgba(255,255,255,0.9)'; // a touched twin awaits the chord
      }
      if (rollK) {
        ctx.save();
        ctx.translate(x, groundY - rollK * 70 * S);
        const half = 20 * SPR;
        ctx.translate(0, -half); ctx.rotate(rollSpin); ctx.translate(0, half);
        spriteDrawn = Sprites.draw(ctx, e.type, 'hurt', 1, 0, 0, SPR, face, glow);
        ctx.restore();
      } else {
        spriteDrawn = Sprites.draw(ctx, e.type, anim, idx, x, groundY, SPR, face, glow);
      }
    }

    if (e.type === 'drone') {
      const y = groundY - 44 * S + Math.sin(t * 4 + e.id) * 5 * S;
      // pixel drone: the hull's underside is the sprite's "feet"; frames spin the rotor
      if (Sprites.ready() &&
          Sprites.draw(ctx, 'drone', 'fly', Math.floor(t * 18) + e.id, x, y + 13 * S, SPR, face,
            'rgba(255,92,158,0.5)')) {
        return;
      }
      ctx.save();
      ctx.strokeStyle = eColor('drone');
      ctx.fillStyle = '#12081c';
      ctx.shadowColor = eColor('drone');
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.4 * S;
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, -12 * S);
      ctx.lineTo(11 * S, 0);
      ctx.lineTo(0, 12 * S);
      ctx.lineTo(-11 * S, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // eye
      ctx.fillStyle = '#ffe1ec';
      ctx.beginPath();
      ctx.arc(face * 4 * S, 0, 2.6 * S, 0, 7);
      ctx.fill();
      ctx.restore();
    } else if (e.type === 'mimic') {
      // Disguised as a drone until it nears the zone; then it flashes. A real one
      // stays a solid drone (with a brief hot confirming flare); a phantom turns
      // hollow and cold — an outline with nothing inside, split and glitching, so
      // "there is nothing here to hit" reads at a glance.
      const y = groundY - 44 * S + Math.sin(t * 4 + e.id) * 5 * S;
      const flash = (e.reveal || 0) / Game.MIMIC_FLASH; // 1 at the reveal, 0 once it fades
      const dia = (ox, yy) => { // the drone's diamond hull
        ctx.beginPath();
        ctx.moveTo(ox, yy - 12 * S);
        ctx.lineTo(ox + 11 * S, yy);
        ctx.lineTo(ox, yy + 12 * S);
        ctx.lineTo(ox - 11 * S, yy);
        ctx.closePath();
      };
      if (e.revealed && e.phantom) {
        // A broken projection of the SAME drone. The old abstract diamond read
        // as a different enemy; the lesson is "that drone is hollow", so the
        // hollow one must keep the drone's exact silhouette — the sprite
        // itself, translucent and cold, cut into scan slices that slip
        // sideways on their own clocks, with the odd full dropout. Video
        // losing sync, not armor taking hits.
        ctx.save();
        const dropout = Math.sin(t * 13 + e.id * 3.7) > 0.96; // rare blank frames
        const drewSprite = Sprites.ready() && !dropout && (() => {
          // HOLLOW, literally: only the drone's shell is drawn, and the night
          // shows through where its body should be. The outline is etched on a
          // scratch canvas — eight offset stamps of the sprite minus the sprite
          // itself leave a pixel-wide ring, tinted cold. The same silhouette as
          // the disguise, with nothing inside it: the lesson drawn as a picture.
          const hgt = Sprites.FRAME * SPR;
          if (!phantomCv || phantomCv.width !== hgt) {
            phantomCv = document.createElement('canvas');
            phantomCv.width = phantomCv.height = hgt;
            phantomCtx = phantomCv.getContext('2d');
            if (!phantomCtx) { phantomCv = null; return false; }
          }
          const p = phantomCtx;
          const idx = Math.floor(t * 18) + e.id;
          const th = Math.max(1.5, 1.1 * S); // shell thickness
          p.clearRect(0, 0, hgt, hgt);
          p.globalCompositeOperation = 'source-over';
          for (let a = 0; a < 8; a++) {
            p.save();
            p.translate(Math.cos(a * Math.PI / 4) * th, Math.sin(a * Math.PI / 4) * th);
            Sprites.draw(p, 'drone', 'fly', idx, hgt / 2, Sprites.FEET * SPR, SPR, face, null);
            p.restore();
          }
          p.globalCompositeOperation = 'destination-out';
          Sprites.draw(p, 'drone', 'fly', idx, hgt / 2, Sprites.FEET * SPR, SPR, face, null);
          p.globalCompositeOperation = 'source-in';
          p.fillStyle = 'rgb(196, 230, 255)';
          p.fillRect(0, 0, hgt, hgt);
          p.globalCompositeOperation = 'source-over';
          const alpha = 0.52 + 0.16 * Math.sin(t * 9 + e.id) + 0.35 * flash;
          const jit = Math.sin(t * 21 + e.id) * 1.1 * S;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.shadowColor = '#7fd0ff';
          ctx.shadowBlur = 9 + 14 * flash;
          ctx.drawImage(phantomCv, x - hgt / 2 + jit, y + 13 * S - Sprites.FEET * SPR);
          ctx.shadowBlur = 0;
          return true;
        })();
        if (!drewSprite && !dropout) {
          // no sprites yet — the old hollow diamond stands in
          const jit = Math.sin(t * 34 + e.id) * 1.8 * S;
          const a = 0.5 + 0.22 * (0.5 + 0.5 * Math.sin(t * 9 + e.id)) + 0.4 * flash;
          ctx.strokeStyle = `rgba(190,225,255,${a.toFixed(3)})`;
          ctx.shadowColor = '#7fd0ff';
          ctx.shadowBlur = 12 + 12 * flash;
          ctx.lineWidth = 2.6 * S;
          dia(x + jit, y); ctx.stroke();
        }
        ctx.restore();
      } else {
        // a drone — the disguise, or a genuine mimic
        let glow = 'rgba(255,92,158,0.5)';
        if (e.revealed) glow = `rgba(255,255,255,${(0.55 + 0.4 * flash).toFixed(2)})`;
        const drew = Sprites.ready() &&
          Sprites.draw(ctx, 'drone', 'fly', Math.floor(t * 18) + e.id, x, y + 13 * S, SPR, face, glow);
        if (!drew) {
          ctx.save();
          ctx.strokeStyle = eColor('drone');
          ctx.fillStyle = '#12081c';
          ctx.shadowColor = eColor('drone');
          ctx.shadowBlur = 12;
          ctx.lineWidth = 2.4 * S;
          dia(x, y); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffe1ec';
          ctx.beginPath(); ctx.arc(x + face * 4 * S, y, 2.6 * S, 0, 7); ctx.fill();
          ctx.restore();
        }
        if (flash > 0) { // the solid confirming flare
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.55 * flash;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 22 * S);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, 22 * S, 0, 7); ctx.fill();
          ctx.restore();
        }
      }
    } else if (e.type === 'punk') {
      if (!spriteDrawn) stickman(x, groundY, { color: eColor('punk'), face, phase: ph, pose: 'run' });
    } else if (e.type === 'shield') {
      if (!spriteDrawn) stickman(x, groundY, { color: eColor('shield'), face, phase: ph, pose: 'shield', scale: 1.12 });
      // The vector arc that used to hang here is gone — the sprite now carries a
      // real slab. But the arc was not decoration: its opacity counted the hits
      // he still holds, so that signal moved into the halo (see SPRITE_CONF use
      // below) rather than being dropped.
    } else if (e.type === 'fencer') {
      // stance — violet with a blade block; window — blinks green
      const open = e.fstate === 'open';
      const color = open ? (Math.floor(t * 14) % 2 ? '#b6ffd9' : '#2dff8f') : eColor('fencer');
      if (!spriteDrawn) stickman(x, groundY, { color, face, phase: ph, pose: e.fstate ? (open ? 'throw' : 'shield') : 'run' });
      if (e.fstate === 'guard') {
        ctx.save();
        ctx.strokeStyle = '#e6d4ff';
        ctx.shadowColor = eColor('fencer');
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2.6 * S;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + face * 8 * S, groundY - 44 * S);
        ctx.lineTo(x + face * 30 * S, groundY - 20 * S);
        ctx.stroke();
        ctx.restore();
      }
      if (open) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(20 * S)}px sans-serif`;
        ctx.fillStyle = '#2dff8f';
        ctx.shadowColor = '#2dff8f';
        ctx.shadowBlur = 12;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 18);
        ctx.fillText('!', x, groundY - 86 * S);
        ctx.restore();
      }
    } else if (e.type === 'adapt') {
      if (!spriteDrawn) stickman(x, groundY, { color: eColor('adapt'), face, phase: ph, pose: 'shield', scale: 1.15 });
      // the shield "reads" the last press's side: solid against alternation,
      // after a hit from its own side it dims for a moment
      const up = !run || run.lastStrikeSide !== e.side;
      ctx.save();
      ctx.translate(x + face * 17 * S, groundY - 32 * S);
      ctx.scale(face, 1); // the shield arc is always convex toward the hero
      ctx.strokeStyle = up ? '#dcffab' : '#445a2a';
      ctx.globalAlpha = up ? 0.9 : 0.35;
      ctx.shadowColor = eColor('adapt');
      ctx.shadowBlur = up ? 14 : 4;
      ctx.lineWidth = 3.4 * S;
      ctx.beginPath();
      ctx.arc(0, 0, 22 * S, -1.25, 1.25);
      ctx.stroke();
      if (up) {
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.6 * S;
        ctx.beginPath();
        ctx.arc(0, 0, 27 * S, -1.1, 1.1);
        ctx.stroke();
      }
      ctx.restore();
    } else if (e.type === 'twin') {
      const touched = run && run.twinPress && run.twinPress.pair === e.pair && run.twinPress.side === e.side;
      if (!spriteDrawn) stickman(x, groundY, {
        color: touched ? '#ffffff' : eColor('twin'),
        face, phase: ph, pose: 'run',
      });
    } else if (e.type === 'thrower') {
      const winding = e.windup !== undefined && !e.thrown;
      // blinks white during wind-up — the throw telegraphs in advance
      const color = winding && Math.floor(t * 14) % 2 ? '#eafff2' : '#2dff8f';
      if (!spriteDrawn) stickman(x, groundY, { color, face, phase: ph, pose: e.thrown ? 'run' : 'throw' });
      if (winding) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(20 * S)}px sans-serif`;
        ctx.fillStyle = '#ff5c5e';
        ctx.shadowColor = '#ff5c5e';
        ctx.shadowBlur = 10;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 16);
        ctx.fillText('!', x, groundY - 86 * S);
        ctx.restore();
      }
    }

    // pips: multi-hit enemies always show their maximum; spent hits are hollow.
    // The rule is unambiguous: no pips = one-hit kill, ●○ = a wounded two-hitter.
    const maxHits = Game.ENEMY_TYPES[e.type].hits;
    if (!rollK && maxHits > 1) {
      // big overlapping dots like a coin stack; a dark rim separates the layers
      const pr = 3.4 * S, step = 5.2 * S;
      ctx.save();
      ctx.shadowColor = st.accent;
      for (let i = 0; i < maxHits; i++) {
        const px2 = x - (maxHits - 1) * step / 2 + i * step;
        ctx.beginPath();
        ctx.arc(px2, groundY - 82 * S, pr, 0, 7);
        if (i < e.hits) {
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 7;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#070a18';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(10, 10, 22, 0.55)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ---------- Corpses: the body is cut apart and dissolves ----------
  // Tints derive from the one identity table (see ENEMY_STYLE) — no second copy.
  const CORPSE_COLORS = Object.fromEntries(
    Object.entries(ENEMY_STYLE).map(([t, v]) => [t, v.color]));
  const CORPSE_LIFE = 0.55;

  function corpse(side, dist, type, scale) {
    fx.corpses.push({ side, x: X(side, dist), type, scale: scale || 1, t0: fx.t });
  }

  function drawCorpses() {
    for (const c of fx.corpses) {
      const k = (fx.t - c.t0) / CORPSE_LIFE;
      if (k >= 1) continue;
      const color = CORPSE_COLORS[c.type] || eColor('drone');
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      if (c.type === 'drone' || c.type === 'mimic') {
        // the drone (and the mimic wearing its shape) stalls and falls, spinning —
        // a killed mimic must not tip over as a humanoid it never was
        ctx.translate(c.x + c.side * k * 16 * S, groundY - 44 * S + k * k * 42 * S);
        ctx.rotate(k * 5 * c.side);
        if (Sprites.ready() && Sprites.draw(ctx, 'drone', 'fly', 3, 0, 13 * S, SPR, -c.side, null)) {
          ctx.restore();
          continue;
        }
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2.2 * S;
        ctx.beginPath();
        ctx.moveTo(0, -10 * S);
        ctx.lineTo(9 * S, 0);
        ctx.lineTo(0, 10 * S);
        ctx.lineTo(-9 * S, 0);
        ctx.closePath();
        ctx.stroke();
      } else {
        // A blade kill PARTS the body along the slash — the Warden included. The
        // drone's spinning drop is a machine losing power; a cut figure comes apart:
        // the top half is flung outward (the way the slash travelled) and pitches
        // over, the lower half buckles where it stood, both fading into the "memory
        // upload" the corporate log keeps filing. The Warden is twice everyone's
        // size, so the cut, the clip and the throw all scale with the figure — but
        // his greater mass spins and flies LESS, so he comes apart heavily, not like
        // a tossed drone.
        const boss = c.type === 'boss';
        const fscale = boss ? 2 : (c.scale || 1);
        const cutY = -27 * S * fscale;       // the slash line, at the waist
        const dir = c.side;                  // the cut carries the pieces outward, off the hero
        const spin = boss ? 1.3 : 2.2;       // heavy mass turns over slower
        const fling = boss ? 20 : 34;        // and does not fly as far
        const hw = 46 * S * fscale;
        const sprScale = boss ? SPR_BOSS : (SPRITE_CONF[c.type] ? SPR : 0);
        const drawFig = () => {
          if (!(sprScale && Sprites.ready() &&
                Sprites.draw(ctx, c.type, 'hurt', 3, 0, 0, sprScale, -c.side, null))) {
            stickman(0, 0, { color, face: -c.side, pose: 'idle', scale: fscale });
          }
        };
        ctx.translate(c.x, groundY);
        // lower half — clipped from the waist down; buckles straight down
        ctx.save();
        ctx.beginPath(); ctx.rect(-hw, cutY, hw * 2, -cutY + 10 * S * fscale); ctx.clip();
        ctx.translate(dir * k * 5 * S * fscale, k * 13 * S * fscale);
        ctx.rotate(dir * k * 0.3);
        drawFig();
        ctx.restore();
        // upper half — clipped from the waist up; flung along the cut, pitching over
        ctx.save();
        ctx.beginPath(); ctx.rect(-hw, -76 * S * fscale, hw * 2, cutY + 76 * S * fscale); ctx.clip();
        ctx.translate(dir * k * fling * S * fscale, -k * 7 * S * fscale + k * k * 48 * S * fscale);
        ctx.rotate(dir * k * spin);
        drawFig();
        ctx.restore();
        // the cut flash — a brief white blade line across the waist as it parts
        if (k < 0.3) {
          ctx.save();
          ctx.globalAlpha = (1 - k / 0.3) * 0.85;
          ctx.strokeStyle = '#ffffff';
          ctx.shadowColor = color; ctx.shadowBlur = 10;
          ctx.lineWidth = 2.2 * S * (boss ? 1.6 : 1);
          ctx.beginPath();
          ctx.moveTo(-36 * S * fscale, cutY); ctx.lineTo(36 * S * fscale, cutY);
          ctx.stroke();
          ctx.restore();
        }
      }
      // glitch noise on the body
      if (Math.random() < 0.4) {
        ctx.fillStyle = color;
        ctx.globalAlpha = (1 - k) * 0.5;
        ctx.fillRect((Math.random() - 0.5) * 30 * S, -Math.random() * 50 * S, 9 * S, 2.2 * S);
      }
      ctx.restore();
    }
    fx.corpses = fx.corpses.filter(c => fx.t - c.t0 < CORPSE_LIFE);
  }

  // ---------- Warden (the act boss) ----------
  // Warden visual state: the logic switches sides instantly,
  // while on screen he vaults over the hero with a somersault.
  let bossVis = null;

  // The Double's projection: identical to the Warden until the reveal, then a
  // flickering broken hologram. Drawn with the boss's own renderer so that no
  // detail betrays which silhouette is real before the flash.
  function drawBossPhantom(b, t) {
    if (!(b.ph && b.ph.alive && b.state === 'walk')) return;
    ctx.save();
    if (b.ph.revealed) {
      ctx.globalAlpha *= 0.45 + 0.12 * Math.sin(t * 9);
      ctx.translate(Math.sin(t * 34) * 1.8 * S, 0);
    }
    drawBoss({ ...b, side: -b.side }, t, X(-b.side, b.dist), 0, 0);
    ctx.restore();
  }

  function drawBoss(b, t, drawX, jumpK, spin, flinchAge) {
    const s2 = 1.8 * S;
    const flinch = flinchAge !== undefined && flinchAge < 0.26;
    // hit recoil — a short push away from the hero
    const recoil = flinch ? Math.sin(Math.PI * flinchAge / 0.26) * 9 * S * b.side : 0;
    groundGlow(drawX, eColor('boss'), 85 * S);
    // mid-vault the Warden is in the air — the shadow shrinks and fades under him
    contactShadow(drawX + recoil, (40 - jumpK * 18) * S, 1 - jumpK * 0.55);
    ctx.save();
    // jump: an arc rise and a somersault around the center of mass
    ctx.translate(drawX + recoil, groundY - jumpK * 120 * S);
    if (spin) {
      ctx.translate(0, -34 * s2 * 0.5);
      ctx.rotate(spin);
      ctx.translate(0, 34 * s2 * 0.5);
    }
    // Admin Oni (kind 3) is LYING right now when the link you are about to press is
    // a glitch — the arrow at your feet points the wrong way and this press must be
    // inverted. Mark it on him, not just on the chevron: a magenta glitch flickers
    // over his red halo, and a reversal crown sits above his head (drawn below).
    const lying = b.kind === 3 && b.state === 'qte' && b.glitch && b.glitch[b.idx];
    let bAnim = b.state === 'walk' && !jumpK ? 'run' : 'idle';
    let bIdx = b.state === 'walk' ? Math.floor(b.dist / 6) : Math.floor(t * 8);
    let bGlow = 'rgba(255,59,59,0.55)';
    if (flinch) {
      bAnim = 'hurt';
      bIdx = Math.min(3, Math.floor(flinchAge / 0.07));
      if (flinchAge < 0.12) bGlow = 'rgba(255,255,255,0.95)';
    } else if (lying && Math.floor(t * 12) % 2) {
      bGlow = 'rgba(255,77,224,0.9)'; // the corrupt-magenta of a lie, flickering
    }
    const bossSprite = Sprites.ready() && Sprites.draw(ctx, 'boss',
      bAnim, bIdx, 0, 0, SPR_BOSS, -b.side, bGlow);
    if (!bossSprite) stickman(0, 0, {
      color: eColor('boss'), face: -b.side, phase: b.dist / 22,
      pose: b.state === 'walk' && !jumpK ? 'run' : 'idle', scale: 1.8,
    });
    // Maglev gust: speed streaks trail behind the hurled Warden
    if (b.gust > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(191,239,255,0.65)';
      ctx.shadowColor = '#bfefff';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2 * S;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const yy = (-18 - i * 24) * S;
        ctx.beginPath();
        ctx.moveTo(b.side * (18 + i * 7) * S, yy);
        ctx.lineTo(b.side * (66 + i * 12) * S, yy);
        ctx.stroke();
      }
      ctx.restore();
    }
    // the sprite Warden has his own helmet — vector horns are fallback-only
    const headY = bossSprite ? (b.state === 'walk' && !jumpK ? -95 : -115) * S : -52 * s2;
    ctx.save();
    if (!bossSprite) {
      ctx.strokeStyle = '#ffd0d0';
      ctx.shadowColor = eColor('boss');
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-5 * s2, headY - 3 * s2);
      ctx.lineTo(-9 * s2, headY - 11 * s2);
      ctx.moveTo(5 * s2, headY - 3 * s2);
      ctx.lineTo(9 * s2, headY - 11 * s2);
      ctx.stroke();
    }
    // pips of remaining phases
    const left = b.phases - b.phase;
    ctx.fillStyle = eColor('boss');
    ctx.shadowColor = eColor('boss');
    ctx.shadowBlur = 8;
    for (let i = 0; i < left; i++) {
      const px = -(left - 1) * 7 * S + i * 14 * S;
      ctx.save();
      ctx.translate(px, headY - (bossSprite ? 8 * S : 20 * s2));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4 * S, -4 * S, 8 * S, 8 * S);
      ctx.restore();
    }
    // the reversal crown: the same "mirror me" U-turn as the chevron badge, on the
    // Warden himself, so the "invert this press" cue sits where the eye is — on the
    // boss, not only on the distant arrow. It says INVERT, never which side.
    if (lying) {
      const gy = headY - 34 * S, r = 15 * S;
      ctx.save();
      ctx.translate(0, gy);
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(fx.t * 11);
      ctx.strokeStyle = '#ff4de0';
      ctx.fillStyle = '#ff4de0';
      ctx.shadowColor = '#ff4de0';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI, 0); // arc over the head, left to right
      ctx.stroke();
      for (const dir of [-1, 1]) { // a head on each end — read it both ways
        ctx.beginPath();
        ctx.moveTo(dir * r, 0);
        ctx.lineTo(dir * r - dir * 6 * S, -6 * S);
        ctx.lineTo(dir * r + dir * 6 * S, -6 * S);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  // the QTE shred: a chain of chevrons and a melting timer.
  // teach — the player has not yet proven they can read a lying link
  function drawQte(b, teach) {
    const n = b.seq.length;
    const size = 30 * S, gap = 48 * S;
    const totalW = (n - 1) * gap;
    // The chain sits low, at the fighter's feet, not up in the sky — the eye is on
    // the duel down here, and a sequence floating in the top third pulled it away
    // from the boss it is supposed to read against.
    const y = groundY + 40 * S;
    for (let i = 0; i < n; i++) {
      const x = cx - totalW / 2 + i * gap;
      const glitched = !!(b.glitch && b.glitch[i]);
      let color, alpha, scale = 1;
      // Glitch links must NOT borrow the fencer's green — that green already
      // means "strike exactly as shown". A lying link gets its own corrupt magenta.
      if (i < b.idx) { color = '#26d6ff'; alpha = 0.45; }
      else if (i === b.idx) { color = glitched ? '#ff4de0' : '#ffffff'; alpha = 1; scale = 1.18 + 0.1 * Math.sin(fx.t * 11); }
      else { color = glitched ? '#a02a8f' : '#5a6a94'; alpha = 0.85; }
      ctx.save();
      // Admin Oni glitch link: the chevron POINTS the wrong way and twitches —
      // green means "the arrow lies, press the opposite side"
      const shown = Game.qteShown(b, i);
      const jitter = glitched && i >= b.idx ? (Math.floor(fx.t * 24) % 3 - 1) * 2.4 * S : 0;
      ctx.translate(x + jitter, y);
      ctx.scale(shown * scale, scale); // the side's sign flips the chevron
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, 0);
      ctx.lineTo(-size * 0.35, -size * 0.5);
      ctx.lineTo(-size * 0.12, 0);
      ctx.lineTo(-size * 0.35, size * 0.5);
      ctx.closePath();
      ctx.fill();
      if (glitched && i >= b.idx) {
        // glitch scan bars across the chevron
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = '#05040c';
        ctx.fillRect(-size * 0.4, -size * 0.18 + Math.sin(fx.t * 30 + i) * size * 0.2, size, 2.2 * S);
      }
      ctx.restore();
      // The reversal badge: a U-turn arc doubling back over the lying chevron.
      // An inverted arrow is indistinguishable from an honest one pointing that
      // way — this arc is the only mark that says "mirror me". Drawn unscaled so
      // it always turns the same way, whichever side the chevron claims.
      if (glitched && i >= b.idx) {
        const r = size * 0.46, ay = y - size * 0.62;
        ctx.save();
        ctx.translate(x, ay);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.4 * S;
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI, 0); // an arc over the chevron, left to right
        ctx.stroke();
        // heads on both ends: the link points both ways, so read it backwards
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * r, 0);
          ctx.lineTo(dir * r - dir * size * 0.16, -size * 0.16);
          ctx.lineTo(dir * r + dir * size * 0.16, -size * 0.16);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
    const frac = Math.max(0, b.timer / b.timerMax);
    const barW = Math.max(totalW + size * 2, 200 * S);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#1a2138';
    ctx.fillRect(cx - barW / 2, y + size * 1.2, barW, 5 * S);
    ctx.fillStyle = frac < 0.3 ? '#ff2d4e' : '#26d6ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.fillRect(cx - barW / 2, y + size * 1.2, barW * frac, 5 * S);
    // Maglev howl: while the gust winds up, the slice it is about to tear off
    // pulses in wind colour — the player sees the cost before it lands
    if (b.windup > 0) {
      const left = n - b.idx;
      const after = Math.max(left * Game.GUST_MIN_PRESS, b.timer * Game.GUST_SQUEEZE) / b.timerMax;
      const lost = Math.max(0, frac - after);
      ctx.globalAlpha = 0.45 + 0.4 * Math.sin(fx.t * 26);
      ctx.fillStyle = '#bfefff';
      ctx.shadowColor = '#bfefff';
      ctx.fillRect(cx - barW / 2 + barW * after, y + size * 1.2, barW * lost, 5 * S);
    }
    ctx.restore();
    // Teaching caption: only while the link the player must press RIGHT NOW is a
    // lying one, and only until they have inverted a few successfully. The rule
    // has to be readable at the moment of the press — a help screen is too late.
    if (teach && b.glitch && b.glitch[b.idx]) {
      ctx.save();
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(fx.t * 9);
      ctx.fillStyle = '#ff4de0';
      ctx.shadowColor = '#ff4de0';
      ctx.shadowBlur = 12;
      ctx.font = `bold ${Math.round(15 * S)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(Game.L('СТРЕЛКА ЛЖЁТ — БЕЙ НАОБОРОТ', 'THE ARROW LIES — STRIKE OPPOSITE'),
        cx, y + size * 2.5);
      ctx.restore();
    }
  }

  // Maglev gust: a fan of wind streaks hurled along with the Warden
  function gust(side, dist) {
    const x0 = X(side, dist);
    for (let i = 0; i < 12; i++) {
      fx.parts.push({
        kind: 'spark',
        x: x0 + side * (20 + Math.random() * 160),
        y: groundY - (10 + Math.random() * 120) * S,
        vx: -side * (500 + Math.random() * 400),
        vy: (Math.random() - 0.5) * 40,
        life: 0.25 + Math.random() * 0.2,
        age: 0, color: '#bfefff',
      });
    }
  }

  // FOG mutator: dark curtains beyond the materialization edge on both sides
  function drawFogVeil() {
    const fade = 90 * unitPx;
    const pulse = 0.78 + 0.06 * Math.sin(fx.t * 1.7);
    // anchored via zonePx like the range markers — no one-frame jump on a dash
    const edgeR = cx + zonePx + Game.FOG_DIST * unitPx;
    const edgeL = cx + zonePx - Game.FOG_DIST * unitPx;
    ctx.save();
    let g = ctx.createLinearGradient(edgeR - fade, 0, edgeR + fade, 0);
    g.addColorStop(0, 'rgba(8,8,20,0)');
    g.addColorStop(1, `rgba(8,8,20,${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(edgeR - fade, 0, Math.max(0, W - (edgeR - fade)), H);
    g = ctx.createLinearGradient(edgeL + fade, 0, edgeL - fade, 0);
    g.addColorStop(0, 'rgba(8,8,20,0)');
    g.addColorStop(1, `rgba(8,8,20,${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Math.max(0, edgeL + fade), H);
    ctx.restore();
  }

  // ---------- Effects ----------
  const fx = { t: 0, parts: [], slashes: [], texts: [], bolts: [], corpses: [], rings: [], shake: 0, flash: null };
  let lastWX = null; // previous worldX — for dash splashes

  // The Arc Discharge bolt: a zigzag from the first target to the far one
  function bolt(side, fromDist, toDist) {
    fx.bolts.push({ side, fromDist, toDist, t0: fx.t });
  }

  function slash(side, hit) {
    lastSlash = { side, t: fx.t };
    fx.slashes.push({ side, t0: fx.t, hit });
  }

  function burst(side, dist, color, n = 14) {
    const x = X(side, dist), y = groundY - 34 * S;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 260;
      fx.parts.push({
        kind: Math.random() < 0.3 ? 'glitch' : 'spark',
        x, y: y + (Math.random() - 0.5) * 30 * S,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: 0.35 + Math.random() * 0.3,
        age: 0, color,
      });
    }
  }

  function floatText(txt, side, dist, color) {
    fx.texts.push({ txt, x: X(side, dist), y: groundY - 90 * S, age: 0, color });
  }

  // A projection breaking up: cold shards scatter and fade. Used when a phantom is
  // whiffed through or when one dissipates unstruck — the same "it was never solid".
  function phantomScatter(side, dist) {
    const x = X(side, dist), y = groundY - 42 * S;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 190;
      fx.parts.push({
        kind: 'glitch',
        x: x + (Math.random() - 0.5) * 22 * S, y: y + (Math.random() - 0.5) * 44 * S,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 24,
        life: 0.3 + Math.random() * 0.32, age: 0,
        color: Math.random() < 0.5 ? '#7fd0ff' : '#bfeaff',
      });
    }
  }

  function shake(p) { fx.shake = Math.min(18, fx.shake + p); }
  function flash(color, a) { fx.flash = { color, a }; }

  function drawFx(dt) {
    // slashes
    for (const sl of fx.slashes) {
      const age = fx.t - sl.t0;
      if (age > 0.2) continue;
      const k = age / 0.2;
      const r0 = 30 * S, r1 = (sl.hit ? 130 : 90) * S;
      ctx.save();
      ctx.translate(cx, groundY - 34 * S);
      ctx.scale(sl.side, 1);
      ctx.strokeStyle = k < 0.4 ? '#ffffff' : ACT_STYLE[actId].accent2;
      ctx.globalAlpha = 1 - k;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 16;
      ctx.lineWidth = (3.5 - k * 2.5) * S;
      ctx.beginPath();
      ctx.arc(0, 0, r0 + (r1 - r0) * k, -0.9 + k * 0.5, 0.7 + k * 0.5);
      ctx.stroke();
      ctx.restore();
    }
    fx.slashes = fx.slashes.filter(sl => fx.t - sl.t0 <= 0.2);

    // ripple rings from dashes
    for (const rg of fx.rings) {
      const k = (fx.t - rg.t0) / 0.5;
      if (k >= 1) continue;
      const x = cx + (rg.wx - worldVis) * unitPx;
      ctx.save();
      ctx.strokeStyle = '#bfefff';
      ctx.globalAlpha = 0.3 * (1 - k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, groundY + 3, 10 + k * 75, (10 + k * 75) * 0.22, 0, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
    fx.rings = fx.rings.filter(rg => fx.t - rg.t0 < 0.5);

    // discharge bolts
    for (const b of fx.bolts) {
      const age = fx.t - b.t0;
      if (age > 0.22) continue;
      const x1 = X(b.side, b.fromDist), x2 = X(b.side, b.toDist);
      const y = groundY - 36 * S;
      ctx.save();
      ctx.strokeStyle = age < 0.08 ? '#ffffff' : '#baff4d';
      ctx.globalAlpha = 1 - age / 0.22;
      ctx.shadowColor = '#baff4d';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5 * S;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      const segs = 5;
      for (let i = 1; i <= segs; i++) {
        const xx = x1 + (x2 - x1) * (i / segs);
        const yy = y + (i === segs ? 0 : (Math.random() - 0.5) * 26 * S);
        ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      ctx.restore();
    }
    fx.bolts = fx.bolts.filter(b => fx.t - b.t0 <= 0.22);

    // particles
    for (const p of fx.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind !== 'ember') p.vy += 500 * dt; // embers drift upward, no gravity
      const k = 1 - p.age / p.life;
      if (k <= 0) continue;
      ctx.save();
      ctx.globalAlpha = k;
      if (p.kind === 'ember') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 * S * (0.5 + k), 0, 7);
        ctx.fill();
      } else if (p.kind === 'glitch') {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 7 * k * S + 2, 3 * S);
      } else {
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.8 * S;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      }
      ctx.restore();
    }
    fx.parts = fx.parts.filter(p => p.age < p.life);

    // floating text
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(16 * S)}px sans-serif`;
    for (const tx of fx.texts) {
      tx.age += dt;
      const k = 1 - tx.age / 0.8;
      if (k <= 0) continue;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.fillStyle = tx.color;
      ctx.shadowColor = tx.color;
      ctx.shadowBlur = 10;
      ctx.fillText(tx.txt, tx.x, tx.y - tx.age * 46 * S);
    }
    ctx.restore();
    fx.texts = fx.texts.filter(tx => tx.age < 0.8);

    // full-screen flash
    if (fx.flash) {
      ctx.save();
      ctx.globalAlpha = fx.flash.a;
      ctx.fillStyle = fx.flash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      fx.flash.a -= dt * 3;
      if (fx.flash.a <= 0) fx.flash = null;
    }
  }

  // ---------- Act change ----------
  function setAct(id) {
    if (!ACT_STYLE[id]) id = 'street';
    actId = id;
    // the horizon is per-location, so the ground line has to be recomputed here
    // as well as on resize — see SCENES.horizon
    groundY = H * horizonOf();
    alignDeck();
    bgCache = null;
    gradCache = {}; // gradients carry the act's palette and horizon
    initWeather();
    initTraffic();
  }

  // ---------- Frame ----------
  function render(st8, dt) {
    fx.t += dt;
    driftPx += (scene().drift || 0) * unitPx * dt; // scenes that move on their own
    // the menu postcard pans on its own — a slow travelling shot through the
    // parallax with no one on the ground
    if (st8.phase === 'menu') driftPx += 22 * unitPx * dt;
    if (cinemaMode) cineTravel += 900 * unitPx * dt; // the travelling shot's mileage
    // camera: worldVis smoothly catches up with the logic's worldX, the world glides under the hero
    const wxT = st8.run && (st8.phase === 'combat' || st8.phase === 'choice') ? st8.run.worldX : worldVis;
    if (Math.abs(wxT - worldVis) > 600) worldVis = wxT; // teleport cases skip the animation
    // Exponential rather than `min(1, dt * rate)`. The clamped form saturates:
    // during the empty-approach fast-forward dt reaches ~88ms, the factor hits 1
    // and the smoothing silently becomes a hard snap, so the whole background
    // lurches. This form approaches 1 without ever reaching it and matches the
    // old response almost exactly at normal frame times (0.21 against 0.23).
    worldVis += (wxT - worldVis) * (1 - Math.exp(-14 * dt));
    camPx = (wxT - worldVis) * unitPx;
    if (Math.abs(camPx - zonePx) > 200) zonePx = camPx; // teleports snap
    else zonePx += (camPx - zonePx) * (1 - Math.exp(-dt / 0.045));
    // dash: a fan of splashes from under the feet and a ripple ring on the "water"
    if (st8.run && st8.phase === 'combat' && lastWX !== null && wxT !== lastWX) {
      const dir = Math.sign(wxT - lastWX);
      for (let i = 0; i < 9; i++) {
        fx.parts.push({
          kind: 'spark',
          x: cx - dir * (4 + Math.random() * 16),
          y: groundY - 2,
          vx: -dir * (50 + Math.random() * 130),
          vy: -(30 + Math.random() * 100),
          life: 0.3 + Math.random() * 0.25,
          age: 0, color: '#bfefff',
        });
      }
      fx.rings.push({ wx: wxT, t0: fx.t });
    }
    lastWX = st8.run && st8.phase === 'combat' ? wxT : null;
    ctx.save();
    if (fx.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
      fx.shake *= Math.pow(0.001, dt); // fast decay
    } else fx.shake = 0;
    // Carriage ride: a slow vertical roll with a faster tremor under it. Amplitude
    // is deliberately under a pixel and a half — enough to feel the train, far too
    // little to move a strike marker or blur the fighting band. A camera that
    // fights the player for readability is not atmosphere, it is a fairness bug.
    const sway = scene().sway || 0;
    if (sway) {
      ctx.translate(0, Math.sin(fx.t * 1.7) * sway + Math.sin(fx.t * 13.3) * sway * 0.35);
    }

    drawBg(fx.t, dt);

    const run = st8.run;
    const inCombat = st8.phase === 'combat' || st8.phase === 'choice';

    // fighter reflections in the wet ground: flipped, squashed, dimmed
    reflectPass = true;
    ctx.save();
    ctx.translate(0, groundY);
    ctx.scale(1, -0.42);
    ctx.translate(0, -groundY);
    ctx.globalAlpha = 0.15;
    if (inCombat && run) {
      for (const e of run.enemies) drawEnemy(e, fx.t, run);
      if (run.boss) {
        drawBoss(run.boss, fx.t, X(run.boss.side, run.boss.dist), 0, 0);
        drawBossPhantom(run.boss, fx.t); // the projection mirrors in the wet ground too
      }
    }
    // the menu is a location postcard, not a stage — no hero, no reflection
    if (!(heroDeath && st8.phase === 'dead') && st8.phase !== 'menu') drawHero(run, fx.t, 0, false, false);
    ctx.restore();
    reflectPass = false;

    drawGroundFx(fx.t);

    if (inCombat && run) {
      const rgUnits = Game.range(st8);
      const zoneActive = run.enemies.some(e =>
        !e.dead && e.dist <= rgUnits && !(e.kind === 'proj' && e.reflected)) ||
        !!(run.boss && (run.boss.state === 'qte' || run.boss.dist <= rgUnits));
      // drawn 3% narrower than the logic zone: anything visually inside the
      // markers is guaranteed to be reachable — the sprite's body width would
      // otherwise read as "in the zone" a beat before the enemy's true point is
      // no strike zone during a cutscene: there is nothing to strike, and a
      // reach marker gliding along the ground breaks the travelling shot
      if (!cinemaMode) drawRange(ACT_STYLE[actId], rgUnits * unitPx * 0.97, fx.t, zoneActive);
      // the energy thread between a pair's living twins — shows they are bonded
      const pairs = {};
      for (const e of run.enemies) {
        if (!e.dead && e.type === 'twin') (pairs[e.pair] = pairs[e.pair] || []).push(e);
      }
      for (const k in pairs) {
        if (pairs[k].length !== 2) continue;
        const [a, b] = pairs[k];
        // the thread must not betray a twin hidden in the fog
        if (Game.mutHas(run, 'fog') && (a.dist > Game.FOG_DIST || b.dist > Game.FOG_DIST)) continue;
        const y = groundY - 40 * S;
        ctx.save();
        ctx.strokeStyle = eColor('twin');
        ctx.globalAlpha = 0.3 + 0.15 * Math.sin(fx.t * 6);
        ctx.shadowColor = eColor('twin');
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.6 * S;
        ctx.beginPath();
        ctx.moveTo(X(a.side, a.dist), y);
        ctx.quadraticCurveTo(cx, y - 30 * S, X(b.side, b.dist), y);
        ctx.stroke();
        ctx.restore();
        // The pair's demand, written on the thread itself: ◄ + ►. A thread alone
        // says "bonded", which does not imply "press both at once" — this does.
        // The chord window (CHORD_WIN) is far too short to hint after the first
        // press, so the instruction has to be standing there before it.
        const ay = y - 22 * S;
        ctx.save();
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(fx.t * 6);
        ctx.fillStyle = eColor('twin');
        ctx.shadowColor = eColor('twin');
        ctx.shadowBlur = 10;
        const cs = 7 * S, off = 15 * S;
        for (const dir of [-1, 1]) { // a chevron pointing outward on each side
          ctx.beginPath();
          ctx.moveTo(cx + dir * (off + cs), ay);
          ctx.lineTo(cx + dir * off, ay - cs);
          ctx.lineTo(cx + dir * off, ay + cs);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillRect(cx - 5 * S, ay - 1.6 * S, 10 * S, 3.2 * S); // the "+" joining them
        ctx.fillRect(cx - 1.6 * S, ay - 5 * S, 3.2 * S, 10 * S);
        // and the words, until the player has actually landed a few chords
        if (st8.meta.stats.chords < Game.TEACH_CHORDS) {
          ctx.font = `bold ${Math.round(13 * S)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(Game.L('ОБЕ КНОПКИ СРАЗУ', 'BOTH BUTTONS AT ONCE'), cx, ay - 16 * S);
        }
        ctx.restore();
      }
      drawCorpses();
      const liveIds = new Set(run.enemies.map(en => en.id));
      for (const id of [...enemyVis.keys()]) if (!liveIds.has(id)) enemyVis.delete(id);
      for (const e of run.enemies) drawEnemy(e, fx.t, run);
      if (Game.mutHas(run, 'fog')) drawFogVeil();
      if (run.boss) {
        const b = run.boss;
        const bx = X(b.side, b.dist);
        if (!bossVis) bossVis = { side: b.side, x: bx, jump: null, idx: 0, flinchT: -9 };
        if (bossVis.side !== b.side) {
          // the logic switched sides instantly — on screen the Warden vaults over
          bossVis.jump = { fromX: bossVis.x, t0: fx.t };
          bossVis.side = b.side;
          bossVis.idx = b.idx || 0;
        } else if (b.state === 'qte' && b.idx !== bossVis.idx) {
          // a hit registered without a side change — the Warden flinches
          bossVis.flinchT = fx.t;
          bossVis.idx = b.idx;
        }
        if (b.state !== 'qte') bossVis.idx = 0;
        let drawX = bx, jumpK = 0, spin = 0;
        if (bossVis.jump) {
          const k = (fx.t - bossVis.jump.t0) / 0.24;
          if (k >= 1) bossVis.jump = null;
          else {
            drawX = bossVis.jump.fromX + (bx - bossVis.jump.fromX) * k;
            jumpK = Math.sin(Math.PI * k);
            spin = k * Math.PI * 2 * (bx > bossVis.jump.fromX ? 1 : -1);
          }
        } else {
          // same-side retreat (contact or QTE fault) — a backward skid, not a teleport
          if (!bossVis.slide && (bx - bossVis.x) * b.side > 12 * S) {
            bossVis.slide = { fromX: bossVis.x, t0: fx.t };
          }
          if (bossVis.slide) {
            const k = (fx.t - bossVis.slide.t0) / 0.3;
            if (k >= 1) bossVis.slide = null;
            else drawX = bossVis.slide.fromX + (bx - bossVis.slide.fromX) * (1 - (1 - k) * (1 - k));
          }
        }
        bossVis.x = drawX;
        drawBoss(b, fx.t, drawX, jumpK, spin, fx.t - bossVis.flinchT);
        drawBossPhantom(b, fx.t);
        if (b.state === 'qte') drawQte(b, st8.meta.stats.glitchHits < Game.TEACH_GLITCH);
      } else bossVis = null;
    } else bossVis = null;
    if (heroDeath && st8.phase === 'dead') {
      drawHeroDeath();
    } else if (st8.phase !== 'menu') { // the menu postcard stands empty
      if (st8.phase !== 'dead') heroDeath = null; // a new run/menu — the hero is back on his feet
      const stunFrac = inCombat && run && run.stun > 0
        ? Math.min(1, run.stun / Game.stunTime(st8)) : 0;
      const execReady = !!(inCombat && run && run.implants.berserk &&
        run.execHits % Game.EXEC_EVERY === Game.EXEC_EVERY - 1);
      const ce = inCombat && run ? Game.chainEvery(st8) : 0;
      const chainReady = !!(ce && (run.chainCombo + 1) % ce === 0);
      drawHero(run, fx.t, stunFrac, execReady, chainReady);
    } else heroDeath = null; // back in the menu — the next run starts on his feet
    drawFx(dt);
    drawForeground(fx.t); // nearest plane: over the fighters and their effects
    drawBranch(fx.t);     // the summit's foreground foliage, nearest of all
    ctx.restore();
    // post: the finished frame, shake included
    watchFrameRate();
    drawBloom();
    drawGrain();
  }

  // Flip one effect.
  function setFx(name, on) {
    if (!(name in fx0)) return fx0;
    fx0[name] = !!on;
    // a hand overrides the verdict: the ladder climbs back to full quality too
    if (name === 'bloom') { bloomGaveUp = false; frameSlow = 0; if (resStep) { resStep = 0; resize(); } }
    return fx0;
  }

  resize();
  initWeather();
  initTraffic();

  return { render, setAct, setCinema, setWeather, slash, burst, floatText, phantomScatter, bolt, corpse, heroDie, heroHurt, shake, flash, gust,
    setFx, getFx: () => fx0, X: (side, dist) => X(side, dist) };
})();
