#!/usr/bin/env python3
"""
Stage 2 — projection, classification, rasterisation.

Turns the raw OSM extract into the compact geometry bundle the renderer
consumes.  Nothing here is invented: every polygon, centreline and label is
derived from an OSM element in data/raw/bellandur.json.gz.

  lon/lat  ->  WGS84 -> UTM zone 43N (EPSG:32643) -> local metres -> voxel units

Ground layers (water / asphalt / footway / landuse / parking ...) are
rasterised onto one shared grid and greedy-merged into rectangles, so the
renderer draws the whole ground plane with a few thousand instanced quads
instead of ~half a million voxels.  Buildings keep their own footprints and
are extruded by the renderer from a levels estimate.

Output: data/bellandur.geo.js  (var BGEO = {...};)
"""
import gzip, json, math, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "bellandur.json.gz")
OUT = os.path.join(ROOT, "data", "bellandur.geo.js")

UNIT = 4.0                      # metres per voxel unit  (documented in README)
EXTENT = dict(lon0=77.6655, lon1=77.6955, lat0=12.9175, lat1=12.9435)

# ---------------------------------------------------------------- projection
def utm_forward(lon, lat, zone=43):
    """KRUEGER series, WGS84 -> UTM (mm accuracy).  epsg:32643."""
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
    # meridional arc
    e4, e6 = e2 * e2, e2 * e2 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
             - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
             + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
             - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6
                  + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + FE
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
             + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y

# local frame: X = east, Z = south (Three.js), origin = extent centre
_C = dict(lon=(EXTENT["lon0"] + EXTENT["lon1"]) / 2, lat=(EXTENT["lat0"] + EXTENT["lat1"]) / 2)
X0, Y0 = utm_forward(_C["lon"], _C["lat"])
# extent in local metres (axis-aligned in UTM)
_ex = [utm_forward(EXTENT["lon0"], _C["lat"])[0], utm_forward(EXTENT["lon1"], _C["lat"])[0]]
_ey = [utm_forward(_C["lon"], EXTENT["lat0"])[1], utm_forward(_C["lon"], EXTENT["lat1"])[1]]
LX0, LX1 = _ex[0] - X0, _ex[1] - X0
LZ0, LZ1 = -( _ey[1] - Y0), -( _ey[0] - Y0)     # z = -(northing - Y0): north is -z
GW = int(math.ceil((LX1 - LX0) / UNIT))          # grid dims
GH = int(math.ceil((LZ1 - LZ0) / UNIT))

def xy(lon, lat):
    """lon/lat -> local METRES (X east, Z south, origin = extent centre).

    All internal geometry (clipping, rasterising, simplification) works in
    metres; coordinates are divided by UNIT only when written to the bundle.
    """
    e, n = utm_forward(lon, lat)
    return e - X0, -(n - Y0)

def vu(x, z):
    """metres -> voxel units, rounded for the bundle."""
    return [round(x / UNIT, 1), round(z / UNIT, 1)]

# ---------------------------------------------------------------- geometry
def dp(pts, eps):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    a, b = np.asarray(pts[0]), np.asarray(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    P = np.asarray(pts)
    if L < 1e-9:
        d = np.hypot(*(P - a).T)
    else:
        d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] > eps:
        return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
    return [pts[0], pts[-1]]

def simplify_ring(pts, eps):
    if len(pts) < 5:
        return pts
    half = len(pts) // 2
    a = dp(pts[:half + 1], eps)
    b = dp(pts[half:] + [pts[0]], eps)
    return a[:-1] + b[:-1]

def clip_poly(pts, x0, z0, x1, z1):
    """Sutherland-Hodgman against an axis-aligned rectangle."""
    def clip_edge(poly, inside, isect):
        out = []
        for i in range(len(poly)):
            cur, prv = poly[i], poly[i - 1]
            if inside(cur):
                if not inside(prv):
                    out.append(isect(prv, cur))
                out.append(cur)
            elif inside(prv):
                out.append(isect(prv, cur))
        return out
    def xin(p): return p[0] >= x0
    def xax(p): return p[0] <= x1
    def zin(p): return p[1] >= z0
    def zax(p): return p[1] <= z1
    def ix(p, q):
        t = (x0 - p[0]) / (q[0] - p[0]); return (x0, p[1] + t * (q[1] - p[1]))
    def ix2(p, q):
        t = (x1 - p[0]) / (q[0] - p[0]); return (x1, p[1] + t * (q[1] - p[1]))
    def iz(p, q):
        t = (z0 - p[1]) / (q[1] - p[1]); return (p[0] + t * (q[0] - p[0]), z0)
    def iz2(p, q):
        t = (z1 - p[1]) / (q[1] - p[1]); return (p[0] + t * (q[0] - p[0]), z1)
    p = list(pts)
    for inside, isect in ((xin, ix), (xax, ix2), (zin, iz), (zax, iz2)):
        if not p:
            return []
        p = clip_edge(p, inside, isect)
    return p

def ring_area(pts):
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2

def clean_ring(pts):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > 1e-6 or abs(p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    while len(out) > 1 and abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out

# ---------------------------------------------------------------- raster
class Grid:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = np.zeros((h, w), np.uint8)
        self.prio = np.zeros((h, w), np.uint8)
    def fill(self, ring, cls, prio):
        """scanline-fill a world-unit polygon into the cell grid."""
        if len(ring) < 3:
            return 0
        xs = [p[0] for p in ring]; zs = [p[1] for p in ring]
        ci0 = max(0, int(math.floor((min(xs) - LX0) / UNIT)))
        ci1 = min(self.w - 1, int(math.ceil((max(xs) - LX0) / UNIT)))
        cj0 = max(0, int(math.floor((min(zs) - LZ0) / UNIT)))
        cj1 = min(self.h - 1, int(math.ceil((max(zs) - LZ0) / UNIT)))
        if ci1 < ci0 or cj1 < cj0:
            return 0
        n = len(ring)
        edges = [(ring[i], ring[(i + 1) % n]) for i in range(n)]
        cnt = 0
        for j in range(cj0, cj1 + 1):
            zc = LZ0 + (j + 0.5) * UNIT
            xs_hit = []
            for (ax, az), (bx, bz) in edges:
                if (az <= zc < bz) or (bz <= zc < az):
                    xs_hit.append(ax + (zc - az) * (bx - ax) / (bz - az))
            if len(xs_hit) < 2:
                continue
            xs_hit.sort()
            for k in range(0, len(xs_hit) - 1, 2):
                i0 = int(math.ceil((xs_hit[k] - LX0) / UNIT - 0.5))
                i1 = int(math.floor((xs_hit[k + 1] - LX0) / UNIT - 0.5))
                i0 = max(i0, ci0); i1 = min(i1, ci1)
                if i1 < i0:
                    continue
                sl = self.prio[j, i0:i1 + 1]
                m = sl <= prio
                sub = self.g[j, i0:i1 + 1]
                sub[m] = cls
                sub2 = self.prio[j, i0:i1 + 1]
                sub2[m] = prio
                cnt += int(m.sum())
        return cnt

    def corridor(self, pts, halfw, cls, prio):
        """paint the cells whose centre lies within `halfw` metres of the line"""
        hw = max(halfw, UNIT * 0.5)
        cnt = 0
        for i in range(len(pts) - 1):
            ax, az = pts[i]
            bx, bz = pts[i + 1]
            ci0 = max(0, int(math.floor((min(ax, bx) - hw - LX0) / UNIT)))
            ci1 = min(self.w - 1, int(math.ceil((max(ax, bx) + hw - LX0) / UNIT)))
            cj0 = max(0, int(math.floor((min(az, bz) - hw - LZ0) / UNIT)))
            cj1 = min(self.h - 1, int(math.ceil((max(az, bz) + hw - LZ0) / UNIT)))
            if ci1 < ci0 or cj1 < cj0:
                continue
            xs = LX0 + (np.arange(ci0, ci1 + 1) + 0.5) * UNIT
            zs = LZ0 + (np.arange(cj0, cj1 + 1) + 0.5) * UNIT
            X, Z = np.meshgrid(xs, zs)
            vx, vz = bx - ax, bz - az
            L2 = vx * vx + vz * vz
            if L2 < 1e-9:
                t = np.zeros_like(X)
            else:
                t = np.clip(((X - ax) * vx + (Z - az) * vz) / L2, 0.0, 1.0)
            d = np.hypot(X - (ax + t * vx), Z - (az + t * vz))
            m = d <= hw
            sub = self.g[cj0:cj1 + 1, ci0:ci1 + 1]
            pr = self.prio[cj0:cj1 + 1, ci0:ci1 + 1]
            upd = m & (pr <= prio)
            sub[upd] = cls
            pr[upd] = prio
            cnt += int(upd.sum())
        return cnt

    def brush(self, pts, width_cells, cls, prio):
        """stamp a polyline as a corridor of cells (roads, footways)."""
        cnt = 0
        for i in range(len(pts) - 1):
            (ax, az), (bx, bz) = pts[i], pts[i + 1]
            L = math.hypot(bx - ax, bz - az)
            steps = max(1, int(L / (UNIT * 0.4)))
            for s in range(steps + 1):
                t = s / steps
                x, z = ax + (bx - ax) * t, az + (bz - az) * t
                ci = int(math.floor((x - LX0) / UNIT)); cj = int(math.floor((z - LZ0) / UNIT))
                for dj in range(cj - width_cells, cj + width_cells + 1):
                    for di in range(ci - width_cells, ci + width_cells + 1):
                        if 0 <= di < self.w and 0 <= dj < self.h:
                            if self.prio[dj, di] <= prio:
                                self.g[dj, di] = cls
                                self.prio[dj, di] = prio
                                cnt += 1
        return cnt

    def merge(self):
        """greedy rectangle merge of equal-valued cells -> [i0,j0,w,h,cls]."""
        out = []
        used = np.zeros((self.h, self.w), bool)
        for j in range(self.h):
            i = 0
            row = self.g[j]
            while i < self.w:
                if used[j, i] or row[i] == 0:
                    i += 1
                    continue
                v = row[i]
                w = 1
                while i + w < self.w and row[i + w] == v and not used[j, i + w]:
                    w += 1
                h = 1
                while j + h < self.h:
                    nxt = self.g[j + h, i:i + w]
                    if (nxt != v).any() or used[j + h, i:i + w].any():
                        break
                    h += 1
                used[j:j + h, i:i + w] = True
                out.append([i, j, w, h, int(v)])
                i += w
        return out

# ---------------------------------------------------------------- load
d = json.load(gzip.open(RAW, "rt"))
N, W, R = d["nodes"], d["ways"], d["relations"]
TES = {t["k"]: t["v"] for t in ()}
def tags_of(tl): return {t["k"]: t["v"] for t in tl}
def nodes_of(wid):
    return [N[r] for r in W[wid][0] if r in N]
def pts_of(wid):
    return [xy(n[0], n[1]) for n in nodes_of(wid)]
def inside_ext(x, z, m=0.0):
    return LX0 - m <= x <= LX1 + m and LZ0 - m <= z <= LZ1 + m

# building type mapping -----------------------------------------------------
BT = {  # building tag -> class id
    "apartments": 1, "residential": 1, "dormitory": 1, "hotel": 3,
    "office": 2, "commercial": 2, "retail": 4, "supermarket": 4, "shop": 4,
    "school": 5, "college": 5, "university": 5, "kindergarten": 5,
    "hospital": 6, "clinic": 6,
    "industrial": 7, "warehouse": 7, "factory": 7,
    "temple": 8, "place_of_worship": 8, "mosque": 8, "church": 8, "shrine": 8,
    "construction": 9, "house": 0, "detached": 0, "terrace": 0, "yes": 0,
    "garage": 10, "garages": 10, "shed": 10, "roof": 10, "hut": 10,
    "service": 10, "toilets": 10, "guardhouse": 10, "parking": 10,
}
LEVELS_DEFAULT = {0: 2.2, 1: 4.0, 2: 5.0, 3: 5.0, 4: 2.5, 5: 3.0, 6: 4.0, 7: 2.0, 8: 2.0, 9: 4.0, 10: 1.0}

# ground class ids ----------------------------------------------------------
G_DEFAULT, G_ASPHALT, G_FOOT, G_WATER, G_GRASS, G_SCRUB, G_RESID, G_COMM, \
    G_IND, G_CONST, G_PARKING, G_PITCH, G_POOL, G_MUD = range(1, 15)
G_RAIL = 15

LAND = {  # (key, value) -> (class, priority)
    "landuse:residential": (G_RESID, 40), "landuse:commercial": (G_COMM, 45),
    "landuse:retail": (G_COMM, 45), "landuse:industrial": (G_IND, 45),
    "landuse:construction": (G_CONST, 50), "landuse:grass": (G_GRASS, 35),
    "landuse:meadow": (G_GRASS, 35), "landuse:forest": (G_GRASS, 35),
    "landuse:orchard": (G_GRASS, 35), "landuse:cemetery": (G_GRASS, 35),
    "landuse:railway": (G_SCRUB, 30), "landuse:quarry": (G_SCRUB, 30),
    "natural:scrub": (G_SCRUB, 25), "natural:wood": (G_GRASS, 35),
    "natural:sand": (G_MUD, 25), "natural:bare_rock": (G_SCRUB, 25),
    "natural:wetland": (G_MUD, 48), "natural:heath": (G_SCRUB, 25),
    "leisure:park": (G_GRASS, 38), "leisure:garden": (G_GRASS, 38),
    "leisure:playground": (G_PITCH, 42), "leisure:pitch": (G_PITCH, 42),
    "leisure:sports_centre": (G_PITCH, 42), "leisure:golf_course": (G_GRASS, 38),
    "leisure:swimming_pool": (G_POOL, 55), "leisure:park;garden": (G_GRASS, 38),
    "amenity:parking": (G_PARKING, 44), "amenity:school": (G_RESID, 30),
    "amenity:place_of_worship": (G_RESID, 30), "amenity:hospital": (G_RESID, 30),
    "landuse:village_green": (G_GRASS, 35),
}

# ---------------------------------------------------------------- collect
stats = {}
grid = Grid(GW, GH)
buildings = []
water_polys = []
roads = []          # dicts
rnodes = {}         # nid -> [x,z] index
labels = []
pois = []
metro = {"line": [], "stations": []}

# ---- water: the lake relation (outer rings) + every other water polygon
LAKE_REL = "19751547"
lake_rings = []
if LAKE_REL in R:
    for m in R[LAKE_REL][0]:
        if m.get("type") == "way" and m.get("role") in ("outer", ""):
            wid = m.get("ref")
            if wid in W:
                p = clean_ring(pts_of(wid))
                if len(p) >= 3 and any(inside_ext(*q, m=30) for q in p):
                    lake_rings.append(simplify_ring(p, 1.6))
stats["lake_rings"] = len(lake_rings)

other_water = []
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if t.get("natural") != "water":
        continue
    p = pts_of(wid)
    if len(p) < 3:
        continue
    p = clean_ring(p)
    if not any(inside_ext(*q, m=20) for q in p):
        continue
    a = ring_area(p)
    if a < 800:
        continue
    p = clip_poly(simplify_ring(p, 1.6), LX0, LZ0, LX1, LZ1)
    if len(p) >= 3 and ring_area(p) > 500:
        other_water.append((a, p, t.get("name")))
other_water.sort(reverse=True)
stats["water_polys"] = len(other_water) + len(lake_rings)

for r in lake_rings:
    p = clip_poly(r, LX0, LZ0, LX1, LZ1)
    if len(p) >= 3:
        water_polys.append(p)
        grid.fill(p, G_WATER, 100)
if LAKE_REL in R:
    rt = tags_of(R[LAKE_REL][2])
    if lake_rings:
        big = max(lake_rings, key=ring_area)
        c = (sum(q[0] for q in big) / len(big), sum(q[1] for q in big) / len(big))
        labels.append([*vu(*c), rt.get("name", ""), "water", 1, rt.get("name:kn", "")])

for a, p, nm in other_water:
    water_polys.append(p)
    grid.fill(p, G_WATER, 100)
    if nm:
        cx = sum(q[0] for q in p) / len(p); cz = sum(q[1] for q in p) / len(p)
        labels.append([*vu(cx, cz), nm, "water", 1])

# ---- landuse polygons (painted under roads)
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    key = None
    for k in ("landuse", "natural", "leisure", "amenity"):
        if k in t and (k + ":" + t[k]) in LAND:
            key = k + ":" + t[k]; break
    if not key:
        continue
    cls, prio = LAND[key]
    p = pts_of(wid)
    if len(p) < 3:
        continue
    p = clean_ring(p)
    if not any(inside_ext(*q, m=10) for q in p):
        continue
    p = clip_poly(simplify_ring(p, 2.0), LX0, LZ0, LX1, LZ1)
    if len(p) < 3 or ring_area(p) < 120:
        continue
    grid.fill(p, cls, prio)

# ---- roads
# highway -> (class, painted carriageway width m, paint priority)
# NB OSM maps divided roads as two separate one-way ways, so the width below is
# per carriageway, not the whole corridor.
HW = {
    "trunk": (1, 11.0, 90), "trunk_link": (1, 8.0, 88),
    "primary": (2, 10.0, 80), "primary_link": (2, 7.0, 78),
    "secondary": (3, 9.0, 70), "secondary_link": (3, 6.5, 68),
    "tertiary": (4, 8.0, 60), "tertiary_link": (4, 6.0, 58),
    "unclassified": (5, 6.0, 50), "residential": (5, 6.0, 48),
    "living_street": (5, 5.0, 46), "service": (6, 4.5, 30),
    "track": (7, 3.5, 20),
}
FOOT = {"footway": 9.0, "path": 20.0, "steps": 20.0, "cycleway": 14.0,
        "pedestrian": 30.0, "bridleway": 20.0}
HW_ORDER = {"trunk": 1, "trunk_link": 1, "primary": 2, "primary_link": 2,
            "secondary": 3, "secondary_link": 3, "tertiary": 4, "tertiary_link": 4,
            "unclassified": 5, "residential": 5, "living_street": 5,
            "service": 6, "track": 7}
name_ids, name_list = {}, []
def name_id(s):
    if s not in name_ids:
        name_ids[s] = len(name_list); name_list.append(s)
    return name_ids[s]

for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    hw = t.get("highway")
    if hw not in HW and hw not in FOOT:
        continue
    if t.get("area") == "yes":
        continue
    raw = [(r, N[r]) for r in refs if r in N]
    if len(raw) < 2:
        continue
    pl = [xy(n[0], n[1]) for _, n in raw]
    if not any(inside_ext(*q, m=40) for q in pl):
        continue
    cls, width, prio = HW.get(hw, (8, 3.0, FOOT.get(hw, 10)))
    is_foot = hw in FOOT

    if is_foot:
        # footways only inside parks/campuses: paint a thin path
        pl2 = dp(pl, 1.5)
        key = [q for q in pl2 if inside_ext(*q, m=6)]
        if len(key) >= 2:
            grid.corridor(pl2, FOOT[hw] / 2.0, G_FOOT, prio)
        continue

    # split the way into the graph node ids, and paint the corridor
    idx = []
    for r, n in raw:
        p = xy(n[0], n[1])
        if not inside_ext(*p, m=0):
            continue
        rn = rnodes.get(r)
        if rn is None:
            rn = len(rnodes)
            rnodes[r] = rn
        idx.append(rn)
    if len(idx) < 2:
        continue
    lanes = t.get("lanes")
    try:
        lanes = max(1, min(6, int(str(lanes).split(";")[0])))
    except Exception:
        lanes = {1: 3, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1, 7: 1}.get(cls, 1)
    oneway = t.get("oneway")
    oneway = 1 if oneway in ("yes", "true", "1") else (-1 if oneway == "-1" else 0)
    bridge = 1 if t.get("bridge") not in (None, "no") else 0
    tunnel = 1 if t.get("tunnel") not in (None, "no") else 0
    if t.get("junction") == "roundabout":
        oneway = 1
    nm = t.get("name") or t.get("ref") or ""
    roads.append([cls, oneway, lanes, name_id(nm) if nm else -1, idx, bridge, tunnel,
                  HW_ORDER.get(hw, 8)])
    # paint carriageway (footway kerbs are drawn by the renderer)
    grid.corridor(pl, width / 2.0, G_ASPHALT, prio)
    # side carriageway of a dual carriageway already exists as separate ways in OSM
    if nm and cls <= 3 and nm not in [l[2] for l in labels if l[3] == "road"]:
        mid = pl[len(pl) // 2]
        labels.append([*vu(*mid), nm, "road", cls])

# ---- footpaths as pavements where near roads (kerb line)
# ---- parking areas
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if t.get("amenity") != "parking" or "landuse" in t:
        continue
    p = pts_of(wid)
    if len(p) < 3:
        continue
    p = clip_poly(clean_ring(p), LX0, LZ0, LX1, LZ1)
    if len(p) >= 3 and ring_area(p) > 150:
        grid.fill(p, G_PARKING, 44)

# ---- metro (under construction in this extract) ---------------------------
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if t.get("railway") in ("subway", "construction", "proposed") or \
       (t.get("construction") == "rail" and t.get("landuse") == "construction"):
        p = pts_of(wid)
        if len(p) >= 2 and any(inside_ext(*q, m=20) for q in p):
            if t.get("railway") == "subway" or t.get("construction") == "rail":
                metro["line"].append([vu(*q) for q in dp(p, 2.0)])
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if t.get("construction") == "train_station" or (t.get("railway") == "station" and t.get("construction")):
        p = pts_of(wid)
        if p:
            c = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
            if inside_ext(*c):
                metro["stations"].append([*vu(*c), t.get("name", ""), round(ring_area(p))])

# ---- buildings ------------------------------------------------------------
n_bld_in = 0
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if "building" not in t and "building:part" not in t:
        continue
    b = t.get("building") or t.get("building:part")
    if b in ("no", "roof"):
        continue
    p = pts_of(wid)
    if len(p) < 3:
        continue
    p = clean_ring(p)
    if not any(inside_ext(*q, m=0) for q in p):
        continue
    p = clip_poly(simplify_ring(p, 0.9), LX0, LZ0, LX1, LZ1)
    if len(p) < 3:
        continue
    a = ring_area(p)
    if a < 26:                      # smaller than a voxel-and-a-half: drop
        continue
    n_bld_in += 1
    cls = BT.get(b, 0)
    if t.get("office") in ("company", "it", "yes"):
        cls = 2
    if t.get("amenity") in ("school", "college", "university", "kindergarten"):
        cls = 5
    if t.get("amenity") == "place_of_worship" or t.get("religion"):
        cls = 8
    lv = t.get("building:levels") or t.get("levels")
    try:
        lv = float(str(lv).split(";")[0])
    except Exception:
        lv = None
    h = t.get("height")
    if h:
        try:
            hm = float(str(h).replace("m", "").split(";")[0])
        except Exception:
            hm = None
    else:
        hm = None
    if lv is None:
        if hm:
            lv = max(1.0, hm / 3.3)
        else:
            # area heuristic: only used when OSM has no height at all
            lv = max(1.0, min(22.0, 1.6 + (a ** 0.42) / 6.0))
            if cls in (0, 10):
                lv = min(lv, 3.2)
    lv = max(1.0, min(46.0, lv))
    ucn = 1 if (b == "construction" or t.get("construction")) else 0
    nm = t.get("name") or ""
    cx = sum(q[0] for q in p) / len(p); cz = sum(q[1] for q in p) / len(p)
    bgrid = Grid(GW, GH)
    bgrid.fill(p, 1, 100)
    cells = bgrid.merge_cells_only() if hasattr(bgrid, "merge_cells_only") else None
    # cheap per-building rect merge over its own bbox only
    xs = [q[0] for q in p]; zs = [q[1] for q in p]
    i0 = max(0, int(math.floor((min(xs) - LX0) / UNIT))); i1 = min(GW - 1, int(math.ceil((max(xs) - LX0) / UNIT)) - 1)
    j0 = max(0, int(math.floor((min(zs) - LZ0) / UNIT))); j1 = min(GH - 1, int(math.ceil((max(zs) - LZ0) / UNIT)) - 1)
    cell = bgrid.g[j0:j1 + 1, i0:i1 + 1] if i1 >= i0 and j1 >= j0 else None
    if cell is not None:
        # clip the footprint against the painted carriageway / footway: a
        # building may never sit on asphalt, whatever OSM says
        gsub = grid.g[j0:j1 + 1, i0:i1 + 1]
        cell[(gsub == G_ASPHALT) | (gsub == G_FOOT)] = 0
        if cell.sum() == 0:
            continue
    if cell is None or cell.sum() == 0:
        # tiny building: single cell at its centroid
        rects = [[int((cx - LX0) / UNIT), int((cz - LZ0) / UNIT), 1, 1]]
    else:
        rects = []
        used = np.zeros_like(cell, bool)
        for jj in range(cell.shape[0]):
            ii = 0
            while ii < cell.shape[1]:
                if used[jj, ii] or cell[jj, ii] == 0:
                    ii += 1; continue
                w = 1
                while ii + w < cell.shape[1] and cell[jj, ii + w] and not used[jj, ii + w]:
                    w += 1
                hh = 1
                while jj + hh < cell.shape[0]:
                    if not cell[jj + hh, ii:ii + w].all() or used[jj + hh, ii:ii + w].any():
                        break
                    hh += 1
                used[jj:jj + hh, ii:ii + w] = True
                rects.append([i0 + ii, j0 + jj, w, hh])
                ii += w
    buildings.append(dict(
        r=rects, lv=round(lv * 2) / 2, c=cls, u=ucn, a=round(a),
        nm=nm if nm else "",
        cx=vu(cx, cz)[0], cz=vu(cx, cz)[1]))
    if nm and a > 2500:
        labels.append([*vu(cx, cz), nm, "building", min(9, int(a ** 0.25))])

stats["buildings"] = len(buildings)
stats["roads"] = len(roads)
stats["road_nodes"] = len(rnodes)

# ---- named areas get labels (campuses, parks)
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    nm = t.get("name")
    if not nm:
        continue
    lu = t.get("landuse") or t.get("leisure") or t.get("amenity")
    if lu not in ("commercial", "industrial", "retail", "park", "garden", "university",
                  "school", "college", "hospital", "construction"):
        continue
    if "building" in t:
        continue
    p = pts_of(wid)
    if len(p) < 3:
        continue
    a = ring_area(p)
    if a < 9000:
        continue
    c = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
    if not inside_ext(*c):
        continue
    labels.append([*vu(*c), nm, "area", min(9, int(a ** 0.2))])

# ---- site polygons: campuses, parks, construction sites (walls, gates, planting)
sites = []
for wid, (refs, ver, tl) in W.items():
    t = tags_of(tl)
    if "building" in t:
        continue
    lu = t.get("landuse") or t.get("leisure")
    if lu not in ("commercial", "industrial", "retail", "construction",
                  "park", "garden", "grass", "pitch", "playground", "school",
                  "hospital", "university", "college"):
        continue
    p = pts_of(wid)
    if len(p) < 3:
        continue
    p = clip_poly(clean_ring(p), LX0, LZ0, LX1, LZ1)
    if len(p) < 3:
        continue
    a = ring_area(p)
    if a < 12000:
        continue
    kind = {"commercial": 1, "industrial": 2, "retail": 1, "construction": 3,
            "park": 4, "garden": 4, "grass": 4, "pitch": 5, "playground": 5,
            "school": 6, "hospital": 6, "university": 6, "college": 6}[lu]
    sites.append([[[round(q[0] / UNIT, 1), round(q[1] / UNIT, 1)] for q in simplify_ring(p, 1.2)],
                  kind, t.get("name", "")])
stats["sites"] = len(sites)

# ---- POIs for street furniture / signage
AMEN = {"restaurant": 1, "cafe": 2, "fast_food": 1, "bar": 2, "pub": 2,
        "bank": 3, "atm": 3, "fuel": 4, "pharmacy": 5, "hospital": 6, "clinic": 6,
        "school": 7, "college": 7, "place_of_worship": 8, "marketplace": 9,
        "police": 10, "post_office": 10, "bus_station": 11, "taxi": 12}
for k, v in N.items():
    t = tags_of(v[3])
    if not t:
        continue
    x, z = xy(v[0], v[1])
    if not inside_ext(x, z):
        continue
    a = t.get("amenity"); s = t.get("shop"); hw = t.get("highway")
    kind = 0
    if a == "bus_stop" or hw == "bus_stop":
        kind = 20
    elif a in AMEN:
        kind = AMEN[a]
    elif s:
        kind = 30
    if kind:
        pois.append([*vu(x, z), kind, t.get("name", "")[:28]])
stats["pois"] = len(pois)

# ---- ground rects
ground = grid.merge()
stats["ground_rects"] = len(ground)
stats["grid"] = [GW, GH]

# drop duplicate labels (same name+place)
seen, labs = set(), []
for l in sorted(labels, key=lambda l: -l[4]):
    l = l + [""] * (6 - len(l))
    k = (l[2], round(l[0] / 40), round(l[1] / 40))
    if k in seen:
        continue
    seen.add(k)
    labs.append(l)
labs = labs[:170]
stats["labels"] = len(labs)

bundle = dict(
    meta=dict(unit=UNIT, grid=[GW, GH],
              extent=EXTENT,
              origin=dict(lat=_C["lat"], lon=_C["lon"], utm43n=[round(X0, 2), round(Y0, 2)]),
              local=dict(x=[round(LX0 / UNIT, 1), round(LX1 / UNIT, 1)],
                         z=[round(LZ0 / UNIT, 1), round(LZ1 / UNIT, 1)]),
              source="© OpenStreetMap contributors, ODbL 1.0",
              stats=stats),
    ground=ground,
    buildings=[],
    water=[[vu(*q) for q in p] for p in water_polys],
    roads=roads,
    rnodes=[[round(0, 1)] * 2 for _ in range(0)],   # filled below
    names=name_list,
    labels=labs,
    pois=pois,
    metro=metro,
    sites=sites,
)
# rnodes: id -> world position
rn = np.zeros((len(rnodes), 2), float)
for rid, i in rnodes.items():
    x, z = xy(N[rid][0], N[rid][1])
    rn[i] = (round(x / UNIT, 1), round(z / UNIT, 1))
bundle["rnodes"] = [[float(a), float(b)] for a, b in rn]
bundle["buildings"] = [
    [x["r"], x["lv"], x["c"], x["u"], x["nm"], x["cx"], x["cz"]] for x in buildings]

with open(OUT, "w", encoding="utf-8") as f:
    f.write("/* Voxel Bellandur — derived geometry.  Generated by tools/prep_geo.py\n"
            "   Source: OpenStreetMap contributors, ODbL 1.0.\n"
            "   Projection: WGS84 -> UTM 43N (EPSG:32643) -> local voxel units. */\n")
    f.write("var BGEO=")
    json.dump(bundle, f, separators=(",", ":"))
    f.write(";\n")

print(json.dumps(stats, indent=1))
print("bundle %.1f kB" % (os.path.getsize(OUT) / 1024))
print("unit=%.1f m  grid=%d x %d cells  world=%.0f x %.0f voxel units (%.2f x %.2f km)"
      % (UNIT, GW, GH, GW, GH, GW * UNIT / 1000, GH * UNIT / 1000))
