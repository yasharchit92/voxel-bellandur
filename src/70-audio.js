/* ============================================================================
   SOUND — synthesised, no files
   ----------------------------------------------------------------------------
   A browser diorama that makes noise is a different thing from one that does
   not.  Everything here is generated with WebAudio: brown-noise city rumble,
   a wind layer, horns on a Poisson process, lake lapping when you are near the
   water, and birds at dawn.  Nothing is fetched.
   ============================================================================ */

const AUDIO = { ctx: null, master: null, hum: null, wind: null, lap: null, on: false, user: 0, lastHorn: 0, nextHorn: 2 };

function _noise(ctx, seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w * 0.6;
  }
  return buf;
}

function audioStart() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!AUDIO.ctx) {
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const hum = ctx.createBufferSource();
    hum.buffer = _noise(ctx, 4, true); hum.loop = true;
    const humLP = ctx.createBiquadFilter(); humLP.type = 'lowpass'; humLP.frequency.value = 320; humLP.Q.value = 0.6;
    const humG = ctx.createGain(); humG.gain.value = 0.55;
    hum.connect(humLP).connect(humG).connect(master); hum.start();

    const wind = ctx.createBufferSource();
    wind.buffer = _noise(ctx, 4, false); wind.loop = true;
    const windBP = ctx.createBiquadFilter(); windBP.type = 'bandpass'; windBP.frequency.value = 1100; windBP.Q.value = 0.7;
    const windG = ctx.createGain(); windG.gain.value = 0.10;
    wind.connect(windBP).connect(windG).connect(master); wind.start();

    const lap = ctx.createBufferSource();
    lap.buffer = _noise(ctx, 3, true); lap.loop = true;
    const lapBP = ctx.createBiquadFilter(); lapBP.type = 'bandpass'; lapBP.frequency.value = 620; lapBP.Q.value = 1.4;
    const lapG = ctx.createGain(); lapG.gain.value = 0.0;
    lap.connect(lapBP).connect(lapG).connect(master); lap.start();

    AUDIO.ctx = ctx; AUDIO.master = master; AUDIO.hum = humG; AUDIO.wind = windG; AUDIO.lap = lapG;
    AUDIO.humLP = humLP;
  }
  if (AUDIO.ctx.state !== 'running') AUDIO.ctx.resume();
  AUDIO.on = true;
  const t = AUDIO.ctx.currentTime;
  AUDIO.master.gain.cancelScheduledValues(t);
  AUDIO.master.gain.value = 0.30;
  return true;
}

function audioStop() {
  AUDIO.on = false;
  if (!AUDIO.ctx) return;
  const t = AUDIO.ctx.currentTime;
  AUDIO.master.gain.cancelScheduledValues(t);
  AUDIO.master.gain.value = 0.0001;
}

function _horn(ctx, when, freq, dur, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
  o.type = 'square'; o.frequency.setValueAtTime(freq, when);
  o.frequency.setValueAtTime(freq * 1.06, when + dur * 0.4);
  bp.type = 'bandpass'; bp.frequency.value = freq * 1.6; bp.Q.value = 1.2;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(bp).connect(g).connect(AUDIO.master);
  o.start(when); o.stop(when + dur + 0.05);
}

function _chirp(ctx, when, freq) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, when);
  o.frequency.exponentialRampToValueAtTime(freq * 1.7, when + 0.05);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.03, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
  o.connect(g).connect(AUDIO.master);
  o.start(when); o.stop(when + 0.14);
}

/* called from the render loop: mix by where you are and when it is */
function audioTick(dt) {
  if (!AUDIO.on || !AUDIO.ctx) return;
  const ctx = AUDIO.ctx;
  const camY = camera.position.y;
  const near = clamp(1 - camY / 260, 0.15, 1);
  const lakeD = Math.hypot(camera.position.x + 190, camera.position.z + 162);
  const lakeNear = clamp(1 - lakeD / 260, 0, 1);
  const busy = clamp(traffic.veh.length / 900, 0, 1);
  AUDIO.hum.gain.setTargetAtTime(0.30 + 0.55 * near * busy, ctx.currentTime, 0.8);
  AUDIO.humLP.frequency.setTargetAtTime(240 + 380 * near, ctx.currentTime, 0.8);
  AUDIO.wind.gain.setTargetAtTime(0.05 + 0.13 * clamp(camY / 400, 0, 1), ctx.currentTime, 1.2);
  AUDIO.lap.gain.setTargetAtTime(0.16 * lakeNear * (0.6 + 0.4 * Math.sin(performance.now() / 2400)), ctx.currentTime, 0.5);
  /* horns: a Poisson process, denser low down near the big roads */
  AUDIO.nextHorn -= dt;
  if (AUDIO.nextHorn <= 0) {
    AUDIO.nextHorn = rr(1.1, 4.2) / (0.4 + near);
    const f = rr(300, 520);
    _horn(ctx, ctx.currentTime + 0.02, f, rr(0.10, 0.30), 0.05 + 0.05 * near);
  }
  /* birds around dawn */
  if (TIME.h > 5.2 && TIME.h < 7.6 && Math.random() < dt * 1.6) {
    _chirp(ctx, ctx.currentTime + 0.02, rr(1600, 2600));
  }
}

function audioState() {
  return {
    on: AUDIO.on,
    state: AUDIO.ctx ? AUDIO.ctx.state : 'none',
    gain: AUDIO.master ? +AUDIO.master.gain.value.toFixed(4) : 0,
  };
}
