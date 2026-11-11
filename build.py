#!/usr/bin/env python3
"""Inline Three.js + the app sources into one self-contained HTML file."""
import glob
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = [
    "three.min.js",
    "OrbitControls.js",
    "CopyShader.js",
    "LuminosityHighPassShader.js",
    "EffectComposer.js",
    "RenderPass.js",
    "ShaderPass.js",
    "UnrealBloomPass.js",
]

def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

vendor_js = "\n;\n".join(read(os.path.join(ROOT, "vendor", v)) for v in VENDOR)
app_js = "\n\n".join(read(p) for p in sorted(glob.glob(os.path.join(ROOT, "src", "*.js"))))
geo_js = read(os.path.join(ROOT, "data", "bellandur.geo.js"))
shell = read(os.path.join(ROOT, "src", "shell.html"))

for blob, name in ((vendor_js, "vendor"), (geo_js, "geo"), (app_js, "app")):
    if "</script" in blob.lower():
        raise SystemExit(f"!! {name} bundle contains a </script> sequence")

out = (shell.replace("/*__VENDOR__*/", vendor_js)
              .replace("/*__GEO__*/", geo_js)
              .replace("/*__APP__*/", app_js))
dest = os.path.join(ROOT, "voxel-bellandur.html")
with open(dest, "w", encoding="utf-8") as f:
    f.write(out)

print(f"wrote {dest}  ({len(out)/1024:.0f} kB)")
