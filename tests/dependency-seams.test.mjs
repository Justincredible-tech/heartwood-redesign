// Pure regression for the optional dependency seams (tools/fidelity-deps.mjs, tools/browser-deps.mjs, tools/sharp-deps.mjs).
// The real pixel/browser packages are not used here: each case builds an owned temp tree
// (realpath-resolved os temp dir) with mock packages whose classes/functions record this/arguments and
// whose methods fail when their receiver is lost, copies the seam files into <tree>/tools, imports
// the copies by URL, and proves either real forwarding or an explicit UNSUPPORTED failure. No browser,
// no network, no source writes; this suite removes every temp tree it owns.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,lstat,mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const SEAM_DIR=new URL('../tools/',import.meta.url);
const SEAMS=['fidelity-deps.mjs','browser-deps.mjs','sharp-deps.mjs'];
const FIDELITY_UNSUPPORTED='UNSUPPORTED: the pixel-diff dependencies (pngjs, pixelmatch) are not available; install the optional dependencies (see docs/TESTING.md)';
const BROWSER_UNSUPPORTED='UNSUPPORTED: playwright-core is not available; install the optional dependency (see docs/TESTING.md)';
const SHARP_UNSUPPORTED='UNSUPPORTED: sharp is not available; install the optional dependency (see docs/TESTING.md)';

const owned=[];
after(async()=>{
  for(const root of owned)await rm(root,{recursive:true,force:true});
  for(const root of owned)await assert.rejects(lstat(root),error=>error.code==='ENOENT','owned dependency-seam temp was not removed');
});

const pngjsMock=`'use strict';
const records={constructed:[],fills:[],syncReads:[]};
class PNG{
  constructor(...args){
    if(!(this instanceof PNG))throw new TypeError('mock PNG requires new');
    records.constructed.push({args,self:this});
    const [options={}]=args;
    this.width=options.width||0;
    this.height=options.height||0;
    this.data=Buffer.alloc(this.width*this.height*4);
    this.marker=PNG.marker;
  }
  fill(value){
    if(this.marker!==PNG.marker)throw new Error('mock PNG method lost its instance receiver');
    records.fills.push({value,self:this});
    return this.width+'x'+this.height;
  }
}
const sync={
  read(buffer,options){
    if(this!==sync)throw new Error('mock PNG.sync.read lost its owner receiver');
    records.syncReads.push({buffer,options,self:this});
    return {width:2,height:2,data:Buffer.from([9,8,7,6])};
  },
  write(){
    if(this!==sync)throw new Error('mock PNG.sync.write lost its owner receiver');
    return Buffer.from([4,3,2,1]);
  }
};
PNG.sync=sync;
PNG.marker=Symbol('mock-pngjs-marker');
module.exports={PNG,records};
`;
const pixelmatchFunctionMock=`'use strict';
const records={calls:[]};
function pixelmatch(...args){
  records.calls.push({args,self:this});
  const [a,b,diff,width,height,options]=args;
  return {diff:42,width,height,options};
}
pixelmatch.records=records;
module.exports=pixelmatch;
`;
const pixelmatchDefaultMock=`'use strict';
const records={calls:[]};
function pixelmatch(...args){
  records.calls.push({args,self:this});
  const [a,b,diff,width,height,options]=args;
  return {diff:7,width,height,options};
}
module.exports={default:pixelmatch,records};
`;
const playwrightMock=`'use strict';
const records={names:[],launches:[]};
class BrowserType{
  constructor(browser){
    this.browser=browser;
    this.marker=BrowserType.marker;
  }
  name(){
    if(this.marker!==BrowserType.marker)throw new Error('mock BrowserType.name lost its receiver');
    records.names.push({self:this});
    return this.browser;
  }
  async launch(options){
    if(this.marker!==BrowserType.marker)throw new Error('mock BrowserType.launch lost its receiver');
    records.launches.push({options,self:this});
    return {browser:this.browser,options};
  }
}
BrowserType.marker=Symbol('mock-playwright-marker');
const chromium=new BrowserType('chromium'),firefox=new BrowserType('firefox'),webkit=new BrowserType('webkit');
const devices={'iPhone 12':{viewport:{width:390,height:844}},'Pixel 5':{viewport:{width:393,height:851}}};
module.exports={chromium,firefox,webkit,devices,records};
`;
const sharpMock=`'use strict';
const records={calls:[]};
function sharp(...args){
  records.calls.push({args,self:this});
  return {chain:'mock-sharp'};
}
sharp.versions={sharp:'0.0.0-mock'};
sharp.records=records;
module.exports=sharp;
`;

async function writePackage(root,name,source){
  const dir=join(root,'node_modules',name);
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'package.json'),JSON.stringify({name,version:'0.0.0-mock',main:'index.js'}));
  await writeFile(join(dir,'index.js'),source);
}
async function makeTree({packages=true,pixelmatchExport='function'}={}){
  const root=await mkdtemp(join(await realpath(tmpdir()),'heartwood-dependency-seams-'));
  owned.push(root);
  const tools=join(root,'tools');
  await mkdir(tools);
  for(const name of SEAMS)await copyFile(fileURLToPath(new URL(name,SEAM_DIR)),join(tools,name));
  if(packages){
    await writePackage(root,'pngjs',pngjsMock);
    await writePackage(root,'pixelmatch',pixelmatchExport==='default'?pixelmatchDefaultMock:pixelmatchFunctionMock);
    await writePackage(root,'playwright-core',playwrightMock);
    await writePackage(root,'sharp',sharpMock);
  }
  return root;
}
const seamUrl=(root,name)=>pathToFileURL(join(root,'tools',name)).href;
const importSeam=(root,name)=>import(seamUrl(root,name));
const requireFrom=(root,name)=>createRequire(pathToFileURL(join(root,'tools','probe.cjs')).href)(name);

const tree=await makeTree();
const defaultExportTree=await makeTree({pixelmatchExport:'default'});
const missingTree=await makeTree({packages:false});

test('the copied seams resolve the installed mock packages',async()=>{
  const fidelity=await importSeam(tree,'fidelity-deps.mjs');
  const browser=await importSeam(tree,'browser-deps.mjs');
  const sharp=await importSeam(tree,'sharp-deps.mjs');
  assert.equal(fidelity.fidelityAvailable(),true);
  assert.equal(browser.browserAvailable(),true);
  assert.equal(sharp.sharpAvailable(),true);
});
test('new PNG(...) constructs the real mock class with forwarded arguments, never a dummy',async()=>{
  const {PNG}=await importSeam(tree,'fidelity-deps.mjs');
  const pngjs=requireFrom(tree,'pngjs');
  const options={width:2,height:3};
  const png=new PNG(options);
  const constructed=pngjs.records.constructed.at(-1);
  assert.ok(png instanceof pngjs.PNG,'new PNG must construct the package class');
  assert.equal(Object.getPrototypeOf(png),pngjs.PNG.prototype);
  assert.equal(constructed.args.length,1);
  assert.equal(constructed.args[0],options);
  assert.equal(constructed.self,png);
  assert.equal(png.width,2);
  assert.equal(png.height,3);
  assert.equal(png.fill('#abcdef'),'2x3');
  assert.equal(pngjs.records.fills.at(-1).self,png);
});
test('PNG.sync static members stay reachable with their owner receiver',async()=>{
  const {PNG}=await importSeam(tree,'fidelity-deps.mjs');
  const pngjs=requireFrom(tree,'pngjs');
  const buffer=Buffer.from([1,2,3,4]);
  assert.equal(PNG.sync,pngjs.PNG.sync);
  const decoded=PNG.sync.read(buffer,{filterType:0});
  assert.deepEqual(decoded.data,Buffer.from([9,8,7,6]));
  const call=pngjs.records.syncReads.at(-1);
  assert.equal(call.self,pngjs.PNG.sync);
  assert.equal(call.buffer,buffer);
  assert.deepEqual(call.options,{filterType:0});
  assert.deepEqual(PNG.sync.write(),Buffer.from([4,3,2,1]));
});
test('pixelmatch(...) calls the real exported function and returns its value',async()=>{
  const {default:defaultPixelmatch,pixelmatch}=await importSeam(tree,'fidelity-deps.mjs');
  const mock=requireFrom(tree,'pixelmatch');
  const a=Uint8Array.from([1,2,3,4]),b=Uint8Array.from([5,6,7,8]),diff=new Uint8Array(4),options={threshold:0.1};
  assert.equal(defaultPixelmatch,pixelmatch,'the default and named pixelmatch exports are the same seam');
  const result=pixelmatch(a,b,diff,2,2,options);
  assert.equal(result.diff,42);
  assert.equal(result.width,2);
  assert.equal(result.height,2);
  const call=mock.records.calls.at(-1);
  assert.equal(call.args.length,6);
  assert.equal(call.args[0],a);
  assert.equal(call.args[1],b);
  assert.equal(call.args[2],diff);
  assert.equal(call.args[3],2);
  assert.equal(call.args[4],2);
  assert.equal(call.args[5],options);
  assert.equal(defaultPixelmatch(a,b,diff,2,2,options).diff,42);
});
test('a {default: fn} pixelmatch export is normalized to the callable seam',async()=>{
  const {default:pixelmatch}=await importSeam(defaultExportTree,'fidelity-deps.mjs');
  const mock=requireFrom(defaultExportTree,'pixelmatch');
  const result=pixelmatch(new Uint8Array(4),new Uint8Array(4),new Uint8Array(4),1,1,{});
  assert.equal(result.diff,7);
  assert.equal(result.width,1);
  assert.equal(mock.records.calls.length,1);
});
test('chromium/firefox/devices members keep their owner receiver and stay the real objects',async()=>{
  const {chromium,firefox,webkit,devices}=await importSeam(tree,'browser-deps.mjs');
  const playwright=requireFrom(tree,'playwright-core');
  assert.equal(chromium.name(),'chromium');
  assert.equal(firefox.name(),'firefox');
  assert.equal(webkit.name(),'webkit');
  assert.equal(playwright.records.names.at(-1).self,playwright.webkit);
  const launched=await chromium.launch({headless:true});
  assert.equal(launched.browser,'chromium');
  assert.deepEqual(launched.options,{headless:true});
  assert.equal(playwright.records.launches.at(-1).self,playwright.chromium);
  assert.equal(devices['iPhone 12'],playwright.devices['iPhone 12']);
  assert.equal(devices['iPhone 12'].viewport.width,390);
  assert.equal(devices['Pixel 5'].viewport.height,851);
});
test('playwrightCorePath resolves inside the resolved playwright-core package',async()=>{
  const {playwrightCorePath}=await importSeam(tree,'browser-deps.mjs');
  assert.equal(playwrightCorePath('index.js'),join(tree,'node_modules','playwright-core','index.js'));
});
test('loadSharp() returns the real installed module itself and forwards calls',async()=>{
  const {loadSharp,sharpAvailable}=await importSeam(tree,'sharp-deps.mjs');
  const mock=requireFrom(tree,'sharp');
  assert.equal(sharpAvailable(),true);
  assert.equal(loadSharp(),mock,'the seam must return the installed module object, never a copy or stand-in');
  const input=Buffer.from([1,2,3]);
  const result=loadSharp()(input,{failOn:'none'});
  const call=mock.records.calls.at(-1);
  assert.equal(call.args.length,2);
  assert.equal(call.args[0],input);
  assert.deepEqual(call.args[1],{failOn:'none'});
  assert.equal(result.chain,'mock-sharp');
  assert.equal(loadSharp(),mock,'the resolved module is stable across calls');
});
test('a tree without the packages fails closed with the exact UNSUPPORTED error, never a dummy',async()=>{
  for(const name of ['pngjs','pixelmatch','playwright-core','sharp'])assert.throws(()=>requireFrom(missingTree,name),error=>error.code==='MODULE_NOT_FOUND','the owned missing-package tree must not resolve '+name+' through an ancestor node_modules');
  const fidelity=await importSeam(missingTree,'fidelity-deps.mjs');
  const browser=await importSeam(missingTree,'browser-deps.mjs');
  const sharpSeam=await importSeam(missingTree,'sharp-deps.mjs');
  assert.equal(fidelity.fidelityAvailable(),false);
  assert.equal(browser.browserAvailable(),false);
  assert.equal(sharpSeam.sharpAvailable(),false);
  const cases=[
    ['new PNG(...)',()=>new fidelity.PNG({width:1,height:1}),FIDELITY_UNSUPPORTED],
    ['pixelmatch(...)',()=>fidelity.pixelmatch(new Uint8Array(4),new Uint8Array(4),new Uint8Array(4),1,1,{}),FIDELITY_UNSUPPORTED],
    ['PNG.sync',()=>fidelity.PNG.sync,FIDELITY_UNSUPPORTED],
    ['chromium.launch(...)',()=>browser.chromium.launch({headless:true}),BROWSER_UNSUPPORTED],
    ['chromium.name()',()=>browser.chromium.name(),BROWSER_UNSUPPORTED],
    ['devices[...]',()=>browser.devices['iPhone 12'],BROWSER_UNSUPPORTED],
    ['playwrightCorePath(...)',()=>browser.playwrightCorePath('index.js'),BROWSER_UNSUPPORTED],
    ['loadSharp()',()=>sharpSeam.loadSharp(),SHARP_UNSUPPORTED]
  ];
  for(const [label,run,expected]of cases)assert.throws(run,error=>error instanceof Error&&error.message===expected,label+' must throw exactly the seam UNSUPPORTED error');
  let constructed;
  try{constructed=new fidelity.PNG({width:1,height:1});}catch{}
  assert.equal(constructed,undefined,'a missing dependency must never produce a dummy instance');
  assert.equal(fidelity.fidelityAvailable(),false);
  assert.equal(browser.browserAvailable(),false);
  assert.equal(sharpSeam.sharpAvailable(),false);
  assert.throws(()=>sharpSeam.loadSharp(),error=>error instanceof Error&&error.message===SHARP_UNSUPPORTED,'loadSharp must keep failing closed on repeated calls');
});
