import asyncio, sys, re
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageChops
import numpy as np
css=Path(sys.argv[1]).read_text(encoding='utf-8'); T=int(sys.argv[2])
old=re.search(r'--grain:\s*(.*?);',css,re.S).group(1)
layers=[l.strip() for l in re.split(r',\s*(?=(?:radial|repeating-linear)-gradient)',old)]
new=f"image-set(url(grain-{T}@1x.webp) 1x, url(grain-{T}@2x.webp) 2x, url(grain-{T}@3x.webp) 3x) 0 0 / {T}px {T}px, "+", ".join(layers[8:])
colors=["#3f6b3f","#9bb45c","#ecd24a","#6a4e33","#f2ead4","#c9dcef","#553d26","#2f5a37"]
sizes=[(120,90),(330,210),(760,520),(1400,700)]
def page(g):
  cells="".join(f'<div style="width:{w}px;height:{h}px;margin:6px;display:inline-block;vertical-align:top;background:{g}, {c}"></div>' for (w,h) in sizes for c in colors[:2])
  cells+="".join(f'<div style="width:300px;height:200px;margin:6px;display:inline-block;background:{g}, {c}"></div>' for c in colors)
  return f'<html><body style="margin:0;background:#fff;width:1440px">{cells}</body></html>'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel="chrome")
    for dpr in (1,2):
      shots={}
      for tag,g in (("old",", ".join(layers)),("new",new)):
        pg=await (await b.new_context(viewport={"width":1440,"height":900},device_scale_factor=dpr)).new_page()
        await pg.goto(Path("blank.html").resolve().as_uri()); await pg.set_content(page(g)); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"cmp-{tag}-{dpr}x.png", full_page=True); shots[tag]=np.asarray(Image.open(f"cmp-{tag}-{dpr}x.png").convert("RGB")).astype(int)
      d=np.abs(shots["old"]-shots["new"]); lum=d.max(axis=2)
      print(f"T={T} dpr={dpr}: mean|d|={d.mean():.3f}/255  p99={np.percentile(lum,99):.0f}  p99.9={np.percentile(lum,99.9):.0f}  max={lum.max()}  pixels>8: {(lum>8).mean()*100:.3f}%")
      # average colour per cell must match (no tone shift)
      o=shots["old"].reshape(-1,3).mean(0); n=shots["new"].reshape(-1,3).mean(0); print("   mean colour old",o.round(2),"new",n.round(2))
      Image.fromarray(np.clip(lum*16,0,255).astype('uint8')).save(f"cmp-diff-x16-{T}-{dpr}x.png")
    await b.close()
Path("blank.html").write_text("<html></html>")
asyncio.run(main())
