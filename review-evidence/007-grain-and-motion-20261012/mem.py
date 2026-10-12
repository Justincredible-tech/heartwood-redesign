"""GPU tile memory + renderer heap after settle, via memory-infra dump."""
import asyncio, json, sys
from playwright.async_api import async_playwright
async def main():
  url=sys.argv[1]; prof=sys.argv[2]; inject=sys.argv[3] if len(sys.argv)>3 else ""
  w,h,dpr,mob={"desktop":(1440,900,1,False),"phone":(390,844,2,True)}[prof]
  async with async_playwright() as p:
    b=await p.chromium.launch(channel="chrome")
    ctx=await b.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=mob,has_touch=mob); pg=await ctx.new_page()
    if inject:
      async def handle(route):
        r=await route.fetch(); await route.fulfill(response=r, body=(await r.text())+chr(10)+inject, headers={k:v for k,v in r.headers.items() if k.lower() not in ("content-encoding","content-length","etag")})
      await pg.route("**/*.css", handle)
    await pg.goto(url); await pg.wait_for_timeout(4000)
    bc=await b.new_browser_cdp_session()
    chunks=[]; done=asyncio.get_event_loop().create_future()
    bc.on("Tracing.dataCollected", lambda e: chunks.extend(e["value"]))
    bc.on("Tracing.tracingComplete", lambda e: done.set_result(1))
    await bc.send("Tracing.start",{"traceConfig":{"includedCategories":["disabled-by-default-memory-infra"],"memoryDumpConfig":{"triggers":[]}},"transferMode":"ReportEvents"})
    await pg.wait_for_timeout(500)
    r=await bc.send("Tracing.requestMemoryDump",{"deterministic":True,"levelOfDetail":"detailed"})
    await bc.send("Tracing.end"); await done
    await b.close()
  procs={}
  for e in chunks:
    if e.get("ph")=="M" and e.get("name")=="process_name": procs[e["pid"]]=e["args"]["name"]
  out={}
  for e in chunks:
    if e.get("ph")!="v": continue
    a=e["args"]["dumps"].get("allocators",{}); pn=procs.get(e["pid"],str(e["pid"]))
    def sz(k):
      v=a.get(k,{}).get("attrs",{}).get("size",{}).get("value"); return int(v,16)/2**20 if v else None
    row={k:round(sz(k),1) for k in ("cc","gpu","skia","blink_gc","partition_alloc","malloc","shared_image","gpu/gl","gpu/shared_images","cc/tile_memory") if sz(k)}
    # tile memory detail
    tiles=[k for k in a if k.startswith("cc/tile_memory/provider_")]
    if row: out[pn]=row
  print(json.dumps(out))
asyncio.run(main())
