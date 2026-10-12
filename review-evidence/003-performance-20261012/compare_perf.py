import json, pathlib, statistics
base=pathlib.Path(__file__).parent
before=json.loads((base/'baseline-performance.json').read_text())['before']
after=json.loads((base/'final-performance.json').read_text())['after']
rows=[]
for device in ['desktop','mobile']:
    b=before[device]; a=after[device]
    for key,label in [('domContentLoaded','DOMContentLoaded'),('load','load event')]:
        bv=statistics.median(x['page']['navigation'][0][key] for x in b['loads'])
        av=statistics.median(x['page']['navigation'][0][key] for x in a['loads'])
        rows.append([device,label+' median ms',bv,av])
    for key in ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']:
        bv=1000*statistics.median(x['metrics'][key] for x in b['loads'])
        av=1000*statistics.median(x['metrics'][key] for x in a['loads'])
        rows.append([device,'cold '+key+' median ms',bv,av])
    for section in ['top','about','network']:
        key=section+'Fixed'
        if key not in b or key not in a: continue
        for metric in ['taskMsPerSecond','styleMsPerSecond','scriptMsPerSecond','animations']:
            rows.append([device,section+' '+metric,b[key]['rate'][metric],a[key]['rate'][metric]])
result={'samplesPerDevice':3,'rows':[{'device':r[0],'metric':r[1],'before':r[2],'after':r[3],'changePercent':100*(r[3]-r[2])/r[2] if r[2] else None} for r in rows]}
(base/'performance-comparison.json').write_text(json.dumps(result,indent=2))
text=['| Device | Metric | Before | After | Change |','|---|---|---:|---:|---:|']
for r in result['rows']:
    change='n/a' if r['changePercent'] is None else f"{r['changePercent']:+.1f}%"
    text.append(f"| {r['device']} | {r['metric']} | {r['before']:.2f} | {r['after']:.2f} | {change} |")
(base/'performance-comparison.md').write_text('\n'.join(text)+'\n')
print('\n'.join(text))
