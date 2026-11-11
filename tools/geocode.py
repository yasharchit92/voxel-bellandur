import json,sys,urllib.parse,urllib.request,time
def q(s, extra=""):
    url="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&q="+urllib.parse.quote(s)+extra
    req=urllib.request.Request(url, headers={'User-Agent':'voxel-bellandur/1.0 (research)'})
    try: return json.loads(urllib.request.urlopen(req,timeout=40).read())
    except Exception as e: return [{"error":str(e)}]
for s in sys.argv[1:]:
    print("##",s)
    for r in q(s):
        if 'error' in r: print("  ERR",r['error']); continue
        print("   %-46s %-14s %-11s %.5f,%.5f  [%s/%s]" % (r.get('display_name','')[:46], r.get('category',''), r.get('type',''), float(r['lat']), float(r['lon']), r.get('osm_type'), r.get('osm_id')))
    time.sleep(1.1)
