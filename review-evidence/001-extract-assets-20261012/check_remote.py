import urllib.request, json, pathlib
urls=['https://heartwood.org/heartbeat/Fall-2026.jpg','https://heartwood.org/campaigns/forestwatch/index.html','https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Sans:wght@400..700&display=swap']
results=[]
for u in urls:
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20)
        results.append({'url':u,'status':r.status,'type':r.headers.get('Content-Type')}); r.close()
    except Exception as e: results.append({'url':u,'error':str(e)})
p=pathlib.Path(r'C:\Users\Administrator\AppData\Local\Temp\heartwood-extraction-20261012')
(p/'remote-resource-check.json').write_text(json.dumps(results,indent=2)); print(json.dumps(results,indent=2))
