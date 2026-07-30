'use strict';
// Sound: pure WebAudio synthesis, no files. The context is created after the first
// user input (browser autoplay rules).

const Sound = (() => {
  let ctx = null, master = null, musicBus = null, sfxBus = null;
  let musicFx = null, duckGain = null; // the music's lowpass and duck stage
  let limiter = null, revSend = null, conv = null; // output limiter and dense-reverb send
  let echoSend = null, echoDelay = null, echoDamp = null, echoFb = null; // outdoor slapback
  let peril = false; // the hero is one hit from death — see setPeril
  let musicTimer = null, musicStep = 0, musicRoot = 41.2; // E1
  let musicAct = null; // remembered so a BPM change can restart the same track
  let musicT0 = 0; // when step 0 landed on the sample clock — the grid's anchor
  let autoTier = 0; // 0..3 — how many layers the combo asks for (see setTier)
  let lastNoteAt = -1; // voice limiter for the melodic layer — see note()
  // Where the voices of the sfx currently being built should land. sfx() points
  // this at a panner for the duration of one call, so the thirty-odd tone() and
  // noiseHit() calls in the switch need no extra argument each.
  let voiceDest = null;

  // Debug knobs, driven by the panel in debug.js. All default to the shipping
  // behaviour, so the game plays identically unless something is toggled — this
  // exists to A/B the adaptive-audio design by ear, one factor at a time.
  // The three below stay off: each was A/B'd by ear across its whole range and
  // none was detectable in play. Kept switchable rather than deleted — the code
  // is written and the panel can bring it back if the design ever changes.
  const FLAGS = {
    notes: false,      // melodic voice per strike — "in key but meaningless noodling"
    quantPitch: false, // snap combo pitch to the ladder (off = the original glissando)
    quantTime: false,  // snap the melodic voice to the grid
    tiers: false,      // gate arrangement layers by combo (off = the full original mix)
    grid: 32,          // note value strikes snap to: 4 quarter, 8 eighth, 16, 32
    noteGain: 1,       // multiplier on the melodic voice
    // --- proven / shipping ---
    pan: true,         // place impacts in the stereo field by the side they came from
    panWidth: 0.75,    // how far out a strike sits, 0 centre .. 1 hard side
    duck: true,        // collapse the music on a miss
    drop: true,        // filter-sweep the music on a milestone combo
    weight: true,      // heavier low end on kills
    limiter: true,     // catch the peaks stacked kills produce
    voices: true,      // give each enemy type its own timbre
    space: true,       // per-act reverb
    spaceGain: 1,      // overall scale on it — taste, dialled from the panel
    peril: true,       // the music tightens on the last armor pip
    music: true,       // the backing arrangement
    sfx: true,         // impacts — mute to hear the melody bare
    tier: null,        // null = follow the combo; 0..3 = pin a layer count
    bpm: 120,
  };
  const flags = () => FLAGS;
  // The tier actually playing. With gating off the arrangement runs at 2, which
  // is exactly the mix that shipped before any of this: kick, bass, hats, snare,
  // arp and pad. Tier 3 is additive on top of that, not the original.
  const musicTier = () => {
    if (!FLAGS.tiers) return 2;
    return FLAGS.tier === null ? autoTier : FLAGS.tier;
  };

  function setFlag(k, v) {
    FLAGS[k] = v;
    if (!ctx) return;
    if (k === 'music') musicBus.gain.value = v ? 0.5 : 0;
    if (k === 'sfx') sfxBus.gain.value = v ? 1 : 0;
    if (k === 'bpm' && musicTimer) startMusic(musicAct); // retime the sequencer
    // Rewiring the graph to bypass the limiter would risk a click, so it is
    // flattened to unity ratio instead — audibly the same as not being there.
    if (k === 'limiter' && limiter) {
      limiter.ratio.value = v ? 20 : 1;
      limiter.threshold.value = v ? -3 : 0;
    }
    if (k === 'space' || k === 'spaceGain') setSpace(musicAct);
    if (k === 'peril' && musicFx) {
      const t = ctx.currentTime, f = musicFx.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(f.value, t);
      f.exponentialRampToValueAtTime(restFreq(), t + 0.2);
    }
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      // A limiter between the master and the output. One kill alone schedules
      // voices summing well past unity, and a high combo overlaps several — the
      // graph had no protection at all, so peaks were landing wherever they fell.
      // A compressor with a high ratio and a near-zero attack is the standard
      // stand-in for a brickwall limiter in WebAudio.
      if (ctx.createDynamicsCompressor) {
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        master.connect(limiter).connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
      musicBus = ctx.createGain();
      musicBus.gain.value = FLAGS.music ? 0.5 : 0;
      // The music runs through a sweepable lowpass and a duck gain before the
      // master. Both sit idle (20kHz, unity) until duck() or drop() moves them,
      // so the untouched signal path is unchanged.
      musicFx = ctx.createBiquadFilter();
      musicFx.type = 'lowpass';
      musicFx.frequency.value = 20000;
      duckGain = ctx.createGain();
      duckGain.gain.value = 1;
      musicBus.connect(musicFx).connect(duckGain).connect(master);
      // impacts get their own bus so the debug panel can mute them independently
      sfxBus = ctx.createGain();
      sfxBus.gain.value = FLAGS.sfx ? 1 : 0;
      sfxBus.connect(master);
      // A reverb send fed from the impacts only. The music stays dry — drenching
      // the arrangement muddies it, while putting the hits in a room is what
      // tells you where the fight is happening. Level and impulse are per act.
      if (ctx.createConvolver) {
        revSend = ctx.createGain();
        revSend.gain.value = 0;
        conv = ctx.createConvolver();
        sfxBus.connect(revSend).connect(conv).connect(master);
      }
      // The outdoor path: a delay line whose feedback is lowpassed, so each
      // bounce comes back darker exactly as a real reflection loses its highs.
      // Sparse by design — you should be able to count the echoes.
      echoSend = ctx.createGain();
      echoSend.gain.value = 0;
      echoDelay = ctx.createDelay(1);
      echoDamp = ctx.createBiquadFilter();
      echoDamp.type = 'lowpass';
      echoFb = ctx.createGain();
      sfxBus.connect(echoSend).connect(echoDelay).connect(echoDamp).connect(master);
      echoDamp.connect(echoFb).connect(echoDelay); // damped feedback loop
      // Never leave the convolver without an impulse: menu and shop sounds play
      // long before any act starts one, and a buffer-less convolver is a node in
      // an undefined state sitting in the live graph.
      setSpace('street');
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A noise burst through a bandpass filter: blade whistle, glitch, hit rain.
  function noiseHit(dur, f0, f1, vol, q = 4, when = 0) {
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(voiceDest || sfxBus);
    src.start(t0);
  }

  // A tonal hit: an oscillator with a frequency glide.
  function tone(type, f0, f1, dur, vol, when = 0, bus = null) {
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(bus || voiceDest || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // What each enemy is made of. The type is already in every strike event and
  // was going only to the corpse sprite — so every kill sounded identical no
  // matter what died. ring scales the steel partials, body the low thump, and
  // crunch the width of the noise: together they read as different materials.
  // Keyed by the enemy type as it arrives in the strike event (ENEMY_TYPES keys).
  // Earlier this used display-name spellings — `shielder`, `adaptant` — that matched
  // nothing, and had no `mimic` at all, so those three silently fell back to the flat
  // default voice. The keys must equal the type ids, or the material is lost.
  const KIND_VOICE = {
    drone:   { ring: 1.55, body: 0.75, crunch: 1.30 }, // thin plating, light
    punk:    { ring: 1.00, body: 1.00, crunch: 1.00 }, // the baseline
    shield:  { ring: 0.55, body: 1.35, crunch: 0.75 }, // a heavy slab giving way
    thrower: { ring: 1.25, body: 0.85, crunch: 1.10 },
    fencer:  { ring: 1.95, body: 0.80, crunch: 1.45 }, // bright ringing steel
    adapt:   { ring: 0.80, body: 1.05, crunch: 0.90 }, // dull, synthetic
    twin:    { ring: 1.15, body: 0.95, crunch: 1.05 },
    mimic:   { ring: 1.55, body: 0.75, crunch: 1.30 }, // a hologram-drone: the drone's thin voice
  };
  const voiceOf = (kind) =>
    (FLAGS.voices && KIND_VOICE[kind]) || { ring: 1, body: 1, crunch: 1 };

  // pitch — a tonality multiplier (the combo scale comes from main.js);
  // pan  — where the sound sits, -1 left .. 1 right, or null for dead centre.
  //        The whole game is left-versus-right, so an impact that does not tell
  //        you which side it came from is throwing away the one cue the mechanic
  //        is built on. Anything not tied to a side (waves, UI, the hero's own
  //        death) stays centred.
  // j()  — light random jitter so identical hits never sound stamped
  function sfx(name, pitch, pan, kind) {
    if (!ctx) return;
    const p = pitch || 1;
    const j = () => p * (0.96 + Math.random() * 0.08);
    const v = voiceOf(kind);
    // One panner per call, feeding sfxBus; voiceDest routes this call's voices
    // into it. Cleared in the finally below so nothing leaks into the next sfx.
    if (pan != null && FLAGS.pan && ctx.createStereoPanner) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan * FLAGS.panWidth));
      pn.connect(sfxBus);
      voiceDest = pn;
    }
    try { build(); } finally { voiceDest = null; }

    function build() {
    switch (name) {
      case 'slash': // whistle + a high "edge" + a short metallic ring
        noiseHit(0.09, 5200 * v.crunch * j(), 1400 * p, 0.45, 3);
        noiseHit(0.05, 9000 * j(), 6000, 0.3, 8);
        tone('sawtooth', 3400 * v.ring * j(), 900 * p, 0.07, 0.1);
        break;
      case 'kill': // a heavy cut: thump weight, wide crunch, discordant steel ring
        tone('sine', 150 * v.body * j(), 45, 0.16, 0.5);
        noiseHit(0.14, 1800 * v.crunch * j(), 240, 0.55, 1.2);
        if (FLAGS.weight) {
          // A sub that carries under the crunch, plus a hard transient for the
          // snap. The sub goes straight to sfxBus, bypassing the panner: low
          // frequencies carry no directional cue anyway, and hard-panned bass
          // just makes the mix lopsided.
          tone('sine', 88 * v.body, 27, 0.34, 0.6, 0, sfxBus);
          noiseHit(0.012, 3200 * v.crunch, 1100, 0.5, 1);
        }
        noiseHit(0.05, 9500 * j(), 6500, 0.22, 8);
        tone('triangle', 2600 * v.ring * j(), 2500 * v.ring * p, 0.09, 0.07);
        tone('triangle', 3733 * v.ring * j(), 3600 * v.ring * p, 0.07, 0.05);
        break;
      case 'miss':    tone('sawtooth', 130 * j(), 55, 0.35, 0.42); noiseHit(0.2, 420, 90, 0.3, 2); break;
      case 'stunned': tone('square', 90, 80, 0.05, 0.1); break;
      case 'hurt':    tone('sawtooth', 220 * j(), 40, 0.3, 0.5); noiseHit(0.25, 900, 120, 0.5, 1.5); break;
      case 'reflect': // ricochet: two discordant pings and an edge
        tone('triangle', 3100 * j(), 2900 * p, 0.08, 0.22);
        tone('triangle', 2200 * j(), 2000 * p, 0.06, 0.15, 0.03);
        noiseHit(0.06, 9000, 5000, 0.25, 8);
        break;
      case 'windup': // arming: three ratchet ticks and a low draw
        noiseHit(0.04, 2200, 1800, 0.18, 6);
        noiseHit(0.04, 2800, 2300, 0.18, 6, 0.12);
        noiseHit(0.04, 3400, 2800, 0.18, 6, 0.24);
        tone('sawtooth', 70, 130, 0.4, 0.1);
        break;
      case 'stance':  noiseHit(0.12, 4200, 2200, 0.25, 8); tone('triangle', 1200, 900, 0.1, 0.15); break;
      case 'open': // a glint on the blade: a single high ping
        tone('triangle', 2793, 2700, 0.14, 0.2);
        noiseHit(0.05, 8000, 5000, 0.18, 8);
        break;
      case 'parry':   tone('square', 1900 * j(), 700, 0.16, 0.3); noiseHit(0.1, 5000, 2600, 0.35, 6); break;
      case 'block':   tone('sawtooth', 240 * j(), 120, 0.12, 0.3); noiseHit(0.06, 800, 300, 0.25, 3); break;
      case 'twintouch': // resonance: beating of two nearly identical frequencies
        tone('sine', 660 * p, 660 * p, 0.25, 0.16);
        tone('sine', 674 * p, 674 * p, 0.25, 0.16);
        break;
      case 'twinkill': // the resonance snaps: the beat slides down + a discharge
        tone('sine', 660 * p, 640 * p, 0.3, 0.22);
        tone('sine', 676 * p, 652 * p, 0.3, 0.22);
        noiseHit(0.2, 4000, 400, 0.4, 2);
        tone('triangle', 933 * p, 900 * p, 0.25, 0.08, 0.06);
        break;
      case 'throw':   noiseHit(0.1, 1800 * j(), 3600, 0.18, 5); break;
      // wind gust: a heavy falling whoosh, longer and darker than a throw
      case 'gust':
        noiseHit(0.3, 2600 * j(), 420, 0.42, 1.4);
        noiseHit(0.2, 800, 1900, 0.18, 2, 0.06);
        break;
      case 'wave': // a grim close: two taiko hits, an air riser, a dark fifth
        tone('sine', 85, 30, 0.5, 0.5);
        tone('sine', 70, 28, 0.45, 0.4, 0.16);
        noiseHit(0.5, 300, 2200, 0.12, 1);
        tone('sawtooth', 110, 110, 0.9, 0.11, 0.05, musicBus);
        tone('sawtooth', 165, 165, 0.9, 0.08, 0.05, musicBus);
        break;
      case 'choice': // an implant clicks into its socket: pneumatic hiss, downward click, body thud
        noiseHit(0.09, 4200, 1200, 0.3, 3);
        tone('square', 320, 150, 0.1, 0.18);
        tone('sine', 130, 60, 0.22, 0.35, 0.05);
        break;
      case 'dead': // shutdown: a long downward glide, crackle, a fading pulse
        tone('sawtooth', 320, 28, 1.1, 0.4);
        tone('square', 162, 22, 1.2, 0.18, 0.05);
        noiseHit(0.5, 2400, 100, 0.4, 1);
        tone('sine', 60, 40, 0.25, 0.4, 0.9);
        tone('sine', 55, 38, 0.22, 0.25, 1.35);
        break;
      case 'victory': // dawn over the arcology: taiko, riser, dark fifth, steel shimmer
        tone('sine', 90, 30, 0.6, 0.5);
        tone('sine', 75, 28, 0.55, 0.45, 0.22);
        tone('sine', 60, 25, 0.7, 0.5, 0.48);
        noiseHit(0.9, 250, 3000, 0.12, 1);
        tone('sawtooth', 110, 110, 1.6, 0.11, 0.5, musicBus);
        tone('sawtooth', 165, 165, 1.6, 0.08, 0.5, musicBus);
        tone('triangle', 1661, 1661, 1.2, 0.05, 0.6);
        tone('triangle', 2217, 2217, 1.0, 0.04, 0.75);
        break;
      case 'chain':   tone('sawtooth', 1600 * j(), 200, 0.14, 0.22); noiseHit(0.1, 6000, 2500, 0.3, 7); break;
      case 'exec':
        tone('square', 220 * j(), 40, 0.28, 0.42);
        noiseHit(0.18, 6000, 300, 0.5, 3);
        noiseHit(0.06, 11000, 8000, 0.3, 9);
        // an execute outweighs a plain kill — deeper and longer, same centred sub
        if (FLAGS.weight) {
          tone('sine', 70, 24, 0.5, 0.7, 0, sfxBus);
          noiseHit(0.014, 2600, 900, 0.6, 1);
        }
        break;
      case 'vamp': // nano-repair: a soft noise swell and a low hum
        noiseHit(0.3, 500, 2600, 0.13, 2);
        tone('sine', 90, 140, 0.3, 0.22);
        break;
      case 'buy': // module inserted: a downward click and a body thud
        noiseHit(0.06, 3600, 1400, 0.22, 4);
        tone('square', 260, 130, 0.08, 0.16);
        tone('sine', 110, 55, 0.16, 0.3, 0.04);
        break;
      case 'ui':      tone('triangle', 700, 900, 0.06, 0.15); break;
      case 'boss':    tone('sawtooth', 55, 38, 1.4, 0.42); tone('sawtooth', 82, 58, 1.4, 0.3, 0.12); noiseHit(1.0, 200, 60, 0.25, 1); break;
      case 'qtestart': // duel: the shing of a drawn blade and a low stance pulse
        noiseHit(0.2, 5000, 9000, 0.25, 3);
        tone('sine', 70, 45, 0.35, 0.4);
        tone('triangle', 2637, 2637, 0.2, 0.08, 0.12);
        break;
      case 'bossdead': // collapse: a glide, a double boom and a steel debris shower
        tone('sawtooth', 440, 30, 1.3, 0.38);
        tone('sine', 100, 26, 0.7, 0.55);
        noiseHit(0.8, 3200, 90, 0.55, 1);
        tone('sine', 70, 24, 0.5, 0.5, 0.5);
        tone('triangle', 2489, 2400, 0.5, 0.06, 0.55);
        tone('triangle', 3322, 3200, 0.4, 0.05, 0.8);
        break;
    }
    }
  }

  // Music: anxious cyberpunk — a Phrygian bass (semitone above the tonic),
  // a quiet tritone drone, a nervous arpeggiator and industrial percussion.
  // Each act has its own root note — the path darkens with progress.
  const ACT_ROOTS = { street: 41.2, market: 43.7, train: 49.0, ship: 38.9, server: 36.7, garden: 55.0 }; // E1 F1 G1 Eb1 D1 A1

  // Where each act happens, and therefore how it can possibly sound.
  //
  // Only ONE of the four is indoors. A dense exponential tail is the acoustic
  // signature of a room — outdoors there is nothing to build one, just a few
  // discrete reflections off whatever hard surface is far away. So the acts use
  // two different mechanisms rather than one with different numbers:
  //   dense — a convolver, for a real room (the server hall, and only it)
  //   slap  — a damped delay line, for distinct echoes off a facade across the
  //           street; sparse and separable, never a wash
  //
  //   street — a canyon between towers: a clear slap off the building opposite
  //            (~115ms is a road's width), darkening each bounce. Barely any dense.
  //   train  — a rooftop at 400 km/h: open air, nothing to reflect off but the
  //            hull under your feet. Essentially dry.
  //   server — hard racks in a sealed hall: the one place a long bright tail belongs.
  //   garden — arcology summit under open sky, soft planting: one distant, dull
  //            reflection off the structure and otherwise silence.
  // Levels are deliberately low. Space should be something you notice only when
  // it changes between acts — an echo you can hear as an echo is already too
  // loud, because every strike carries it and it stacks across a combo.
  const ACT_SPACE = {
    street: { decay: 0.45, tone: 1800, dense: 0.03, slap: 0.11, time: 0.115, fb: 0.22, damp: 2400 },
    // the market is the street squeezed into an alley: closer walls, harder slap
    market: { decay: 0.50, tone: 1600, dense: 0.04, slap: 0.16, time: 0.090, fb: 0.26, damp: 2200 },
    train:  { decay: 0.20, tone: 800,  dense: 0.00, slap: 0.03, time: 0.045, fb: 0.06, damp: 1400 },
    // open water: nothing to reflect at all — barer even than the maglev roof
    ship:   { decay: 0.15, tone: 700,  dense: 0.00, slap: 0.02, time: 0.050, fb: 0.05, damp: 1200 },
    server: { decay: 1.35, tone: 4200, dense: 0.13, slap: 0.04, time: 0.070, fb: 0.18, damp: 3200 },
    garden: { decay: 0.40, tone: 1100, dense: 0.03, slap: 0.05, time: 0.225, fb: 0.10, damp: 1200 },
  };

  // An exponentially decaying noise burst is the standard cheap impulse. The
  // one-pole lowpass darkens the tail as it dies, which is what stops it
  // sounding like a flat hiss; the two channels are decorrelated so the room
  // has width instead of collapsing to the centre.
  function buildIR(decay, tone) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * decay));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const a = Math.exp(-2 * Math.PI * tone / ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, 2.5); // exponential-ish fade to silence
        y = (1 - a) * (Math.random() * 2 - 1) + a * y;
        d[i] = y * env;
      }
    }
    return buf;
  }

  function setSpace(actId) {
    if (!ctx) return;
    const sp = ACT_SPACE[actId] || ACT_SPACE.street;
    const on = FLAGS.space ? FLAGS.spaceGain : 0;
    if (conv && revSend) {
      conv.buffer = buildIR(sp.decay, sp.tone);
      revSend.gain.value = sp.dense * on;
    }
    if (echoSend) {
      echoSend.gain.value = sp.slap * on;
      echoDelay.delayTime.value = sp.time;
      echoFb.gain.value = sp.fb;
      echoDamp.frequency.value = sp.damp;
    }
  }
  // intervals: 1, b2 (anxiety), b3, tritone, 5, b6 — the Phrygian palette
  const ST = { r: 1, b2: 1.0595, b3: 1.1892, p4: 1.3348, tt: 1.4142, p5: 1.5, b6: 1.5874, b7: 1.7818 };
  // The combo ladder: the Phrygian scale plus its octave. Each successive strike
  // climbs one rung, so a streak reads as an ascending run rather than a slide
  // through microtones — and every rung lands inside the key the track is in.
  const LADDER = [ST.r, ST.b2, ST.b3, ST.p4, ST.p5, ST.b6, ST.b7, 2];
  const rung = (step) => LADDER[((step % LADDER.length) + LADDER.length) % LADDER.length];
  // The form is 8 bars — four 2-bar phrases in an A A' B A'' period, so the
  // loop breathes four times longer before it repeats. A is the original cell;
  // A' keeps its head but the tail climbs; B departs upward and pedals around
  // p4/p5; A'' comes home and lets the tritone tail resolve for the turnaround.
  const BASSLINE = [
    // A — home: circling the tonic, leaning on b2 and b6
    ST.r, ST.r, ST.b2, ST.r,  ST.r, ST.b6, ST.p5, ST.b2,
    ST.r, ST.r, ST.b2, ST.r,  ST.b3, ST.b2, ST.r, ST.tt,
    // A' — the same head, but the tail climbs instead of biting
    ST.r, ST.r, ST.b2, ST.r,  ST.r, ST.b6, ST.p5, ST.b2,
    ST.r, ST.b2, ST.b3, ST.p4,  ST.p5, ST.p4, ST.b3, ST.b2,
    // B — the departure: up the ladder, pedalling before the fall
    ST.p4, ST.p4, ST.p5, ST.p4,  ST.b6, ST.p5, ST.p4, ST.b3,
    ST.p4, ST.b3, ST.b2, ST.b3,  ST.p4, ST.p5, ST.b6, ST.b7,
    // A'' — home again; the low b7 approach and the tritone resolve down
    ST.r, ST.r, ST.b2, ST.r,  ST.r, ST.b6, ST.p5, ST.b2,
    ST.b3, ST.b2, ST.r, ST.b7 * 0.5,  ST.tt, ST.b3, ST.b2, ST.r,
  ];
  const CYCLE = (BASSLINE.length / 16) * 32; // sixteenths in the full form (128)
  // One pad chord per 2-bar section: i, bVI, bII (the Phrygian signature), i.
  // Section 0 is voiced exactly as the old static pad — home base is unchanged.
  const PADS = [
    [ST.r,        ST.b3, ST.tt],
    [ST.b6 * 0.5, ST.r,  ST.b3],
    [ST.b2,       ST.p4, ST.b6],
    [ST.r,        ST.b3, ST.tt],
  ];
  // Arp figures per section — same nerves, shifting harmony under them
  const ARPS = [
    [ST.r,  ST.b3, ST.p5, ST.b2],
    [ST.r,  ST.p4, ST.b6, ST.p5],
    [ST.b2, ST.p4, ST.b6, ST.b7],
    [ST.r,  ST.b3, ST.p5, ST.b2],
  ];
  const ARPS2 = [
    [ST.p5, ST.b7,     ST.p4, ST.b6],
    [ST.p5, 2,         ST.b6, ST.p4],
    [ST.b6, ST.b2 * 2, ST.p4, ST.b7],
    [ST.p5, ST.b7,     ST.p4, ST.b6],
  ];
  // An alternative tail for A' — the climb sometimes turns into a fall. One of
  // the per-cycle dice below picks which tail this pass through the form takes.
  const TAIL_ALT = [ST.b3, ST.p4, ST.b3, ST.b2,  ST.r, ST.b7 * 0.5, ST.b2, ST.r];
  // The dice: a stateless hash of the cycle number. The same cycle always rolls
  // the same way (the scheduler may revisit a step), different cycles differ.
  const roll = (cyc, n, mod) => (((cyc * 2654435761 + n * 40503) >>> 13) % mod);

  // A melodic voice for a strike, tuned to the running track: musicRoot two
  // octaves up (E4 for E1), stepped along the ladder. This rides on top of the
  // percussive sfx rather than replacing it — the impact keeps its bite, and the
  // note is what stacks into a melody across a streak.
  // Only the melodic voice is quantised — the impact sfx always fires on the
  // frame of the press. Perceived responsiveness rides on the transient, so the
  // strike still feels instant while its note waits for the grid.
  function note(step, vol = 0.13, when = 0) {
    if (!ctx || !FLAGS.notes) return;
    const at = when + (FLAGS.quantTime ? gridDelay() : 0);
    // One press can resolve into several strikes at once (a chain, an opening) —
    // all at the same combo, so all at the same pitch. Stacking them in phase
    // just triples the amplitude and muddies the line, so only the first sings.
    // Keyed on where the note lands, not when it was asked for: once quantised,
    // several strikes legitimately collapse onto the same slot.
    const slot = ctx.currentTime + at;
    if (slot - lastNoteAt < 0.05) return;
    lastNoteAt = slot;
    const f = musicRoot * 8 * rung(step);
    const v = vol * FLAGS.noteGain;
    tone('triangle', f, f, 0.2, v, at, musicBus);
    tone('sine', f * 2, f * 2, 0.1, v * 0.35, at, musicBus); // a bright partial on top
  }

  // ---- Dynamics: the music reacting to the player, rather than a voice added
  // on top of it. The melodic experiment failed precisely because it was
  // additive; these three change what the arrangement already does.

  // Where the music's lowpass sits when nothing is sweeping it. On the last
  // armor pip the whole track clamps down — the air goes out of the room and
  // stays out until you heal. Everything that sweeps the filter ramps back to
  // this, not to a hardcoded open value, so peril survives a drop.
  const restFreq = () => (peril && FLAGS.peril ? 1300 : 20000);

  // One hit from death, or back off it. Called from the HUD, which already
  // tracks armor changes.
  function setPeril(on) {
    on = !!on;
    if (on === peril) return;
    peril = on;
    if (!ctx) return;
    const t = ctx.currentTime, f = musicFx.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    // clamping is fast and frightening; opening back up is a relief, so slower
    f.exponentialRampToValueAtTime(restFreq(), t + (on ? 0.25 : 0.8));
  }

  // A miss collapses the track. Near-silence, fast in and slow out, so the whip
  // of the failed swing lands in a hole where the music was. The impact itself
  // is untouched — only the music ducks, which is what leaves the swing exposed.
  function duckMusic(depth = 0.06, hold = 0.22, back = 0.35) {
    if (!ctx || !FLAGS.duck) return;
    const t = ctx.currentTime, g = duckGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.02); // fall almost instantly
    g.setValueAtTime(depth, t + 0.02 + hold);
    g.linearRampToValueAtTime(1, t + 0.02 + hold + back); // crawl back
  }

  // A milestone kill drops the whole track underwater and slams it back — the
  // cinematic beat where everything smears for a moment. A real time-stretch
  // would mean re-rendering the arrangement; sweeping the lowpass down and back
  // reads as the same gesture and costs one filter automation.
  function dropMusic(strength = 1) {
    if (!ctx || !FLAGS.drop) return;
    const t = ctx.currentTime;
    const f = musicFx.frequency, g = duckGain.gain;
    const dur = 0.55 * strength;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(260, t + 0.09);     // everything goes under
    f.exponentialRampToValueAtTime(400, t + dur * 0.7); // held, muffled
    f.exponentialRampToValueAtTime(restFreq(), t + dur); // slams back to wherever rest is
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.55, t + 0.09);
    g.linearRampToValueAtTime(1.15, t + dur);           // a touch louder on return
    g.linearRampToValueAtTime(1, t + dur + 0.3);
    // sub-bass swell under the sweep, and the snap on the way out
    tone('sine', 44, 30, dur, 0.5, 0, musicBus);
    noiseHit(0.5, 300, 6000, 0.1, 0.8);                 // riser into the return
    tone('sine', 90, 34, 0.35, 0.55, dur);
    noiseHit(0.25, 9000, 4000, 0.16, 5, dur);
  }

  // How much of the arrangement is playing. The caller drives this from the
  // combo, so entering the flow builds the track up and a miss strips it bare
  // on the very next beat.
  function setTier(t) { autoTier = Math.max(0, Math.min(3, t | 0)); }

  // One sixteenth, in seconds — the grid everything is measured against.
  const stepDur = () => 60 / (FLAGS.bpm * 4);

  // Lay down one sixteenth of the arrangement, `w` seconds from now. Every voice
  // takes the offset rather than playing immediately: the scheduler runs ahead of
  // the music, so `w` is where this step actually belongs on the timeline.
  function scheduleStep(sAbs, w) {
    const r = musicRoot;
    const tier = musicTier();
    const s = sAbs % CYCLE;      // position inside the 8-bar form
    const cyc = (sAbs / CYCLE) | 0; // which pass through the form
    const s32 = s % 32;          // position inside the 2-bar cell
    const sec = (s / 32) | 0;    // which phrase of the period we are in
    // this cycle's dice — small deviations, rolled once per pass:
    const altTail = roll(cyc, 1, 2) === 1;      // A' ends falling instead of climbing
    const arpLift = roll(cyc, 2, 2) === 1;      // B-section arp jumps an octave
    const hatShift = roll(cyc, 3, 2) === 1;     // the hat accent moves off-beat
    const bellTurn = roll(cyc, 4, 4) === 0;     // a rare belled echo of the turnaround
    const padHigh = roll(cyc, 5, 2) === 1;      // bII pad grows a high shimmer
    // --- tier 0: the bed. Always playing, so the track never drops to silence.
    // kick — a muffled hit on every beat
    if (s % 8 === 0) tone('sine', 120, 42, 0.14, 0.4, w, musicBus);
    // bass in eighths along the Phrygian period; A' may take its other tail
    if (s % 2 === 0) {
      const bi = (s / 2) | 0;
      const m = altTail && bi >= 24 && bi < 32 ? TAIL_ALT[bi - 24] : BASSLINE[bi];
      tone('sawtooth', r * 2 * m, r * 2 * m, 0.15, 0.15, w, musicBus);
    }
    // --- tier 1: the groove locks in. Hats in sixteenths, meaner off-beat,
    // a snare on the backbeat and the ghost kick before the second beat.
    if (tier >= 1) {
      if (s % 2 === 1) noiseHit(0.02, 9000, 7000, s % 4 === (hatShift ? 1 : 3) ? 0.05 : 0.028, 9, w);
      if (s % 16 === 8) noiseHit(0.09, 1800, 600, 0.11, 1.5, w);
      if (s32 === 22) tone('sine', 100, 45, 0.09, 0.2, w, musicBus);
      // the turnaround: a rising snare ruff over the form's last four sixteenths
      if (s >= CYCLE - 4) {
        const k = s - (CYCLE - 4);
        noiseHit(0.05, 1400 + k * 700, 800, 0.05 + k * 0.014, 2, w);
      }
      // ...and once in a while the turnaround rings: the bass tail echoed as
      // small bells an octave up, like the market's own habit caught the track
      if (bellTurn && s >= CYCLE - 8 && s % 2 === 0) {
        const bm = BASSLINE[(s / 2) | 0];
        tone('sine', r * 8 * bm, r * 8 * bm, 0.25, 0.045, w, musicBus);
      }
    }
    // --- tier 2: a nervous arpeggiator in each cell's second bar, its figure
    // shifting with the section's harmony
    if (tier >= 2 && s32 >= 16 && s % 2 === 1) {
      const lift = arpLift && sec === 2 ? 2 : 1; // B sometimes runs an octave up
      const arp = ARPS[sec][((s32 - 16) / 2 | 0) % 4] * lift;
      tone('triangle', r * 16 * arp, r * 16 * arp, 0.06, arpLift && sec === 2 ? 0.036 : 0.045, w, musicBus);
    }
    // --- tier 3: deep flow. A counter-arp an octave up, running against the
    // first one, and a shimmer of steel on the downbeat of each bar.
    if (tier >= 3) {
      if (s % 2 === 1) {
        const c = ARPS2[sec][((s % 32 - 1) / 2 | 0) % 4];
        tone('triangle', r * 32 * c, r * 32 * c, 0.05, 0.03, w, musicBus);
      }
      if (s % 16 === 0) noiseHit(0.25, 7000, 11000, 0.045, 6, w);
    }
    // the last-pip pulse: a dull heartbeat on every beat, tempo-locked so it
    // sits inside the track rather than nagging over it
    if (peril && FLAGS.peril && s % 8 === 0) {
      tone('sine', 62, 40, 0.16, 0.55, w, musicBus);
      tone('sine', 58, 36, 0.13, 0.4, w + 0.17, musicBus);
    }
    // pad: one chord per section — i, bVI, bII, i — tension that finally MOVES
    if (s32 === 0) {
      const ch = PADS[sec];
      tone('triangle', r * 8 * ch[0], r * 8 * ch[0], 2.2, 0.05, w, musicBus);
      tone('triangle', r * 8 * ch[1], r * 8 * ch[1], 2.2, 0.04, w, musicBus);
      tone('sawtooth', r * 4 * ch[2], r * 4 * ch[2], 2.2, 0.022, w, musicBus);
      // some passes let the bII chord shimmer at the top — the form's darkest
      // corner catching a little light
      if (padHigh && sec === 2) {
        tone('sine', r * 16 * ST.b6, r * 16 * ST.b6, 2.0, 0.018, w, musicBus);
      }
    }
  }

  // The music runs on a lookahead scheduler rather than a setInterval that plays
  // on the spot ("A Tale of Two Clocks"). setInterval drifts by 5–15ms a tick and
  // that drift accumulates — audible on its own, and fatal once strikes have to
  // land on the same grid. So the timer is only a pump: it wakes often, and
  // queues every step falling inside the next LOOKAHEAD against musicT0, an
  // anchor in the sample clock. The grid stays exact however badly the timer jitters.
  const LOOKAHEAD = 0.12; // seconds of music queued ahead
  const PUMP = 25;        // ms between wakeups — well under LOOKAHEAD

  // ---------- Act ambience ----------
  // The market is the only act with a life of its own behind the fight: a crowd
  // murmuring, a grill sizzling somewhere, a vendor's bell now and then. All of
  // it is synthesized from one looping noise buffer, and all of it rides the
  // music bus — so it obeys the music toggle and ducks with the score when a
  // hit lands, like everything else that is not the fight itself.
  let ambNodes = [], ambTimer = null;

  function stopAmbience() {
    for (const n of ambNodes) {
      try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already dead */ }
    }
    ambNodes = [];
    if (ambTimer) { clearInterval(ambTimer); ambTimer = null; }
  }

  function startAmbience(actId) {
    stopAmbience();
    if (!ctx || actId !== 'market') return;
    const noise = noiseBuffer(2.7);
    const mk = (type, freq, q, base) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = base;
      src.connect(f).connect(g).connect(musicBus);
      src.start();
      ambNodes.push(src, f, g);
      return g;
    };
    const lfoTo = (param, hz, depth) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      ambNodes.push(o, g);
    };
    // murmur: a crowd is band-limited noise that never sits still — two LFOs at
    // incommensurate rates beat against each other, so the swell never loops
    const murmur = mk('bandpass', 420, 0.9, 0.05);
    lfoTo(murmur.gain, 0.11, 0.02);
    lfoTo(murmur.gain, 0.047, 0.015);
    // the grill: thin hot noise with its own faster crackle-wobble
    const sizzle = mk('highpass', 5200, 0.7, 0.012);
    lfoTo(sizzle.gain, 1.7, 0.008);
    // the vendor's bell: rare, quiet, always the same two notes — a real bell
    // is a habit, not a melody
    const ding = () => {
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.02;
      for (const [f, dt, v] of [[1318.5, 0, 0.045], [1760, 0.17, 0.03]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0 + dt);
        g.gain.linearRampToValueAtTime(v, t0 + dt + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.9);
        o.connect(g).connect(musicBus);
        o.start(t0 + dt);
        o.stop(t0 + dt + 1);
      }
    };
    ambTimer = setInterval(() => { if (Math.random() < 0.4) ding(); }, 9000);
  }

  function startMusic(actId) {
    if (!ctx) return;
    stopMusic();
    startAmbience(actId);
    musicRoot = ACT_ROOTS[actId] || 41.2;
    musicAct = actId;
    setSpace(actId);
    musicStep = 0;
    musicT0 = ctx.currentTime + 0.05; // a beat of headroom before the first step
    musicTimer = setInterval(() => {
      const dur = stepDur();
      while (musicT0 + musicStep * dur < ctx.currentTime + LOOKAHEAD) {
        scheduleStep(musicStep, musicT0 + musicStep * dur - ctx.currentTime);
        musicStep++;
      }
    }, PUMP);
  }

  function stopMusic() {
    stopAmbience();
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    autoTier = 0;
    musicT0 = 0;
    peril = false;
  }

  // The grid strikes snap to, in seconds. Coarser is more audible and more
  // laggy, and the two trade off directly: a quarter at 120bpm is a 500ms grid,
  // so a note can wait half a second. A 32nd is only 62ms — under the threshold
  // where a delay reads as late, but so dense that snapping barely moves anything.
  // That trade is the whole question, hence the control.
  const gridSec = () => 240 / (FLAGS.bpm * FLAGS.grid);

  // Seconds until the next slot.
  function gridDelay() {
    if (!musicT0) return 0;
    const g = gridSec();
    const elapsed = ctx.currentTime - musicT0;
    return (g - (elapsed % g)) % g;
  }

  return { ensure, sfx, note, setTier, rung, startMusic, stopMusic, flags, setFlag,
           tier: musicTier, gridSec, duckMusic, dropMusic, setPeril, setSpace };
})();
