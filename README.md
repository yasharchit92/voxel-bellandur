# Voxel Bellandur
### A data-derived voxel diorama of Bellandur, Bengaluru

One self-contained HTML file rendering **3.3 × 2.9 km of Bellandur — Bellandur Lake and the
Bellandur stretch of the Outer Ring Road** — as an instanced voxel model you can fly, scrub through a
whole day, flatten into a map, ride a bus through, and print as a postcard.

Every road, footprint, water body and place name comes from an OpenStreetMap extract; nothing is
placed from memory. No network requests, no textures loaded from disk, no models, no fonts, no audio
files. ~1.5 MB, opens offline, deterministic from `SEED 20261111`.

```
1 voxel unit = 4 m          world 815 × 720 voxel units (3.26 × 2.88 km)
~280,000 instanced boxes    22–27 draw calls      ~3.2 M triangles
boot ≈ 2.3 s                camera, hour and mode are permalinked in the URL
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

**Anchor list** — the places that carry the identity of the diorama. All are OSM features inside the
extent, and all are drawn from their own footprints/centroids:

| Feature | OSM evidence | Where it is |
|---|---|---|
| Bellandur Lake | relation `19751547`, `natural=water`, `water=lake`, two basins inside the frame | north-west third |
| Outer Ring Road | 46 ways, `highway=trunk`, `lanes=3`, `oneway=yes`, `ref=NH44;NH48` | SW → NE diagonal across the whole frame |
| Namma Metro Phase 2A | `railway=subway`, `construction=train_station` ×7, `landuse=construction` | follows the ORR, **built as under construction** |
| Embassy TechVillage | `landuse=commercial`, 416,000 m² | east, off the ORR |
| Cessna Business Park | `landuse=commercial`, 268,000 m² | far east |
| Prestige Tech Park | `landuse=commercial`, 288,000 m² | north-east corner |
| RMZ Ecospace | `landuse=commercial`, 299,000 m² | south-east |
| Prestige Lakeshore Drive | `landuse=commercial`, 322,000 m² | east shore of the lake |
| Helios, Global Technology Park, Intel, Salarpuria, Divyasree, New Horizon College | `landuse=commercial` / `office` | east belt |
| Saul Kere, Deverabisanahalli Lake | `natural=water`, `leisure=park` | south / south-east |
| Sarjapura Road, Kadabeesanahalli Main Road, Bellanduru–Doddakannelli Road | `highway=secondary/tertiary` with names | SW, NE, SE |
| Sites marked `(u/c)` in OSM — Bagmane Encore, Prestige Signature Towers, Sattva, Embassy Spectrum, Adarsh Urbanite, Purva Weaves, Sobha Insignia, RMZ Eco World … | `building=construction` / `landuse=construction` | scattered, drawn as concrete frames with scaffolding and cranes |

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
- The traffic is procedural: no origin–destination data exists, so it is plausible, not measured.

---

## 2. What the diorama actually does

**A day, on one axis.** Everything — sun elevation and bearing, light colour, sky gradient, fog, cloud
cover, bloom, and the fraction of the city whose lights are on — is read off a single hour value
interpolated from a keyframe table. Drag the slider, press `Y` to run the day at 0.55 h/s, or press
`T` to swing between mid-morning and dusk. At 09:24 the city is side-lit and the windows are dark; by
19:30 the sun is below the horizon and the windows come on **progressively** — each window, lamp and
streetlight carries its own turn-on time, so dusk arrives as a wave crossing the city rather than a
switch. The shadow map is refreshed from the moved sun, not left stale.

**Light on the ground.** Emissive boxes alone give you a dark model with bright dots on it. A single
additive instanced layer puts warm pools under 2 600 streetlights and a headlight smear ahead of every
vehicle, with taillight bloom behind — one extra draw call, gated on the same dusk value.

**The lake.** A real shader: two drifting ripple octaves plus a travelling gust make a normal, a
sky-gradient reflection with proper Fresnel makes it mirror whatever the sky is doing, a narrow
specular lobe scatters the sun into a glitter path, and a blurred occupancy mask of the OSM lake grows
silt, weed and a foam band along the actual shoreline. At dusk the shore picks up the city's own light.
Normals fade with distance so the far water never moires.

**Sky.** Procedural cumulus projected on a dome, lit by the sun with warm rims, over a three-stop
gradient with a horizon haze band, a sun disc and halo, and stars once the sky is deep enough.

**Traffic that behaves.** 900 vehicles on a lane graph whose endpoints are snapped to a 3-voxel lattice,
so OSM ways actually meet at junctions. 18 signalised junctions run a 44 s cycle; vehicles brake for
the red, queue behind each other (car-following with a real gap), then release. Weighting is by road
class, so 69 % of traffic is on trunk/arterial roads. Autorickshaws weave; buses and taxis are in the
mix.

**Rooftops.** Tanks, solar arrays, condenser banks, lift overruns, plant rooms, satellite dishes,
laundry lines, parapets of varying height and weathering patches — because at 4 m per voxel, roofs are
most of what an aerial frame shows.

**Atlas mode.** The whole model squashes to a flat map (every instanced mesh scaled in Y) while the
camera pulls up to top-down and the labels take over. It is the same geometry, morphed — press `V`.

**Chase.** `G` drops you behind a vehicle on the ORR at street level, and the camera lifts itself out of
any block it would otherwise be inside. `[` and `]` cycle through vehicles.

**Sound.** Synthesised with WebAudio, no files: brown-noise city rumble that rises as you descend,
wind that rises with altitude, horns on a Poisson process, lake lapping when you are near the water,
birds around dawn. `M`.

**Postcard.** `P` renders the current view at 2×, composites it onto a captioned plate (title, extent,
voxel size, local clock, seed, ODbL attribution) and downloads a PNG.

**Permalinks.** The camera, hour and mode are written to the URL hash as you move, so any view can be
shared: `#p=150,52,300&t=200,0,230&h=19.2`.

---

## 3. Controls

| | |
|---|---|
| Left drag | orbit / look |
| Right drag | pan |
| `W` `A` `S` `D`, `Q` `E` | free-fly (down / up), `Shift` to sprint |
| Arrow keys | look while flying |
| `C` | orbit ⇄ free-fly |
| `1`–`5` | presets: Neighbourhood · Lake · Outer Ring Rd · Tech parks · Layouts |
| `T` | day ⇄ evening |
| `Y` | run the day |
| `V` `G` | atlas map · chase a vehicle (`[` `]` to switch) |
| `M` `P` | sound · postcard |
| `L` `B` `R` `F` `H` | labels · bloom · reset · freeze · hide UI |

The compass always points to true north (the scene is UTM-aligned, so it is exact); the scale bar is
computed from the camera's field of view.

---

## 4. The pipeline (raw material → diorama)

The Overpass API was unreachable from the build sandbox (HTTP 406, then connection resets), so the
pipeline uses the OSM **`/api/0.6/map`** endpoint instead — same underlying elements, different door.

```
tools/fetch_osm.py     Stage 1  tiled raw extract  →  data/raw/tiles/*.osm, data/raw/bellandur.json.gz
                       (30 tiles, recursion on HTTP 509, 60,843 nodes / 9,569 ways / 127 relations)
tools/prep_geo.py      Stage 2  projection, classification, rasterisation  →  data/bellandur.geo.js
build.py               Stage 3  inline three.js + geo bundle + src/*.js  →  voxel-bellandur.html
validate.py            Stage 4  automated geographic assertions (see §6)
```

**Stage 2 in detail** — this is where shape becomes city:
1. Project every node WGS84 → UTM 43N → local metres (origin at the frame centre).
2. Simplify rings/polylines with Douglas–Peucker (0.9 m buildings, 1.6 m water, 2.0 m landuse).
3. Clip every polygon to the frame (Sutherland–Hodgman) so nothing escapes the diorama base.
4. Classify: buildings into 11 types from `building`/`office`/`amenity` tags; ground into 14 classes.
5. Rasterise water, land, roads and footpaths onto **one shared 4 m grid** by priority
   (water > asphalt > footway > landuse > default) using distance-to-segment corridors, so a road is
   exactly as wide as its OSM class says.
6. **Greedy-merge** that grid into ~16,600 rectangles — the whole ground plane costs a few thousand
   instanced quads instead of 587,000 voxels.
7. Clip building footprints against the painted carriageway, then merge each footprint into 1–4 rects.
8. Emit heights, labels, POIs, sites, metro alignment and a road graph (6,590 nodes, 1,529 ways).

**Rendering** (`src/`, concatenated in filename order):
| file | what it does |
|---|---|
| `00-core.js` | seeded RNG, palette, instanced builder, sky (clouds/stars/halo), lights, hour→sky keyframes, bloom, glow turn-on uniforms |
| `01-water.js` | the lake shader: ripples, sky reflection, glitter, shoreline silt and foam |
| `10-terrain.js` | diorama base (soil strata), ~16.6k ground plates, lake mask texture, shore |
| `20-roads.js` | kerbs, footpaths, dashed markings, planted medians, signals, zebra bars, **lane graph** |
| `30-buildings.js` | 4,208 footprints: flats with balconies and tanks, three campus facade styles, shop rows, temples, construction frames with cranes, roof plant decks |
| `40-green.js` | street trees, palms, hedges, campus planting, lake-margin scrub, compound walls |
| `50-life.js` | 900 vehicles with signals and car-following, 300 pedestrians, streetlights, bus shelters, tea stalls, hoardings, metro works, work boats, birds |
| `55-night.js` | the additive light-spill layer (lamp pools, headlight smears) |
| `70-audio.js` | procedural WebAudio city |
| `80-postcard.js` | 2× still render + caption composition + download |
| `90-main.js` | controls, presets, labels, atlas, chase, compass, scale, HUD, loop, `window.__vb` |

**Re-running**
```
python3 tools/fetch_osm.py     # only needs the network; caches every tile
python3 tools/prep_geo.py      # offline, uses data/raw/bellandur.json.gz
python3 build.py               # offline, writes voxel-bellandur.html
python3 validate.py            # offline, fails loudly on geographic drift
```

---

## 5. What is compressed, simplified or stylised

Like any physical model, this one has a stated scale and stated compromises:

- **Scale.** 1 voxel = 4 m. A car is 1 unit (4 m, drawn at 4.2 m), a bus 2.7 units, a 6-storey block
  7 units. Buildings snap to whole voxels, so footprints are quantised to 4 m.
- **Heights** come from `building:levels` where OSM has it (≈40 % of footprints) and otherwise from a
  footprint-area estimate: `levels = 1.6 + area^0.42 / 6`, capped at 22 and never invented above what a
  footprint that size plausibly holds; median 3 storeys, 90th percentile 5, tallest 20.
- **Verticals.** One floor = 0.78 voxel units (3.1 m). Balcony bands, spandrel bands and window strips
  are sub-voxel boxes; they read as texture, not geometry, at 1:1.
- **Terrain is flat at y = 0.** Bellandur is a floodplain on the Deccan plateau; the only relief is the
  lake sunk into a banked bed. No invented hills.
- **Lake.** Drawn from the relation's own outer rings; interior islands and inner rings are not
  modelled, and the far-western basins fall outside the frame — a model cut at the edge, like any model.
- **Roads.** Lane counts from `lanes`, width from the class when `lanes` is missing. Junction geometry
  is voxel-quantised, so a diagonal road is a staircase at 4 m — intentional.
- **Traffic and crowd are procedural.** Signal cycles, speeds, dwell times and pedestrian routes are
  invented plausibly; only the road geometry and directions are from OSM.
- **Water colours, tree species, facade palettes, weather and time of day are art direction**, not data.
  There is no cloud-cover record for 2026-11-11 and no claim that it was sunny.
- **Sound is synthesised**, not recorded on location.
- **The frame cuts the world.** Buildings, roads and the lake are clipped at the boundary and the base
  is given a visible cut edge, so the model never pretends to be the whole city.

---

## 6. Validation

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

`npm test` — focused junction/time-toggle regressions plus 59 browser assertions covering boot, console cleanliness, the hour system, the
dusk wave, light spill, signals and queues, traffic distribution, all five presets, atlas morph, chase
camera, audio start/stop, postcard export, permalinks and every HUD control (including a hit test that
each control is actually clickable). It needs Playwright:

```
npm ci && npx playwright install chromium
npm test     # regression checks plus 59 browser assertions
# Or use an installed Chrome browser:
PLAYWRIGHT_CHANNEL=chrome npm test
```

`tests/final_shots.js` regenerates `screenshots/`; `tests/shots.js` is the working set used during
development.

---

## 7. Data licence

Map data © OpenStreetMap contributors, **ODbL 1.0** (<https://www.openstreetmap.org/copyright>).
The extract (`data/raw/`) is kept verbatim so the derivation is auditable, and
`data/bellandur.geo.js` is a derived database published under the same licence.
Three.js r147 (MIT) is vendored in `vendor/`.

Screenshots of the shipped build are in `screenshots/`:
`01` morning diorama · `02` golden hour over the lake · `03` the ORR at night · `04` the city at night ·
`05` tech parks · `06` residential layouts · `07` atlas map · `08` chase on the ORR · `09` rooftops ·
`10` dusk over a neighbourhood · `11` a postcard export.
