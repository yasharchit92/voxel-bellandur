#!/usr/bin/env python3
"""
Stage 4 — automated geographic assertions.

Runs against the built artifacts (data/bellandur.geo.js + data/raw) and fails
loudly if the diorama has drifted away from its source.  Everything here is a
check on geometry, not on taste:

  1. projection        WGS84 -> UTM 43N round-trip and central-meridian control
  2. frame             every emitted vertex lies inside the declared extent
  3. lake faithfulness rasterised water vs. the OSM lake relation (IoU)
  4. road/building     footprints must not sit on asphalt
  5. labels            every named label sits inside its own OSM polygon
  6. heights           no invented storey counts beyond the documented cap
"""
import gzip, json, math, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
GEO = os.path.join(ROOT, "data", "bellandur.geo.js")
RAW = os.path.join(ROOT, "data", "raw", "bellandur.json.gz")

fails, warns = [], []
def check(ok, msg, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + msg + (("   [" + detail + "]") if detail else ""))
    if not ok:
        fails.append(msg)
def warn(ok, msg, detail=""):
    print(("  PASS  " if ok else "  WARN  ") + msg + (("   [" + detail + "]") if detail else ""))
    if not ok:
        warns.append(msg)

B = json.loads(open(GEO).read().split("var BGEO=", 1)[1].rstrip().rstrip(";"))
M = B["meta"]
UNIT = M["unit"]
GW, GH = M["grid"]
OX, OZ = M["local"]["x"][0], M["local"]["z"][0]

# ---------------------------------------------------------------- 1 projection
print("\n1. projection (EPSG:32643 / UTM zone 43N)")
def utm(lon, lat, zone=43):
    a, f = 6378137.0, 1 / 298.257223563
    k0, FE = 0.9996, 500000.0
    e2 = 2 * f - f * f
    ep2 = e2 / (1 - e2)
    lam0 = math.radians((zone - 1) * 6 - 180 + 3)
    lam, phi = math.radians(lon), math.radians(lat)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T = math.tan(phi) ** 2
    C = ep2 * math.cos(phi) ** 2
    A = math.cos(phi) * (lam - lam0)
    e4, e6 = e2 * e2, e2 ** 3
    Mv = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
              - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
              + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
              - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + FE
    y = k0 * (Mv + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
             + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y
E, Nn = utm(75.0, 12.9305)                        # on the central meridian
check(abs(E - 500000.0) < 0.01, "central meridian maps to easting 500000", "%.3f" % E)
E2, N2 = utm(77.6805, M["origin"]["lat"])
check(abs(E2 - M["origin"]["utm43n"][0]) < 0.01 and abs(N2 - M["origin"]["utm43n"][1]) < 0.01,
      "origin easting/northing recompute", "%.2f, %.2f" % (E2, N2))
check(700000 < M["origin"]["utm43n"][0] < 900000 and 1200000 < M["origin"]["utm43n"][1] < 1600000,
      "origin inside UTM 43N band (southern India)")

# ---------------------------------------------------------------- 2 frame
print("\n2. frame containment")
bad = 0
for ring in B["water"]:
    for x, z in ring:
        if not (OX - 1 <= x <= OX + GW + 1 and OZ - 1 <= z <= OZ + GH + 1):
            bad += 1
for r in B["roads"]:
    for i in r[4]:
        x, z = B["rnodes"][i]
        if not (OX - 1 <= x <= OX + GW + 1 and OZ - 1 <= z <= OZ + GH + 1):
            bad += 1
check(bad == 0, "all water/road vertices inside the frame", "%d escaped" % bad)
n_out = sum(1 for b in B["buildings"] for rc in b[0]
            if not (0 <= rc[0] and 0 <= rc[1] and rc[0] + rc[2] <= GW and rc[1] + rc[3] <= GH))
check(n_out == 0, "all building rects inside the grid", "%d escaped" % n_out)

# ---------------------------------------------------------------- 3 lake IoU
print("\n3. lake faithfulness vs. the OSM relation (19751547)")
cls = bytearray(GW * GH)
for i, j, w, d, c in B["ground"]:
    for jj in range(j, min(GH, j + d)):
        row = jj * GW
        for ii in range(i, min(GW, i + w)):
            cls[row + ii] = c
water_built = bytearray(1 if c == 4 else 0 for c in cls)

raw = json.load(gzip.open(RAW, "rt"))
RN, RW, RR = raw["nodes"], raw["ways"], raw["relations"]
X0, Y0 = M["origin"]["utm43n"]
def to_grid(lon, lat):
    e, n = utm(lon, lat)
    return ((e - X0) / UNIT - OX, -(n - Y0) / UNIT - OZ)
lake = bytearray(GW * GH)
# the lake's western basins lie outside the merge bbox, so the relation was
# also fetched whole into data/raw/lake_relation_19751547.osm
import xml.etree.ElementTree as ET
LR = ET.parse(os.path.join(ROOT, "data", "raw", "lake_relation_19751547.osm")).getroot()
LN = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in LR.findall("node")}
LW = {w.get("id"): [nd.get("ref") for nd in w.findall("nd")] for w in LR.findall("way")}
ways = [m.get("ref") for m in LR.find("relation").findall("member") if m.get("type") == "way"]
for wid in ways:
    ring = [to_grid(*LN[r]) for r in LW[wid] if r in LN]
    if len(ring) < 3:
        continue
    zs = [p[1] for p in ring]
    if min(zs) > OZ + GH or max(zs) < OZ:
        continue
    j0 = max(0, int(min(zs))); j1 = min(GH - 1, int(max(zs)) + 1)
    nn = len(ring)
    for j in range(j0, j1 + 1):
        zc = j + 0.5
        xs = []
        for k in range(nn):
            ax, az = ring[k]; bx, bz = ring[(k + 1) % nn]
            if (az <= zc < bz) or (bz <= zc < az):
                xs.append(ax + (zc - az) * (bx - ax) / (bz - az))
        xs.sort()
        for s in range(0, len(xs) - 1, 2):
            i0 = max(0, int(math.ceil(xs[s] - 0.5))); i1 = min(GW - 1, int(math.floor(xs[s + 1] - 0.5)))
            for i in range(i0, i1 + 1):
                lake[j * GW + i] = 1
inter = sum(1 for a, b in zip(water_built, lake) if a and b)
union = sum(1 for a, b in zip(water_built, lake) if a or b)
iou = inter / union if union else 0
check(iou >= 0.80, "lake IoU vs. OSM outline >= 0.80", "IoU=%.3f (inter %d, union %d)" % (iou, inter, union))
check(sum(water_built) > 15000, "lake present at city scale", "%d water cells = %.2f km2"
      % (sum(water_built), sum(water_built) * UNIT * UNIT / 1e6))

# ---------------------------------------------------------------- 4 road/building
print("\n4. buildings do not sit on asphalt")
hits, cells = 0, 0
for b in B["buildings"]:
    for rc in b[0]:
        # sample the centre cell of each rect (rects are cell-aligned)
        i, j = rc[0] + rc[2] // 2, rc[1] + rc[3] // 2
        if 0 <= i < GW and 0 <= j < GH:
            cells += 1
            if cls[j * GW + i] in (2, 3):
                hits += 1
pct = 100.0 * hits / max(1, cells)
check(hits == 0, "no building footprint centre on asphalt/footway", "%d/%d (%.2f%%)" % (hits, cells, pct))

# ---------------------------------------------------------------- 5 labels
print("\n5. labels sit inside their own OSM polygon")
def in_ring(x, z, ring):
    ins = False
    for k in range(len(ring)):
        ax, az = ring[k]; bx, bz = ring[(k + 1) % len(ring)]
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            ins = not ins
    return ins
site_by_name = {}
for ring, kind, name in B["sites"]:
    if name:
        site_by_name.setdefault(name, []).append(ring)
checked = inside = 0
far = []
for l in B["labels"]:
    x, z, name, kind = l[0], l[1], l[2], l[3]
    if kind != "area" or name not in site_by_name:
        continue
    checked += 1
    if any(in_ring(x, z, ring) for ring in site_by_name[name]):
        inside += 1
    else:
        far.append(name)
check(checked > 0 and inside == checked,
      "every campus/park label falls inside its polygon", "%d/%d" % (inside, checked))
if far:
    print("        outside:", ", ".join(far[:6]))

# ---------------------------------------------------------------- 6 heights
print("\n6. heights within the documented envelope")
lv = [b[1] for b in B["buildings"]]
check(max(lv) <= 46, "no building exceeds the 46-storey cap", "max=%s" % max(lv))
check(min(lv) >= 1, "no zero-height buildings", "min=%s" % min(lv))
print("        storeys: median %s, 90th pct %s, max %s"
      % (sorted(lv)[len(lv) // 2], sorted(lv)[int(len(lv) * 0.9)], max(lv)))

# ---------------------------------------------------------------- summary
print("\n---- summary ----")
print("  buildings %d | roads %d | road nodes %d | ground rects %d | labels %d | sites %d"
      % (len(B["buildings"]), len(B["roads"]), len(B["rnodes"]), len(B["ground"]),
         len(B["labels"]), len(B["sites"])))
print("  extent %.2f x %.2f km, 1 voxel = %.0f m, UTM 43N origin %.2f E / %.2f N"
      % (GW * UNIT / 1000, GH * UNIT / 1000, UNIT, X0, Y0))
if fails:
    print("\nFAILED %d check(s): %s" % (len(fails), "; ".join(fails)))
    sys.exit(1)
print("\nAll geographic assertions passed." + ("  (%d warnings)" % len(warns) if warns else ""))
