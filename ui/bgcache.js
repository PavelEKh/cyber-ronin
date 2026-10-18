'use strict';
// Static background generation, pulled out of scene.js on purpose.
//
// Two things live here that do not need a canvas: the seeded procedural placement
// of every silhouette, window, sign and petal, and the discipline that keeps one
// act's edit from disturbing another. Keeping it canvas-free means it can be tested
// in node (see bgcache.test.js) — the generated geometry is hashed per act, so a
// change to one act's numbers is caught and NAMED without rendering a single pixel
// or eyeballing a screenshot.
//
// The old model ran the whole scene off ONE seeded counter. That made layer order a
// hidden global dependency: adding a draw to an upstream layer shifted every layer
// after it, and the fix was a fragile ritual — "generate unconditionally, guard the
// result" — repeated at every layer with a comment begging the next editor to obey.
// Here each layer draws from its OWN stream, keyed by name. Order independence is now
// structural: an edit to one layer's generator cannot move another, because they no
// longer share a running number. The ritual is gone.

const BgCache = (() => {

  // Deterministic mini-random for static decorations.
  function propRnd(seed) {
    let s = seed | 0;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  // env carries everything generation needs and nothing it does not — no ctx, no
  // module globals. Fields: W, H, groundY, S, HUD_SAFE, ceilH (a number, not the
  // CEIL_H function), actId, deck, profile, layers (the scene's layer list, for
  // membership tests), style {accent, accent2, words, signs}.
  function compute(env) {
    const { W, H, groundY, S, HUD_SAFE, ceilH, actId, deck, profile, layers, style: st } = env;
    const baseSeed = actId.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    // One stream per layer. Same act, same layer name → same stream, forever; a
    // different layer gets a different one, so their draws never interleave.
    const sub = (tag) => {
      let h = baseSeed;
      for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
      return propRnd(h);
    };
    const has = (name) => layers.indexOf(name) >= 0;

    const P = W + 500; // tiling period of the parallax layers
    // Standing ON a roof means the horizon is the parapet, and everything beyond it
    // is BELOW you. The silhouette rows keep their ragged variety and their depth
    // ordering — near is still taller than far — they are just scaled down until
    // only crowns clear the wall.
    const roofTop = deck === 'roof';
    const indoor = profile === 'racks';
    const afloat = profile === 'containers'; // the near plane is deck cargo, not a city
    // The market is a LOW-RISE alley: shophouses of two-three floors, packed
    // tight and lit warm, instead of the street's skyscraper canyon. Height is
    // the single strongest silhouette cue an act has.
    const lowRise = actId === 'market';
    // On the roof the parapet crops the towers; on the water the bay does the same
    // job — the far shore's rows are squashed so the sea band can cover their feet.
    const SKYLINE_K = roofTop ? 0.42 : afloat ? 0.55 : 1;
    const bayH = () => Math.max(60, groundY - ceilH);

    // ---- stars (screen-space, they twinkle)
    const rStars = sub('stars');
    const stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({ x: rStars() * W, y: rStars() * groundY * 0.62, r: 0.6 + rStars() * 1.1, ph: rStars() * 7 });
    }

    // ---- ultra-far skyline — barely distinct from the sky, adds a third plane
    const rFarfar = sub('farfar');
    const farfar = [];
    const ffN = Math.ceil(P / 70);
    for (let i = 0; i <= ffN; i++) {
      farfar.push({ x: i * 70 + rFarfar() * 26 - 13, w: 44 + rFarfar() * 36,
                    h: H * (0.10 + rFarfar() * 0.14) * SKYLINE_K * (lowRise ? 0.6 : 1) });
    }

    // ---- far silhouette row (for server — racks, same rectangles)
    // Aerial-perspective blur was tried on this layer and on the one behind it, and
    // removed: it is invisible and cannot be otherwise. Distance here is sold by the
    // haze, not by focus. Outdoors this is a skyline — heights vary, the top edge is
    // ragged, and that raggedness is most of what says "city". A rack hall is the
    // opposite: cabinets come one size, stand in line, top out level. So indoors the
    // row is near-uniform and the aisles regular; the little variation left keeps it
    // from reading as one solid bar.
    const rFar = sub('far');
    const far = [];
    if (indoor) {
      const farN = Math.ceil(P / 66);
      for (let i = 0; i <= farN; i++) {
        far.push({ x: i * 66, w: 54, h: bayH() * (0.56 + (i % 3) * 0.02) });
      }
    } else {
      const farN = Math.ceil(P / 90);
      for (let i = 0; i <= farN; i++) {
        far.push({ x: i * 90 + rFar() * 30 - 15, w: 55 + rFar() * 45,
                   h: H * (0.18 + rFar() * 0.22) * SKYLINE_K * (lowRise ? 0.55 : 1) });
      }
    }

    // ---- ground markings — the fastest parallax layer (1:1 with the world)
    const rMarks = sub('marks');
    const marks = [];
    for (let mx = 0; mx < P; mx += 90 + rMarks() * 110) {
      marks.push({ x: mx, w: 20 + rMarks() * 34 });
    }

    // ---- puddles: mirror patches on the "water". Kept only where a scene asks for
    // them — a sealed server hall has no rain pools. Their own stream means building
    // them here costs the rest of the scene nothing whether they are kept or not.
    const rPud = sub('puddles');
    const puddles = [];
    for (let i = 0; i < 6; i++) {
      puddles.push({
        x: rPud() * P,
        y: groundY + 16 + rPud() * Math.max(24, H - groundY - 56),
        w: 70 + rPud() * 140,
        h: 9 + rPud() * 9,
      });
    }

    // ---- near plane: the buildings the eye actually reads, each carrying its own
    // windows, roof furniture, cables and sign. One stream for the whole group —
    // they are one composition (a lit building with its crown), so editing the sign
    // rule may shift this act's windows, but never another act or another layer.
    const rNear = sub('near');
    const near = [], windows = [], roofs = [], cables = [], signs = [];
    // a clearing for the landmark: pagoda/torii/gate stand between buildings, not on top
    const lmZone = actId === 'street' ? [P * 0.55 - 60, P * 0.55 + 270]
                 : actId === 'garden' ? [P * 0.5 - 90, P * 0.5 + 530]
                 : actId === 'market' ? [P * 0.5 - 70, P * 0.5 + 290]
                 : null;
    // The market is the street turned up: nearly every wall wears a sign, and
    // half the signs say words — this is the act about telling real from fake,
    // and the walls keep repeating the lesson (本物 · 偽物).
    const signChance = actId === 'market' ? 0.9 : 0.55;
    const wordChance = actId === 'market' ? 0.55 : 0.34;
    if (afloat) {
      // no city near-plane on the water: the cargo below rides the deck instead
    } else if (indoor) {
      // cabinets, not buildings: one height, one width, regular aisles. Status LEDs
      // sit in ordered columns — scattered windows are what made this read as flats.
      const nearN = Math.ceil(P / 128);
      for (let i = 0; i <= nearN; i++) {
        const b = { x: i * 128, w: 98, h: bayH() * 0.88, rack: true };
        near.push(b);
        for (let c = 0; c < 3; c++) {
          for (let wy = groundY - b.h + 18; wy < groundY - 22; wy += 15) {
            windows.push({ x: b.x + 16 + c * 28, y: wy, lit: rNear() < 0.62 });
          }
        }
      }
    } else {
      const nearN = Math.ceil(P / (lowRise ? 116 : 150));
      for (let i = 0; i <= nearN; i++) {
        const b = lowRise
          // shophouses: low, narrow, wall to wall — an alley, not a canyon
          ? { x: i * 116 + rNear() * 24 - 12, w: 74 + rNear() * 48,
              h: H * (0.15 + rNear() * 0.13) }
          : { x: i * 150 + rNear() * 50 - 25, w: 85 + rNear() * 70,
              h: H * (0.3 + rNear() * 0.3) * SKYLINE_K };
        if (lmZone && b.x + b.w > lmZone[0] && b.x < lmZone[1]) continue;
        near.push(b);
        // Windows. On the roof a tower shows only its crown, so the lit band is a
        // share of the building, not a fixed 24px above the ground line — otherwise
        // most windows generate behind the parapet. In the market almost every
        // window burns: the alley lives at night.
        const winFloor = roofTop ? b.h * 0.35 : 24;
        const winChance = lowRise ? 0.55 : 0.28, litChance = lowRise ? 0.8 : 0.55;
        for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += lowRise ? 12 : 14) {
          for (let wy = groundY - b.h + 12; wy < groundY - winFloor; wy += lowRise ? 16 : 20) {
            if (rNear() < winChance) windows.push({ x: wx, y: wy, lit: rNear() < litChance });
          }
        }
        // roof details: antennas with beacons or a glowing billboard
        const roofY = groundY - b.h;
        if (rNear() < 0.6) {
          const n = 1 + Math.floor(rNear() * 3);
          for (let k = 0; k < n; k++) {
            roofs.push({ type: 'ant', x: b.x + 8 + rNear() * (b.w - 16), y: roofY,
                         h: 12 + rNear() * 26, ph: rNear() * 7, beacon: rNear() < 0.5 });
          }
        }
        if (rNear() < 0.28 && b.w > 110) {
          roofs.push({ type: 'board', x: b.x + b.w * 0.18, y: roofY - 26 - rNear() * 10,
                       w: b.w * (0.45 + rNear() * 0.2), h: 20 + rNear() * 10,
                       color: rNear() < 0.5 ? st.accent : st.accent2, ph: rNear() * 7 });
        }
        // a cable to the previous building if they stand close
        const prev = near[near.length - 2];
        if (prev && b.x - (prev.x + prev.w) < 240 && rNear() < 0.75) {
          cables.push({
            x1: prev.x + prev.w - 6, y1: groundY - prev.h + 6 + rNear() * 14,
            x2: b.x + 6, y2: roofY + 6 + rNear() * 14,
            sag: 16 + rNear() * 26,
          });
        }
        // a neon sign on some buildings
        if (rNear() < signChance) {
          let text;
          if (st.words && rNear() < wordChance) {
            text = st.words[Math.floor(rNear() * st.words.length)];
          } else {
            const n = 2 + Math.floor(rNear() * 3);
            text = '';
            for (let k = 0; k < n; k++) text += st.signs[Math.floor(rNear() * st.signs.length)];
          }
          // Same reason as the windows: a sign hung 20..60px below the top lands
          // behind the parapet on a short tower. On the roof it rides the crown.
          signs.push({
            x: b.x + 14 + rNear() * (b.w - 34),
            y: groundY - b.h + (roofTop ? 6 : 20) + rNear() * (roofTop ? Math.max(8, b.h * 0.34) : 40),
            text,
            color: rNear() < 0.5 ? st.accent : st.accent2,
            ph: rNear() * 10,
          });
        }
      }
    }

    // ---- lantern strings: the market hangs light where the street hangs cable.
    // Strung between the same neighbouring buildings, lamps spaced along the sag.
    const rLan = sub('lanterns');
    const lanterns = [];
    if (has('lanterns')) {
      for (let i = 1; i < near.length; i++) {
        const a = near[i - 1], b = near[i];
        if (b.x - (a.x + a.w) > 300 || rLan() < 0.25) continue;
        const ln = {
          x1: a.x + a.w - 8, y1: groundY - a.h + 10 + rLan() * 30,
          x2: b.x + 8, y2: groundY - b.h + 10 + rLan() * 30,
          sag: 22 + rLan() * 30,
          lamps: [],
        };
        const n = 3 + Math.floor(rLan() * 4);
        for (let k = 0; k < n; k++) {
          ln.lamps.push({
            f: (k + 0.5) / n + (rLan() - 0.5) * 0.08,
            r: 4 + rLan() * 3,
            ph: rLan() * 7,
            warm: rLan() < 0.72,
          });
        }
        lanterns.push(ln);
      }
    }

    // ---- canopy: tarps strung over the alley. They roof the market's top edge —
    // translucent, dark, allowed to cross the HUD band precisely because they
    // carry no light of their own.
    const rCan = sub('canopy');
    const canopy = [];
    if (has('canopy')) {
      let cx2 = rCan() * 90;
      while (cx2 < P - 100) {
        const w = 150 + rCan() * 110;
        canopy.push({ x: cx2, w, drop: 30 + rCan() * 26,
                      tone: Math.floor(rCan() * 3), ph: rCan() * 7 });
        cx2 += w + 70 + rCan() * 160;
      }
    }

    // ---- nobori: vertical cloth banners on poles, planted along the stall
    // line — nothing else in the game hangs cloth, so they are the alley's own
    // signature against the street's hard neon.
    const rNob = sub('nobori');
    const nobori = [];
    if (has('nobori')) {
      for (let nx = 60 + rNob() * 120; nx < P - 80; nx += 240 + rNob() * 260) {
        const glyphs = st.words ? st.words[Math.floor(rNob() * st.words.length)] : '市';
        nobori.push({
          x: nx, h: 96 + rNob() * 40, w: 17 + rNob() * 5,
          tone: Math.floor(rNob() * 3), ph: rNob() * 7,
          text: glyphs.slice(0, 2),
        });
      }
    }

    // ---- market stalls: the row of counters and awnings just behind the
    // fighting band — the thing that actually says "market" at eye level.
    // Parallax 0.5: nearer than the buildings, so they slide past faster.
    const rSt = sub('stalls');
    const stalls = [];
    if (has('stalls')) {
      let sx2 = 30 + rSt() * 100;
      while (sx2 < P - 120) {
        const w = 84 + rSt() * 52;
        const st2 = {
          x: sx2, w,
          h: 76 + rSt() * 20,          // counter + awning, px above the ground line
          tone: Math.floor(rSt() * 3), // awning canvas
          ph: rSt() * 7,
          steam: rSt() < 0.45,         // a noodle pot somewhere under the canopy
          // the keeper: a head-and-shoulders silhouette in the lit opening. Dark,
          // small, boxed behind the counter — nothing about it can read as a walker.
          keeper: rSt() < 0.78
            ? { dx: 0.25 + rSt() * 0.5, h: 26 + rSt() * 7, ph: rSt() * 7 }
            : null,
          crates: [],
        };
        for (let c = 0, n = 2 + Math.floor(rSt() * 3); c < n; c++) {
          st2.crates.push({ dx: 6 + rSt() * (w - 28), w: 11 + rSt() * 12, h: 10 + rSt() * 12 });
        }
        stalls.push(st2);
        sx2 += w + 46 + rSt() * 150;
      }
    }

    // ---- the crowd: shoppers at the stalls. Fair by construction — dark, a
    // head shorter than any fighter, glowless, and they only ever STAND (weight
    // shifts, nothing walks): every cue that says "enemy" is absent.
    const rCr = sub('crowd');
    const crowd = [];
    if (has('crowd')) {
      for (const stl of stalls) {
        const n = Math.floor(rCr() * 3); // 0..2 browsing at each stall
        for (let k = 0; k < n; k++) {
          const side = rCr() < 0.5 ? -1 : 1;
          crowd.push({
            x: stl.x + (side < 0 ? -(10 + rCr() * 24) : stl.w + 10 + rCr() * 24),
            h: 34 + rCr() * 9,
            flip: -side, // faces the counter it stands beside
            ph: rCr() * 7,
            bag: rCr() < 0.35,
          });
        }
      }
      // and a few loners drifting between the stalls
      for (let cx3 = 120 + rCr() * 200; cx3 < P - 60; cx3 += 340 + rCr() * 380) {
        crowd.push({ x: cx3, h: 33 + rCr() * 10, flip: rCr() < 0.5 ? -1 : 1,
                     ph: rCr() * 7, bag: rCr() < 0.5 });
      }
    }

    // ---- sea glints: strokes on the bay, nearer water sliding faster past the
    // hull — their parallax spread is most of what makes the water read as water
    const rWave = sub('waves');
    const rQuay = sub('quay');
    const waves = [], quay = [];
    if (has('sea')) {
      // dock lights along the far quay — sparse, warm, each on its own clock
      for (let qx = rQuay() * 60; qx < P; qx += 46 + rQuay() * 120) {
        quay.push({ x: qx, ph: rQuay() * 7 });
      }
      for (let i = 0; i < 72; i++) {
        const k = rWave();
        waves.push({ x: rWave() * P, k, len: 30 + rWave() * 72,
                     ph: rWave() * 7, par: 0.25 + k * 0.55 });
      }
    }

    // ---- deck cargo: container stacks travelling with the hero. Gaps between
    // stacks are deliberate — they are where the bay shows through the railing.
    const rCargo = sub('cargo');
    const cargo = [];
    if (afloat) {
      let cxr = 40 + rCargo() * 120;
      while (cxr < P - 160) {
        const w = 110 + rCargo() * 120;
        cargo.push({
          x: cxr, w,
          // mostly single-tier: the cargo must not wall off the bay — the sea
          // showing over the boxes is the whole point of the location
          tiers: rCargo() < 0.3 ? 2 : 1,
          tone: Math.floor(rCargo() * 3),
          glyph: st.words && rCargo() < 0.4
            ? st.words[Math.floor(rCargo() * st.words.length)] : null,
        });
        cxr += w + 160 + rCargo() * 340;
      }
    }

    // ---- deck furniture: the working clutter that makes plating a working
    // ship — a fore-mast, mooring bollards with their rope coils, a winch or
    // two, and stencilled bay numbers painted on the plates.
    const rDp = sub('deckprops');
    const deckProps = [];
    if (afloat) {
      for (let i = 0; i < 2; i++) {
        deckProps.push({ type: 'mast', x: (i + 0.25 + rDp() * 0.5) * P / 2, ph: rDp() * 7 });
      }
      for (let px2 = 60 + rDp() * 140; px2 < P - 60; px2 += 210 + rDp() * 240) {
        deckProps.push({ type: rDp() < 0.72 ? 'bollard' : 'winch', x: px2, ph: rDp() * 7 });
      }
      let bay = 2 + Math.floor(rDp() * 4);
      for (let px2 = 140 + rDp() * 200; px2 < P - 100; px2 += 430 + rDp() * 320) {
        bay += 1 + Math.floor(rDp() * 2);
        deckProps.push({ type: 'stencil', x: px2, n: bay });
      }
    }

    // ---- overhead rig: hangers dropping from the frame's top edge, cables between
    // them, a lantern on some. Upper third only, never the fighting band — a
    // foreground that can hide an approaching enemy is a fairness bug in a costume.
    const rFg = sub('fg');
    const fg = [];
    for (let x = 0; x < P; x += 200 + rFg() * 240) {
      const lamp = rFg() < 0.38;
      // A lamp is the one bright thing in the near plane, so it may not sit behind
      // the HUD: armor pips, combo counter and act line own the top HUD_SAFE pixels.
      // Lamp hangers lengthen until their light clears that band; bare ones may be
      // any length, they are black.
      let h = 34 + rFg() * 96;
      if (lamp) h = Math.max(h, (HUD_SAFE + 18 - 15 * S) / S);
      fg.push({ x, h, w: 3 + rFg() * 4, lamp, ph: rFg() * 7,
                color: rFg() < 0.5 ? st.accent : st.accent2 });
    }

    // ---- petals that already landed. The falling ones are weather (screen-space);
    // these have come to rest, so they belong to the surface — they tile on P and
    // ride the deck clock, travelling with the hero. Only where there is a roof.
    const rFallen = sub('fallen');
    const fallen = [];
    if (roofTop) {
      for (let i = 0; i < 54; i++) {
        fallen.push({
          x: rFallen() * P,
          k: rFallen(),            // 0 at the far edge of the roof, 1 at the bottom
          rot: rFallen() * 7,
          sz: 3 + rFallen() * 2.4,
        });
      }
    }

    // ---- a sakura branch in the top-left corner, drawn as an ink stroke: a thin
    // angular limb, a few big five-petal flowers and buds — the near-plane depth
    // the open roof otherwise lacks. Anchored to the corner and only SWAYS, never
    // scrolls. Left side on purpose: the right is full (torii, moon, score), and
    // framing the empty corner balances it.
    // Coordinates are in units of a 720-tall frame, scaled by H/720 at draw, so the
    // stroke keeps its shape on any aspect. The shape is the one picked by ear in
    // tools/scene/landmarks-lab.html (2026-10-17) — its own fixed seed rather than
    // sub('branch'), so the game draws exactly that branch. Flowers stay below
    // y 90: the dark limb may pass behind the armor pips, a lit flower may not.
    const branch = { seg: [], flowers: [], buds: [] };
    if (roofTop) {
      let seed = 17;
      const rBr = () => { // mulberry32, as in the lab page
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
      const yFloor = 90;
      let x = -20, y = -20, a = 0.5;
      for (let i = 0; i < 7; i++) {
        a += (i % 2 ? 0.55 : -0.45) + (rBr() - 0.5) * 0.2; // the zigzag of an ink limb
        const L = 70 + rBr() * 40, ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
        branch.seg.push({ x1: x, y1: y, x2: ex, y2: ey, w: 11 - i * 1.3 });
        if (i > 1 && rBr() < 0.8) {
          const ta = a + (rBr() < 0.5 ? -1 : 1) * 0.9, tl = 30 + rBr() * 30;
          const tx = ex + Math.cos(ta) * tl, ty = ey + Math.sin(ta) * tl;
          branch.seg.push({ x1: ex, y1: ey, x2: tx, y2: ty, w: 3 });
          (rBr() < 0.6 ? branch.flowers : branch.buds).push({ x: tx, y: Math.max(yFloor, ty), ph: rBr() * 7 });
        }
        if (i > 0 && rBr() < 0.7) branch.flowers.push({ x: ex, y: Math.max(yFloor, ey), ph: rBr() * 7 });
        x = ex; y = ey;
      }
    }

    return { far, near, signs, windows, marks, P, farfar, stars, roofs, cables, fg, branch,
             puddles: has('puddles') ? puddles : [],
             fallen, lanterns, waves, quay, cargo, stalls, nobori, canopy, crowd, deckProps };
  }

  return { compute, propRnd };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BgCache;
else globalThis.BgCache = BgCache;
