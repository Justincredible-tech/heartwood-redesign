import asyncio, sys
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
OUT=sys.argv[1]
FREEZE="""()=>{document.getAnimations().forEach(a=>{try{a.pause();a.currentTime=4200}catch(e){}});}"""
async def shoot(b,url,w,h,dpr,mob,tag):
  ctx=await b.new_context(viewport={"width":w,"height":h},device_scale_factor=dpr,is_mobile=mob,has_touch=mob); pg=await ctx.new_page()
  await pg.goto(url); await pg.wait_for_timeout(3500); await pg.evaluate("document.fonts.ready")
  await pg.evaluate(FREEZE); await pg.wait_for_timeout(400)
  await pg.screenshot(path=f"{OUT}/{tag}.png", full_page=True, animations="allow")
  await ctx.close()
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel="chrome")
    for (w,h,dpr,mob,name) in ((1440,900,1,False,"desk"),(390,844,2,True,"phone")):
      await shoot(b,"http://127.0.0.1:8004/heartwood-site.html",w,h,dpr,mob,f"old-{name}")
      await shoot(b,"http://127.0.0.1:8003/heartwood-site.html",w,h,dpr,mob,f"new-{name}")
      o=np.asarray(Image.open(f"{OUT}/old-{name}.png").convert("RGB")).astype(int); n=np.asarray(Image.open(f"{OUT}/new-{name}.png").convert("RGB")).astype(int)
      if o.shape!=n.shape: print(name,"SHAPE DIFFERS",o.shape,n.shape); continue
      d=np.abs(o-n).max(2)
      big=(d>40)
      print(f"{name}: size={o.shape[1]}x{o.shape[0]} mean|d|={np.abs(o-n).mean():.2f} p99={np.percentile(d,99):.0f} max={d.max()} px>40={big.mean()*100:.4f}% mean colour old={o.reshape(-1,3).mean(0).round(2)} new={n.reshape(-1,3).mean(0).round(2)}")
      Image.fromarray(np.clip(d*6,0,255).astype('uint8')).save(f"{OUT}/diff-x6-{name}.png")
      Image.fromarray((big*255).astype('uint8')).save(f"{OUT}/big-{name}.png")
    await b.close()
asyncio.run(main())
