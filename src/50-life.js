/* ============================================================================
   LIFE — traffic on the lane graph, street furniture, pedestrians, the works
   ----------------------------------------------------------------------------
   Traffic drives the OSM graph: every vehicle sits in a lane of a real
   carriageway, keeps LEFT, obeys one-way tagging, and picks a plausible next
   edge at each node (no U-turns, prefers to carry on).  Mix and density follow
   the road class, as on the ground: BMTC buses and autos on the ORR, scooters
   in the layouts.
   ============================================================================ */

/* ---------------------------------------------------- dynamic instancing -- */
class DynPool {
  constructor(cap, material, cast) {
    this.cap = cap; this.i = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.InstancedMesh(geo, material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = cast !== false;
    m.receiveShadow = false;
    m.count = cap;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < cap; k++) m.setMatrixAt(k, zero);
    this.mesh = m;
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    scene.add(m);
  }
  set(i, x, y, z, sx, sy, sz, rot, col) {
    if (i >= this.cap) return;
    this._v.set(sx, sy, sz);
    const m = this._m;
    if (rot) { m.makeRotationY(rot); m.scale(this._v); } else m.makeScale(sx, sy, sz);
    m.setPosition(x, y, z);
    this.mesh.setMatrixAt(i, m);
    if (col) { this._c.setRGB(col[0], col[1], col[2]); this.mesh.setColorAt(i, this._c); }
  }
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------- vehicle set */
const VT = {
  car:   { len: 1.06, wid: 0.46, hb: 0.30, ht: 0.25, pal: P.car },
  taxi:  { len: 1.06, wid: 0.46, hb: 0.30, ht: 0.25, pal: P.taxi },
  auto:  { len: 0.82, wid: 0.44, hb: 0.36, ht: 0.28, pal: P.auto, canopy: P.autoCanopy },
  bus:   { len: 2.70, wid: 0.64, hb: 0.66, ht: 0.28, pal: P.bus, stripe: P.busBlue },
  van:   { len: 1.50, wid: 0.54, hb: 0.44, ht: 0.26, pal: P.truck },
  bike:  { len: 0.50, wid: 0.22, hb: 0.26, ht: 0.10, pal: P.car },
};
const PED_SHIRT = [C(0xd9d5c8), C(0xc2453a), C(0x2f5f9c), C(0xe0b93f), C(0x4a7f5a), C(0x8c5a9c), C(0xe8e2d4)];
const PED_SKIN = [C(0x8a5f3f), C(0x9a6b48), C(0x7a5236)];

const traffic = { veh: [], lit: null, glow: null, dyn: false, t: 0, signals: [], byNode: {} };

/* a signalised junction is any node where two classified roads meet */
function buildSignals() {
  const out = [];
  const inAt = laneGraph.atIn, outAt = laneGraph.atNode;
  for (const key in inAt) {
    const inn = inAt[key] || [], out_ = outAt[key] || [];
    const total = inn.length + out_.length;
    if (total < 3) continue;
    let big = 0, bigIn = 0;
    for (let i = 0; i < inn.length; i++) if (inn[i].cls <= 2) { big++; bigIn++; }
    for (let i = 0; i < out_.length; i++) if (out_[i].cls <= 2) big++;
    if (big < 2 || bigIn < 1) continue;
    const e = inn[0];
    const p = e.pts[e.pts.length - 1];
    out.push({ node: +key, x: p[0], z: p[1], phase: rnd(), deg: total });
  }
  out.sort((a, b) => b.deg - a.deg);
  traffic.signals = out.slice(0, 56);
  traffic.byNode = {};
  for (let i = 0; i < traffic.signals.length; i++) traffic.byNode[traffic.signals[i].node] = traffic.signals[i];
  return traffic.signals.length;
}
function signalOpen(t, axis, sgn) {
  const cyc = ((t / 44 + sgn.phase) % 1 + 1) % 1;
  if (axis === 0) return cyc < 0.42;
  return cyc >= 0.50 && cyc < 0.92;
}
const peds = { list: [], body: null, head: null };

function pickVehicle(cls) {
  const r = rnd();
  if (cls <= 1) {
    if (r < 0.24) return 'bus';
    if (r < 0.42) return 'auto';
    if (r < 0.50) return 'taxi';
    if (r < 0.58) return 'van';
    if (r < 0.80) return 'car';
    return 'bike';
  }
  if (cls === 2) {
    if (r < 0.12) return 'bus';
    if (r < 0.34) return 'auto';
    if (r < 0.42) return 'taxi';
    if (r < 0.52) return 'van';
    if (r < 0.82) return 'car';
    return 'bike';
  }
  if (cls <= 4) {
    if (r < 0.06) return 'bus';
    if (r < 0.30) return 'auto';
    if (r < 0.40) return 'taxi';
    if (r < 0.52) return 'van';
    if (r < 0.76) return 'car';
    return 'bike';
  }
  if (r < 0.10) return 'auto';
  if (r < 0.20) return 'van';
  if (r < 0.46) return 'car';
  return 'bike';
}

function buildTraffic() {
  const edges = laneGraph.edges;
  const cand = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.len < 5) continue;
    const w = e.cls === 1 ? 64 : e.cls === 2 ? 26 : e.cls === 3 ? 8 : e.cls === 4 ? 3 : e.cls === 5 ? 1.0 : 0.3;
    const slots = Math.max(1, Math.floor(e.len / 8));
    for (let s = 0; s < slots; s++) cand.push([e, w]);
  }
  /* weighted sample, deterministic */
  const N = Math.min(900, cand.length);
  const picked = [];
  for (let i = 0; i < N; i++) {
    let tot = 0;
    for (let k = 0; k < cand.length; k++) tot += cand[k][1];
    let r = rnd() * tot, j = 0;
    for (; j < cand.length; j++) { r -= cand[j][1]; if (r <= 0) break; }
    picked.push(cand[Math.min(j, cand.length - 1)][0]);
  }
  for (let i = 0; i < picked.length; i++) {
    const e = picked[i];
    const type = pickVehicle(e.cls);
    const V = VT[type];
    const nL = clamp(e.lanes, 1, 3);
    traffic.veh.push({
      e: e, s: rr(1, Math.max(2, e.len - 1)),
      lane: (rnd() * nL) | 0, nL: nL,
      type: type, vmax: e.vmax * rr(0.72, 1.05),
      col: jitC(asCol(V.pal), 0.05),
      boost: rr(0.9, 1.1),
    });
  }
  traffic.lit = new DynPool(traffic.veh.length * 3, litMat, true);
  traffic.glow = new DynPool(traffic.veh.length * 2, glowMat, false);
  for (let i = 0; i < traffic.veh.length; i++) {
    const v = traffic.veh[i];
    const V = VT[v.type];
    traffic.lit.set(i * 3 + 0, 0, -50, 0, V.len, V.hb, V.wid, 0, v.col);
    traffic.lit.set(i * 3 + 1, 0, -50, 0, V.len * 0.6, V.ht, V.wid * 0.9, 0,
      v.type === 'auto' ? asCol(P.autoCanopy) : asCol(P.glassCar));
    traffic.lit.set(i * 3 + 2, 0, -50, 0, V.len * 0.9, 0.05, V.wid * 1.02, 0,
      v.type === 'bus' ? asCol(P.busBlue) : asCol(P.glassCar));
    traffic.glow.set(i * 2 + 0, 0, -50, 0, 0.001, 0.001, 0.001, 0, asCol(P.glowWarm));
    traffic.glow.set(i * 2 + 1, 0, -50, 0, 0.001, 0.001, 0.001, 0, asCol(P.glowRed));
  }
  traffic.lit.commit(); traffic.glow.commit();
  traffic.dyn = true;
}

/* advance one vehicle along its edge; returns [x,z,rot] */
function laneAt(v, s, out) {
  const pts = v.e.pts;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    if (s <= acc + L || i === pts.length - 1) {
      const t = clamp((s - acc) / L, 0, 1);
      const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      /* lane offset: divided carriageways distribute about the centreline,
         two-way roads keep to the LEFT of the direction of travel */
      let ox, oz;
      if (v.e.road.oneway) {
        const off = (v.lane - (v.nL - 1) / 2) * R_LANE_W;
        ox = -dz * off; oz = dx * off;
      } else {
        const off = (v.lane + 0.5) * R_LANE_W;
        ox = dz * off; oz = -dx * off;
      }
      out[0] = x + ox; out[1] = z + oz;
      out[2] = Math.atan2(dz, dx);
      return out;
    }
    acc += L;
  }
  out[0] = pts[0][0]; out[1] = pts[0][1]; out[2] = 0;
  return out;
}

const _lane = [0, 0, 0];
function updateTraffic(dt) {
  if (!traffic.dyn) return;
  traffic.t += dt;
  const veh = traffic.veh;
  const byEdge = traffic._byEdge || (traffic._byEdge = new Map());
  byEdge.clear();
  for (let i = 0; i < veh.length; i++) {
    const v = veh[i];
    let a = byEdge.get(v.e);
    if (!a) { a = []; byEdge.set(v.e, a); }
    a.push(v);
  }
  /* who is in front of whom, on the same edge */
  byEdge.forEach((a) => {
    a.sort((p, q) => p.s - q.s);
    for (let i = 0; i < a.length; i++) a[i].leadGap = i + 1 < a.length ? a[i + 1].s - a[i].s : 1e9;
  });

  for (let i = 0; i < veh.length; i++) {
    const v = veh[i];
    const V = VT[v.type];
    /* --- target speed: free flow, limited by the car ahead and by signals --- */
    let want = v.vmax;
    const gap = Math.max(0.4, (v.leadGap === undefined ? 1e9 : v.leadGap) - V.len * 1.35);
    want = Math.min(want, gap * 2.2);
    const sig = traffic.byNode[v.e.b];
    if (sig) {
      const dx = Math.cos(v.ang || 0), dz = Math.sin(v.ang || 0);
      const axis = Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
      const toStop = v.e.len - v.s;
      if (!signalOpen(traffic.t, axis, sig)) {
        if (toStop < 3.0) want = 0;
        else if (toStop < 16) want = Math.min(want, (toStop - 3.0) * 1.1);
      }
    }
    if (v.spd === undefined) v.spd = v.vmax * rnd();
    const acc = want < v.spd ? 9.0 : 3.2;          /* brake harder than you accelerate */
    v.spd += clamp(want - v.spd, -acc * dt, acc * dt);
    v.spd = Math.max(0, v.spd);
    v.s += v.spd * dt;

    if (v.s > v.e.len) {
      const node = v.e.b;
      const list = laneGraph.atNode[node];
      let best = null, bestScore = -1e9;
      if (list) {
        const endDir = endDir2(v.e.pts);
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c === v.e) continue;
          if (c.b === v.e.a) continue;                     /* no U-turn */
          const d2 = startDir2(c.pts);
          const dot = endDir[0] * d2[0] + endDir[1] * d2[1];
          if (dot < -0.3) continue;
          const score = dot * 2 + rnd() * 2.4 + (c.cls <= 2 ? 1.2 : 0);
          if (score > bestScore) { bestScore = score; best = c; }
        }
      }
      v.s = Math.max(0, v.s - v.e.len);
      v.e = best || v.e;
      v.leadGap = 1e9;
      v.nL = clamp(v.e.lanes, 1, 3);
      if (v.lane >= v.nL) v.lane = v.nL - 1;
    }
    laneAt(v, v.s, _lane);
    const rot = -_lane[2];
    const y = GROUND_H[2] || 0;
    /* autorickshaws weave a little; nothing else does */
    let wx = _lane[0], wz = _lane[1];
    if (v.type === 'auto') {
      const wob = Math.sin(traffic.t * 1.7 + i * 1.3) * 0.42;
      wx += -Math.sin(_lane[2]) * wob;
      wz += Math.cos(_lane[2]) * wob;
    }
    v.wx = wx; v.wz = wz; v.rot = rot; v.ang = _lane[2]; v.speed = v.spd;
    traffic.lit.set(i * 3 + 0, wx, y + V.hb / 2, wz, V.len, V.hb, V.wid, rot, v.col);
    traffic.lit.set(i * 3 + 1, wx - Math.cos(_lane[2]) * V.len * 0.08, y + V.hb + V.ht / 2,
      wz - Math.sin(_lane[2]) * V.len * 0.08, V.len * 0.58, V.ht, V.wid * 0.9, rot,
      v.type === 'auto' ? asCol(P.autoCanopy) : asCol(P.glassCar));
    traffic.lit.set(i * 3 + 2, wx, y + V.hb * 0.52, wz, V.len * 0.88, 0.045, V.wid * 1.02, rot,
      v.type === 'bus' ? asCol(P.busBlue) : asCol(P.glassCar));
    const fx = Math.cos(_lane[2]) * V.len * 0.48, fz = Math.sin(_lane[2]) * V.len * 0.48;
    traffic.glow.set(i * 2 + 0, wx + fx, y + V.hb * 0.5, wz + fz,
      V.wid * 1.0, 0.16, 0.22, rot, asCol(P.glowWarm));
    traffic.glow.set(i * 2 + 1, wx - fx, y + V.hb * 0.75, wz - fz,
      V.wid * 0.95, 0.13, 0.18, rot, asCol(P.glowRed));
  }
  traffic.lit.commit();
  traffic.glow.commit();
}
function endDir2(pts) {
  const n = pts.length;
  const a = pts[Math.max(0, n - 2)], b = pts[n - 1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}
function startDir2(pts) {
  const a = pts[0], b = pts[Math.min(1, pts.length - 1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

/* ------------------------------------------------------------ pedestrians */
function buildPeds() {
  const cand = [];
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 5 || r.len < 6 || r.tunnel) continue;
    const w = r.cls <= 2 ? 3 : r.cls <= 4 ? 2 : 1;
    cand.push([r, w]);
  }
  let tot = 0;
  for (let k = 0; k < cand.length; k++) tot += cand[k][1];
  const N = 300;
  peds.list = [];
  for (let i = 0; i < N; i++) {
    let r = rnd() * tot, j = 0;
    for (; j < cand.length; j++) { r -= cand[j][1]; if (r <= 0) break; }
    const road = cand[Math.min(j, cand.length - 1)][0];
    const sgn = chance(0.5) ? 1 : -1;
    const halfW = (road.cls === 1 ? 11 : road.cls === 2 ? 10 : road.cls === 3 ? 9 : road.cls === 4 ? 8 : 6) / 2 / 4;
    peds.list.push({
      road: road, s: rr(0, road.len), dir: sgn,
      off: halfW + rr(1.05, 1.7) + (chance(0.5) ? 0.9 : 0),
      speed: rr(0.35, 0.72),
      shirt: jitC(asCol(PED_SHIRT), 0.06), skin: asCol(PED_SKIN),
      h: rr(0.30, 0.40),
    });
  }
  peds.body = new DynPool(N, litMat, true);
  peds.head = new DynPool(N, litMat, true);
  for (let i = 0; i < N; i++) {
    peds.body.set(i, 0, -50, 0, 0.001, 0.001, 0.001, 0, peds.list[i].shirt);
    peds.head.set(i, 0, -50, 0, 0.001, 0.001, 0.001, 0, peds.list[i].skin);
  }
  peds.body.commit(); peds.head.commit();
}

function updatePeds(dt) {
  const L = peds.list;
  for (let i = 0; i < L.length; i++) {
    const p = L[i];
    p.s += p.speed * dt * p.dir;
    if (p.s > p.road.len) { p.s = p.road.len; p.dir = -1; }
    if (p.s < 0) { p.s = 0; p.dir = 1; }
    /* sample the polyline */
    let acc = 0, x = 0, z = 0, dx = 1, dz = 0;
    const pts = p.road.pts;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (sl < 1e-6) continue;
      if (p.s <= acc + sl) {
        const t = (p.s - acc) / sl;
        x = lerp(a[0], b[0], t); z = lerp(a[1], b[1], t);
        dx = (b[0] - a[0]) / sl; dz = (b[1] - a[1]) / sl;
        break;
      }
      acc += sl;
      x = b[0]; z = b[1];
    }
    const off = p.off * p.dir;
    const px = x - dz * off, pz = z + dx * off;
    const bob = Math.sin(p.s * 2.4 + i) * 0.02;
    peds.body.set(i, px, 0.13 + p.h / 2 + bob, pz, 0.15, p.h, 0.15, -Math.atan2(dz, dx), p.shirt);
    peds.head.set(i, px, 0.13 + p.h + 0.09 + bob, pz, 0.13, 0.13, 0.13, 0, p.skin);
  }
  peds.body.commit();
  peds.head.commit();
}

/* ------------------------------------------------------- street furniture */
function streetLights() {
  let n = 0;
  const _on = vg.onDefault;
  vg.onDefault = 0.16;
  vg.onJitter = 0.10;
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 4 || r.tunnel) continue;
    const halfW = (r.cls === 1 ? 11 : r.cls === 2 ? 10 : r.cls === 3 ? 9 : 8) / 2 / 4;
    let side = chance(0.5) ? 1 : -1;
    alongRoad(r, 15, (x, z, dx, dz) => {
      side = -side;
      if (r.cls === 4 && !chance(0.7)) return;
      const rx = -dz, rz = dx;
      const px = x + rx * (halfW + 0.55) * side, pz = z + rz * (halfW + 0.55) * side;
      if (!freeAt(px, pz)) return;
      n++;
      vb.blk(px - 0.07, px + 0.07, 0, 1.85, pz - 0.07, pz + 0.07, asCol(P.pole));
      vb.blk(px - rx * side * 0.55, px, 1.72, 1.8, pz - rz * side * 0.55, pz, asCol(P.pole));
      vg.blk(px - rx * side * 0.72 - 0.17, px - rx * side * 0.44 + 0.17, 1.56, 1.72,
        pz - rz * side * 0.72 - 0.17, pz - rz * side * 0.44 + 0.17, asCol(P.glowWarm));
      if (LAMPS.length < 9000) LAMPS.push({ x: px - rx * side * 0.58, z: pz - rz * side * 0.58,
        r: r.cls === 1 ? rr(6.0, 7.6) : r.cls === 2 ? rr(5.0, 6.4) : rr(3.8, 5.2) });
    });
  }
  vg.onDefault = _on;
  vg.onJitter = 0.16;
  return n;
}

function busShelters() {
  let n = 0;
  for (let k = 0; k < BGEO.pois.length; k++) {
    const p = BGEO.pois[k];
    if (p[2] !== 20) continue;
    const x = p[0], z = p[1];
    const near = nearestRoad(x, z);
    if (!near) continue;
    const d = near.dir;
    const rx = -d[1], rz = d[0];
    const ox = x + rx * near.halfW, oz = z + rz * near.halfW;
    n++;
    for (const s of [-1.1, 1.1]) {
      vb.blk(ox + d[0] * s - 0.06, ox + d[0] * s + 0.06, 0, 0.86, oz + d[1] * s - 0.06, oz + d[1] * s + 0.06, asCol(P.pole));
    }
    vb.blk(ox - d[0] * 1.35, ox + d[0] * 1.35, 0.86, 0.96, oz - d[1] * 1.35, oz + d[1] * 1.35, asCol(P.roofBlue));
    vb.blk(ox + rx * 0.42 - d[0] * 1.2, ox + rx * 0.42 + d[0] * 1.2, 0.2, 0.72,
      oz + rz * 0.42 - d[1] * 1.2, oz + rz * 0.42 + d[1] * 1.2, jitC(asCol(P.white), 0.04));
    vg.blk(ox - d[0] * 0.5, ox + d[0] * 0.5, 0.2, 0.55, oz - d[1] * 0.5, oz + d[1] * 0.5, asCol(P.glowCool));
  }
  return n;
}
function nearestRoad(x, z) {
  let best = null;
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 4) continue;
    const n = nearestOn(r, x, z);
    if (n && (!best || n.d < best.d)) {
      const L = Math.hypot(n.b[0] - n.a[0], n.b[1] - n.a[1]) || 1;
      best = {
        d: n.d, dir: [(n.b[0] - n.a[0]) / L, (n.b[1] - n.a[1]) / L],
        halfW: (r.cls === 1 ? 11 : r.cls === 2 ? 10 : r.cls === 3 ? 9 : 8) / 2 / 4 + 1.1,
        road: r,
      };
    }
  }
  return best;
}

/* tea stalls / eateries clustered where people actually stop: junctions */
function streetStalls() {
  let n = 0;
  const spots = junctionNodes.slice(0, 26);
  for (let k = 0; k < spots.length; k++) {
    const c = spots[k];
    const near = nearestRoad(c[0], c[1]);
    if (!near) continue;
    const count = 1 + ((rnd() * 3) | 0);
    for (let q = 0; q < count; q++) {
      const ang = rnd() * TAU, rad = rr(2.2, 6.5);
      const x = c[0] + Math.cos(ang) * rad, z = c[1] + Math.sin(ang) * rad;
      if (!freeAt(x, z)) continue;
      n++;
      const w = rr(0.55, 0.95), d = rr(0.5, 0.8);
      vb.blk(x - w / 2, x + w / 2, 0, 0.5, z - d / 2, z + d / 2, jitC(chance(0.5) ? asCol(P.wallPale) : asCol(P.wallYellow), 0.05));
      vb.blk(x - w * 0.62, x + w * 0.62, 0.5, 0.56, z - d * 0.62, z + d * 0.62, jitC(pick([C(0x3f6fa8), C(0xc8523f), C(0x4f7f52)]), 0.06));
      vg.blk(x - w * 0.42, x + w * 0.42, 0.2, 0.42, z - d * 0.52, z - d * 0.45, asCol(P.glowWarm));
      /* a crate and a stool so it reads as a stall, not a shed */
      vb.blk(x + w * 0.7, x + w * 0.95, 0, 0.22, z - 0.1, z + 0.14, jitC(asCol(P.wood || P.trunk), 0.1));
    }
  }
  return n;
}

/* billboards along the arterial edges, on commercial frontage only */
function billboards() {
  let n = 0;
  for (let k = 0; k < BGEO.sites.length && n < 22; k++) {
    const site = BGEO.sites[k];
    if (site[1] !== 1) continue;
    const ring = site[0];
    for (let i = 0; i < ring.length; i += 3) {
      const x = ring[i][0], z = ring[i][1];
      const near = nearestRoad(x, z);
      if (!near || near.d > 4.5 || near.road.cls > 4) continue;
      if (!chance(0.28)) continue;
      const d = near.dir, rx = -d[1], rz = d[0];
      const bx = x + rx * 1.2, bz = z + rz * 1.2;
      vb.blk(bx - 0.09, bx + 0.09, 0, 2.3, bz - 0.09, bz + 0.09, asCol(P.steel));
      vb.blk(bx - d[0] * 1.5, bx + d[0] * 1.5, 1.9, 3.0, bz - d[1] * 1.5, bz + d[1] * 1.5,
        jitC(pick([C(0xd8d3c4), C(0xbfc9cf), C(0xd9c9a8)]), 0.03));
      vb.blk(bx - d[0] * 1.3, bx + d[0] * 1.3, 2.05, 2.85, bz - d[1] * 1.3, bz + d[1] * 1.3,
        jitC(pick([C(0xc0453a), C(0x2f6fa8), C(0xd8a531), C(0x3f7f5f)]), 0.06));
      n++;
      break;
    }
  }
  return n;
}

/* ------------------------------------- Namma Metro Phase 2A — under works  */
function metroWorks() {
  const lines = BGEO.metro.line;
  if (!lines.length) return 0;
  let n = 0;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const steps = Math.max(1, Math.round(L / 9));
      for (let s = 0; s <= steps; s++) {
        const x = lerp(a[0], b[0], s / steps), z = lerp(a[1], b[1], s / steps);
        if (!chance(0.82)) continue;
        /* pier: shaft + pier cap, no deck yet — it is still being built */
        vb.blk(x - 0.35, x + 0.35, 0, 2.3, z - 0.35, z + 0.35, jitC(asCol(P.concrete), 0.04));
        vb.blk(x - 0.75, x + 0.75, 2.3, 2.7, z - 0.55, z + 0.55, jitC(asCol(P.concreteDk), 0.04));
        /* orange crash barrier around the pier */
        if (chance(0.5)) {
          vb.blk(x - 0.9, x - 0.72, 0, 0.36, z - 0.9, z + 0.9, asCol(P.orange));
          vb.blk(x + 0.72, x + 0.9, 0, 0.36, z - 0.9, z + 0.9, asCol(P.orange));
        }
        n++;
      }
    }
  }
  /* station boxes under construction */
  const st = BGEO.metro.stations;
  for (let k = 0; k < st.length; k++) {
    if (st[k][3] < 1500) continue;
    const x = st[k][0], z = st[k][1];
    const w = 7.5, d = 4.0;
    for (let f = 0; f < 3; f++) {
      const y = f * 0.55;
      vb.blk(x - w / 2, x + w / 2, y, y + 0.12, z - d / 2, z + d / 2, jitC(asCol(P.concrete), 0.03));
      for (let c = 0; c <= 4; c++) {
        const px = lerp(x - w / 2, x + w / 2, c / 4);
        vb.blk(px - 0.09, px + 0.09, y, y + 0.55, z - d / 2, z - d / 2 + 0.14, asCol(P.concrete));
        vb.blk(px - 0.09, px + 0.09, y, y + 0.55, z + d / 2 - 0.14, z + d / 2, asCol(P.concrete));
      }
    }
    /* scaffolding + a site hoarding */
    for (let c = 0; c < 5; c++) {
      const px = lerp(x - w / 2, x + w / 2, c / 4);
      vb.blk(px - 0.05, px + 0.05, 0, 1.75, z - d / 2 - 0.12, z - d / 2 - 0.02, asCol(P.scaffold));
    }
    vb.blk(x - w / 2 - 0.4, x + w / 2 + 0.4, 0.35, 0.85, z - d / 2 - 0.5, z - d / 2 - 0.44, asCol(P.orange));
  }
  return n;
}

/* ------------------------------------------------------------ lake + birds */
function lakeLife() {
  /* a few work boats: the lake is under desilting works (OSM note, 2026) */
  const water = terrain.water;
  if (!water) return 0;
  let made = 0;
  for (let tries = 0; tries < 400 && made < 4; tries++) {
    const x = W.ox + rr(40, W.w - 40), z = W.oz + rr(50, W.h * 0.45);
    const i = Math.floor(x - W.ox), j = Math.floor(z - W.oz);
    if (!water[j * W.w + i]) continue;
    const y = GROUND_H[4];
    vb.blk(x - 0.9, x + 0.9, y + 0.05, y + 0.22, z - 0.45, z + 0.45, jitC(asCol(C(0x6b5f4a)), 0.05));
    vb.blk(x - 0.55, x + 0.55, y + 0.22, y + 0.42, z - 0.3, z + 0.3, jitC(asCol(P.steel), 0.06));
    made++;
  }
  /* birds over the water */
  const birds = { list: [] };
  for (let f = 0; f < 3; f++) {
    const cxx = W.ox + rr(80, 300), czz = W.oz + rr(60, 280);
    for (let b = 0; b < 11; b++) birds.list.push({
      cx: cxx + rr(-14, 14), cz: czz + rr(-14, 14), r: rr(2.5, 7),
      ph: rnd() * TAU, sp: rr(0.35, 0.7), y: rr(4, 7.5),
    });
  }
  birds.mesh = new DynPool(birds.list.length, litMat, false);
  anim.push((t, dt) => {
    for (let i = 0; i < birds.list.length; i++) {
      const b = birds.list[i];
      const a = b.ph + t * b.sp;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
      const flap = 0.5 + 0.5 * Math.sin(t * 9 + i);
      birds.mesh.set(i, x, b.y + Math.sin(t * 0.9 + i) * 0.35, z, 0.22, 0.05 + flap * 0.06, 0.12,
        -a + Math.PI / 2, asCol(C(0x3a3a40)));
    }
    birds.mesh.commit();
  });
  return made;
}
