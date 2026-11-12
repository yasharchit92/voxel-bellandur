/* ============================================================================
   TERRAIN — the diorama base, the ground plane, Bellandur Lake
   ----------------------------------------------------------------------------
   Ground classes come straight from the rasterised OSM bundle
   (BGEO.ground = [i,j,w,d,class]).  Bellandur is flat, so the city sits on a
   level plane at y = 0; only the lake is sunk and banked, which is what makes
   the shoreline read.  Nothing here is hand-placed.
   ============================================================================ */

const GROUND_H = {
  0: 0.00,   /* default ground   */
  1: 0.02,   /* residential plot */
  2: -0.07,  /* asphalt          */
  3: 0.13,   /* footway / kerb   */
  4: -0.62,  /* water            */
  5: 0.07,   /* grass            */
  6: 0.03,   /* scrub            */
  7: 0.02,   /* commercial plot  */
  8: 0.02,   /* industrial       */
  9: -0.16,  /* construction     */
  10: -0.05, /* parking          */
  11: 0.05,  /* pitch / court    */
  12: -0.45, /* pool             */
  13: -0.28, /* mud / wetland    */
  14: 0.10,  /* service yard     */
  15: 0.00,  /* (unused)         */
};
const GROUND_C = {
  1: P.earth, 2: P.asphalt, 3: P.paving, 4: P.water, 5: P.grass, 6: P.scrub,
  7: P.paving, 8: P.concrete, 9: P.laterite, 10: P.asphaltOld, 11: P.pitch,
  12: P.pool, 13: P.mud, 14: P.paving,
};

const terrain = {
  water: null,          /* Uint8Array occupancy */
  cells: null,          /* class per cell        */
  shore: [],
  plinthTop: 0,
};

function buildTerrain() {
  const GW = W.w, GH = W.h;
  terrain.cells = new Uint8Array(GW * GH);
  for (let k = 0; k < BGEO.ground.length; k++) {
    const g = BGEO.ground[k], cls = g[4];
    for (let j = g[1]; j < g[1] + g[3]; j++)
      for (let i = g[0]; i < g[0] + g[2]; i++)
        if (i >= 0 && j >= 0 && i < GW && j < GH) terrain.cells[j * GW + i] = cls;
  }

  /* ---- 1. the model base: soil strata + a dark lip ---------------------- */
  const x0 = W.ox - 1.6, x1 = W.ox + GW + 1.6;
  const z0 = W.oz - 1.6, z1 = W.oz + GH + 1.6;
  /* the top of the base must sit BELOW the lake bed, or the water disappears
     inside it — everything above -1.9 is ground plate / water / lake bed */
  vb.blk(x0 - 1.1, x1 + 1.1, -8.4, -6.6, z0 - 1.1, z1 + 1.1, C(0x33302b));  /* model lip  */
  vb.blk(x0, x1, -6.6, -5.0, z0, z1, C(0x6b6255));                          /* deep soil  */
  vb.blk(x0, x1, -5.0, -3.5, z0, z1, P.laterite);                           /* laterite   */
  vb.blk(x0, x1, -3.5, -2.6, z0, z1, C(0x8d7a5e));                          /* weathered  */
  vb.blk(x0, x1, -2.6, -1.9, z0, z1, C(0x9c8d74));                          /* fill       */

  /* ---- 2. ground plates, tiled so big flats get tonal variation -------- */
  const TILE = 6;
  for (let k = 0; k < BGEO.ground.length; k++) {
    const g = BGEO.ground[k];
    const i0 = g[0], j0 = g[1], w = g[2], d = g[3], cls = g[4];
    const pal = GROUND_C[cls] || P.earth;
    const top = GROUND_H[cls] === undefined ? 0 : GROUND_H[cls];
    /* one tone per merged rect (evaluated at its centre) — per-tile tones
       would band across the long thin strips the merge produces */
    const nRect = fbm((i0 + w * 0.5) * 0.055, (j0 + d * 0.5) * 0.055, 2);
    const baseCol = jitC(mixC(asCol(pal), shadeC(asCol(pal), 0.86), nRect * 0.7),
      cls === 2 ? 0.014 : 0.03);
    for (let jj = 0; jj < d; jj += TILE) {
      const dh = Math.min(TILE, d - jj);
      for (let ii = 0; ii < w; ii += TILE) {
        const dw = Math.min(TILE, w - ii);
        const x = cx(i0 + ii, dw), z = cz(j0 + jj, dh);
        /* broad tonal drift + fine jitter */
        if (cls === 4) {
          vw.blk(x - dw / 2, x + dw / 2, top - 0.16, top, z - dh / 2, z + dh / 2, [1, 1, 1]);
        } else {
          vb.blk(x - dw / 2, x + dw / 2, -1.95, top, z - dh / 2, z + dh / 2, baseCol);
        }
      }
    }
  }

  /* ---- 3. water occupancy + lake bed ----------------------------------- */
  terrain.water = new Uint8Array(GW * GH);
  for (let k = 0; k < BGEO.water.length; k++) {
    const ring = BGEO.water[k];
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let p = 0; p < ring.length; p++) {
      minx = Math.min(minx, ring[p][0]); maxx = Math.max(maxx, ring[p][0]);
      minz = Math.min(minz, ring[p][1]); maxz = Math.max(maxz, ring[p][1]);
    }
    const ci0 = Math.max(0, Math.floor(minx - W.ox)), ci1 = Math.min(GW - 1, Math.ceil(maxx - W.ox));
    const cj0 = Math.max(0, Math.floor(minz - W.oz)), cj1 = Math.min(GH - 1, Math.ceil(maxz - W.oz));
    const n = ring.length;
    for (let j = cj0; j <= cj1; j++) {
      const zc = W.oz + j + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const ax = ring[i][0], az = ring[i][1];
        const bx = ring[(i + 1) % n][0], bz = ring[(i + 1) % n][1];
        if ((az <= zc && bz > zc) || (bz <= zc && az > zc)) xs.push(ax + (zc - az) * (bx - ax) / (bz - az));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(ci0, Math.ceil(xs[s] - W.ox - 0.5));
        const i1 = Math.min(ci1, Math.floor(xs[s + 1] - W.ox - 0.5));
        for (let i = i0; i <= i1; i++) terrain.water[j * GW + i] = 1;
      }
    }
    /* lake bed under the surface */
    const bx = (minx + maxx) / 2, bz = (minz + maxz) / 2;
    vb.blk(minx, maxx, -1.92, -1.42, minz, maxz, C(0x2e4038));
  }

  /* ---- 4. bank, silt rim, reeds ---------------------------------------- */
  const isWater = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? 0 : terrain.water[j * GW + i];
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      if (isWater(i, j)) continue;
      let near = 0;
      if (isWater(i + 1, j)) near |= 1;
      if (isWater(i - 1, j)) near |= 2;
      if (isWater(i, j + 1)) near |= 4;
      if (isWater(i, j - 1)) near |= 8;
      if (!near) continue;
      const x = W.ox + i + 0.5, z = W.oz + j + 0.5;
      const r = rnd();
      /* two-step bank: wet silt at the waterline, dry earth behind it, so the
         shore reads as a shore from the air */
      vb.blk(x - 0.5, x + 0.5, -1.9, 0.055 + r * 0.03, z - 0.5, z + 0.5,
        jitC(mixC(C(0xa8a580), asCol(P.mud), 0.35), 0.05));
      vb.blk(x - 0.62, x + 0.62, -1.9, 0.02, z - 0.62, z + 0.62,
        jitC(mixC(asCol(P.earth), asCol(P.mud), 0.55), 0.04));
      /* reeds and scrub on the wet margin */
      if (r < 0.42) {
        const n = 2 + ((rng() * 3) | 0);
        for (let q = 0; q < n; q++) {
          const ox = rr(-0.36, 0.36), oz = rr(-0.36, 0.36);
          const hgt = rr(0.35, 0.95);
          vb.blk(x + ox - 0.09, x + ox + 0.09, 0.10, 0.10 + hgt, z + oz - 0.09, z + oz + 0.09,
            jitC(pick(P.reed), 0.10));
        }
      } else if (r < 0.5) {
        vb.blk(x - 0.3, x + 0.3, 0.1, 0.55, z - 0.3, z + 0.3, jitC(pick(P.grassDk), 0.1));
      }
      if (terrain.shore.length < 4000) terrain.shore.push([x, z, near]);
    }
  }
}

/* ---------------------------------------------------------------------------
   LAKE MASK — a blurred occupancy texture of the lake, handed to the water
   shader so it can grow silt, weed and a foam band along the real shoreline
   instead of an invented one.
   ------------------------------------------------------------------------- */
function buildWaterMask() {
  const GW = W.w, GH = W.h;
  const src = document.createElement('canvas');
  src.width = GW; src.height = GH;
  const sctx = src.getContext('2d');
  const img = sctx.createImageData(GW, GH);
  const wet = new Float32Array(GW * GH);
  for (let k = 0; k < BGEO.ground.length; k++) {
    const g = BGEO.ground[k];
    if (g[4] !== 4) continue;
    for (let j = g[1]; j < g[1] + g[3]; j++)
      for (let i = g[0]; i < g[0] + g[2]; i++)
        if (i >= 0 && j >= 0 && i < GW && j < GH) wet[j * GW + i] = 255;
  }
  /* separable box blur, O(n) per pass with a running sum — the shoreline
     gradient is what the water shader reads for silt, weed and foam */
  const R = 6;
  const tmp = new Float32Array(GW * GH);
  const blurred = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    let sum = 0;
    const row = j * GW;
    for (let i = -R; i <= R; i++) sum += wet[row + clamp(i, 0, GW - 1)];
    for (let i = 0; i < GW; i++) {
      tmp[row + i] = sum / (2 * R + 1);
      sum -= wet[row + clamp(i - R, 0, GW - 1)];
      sum += wet[row + clamp(i + R + 1, 0, GW - 1)];
    }
  }
  for (let i = 0; i < GW; i++) {
    let sum = 0;
    for (let j = -R; j <= R; j++) sum += tmp[clamp(j, 0, GH - 1) * GW + i];
    for (let j = 0; j < GH; j++) {
      blurred[j * GW + i] = sum / (2 * R + 1);
      sum -= tmp[clamp(j - R, 0, GH - 1) * GW + i];
      sum += tmp[clamp(j + R + 1, 0, GH - 1) * GW + i];
    }
  }
  for (let k = 0; k < wet.length; k++) {
    const v = blurred[k];
    img.data[k * 4 + 0] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(src);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  waterU.uMask.value = tex;
  waterU.uBox.value.set(W.ox, W.oz, GW, GH);
  return tex;
}
