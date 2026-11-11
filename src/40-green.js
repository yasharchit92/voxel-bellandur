/* ============================================================================
   GREEN — street trees, campus planting, lake margin, compound walls + gates
   ----------------------------------------------------------------------------
   Bellandur's canopy is one of the things that makes it recognisable: rain
   trees and honge over the residential streets, palms and clipped hedges inside
   the tech campuses, scrub and reeds around the lake.  Distribution follows the
   data — street trees follow road centrelines, campus planting fills the campus
   polygons, lake planting follows the shoreline.
   ============================================================================ */

const GREEN = { trees: 0, palms: 0 };

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}
function cellAt(x, z) {
  const i = Math.floor(x - W.ox), j = Math.floor(z - W.oz);
  if (i < 0 || j < 0 || i >= W.w || j >= W.h) return 0;
  return terrain.cells[j * W.w + i];
}
function builtAt(x, z) {
  const i = Math.floor(x - W.ox), j = Math.floor(z - W.oz);
  if (i < 0 || j < 0 || i >= W.w || j >= W.h) return 1;
  return terrain.built ? terrain.built[j * W.w + i] : 0;
}
function freeAt(x, z) {
  const c = cellAt(x, z);
  if (c === 2 || c === 3 || c === 4 || c === 10 || c === 12) return false;  /* road/water/pool */
  return !builtAt(x, z);
}

/* --------------------------------------------------------------- one tree */
function rainTree(x, z, s) {
  const th = rr(0.85, 1.35) * s;
  vb.blk(x - 0.11, x + 0.11, 0, th, z - 0.11, z + 0.11, jitC(P.trunk, 0.08));
  const r = rr(1.05, 1.55) * s, y = th + r * 0.5;
  const col = chance(0.25) ? P.leafLight : P.leaf;
  vb.blk(x - r, x + r, y - r * 0.5, y + r * 0.55, z - r * 0.75, z + r * 0.75, jitC(col, 0.09));
  vb.blk(x - r * 0.72, x + r * 0.72, y + r * 0.35, y + r * 0.98, z - r * 0.6, z + r * 0.6, jitC(col, 0.09));
  if (chance(0.6)) vb.blk(x - r * 0.5, x + r * 0.5, y + r * 0.9, y + r * 1.3, z - r * 0.4, z + r * 0.4, jitC(col, 0.09));
  GREEN.trees++;
}
function palm(x, z, s) {
  const th = rr(1.4, 2.2) * s;
  vb.blk(x - 0.075, x + 0.075, 0, th, z - 0.075, z + 0.075, jitC(C(0x7a6a4e), 0.08));
  const r = rr(0.62, 0.92) * s;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rr(-0.3, 0.3);
    const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
    vb.blk(x + Math.min(0, fx) - 0.05, x + Math.max(0, fx) + 0.05, th - 0.02, th + 0.14,
      z + Math.min(0, fz) - 0.05, z + Math.max(0, fz) + 0.05, jitC(P.palm, 0.1));
  }
  vb.blk(x - 0.14, x + 0.14, th + 0.1, th + 0.26, z - 0.14, z + 0.14, jitC(P.palm, 0.1));
  GREEN.palms++;
}
function shrub(x, z, s) {
  const r = rr(0.24, 0.44) * s;
  vb.blk(x - r, x + r, 0, rr(0.34, 0.72) * s, z - r, z + r, jitC(chance(0.3) ? P.grassDk : P.leaf, 0.1));
}

/* --------------------------------------------------------- street planting */
function streetTrees() {
  for (let k = 0; k < ROADS.length; k++) {
    const r = ROADS[k];
    if (r.cls > 5 || r.tunnel) continue;
    if (r.cls >= 5 && chance(0.35)) continue;        /* not every lane is lined */
    const halfW = (r.cls === 1 ? 11 : r.cls === 2 ? 10 : r.cls === 3 ? 9 : r.cls === 4 ? 8 : 6) / 2 / 4;
    const gap = r.cls <= 2 ? 5.5 : r.cls <= 4 ? 6.5 : 8.5;
    alongRoad(r, gap, (x, z, dx, dz, si) => {
      if (!chance(0.86)) return;
      const rx = -dz, rz = dx;
      const sgn = chance(0.5) ? 1 : -1;
      const off = halfW + rr(1.5, 2.4);
      const tx = x + rx * off * sgn + rr(-0.6, 0.6);
      const tz = z + rz * off * sgn + rr(-0.6, 0.6);
      if (!freeAt(tx, tz)) return;
      if (r.cls <= 3 && chance(0.14)) palm(tx, tz, rr(0.8, 1.1));
      else rainTree(tx, tz, rr(0.75, 1.15));
    });
  }
}

/* ---------------------------------------------------------- campus planting */
function sitePlanting() {
  const sites = BGEO.sites;
  for (let k = 0; k < sites.length; k++) {
    const ring = sites[k][0], kind = sites[k][1];
    if (kind === 3) continue;                       /* construction: no planting */
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, area = 0;
    for (let i = 0; i < ring.length; i++) {
      minx = Math.min(minx, ring[i][0]); maxx = Math.max(maxx, ring[i][0]);
      minz = Math.min(minz, ring[i][1]); maxz = Math.max(maxz, ring[i][1]);
    }
    area = (maxx - minx) * (maxz - minz);
    const n = clamp(Math.round(area / (kind === 4 ? 26 : 70)), 6, 260);
    for (let q = 0; q < n; q++) {
      const x = rr(minx, maxx), z = rr(minz, maxz);
      if (!pointInRing(x, z, ring)) continue;
      if (!freeAt(x, z)) continue;
      const r = rnd();
      if (kind === 1 || kind === 6) {
        /* campuses: clipped hedges, palms on the drive, canopy trees behind */
        if (r < 0.3) palm(x, z, rr(0.85, 1.15));
        else if (r < 0.55) shrub(x, z, rr(0.9, 1.4));
        else rainTree(x, z, rr(0.7, 1.1));
      } else {
        if (r < 0.16) palm(x, z, rr(0.8, 1.1));
        else if (r < 0.4) shrub(x, z, rr(1.0, 1.5));
        else rainTree(x, z, rr(0.8, 1.25));
      }
    }
  }
}

/* ------------------------------------------------------- lake margin green */
function shoreGreen() {
  const sh = terrain.shore;
  const step = Math.max(1, Math.floor(sh.length / 1600));
  for (let i = 0; i < sh.length; i += step) {
    const x = sh[i][0], z = sh[i][1];
    if (!chance(0.55)) continue;
    if (freeAt(x, z) === false && builtAt(x, z)) continue;
    const r = rnd();
    if (r < 0.45) rainTree(x + rr(-1, 1), z + rr(-1, 1), rr(0.7, 1.05));
    else shrub(x, z, rr(0.8, 1.3));
  }
}

/* ------------------------------------------- compound walls, gates, guards */
function compoundWalls() {
  const sites = BGEO.sites;
  for (let k = 0; k < sites.length; k++) {
    const ring = sites[k][0], kind = sites[k][1];
    if (kind === 4 || kind === 5) continue;               /* parks have no wall */
    let per = 0;
    for (let i = 1; i < ring.length; i++) per += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
    if (per > 900) continue;                              /* too big to wall */
    /* find the gate: the point closest to a road centreline */
    let gate = null, best = 1e9;
    for (let i = 0; i < ring.length; i++) {
      for (let r = 0; r < ROADS.length; r += 3) {
        const rd = ROADS[r];
        if (rd.cls > 4) continue;
        const n = nearestOn(rd, ring[i][0], ring[i][1]);
        if (n && n.d < best) { best = n.d; gate = [ring[i][0], ring[i][1]]; }
      }
    }
    const wallCol = kind === 1 ? P.concrete : P.wallPale;
    const step = 1.6;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const n = Math.max(1, Math.round(L / step));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
        if (gate && Math.hypot(x - gate[0], z - gate[1]) < 3.2) continue;
        if (!chance(0.92)) continue;
        vb.blk(x - step * 0.55, x + step * 0.55, 0, 0.42, z - 0.12, z + 0.12, jitC(asCol(wallCol), 0.05));
      }
    }
    /* gate: pillars, a boom barrier and a security cabin */
    if (gate) {
      const p = nearestOn(ROADS[0], gate[0], gate[1]);
      vb.blk(gate[0] - 0.2, gate[0] + 0.2, 0, 0.9, gate[1] - 0.2, gate[1] + 0.2, asCol(P.concrete));
      vb.blk(gate[0] + 2.6, gate[0] + 3.0, 0, 0.9, gate[1] - 0.2, gate[1] + 0.2, asCol(P.concrete));
      vb.blk(gate[0] + 0.2, gate[0] + 2.6, 0.62, 0.7, gate[1] - 0.06, gate[1] + 0.06, asCol(C(0xe0d8c0)));
      /* cabin just inside the wall */
      const cxo = gate[0] + 1.2, czo = gate[1] + 2.2;
      vb.blk(cxo - 0.75, cxo + 0.75, 0, 0.72, czo - 0.7, czo + 0.7, asCol(P.wallPale));
      vb.blk(cxo - 0.85, cxo + 0.85, 0.72, 0.82, czo - 0.8, czo + 0.8, asCol(P.roofBlue));
      vg.blk(cxo - 0.6, cxo + 0.6, 0.34, 0.58, czo - 0.72, czo - 0.68, asCol(P.glowCool));
    }
  }
}

function buildGreen() {
  streetTrees();
  sitePlanting();
  shoreGreen();
  compoundWalls();
}
