/* ============================================================================
   MAIN — assembly, controls, camera presets, labels, north indicator, loop
   ============================================================================ */

const hud = {
  mSeed: document.getElementById('mSeed'),
  mVox: document.getElementById('mVox'),
  mDraw: document.getElementById('mDraw'),
  mDate: document.getElementById('mDate'),
  mTri: document.getElementById('mTri'),
  fps: document.getElementById('fps'),
  btnMode: document.getElementById('btnMode'),
  btnBloom: document.getElementById('btnBloom'),
  btnAnim: document.getElementById('btnAnim'),
  btnTime: document.getElementById('btnTime'),
  btnLabels: document.getElementById('btnLabels'),
  modeTag: document.getElementById('modeTag'),
  loader: document.getElementById('loader'),
  loadMsg: document.getElementById('loadMsg'),
  labels: document.getElementById('labels'),
  needle: document.querySelector('#north .needle'),
  scaleTxt: document.getElementById('scaleTxt'),
  scaleBar: document.getElementById('scaleBar'),
};

const state = {
  orbit: true, bloomOn: true, live: true, evening: false, labels: false,
  preset: 0, frozen: false,
};

/* --------------------------------------------------------------- presets -- */
/* positions are in world voxel units: X east, Z south, Y up (see README) */
const PRESETS = [
  { name: 'Neighbourhood', pos: [228, 252, 470], tgt: [8, 0, 16] },
  { name: 'Lake',          pos: [64, 58, -18],   tgt: [-236, 0, -186] },
  { name: 'Outer Ring Rd', pos: [-24, 33, 166],  tgt: [52, 5, 24] },
  { name: 'Tech parks',    pos: [136, 126, 128], tgt: [318, 0, -132] },
  { name: 'Layouts',       pos: [104, 64, 342],  tgt: [232, 0, 206] },
];

/* Frame presets from real geometry: the ORR shot is built from the road
   centrelines, the campus shot from the OSM label position, so a geometry
   update can never leave a camera pointing at nothing. */
function dataPresets() {
  const orr = ROADS.filter((r) => r.name && r.name.indexOf('Outer Ring') >= 0 && r.cls === 1)
    .sort((a, b) => b.len - a.len)[0];
  if (orr) {
    const p = orr.pts;
    let acc = 0, total = 0, target = null, dir = null;
    for (let i = 1; i < p.length; i++) total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    for (let i = 1; i < p.length; i++) {
      const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (acc + L >= total * 0.52) {
        const t = (total * 0.52 - acc) / L;
        target = [lerp(p[i - 1][0], p[i][0], t), lerp(p[i - 1][1], p[i][1], t)];
        dir = [(p[i][0] - p[i - 1][0]) / L, (p[i][1] - p[i - 1][1]) / L];
        break;
      }
      acc += L;
    }
    if (target && dir) {
      const rx = -dir[1], rz = dir[0];
      PRESETS[2] = {
        name: 'Outer Ring Rd',
        pos: [target[0] - dir[0] * 74 + rx * 26, 34, target[1] - dir[1] * 74 + rz * 26],
        tgt: [target[0] + dir[0] * 46, 3, target[1] + dir[1] * 46],
      };
    }
  }
  const find = (sub) => {
    for (let i = 0; i < BGEO.labels.length; i++)
      if (BGEO.labels[i][2].indexOf(sub) >= 0) return [BGEO.labels[i][0], BGEO.labels[i][1]];
    return null;
  };
  const etv = find('Embassy TechVillage');
  if (etv) PRESETS[3] = {
    name: 'Tech parks',
    pos: [etv[0] - 152, 108, etv[1] + 168], tgt: [etv[0] + 24, 0, etv[1] - 34],
  };
  /* residential layouts: centroid of the low-rise stock in the southern half */
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < BGEO.buildings.length; i++) {
    const b = BGEO.buildings[i];
    if ((b[2] === 0 || b[2] === 1) && b[6] > 90 && b[5] > -120 && b[5] < 320) { sx += b[5]; sz += b[6]; n++; }
  }
  if (n > 20) {
    const ax = sx / n, az = sz / n;
    PRESETS[4] = {
      name: 'Layouts',
      pos: [ax - 74, 44, az + 96], tgt: [ax + 58, 0, az - 6],
    };
  }
}

let camTween = null;
function goPreset(i, instant) {
  const p = PRESETS[i];
  state.preset = i;
  document.querySelectorAll('.pbtn').forEach((b) => b.classList.toggle('on', +b.dataset.p === i));
  if (instant) {
    camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    controls.target.set(p.tgt[0], p.tgt[1], p.tgt[2]);
    controls.update();
    return;
  }
  camTween = {
    t: 0, dur: 1.5,
    p0: camera.position.clone(), p1: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
    t0: controls.target.clone(), t1: new THREE.Vector3(p.tgt[0], p.tgt[1], p.tgt[2]),
  };
}

/* --------------------------------------------------------------- controls - */
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.62;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
controls.minDistance = 8;
controls.maxDistance = 2200;
controls.maxPolarAngle = Math.PI * 0.494;
controls.target.copy(HOME_TARGET);
controls.update();

/* free-fly */
const keys = Object.create(null);
const fly = { yaw: 0, pitch: 0, speed: 26, active: false };
function setFly(on) {
  state.orbit = !on;
  fly.active = on;
  document.body.classList.toggle('fly', on);
  controls.enabled = !on;
  hud.btnMode.textContent = on ? 'Free-fly' : 'Orbit';
  hud.btnMode.classList.toggle('on', true);
  hud.modeTag.innerHTML = 'Camera: <b>' + (on ? 'Free-fly' : 'Orbit') + '</b>';
  hud.modeTag.classList.add('show');
  clearTimeout(setFly._t);
  setFly._t = setTimeout(() => hud.modeTag.classList.remove('show'), 1500);
  if (on) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    fly.yaw = Math.atan2(-dir.x, -dir.z);
    fly.pitch = Math.asin(clamp(dir.y, -1, 1));
  } else {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, 120);
    controls.update();
  }
}
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!fly.active) return;
  fly.drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', () => { fly.drag = null; });
window.addEventListener('mousemove', (e) => {
  if (!fly.active || !fly.drag) return;
  fly.yaw -= (e.clientX - fly.drag.x) * 0.0032;
  fly.pitch = clamp(fly.pitch - (e.clientY - fly.drag.y) * 0.0032, -1.45, 1.45);
  fly.drag = { x: e.clientX, y: e.clientY };
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'c') setFly(!fly.active);
  else if (k === 'b') toggleBloom();
  else if (k === 'r') { setFly(false); goPreset(0); }
  else if (k === 'h') document.body.classList.toggle('hideui');
  else if (k === 'f') { state.frozen = !state.frozen; hud.btnAnim.classList.toggle('on', !state.frozen); }
  else if (k === 't') toggleTime();
  else if (k === 'l') toggleLabels();
  else if (k >= '1' && k <= '5') { setFly(false); goPreset(+k - 1); }
  if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function updateFly(dt) {
  if (!fly.active) return;
  const sp = (keys['shift'] ? fly.speed * 3.2 : fly.speed) * dt;
  const fwd = new THREE.Vector3(-Math.sin(fly.yaw), 0, -Math.cos(fly.yaw));
  const right = new THREE.Vector3(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
  const dir = new THREE.Vector3();
  if (keys['w']) dir.add(fwd);
  if (keys['s']) dir.sub(fwd);
  if (keys['d']) dir.add(right);
  if (keys['a']) dir.sub(right);
  if (keys['arrowleft']) fly.yaw += dt * 1.5;
  if (keys['arrowright']) fly.yaw -= dt * 1.5;
  if (keys['arrowup']) fly.pitch = clamp(fly.pitch + dt * 1.1, -1.45, 1.45);
  if (keys['arrowdown']) fly.pitch = clamp(fly.pitch - dt * 1.1, -1.45, 1.45);
  const vert = (keys['e'] ? 1 : 0) - (keys['q'] ? 1 : 0);
  if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(sp);
  dir.y += vert * sp;
  camera.position.add(dir);
  camera.position.y = Math.max(2, camera.position.y);
  const look = new THREE.Vector3(
    -Math.sin(fly.yaw) * Math.cos(fly.pitch),
    Math.sin(fly.pitch),
    -Math.cos(fly.yaw) * Math.cos(fly.pitch));
  camera.lookAt(camera.position.clone().add(look));
}

/* ------------------------------------------------------------------ toggles */
function toggleBloom() {
  state.bloomOn = !state.bloomOn;
  hud.btnBloom.classList.toggle('on', state.bloomOn);
}
function toggleTime() {
  state.evening = !state.evening;
  TIME.target = state.evening ? 1 : 0;
  hud.btnTime.textContent = state.evening ? 'Daytime' : 'Evening';
  hud.btnTime.classList.toggle('on', state.evening);
}
function toggleLabels() {
  state.labels = !state.labels;
  hud.btnLabels.classList.toggle('on', state.labels);
  hud.labels.style.display = state.labels ? 'block' : 'none';
}
hud.btnMode.onclick = () => setFly(!fly.active);
hud.btnBloom.onclick = toggleBloom;
hud.btnAnim.onclick = () => {
  state.live = !state.live;
  hud.btnAnim.classList.toggle('on', state.live);
};
hud.btnTime.onclick = toggleTime;
hud.btnLabels.onclick = toggleLabels;
document.querySelectorAll('.pbtn').forEach((b) => {
  b.onclick = () => { setFly(false); goPreset(+b.dataset.p); };
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

/* ------------------------------------------------------------------ labels */
const labelEls = [];
function buildLabels() {
  const list = BGEO.labels.slice();
  /* prefer campuses, the lake, roads and parks; then the biggest buildings */
  const rank = { water: 0, area: 1, road: 2, building: 3 };
  list.sort((a, b) => (rank[a[3]] - rank[b[3]]) || (b[4] - a[4]));
  const keep = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    const nm = l[2];
    if (!nm || nm.length < 3) continue;
    if (seen.has(nm)) continue;
    seen.add(nm);
    keep.push(l);
  }
  /* keep it legible: the named anchor set, not every tower block */
  const final = [];
  for (let i = 0; i < keep.length; i++) {
    const l = keep[i];
    if (l[3] === 'building' && final.filter((f) => f[3] === 'building').length >= 16) continue;
    final.push(l);
    if (final.length >= 54) break;
  }
  for (let i = 0; i < final.length; i++) {
    const l = final[i];
    const el = document.createElement('div');
    el.className = 'lbl' + (l[3] === 'water' ? ' water' : l[3] === 'area' ? ' big' : '');
    el.innerHTML = '<span class="dot"></span>' + l[2] +
      (l[5] ? '<span class="kn2">' + l[5] + '</span>' : '');
    hud.labels.appendChild(el);
    labelEls.push({ el: el, x: l[0], z: l[1], y: l[3] === 'water' ? 0.5 : 1.2, kind: l[3] });
  }
  hud.labels.style.display = 'none';
}
const _v = new THREE.Vector3();
const placed = [];
function updateLabels() {
  if (!state.labels) return;
  const w = window.innerWidth, h = window.innerHeight;
  placed.length = 0;
  for (let i = 0; i < labelEls.length; i++) {
    const L = labelEls[i];
    _v.set(L.x, L.y, L.z).project(camera);
    let on = _v.z < 1 && _v.x > -1.06 && _v.x < 1.06 && _v.y > -1.06 && _v.y < 1.06;
    const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
    if (on) {
      /* simple label collision culling: the anchor set is priority-ordered */
      const bw = (L.el.textContent.length * 5.4) / 2 + 6, bh = 18;
      for (let p = 0; p < placed.length; p++) {
        const q = placed[p];
        if (Math.abs(sx - q[0]) < bw + q[2] && Math.abs(sy - q[1]) < bh + q[3]) { on = false; break; }
      }
      if (on) placed.push([sx, sy, bw, bh]);
    }
    L.el.style.display = on ? 'block' : 'none';
    if (on) {
      L.el.style.left = sx.toFixed(1) + 'px';
      L.el.style.top = sy.toFixed(1) + 'px';
    }
  }
}

/* -------------------------------------------------------- north + scale bar */
function updateCompass() {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  const ang = Math.atan2(d.x, -d.z) * 180 / Math.PI;
  hud.needle.setAttribute('transform', 'rotate(' + (-ang).toFixed(1) + ' 32 32)');
  /* scale bar: 1 voxel unit = 4 m; pick a round distance near 130 px */
  const dist = camera.position.distanceTo(controls.target);
  const mPerPx = (2 * dist * Math.tan(camera.fov * Math.PI / 360)) / window.innerHeight * 4;
  const target = 130 * mPerPx;
  const steps = [50, 100, 200, 250, 500, 750, 1000, 1500, 2000];
  let m = steps[steps.length - 1];
  for (let i = 0; i < steps.length; i++) if (steps[i] >= target) { m = steps[i]; break; }
  const px = m / mPerPx;
  hud.scaleBar.style.width = Math.round(px) + 'px';
  hud.scaleTxt.textContent = m >= 1000 ? (m / 1000) + ' km' : m + ' m';
}

/* ---- Kannada glyph guard: if the platform has no Kannada font, the label
   renders as tofu boxes, which looks broken.  Compare two different strings:
   identical rasters means no glyph coverage, so drop the Kannada line. ------- */
function kannadaOK() {
  try {
    const cv = document.createElement('canvas');
    cv.width = 120; cv.height = 32;
    const g = cv.getContext('2d');
    const draw = (txt) => {
      g.clearRect(0, 0, 120, 32);
      g.fillStyle = '#fff';
      g.font = '20px ui-sans-serif, system-ui, sans-serif';
      g.fillText(txt, 2, 24);
      return cv.toDataURL();
    };
    return draw('ಬೆಳ್ಳಂದೂರು') !== draw('ಕೆರೆ');
  } catch (e) { return false; }
}

/* ------------------------------------------------------------------- boot - */
let triCount = 0;
function boot() {
  const msgs = [
    'Projecting UTM 43N…', 'Filling Bellandur Lake…', 'Paving the Outer Ring Road…',
    'Extruding 4,222 footprints…', 'Planting the raintrees…', 'Releasing the traffic…',
  ];
  let mi = 0;
  const tick = setInterval(() => { hud.loadMsg.textContent = msgs[mi++ % msgs.length]; }, 420);

  applyGeoMeta(BGEO.meta);
  hud.mDate.textContent = '2026-11';
  if (!kannadaOK()) document.body.classList.add('nokn');

  buildTerrain();
  buildRoads();
  buildCity();
  buildGreen();
  streetLights();
  busShelters();
  streetStalls();
  billboards();
  metroWorks();
  buildTraffic();
  buildPeds();
  lakeLife();

  const litMesh = vb.build(litMat, { cast: true, receive: true });
  const glowMesh = vg.build(glowMat, { cast: false, receive: false });
  const waterMesh = vw.build(waterMat, { cast: false, receive: true });
  if (waterMesh) { scene.add(waterMesh); vw.mesh = waterMesh; }
  if (litMesh) { scene.add(litMesh); vb.mesh = litMesh; }
  if (glowMesh) { scene.add(glowMesh); vg.mesh = glowMesh; vg.mesh.visible = false; }

  dataPresets();
  setupComposer();
  buildLabels();
  goPreset(0, true);
  applyTime(0);
  updateCompass();

  const tris = (vb.n + vg.n + vw.n) * 12;
  hud.mSeed.textContent = SEED;
  hud.mVox.textContent = (vb.n + vg.n + vw.n).toLocaleString();
  hud.mTri.textContent = (tris / 1e6).toFixed(2) + 'M';
  triCount = tris;

  clearInterval(tick);
  requestAnimationFrame(() => {
    hud.loader.classList.add('done');
    setTimeout(() => { hud.loader.style.display = 'none'; }, 950);
  });

  const info = {
    mode: () => (fly.active ? 'fly' : 'orbit'),
    pos: () => camera.position.toArray().map((v) => +v.toFixed(1)),
    tgt: () => controls.target.toArray().map((v) => +v.toFixed(1)),
    stats: () => ({
      lit: vb.n, glow: vg.n, water: vw.n, calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      vehicles: traffic.veh.length, peds: peds.list.length,
      buildings: BGEO.buildings.length, roads: ROADS.length,
      ground: BGEO.ground.length, labels: labelEls.length,
      vehSpread: (() => { let a = [1e9, -1e9, 1e9, -1e9];
        for (const v of traffic.veh) { const p = v.e.pts[0]; a[0] = Math.min(a[0], p[0]); a[1] = Math.max(a[1], p[0]); a[2] = Math.min(a[2], p[1]); a[3] = Math.max(a[3], p[1]); }
        return a.map((x) => Math.round(x)); })(),
      trees: GREEN.trees, palms: GREEN.palms, tanks: buildingStats.tanks,
      glowBands: buildingStats.glow, tall: buildingStats.tall,
    }),
    setTime: (t) => { TIME.t = t; TIME.target = t; applyTime(t); state.evening = t > 0.5; },
    preset: (i) => { setFly(false); goPreset(i, true); },
    labels: (on) => { state.labels = on; toggleLabels(); toggleLabels(); },
    camera: camera, scene: scene, THREE: THREE,
    setFly: setFly, goPreset: goPreset,
  };
  window.__vb = info;
  window.__vk = info;                     /* kept for older harnesses */
  ready = true;
}
let ready = false;

/* ------------------------------------------------------------------- loop - */
let last = 0, fpsT = 0, fpsN = 0, lastReal = 0, shadowTick = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const realDt = lastReal ? Math.min(2, (now - lastReal) / 1000) : 0.016;
  lastReal = now;
  const raw = Math.min(0.1, (now - last) / 1000 || 0.016);
  last = now;
  const dt = state.frozen ? 0 : raw;

  /* time-of-day transition */
  if (Math.abs(TIME.t - TIME.target) > 0.002) {
    applyTime(TIME.t + (TIME.target - TIME.t) * clamp(raw * 3.2, 0, 1));
  } else if (TIME.t !== TIME.target) applyTime(TIME.target);

  if (camTween) {
    camTween.t += raw / camTween.dur;
    const k = clamp(camTween.t, 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(camTween.p0, camTween.p1, e);
    controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (k >= 1) camTween = null;
  }

  updateFly(raw);
  if (!fly.active) controls.update();

  /* the shadow frustum follows what we are looking at, and widens with it */
  const focus = fly.active ? camera.position : controls.target;
  const wantSpan = clamp(camera.position.distanceTo(focus) * 0.92, 150, 480);
  let spanMoved = false;
  if (Math.abs(wantSpan - sun.shadow.camera.right) > 16) {
    spanMoved = true;
    sun.shadow.camera.left = -wantSpan; sun.shadow.camera.right = wantSpan;
    sun.shadow.camera.top = wantSpan; sun.shadow.camera.bottom = -wantSpan;
    sun.shadow.camera.updateProjectionMatrix();
  }
  sun.shadow.autoUpdate = false;
  sun.target.position.set(focus.x, 0, focus.z);
  sun.position.copy(sun.target.position).addScaledVector(
    TIME.day.sunDir.clone().lerp(TIME.eve.sunDir, TIME.t), 600);
  sun.target.updateMatrixWorld();
  /* the shadow map is expensive: refresh it every few frames, not every frame */
  if (spanMoved || ++shadowTick >= 8) { sun.shadow.needsUpdate = true; shadowTick = 0; }

  if (state.live && ready) {
    updateTraffic(dt);
    updatePeds(dt);
    for (let i = 0; i < anim.length; i++) anim[i](performance.now() / 1000, dt);
  }
  waterU.uTime.value = now / 1000;
  updateLabels();
  updateCompass();

  renderer.info.reset();
  if (composer && state.bloomOn) composer.render();
  else renderer.render(scene, camera);

  hueFps(raw);
}

function hueFps(raw) {
  fpsT += realDt; fpsN++;
  if (fpsT > 0.5) {
    const f = Math.round(fpsN / fpsT);
    hud.fps.textContent = f;
    hud.mDraw.textContent = renderer.info.render.calls;
    fpsT = 0; fpsN = 0;
  }
}

boot();
requestAnimationFrame(animate);
