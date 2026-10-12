"""A/B profiler: load + idle runtime + GPU/tile memory, low-end emulation."""
import asyncio, json, sys, statistics, collections
from playwright.async_api import async_playwright

CATS = ",".join(["devtools.timeline","disabled-by-default-devtools.timeline","blink","cc","gpu","viz","toplevel",
                 "disabled-by-default-devtools.timeline.frame","disabled-by-default-memory-infra"])
TOP = {"RunTask","ThreadControllerImpl::RunTask"}

def thread_names(ev):
    n={}
    for e in ev:
        if e.get("ph")=="M" and e.get("name")=="thread_name": n[(e["pid"],e["tid"])]=e["args"]["name"]
    return n

def busy(ev, names, t0, t1):
    """Top-level task time per thread kind inside [t0,t1] (us)."""
    out=collections.Counter()
    for e in ev:
        if e.get("ph")!="X" or e.get("name") not in ("ThreadControllerImpl::RunTask","RunTask"): continue
        ts=e["ts"]; d=e.get("dur",0)
        if ts+d<t0 or ts>t1: continue
        d=min(ts+d,t1)-max(ts,t0)
        nm=names.get((e["pid"],e["tid"]),"?")
        k=("main" if nm=="CrRendererMain" else "raster" if "Raster" in nm else "compositor" if nm=="Compositor" else
           "gpu" if nm in ("CrGpuMain","VizCompositorThread") or "Viz" in nm else None)
        if k: out[k]+=d
    return out

def by_event(ev, names, t0, t1, thread="CrRendererMain"):
    out=collections.Counter()
    for e in ev:
        if e.get("ph")!="X": continue
        if names.get((e["pid"],e["tid"]))!=thread: continue
        if e["name"] in ("ParseHTML","UpdateLayoutTree","Layout","Paint","PrePaint","Layerize","EvaluateScript","FunctionCall","RecalculateStyles","ScheduleStyleRecalculation","UpdateLayer","CompositeLayers","HitTest","IntersectionObserverController::computeIntersections","ParseAuthorStyleSheet"):
            ts=e["ts"]; d=e.get("dur",0)
            if ts>=t0 and ts<=t1: out[e["name"]]+=d
    return out

def gpu_mem(ev):
    """Largest memory-infra dump: sum of cc tile + gpu allocator sizes (bytes)."""
    best={}
    for e in ev:
        if e.get("ph")!="v": continue
        alloc=e.get("args",{}).get("dumps",{}).get("allocators",{})
        for k,v in alloc.items():
            s=v.get("attrs",{}).get("size",{}).get("value")
            if s is None: continue
            s=int(s,16)
            top=k.split("/")[0]
            if top in ("cc","gpu","skia","tile_manager","shared_image","partition_alloc","blink_gc","malloc","discardable"):
                key=k if k.count("/")==0 else None
                if key: best[key]=max(best.get(key,0),s)
    return best

async def run(url, mode, cpu, w, h, dpr, mobile, idle_s=5):
    async with async_playwright() as p:
        b=await p.chromium.launch(channel="chrome", args=["--enable-gpu-rasterization"])
        ctx=await b.new_context(viewport={"width":w,"height":h}, device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile)
        pg=await ctx.new_page(); cdp=await ctx.new_cdp_session(pg)
        await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled",{"cacheDisabled":True})
        if mode=="slow4g":
            await cdp.send("Network.emulateNetworkConditions",{"offline":False,"latency":150,"downloadThroughput":1.6e6/8,"uploadThroughput":750e3/8})
        await cdp.send("Emulation.setCPUThrottlingRate",{"rate":cpu})
        if INJECT:
            async def handle(route):
                r=await route.fetch(); body=(await r.text())+chr(10)+INJECT
                await route.fulfill(response=r, body=body, headers={k:v for k,v in r.headers.items() if k.lower() not in ("content-encoding","content-length","etag")})
            await pg.route("**/*.css", handle)
            async def tile(route):
                import pathlib; f=pathlib.Path("grain")/route.request.url.rsplit("/",1)[1]
                await route.fulfill(body=f.read_bytes(), headers={"content-type":"image/webp","cache-control":"no-cache"})
            await pg.route("**/__grain/*", tile)
        await b.start_tracing(page=pg, categories=CATS.split(","))
        await pg.add_init_script("""window.__lcp=0;new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
          window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([e.startTime,e.duration])}).observe({type:'longtask',buffered:true});""")
        await pg.goto(url, wait_until="load", timeout=180000)
        await pg.wait_for_timeout(2500)
        nav=await pg.evaluate("""()=>{const n=performance.getEntriesByType('navigation')[0];const f=performance.getEntriesByName('first-contentful-paint')[0];
          return {dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,fcp:f?f.startTime:null,lcp:window.__lcp,bytes:n.encodedBodySize,
           tbt:window.__lt.filter(([s,d])=>s>(f?f.startTime:0)).reduce((a,[s,d])=>a+Math.max(0,d-50),0),longtasks:window.__lt.length}}""")
        # idle window: count frames
        await pg.wait_for_timeout(idle_s*1000)
        fr={}
        layers=await layer_stats(cdp)
        trace=await b.stop_tracing()
        await b.close()
    ev=json.loads(trace)["traceEvents"]; names=thread_names(ev)
    mains=[e for e in ev if e.get("ph")=="X" and names.get((e["pid"],e["tid"]))=="CrRendererMain"]
    tmin=min(e["ts"] for e in mains); tmax=max(e["ts"]+e.get("dur",0) for e in mains)
    # idle window = last idle_s seconds of trace
    i0=tmax-idle_s*1e6
    load_busy=busy(ev,names,tmin,i0); idle_busy=busy(ev,names,i0,tmax)
    pres=collections.Counter()
    for e in ev:
        if e.get("name")=="PipelineReporter" and e.get("ph") in ("b","B") and i0<=e["ts"]<=tmax:
            st=e.get("args",{}).get("chrome_frame_reporter",{}).get("state","?"); pres[st]+=1
    fr={"frames_per_s_by_state":{k:round(v/idle_s,1) for k,v in pres.items()}}
    return {"nav":{k:(round(v) if isinstance(v,(int,float)) and v is not None else v) for k,v in nav.items()},
            "load_ms":{k:round(v/1000) for k,v in load_busy.items()},
            "load_main_events_ms":{k:round(v/1000) for k,v in by_event(ev,names,tmin,i0).most_common(10)},
            "idle_ms_per_s":{k:round(v/1000/idle_s,1) for k,v in idle_busy.items()},
            "idle_main_events_ms_per_s":{k:round(v/1000/idle_s,1) for k,v in by_event(ev,names,i0,tmax).most_common(8)},
            "frames":fr, "layers":layers}

async def layer_stats(cdp):
    got=asyncio.get_event_loop().create_future()
    def on(ev):
        if not got.done() and ev.get("layers"): got.set_result(ev["layers"])
    cdp.on("LayerTree.layerTreeDidChange", on)
    await cdp.send("LayerTree.enable")
    try: L=await asyncio.wait_for(got,10)
    except asyncio.TimeoutError: return None
    await cdp.send("LayerTree.disable")
    draws=[l for l in L if l.get("drawsContent")]
    return {"layers":len(L),"drawing":len(draws),"drawing_area_mpx":round(sum(l["width"]*l["height"] for l in draws)/1e6,1)}

INJECT=""
async def main():
    global INJECT
    url=sys.argv[1]
    INJECT=sys.argv[4] if len(sys.argv)>4 else ""
    if INJECT.startswith("@"): INJECT=open(INJECT[1:],encoding="utf-8").read()
    profile=sys.argv[2]; reps=int(sys.argv[3]) if len(sys.argv)>3 else 1
    cfg={"desktop":dict(mode="fast",cpu=1,w=1440,h=900,dpr=1,mobile=False),
         "lowend":dict(mode="slow4g",cpu=6,w=390,h=844,dpr=2,mobile=True),
         "desk-throttled":dict(mode="fast",cpu=4,w=1440,h=900,dpr=1,mobile=False)}[profile]
    res=[await run(url,**cfg) for _ in range(reps)]
    print(json.dumps(res if reps>1 else res[0], indent=1))
asyncio.run(main())
