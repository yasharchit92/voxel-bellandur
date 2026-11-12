/* ============================================================================
   ROADS — the ORR corridor, kerbs, medians, lane markings, the traffic graph
   ----------------------------------------------------------------------------
   Asphalt itself is already painted into the ground grid by the data stage.
   This module adds what makes a Bengaluru arterial read at this scale: raised
   kerbed footpaths, a planted median between the two carriageways, dashed lane
   markings, signal poles at real junctions, bus shelters at real bus stops —
   and the lane graph the traffic system drives on.

   Left-hand traffic: every vehicle is offset to the LEFT of its direction of
   travel, and OSM one-way tagging decides which carriageway it may use.
   ============================================================================ */

const ROADS = [];
const laneGraph = { edges: [], atNode: {} };
const junctionNodes = [];
const R_LANE_W = 3.4 / 4.0;        /* 3.4 m lane in voxel units */

function roadPoints(road) {
  const idx = road[4];
  const pts = [];
  for (let i = 0; i < idx.length; i++) pts.push(BGEO.rnodes[idx[i]]);
  return pts;
}
function segLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/* ------------------------------------------------------------------ build */
function buildRoads() {
  for (let k = 0; k < BGEO.roads.length; k++) {
    const r = BGEO.roads[k];
    const road = {
      k: k, cls: r[0], oneway: r[1], lanes: r[2],
      name: r[3] >= 0 ? BGEO.names[r[3]] : '', idx: r[4],
      bridge: r[5], tunnel: r[6], order: r[7],
      pts: roadPoints(r), len: 0,
    };
    for (let i = 1; i < road.pts.length; i++) road.len += segLen(road.pts[i - 1], road.pts[i]);
    if (road.len < 0.5) continue;
    ROADS.push(road);
  }

  paintMarkings();
  paintKerbAndFootpath();
  paintMedian();
  paintJunctions();
  buildLaneGraph();
}

/* ------------------------------------------------- markings + kerb paint */
function alongRoad(road, step, cb) {
  const p = road.pts;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const L = segLen(a, b);
    if (L < 0.01) continue;
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    let s = 0;
    while (s < L) {
      cb(a[0] + dx * s, a[1] + dz * s, dx, dz, i);
      s += step;
    }
  }
}
/* a thin plate oriented along (dx,dz) — used for paint, kerbs, markings */
function strip(x, z, dx, dz, len, wid, y0, y1, col) {
  const ang = Math.atan2(dz, dx);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  /* one instance, rotated about Y.  Stored via raw() then fixed up in build(). */
  vb.raw(x, (y0 + y1) / 2, z, len, y1 - y0, wid, asCol(col));
  vb.rot[vb.n - 1] = -ang;
}

function paintMarkings() {
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 4 || r.bridge || r.tunnel) continue;
    const y0 = -0.055, y1 = -0.028;
    const laneW = R_LANE_W;
    const nLanes = clamp(r.lanes, 1, 4);
    alongRoad(r, 11.0, (x, z, dx, dz) => {
      /* dashed lane separators */
      const rx = -dz, rz = dx;                       /* right of travel */
      for (let l = 1; l < nLanes; l++) {
        const off = (l - nLanes / 2) * laneW;
        strip(x + rx * off, z + rz * off, dx, dz, 4.2, 0.13, y0, y1, P.white);
      }
      /* edge line on the outer side of a one-way carriageway */
      if (r.oneway) {
        const off = (nLanes / 2) * laneW + 0.35;
        strip(x + rx * off, z + rz * off, dx, dz, 9.5, 0.10, y0, y1, mixC(asCol(P.white), C(0xb9b3a4), 0.45));
      }
    });
  }
}

function paintKerbAndFootpath() {
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 4 || r.bridge || r.tunnel) continue;
    const halfW = (r.cls === 1 ? 11.0 : r.cls === 2 ? 10.0 : r.cls === 3 ? 9.0 : 8.0) / 2 / 4;
    const foot = r.cls <= 2 ? 1.15 : 0.85;
    alongRoad(r, 8.0, (x, z, dx, dz) => {
      const rx = -dz, rz = dx;
      for (const sgn of [-1, 1]) {
        const ox = x + rx * halfW * sgn, oz = z + rz * halfW * sgn;
        /* kerb face */
        strip(ox, oz, dx, dz, 8.2, 0.22, -0.09, 0.16, mixC(asCol(P.concrete), asCol(P.concreteDk), 0.4));
        /* footpath slab behind it */
        strip(ox + rx * foot * 0.62 * sgn, oz + rz * foot * 0.62 * sgn, dx, dz, 8.2, foot,
          -0.09, 0.11, jitC(mixC(asCol(P.paving), asCol(P.asphalt), 0.42), 0.05));
      }
    });
  }
}

/* planted median between the two carriageways of a divided arterial */
function paintMedian() {
  const dual = [];
  for (let i = 0; i < ROADS.length; i++) {
    const a = ROADS[i];
    if (!a.oneway || a.cls > 3 || a.len < 12) continue;
    const am = a.pts[(a.pts.length / 2) | 0];
    const ad = dirAt(a, am);
    for (let j = i + 1; j < ROADS.length; j++) {
      const b = ROADS[j];
      if (!b.oneway || b.cls > 3 || b.len < 12) continue;
      if (a.cls !== b.cls) continue;
      const bm = b.pts[(b.pts.length / 2) | 0];
      const bd = dirAt(b, bm);
      const dist = Math.hypot(am[0] - bm[0], am[1] - bm[1]);
      const dot = ad[0] * bd[0] + ad[1] * bd[1];
      if (dist < 34 && dot < -0.55) { dual.push([a, b, dist]); break; }
    }
  }
  for (let k = 0; k < dual.length; k++) {
    const a = dual[k][0], b = dual[k][1];
    /* walk the shorter carriageway and pin the median between the two */
    const src = a.len < b.len ? a : b;
    const dst = src === a ? b : a;
    alongRoad(src, 7.0, (x, z, dx, dz) => {
      const near = nearestOn(dst, x, z);
      if (!near || near.d > 26) return;
      const mx = (x + near.x) / 2, mz = (z + near.z) / 2;
      if (near.d < 2.6) return;                       /* carriageways merged */
      const w = clamp(near.d - 2.4, 0.35, 2.2);
      vb.blk(mx - w / 2, mx + w / 2, -0.06, 0.22, mz - w / 2, mz + w / 2,
        jitC(mixC(asCol(P.grass), asCol(P.scrub), 0.4), 0.08));
      if (chance(0.55)) {
        const h = rr(0.5, 1.15);
        vb.blk(mx - w * 0.3, mx + w * 0.3, 0.2, 0.2 + h, mz - w * 0.3, mz + w * 0.3,
          jitC(pick(P.leaf), 0.10));
      }
    });
  }
}

function dirAt(road, p) {
  let best = 0, bd = 1e9;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i];
    const d = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (d < bd) { bd = d; best = i; }
  }
  const a = road.pts[Math.max(0, best - 1)], b = road.pts[best];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}
function nearestOn(road, x, z) {
  let best = null;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const L2 = vx * vx + vz * vz;
    if (L2 < 1e-6) continue;
    let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2;
    t = clamp(t, 0, 1);
    const px = a[0] + vx * t, pz = a[1] + vz * t;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { x: px, z: pz, d: d, i: i, t: t, a: a, b: b };
  }
  return best;
}

/* ------------------------------------------------------------- junctions */
function paintJunctions() {
  const deg = new Map();
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 5) continue;
    const n = r.idx.length;
    for (let i = 0; i < n; i++) {
      const key = r.idx[i];
      const e = deg.get(key) || { n: 0, top: 9 };
      e.n++; if (r.cls < e.top) e.top = r.cls;
      deg.set(key, e);
    }
  }
  const cand = [];
  deg.forEach((e, key) => { if (e.n >= 3 && e.top <= 4) cand.push([key, e]); });
  cand.sort((a, b) => a[1].top - b[1].top || b[1].n - a[1].n);
  for (let k = 0; k < Math.min(cand.length, 40); k++) {
    const p = BGEO.rnodes[cand[k][0]];
    if (!p) continue;
    junctionNodes.push([p[0], p[1], cand[k][1].top, cand[k][1].n]);
    /* signal mast on the near kerb corner */
    const x = p[0], z = p[1];
    vb.blk(x + 1.5, x + 1.75, 0, 2.5, z + 1.2, z + 1.45, asCol(P.pole));
    vb.blk(x + 1.42, x + 1.84, 2.5, 2.9, z + 1.1, z + 1.55, C(0x2b2b2e));
    vg.blk(x + 1.45, x + 1.55, 2.62, 2.74, z + 1.26, z + 1.4, asCol(P.glowGreen));
    vg.blk(x + 1.7, x + 1.8, 2.62, 2.74, z + 1.26, z + 1.4, asCol(P.glowRed));
    /* zebra bars across the approach */
    const r = ROADS.find((q) => q.idx.indexOf(cand[k][0]) >= 0 && q.cls <= 4);
    if (r) {
      const d = dirAt(r, p);
      const rx = -d[1], rz = d[0];
      for (let b = -3; b <= 3; b++) {
        const ox = p[0] + rx * b * 1.35, oz = p[1] + rz * b * 1.35;
        strip(ox, oz, d[0], d[1], 0.55, 1.05, -0.055, -0.025, P.white);
      }
    }
  }
}

/* ----------------------------------------------------------- lane graph */
function buildLaneGraph() {
  const edges = laneGraph.edges, atNode = laneGraph.atNode;
  /* endpoints are snapped to a 3-voxel lattice so that different OSM ways that
     meet at a junction share a node — otherwise there is no graph, just a pile
     of disconnected road segments and nothing can ever turn or queue */
  const keyOf = (p) => (Math.round(p[0] / 3) + 4096) * 8192 + (Math.round(p[1] / 3) + 4096);
  laneGraph.atIn = {};
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 6 || r.len < 2.5) continue;
    const nLanes = clamp(r.lanes, 1, 3);
    const dirs = r.oneway === 0 ? [1, -1] : [r.oneway];
    for (let d = 0; d < dirs.length; d++) {
      const sgn = dirs[d];
      const pts = sgn > 0 ? r.pts.slice() : r.pts.slice().reverse();
      const e = {
        road: r, sgn: sgn, pts: pts, len: r.len, lanes: nLanes,
        a: keyOf(pts[0]),
        b: keyOf(pts[pts.length - 1]),
        cls: r.cls,
      };
      edges.push(e);
      (atNode[e.a] || (atNode[e.a] = [])).push(e);
      (laneGraph.atIn[e.b] || (laneGraph.atIn[e.b] = [])).push(e);
    }
  }
  /* per-edge speed limits, derived from class only */
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    e.vmax = e.cls === 1 ? rr(2.6, 3.6) : e.cls === 2 ? rr(2.2, 3.1) :
      e.cls === 3 ? rr(1.9, 2.7) : e.cls === 4 ? rr(1.6, 2.3) :
        e.cls === 5 ? rr(1.2, 1.9) : rr(0.9, 1.4);
  }
}
