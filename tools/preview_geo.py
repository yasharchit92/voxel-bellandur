"""Plan-view render of the derived bundle — the geographic sanity check."""
import json, re, sys
from PIL import Image, ImageDraw
src = open('data/bellandur.geo.js').read()
B = json.loads(src[src.index('var BGEO=')+9:src.rindex(';')])
GW, GH = B['meta']['grid']
OX, OZ = B['meta']['local']['x'][0], B['meta']['local']['z'][0]   # centred -> grid offset
S = 1  # px per cell
im = Image.new('RGB', (GW*S, GH*S), (214, 202, 180))
dr = ImageDraw.Draw(im)
COLS = {1:(226,215,193),2:(78,80,84),3:(196,186,168),4:(96,140,160),5:(120,150,96),
        6:(160,150,116),7:(206,198,178),8:(200,197,186),9:(150,134,110),10:(168,140,116),
        11:(180,172,150),12:(120,170,140),13:(90,170,200),14:(170,158,124),15:(130,126,120)}
for i,j,w,h,c in B['ground']:
    dr.rectangle([i*S, j*S, (i+w)*S-1, (j+h)*S-1], fill=COLS.get(c,(200,200,200)))
BC = {0:(206,190,170),1:(212,178,160),2:(150,180,196),3:(210,186,150),4:(214,168,150),
      5:(198,196,176),6:(222,222,226),7:(178,170,158),8:(226,208,170),9:(196,168,132),10:(186,180,168)}
for b in B['buildings']:
    col = BC.get(b['c'], (200,190,175))
    for i,j,w,h in b['r']:
        dr.rectangle([i*S, j*S, (i+w)*S-1, (j+h)*S-1], fill=col)
for p in B['water']:
    dr.polygon([((x-OX)*S, (z-OZ)*S) for x,z in p], outline=(0,60,110), fill=(96,140,160))
# roads on top, thin
for cls,oneway,lanes,ni,idx,br,tu,order in B['roads']:
    pts = [B['rnodes'][i] for i in idx]
    col = (30,30,34) if cls<=2 else (60,60,66) if cls<=4 else (110,110,116)
    dr.line([((x-OX)*S, (z-OZ)*S) for x,z in pts], fill=col, width=max(1, 7-cls))
for l in B['labels']:
    if l[3] in ('area','water','road'):
        dr.text(((l[0]-OX)*S+2, (l[1]-OZ)*S+2), l[2][:22], fill=(20,20,60))
for s in B['metro']['stations']:
    dr.ellipse([(s[0]-OX)*S-3, (s[1]-OZ)*S-3, (s[0]-OX)*S+3, (s[1]-OZ)*S+3], outline=(200,60,60), width=2)
for line in B['metro']['line']:
    dr.line([((x-OX)*S,(z-OZ)*S) for x,z in line], fill=(200,80,80), width=2)
im.save('screenshots/geo-plan.png')
print('wrote screenshots/geo-plan.png', im.size)
print('buildings', len(B['buildings']), 'roads', len(B['roads']), 'metro stations', B['metro']['stations'])
