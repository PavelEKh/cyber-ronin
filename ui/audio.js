'use strict';
// Sound: pure WebAudio synthesis, no files. The context is created after the first
// user input (browser autoplay rules).

const Sound = (() => {
  let ctx = null, master = null, musicBus = null, sfxBus = null;
  let musicFx = null, duckGain = null; // the music's lowpass and duck stage
  let limiter = null, revSend = null, conv = null; // output limiter and dense-reverb send
  let echoSend = null, echoDelay = null, echoDamp = null, echoFb = null; // outdoor slapback
  let peril = false; // the hero is one hit from death — see setPeril
  let duel = null;     // null | 'walk' | 'qte' — the Warden on the field takes the decks
  let duelKind = 1;    // which Warden: picks his tune from BOSS_TUNES
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
    duel: true,        // the Warden guts the arrangement while he is on the field
    // --- solo-hunt mutes: one music voice each, for finding the one that
    // bothers the ear. All true = the full mix; flip one off at a time.
    mxKick: true, mxHats: true, mxSnare: true, mxBass: true, mxStab: true,
    mxArp: true, mxLead: true, mxPad: true, mxSeam: true, mxShim: true,
    music: true,       // the backing arrangement
    sfx: true,         // impacts — mute to hear the melody bare
    musicVol: 1,       // the settings screen's sliders, 0..1 scale on each bus
    sfxVol: 1,
    tier: null,        // null = follow the combo; 0..3 = pin a layer count
    bpm: 120,
  };
  const flags = () => FLAGS;
  // The tier actually playing. With gating off the arrangement floors at 2 —
  // exactly the mix that shipped before any of this: kick, bass, hats, snare,
  // arp and pad — but a deep streak still earns tier 3: the combo wiring
  // (setTier) always existed, the gate just never let its top layer through,
  // and next to the menu dirge and the Warden's set the fight sounded like
  // the oldest track in the building. The floor never drops in a lull.
  const musicTier = () => {
    if (FLAGS.tier !== null) return FLAGS.tier; // the panel's pin wins
    return FLAGS.tiers ? autoTier : Math.max(2, autoTier);
  };

  function setFlag(k, v) {
    FLAGS[k] = v;
    if (!ctx) return;
    if (k === 'music' || k === 'musicVol') musicBus.gain.value = FLAGS.music ? 0.5 * FLAGS.musicVol : 0;
    if (k === 'sfx' || k === 'sfxVol') sfxBus.gain.value = FLAGS.sfx ? FLAGS.sfxVol : 0;
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
      musicBus.gain.value = FLAGS.music ? 0.5 * FLAGS.musicVol : 0;
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
      sfxBus.gain.value = FLAGS.sfx ? FLAGS.sfxVol : 0;
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
  // `bus` reroutes it: the menu groove's drums belong to the music slider, not
  // the impact bus their combat cousins historically ride.
  function noiseHit(dur, f0, f1, vol, q = 4, when = 0, bus = null) {
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
    src.connect(filter).connect(g).connect(bus || voiceDest || sfxBus);
    src.start(t0);
  }

  // A tonal hit: an oscillator with a frequency glide.
  // atk > 0 rounds the hammer off: the gain climbs for that many seconds
  // before the decay starts. Zero (the default) keeps the old instant-attack
  // pluck — drums, stabs and impacts want the hammer; melodic voices that
  // read as "a piano poking through the mix" want the climb.
  // cut > 0 puts a lowpass at that frequency between the oscillator and the
  // gain. A NAKED sawtooth carries its whole harmonic series and buzzes like
  // a wasp whatever the volume — every synth bass that ever sat politely in
  // a mix did it behind a filter. The riff lives at cut ~700: body stays,
  // fizz goes, and the ear stops being dragged to it.
  function tone(type, f0, f1, dur, vol, when = 0, bus = null, atk = 0, cut = 0) {
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + atk + dur);
    const g = ctx.createGain();
    if (atk > 0) {
      g.gain.setValueAtTime(0.0008, t);
      g.gain.linearRampToValueAtTime(vol, t + atk);
    } else {
      g.gain.setValueAtTime(vol, t);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + atk + dur);
    let head = osc;
    if (cut > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      osc.connect(lp);
      head = lp;
    }
    head.connect(g).connect(bus || voiceDest || sfxBus);
    osc.start(t);
    osc.stop(t + atk + dur + 0.02);
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
      case 'zone': // the gate ticks: an empty side got its first crosser — main.js
        // fires this only for the entry that demands a reaction, so the tick
        // stays rare and always means something; quiet on purpose regardless
        noiseHit(0.025, 6800 * j(), 4200, 0.11, 8);
        tone('triangle', 2093 * p, 1900, 0.045, 0.06);
        break;
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
      // the stasis discharge: a glassy descending dyad — cold, not zappy
      case 'stasis':
        tone('triangle', 2093 * j(), 1046, 0.3, 0.2);
        tone('triangle', 1568 * j(), 784, 0.35, 0.12);
        noiseHit(0.16, 9000, 4000, 0.18, 8);
        break;
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
      case 'tally': // the results reel: one soft click per counted step
        tone('square', 1300 * p, 1250 * p, 0.02, 0.035);
        break;
      case 'boss': // the far blade: a sub thump, a blade drawn at distance (the
        // qtestart shing lowpassed and pushed away), and a thin ring left
        // hanging — the duel's summons, not an explosion
        tone('sine', 90, 34, 0.55, 0.5);
        noiseHit(0.5, 1800, 3600, 0.07, 4, 0.16);
        tone('triangle', 1245, 1245, 0.5, 0.03, 0.22);
        break;
      case 'pendswing': // the pendulum crosses: a whoosh that rises and falls with the arc
        noiseHit(0.45, 900, 2600, 0.10, 3);
        noiseHit(0.45, 2600, 700, 0.08, 3, 0.22);
        break;
      // the three grammars, each announced by its own short signature: the
      // blade rings thin and high, the sweep is a low airy wash, the thrust is
      // a blunt knock. Short and dark — this fires a lot.
      case 'glance': // steel skidding off the wrong answer: dull, short, no ring
        noiseHit(0.12, 2600, 700, 0.09, 2);
        tone('sine', 190, 120, 0.09, 0.10, 0, null, 0.004, 900);
        break;
      case 'stance1':
        tone('triangle', 1320, 1760, 0.10, 0.05, 0, null, 0.004);
        noiseHit(0.06, 7000, 9000, 0.03, 6);
        break;
      case 'stance2':
        noiseHit(0.22, 1200, 3200, 0.06, 2.5);
        tone('sine', 300, 460, 0.16, 0.05, 0, null, 0.01);
        break;
      case 'stance3':
        tone('sine', 150, 92, 0.16, 0.22, 0, null, 0.004);
        noiseHit(0.09, 900, 400, 0.05, 2);
        break;
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
  // Each act has its own root note — the path darkens with progress — and,
  // since ACT_TUNES below, its own bass line and arp figures on the shared
  // form; transitionMusic hands one act's set to the next on a bar line.
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
  // loop breathes four times longer before it repeats: A sections play the
  // riff, B opens into the chorus, and the turnaround chugs the pass home.
  const CYCLE = 128; // sixteenths in the full form (8 bars of 16)
  // The fallback pad chords — i, bVI, bII (the Phrygian signature), i — for
  // any tune that does not voice its own.
  const PADS = [
    [ST.r,        ST.b3, ST.tt],
    [ST.b6 * 0.5, ST.r,  ST.b3],
    [ST.b2,       ST.p4, ST.b6],
    [ST.r,        ST.b3, ST.tt],
  ];

  // ---------- Per-act tunes ----------
  // Six acts, six rhythm sections — same 8-bar A A' B A'' grammar, same
  // Phrygian palette, each a distant cousin of a track that raged on other
  // streets long ago: skeletons borrowed, every melody this game's own.
  // The fields, all on the 16th grid (0 = rest):
  //   riff      — 32 steps over the 2-bar cell: the A sections' line
  //   chorus    — same grid for the B section: where the act opens up
  //   kick      — step positions inside ONE bar where the kick lands
  //   snare     — backbeat positions (defaults to the halftime 8)
  //   stab      — cell positions where the stab chord bites
  //   stabNotes — the stab's voicing (defaults to a bare power fifth)
  //   lead/lead2 — the top line and its dice-swapped counter-phrase
  //   pads      — per-section chords (defaults to the shared PADS)
  //   swing     — odd sixteenths lean late by this fraction of a step
  const ACT_TUNES = {
    // street — the reformed streets: the four-on-the-floor set that was born
    // as the Warden's — vintage beat-em-up house — now opens the game at a run — a syncopated bass popping the octave with b7
    // leading every second bar home, claps on 2 and 4, offbeat-hat drive from
    // the tier hats, and a dark full-triad stab hook on the anticipations.
    street: {
      riff: [
        1, 0, 1, 2,  0, 1, 0, 2,  1, 0, 1, 2,  0, 1, 2, 0,
        1, 0, 1, 2,  0, 1, 0, 2,  1, 0, 1, 2,  0, 2, ST.b7, ST.b7,
      ],
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      stab: [3, 6, 19, 22],
      stabNotes: [ST.r, ST.b3, ST.p5],
      arps: [
        [ST.r, 2, ST.r, 2],
        [ST.r, 2, ST.r, 2],
        [ST.b2, ST.b2 * 2, ST.b2, ST.b2 * 2],
        [ST.r, 2, ST.r, 2],
      ],
      pads: [
        [ST.r, ST.p5, 2],
        [ST.r, ST.p5, 2],
        [ST.b2, ST.b6, ST.b2 * 2],
        [ST.r, ST.p5, 2],
      ],
    },
    // market — the bazaar runs downhill: a rolling house drive.
    // The bass ROLLS in syncopated sixteenths with octave pops (where the
    // street's set bounces, the market's runs), rave-sus stabs land on the
    // offbeats, and the old bazaar tongue (b2-b3 turning on itself) moves
    // upstairs into the lead hook. The B section tumbles: a falling Phrygian
    // cascade where the anthem climbs — a bazaar spills downhill.
    market: {
      riff: [
        1, 0, 1, 1,  2, 0, 1, 0,  1, 0, 1, 1,  2, 0, ST.b3, 0,
        1, 0, 1, 1,  2, 0, 1, 0,  ST.b6, 0, ST.b6, ST.b6,  ST.p5, 0, ST.b2, 0,
      ],
      chorus: [
        2, 0, 0, 0,  ST.b7, 0, 0, 0,  ST.b6, 0, 0, 0,  ST.p5, 0, 0, 0,
        ST.b6, 0, 0, 0,  ST.p5, 0, 0, 0,  ST.b3, 0, 0, 0,  ST.b2, 0, ST.b2, 0,
      ],
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      stab: [2, 10, 18, 26],
      stabNotes: [ST.r, ST.p4, ST.b7, 2],
      lead: [
        0, 0, 0, 0,  0, 0, 0, 0,  2, ST.b3 * 2, ST.b2 * 2, 2,  0, ST.b7, 0, 0,
        0, 0, 0, 0,  0, 0, 0, 0,  2, ST.b2 * 2, 2, ST.b7,  ST.b6, 0, ST.p5, 0,
      ],
      lead2: [
        0, 0, 0, 0,  0, 0, 0, 0,  ST.b7, 2, ST.b2 * 2, ST.b3 * 2,  0, 2, 0, 0,
        0, 0, 0, 0,  0, 0, 0, 0,  ST.p5, ST.b6, ST.b7, 2,  0, ST.b2 * 2, 0, 0,
      ],
      arps: [
        [ST.r, ST.b2, ST.b3, ST.b2],
        [ST.r, ST.b2, ST.b3, ST.b2],
        [ST.b6, ST.p5, ST.p4, ST.b3],
        [ST.r, ST.b2, ST.b3, ST.b2],
      ],
      pads: [
        [ST.r, ST.p4, ST.b7],
        [ST.r, ST.p4, ST.b7],
        [ST.b6 * 0.5, ST.b3, ST.b6],
        [ST.r, ST.p4, ST.b7],
      ],
    },
    // train — machine techno at 400 km/h. The motor never stops — near-continuous sixteenth chug with
    // mechanical stutters where a breath would be, b7 dips under the floor
    // (the old pedal's DNA), tritone alarm stabs — and the B section is the
    // overtake: an unbroken Phrygian run up the whole ladder and back down.
    train: {
      riff: [
        1, 1, 1, 0,  1, 1, ST.b2, 0,  1, 1, 1, 0,  1, 0, ST.b7 * 0.5, 0,
        1, 1, 1, 0,  1, 1, ST.b2, 0,  ST.b3, ST.b3, 0, ST.b3,  ST.b2, ST.b2, ST.b7 * 0.5, 0,
      ],
      chorus: [
        1, 0, ST.b2, 0,  ST.b3, 0, ST.p4, 0,  ST.p5, 0, ST.b6, 0,  ST.b7, 0, 2, 0,
        2, 0, ST.b7, 0,  ST.b6, 0, ST.p5, 0,  ST.p4, 0, ST.b3, 0,  ST.b2, 0, ST.b2, 0,
      ],
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      stab: [7, 23],
      stabNotes: [ST.r, ST.tt],
      lead: [
        0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 2, 0,
        0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, ST.b7, 0,
      ],
      arps: [
        [ST.r, ST.r, 2, ST.r],
        [ST.r, ST.r, 2, ST.r],
        [ST.b2, ST.b2, ST.b2 * 2, ST.b2],
        [ST.r, ST.r, 2, ST.r],
      ],
      pads: [
        [ST.r, ST.p5, 2],
        [ST.r, ST.p5, 2],
        [ST.b2, ST.b6, ST.b2 * 2],
        [ST.r, ST.p5, 2],
      ],
    },
    // ship — deck-jazz after midnight. The
    // only swung act in the game (odd sixteenths lean a third of a step
    // late) — a lazy walking bass with the old swells on the low b6, jazzy
    // 7sus4 stabs on the off, a halftime backbeat with a kick that swaggers,
    // and a B section where one long swell rolls down through the deck.
    ship: {
      swing: 0.32,
      riff: [
        1, 0, 0, ST.r,  ST.b3, 0, 0, ST.b3,  ST.p4, 0, 0, ST.p4,  ST.p5, 0, ST.b3, 0,
        ST.b6 * 0.5, 0, 0, ST.b6 * 0.5,  ST.b7 * 0.5, 0, 0, ST.b7 * 0.5,  1, 0, 0, ST.b2,  ST.b3, 0, ST.b2, 0,
      ],
      chorus: [
        ST.b6, 0, 0, 0,  ST.p5, 0, 0, 0,  ST.p4, 0, 0, 0,  ST.b3, 0, 0, 0,
        ST.p4, 0, 0, 0,  ST.b3, 0, 0, 0,  ST.b2, 0, 0, 0,  1, 0, 0, 0,
      ],
      kick: [0, 6, 10],
      snare: [8],
      stab: [5, 13, 21, 29],
      stabNotes: [ST.r, ST.p4, ST.b7],
      lead: [
        0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  ST.p5, 0, ST.p4, 0,
        0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  ST.b3, 0, ST.b2, 0,
      ],
      arps: [
        [ST.r, ST.b3, ST.p5, ST.b3],
        [ST.r, ST.b3, ST.p5, ST.b3],
        [ST.b6, ST.p4, ST.b6, ST.p5],
        [ST.r, ST.b3, ST.p5, ST.b3],
      ],
      pads: [
        [ST.r, ST.b3, ST.b7],
        [ST.r, ST.b3, ST.b7],
        [ST.b6 * 0.5, ST.r, ST.b3],
        [ST.r, ST.b3, ST.b7],
      ],
    },
    // server — cold power in the racks: the hardest techno in the building.
    // Stuttering staccato cells — two
    // hits and a hole — circling b2 with the tritone glinting where a melody
    // would warm up, a gallop kick with a sixteenth push before the bar, the
    // harshest stab cluster in the game (r+b2+tt), and a B section of cells
    // that climb the rack and never resolve until the loop forces them home.
    server: {
      riff: [
        1, 1, 0, 0,  ST.b2, ST.b2, 0, 0,  1, 1, 0, 0,  ST.tt, 0, ST.tt, 0,
        1, 1, 0, 0,  ST.b2, ST.b2, 0, 0,  ST.tt, ST.tt, 0, ST.p4,  0, ST.b2, 0, 0,
      ],
      chorus: [
        ST.p4, 0, ST.tt, 0,  ST.p4, 0, ST.tt, 0,  ST.p5, 0, ST.p4, 0,  ST.tt, 0, ST.b3, 0,
        ST.b6, 0, ST.p5, 0,  ST.p4, 0, ST.tt, 0,  ST.b3, 0, ST.b2, 0,  ST.b2, ST.b2, 0, 0,
      ],
      kick: [0, 4, 8, 12, 14],
      snare: [4, 12],
      stab: [6, 22],
      stabNotes: [ST.r, ST.b2, ST.tt],
      lead: [
        0, 0, 0, ST.tt * 2,  0, 0, 0, 0,  0, 0, 0, 2,  0, 0, 0, 0,
        0, 0, 0, ST.b2 * 2,  0, 0, 0, 0,  0, 0, 0, ST.tt * 2,  0, 0, 0, 0,
      ],
      arps: [
        [ST.b2, ST.r, ST.b2, ST.tt],
        [ST.b2, ST.r, ST.b2, ST.tt],
        [ST.p4, ST.tt, ST.b2, ST.b3],
        [ST.b2, ST.r, ST.b2, ST.tt],
      ],
      pads: [
        [ST.r, ST.tt, 2],
        [ST.r, ST.tt, 2],
        [ST.b2, ST.tt, ST.b2 * 2],
        [ST.r, ST.tt, 2],
      ],
    },
    // garden — the last round expands: wide-screen finale drive.
    // Wide reaching phrases through p5-b7 (the summit's old DNA) over a full
    // driving floor — the only act whose verse already sings — and a chorus
    // that climbs to the octave, holds the peak for a whole bar, and steps
    // down only to p5: the summit keeps the height it reached.
    garden: {
      riff: [
        1, 0, 0, 1,  0, 0, ST.p5, 0,  ST.b6, 0, 0, ST.p5,  0, 0, ST.p4, 0,
        1, 0, 0, 1,  0, 0, ST.p5, 0,  ST.b7, 0, 0, ST.b6,  0, ST.p5, 0, 0,
      ],
      chorus: [
        ST.p5, 0, 0, 0,  ST.b6, 0, 0, 0,  ST.b7, 0, 0, 0,  2, 0, 0, 0,
        2, 0, 0, 0,  ST.b7, 0, 0, 0,  ST.b6, 0, 0, 0,  ST.p5, 0, ST.p4, 0,
      ],
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      stab: [0, 16],
      stabNotes: [ST.r, ST.p5],
      lead: [
        0, 0, 0, 0,  0, 0, 0, 0,  2, 0, ST.b7, 0,  0, ST.b6, 0, 0,
        0, 0, 0, 0,  0, 0, 0, 0,  2, 0, ST.b2 * 2, 0,  0, 2, 0, 0,
      ],
      arps: [
        [ST.r, ST.p5, ST.b7, ST.p5],
        [ST.r, ST.p5, ST.b7, ST.p5],
        [ST.p4, ST.b6, ST.b7, ST.b6],
        [ST.r, ST.p5, ST.b7, ST.p5],
      ],
      pads: [
        [ST.r, ST.p5, 2],
        [ST.r, ST.p5, 2],
        [ST.b6 * 0.5, ST.b3, ST.b6],
        [ST.r, ST.p5, 2],
      ],
    },
  };
  // ---------- The menu groove ----------
  // The menu no longer plays the fight's postcard cut: it runs its own set.
  // Two cuts of this were too cheerful — off-beat open hats, claps on the
  // backbeat and an octave-bouncing bass are a party whatever key they are in.
  // The third cut lost even the steady kick. What survived is a dirge with a
  // clave: one deep kick a bar with a knock answering on beat three and an
  // odd-bar stumble, a sub drone, a bass brooding on the root with Phrygian
  // b2 bites, and a rare rootless stab as the last, distant echo of the
  // early-90s Sega club sound this started from. Original material
  // throughout: the nod is in the bass's 3-3-2 feet, never in a quoted melody.
  // Eight bars of harmony: i i | i i | bVI bII | i i. The first cut of this
  // lifted through bVII with a ninth on top and read as a party; the game is
  // not one. The departure now sinks into the Neapolitan bII — the combat
  // track's own Phrygian signature — so the menu grooves in the same shadow
  // the fight lives in.
  const MFORM = ['i', 'i', 'i', 'i', 'b6', 'b2', 'i', 'i'];
  const MROOT = { i: 1, b6: ST.b6, b2: ST.b2 };
  // stab voicings per chord, every note diatonic to the key; rootless — the
  // bass owns the root, the stab owns the color. No maj7 sheen, no ninths:
  // plain dark triads beside the home i7.
  const MSTAB = {
    i:  [ST.b3, ST.p5, ST.b7],        // i7 without its root
    b6: [ST.b6, 2, ST.b3 * 2],        // bVI triad, first-inversion low
    b2: [ST.b6, ST.b2 * 2, ST.p4 * 2], // bII triad off its fifth — the bite
  };
  // one bar of bass as multipliers on the bar's chord root, 0 = rest.
  // The feet keep the 3-3-2 clave, the pitch stays DOWN: circling the root
  // with the b2 sneer, low dips, and a tense fifth where an octave used to
  // bounce — no lift anywhere now. Home bars alternate A/B; departure bars
  // take C, whose intervals (root, fifth and its low half) stay diatonic
  // over bVI and bII alike — b2/b7 colors there would slide out of the key.
  const MBASS_A = [1, 0, 0, 1, 0, 0, ST.b2, 0, 1, 0, 0, ST.b7 * 0.5, 0, 0, 1, 0];
  const MBASS_B = [1, 0, 0, ST.p5, 0, 0, ST.b2, 0, 1, 0, 1, 0, ST.b7 * 0.5, 0, ST.b2, 0];
  const MBASS_C = [1, 0, 0, 1, 0, 0, ST.p5 * 0.5, 0, 1, 0, 0, ST.p5 * 0.5, 0, 0, 1, 0];
  // the turnaround: a Phrygian run falling home — a descent, not a fanfare
  const MLEAD = [2, ST.b7, ST.b6, ST.p5, ST.p4, ST.b3, ST.b2, ST.r];
  // The Wardens' tunes — one per kind, all in whatever key and tempo the act
  // is bleeding, all borrowed skeletons with native melodies (see BOSS_NAMES
  // in main.js for who is who).
  // 1 RONIN BETA — the duel hymn itself, stop-start steel: a beta copy of
  //   the player deserves the player's anthem.
  const BOSS_TUNES = {};
  BOSS_TUNES[1] = {
    riff: [
      ST.r, ST.r, 0, ST.r,  0, ST.r, ST.r, 0,  ST.b2, 0, 0, ST.r,  0, 0, ST.b3, ST.b2,
      ST.r, ST.r, 0, ST.r,  0, ST.r, ST.r, 0,  ST.p4, 0, ST.b3, 0,  ST.b2, ST.b2, 0, 0,
    ],
    chorus: [
      ST.r, 0, 0, 0,  ST.b6, 0, 0, 0,  ST.b7, 0, 0, 0,  2, 0, 0, 0,
      2, 0, 0, 0,  ST.b7, 0, 0, 0,  ST.b6, 0, 0, 0,  ST.p5, 0, ST.b2, 0,
    ],
    kick: [0, 6, 10, 14],
    stab: [0, 16],
    arps: [
      [ST.r, ST.p5, ST.b7, 2],
      [ST.r, ST.p4, ST.p5, ST.b7],
      [ST.r, ST.b6, ST.b7, 2],
      [ST.r, ST.p5, ST.b7, 2],
    ],
    // open fifths, no thirds: i5 under the verse, bVI5 under the chorus climb
    pads: [
      [ST.r, ST.p5, 2],
      [ST.r, ST.p5, 2],
      [ST.b6 * 0.5, ST.b3, ST.b6],
      [ST.r, ST.p5, 2],
    ],
    // the top line: short answers thrown from inside the riff's own gaps
    lead: [
      0, 0, 0, 0,  0, 0, 0, 0,  0, 2, ST.b7, 0,  ST.b6, ST.p5, 0, 0,
      0, 0, 0, 0,  0, 0, 0, 0,  0, ST.b7, 0, 0,  0, 0, ST.b6, ST.p5,
    ],
    // the same gaps, the other mood: the cycle dice swap answer for question
    lead2: [
      0, 0, 0, 0,  0, 0, 0, 0,  0, ST.p5, ST.b7, 0,  2, ST.b7, 0, 0,
      0, 0, 0, 0,  0, 0, 0, 0,  0, 2, 0, 0,  0, 0, ST.b7, 2,
    ],
  };
  // 2 MAGLEV WARDEN — no one returns from this roof: a creeping menace of a
  //   riff, tritone alarms, and a lead that HOWLS — every note a falling cry
  //   (the howl flag glides each lead note down a fourth, wind through steel).
  BOSS_TUNES[2] = {
    riff: [
      1, 0, 0, 1,  0, 1, 0, 0,  ST.b2, 0, 1, 0,  0, ST.b7 * 0.5, 0, 0,
      1, 0, 0, 1,  0, 1, 0, 0,  ST.b3, 0, ST.b2, 0,  1, 0, 0, 0,
    ],
    chorus: [
      1, 0, ST.b3, 0,  ST.p4, 0, ST.p5, 0,  ST.b6, 0, ST.b7, 0,  2, 0, ST.b7, 0,
      ST.b6, 0, ST.p5, 0,  ST.p4, 0, ST.b3, 0,  ST.b2, 0, 1, 0,  ST.b2, 0, 0, 0,
    ],
    kick: [0, 10],
    snare: [8],
    stab: [4, 20],
    stabNotes: [ST.r, ST.tt],
    howl: true,
    lead: [
      0, 0, 0, 0,  0, 0, 2, 0,  0, 0, 0, 0,  0, 0, ST.b7, 0,
      0, 0, 0, 0,  0, 0, ST.b6, 0,  0, 0, 0, 0,  0, 0, ST.p5, 0,
    ],
    arps: [
      [ST.r, ST.b2, ST.tt, ST.b2],
      [ST.r, ST.b2, ST.tt, ST.b2],
      [ST.p4, ST.tt, ST.b6, ST.tt],
      [ST.r, ST.b2, ST.tt, ST.b2],
    ],
    pads: [
      [ST.r, ST.b6, 2],
      [ST.r, ST.b6, 2],
      [ST.b2, ST.b6, ST.b2 * 2],
      [ST.r, ST.b6, 2],
    ],
  };
  // 3 ADMIN ONI — the glitch made music: a stuttering broken-cell riff, the
  //   tritone shadowing every honest step (his links lie, his tune lies too),
  //   a kick that lands where it should not.
  BOSS_TUNES[3] = {
    riff: [
      1, 1, 0, 1,  0, 0, 1, 1,  0, ST.b2, ST.b2, 0,  ST.tt, 0, 0, ST.b2,
      1, 1, 0, 1,  0, 0, 1, 1,  ST.tt, ST.tt, 0, ST.b3,  0, ST.b2, ST.b2, 0,
    ],
    chorus: [
      1, 0, ST.b2, 0,  ST.b3, 0, ST.tt, 0,  ST.p4, 0, ST.tt, 0,  ST.p5, 0, ST.tt, 0,
      ST.b6, 0, ST.tt, 0,  ST.p5, 0, ST.p4, 0,  ST.tt, 0, ST.b3, 0,  ST.b2, ST.b2, 0, 0,
    ],
    kick: [0, 3, 8, 11],
    snare: [4, 12],
    stab: [5, 21],
    stabNotes: [ST.r, ST.b2, ST.tt],
    lead: [
      0, 0, 0, 0,  0, 0, 0, ST.tt * 2,  0, 0, 0, 0,  0, 0, 0, ST.b2 * 2,
      0, 0, 0, 0,  0, 0, 0, 2,  0, 0, 0, 0,  0, 0, 0, ST.tt * 2,
    ],
    arps: [
      [ST.b2, ST.tt, ST.b2, ST.r],
      [ST.b2, ST.tt, ST.b2, ST.r],
      [ST.tt, ST.p4, ST.tt, ST.b3],
      [ST.b2, ST.tt, ST.b2, ST.r],
    ],
    pads: [
      [ST.r, ST.tt, 2],
      [ST.r, ST.tt, 2],
      [ST.b2, ST.tt, ST.b2 * 2],
      [ST.r, ST.tt, 2],
    ],
  };
  // 4 CORE SHOGUN — the throne: a doom march an octave under everyone else,
  //   massive open-chord stabs, and a chorus that climbs the whole ladder and
  //   ENDS holding the octave — the final Warden owns the peak.
  BOSS_TUNES[4] = {
    riff: [
      1, 0, 0, 0,  0, 0, ST.b2, 0,  1, 0, 0, 0,  ST.b7 * 0.5, 0, 0, 0,
      1, 0, 0, 0,  0, 0, ST.b2, 0,  ST.b6 * 0.5, 0, 0, 0,  ST.b7 * 0.5, 0, 0, 0,
    ],
    chorus: [
      1, 0, 0, 0,  ST.b2, 0, 0, 0,  ST.p4, 0, 0, 0,  ST.p5, 0, 0, 0,
      ST.b6, 0, 0, 0,  ST.b7, 0, 0, 0,  2, 0, 0, 0,  2, 0, 0, 0,
    ],
    kick: [0, 8],
    snare: [8],
    stab: [0, 16],
    stabNotes: [ST.r, ST.p5, 2],
    lead: [
      0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  ST.b6, 0, 0, 0,
      0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  ST.b7, 0, 0, 0,
    ],
    arps: [
      [ST.r, ST.p5, ST.r, ST.p5],
      [ST.r, ST.p5, ST.r, ST.p5],
      [ST.b6, ST.b7, ST.b6, ST.b7],
      [ST.r, ST.p5, ST.r, ST.p5],
    ],
    pads: [
      [ST.r, ST.p5, 2],
      [ST.r, ST.p5, 2],
      [ST.b6 * 0.5, ST.b3, ST.b6],
      [ST.r, ST.p5, 2],
    ],
  };
  // 5 THE ARMORER — steel that rings: a tight staccato riff, clanging sixth
  //   stabs, and high blade-ping leads — the only Warden whose top voice
  //   sits two octaves up, thin as an edge.
  BOSS_TUNES[5] = {
    riff: [
      1, 0, 1, 0,  ST.b2, 0, 1, 0,  1, 0, ST.b6, 0,  ST.p5, 0, ST.b2, 0,
      1, 0, 1, 0,  ST.b2, 0, 1, 0,  ST.b7, 0, ST.b6, 0,  ST.p5, 0, ST.p4, 0,
    ],
    chorus: [
      ST.p5, 0, ST.b6, 0,  ST.p5, 0, ST.p4, 0,  ST.p5, 0, ST.b6, 0,  ST.b7, 0, 2, 0,
      2, 0, ST.b7, 0,  ST.b6, 0, ST.p5, 0,  ST.b3, 0, ST.b2, 0,  1, 0, 0, 0,
    ],
    kick: [0, 6, 8, 14],
    snare: [4, 12],
    stab: [2, 18],
    stabNotes: [ST.r, ST.b6],
    lead: [
      0, 0, 0, 0,  2, 0, 0, 0,  0, 0, 0, 0,  ST.b7 * 2, 0, 0, 0,
      0, 0, 0, 0,  ST.b6 * 2, 0, 0, 0,  0, 0, 0, 0,  2, 0, 0, 0,
    ],
    arps: [
      [ST.r, ST.b6, ST.p5, ST.b6],
      [ST.r, ST.b6, ST.p5, ST.b6],
      [ST.p4, ST.b6, ST.b7, ST.b6],
      [ST.r, ST.b6, ST.p5, ST.b6],
    ],
    pads: [
      [ST.r, ST.b6, 2],
      [ST.r, ST.b6, 2],
      [ST.b2, ST.b6, ST.b2 * 2],
      [ST.r, ST.b6, 2],
    ],
  };
  // 6 THE DOUBLE — a daydream groove worn as a mask: smooth, almost warm,
  //   rolling like a softened market set — until the chorus resolves into a
  //   tritone and the hologram flickers. His lead is the anthem's QUESTION
  //   phrase (lead2): he asks in your own voice.
  BOSS_TUNES[6] = {
    riff: [
      1, 0, 1, 0,  1, 0, ST.b3, 0,  1, 0, 1, 0,  ST.p4, 0, ST.b3, 0,
      1, 0, 1, 0,  1, 0, ST.b3, 0,  ST.b6, 0, ST.p5, 0,  ST.p4, 0, ST.b2, 0,
    ],
    chorus: [
      ST.b3, 0, 0, 0,  ST.p4, 0, 0, 0,  ST.p5, 0, 0, 0,  ST.b6, 0, 0, 0,
      ST.p5, 0, 0, 0,  ST.p4, 0, 0, 0,  ST.b2, 0, 0, 0,  ST.b2, 0, ST.tt, 0,
    ],
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    stab: [6, 22],
    stabNotes: [ST.r, ST.b3, ST.p5],
    lead: [
      0, 0, 0, 0,  0, 0, 0, 0,  0, ST.p5, ST.b7, 0,  2, ST.b7, 0, 0,
      0, 0, 0, 0,  0, 0, 0, 0,  0, 2, 0, 0,  0, 0, ST.b7, 2,
    ],
    arps: [
      [ST.r, ST.b3, ST.p5, ST.b3],
      [ST.r, ST.b3, ST.p5, ST.b3],
      [ST.b2, ST.p4, ST.b6, ST.p4],
      [ST.r, ST.b3, ST.p5, ST.b3],
    ],
    pads: [
      [ST.r, ST.b3, ST.b7],
      [ST.r, ST.b3, ST.b7],
      [ST.b2, ST.b6, ST.b2 * 2],
      [ST.r, ST.b3, ST.b7],
    ],
  };
  // menu pads: the i7 bed, and the low brooding bVI under the departure
  const MPADS = [
    [ST.r, ST.b3, ST.b7],
    [ST.r, ST.b3, ST.b7],
    [ST.b6 * 0.5, ST.r, ST.b3],
    [ST.r, ST.b3, ST.b7],
  ];

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

  // The Warden's presence, fed every frame from the loop: 'walk' while he
  // approaches, 'qte' during the chain, null otherwise. The scheduler reads it
  // on the next step, so the arrangement guts itself on the grid — no restart,
  // no ramp, the theme simply holds its breath.
  function setDuel(v, kind) { duel = v; if (kind) duelKind = kind; }

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
    // A queued act handover lands here, on a bar line only: same step, same
    // instant on the clock, new key, new tune, new pulse. The grid re-anchors
    // so the tempo change costs no dropped beat, and the lowpass — sent down
    // when the handover was queued — comes back up on the far side.
    if (pendingAct && sAbs % 16 === 0) {
      const oldDur = stepDur();
      musicAct = pendingAct;
      pendingAct = null;
      musicRoot = ACT_ROOTS[musicAct] || 41.2;
      FLAGS.bpm = ACT_BPM[musicAct] || 120;
      musicT0 += sAbs * (oldDur - stepDur());
      setSpace(musicAct);
      startAmbience(musicAct);
      const f = musicFx.frequency, tw = ctx.currentTime + Math.max(0, w);
      f.cancelScheduledValues(tw);
      f.setValueAtTime(420, tw);
      f.exponentialRampToValueAtTime(restFreq(), tw + 1.2);
    }
    const r = musicRoot;
    const menu = musicAct === 'menu';
    // While the Warden is on the field HIS tune takes the decks — the anthem,
    // in the act's own key and tempo. The walk plays the full band; the duel
    // chain (qte) thins it — no lead, no stabs, no pads, no upper tiers, just
    // kick and riff: focus over fanfare. The act's set returns with the kill.
    const gut = !menu && duel && FLAGS.duel ? duel : null;
    const tune = gut ? BOSS_TUNES[duelKind] || BOSS_TUNES[1] : ACT_TUNES[musicAct] || ACT_TUNES.street;
    const tier = musicTier();
    const s = sAbs % CYCLE;      // position inside the 8-bar form
    const cyc = (sAbs / CYCLE) | 0; // which pass through the form
    const s32 = s % 32;          // position inside the 2-bar cell
    const sec = (s / 32) | 0;    // which phrase of the period we are in
    // an act may swing: every odd sixteenth leans late by a fraction of the
    // step — the deck rolls under the whole band at once, nothing to align
    if (!menu && tune.swing && s % 2 === 1) w += stepDur() * tune.swing;
    // this cycle's dice — small deviations, rolled once per pass:
    const arpLift = roll(cyc, 2, 2) === 1;      // B-section arp jumps an octave
    const hatShift = roll(cyc, 3, 2) === 1;     // the hat accent moves off-beat
    const padHigh = roll(cyc, 5, 2) === 1;      // bII pad grows a high shimmer
    const arpSet = tune.arps; // every act voices its own figures now
    // The menu runs its own club set (see the constants above): the whole
    // groove ignores the combat tiers, and everything it plays rides musicBus,
    // so one slider owns all of it. In combat roughly one pass in four
    // BREATHES: the groove strips to the bed and the form inhales — the
    // single cheapest cure for an arrangement on repeat.
    const breathe = !menu && roll(cyc, 6, 4) === 0;
    const menuSing = roll(cyc, 10, 4) === 0; // one pass in four the turnaround sings
    // --- tier 0: the bed. Always playing, so the track never drops to silence.
    // kick — the act's own pattern (a breathing pass keeps only the first bar
    // of the cell), with a click of attack on top of the thump: the riff
    // wants a kick with knuckles, not just weight
    if (!menu && FLAGS.mxKick && tune.kick.includes(s % 16) && (!breathe || s32 < 16)) {
      tone('sine', 125, 43, 0.13, 0.4, w, musicBus);
      noiseHit(0.03, 2600, 1400, 0.07, 2, w, musicBus);
    }
    // the menu swaps everything below for its own groove
    if (menu) {
      const bar = (s / 16) | 0;         // which bar of the eight
      const chord = MFORM[bar];
      const cr = MROOT[chord];          // this bar's chord root
      const st16 = s % 16;
      // no four-on-the-floor anymore — that was the last thing still dancing.
      // A dirge pulse instead: one deep kick on the downbeat, the knock
      // answering on beat three, and on odd bars a soft stumble before the
      // next bar line — a limp, not a stride
      if (st16 === 0) tone('sine', 95, 38, 0.14, 0.32, w, musicBus);
      if (st16 === 8) noiseHit(0.06, 900, 500, 0.05, 2, w, musicBus);
      if (st16 === 14 && bar % 2 === 1) tone('sine', 90, 36, 0.1, 0.16, w, musicBus);
      // a barely-there dark tick keeps the sixteenth grid from dying
      if (st16 % 4 === 2) noiseHit(0.02, 6000, 5000, 0.009, 8, w, musicBus);
      // the sub drone: a low root held under each section — the warehouse hum
      if (s32 === 0) tone('sine', r * 2, r * 2, 3.5, 0.05, w, musicBus);
      // the bass broods on the clave; home bars alternate, departures dig in
      const bp = (chord === 'i' ? (bar % 2 ? MBASS_B : MBASS_A) : MBASS_C)[st16];
      if (bp) tone('sawtooth', r * 2 * cr * bp, r * 2 * cr * bp, 0.13, 0.12, w, musicBus);
      // one smeared rootless stab every OTHER bar, late off-beat — barely a memory
      if (st16 === 10 && bar % 2 === 1) {
        for (const [i, iv] of MSTAB[chord].entries())
          tone('sawtooth', r * 4 * iv, r * 4 * iv, 0.2, 0.024 - i * 0.003, w, musicBus);
      }
      // the turnaround falls home, one pass in four — a habit, not a chorus
      if (menuSing && s >= CYCLE - 16 && s % 2 === 0) {
        const ml = MLEAD[(s - (CYCLE - 16)) / 2];
        tone('triangle', r * 16 * ml, r * 16 * ml, 0.15, 0.038, w, musicBus, 0.015);
      }
    } else if (tune.riff) {
      // the rhythm section acts: the riff chugs in sixteenths through the A
      // sections, the B section opens into the chorus — long anthem notes.
      // A breathing pass keeps only the sub: the riff inhales too.
      const chorus = sec === 2 && tune.chorus;
      const m = (chorus || tune.riff)[s32];
      if (m && FLAGS.mxBass) {
        if (!breathe) tone('sawtooth', r * 2 * m, r * 2 * m, chorus ? 0.30 : 0.09, chorus ? 0.13 : 0.15, w, musicBus, chorus ? 0.02 : 0.01, chorus ? 950 : 700);
        tone('sine', r * m, r * m, chorus ? 0.30 : 0.10, breathe ? 0.10 : 0.14, w, musicBus);
        // the chorus sings twice: the anthem doubled an octave up, quiet —
        // the shine on the climb without a new voice to mix around
        if (chorus && !breathe && gut !== 'qte' && FLAGS.mxLead) tone('triangle', r * 8 * m, r * 8 * m, 0.28, 0.040, w, musicBus, 0.02);
      }
      // the top line answers from the gaps the chug leaves open (A sections
      // only — in the chorus the anthem IS the lead); the cycle dice swap
      // the falling answer for lead2's rising question, and the form's last
      // section carries a thin doubling an octave higher — the final verse
      // stands taller than the first
      const leadSet = roll(cyc, 11, 2) === 1 && tune.lead2 ? tune.lead2 : tune.lead;
      if (!chorus && !breathe && gut !== 'qte' && FLAGS.mxLead && leadSet && leadSet[s32]) {
        const lm = leadSet[s32];
        // the howl flag turns each lead note into a falling cry: it starts a
        // fourth above itself and slides home — wind through maglev steel
        const h0 = tune.howl ? lm * ST.p4 : lm;
        tone('triangle', r * 8 * h0, r * 8 * lm, tune.howl ? 0.30 : 0.17, 0.046, w, musicBus, 0.015);
        tone('sawtooth', r * 8 * h0, r * 8 * lm, tune.howl ? 0.24 : 0.13, 0.014, w, musicBus, 0.015);
        if (sec === 3) tone('triangle', r * 16 * lm, r * 16 * lm, 0.15, 0.025, w, musicBus, 0.015);
      }
      // four sixteenths of climb into the chorus — the anthem announces
      // itself — and the mirror: four falling out of it into the last verse
      if (tune.chorus && !breathe && FLAGS.mxSeam && s >= 60 && s < 64) {
        const rn = [ST.p4, ST.p5, ST.b6, ST.b7][s - 60];
        tone('sawtooth', r * 2 * rn, r * 2 * rn, 0.08, 0.14, w, musicBus, 0.008, 700);
      }
      if (tune.chorus && !breathe && FLAGS.mxSeam && s >= 92 && s < 96) {
        const fn = [2, ST.b7, ST.b6, ST.p5][s - 92];
        tone('sawtooth', r * 2 * fn, r * 2 * fn, 0.08, 0.125, w, musicBus, 0.008, 700);
      }
      // the form's own turnaround: a chugged Phrygian climb through the last
      // four sixteenths, landing on the root of the next pass
      if (!breathe && FLAGS.mxSeam && s >= CYCLE - 4) {
        const tn = [ST.r, ST.b2, ST.b3, ST.p4][s - (CYCLE - 4)];
        tone('sawtooth', r * 2 * tn, r * 2 * tn, 0.07, 0.14, w, musicBus, 0.008, 700);
        tone('sine', r * tn, r * tn, 0.08, 0.12, w, musicBus);
      }
    }
    // the stab on the riff heads — a power fifth unless the act voiced its
    // own bite (the street's set stabs a full dark triad)
    if (!menu && gut !== 'qte' && !breathe && FLAGS.mxStab && tune.stab && tune.stab.includes(s32) && sec !== 2) {
      for (const [i, iv] of (tune.stabNotes || [ST.r, ST.p5]).entries())
        tone('sawtooth', r * 4 * iv, r * 4 * iv, 0.14, 0.06 - i * 0.008, w, musicBus, 0.008, 2400);
    }
    // --- tier 1: the groove locks in. Hats in sixteenths, meaner off-beat,
    // and the backbeat where the act put it — the street claps on 2 and 4,
    // the ship swaggers on the halftime 8.
    if (tier >= 1 && !menu && !breathe && gut !== 'qte') {
      if (s % 2 === 1 && FLAGS.mxHats) noiseHit(0.02, 9000, 7000, s % 4 === (hatShift ? 1 : 3) ? 0.05 : 0.028, 9, w);
      if (FLAGS.mxSnare && (tune.snare || [8]).includes(s % 16)) noiseHit(0.09, 1800, 600, 0.11, 1.5, w);
      // the turnaround: a rising snare ruff over the form's last four sixteenths
      if (FLAGS.mxSnare && s >= CYCLE - 4) {
        const k = s - (CYCLE - 4);
        noiseHit(0.05, 1400 + k * 700, 800, 0.05 + k * 0.014, 2, w);
      }
    }
    // --- tier 2: a nervous arpeggiator in each cell's second bar, its figure
    // shifting with the section's harmony
    if (tier >= 2 && !menu && !breathe && gut !== 'qte' && FLAGS.mxArp && s32 >= 16 && s % 2 === 1) {
      const lift = arpLift && sec === 2 ? 2 : 1; // B sometimes runs an octave up
      const arp = arpSet[sec][((s32 - 16) / 2 | 0) % 4] * lift;
      tone('triangle', r * 16 * arp, r * 16 * arp, 0.07, arpLift && sec === 2 ? 0.032 : 0.040, w, musicBus, 0.012);
    }
    // --- tier 3: deep flow — a shimmer of steel on the downbeat of each bar.
    // (The old counter-arp died with the walking bass: over a riff it was an
    // argument, not a layer.)
    if (tier >= 3 && !menu && !breathe && gut !== 'qte' && FLAGS.mxShim && s % 16 === 0) {
      noiseHit(0.25, 7000, 11000, 0.045, 6, w);
    }
    // the last-pip pulse: a dull heartbeat on every beat, tempo-locked so it
    // sits inside the track rather than nagging over it
    if (peril && FLAGS.peril && s % 8 === 0) {
      tone('sine', 62, 40, 0.16, 0.55, w, musicBus);
      tone('sine', 58, 36, 0.13, 0.4, w + 0.17, musicBus);
    }
    // pad: one chord per section — tension that finally MOVES. The fight keeps
    // its Phrygian i, bVI, bII, i; the menu holds the groove's own harmony,
    // and sits back — the drums are the body now.
    // pads follow the tune on the decks; only the duel chain goes without.
    // THE SWELL IS THE POINT: a 2.2-second chord struck with an instant
    // attack was a grand piano landing on every cell — the "piano poking
    // through everywhere" the solo-hunt finally caught. Now it breathes in
    // over half a second at half the old weight: background by construction.
    // The ear should notice the air changing, never the chord arriving.
    if (s32 === 0 && gut !== 'qte' && FLAGS.mxPad) {
      const ch = menu ? MPADS[sec] : (tune.pads ? tune.pads[sec] : PADS[sec]);
      const pg = 1; // with the hats gone the pad carries the menu's air again
      tone('triangle', r * 8 * ch[0], r * 8 * ch[0], 1.8, 0.030 * pg, w, musicBus, 0.55);
      tone('triangle', r * 8 * ch[1], r * 8 * ch[1], 1.8, 0.024 * pg, w, musicBus, 0.60);
      tone('sawtooth', r * 4 * ch[2], r * 4 * ch[2], 1.8, 0.013 * pg, w, musicBus, 0.65, 1200);
      // some passes let the bII chord shimmer at the top — the form's darkest
      // corner catching a little light
      if (padHigh && sec === 2) {
        tone('sine', r * 16 * ST.b6, r * 16 * ST.b6, 1.6, 0.012, w, musicBus, 0.6);
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
    // the grill: thin hot noise with a crackle-wobble. Same incommensurate-LFO
    // trick as the murmur — a single 1.7 Hz tremolo made the hiss pulse with a
    // metronome's regularity, and a REGULAR "shh… shh" reads as a broom
    // sweeping, not fat on steel. Two beating rates never repeat a pattern.
    const sizzle = mk('highpass', 5200, 0.7, 0.010);
    lfoTo(sizzle.gain, 2.9, 0.0045);
    lfoTo(sizzle.gain, 0.53, 0.0035);
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

  // Each location keeps its own pulse — one number of variety that costs
  // nothing and stops six acts from blurring into one endless track. The menu
  // sits at a club idle: slower than any fight, fast enough to be a groove.
  // The debug BPM slider still overrides between acts; an act change simply
  // re-tunes it.
  // ship and garden used to sit at 112/106 — fine while every act shared one
  // busy bassline, but under their own sparser tunes the double slowdown read
  // as the game losing its pulse (feedback, 2026-07-31). They stay the two
  // slowest acts, just no longer by a gap the groove falls into.
  const ACT_BPM = { street: 122, market: 132, train: 127, ship: 118, server: 134, garden: 116, menu: 96 };

  // ---------- Act handover ----------
  // Acts used to hard-restart the track: silence, then a new count-in. Now a
  // running set takes the next act like a DJ takes a record: the handover is
  // queued, the lowpass dips the track underwater right away, and on the next
  // bar line scheduleStep swaps key, tune, tempo, room and ambience in one
  // move and lets the filter back up. Nothing playing (a fresh run, a death
  // screen behind us) — it simply starts clean.
  let pendingAct = null;

  function transitionMusic(actId) {
    if (!ctx || !musicTimer) { startMusic(actId); return; }
    if (actId === musicAct || actId === pendingAct) return;
    pendingAct = actId;
    // under we go — the seam itself arrives with the bar line
    const t = ctx.currentTime, f = musicFx.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(200, f.value), t);
    f.exponentialRampToValueAtTime(420, t + 0.5);
  }

  function startMusic(actId) {
    if (!ctx) return;
    stopMusic();
    pendingAct = null; // a hard start owns the decks outright
    startAmbience(actId);
    musicRoot = ACT_ROOTS[actId] || 41.2;
    musicAct = actId;
    setSpace(actId);
    FLAGS.bpm = ACT_BPM[actId] || 120;
    // a fresh set opens clean: whatever the pause or a drop left on the
    // filter and the duck stage must not leak into the next track
    const t0r = ctx.currentTime;
    musicFx.frequency.cancelScheduledValues(t0r);
    musicFx.frequency.setValueAtTime(restFreq(), t0r);
    duckGain.gain.cancelScheduledValues(t0r);
    duckGain.gain.setValueAtTime(1, t0r);
    musicStep = 0;
    musicT0 = ctx.currentTime + 0.05; // a beat of headroom before the first step
    musicTimer = setInterval(() => {
      // stepDur() re-read every pass, not cached per tick: an act handover
      // inside scheduleStep changes the tempo and re-anchors musicT0 mid-loop
      while (musicT0 + musicStep * stepDur() < ctx.currentTime + LOOKAHEAD) {
        scheduleStep(musicStep, musicT0 + musicStep * stepDur() - ctx.currentTime);
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
    duel = null;
    pendingAct = null; // a queued handover dies with the set it was queued on
  }

  // Which set is on the decks — main.js uses this to start the menu music
  // exactly once instead of restarting it on every visit to a menu screen.
  const playingAct = () => (musicTimer ? musicAct : null);

  // The menu postcard changed location: the ambient set follows — new root,
  // new room, the market's own murmur when the market slides by. The chords
  // simply take the new key on their next bar: a slow modulation, no restart.
  function setMenuAct(actId) {
    if (!ctx || musicAct !== 'menu' || !musicTimer) return;
    musicRoot = ACT_ROOTS[actId] || 41.2;
    setSpace(actId);
    startAmbience(actId);
  }

  // The pause screen holds the track underwater — still moving, no longer
  // demanding — and lets it back up on resume. The peril clamp survives:
  // the release ramps to restFreq(), not to a hardcoded open value.
  function pauseMusic(on) {
    if (!ctx || !musicTimer) return;
    const t = ctx.currentTime, f = musicFx.frequency, g = duckGain.gain;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(40, f.value), t);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (on) {
      f.exponentialRampToValueAtTime(300, t + 0.3);
      g.linearRampToValueAtTime(0.35, t + 0.3);
    } else {
      f.exponentialRampToValueAtTime(restFreq(), t + 0.6);
      g.linearRampToValueAtTime(1, t + 0.6);
    }
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

  // The whole context asleep or awake — a platform's "the window lost focus"
  // (Yandex requires silence on blur). Distinct from pauseMusic: nothing is
  // rescheduled, the timeline simply stops ticking and resumes where it was.
  function suspend(on) {
    if (!ctx) return;
    try { (on ? ctx.suspend() : ctx.resume()).catch(() => {}); } catch (e) { /* closed context */ }
  }

  return { ensure, sfx, note, setTier, rung, startMusic, stopMusic, transitionMusic, playingAct, setMenuAct, pauseMusic,
           flags, setFlag, tier: musicTier, gridSec, duckMusic, dropMusic, setPeril, setDuel, setSpace, suspend };
})();
