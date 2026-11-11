import sys, urllib.request, xml.etree.ElementTree as ET
def fetch(bbox):
    url="https://api.openstreetmap.org/api/0.6/map?bbox=%s"%bbox
    req=urllib.request.Request(url, headers={'User-Agent':'voxel-bellandur/1.0 (research)'})
    return ET.fromstring(urllib.request.urlopen(req, timeout=90).read())
if __name__=="__main__":
    bbox=sys.argv[1]
    r=fetch(bbox)
    nodes={n.get('id'):(float(n.get('lon')),float(n.get('lat'))) for n in r.findall('node')}
    print("elements: nodes %d ways %d rels %d"%(len(nodes),len(r.findall('way')),len(r.findall('relation'))))
    from collections import Counter
    hw=Counter(); names=Counter(); bld=Counter(); land=Counter()
    for w in r.findall('way'):
        t={c.get('k'):c.get('v') for c in w.findall('tag')}
        if 'highway' in t:
            hw[t['highway']]+=1
            if t.get('name'): names[t['name']]+=1
        if 'building' in t: bld[t['building']]+=1
        if 'landuse' in t: land[t['landuse']]+=1
        if 'natural' in t: land['natural:'+t['natural']]+=1
        if 'leisure' in t: land['leisure:'+t['leisure']]+=1
    print("highway:",hw.most_common())
    print("named ways:",names.most_common(14))
    print("buildings:",bld.most_common(8))
    print("land:",land.most_common(10))
