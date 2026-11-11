/* ============================================================================
   BUILDINGS — 4,222 OSM footprints, extruded and dressed
   ----------------------------------------------------------------------------
   Every footprint is real.  Height comes from building:levels where OSM has it
   and from a footprint-area estimate where it does not (both documented in the
   README).  What we *add* is building type: apartment towers with balcony bands
   and rooftop tanks, glass office slabs with spandrel bands and a crown, shop
   rows with awnings, sheds, temples, and sites that OSM marks as under
   construction (concrete frame + scaffolding, never finished-looking).
   ============================================================================ */

const FLOOR = 0.78;                 /* 3.1 m floor at 4 m per voxel unit */
const TANK_C = [C(0x33333a), C(0x3d3d44), C(0x2a2a30)];
const SOLAR_C = [C(0x2b3a52), C(0x344463)];
const buildingStats = { tall: 0, tanks: 0, glow: 0 };

/* footprint of a rect, with a small inset so neighbours never fuse visually */
function foot(r) {
  const i = r[0], j = r[1], w = r[2], d = r[3];
  const ins = (w <= 2 && d <= 2) ? 0.10 : 0.16;
  return [W.ox + i + ins, W.ox + i + w - ins, W.oz + j + ins, W.oz + j + d - ins, w, d];
}

function wallPalette(cls, lv) {
  switch (cls) {
    case 1: return chance(0.55) ? P.wallWarm : chance(0.5) ? P.wallPink : P.wallYellow;
    case 2: return chance(0.5) ? P.glass : chance(0.45) ? P.glassGreen : chance(0.5) ? P.wallPale : P.white;
    case 3: return P.white;
    case 4: return chance(0.5) ? P.concrete : P.wallWarm;
    case 5: return chance(0.5) ? P.wallPale : P.wallPink;
    case 6: return P.white;
    case 7: return P.concrete;
    case 8: return chance(0.5) ? C(0xcfb391) : C(0xc09a72);
    case 9: return P.concreteDk;
    case 10: return P.concrete;
    default: return lv > 3 ? P.wallWarm : chance(0.5) ? P.wallPale : P.wallPink;
  }
}

/* ------------------------------------------------------------ roof clutter */
function roofKit(x0, x1, z0, z1, y, w, d, big) {
  const area = (x1 - x0) * (z1 - z0);
  if (area < 0.55) return;
  const n = area > 9 ? 3 : area > 3.5 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const tx = rr(x0 + 0.45, x1 - 0.45), tz = rr(z0 + 0.45, z1 - 0.45);
    if (chance(0.62)) {
      /* black Sintex-style tank on a stub */
      const s = rr(0.30, 0.46);
      vb.blk(tx - s / 2, tx + s / 2, y + 0.14, y + 0.20, tz - s / 2, tz + s / 2, asCol(P.steel));
      vb.blk(tx - s / 2, tx + s / 2, y + 0.20, y + 0.20 + s * 1.15, tz - s / 2, tz + s / 2, jitC(TANK_C, 0.12));
      buildingStats.tanks++;
    } else if (chance(0.5) && big) {
      /* solar array */
      const sw = 0.5, sd = 0.36;
      vb.blk(tx - sw / 2, tx + sw / 2, y + 0.14, y + 0.2, tz - sd / 2, tz + sd / 2, asCol(P.steel));
      vb.blk(tx - sw / 2, tx + sw / 2, y + 0.2, y + 0.26, tz - sd / 2, tz + sd / 2, jitC(SOLAR_C, 0.1));
    } else if (chance(0.45)) {
      /* stair head / lift machine room */
      const s = rr(0.4, 0.7);
      vb.blk(tx - s / 2, tx + s / 2, y + 0.12, y + 0.12 + s * 0.9, tz - s / 2, tz + s / 2,
        jitC(asCol(P.wallPale), 0.06));
    }
  }
  /* parapet ring */
  if (w >= 2 && d >= 2) {
    const t = 0.12, h = 0.2;
    vb.blk(x0, x1, y, y + h, z0, z0 + t, asCol(P.concreteDk));
    vb.blk(x0, x1, y, y + h, z1 - t, z1, asCol(P.concreteDk));
    vb.blk(x0, x0 + t, y, y + h, z0 + t, z1 - t, asCol(P.concreteDk));
    vb.blk(x1 - t, x1, y, y + h, z0 + t, z1 - t, asCol(P.concreteDk));
  }
}

/* ------------------------------------------------------- apartment towers */
function apartmentBlock(x0, x1, z0, z1, H, wall) {
  const w = x1 - x0, d = z1 - z0;
  const floors = Math.max(1, Math.round(H / FLOOR));
  /* mass, in vertical chunks so the facade can carry a two-tone rhythm */
  const chunk = Math.min(6, floors);
  for (let f = 0; f < floors; f += chunk) {
    const f1 = Math.min(floors, f + chunk);
    const t = f / Math.max(1, floors);
    const col = mixC(asCol(wall), shadeC(asCol(wall), 0.88), (f / chunk) % 2 ? 0.55 : 0.0);
    vb.blk(x0, x1, f * FLOOR, f1 * FLOOR, z0, z1, jitC(col, 0.02));
    /* balcony ledges on the two long faces */
    if (f1 * FLOOR < H - 0.1) {
      const rail = chance(0.5) ? asCol(P.white) : shadeC(asCol(wall), 0.8);
      if (d < w) {
        vb.blk(x0, x1, f1 * FLOOR, f1 * FLOOR + 0.07, z0 - 0.14, z1 + 0.14, rail);
      } else {
        vb.blk(x0 - 0.14, x1 + 0.14, f1 * FLOOR, f1 * FLOOR + 0.07, z0, z1, rail);
      }
    }
    /* lit window band */
    if (floors >= 3) {
      const y = f * FLOOR + 0.12, y2 = y + FLOOR * 0.66;
      const wc = chance(0.35) ? P.glowWarm : P.glowCool;
      if (d < w) {
        vg.blk(x0 + 0.1, x1 - 0.1, y, y2, z0 - 0.07, z0, asCol(wc));
        vg.blk(x0 + 0.1, x1 - 0.1, y, y2, z1, z1 + 0.07, asCol(wc));
      } else {
        vg.blk(x0 - 0.07, x0, y, y2, z0 + 0.1, z1 - 0.1, asCol(wc));
        vg.blk(x1, x1 + 0.07, y, y2, z0 + 0.1, z1 - 0.1, asCol(wc));
      }
      buildingStats.glow++;
    }
  }
  /* set-back crown for towers */
  if (H > 5.5) {
    const s = 0.32;
    vb.blk(x0 + s, x1 - s, H, H + 0.55, z0 + s, z1 - s, jitC(asCol(P.concrete), 0.04));
  }
  roofKit(x0, x1, z0, z1, H, w, d, true);
}

/* --------------------------------------------------------- glass / office */
function officeBlock(x0, x1, z0, z1, H, wall) {
  const w = x1 - x0, d = z1 - z0;
  const floors = Math.max(1, Math.round(H / FLOOR));
  /* three campus treatments so a tech park does not read as one building
     repeated: ribbon-window glass, punched stone, and horizontal bands */
  const style = chance(0.45) ? 0 : chance(0.55) ? 1 : 2;
  const glass = style === 0 ? (chance(0.5) ? P.glass : P.glassGreen)
    : style === 1 ? (chance(0.6) ? P.wallPale : P.white) : P.glassDk;
  vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(glass), 0.02));
  if (style === 1) {
    /* punched windows on a stone slab: vertical bays, not bands */
    const bays = Math.max(2, Math.round((x1 - x0) / 0.9));
    for (let b = 1; b < bays; b++) {
      const bx = lerp(x0, x1, b / bays);
      vb.blk(bx - 0.06, bx + 0.06, 0, H, z0 - 0.04, z0, asCol(P.glass));
      vb.blk(bx - 0.06, bx + 0.06, 0, H, z1, z1 + 0.04, asCol(P.glass));
    }
  }
  const bandCol = style === 2 ? asCol(P.concrete) : asCol(P.white);
  const bandStep = Math.max(1, Math.round((style === 2 ? 2.6 : 2.0) / FLOOR));
  for (let f = 0; f < floors; f += bandStep) {
    const y = f * FLOOR;
    vb.blk(x0 - 0.05, x1 + 0.05, y, y + 0.17, z0 - 0.05, z0, bandCol);
    vb.blk(x0 - 0.05, x1 + 0.05, y, y + 0.17, z1, z1 + 0.05, bandCol);
    vb.blk(x0 - 0.05, x0, y, y + 0.17, z0, z1, bandCol);
    vb.blk(x1, x1 + 0.05, y, y + 0.17, z0, z1, bandCol);
    /* interior light line at floor level */
    if (floors >= 4 && chance(0.85)) {
      vg.blk(x0 + 0.05, x1 - 0.05, y + 0.19, y + FLOOR * 0.78, z0 - 0.06, z0, asCol(P.glowCool));
      vg.blk(x0 + 0.05, x1 - 0.05, y + 0.19, y + FLOOR * 0.78, z1, z1 + 0.06, asCol(P.glowCool));
      buildingStats.glow++;
    }
  }
  /* crown + rooftop plant */
  if (H > 2.2) {
    vb.blk(x0 - 0.09, x1 + 0.09, H, H + 0.13, z0 - 0.09, z1 + 0.09, asCol(P.concrete));
    roofKit(x0, x1, z0, z1, H + 0.13, w, d, true);
  } else {
    roofKit(x0, x1, z0, z1, H, w, d, false);
  }
  /* entrance canopy facing the long side */
  if (chance(0.5) && d < 6) {
    vb.blk((x0 + x1) / 2 - 0.7, (x0 + x1) / 2 + 0.7, 0, 0.14, z0 - 0.55, z0, asCol(P.concreteDk));
  }
}

/* --------------------------------------------------------- shops + houses */
function shopBlock(x0, x1, z0, z1, H, wall) {
  vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(wall), 0.03));
  /* shopfront: lit glazing + a fabric awning over the pavement */
  const long = (x1 - x0) >= (z1 - z0);
  if (long) {
    vg.blk(x0 + 0.1, x1 - 0.1, 0.06, 0.42, z0 - 0.02, z0, asCol(chance(0.5) ? P.glowWarm : P.glowCool));
    vb.blk(x0 + 0.05, x1 - 0.05, 0.5, 0.58, z0 - 0.42, z0, jitC(pick([C(0xd8b25a), C(0xc25a48), C(0x4a7f6a), C(0xcfcfc4)]), 0.05));
  } else {
    vg.blk(x0 - 0.02, x0, 0.06, 0.42, z0 + 0.1, z1 - 0.1, asCol(P.glowWarm));
    vb.blk(x0 - 0.42, x0, 0.5, 0.58, z0 + 0.05, z1 - 0.05, jitC(C(0xd8b25a), 0.05));
  }
  roofKit(x0, x1, z0, z1, H, x1 - x0, z1 - z0, false);
}

function houseBlock(x0, x1, z0, z1, H, wall) {
  vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(wall), 0.035));
  const w = x1 - x0, d = z1 - z0;
  /* terrace / tiled roof lip */
  const roofCol = chance(0.38) ? P.roofTile : chance(0.62) ? P.roof : P.concreteDk;
  vb.blk(x0 - 0.07, x1 + 0.07, H, H + 0.13, z0 - 0.07, z1 + 0.07, jitC(asCol(roofCol), 0.05));
  if (w * d > 2.2 && chance(0.5)) roofKit(x0, x1, z0, z1, H + 0.13, w, d, false);
  else if (chance(0.4)) {
    /* single tank on the parapet */
    const tx = rr(x0 + 0.4, x1 - 0.4), tz = rr(z0 + 0.4, z1 - 0.4), s = rr(0.24, 0.34);
    vb.blk(tx - s / 2, tx + s / 2, H + 0.13, H + 0.13 + s, tz - s / 2, tz + s / 2, jitC(TANK_C, 0.1));
    buildingStats.tanks++;
  }
  /* one warm window */
  if (chance(0.55) && H > 1.2) {
    const y = rr(0.55, Math.max(0.6, H - 0.35));
    if (w >= d) vg.blk(x0 + 0.2, x1 - 0.2, y, y + 0.26, z0 - 0.02, z0, asCol(P.glowWarm));
    else vg.blk(x0 - 0.02, x0, y, y + 0.26, z0 + 0.2, z1 - 0.2, asCol(P.glowWarm));
  }
}

/* ------------------------------------------------------ under construction */
function constructionBlock(x0, x1, z0, z1, H, wall) {
  const w = x1 - x0, d = z1 - z0;
  const floors = Math.max(1, Math.round(H / FLOOR));
  /* concrete frame: floors with open gaps between slabs */
  for (let f = 0; f < floors; f++) {
    const y = f * FLOOR;
    vb.blk(x0, x1, y, y + 0.1, z0, z1, jitC(asCol(P.concreteDk), 0.04));
    if (f < floors - 1) {
      for (let c = 0; c < 4; c++) {
        const t = c / 3;
        vb.blk(lerp(x0, x1, t), lerp(x0, x1, t) + 0.1, y, y + FLOOR, z0, z0 + 0.1, asCol(P.concrete));
        vb.blk(lerp(x0, x1, t), lerp(x0, x1, t) + 0.1, y, y + FLOOR, z1 - 0.1, z1, asCol(P.concrete));
      }
    }
  }
  /* orange scaffold cage on one face */
  if (chance(0.7)) {
    const xs = x0;
    for (let f = 0; f <= floors; f++)
      vb.blk(xs - 0.12, xs, f * FLOOR, f * FLOOR + 0.06, z0, z1, asCol(P.orange));
    for (let zz = z0; zz <= z1; zz += 0.7)
      vb.blk(xs - 0.1, xs, 0, H, zz - 0.04, zz + 0.04, asCol(P.scaffold));
  }
  if (chance(0.4)) vb.blk(x0 + w * 0.2, x1 - w * 0.2, 0, H * 0.8, z0 + d * 0.2, z1 - d * 0.2, asCol(P.tarp));
  /* tower crane on the big sites */
  if (w * d > 14 && chance(0.55)) {
    const mx = (x0 + x1) / 2 + w * 0.35, mz = (z0 + z1) / 2;
    const mh = H + rr(2.5, 5.0);
    vb.blk(mx - 0.1, mx + 0.1, 0, mh, mz - 0.1, mz + 0.1, asCol(P.orange));
    vb.blk(mx - 4.2, mx + 2.2, mh - 0.22, mh, mz - 0.09, mz + 0.09, asCol(P.orange));
    vb.blk(mx - 4.2, mx - 4.0, mh - 0.9, mh, mz - 0.08, mz + 0.08, asCol(P.steel));
  }
}

/* --------------------------------------------------------------- temples */
function templeBlock(x0, x1, z0, z1, H, wall) {
  vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(wall), 0.03));
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const s = Math.min(x1 - x0, z1 - z0) * 0.42;
  vb.blk(mx - s / 2, mx + s / 2, H, H + 0.75, mz - s / 2, mz + s / 2, jitC(asCol(P.wallOchre), 0.03));
  vb.blk(mx - 0.06, mx + 0.06, H + 0.75, H + 0.95, mz - 0.06, mz + 0.06, asCol(C(0xd8b455)));
  vb.blk(x0, x1, H, H + 0.1, z0, z1, asCol(P.roofTile));
}

/* ------------------------------------------------------------------ main */
function buildCity() {
  const bs = BGEO.buildings;
  terrain.built = new Uint8Array(W.w * W.h);
  for (let k = 0; k < bs.length; k++) {
    const rs = bs[k][0];
    for (let r = 0; r < rs.length; r++) {
      const rc = rs[r];
      for (let j = rc[1]; j < rc[1] + rc[3]; j++)
        for (let i = rc[0]; i < rc[0] + rc[2]; i++)
          if (i >= 0 && j >= 0 && i < W.w && j < W.h) terrain.built[j * W.w + i] = 1;
    }
  }
  for (let k = 0; k < bs.length; k++) {
    const b = bs[k];
    const rects = b[0], lv = b[1], cls = b[2], ucn = b[3], nm = b[4];
    let H = lv * FLOOR;
    if (H < 0.55) H = 0.55;
    if (H > 19) H = 19;
    const wall = wallPalette(cls, lv);
    for (let r = 0; r < rects.length; r++) {
      const f = foot(rects[r]);
      const x0 = f[0], x1 = f[1], z0 = f[2], z1 = f[3];
      if (x1 - x0 < 0.15 || z1 - z0 < 0.15) continue;
      if (ucn) { constructionBlock(x0, x1, z0, z1, H, wall); continue; }
      switch (cls) {
        case 1: apartmentBlock(x0, x1, z0, z1, H, wall); break;
        case 2: officeBlock(x0, x1, z0, z1, H, wall); break;
        case 4: shopBlock(x0, x1, z0, z1, H, wall); break;
        case 8: templeBlock(x0, x1, z0, z1, H, wall); break;
        case 5: case 6: case 3:
          vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(wall), 0.03));
          roofKit(x0, x1, z0, z1, H, x1 - x0, z1 - z0, true);
          break;
        case 7: case 10:
          vb.blk(x0, x1, 0, H, z0, z1, jitC(asCol(P.concrete), 0.03));
          vb.blk(x0 - 0.06, x1 + 0.06, H, H + 0.08, z0 - 0.06, z1 + 0.06, jitC(asCol(P.roofBlue), 0.05));
          break;
        default: houseBlock(x0, x1, z0, z1, H, wall); break;
      }
      if (H > 5.5) buildingStats.tall++;
    }
  }
}
