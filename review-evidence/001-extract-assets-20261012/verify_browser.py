import json, sys, pathlib, time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(r'C:\Users\Administrator\AppData\Local\Temp\heartwood-extraction-20261012')
label=sys.argv[1]
url=sys.argv[2] if len(sys.argv)>2 else (ROOT/'before.html').as_uri()
results={}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    for name,viewport in [('desktop',{'width':1440,'height':1000}),('mobile',{'width':390,'height':844})]:
        ctx=browser.new_context(viewport=viewport)
        page=ctx.new_page(); errors=[]; failed=[]; responses=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda e:errors.append('console: '+e.text) if e.type=='error' else None)
        page.on('requestfailed',lambda r:failed.append({'url':r.url,'error':r.failure}))
        page.on('response',lambda r:responses.append({'url':r.url,'status':r.status}) if r.url.startswith('http') else None)
        page.goto(url,wait_until='networkidle',timeout=60000)
        page.evaluate('document.fonts.ready'); page.wait_for_timeout(1800)
        page.screenshot(path=str(ROOT/f'{label}-{name}.png'),full_page=True,animations='disabled')
        page.evaluate("window.qaEvents=[]; ['leaf:open','leaf:close'].forEach(e=>document.addEventListener(e,()=>qaEvents.push(e)))")
        r={'title':page.title(),'counts':page.evaluate("({cards:document.querySelectorAll('.card').length, leaves:document.querySelectorAll('button.leaf[data-item]').length, groups:document.querySelectorAll('#groups li').length, chips:document.querySelectorAll('.chip').length})"),'layout':page.evaluate("({width:innerWidth,docWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.body).fontFamily,treeWidth:document.querySelector('.tree').getBoundingClientRect().width})")}
        page.locator('.nav a[href="#work"]').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(700)
        r['navigation']=page.evaluate("({hash:location.hash,workTop:document.querySelector('#work').getBoundingClientRect().top})")
        card=page.locator('.card[data-open="forest-watch"]').first
        card.focus(); page.keyboard.press('Enter')
        page.wait_for_function("qaEvents.includes('leaf:open')",timeout=15000)
        r['cardDialog']={'title':page.locator('#dialog-title').inner_text(),'focus':page.evaluate('document.activeElement.id'),'backgroundInert':page.evaluate("[...document.querySelectorAll('[data-page]')].every(e=>e.inert)")}
        page.keyboard.press('Shift+Tab'); r['cardDialog']['tabTrapped']=page.evaluate("!!document.activeElement.closest('#dialog')")
        r['outgoingLinks']=page.locator('#dialog .dialog__links a').evaluate_all("els=>els.map(e=>({href:e.href,target:e.target,rel:e.rel}))")
        page.screenshot(path=str(ROOT/f'{label}-{name}-dialog.png'),animations='disabled')
        page.keyboard.press('Escape'); page.wait_for_function("qaEvents.includes('leaf:close')",timeout=15000)
        r['cardClose']={'hidden':page.locator('#dialog').is_hidden(),'focusRestored':card.evaluate('e=>e===document.activeElement')}
        page.evaluate('qaEvents=[]; window.scrollTo(0,0)'); page.wait_for_timeout(600)
        leaf=page.locator('button.leaf[data-item][tabindex="0"]').first
        if not leaf.count(): leaf=page.locator('button.leaf[data-item]:not([tabindex="-1"])').first
        r['leafId']=leaf.get_attribute('data-item'); leaf.focus(); page.keyboard.press('Enter')
        page.wait_for_function("qaEvents.includes('leaf:open')",timeout=15000)
        r['leafDialog']=page.locator('#dialog-title').inner_text()
        page.keyboard.press('Escape'); page.wait_for_function("qaEvents.includes('leaf:close')",timeout=15000)
        r['leafFocusRestored']=leaf.evaluate('e=>e===document.activeElement')
        page.locator('.chip[data-filter="work"]').click(); r['canopyFilter']=page.evaluate("({pressed:document.querySelector('.chip[data-filter=work]').getAttribute('aria-pressed'),filtered:document.querySelector('.tree').classList.contains('is-filtered'),lit:document.querySelectorAll('button.leaf.is-lit').length})")
        page.locator('#group-find').fill('Sierra'); page.wait_for_timeout(300)
        r['search']=page.evaluate("({tally:document.querySelector('#group-tally').textContent,visible:[...document.querySelectorAll('#groups li')].filter(e=>!e.hidden).map(e=>e.textContent),hits:document.querySelectorAll('.spore.is-hit').length,open:document.querySelector('#net-list').open})")
        group=page.locator('#groups li:not([hidden]) button').first; group.focus(); page.keyboard.press('Enter')
        page.wait_for_function("qaEvents.filter(e=>e==='leaf:open').length===2",timeout=15000)
        r['groupDialog']=page.locator('#dialog-title').inner_text(); page.keyboard.press('Escape'); page.wait_for_function("qaEvents.filter(e=>e==='leaf:close').length===2",timeout=15000)
        r['groupFocusRestored']=group.evaluate('e=>e===document.activeElement')
        page.locator('#group-find').fill('nonexistent synthetic group'); r['zeroSearch']=page.locator('#group-tally').inner_text(); page.locator('#group-find').fill(''); r['resetSearch']=page.locator('#group-tally').inner_text()
        r['images']=page.locator('img').evaluate_all('els=>els.map(e=>({src:e.src,complete:e.complete,width:e.naturalWidth}))')
        r['errors']=errors; r['failedRequests']=failed; r['responses']=responses
        results[name]=r; ctx.close()
    ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce'); page=ctx.new_page(); page.goto(url,wait_until='networkidle'); page.evaluate('document.fonts.ready')
    page.evaluate("window.opened=false; document.addEventListener('leaf:open',()=>window.opened=true)")
    leaf=page.locator('button.leaf[data-item]:not([tabindex="-1"])').first; leaf.focus(); start=time.monotonic(); page.keyboard.press('Enter'); page.wait_for_function('window.opened'); duration=time.monotonic()-start
    results['reducedMotion']={'matched':page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),'leafAnimation':leaf.evaluate("e=>getComputedStyle(e).animationName"),'dialogOpenSeconds':round(duration,3),'title':page.locator('#dialog-title').inner_text()}
    browser.close()
(ROOT/f'{label}-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
