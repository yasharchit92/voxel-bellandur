#!/usr/bin/env python3
"""
Stage 1 — raw material.

Fetches OpenStreetMap data for the Bellandur extent using the public OSM
/api/0.6/map endpoint (Overpass was unreachable from this sandbox; the map
endpoint returns the same underlying elements).  Tiles the bbox so no request
exceeds the 50k-element cap, retries, and caches each tile verbatim so the
pipeline is re-runnable and auditable offline.

Output
  data/raw/tiles/<lon>_<lat>.osm   verbatim per-tile XML (raw material)
  data/raw/bellandur.json.gz       merged, de-duplicated elements
  data/raw/manifest.json           provenance: bbox, endpoints, counts, date
"""
import gzip, json, os, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
TILES = os.path.join(RAW, "tiles")
os.makedirs(TILES, exist_ok=True)

# extent with a small margin beyond the rendered frame (roads must enter/leave it)
BBOX = dict(lon0=77.6575, lon1=77.6980, lat0=12.9180, lat1=12.9465)
TILE_DLON = 0.0080
TILE_DLAT = 0.0055
UA = {"User-Agent": "voxel-bellandur/1.0 (procedural diorama; offline build)"}
ENDPOINT = "https://api.openstreetmap.org/api/0.6/map?bbox="

nodes, ways, rels = {}, {}, {}
fetched = []


def get_tile(lon0, lat0, lon1, lat1, depth=0):
    """Fetch one tile; split recursively if the server says it is too big."""
    name = "%.5f_%.5f_%.5f_%.5f.osm" % (lon0, lat0, lon1, lat1)
    path = os.path.join(TILES, name)
    if not os.path.exists(path):
        url = ENDPOINT + "%.5f,%.5f,%.5f,%.5f" % (lon0, lat0, lon1, lat1)
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=UA)
                data = urllib.request.urlopen(req, timeout=120).read()
                with open(path, "wb") as f:
                    f.write(data)
                time.sleep(0.9)
                break
            except urllib.error.HTTPError as e:
                if e.code == 509 and depth < 4:            # too many elements → split
                    print("   509 → splitting")
                    mlon, mlat = (lon0 + lon1) / 2, (lat0 + lat1) / 2
                    for a, b, c, d in ((lon0, lat0, mlon, mlat), (mlon, lat0, lon1, mlat),
                                       (lon0, mlat, mlon, lat1), (mlon, mlat, lon1, lat1)):
                        get_tile(a, b, c, d, depth + 1)
                    return
                print("   HTTP %s (attempt %d)" % (e.code, attempt + 1))
                time.sleep(3 * (attempt + 1))
            except Exception as e:                          # noqa: BLE001
                print("   %s (attempt %d)" % (e, attempt + 1))
                time.sleep(3 * (attempt + 1))
        else:
            print("   !! giving up on", name)
            return
    try:
        root = ET.parse(path).getroot()
    except Exception as e:                                  # noqa: BLE001
        print("   !! unparsable", name, e)
        return
    n0, w0, r0 = len(nodes), len(ways), len(rels)
    for n in root.findall("node"):
        nodes[n.get("id")] = (float(n.get("lon")), float(n.get("lat")),
                              int(n.get("version", 0)), [t.attrib for t in n.findall("tag")])
    for w in root.findall("way"):
        ways[w.get("id")] = ([nd.get("ref") for nd in w.findall("nd")],
                             int(w.get("version", 0)), [t.attrib for t in w.findall("tag")])
    for r in root.findall("relation"):
        rels[r.get("id")] = ([m.attrib for m in r.findall("member")],
                             int(r.get("version", 0)), [t.attrib for t in r.findall("tag")])
    fetched.append(dict(tile=name, nodes=len(nodes) - n0, ways=len(ways) - w0, rels=len(rels) - r0))


def main():
    nl = int((BBOX["lon1"] - BBOX["lon0"]) / TILE_DLON) + 1
    na = int((BBOX["lat1"] - BBOX["lat0"]) / TILE_DLAT) + 1
    print("tiling %d x %d = %d tiles" % (nl, na, nl * na))
    for i in range(nl):
        for j in range(na):
            lon0 = BBOX["lon0"] + i * TILE_DLON
            lat0 = BBOX["lat0"] + j * TILE_DLAT
            get_tile(lon0, lat0, min(lon0 + TILE_DLON, BBOX["lon1"]),
                     min(lat0 + TILE_DLAT, BBOX["lat1"]))
            print("  tile %d/%d %d/%d  nodes=%d ways=%d rels=%d"
                  % (i + 1, nl, j + 1, na, len(nodes), len(ways), len(rels)))

    blob = dict(bbox=BBOX, nodes=nodes, ways=ways, relations=rels)
    with gzip.open(os.path.join(RAW, "bellandur.json.gz"), "wt", encoding="utf-8") as f:
        json.dump(blob, f)
    manifest = dict(
        place="Bellandur, Bengaluru, Karnataka, India",
        bbox=BBOX,
        endpoint=ENDPOINT.strip("?bbox="),
        endpoints_used=[ENDPOINT.strip("?bbox="),
                        "https://nominatim.openstreetmap.org/search",
                        "https://api.openstreetmap.org/api/0.6/relation/19751547/full"],
        fetched_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        tiles=len(fetched),
        counts=dict(nodes=len(nodes), ways=len(ways), relations=len(rels)),
        licence="© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        note="Overpass API unreachable from the build sandbox; /api/0.6/map used instead.",
        tile_log=fetched,
    )
    with open(os.path.join(RAW, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print("merged: %d nodes, %d ways, %d relations" % (len(nodes), len(ways), len(rels)))


if __name__ == "__main__":
    main()
