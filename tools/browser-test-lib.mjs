// Portable review tooling; imports the separately locked review dependencies.
import {chromium, firefox, webkit} from './browser-deps.mjs';
import {existsSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createPreviewServer} from './serve.mjs';
import {PHOTO_FIXTURE_INIT,PHOTO_FIXTURE_INFO} from './photo-fixtures.mjs';

// ---- NETWORK GUARD: tests must never send traffic to third-party servers (abuse clicking outbound links could look like an attack on the site owner's partners).
// Layers (every context made through the fixture, fixture.launch() or guardBrowser()):
//  1. Chromium launches with a dead proxy (127.0.0.1:1) that loopback bypasses: any non-loopback request, hostname or IP literal, dies on this machine and is never sent.
//     This is used instead of context.route('**/*') because Playwright disables the HTTP cache while any route is registered, which would falsify load/cache measurements.
//  2. context 'requestfailed' records every non-loopback URL the page tried (the proof), in `blocked`.
//  3. An in-page capture-phase click handler cancels the navigation (preventDefault) of every anchor click that is not same-loopback http(s) (links, mailto:, tel:), so a test is never navigated
//     to an error page. The event still propagates, so the page's own handlers (e.g. a.card[data-open] opening the modal) run as for a visitor. The click is recorded as blocked unless a page
//     handler itself cancels it (it would not have navigated without the guard either).
//  4. Popups are closed. Firefox/WebKit have no launch-level proxy trick here: they (and guardBrowser(..,{route:true}), used by check-live-drift) use context.route('**/*') instead:
//     loopback and data:/blob:/about: pass, sub-resources are aborted, navigations get an empty 204.
// close()/assert() throws and process.exitCode=1 is set if anything was blocked. HW_ALLOW_EXTERNAL is rejected; the explicit allow(url, request) option is reserved for the scoped live-drift tool.
const LOOPBACK=new Set(['127.0.0.1','localhost','[::1]','::1']);
const hostOf=u=>{try{return new URL(u).hostname}catch{return ''}};
export const isLocalUrl=u=>{try{const x=new URL(u);return ['data:','blob:','about:'].includes(x.protocol)||(['http:','https:','ws:','wss:'].includes(x.protocol)&&LOOPBACK.has(x.hostname));}catch{return false;}};
const envAllowed=()=>{if((process.env.HW_ALLOW_EXTERNAL||'').trim())throw Error('HW_ALLOW_EXTERNAL is forbidden in ordinary browser tests; use the explicitly scoped live-drift tool for its authorized document');return [];};
export const guardLaunchOptions=engine=>engine==='chromium'?{proxy:{server:'http://127.0.0.1:1',bypass:['127.0.0.1','localhost','[::1]',...envAllowed()].join(',')}}:{};
const CAPTURE=`document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;let u;try{u=new URL(a.href)}catch{return}if(/^(data|blob|about):$/.test(u.protocol)||(/^https?:$/.test(u.protocol)&&/^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(u.hostname)))return;const cancel=e.preventDefault;let own=false;e.preventDefault=function(){own=true;return cancel.call(this);};cancel.call(e);setTimeout(()=>{if(!own)window.__hwBlock&&window.__hwBlock(a.href);});},true);`;
export function createGuard({allow=()=>false,failOnBlock=true,route=false}={}) {
  envAllowed(); // Refuse inherited egress permissions before exposing any context.
  const blocked=[];
  const note=(url,why)=>{blocked.push({url,why});if(failOnBlock){process.exitCode=1;if(blocked.length<=5)console.error(`NETWORK GUARD: blocked ${why}: ${String(url).slice(0,160)}`);}};
  const allowed=(url,request)=>isLocalUrl(url)||envAllowed().includes(hostOf(url))||allow(url,request);
  const guardContext=async context=>{
    if(context.__hwGuarded)return context;context.__hwGuarded=true;
    await context.exposeFunction('__hwBlock',url=>note(url,'link click cancelled')).catch(()=>{});
    await context.addInitScript(CAPTURE);
    // Shared desktop/phone/direct/CDP seam, preserving real HTTP cache behavior.
    await context.addInitScript(PHOTO_FIXTURE_INIT);
    context.on('requestfailed',r=>{if(!allowed(r.url(),r))note(r.url(),'request '+r.resourceType());});
    if(route)await context.route('**/*',(rt,request)=>{
      const url=request.url();
      if(allowed(url,request))return rt.fallback();
      note(url,'request '+request.resourceType()+' (routed)');
      return request.isNavigationRequest()?rt.fulfill({status:204,body:''}):rt.abort('blockedbyclient');});
    context.on('page',async p=>{let opener;try{opener=await p.opener();}catch{return;}if(!opener)return;await p.waitForLoadState('load',{timeout:5000}).catch(()=>{});if(!isLocalUrl(p.url())||p.url()==='about:blank')await p.close().catch(()=>{});});
    return context;};
  const guardBrowser=browser=>{
    const nc=browser.newContext.bind(browser),np=browser.newPage.bind(browser);
    browser.newContext=async(...a)=>guardContext(await nc(...a));
    browser.newPage=async(...a)=>{const p=await np(...a);await guardContext(p.context());return p;};
    return browser;};
  const assert=()=>{if(failOnBlock&&blocked.length)throw Error(`NETWORK GUARD: ${blocked.length} request(s) would have left the loopback interface:\n`+blocked.slice(0,20).map(b=>`  ${b.why}: ${String(b.url).slice(0,200)}`).join('\n'));};
  return {blocked,guardContext,guardBrowser,assert,photoFixtures:PHOTO_FIXTURE_INFO};
}
export const guardBrowser=(browser,opts)=>{const g=createGuard(opts);g.guardBrowser(browser);return g;};

// Help/negative/config-only tests must fail before an accidental native allocation.
export function assertBrowserAllocationAllowed(env=process.env){
  if(env?.HW_FORBID_BROWSER_ALLOCATION==='1'||process.env.HW_FORBID_BROWSER_ALLOCATION==='1'){const error=Error('HW_FORBID_BROWSER_ALLOCATION: browser launch/server allocation forbidden in an early CLI test; this sentinel is a TEST FAILURE, never an expected invalid-option result');error.code='HW_BROWSER_ALLOCATION_FORBIDDEN';throw error;}
}

// Every browser CLI rejects unrecognised flags before allocating resources.
export function browserToolCLI(options={},description='Browser acceptance/diagnostic tool; configuration uses the documented HW_ environment variables.') {
  const {values}=parseArgs({options:{help:{type:'boolean',short:'h'},...options}});
  if(values.help){console.log(description+'\nUsage: node '+basename(process.argv[1])+' '+Object.keys(options).map(k=>'[--'+k+(options[k].type==='string'?' VALUE':'')+']').join(' '));process.exit(0);}
  if(values.out!==undefined&&!values.out.trim())throw Error('Output path must not be empty');
  if(process.env.HW_OUT===undefined&&!values.out)process.env.HW_OUT=resolve(import.meta.dirname,'../output/playwright/independent-runs',basename(process.argv[1],'.mjs'),Date.now()+'-'+randomUUID());
  if(process.env.HW_OUT!==undefined&&!process.env.HW_OUT.trim())throw Error('HW_OUT must not be empty');
  return values;
}
// Lifecycle remains lazy when this module is imported by a pure test or build.
async function runtimeFor(runtime, options={}) {
  if(!runtime){const {ensureToolRuntime}=await import('./tool-runtime.mjs');runtime=ensureToolRuntime({name:process.argv[1]||'browser-tool',...options});}
  await runtime.ready;return runtime;
}
export async function listenServer(server, options={}) {return (await import('./server-lifecycle.mjs')).listenServer(server,options);}
export async function closeServer(server, options={}) {return (await import('./server-lifecycle.mjs')).closeServer(server,options);}
const ownedBrowsers=new WeakSet(),ownedContexts=new WeakSet(),ownedPages=new WeakSet(),ownedCDP=new WeakSet();
function boundMethods(object, names, runtime, prefix) {
  for(const name of names)if(typeof object[name]==='function'){
    const original=object[name].bind(object);
    object[name]=(...args)=>runtime.deadline(prefix+'.'+name,()=>original(...args));
  }
}
export function manageCDPSession(session, runtime, owner) {
  if(ownedCDP.has(session))return session;ownedCDP.add(session);
  const send=session.send.bind(session);
  session.send=(method,...args)=>runtime.deadline('CDP '+method,()=>send(method,...args),{cleanup:method==='IO.close'});
  if(typeof session.detach==='function'){
    const detach=session.detach.bind(session);let closed=false,closing;
    const unregister=runtime.onCleanup('CDP detach',async()=>{if(!closed)await session.detach();},{kind:'cdp',details:{runId:runtime.runId}});
    const ended=()=>{closed=true;unregister();};
    session.on?.('close',ended);owner?.on?.('close',ended);owner?.on?.('disconnected',ended);
    session.detach=()=>{if(closed)return Promise.resolve();return closing||=(async()=>{try{await runtime.deadline('CDP detach',()=>detach(),{timeoutMs:3000,cleanup:true});closed=true;}catch(error){if(!closed)throw error;}finally{if(closed)unregister();}})();};
  }
  return session;
}
function managePage(page,runtime) {
  if(ownedPages.has(page))return page;ownedPages.add(page);
  // Playwright does not apply default action timeouts to evaluate/evaluateHandle.
  boundMethods(page,['evaluate','evaluateHandle','addInitScript','addStyleTag','setViewportSize','bringToFront'],runtime,'page');
  for(const [name,methods]of [['mouse',['move','click','dblclick','down','up','wheel']],['keyboard',['press','type','insertText','down','up']],['touchscreen',['tap']]])if(page[name])boundMethods(page[name],methods,runtime,'page.'+name);
  return page;
}
function manageContext(context,runtime) {
  if(ownedContexts.has(context))return context;ownedContexts.add(context);
  context.setDefaultTimeout?.(runtime.policy?.stepTimeoutMs||runtime.stepTimeoutMs||30000);
  context.setDefaultNavigationTimeout?.(runtime.policy?.stepTimeoutMs||runtime.stepTimeoutMs||30000);
  const newPage=context.newPage.bind(context),sessions=new Set();
  context.newPage=async(...args)=>managePage(await runtime.deadline('context.newPage',()=>newPage(...args)),runtime);
  if(context.newCDPSession){const newCDP=context.newCDPSession.bind(context);context.newCDPSession=async(...args)=>{const session=manageCDPSession(await runtime.deadline('context.newCDPSession',()=>newCDP(...args)),runtime,context);sessions.add(session);session.on?.('close',()=>sessions.delete(session));return session;};}
  boundMethods(context,['addInitScript','exposeFunction','route'],runtime,'context');
  const close=context.close.bind(context);let closed=false,closing;
  const unregister=runtime.onCleanup('browser context close',async()=>{if(!closed)await context.close();},{kind:'browser-context',details:{runId:runtime.runId}});
  context.on?.('close',()=>{closed=true;unregister();});
  context.close=(...args)=>{if(closed)return Promise.resolve();return closing||=(async()=>{const results=await Promise.allSettled([...sessions].map(session=>session.detach()));try{if(!closed)await runtime.deadline('browser context close',()=>close(...args),{timeoutMs:3000,cleanup:true});closed=true;}catch(error){if(!closed)results.push({status:'rejected',reason:error});}finally{if(closed)unregister();}const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));})();};
  return context;
}
function manageBrowser(browser,runtime) {
  if(ownedBrowsers.has(browser))return browser;ownedBrowsers.add(browser);
  const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser),contexts=new Set(),sessions=new Set();
  browser.newContext=async(...args)=>{const context=manageContext(await runtime.deadline('browser.newContext',()=>newContext(...args)),runtime);contexts.add(context);context.on?.('close',()=>contexts.delete(context));return context;};
  browser.newPage=async(...args)=>{const page=await runtime.deadline('browser.newPage',()=>newPage(...args));const context=manageContext(page.context(),runtime);contexts.add(context);context.on?.('close',()=>contexts.delete(context));return managePage(page,runtime);};
  if(browser.newBrowserCDPSession){const newCDP=browser.newBrowserCDPSession.bind(browser);browser.newBrowserCDPSession=async(...args)=>{const session=manageCDPSession(await runtime.deadline('browser.newBrowserCDPSession',()=>newCDP(...args)),runtime,browser);sessions.add(session);session.on?.('close',()=>sessions.delete(session));return session;};}
  const close=browser.close.bind(browser);let closing;
  browser.close=(...args)=>closing||=(async()=>{const rows=await Promise.allSettled([...sessions].map(session=>session.detach()).concat([...contexts].map(context=>context.close())));try{await runtime.deadline('browser transport close',()=>close(...args),{timeoutMs:3000,cleanup:true});}catch(error){rows.push({status:'rejected',reason:error});}const errors=rows.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));})();
  return browser;
}
// launchServer exposes a public process() handle. Register its PID incarnation
// before connecting or allocating a context; the external run watchdog owns the
// inherited run token even if this worker blocks or dies during launch.
export async function managedLaunch(browserType, options={}, {runtime:providedRuntime}={}) {
  assertBrowserAllocationAllowed(options.env);
  const runtime=await runtimeFor(providedRuntime);
  if(!browserType?.launchServer)throw Error('Unsupported browser engine');
  // Tests never borrow a person's Chrome profile: Playwright creates a fresh temp --user-data-dir under the run scratch dir.
  if(options.userDataDir!==undefined||(options.args||[]).some(a=>/^--(user-data-dir|profile-directory)(=|$)/.test(a)))throw Error('Browser tests must use a fresh temporary profile; --user-data-dir/--profile-directory/userDataDir are refused');
  // A macOS app-bundle browser spawned from a seatbelt sandbox (e.g. a sandboxed workspace) is denied LaunchServices/WindowServer
  // lookups and abort()s in TransformProcessType/_RegisterApplication ~100 ms after spawn, which shows the user a
  // "Google Chrome quit unexpectedly" dialog. `lsappinfo front` prints an ASN only when LaunchServices is reachable; refuse before spawning.
  if(process.platform==='darwin'&&/\.app\/Contents\/MacOS\//.test(options.executablePath||'')){const probe=await runtime.runCommand('/usr/bin/lsappinfo',['front'],{timeoutMs:5000,label:'LaunchServices reachability probe'});if(probe.status!==0||!/^ASN:/.test(probe.stdout))throw Error('Refusing to launch '+options.executablePath+': LaunchServices is unreachable (sandboxed shell), so the app would abort and macOS would show a crash dialog. Run browser tools outside the sandbox.');}
  const env=Object.fromEntries(Object.entries({...process.env,...options.env,HW_TOOL_RUN_TOKEN:runtime.runId,HW_TOOL_SCOPE_TOKEN:runtime.scopeToken||runtime.runId,HW_TOOL_RUN_DIR:runtime.runDir||process.env.HW_TOOL_RUN_DIR,...(runtime.scratchDir?{TMPDIR:runtime.scratchDir,TMP:runtime.scratchDir,TEMP:runtime.scratchDir}:{})}).filter(([,value])=>value!==undefined));
  const launchOptions={host:'127.0.0.1',...options,env,timeout:options.timeout??30000,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false};
  const server=await runtime.deadline('browser launch',()=>browserType.launchServer(launchOptions),{timeoutMs:launchOptions.timeout});
  let browser,closing,unregisterEndpoint=()=>{};
  const close=()=>closing||= (async()=>{
    const results=[];
    // Child session/context closes finish before the public process server
    // closes its transport; all calls share their idempotent pending promise.
    if(browser)try{await runtime.deadline('browser disconnect/close',()=>browserClose(),{timeoutMs:3000,cleanup:true});}catch(reason){results.push({status:'rejected',reason});}
    try{await runtime.deadline('browser process close',()=>server.close(),{timeoutMs:3000,cleanup:true});unregisterEndpoint();}catch(reason){results.push({status:'rejected',reason});}
    unregister();const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(failures.length)throw new AggregateError(failures,failures.map(e=>e.message).join('; '));
  })();
  let browserClose;
  const unregister=runtime.onCleanup('owned browser and process close',close,{kind:'browser',details:{pid:server.process()?.pid,engine:browserType.name?.()||'browser'}});
  try {
    const endpointText=server.wsEndpoint(),endpoint=new URL(endpointText),explicitPort=Number(endpointText.split('/')[2]?.match(/:(\d+)$/)?.[1]);
    if(!['ws:','wss:'].includes(endpoint.protocol)||!isLocalUrl(endpoint.href)||endpoint.username||endpoint.password||!Number.isInteger(explicitPort)||explicitPort<1||explicitPort>65535)throw Error('Owned browser endpoint must be an explicit loopback WebSocket URL');
    // launchServer hosts its public RPC listener in this Node worker. Register
    // it synchronously before registration/connect yields or publishes browser.
    unregisterEndpoint=runtime.onCleanup('owned Playwright WebSocket listener',close,{kind:'listener',details:{host:endpoint.hostname,port:explicitPort,endpoint:endpoint.href,scope:'owned public Playwright RPC server'}});
    await runtime.registerProcess(server.process(),{label:'Playwright '+(browserType.name?.()||'browser'),group:process.platform!=='win32'});
    await (await import('./browser-temp-lifecycle.mjs')).adoptBrowserSingleton(runtime,server.process());
    browser=manageBrowser(await runtime.deadline('browser connect',()=>browserType.connect(endpoint.href,{timeout:30000})),runtime);
    browserClose=browser.close.bind(browser);browser.close=close;
    return browser;
  } catch(error) {try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],error.message+'; cleanup: '+cleanupError.message);}throw error;}
}
// A CDP endpoint is borrowed: Playwright's Chromium CDP browser.close()
// disconnects its transport (coreBundle _connectOverCDPImpl browserProcess.close),
// and this wrapper closes only NEW contexts, never the remote default context.
export async function managedConnectOverCDP(url,{runtime:providedRuntime,browserType=chromium,timeoutMs=30000}={}) {
  if(!isLocalUrl(url))throw Error('CDP connection must use a loopback endpoint');
  const runtime=await runtimeFor(providedRuntime);
  let endpoint=url;
  if(/^https?:/.test(url)){
    const versionURL=new URL(url);versionURL.pathname=versionURL.pathname.replace(/\/$/,'')+'/json/version';
    const version=await runtime.deadline('loopback CDP version',async signal=>{const response=await fetch(versionURL,{signal,redirect:'error'});if(!response.ok)throw Error('CDP version failed '+response.status);return response.json();},{timeoutMs});
    endpoint=version.webSocketDebuggerUrl;if(!endpoint||!/^wss?:/.test(endpoint)||!isLocalUrl(endpoint))throw Error('CDP version did not provide an owned loopback websocket endpoint');
  }
  const browser=manageBrowser(await runtime.deadline('borrowed CDP connect',()=>browserType.connectOverCDP(endpoint,{timeout:timeoutMs,noDefaults:true}),{timeoutMs}),runtime);
  const disconnect=browser.close.bind(browser),newContext=browser.newContext.bind(browser),contexts=new Set();let closing;
  browser.contexts=()=>[...contexts];
  browser.newContext=async(...args)=>{const context=await newContext(...args);contexts.add(context);context.on?.('close',()=>contexts.delete(context));return context;};
  browser.newPage=async options=>{const context=await browser.newContext(options);return context.newPage();};
  const close=()=>closing||=(async()=>{
    const rows=await Promise.allSettled([...contexts].map(c=>c.close()));
    try{await runtime.deadline('borrowed CDP disconnect',()=>disconnect(),{timeoutMs:3000,cleanup:true});}catch(error){rows.push({status:'rejected',reason:error});}
    unregister();const errors=rows.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));
  })();
  const unregister=runtime.onCleanup('borrowed CDP owned contexts and disconnect',close,{kind:'borrowed-browser-connection',details:{endpoint:url,ownsRemoteProcess:false}});browser.close=close;return browser;
}
export async function waitForCDPEvent(session,event,{runtime:providedRuntime,timeoutMs=30000}={}) {
  let listener;const pending=new Promise(resolve=>{listener=resolve;session.once(event,listener);});
  try{const runtime=await runtimeFor(providedRuntime);return await runtime.deadline('CDP event '+event,()=>pending,{timeoutMs});}
  finally{session.off(event,listener);}
}
export async function readCDPStream(session,stream,{runtime:providedRuntime,timeoutMs=30000}={}) {
  const runtime=await runtimeFor(providedRuntime);
  if(!stream)throw Error('CDP trace completed without a stream');
  try{return await runtime.deadline('CDP trace stream read',async()=>{
    const chunks=[];for(;;){const chunk=await session.send('IO.read',{handle:stream,size:1<<20});chunks.push(chunk.base64Encoded?Buffer.from(chunk.data,'base64'):Buffer.from(chunk.data));if(chunk.eof)break;}return Buffer.concat(chunks).toString('utf8');
  },{timeoutMs});}
  finally{await runtime.deadline('CDP trace stream close',()=>session.send('IO.close',{handle:stream}),{timeoutMs:3000,cleanup:true});}
}
export async function finishCDPTrace(session,{runtime:providedRuntime,timeoutMs=30000}={}) {
  const runtime=await runtimeFor(providedRuntime);let listener;
  const pending=new Promise(resolve=>{listener=resolve;session.once('Tracing.tracingComplete',listener);});
  try{const {stream}=await runtime.deadline('CDP finish trace',async()=>{await session.send('Tracing.end');return await pending;},{timeoutMs});return await readCDPStream(session,stream,{runtime,timeoutMs});}
  finally{session.off('Tracing.tracingComplete',listener);}
}
// Dependency injection is for pure lifecycle tests; production fixture defaults
// remain the locked browser engines and loopback preview implementation.
export async function createBrowserFixture({siteRoot=process.env.HW_SITE_ROOT,engine=process.env.HW_BROWSER||'chromium',runtime:providedRuntime,createServer=createPreviewServer,browserTypes={chromium,firefox,webkit},env=process.env,runTimeoutMs}={}) {
  envAllowed();if(!browserTypes[engine])throw Error('Unsupported browser engine '+engine);
  assertBrowserAllocationAllowed(env);
  const runtime=await runtimeFor(providedRuntime,runTimeoutMs===undefined?{}:{runTimeoutMs});
  const server=await runtime.deadline('create loopback preview',()=>createServer(siteRoot?{siteRoot:resolve(siteRoot)}:{}));
  const browsers=new Set(),guard=createGuard({route:engine!=='chromium'});let closing;
  const close=()=>closing||= (async()=>{
    const results=await Promise.allSettled([...browsers].map(b=>b.close()));
    try{await closeServer(server);}catch(error){results.push({status:'rejected',reason:error});}
    unregister();try{guard.assert();}catch(error){results.push({status:'rejected',reason:error});}
    const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(failures.length)throw new AggregateError(failures,failures.map(e=>e.message).join('; '));
  })();
  const unregister=runtime.onCleanup('browser fixture close',close);
  try {
    await listenServer(server,{runtime});const base='http://127.0.0.1:'+server.address().port;
    const executablePath=env.HW_BROWSER_EXECUTABLE||(engine==='chromium'&&process.platform==='darwin'&&existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
    const launch=async(args=[])=>{if(closing)throw Error('Cannot launch a browser after fixture shutdown');const b=await managedLaunch(browserTypes[engine],{headless:env.HW_HEADLESS!=='0',executablePath,args,...guardLaunchOptions(engine)},{runtime});browsers.add(b);return guard.guardBrowser(b);};
    const browser=await launch();return {browser,base,engine,launch,blocked:guard.blocked,guard,runtime,close,photoFixtures:PHOTO_FIXTURE_INFO};
  } catch(error){try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],error.message+'; cleanup: '+cleanupError.message);}throw error;}
}
export const browserFixture=options=>createBrowserFixture(options);
