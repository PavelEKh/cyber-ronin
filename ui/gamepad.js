'use strict';
// Gamepad input and the haptics channel. Polling with edge detection (the
// Gamepad API has no button events), plus one impact() entry point that main.js
// feeds every landed blow into — it fans out to pad rumble and phone vibration.
const Pad = (() => {
  // Standard-mapping indices → logical actions. Both hands can strike from
  // anywhere: d-pad, bumpers, triggers and the west/east face buttons all map
  // to sides, so the player picks a grip instead of learning ours.
  const BTN = {
    0: 'confirm',            // A / cross
    1: 'right', 2: 'left',   // B east / X west — physically on their sides
    3: 'alt',                // Y / triangle — reroll, replay speed
    4: 'left', 5: 'right',   // bumpers
    6: 'left', 7: 'right',   // triggers
    8: 'start', 9: 'start',  // select / start — both mean "pause"
    12: 'up', 13: 'down',    // d-pad vertical — menu navigation
    14: 'left', 15: 'right', // d-pad
  };
  // stick axes: each is its own trigger with hysteresis (see poll)
  const AXES = [
    { ax: 0, neg: 'left', pos: 'right' }, { ax: 1, neg: 'up', pos: 'down' },
    { ax: 2, neg: 'left', pos: 'right' }, { ax: 3, neg: 'up', pos: 'down' },
  ];
  const prevBtn = {};  // pad index → last frame's pressed[] for edge detection
  const stickArm = {}; // pad index → per-axis armed flags
  let haptics = true;  // the debug panel's A/B switch for all vibration
  // Haptics fire only while their input channel is warm: a pad idle on the
  // desk must not buzz at a keyboard player, and a desktop must not try to
  // vibrate. Any pad press / touch strike opens its window for a while.
  const WARM_MS = 15000;
  let padUntil = 0, touchUntil = 0;

  const pads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);

  // One call per frame; returns this frame's fresh presses as logical actions.
  function poll() {
    const out = [];
    for (const gp of pads()) {
      if (!gp || !gp.connected) continue;
      const prev = prevBtn[gp.index] || [];
      const cur = [];
      gp.buttons.forEach((b, i) => {
        const on = b.pressed || b.value > 0.5; // triggers report analog values
        cur[i] = on;
        if (on && !prev[i] && BTN[i]) out.push(BTN[i]);
      });
      prevBtn[gp.index] = cur;
      // Sticks: a flick past the threshold is one press; it re-arms only after
      // returning near centre, so holding a direction is not autofire.
      const arm = stickArm[gp.index] || (stickArm[gp.index] = AXES.map(() => true));
      AXES.forEach((m, k) => {
        const x = gp.axes[m.ax] || 0;
        if (arm[k] && Math.abs(x) > 0.55) { out.push(x < 0 ? m.neg : m.pos); arm[k] = false; }
        else if (!arm[k] && Math.abs(x) < 0.3) arm[k] = true;
      });
    }
    if (out.length) padUntil = performance.now() + WARM_MS;
    return out;
  }

  // main.js calls this on touch strikes — opens the phone-vibration window.
  function noteTouch() { touchUntil = performance.now() + WARM_MS; }

  // A landed blow. power 0..1 picks the weight, ms the length. The strong
  // motor carries the thud, the weak one adds the metallic snap on top.
  function impact(power, ms) {
    if (!haptics) return;
    const now = performance.now();
    if (now < padUntil) {
      for (const gp of pads()) {
        const act = gp && gp.connected && gp.vibrationActuator;
        if (act && act.playEffect) {
          act.playEffect('dual-rumble', {
            duration: ms,
            strongMagnitude: Math.min(1, power),
            weakMagnitude: Math.min(1, power * 0.6 + 0.3),
          }).catch(() => {});
        }
      }
    }
    // Phone motors are binary and loud — keep pulses short or the hand goes numb.
    if (now < touchUntil && navigator.vibrate) navigator.vibrate(Math.round(Math.min(ms * power, 80)));
  }

  function setHaptics(v) { haptics = !!v; }
  const getHaptics = () => haptics;

  // Debug: one full-weight thud on every channel, warm or not — answers
  // "does this pad rumble at all" without having to land a hit first.
  function test() {
    padUntil = touchUntil = performance.now() + 1000;
    impact(1, 300);
  }

  return { poll, impact, noteTouch, setHaptics, getHaptics, test };
})();
