# Voxel Bellandur
### A data-derived voxel diorama of Bellandur, Bengaluru

A single self-contained HTML file that renders **3.3 × 2.9 km of Bellandur — Bellandur Lake and
the Bellandur stretch of the Outer Ring Road** — as an instanced voxel model. Every road, footprint,
water body and place name in the scene comes from an OpenStreetMap extract; nothing is placed from
memory. Open `voxel-bellandur.html` and it runs offline, with no network requests, no textures, no
external models and no fonts to download.

```
1 voxel unit = 4 m          world 815 × 720 voxel units (3.26 × 2.88 km)
~260,000 instanced boxes    26 draw calls      ~3.1 M triangles
boot ≈ 2.3 s                deterministic from SEED 20261111
```

---

## 1. What is in the frame, and how faithful it is

**Extent** — a rectangle in UTM zone 43N, not a lat/lon box, because the diorama is north-up:

| | |
|---|---|
| South-west corner | 12.9175 °N, 77.6655 °E |
| North-east corner | 12.9435 °N, 77.6955 °E |
| Projection | WGS84 → **EPSG:32643** (UTM 43N), k₀ 0.9996, central meridian 75 °E |
| Local origin | 12.9305 °N, 77.6805 °E = 790 853.87 E / 1 430 973.25 N |
| Local axes | **X = east, Z = south, Y = up** (north is −Z) |

**Anchor list** — the places that carry the identity of the diorama. All are OSM features inside
the extent, and all are drawn from their own footprints/centroids:

| Feature | OSM evidence | Where it is |
|---|---|---|
| Bellandur Lake | relation `19751547`, `natural=water`, `water=lake`, 3.2 km² total, two basins inside the frame | north-west third |
| Outer Ring Road | 46 ways, `highway=trunk`, `lanes=3`, `oneway=yes`, `ref=NH44;NH48` | SW → NE diagonal across the whole frame |
| Namma Metro Phase 2A | `railway=subway`, `construction=train_station` ×7, `landuse=construction` | follows the ORR, **built as under construction** |
| Embassy TechVillage | `landuse=commercial`, 416,000 m² | east, off the ORR |
| Cessna Business Park | `landuse=commercial`, 268,000 m² | far east |
| Prestige Tech Park | `landuse=commercial`, 288,000 m² | north-east corner |
| RMZ Ecospace | `landuse=commercial`, 299,000 m² | south-east |
| Prestige Lakeshore Drive | `landuse=commercial`, 322,000 m² | east shore of the lake |
| Helios Business Park, Global Technology Park, Intel, Salarpuria, Divyasree, New Horizon College | `landuse=commercial`/`office` | east belt |
| Saul Kere, Deverabisanahalli Lake | `natural=water`, `leisure=park` | south / south-east |
| Sarjapura Road, Kadabeesanahalli Main Road, Bellanduru–Doddakannelli Road | `highway=secondary/tertiary` with names | SW, NE, SE |
| Sites marked `(u/c)` in OSM — Bagmane Encore, Prestige Signature Towers, Sattva, Embassy Spectrum, Adarsh Urbanite, Purva Weaves, Sobha Insignia, RMZ Eco World … | `building=construction` / `landuse=construction` | scattered, drawn as concrete frames with scaffolding |

**Reference date: November 2026** — the date the extract was pulled (`data/raw/manifest.json`).
The lake relation itself carries the note *“Rejuvenation and desilting ongoing as of 2026 April”*;
the diorama shows three work boats on the water rather than any dramatised pollution, and the metro
is shown as a construction site, never as a running line.

**Deliberately not claimed**
- No flyover, skywalk or metro station is shown as operating. The only elevated structure is the
  under-construction metro viaduct (piers, no deck), because that is what the extract says.
- Building names appear only where OSM has one. Everything else is unnamed procedural massing.
- Neighbours (Kadubeesanahalli, Devarabisanahalli, Green Glen Layout, AECS Layout) appear as ordinary
  fabric inside the frame, not as separately labelled districts.

---

## 2. The pipeline (raw material → diorama)

The Overpass API was unreachable from the build sandbox (HTTP 406, then connection resets), so the
pipeline uses the OSM **`/api/0.6/map`** endpoint instead — same underlying elements, different door.

```
tools/fetch_osm.py     Stage 1  tiled raw extract  →  data/raw/tiles/*.osm, data/raw/bellandur.json.gz
                       (30 tiles, recursion on HTTP 509, 60,843 nodes / 9,569 ways / 127 relations)
tools/prep_geo.py      Stage 2  projection, classification, rasterisation  →  data/bellandur.geo.js
build.py               Stage 3  inline three.js + geo bundle + src/*.js  →  voxel-bellandur.html
validate.py            Stage 4  automated geographic assertions (see §5)
```

**Stage 2 in detail** — this is where shape becomes city:
1. Project every node WGS84 → UTM 43N → local metres (origin at the frame centre).
2. Simplify rings/polylines with Douglas–Peucker (0.9 m for buildings, 1.6 m for water, 2.0 m for landuse).
3. Clip every polygon to the frame (Sutherland–Hodgman) so nothing escapes the diorama base.
4. Classify: buildings into 11 types from `building`/`office`/`amenity` tags; ground into 14 classes
   from `landuse`/`natural`/`leisure`/`amenity`.
5. Rasterise water, land, roads and footpaths onto **one shared 4 m grid** by priority
   (water > asphalt > footway > landuse > default) using distance-to-segment corridors, so a road is
   exactly as wide as its OSM class says.
6. **Greedy-merge** that grid into ~16,600 rectangles — the whole ground plane costs a few thousand
   instanced quads instead of 587,000 voxels.
7. Clip building footprints against the painted carriageway, then merge each footprint into 1–4 rects.
8. Emit heights, labels, POIs, sites, metro alignment and a road graph (6,590 nodes, 1,529 ways).

**Rendering** (`src/`):
| file | what it does |
|---|---|
| `00-core.js` | seeded RNG, palette, instanced builder, sky, lights, bloom, day/evening state, water shader |
| `10-terrain.js` | the diorama base (soil strata), 16.7k ground plates, lake bed, silt banks, reeds |
| `20-roads.js` | kerbs, footpaths, dashed markings, planted medians, signal masts, zebra bars, **lane graph** |
| `30-buildings.js` | 4,208 footprints extruded: flats with balcony bands + rooftop tanks, glass/stone campuses with spandrel bands, shop rows, temples, construction frames with cranes |
| `40-green.js` | 2,832 trees, 334 palms, hedges and shrubs; campus planting, lake-margin scrub, compound walls + gates |
| `50-life.js` | 760 vehicles on the lane graph, 300 pedestrians, streetlights, bus shelters, tea stalls, hoardings, metro works, work boats, birds |
| `90-main.js` | controls, camera presets, labels, north indicator, scale bar, HUD, main loop |

**Re-running**
```
python3 tools/fetch_osm.py     # only needs the network; caches every tile
python3 tools/prep_geo.py      # offline, uses data/raw/bellandur.json.gz
python3 build.py               # offline, writes voxel-bellandur.html
python3 validate.py            # offline, fails loudly on geographic drift
```

---

## 3. Controls

| | |
|---|---|
| Left drag | orbit / look |
| Right drag | pan |
| `W` `A` `S` `D`, `Q` `E` | free-fly (down / up), `Shift` to sprint |
| Arrow keys | look while flying |
| `C` | orbit ⇄ free-fly |
| `1`–`5` | camera presets: Neighbourhood · Lake · Outer Ring Rd · Tech parks · Layouts |
| `T` | day ⇄ evening |
| `L` | landmark labels (collision-culled) |
| `B` `R` `F` `H` | bloom · reset view · freeze animation · hide UI |

The compass in the corner always points to true north (the scene is UTM-aligned, so it is exact).
The scale bar is computed from the camera's field of view, in metres.

---

## 4. What is compressed, simplified or stylised

Like any physical model, this one has a stated scale and stated compromises:

- **Scale.** 1 voxel = 4 m. A car is 1 unit (4 m, drawn at 4.2 m), a bus 2.7 units (10.8 m), a
  6-storey block 7 units. Buildings are snapped to whole voxels, so footprints are quantised to 4 m
  and the model is *one or two voxels* wider or narrower than reality.
- **Heights** come from `building:levels` where OSM has it (≈40 % of footprints) and otherwise from a
  footprint-area estimate: `levels = 1.6 + area^0.42 / 6`. That estimate is capped at 22 storeys and
  never invented above what a footprint that size plausibly holds; median 3 storeys, 90th percentile 5,
  tallest 20 (Prestige Lakeshore Drive towers).
- **Verticals.** One floor = 0.78 voxel units (3.1 m). Balcony bands, spandrel bands and window
  strips are sub-voxel boxes; they read as texture, not as geometry at 1:1 scale.
- **Terrain is flat at y = 0.** Bellandur is genuinely flat (it is a lake basin on the Deccan
  plateau); the only relief is the lake sunk 3.6 units (14 m) into a banked bed. No invented hills.
- **Lake.** The two basins that intersect the frame are drawn from the relation's own outer rings;
  interior islands and inner rings are not modelled. The lake is cropped — its far-western basins lie
  outside the 3.26 km frame and are simply absent, exactly like a real model cut at the edge.
- **Roads.** Lane counts come from `lanes`; width is derived from the OSM class when `lanes` is
  missing. Service roads narrower than ~4 m are painted as single-cell lanes. Junction geometry is
  voxel-quantised, so a diagonal road is a staircase at 4 m — intentional, it is a voxel model.
- **Water colours, tree species and facade palettes are invented** — they are art direction, not data.
  Rain trees, palms and hedges stand in for the canopy; nobody is claiming a specific species.
- **Time of day** is not from any source: the "late afternoon" and "evening" lighting are chosen to
  make the two moods legible.
- **Traffic** is procedural. 760 vehicles are placed on real lane geometry with real one-way
  directions and a left-hand-traffic offset, but no origin–destination data exists, so density is
  weighted by road class and speeds are illustrative rather than measured.
- **The frame cuts the world.** Buildings, roads and the lake are clipped at the boundary and the
  base is given a visible cut edge, so the model never pretends to be the whole city.

---

## 5. Validation

`python3 validate.py` — all checks pass on the shipped build:

```
1. projection   central meridian → easting 500000.000      PASS
                origin recompute 790853.87 E / 1430973.25 N PASS
2. frame        every water/road vertex inside the frame   PASS  (0 escaped)
                every building rect inside the grid        PASS  (0 escaped)
3. lake         IoU vs. the OSM relation's own outline     PASS  (0.869)
                1.57 km² of water in frame                 PASS
4. roads        building footprints on asphalt/footway     PASS  (0 / 10,969)
5. labels       campus/park labels inside their polygon     PASS  (32 / 32)
6. heights      ≤ 46 storeys, > 0, median 3                 PASS
```

Plus, in the browser: zero console errors, every HUD button and key exercised (orbit/free-fly, bloom,
labels, day/evening, freeze, hide-UI, all five presets), boot ≈ 2.3 s, 26 draw calls, 3.1 M triangles.

---

## 6. Data licence

Map data © OpenStreetMap contributors, **ODbL 1.0** (<https://www.openstreetmap.org/copyright>).
The extract (`data/raw/`) is kept verbatim so the derivation is auditable, and
`data/bellandur.geo.js` is a derived database published under the same licence.
Three.js r147 (MIT) is vendored in `vendor/`.

Screenshots of the shipped build are in `screenshots/` (01 diorama · 02 lake · 03 ORR · 04 tech parks ·
05 layouts · 06–07 evening · 08 labels).
