import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as lib from '../tools/browser-test-lib.mjs';
const runtime=()=>({runId:'pure-fixture',probeOutput:'ASN:0x0-0x1:\n',probes:[],async runCommand(command,args){this.probes.push([command,...args]);return {status:0,stdout:this.probeOutput};},stepTimeoutMs:30,cleanups:[],processes:[],step(){},onCleanup(label,fn,options={}){const row={label,fn,...options};this.cleanups.push(row);return()=>this.cleanups.splice(this.cleanups.indexOf(row),1);},async registerProcess(child,options){this.processes.push({child,options});},async deadline(label,operation,{timeoutMs=30}={}){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' deadline')),timeoutMs);})]);}finally{clearTimeout(timer);}}});
class Server extends EventEmitter { constructor({fail=false}={}){super();this.fail=fail;this.closed=0;this.listening=false;}listen(_port,_host,done){queueMicrotask(()=>{if(this.fail)this.emit('error',Error('listen failure'));else{this.listening=true;done?.();this.emit('listening');}});return this;}address(){return {port:12345};}close(done){this.closed++;this.listening=false;queueMicrotask(()=>{done();this.emit('close');});}closeAllConnections(){this.connectionsClosed=true;}}
const types=(rt,{failConnect=false,failClose=false}={})=>{const servers=[];const browsers=[];return {servers,browsers,types:{chromium:{async launchServer(options){const s={options,closed:0,process:()=>({pid:43210}),wsEndpoint:()=> 'ws://127.0.0.1:123/ws',async close(){this.closed++;}};servers.push(s);return s;},async connect(){if(failConnect)throw Error('connect failure');const b=new EventEmitter();b.newContext=async()=>{const c=new EventEmitter();c.exposeFunction=async()=>{};c.addInitScript=async()=>{};c.setDefaultTimeout=v=>c.defaultTimeout=v;c.setDefaultNavigationTimeout=v=>c.navigationTimeout=v;c.close=async()=>{};c.newPage=async()=>{const p=new EventEmitter();p.context=()=>c;p.evaluate=async()=>{};return p;};return c;};b.newPage=async()=>{const c=await b.newContext();return c.newPage();};b.closed=0;b.close=async()=>{b.closed++;if(failClose)throw Error('browser close failure');b.emit('disconnected');};browsers.push(b);return b;}}}};};
test('fixture closes primary and secondary browser servers and preview despite close failure',async()=>{assert.equal(typeof lib.createBrowserFixture,'function');const rt=runtime(),s=new Server(),fake=types(rt,{failClose:true});const fx=await lib.createBrowserFixture({runtime:rt,createServer:async()=>s,browserTypes:fake.types,env:{}});await fx.launch(['--force-dark-mode']);await assert.rejects(fx.close(),/close failure/);assert.equal(fake.servers.length,2);assert.deepEqual(fake.servers.map(s=>s.closed),[1,1]);assert.equal(s.closed,1);assert.equal(rt.processes.length,2);assert(fake.servers.every(s=>s.options.handleSIGTERM===false&&s.options.handleSIGINT===false&&s.options.handleSIGHUP===false));});
test('fixture rolls back server and browser-server when connection fails',async()=>{assert.equal(typeof lib.createBrowserFixture,'function');const rt=runtime(),s=new Server(),fake=types(rt,{failConnect:true});await assert.rejects(lib.createBrowserFixture({runtime:rt,createServer:async()=>s,browserTypes:fake.types,env:{}}),/connect failure/);assert.equal(s.closed,1);assert.equal(fake.servers[0].closed,1);});
test('listen failures reject and release their listener rather than waiting forever',async()=>{assert.equal(typeof lib.listenServer,'function');const s=new Server({fail:true});await assert.rejects(lib.listenServer(s,{runtime:runtime()}),/listen failure/);assert.equal(s.listenerCount('error'),0);});
test('missing CDP event rejects at deadline and removes listener',async()=>{assert.equal(typeof lib.waitForCDPEvent,'function');const cdp=new EventEmitter();await assert.rejects(lib.waitForCDPEvent(cdp,'Tracing.tracingComplete',{runtime:runtime(),timeoutMs:15}),/deadline/);assert.equal(cdp.listenerCount('Tracing.tracingComplete'),0);});
test('CDP trace captures synchronous completion, decodes base64, and closes IO even if read fails',async()=>{assert.equal(typeof lib.finishCDPTrace,'function');let closed=0;const cdp=new EventEmitter();cdp.send=async(method)=>{if(method==='Tracing.end'){cdp.emit('Tracing.tracingComplete',{stream:'owned'});return {};}if(method==='IO.read')return {data:Buffer.from('trace').toString('base64'),base64Encoded:true,eof:true};if(method==='IO.close')closed++;};assert.equal(await lib.finishCDPTrace(cdp,{runtime:runtime()}),'trace');assert.equal(closed,1);cdp.send=async method=>{if(method==='Tracing.end')cdp.emit('Tracing.tracingComplete',{stream:'owned'});if(method==='IO.read')throw Error('read failure');if(method==='IO.close')closed++;};await assert.rejects(lib.finishCDPTrace(cdp,{runtime:runtime()}),/read failure/);assert.equal(closed,2);});
test('borrowed CDP connection exposes and closes only contexts it creates',async()=>{assert.equal(typeof lib.managedConnectOverCDP,'function');const rt=runtime(),b=new EventEmitter(),borrowed={closed:0,close(){this.closed++;}},owned=[];let disconnected=0;b.contexts=()=>[borrowed,...owned];b.close=async()=>{disconnected++;};b.newContext=async()=>{const c=new EventEmitter();c.close=async()=>{c.closed=(c.closed||0)+1;c.emit('close');};c.newPage=async()=>({context:()=>c});owned.push(c);return c;};b.newPage=async()=>{throw Error('must not reuse existing browser defaults');};const browserType={connectOverCDP:async()=>b};const connection=await lib.managedConnectOverCDP('ws://127.0.0.1:1234/devtools/browser/owned',{runtime:rt,browserType});assert.deepEqual(connection.contexts(),[]);const c=await connection.newContext();await connection.close();assert.equal(c.closed,1);assert.equal(borrowed.closed,0);assert.equal(disconnected,1);assert.equal(rt.processes.length,0);});
test('cancelled run still performs cleanup using independent cleanup deadlines',async()=>{const rt=runtime(),deadline=rt.deadline.bind(rt);rt.deadline=(label,operation,options={})=>rt.cancelled&&!options.cleanup?Promise.reject(Error('run cancelled')):deadline(label,operation,options);const server=new Server(),fake=types(rt),fx=await lib.createBrowserFixture({runtime:rt,createServer:async()=>server,browserTypes:fake.types,env:{}});rt.cancelled=true;await fx.close();assert.equal(fake.servers[0].closed,1);assert.equal(server.closed,1);});
test('CDP listener is removed when runtime bootstrap fails',async()=>{const session=new EventEmitter();await assert.rejects(lib.waitForCDPEvent(session,'Tracing.tracingComplete',{runtime:{ready:Promise.reject(Error('bootstrap failure'))}}),/bootstrap failure/);assert.equal(session.listenerCount('Tracing.tracingComplete'),0);});

test('concurrent shutdown closes child CDP then context before owned browser transport',async()=>{
 const rt=runtime(),order=[];let attached=true,contextClosed=false;const cdp=new EventEmitter();cdp.send=async()=>({});cdp.detach=async()=>{await new Promise(r=>setImmediate(r));attached=false;order.push('CDP');cdp.emit('close');};
 const c=new EventEmitter();c.newPage=async()=>({context:()=>c});c.newCDPSession=async()=>cdp;c.close=async()=>{if(attached)throw Error('context closed before CDP detached');await new Promise(r=>setImmediate(r));contextClosed=true;order.push('context');c.emit('close');};
 const b=new EventEmitter();b.newContext=async()=>c;b.newPage=async()=>({context:()=>c});b.close=async()=>{if(!contextClosed)throw Error('browser transport closed before context');order.push('browser');b.emit('disconnected');};
 const type={name:()=> 'chromium',launchServer:async()=>({process:()=>({pid:43210}),wsEndpoint:()=> 'ws://127.0.0.1:123/ws',close:async()=>{}}),connect:async()=>b};
 const browser=await lib.managedLaunch(type,{}, {runtime:rt}),context=await browser.newContext();await context.newCDPSession({});const results=await Promise.allSettled([...rt.cleanups].reverse().map(row=>row.fn()));assert.deepEqual(results.filter(r=>r.status==='rejected'),[]);assert.deepEqual(order,['CDP','context','browser']);
});

test('public Playwright WebSocket listener is registered before browser publication and closes once',async()=>{
 const rt=runtime(),fake=types(rt);const browser=await lib.managedLaunch(fake.types.chromium,{}, {runtime:rt});const endpoint=rt.cleanups.find(row=>row.kind==='listener'&&row.details?.port===123&&row.details?.endpoint==='ws://127.0.0.1:123/ws');assert(endpoint,'owned Node RPC listener must have a native-owner-bound descriptor');await Promise.all([endpoint.fn(),browser.close()]);assert.equal(fake.servers[0].closed,1);assert.equal(rt.cleanups.includes(endpoint),false);
});
test('public browser endpoint must be explicit loopback WebSocket before connecting',async()=>{
 for(const url of ['ws://example.com:123/ws','ws://127.0.0.1/ws','http://127.0.0.1:123/ws','ws://user:pass@127.0.0.1:123/ws']){const rt=runtime();let connected=false,closed=0;const type={name:()=> 'chromium',launchServer:async()=>({process:()=>({pid:43210}),wsEndpoint:()=>url,close:async()=>{closed++;}}),connect:async()=>{connected=true;throw Error('must not connect');}};await assert.rejects(lib.managedLaunch(type,{}, {runtime:rt}),/loopback WebSocket/);assert.equal(connected,false);assert.equal(closed,1);}
});

test('explicit standard WebSocket port remains registered after URL normalization',async()=>{
 const rt=runtime(),fake=types(rt),type=fake.types.chromium,launch=type.launchServer;type.launchServer=async options=>{const server=await launch(options);server.wsEndpoint=()=> 'ws://127.0.0.1:80/ws';return server;};const browser=await lib.managedLaunch(type,{}, {runtime:rt});assert(rt.cleanups.some(row=>row.kind==='listener'&&row.details?.port===80));await browser.close();
});

test('launches never use a personal Chrome profile: fixture passes none and explicit profiles are refused before spawn',async()=>{
 const rt=runtime(),server=new Server(),fake=types(rt),fx=await lib.createBrowserFixture({runtime:rt,createServer:async()=>server,browserTypes:fake.types,env:{}});await fx.launch(['--force-dark-mode']);await fx.close();
 for(const {options} of fake.servers){assert.equal(options.userDataDir,undefined);assert(!options.args.some(a=>/user-data-dir|profile-directory/.test(a)),options.args.join(' '));}
 const home='/home/someone/Library/Application Support/Google/Chrome';
 for(const options of [{args:['--user-data-dir='+home]},{args:['--user-data-dir',home]},{args:['--profile-directory=Default']},{userDataDir:home}])await assert.rejects(lib.managedLaunch(fake.types.chromium,options,{runtime:rt}),/fresh temporary profile/);
 assert.equal(fake.servers.length,2);
});

test('managed visibility defaults to headless despite explicit false and inherited debug settings',async()=>{
 for(const options of [{},{headless:false},{headless:true},{headless:false,env:{HW_HEADLESS:'0',PWDEBUG:'1'}}]){
  const rt=runtime(),fake=types(rt),browser=await lib.managedLaunch(fake.types.chromium,options,{runtime:rt});
  try{assert.equal(fake.servers[0].options.headless,true);}finally{await browser.close();}
  assert.equal(fake.servers[0].closed,1);
 }
});
test('fixture visibility ignores legacy environment override and exposes actual mode',async()=>{
 const rt=runtime(),s=new Server(),fake=types(rt),fx=await lib.createBrowserFixture({runtime:rt,createServer:async()=>s,browserTypes:fake.types,env:{HW_HEADLESS:'0'}});
 try{await fx.launch();assert.equal(fx.headless,true);assert.equal(fx.requiresVisibleWindow,null);assert(fake.servers.every(row=>row.options.headless===true));}finally{await fx.close();}
 assert.equal(s.closed,1);
});
test('managed visibility permits only explicit OS window requirements',async()=>{
 for(const requirement of ['os-focus','window-occlusion','os-lifecycle']){
  const rt=runtime(),fake=types(rt),browser=await lib.managedLaunch(fake.types.chromium,{headless:true},{runtime:rt,requiresVisibleWindow:requirement});
  try{assert.equal(fake.servers[0].options.headless,false);}finally{await browser.close();}
 }
 for(const requiresVisibleWindow of [null,'','mobile','performance','debug',true,{}]){
  const rt=runtime(),fake=types(rt);await assert.rejects(lib.managedLaunch(fake.types.chromium,{}, {runtime:rt,requiresVisibleWindow}),/visible.window requirement/i);
  assert.equal(fake.servers.length,0);assert.equal(rt.processes.length,0);
 }
 const rt=runtime(),fake=types(rt);let allocated=false;
 await assert.rejects(lib.createBrowserFixture({runtime:rt,createServer:async()=>{allocated=true;return new Server();},browserTypes:fake.types,requiresVisibleWindow:'mobile'}),/visible.window requirement/i);
 assert.equal(allocated,false);
});
test('browser visibility arguments cannot override the managed launch mode',async()=>{
 for(const arg of ['--headless','--headless=false','--headed','--headful','--no-headless']){
  const rt=runtime(),fake=types(rt);await assert.rejects(lib.managedLaunch(fake.types.chromium,{args:[arg]},{runtime:rt}),/visibility.*argument/i);assert.equal(fake.servers.length,0);
 }
 const rt=runtime(),s=new Server(),fake=types(rt),fx=await lib.createBrowserFixture({runtime:rt,createServer:async()=>s,browserTypes:fake.types,requiresVisibleWindow:'os-focus'});
 try{assert.equal(fx.headless,false);assert.equal(fx.requiresVisibleWindow,'os-focus');assert.equal(fake.servers[0].options.headless,false);}finally{await fx.close();}
});

test('browser visibility rejects devtools and removed headless defaults before spawning',async()=>{
 for(const options of [{devtools:true},{ignoreDefaultArgs:true},{ignoreDefaultArgs:['--headless']},{ignoreDefaultArgs:['--headless=new']},{ignoreDefaultArgs:['-headless']}]){
  const rt=runtime(),fake=types(rt);await assert.rejects(lib.managedLaunch(fake.types.chromium,options,{runtime:rt}),/visibility.*argument/i);assert.equal(fake.servers.length,0);
 }
 const rt=runtime(),fake=types(rt),browser=await lib.managedLaunch(fake.types.chromium,{ignoreDefaultArgs:['--hide-scrollbars']},{runtime:rt});
 try{assert.equal(fake.servers[0].options.headless,true);assert.deepEqual(fake.servers[0].options.ignoreDefaultArgs,['--hide-scrollbars']);}finally{await browser.close();}
});
