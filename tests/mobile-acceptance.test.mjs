import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileSelection,mobileLayerEvidence,hasMobileTrace,mobileDrawEvidence,mobileFeedbackPass,mobileScrollEvidence} from '../tools/mobile-acceptance.mjs';
test('mobile --only rejects zero, unknown, duplicate and quick-disabled cases before allocation',()=>{assert.equal(mobileSelection(undefined),null);for(const s of ['',',','bogus','leaks,leaks'])assert.throws(()=>mobileSelection(s));assert.throws(()=>mobileSelection('frames xs x6',{quick:true}));assert.deepEqual(mobileSelection('frames,leaks'),['frames','leaks']);});
test('mobile layer acceptance requires actual positive before and after samples',()=>{for(const [a,b] of [[undefined,undefined],[null,null],[0,0],[2,3],[2,NaN]])assert.equal(mobileLayerEvidence(a,b),false);assert.equal(mobileLayerEvidence(2,2),true);});
test('idle no-draw evidence requires an actual trace',()=>{assert.equal(hasMobileTrace([]),false);assert.equal(hasMobileTrace([{name:'DrawFrame'}]),false);assert.equal(hasMobileTrace([{ph:'M',name:'thread_name'}]),false);});
test('tag rule: a tag on opaque crown pixels, off screen, touching another or on a leaf target fails; one beside the crown passes',async()=>{
 const {maskClash,tagFailures}=await import('../tools/mobile-acceptance.mjs');
 const mask={w:10,h:10,alpha:new Uint8Array(100)};for(let y=0;y<10;y++)for(let x=4;x<6;x++)mask.alpha[y*10+x]=255;   // a 2 px trunk of crown in the middle
 const box={left:100,top:0,width:100,height:100},R=(l,t,w,h)=>({left:l,top:t,right:l+w,bottom:t+h,width:w,height:h});
 assert.deepEqual(maskClash(mask,box,R(150,10,30,44)),{opaque:5,gap:0,extent:[.4,.6]});
 assert.equal(maskClash(mask,box,R(165,10,30,44)).opaque,0);assert.equal(maskClash(mask,box,R(165,10,30,44)).gap,5);
 const probe=tags=>({vw:375,flow:false,tree:box,tags,lead:[R(0,-80,300,40)],tiers:[{id:'t-act',tag:R(0,500,80,48),leaves:[R(100,500,48,48)]}]});
 assert.deepEqual(tagFailures(probe([{kind:'act',...R(165,10,60,46)}]),mask),[]);
 assert.equal(tagFailures(probe([{kind:'act',...R(140,10,60,46)}]),mask).length,1);                 // on the crown
 assert.equal(tagFailures(probe([{kind:'act',...R(340,10,60,46)}]),mask).length,1);                 // off screen
 assert.equal(tagFailures(probe([{kind:'act',...R(165,10,60,40)}]),mask).length,1);                 // under 44 px
 assert.equal(tagFailures(probe([{kind:'act',...R(165,10,60,46)},{kind:'work',...R(170,20,60,46)}]),mask).length,1);
 assert.equal(tagFailures({...probe([]),tiers:[{id:'t-act',tag:R(90,500,80,48),leaves:[R(100,500,48,48)]}]},mask).length,1);
 assert.equal(tagFailures({...probe([]),flow:true},mask).length,1);
});

test('draw evidence requires markers/owner/duration even when no draws were observed',()=>{const rows=[{ph:'M',name:'thread_name',pid:1,tid:1,args:{name:'CrRendererMain'}},{ph:'M',name:'thread_name',pid:2,tid:2,args:{name:'VizCompositorThread'}},{name:'hw-mobile-trace-start',pid:1,tid:1,ts:1000},{name:'hw-mobile-trace-end',pid:1,tid:1,ts:3001000}];assert.equal(mobileDrawEvidence(rows,{minDurationMs:3000}).supported,true);for(const bad of [[],rows.slice(0,2),rows.slice(0,-1),rows.map(e=>({...e,ts:e.ts?1000:undefined}))])assert.equal(mobileDrawEvidence(bad).supported,false);const draw={name:'DrawFrame',ph:'I',pid:2,tid:2,ts:16000};assert.equal(mobileDrawEvidence([...rows,draw]).frames,1);assert.equal(mobileDrawEvidence([...rows,{...draw,pid:3}]).frames,0);assert.equal(mobileDrawEvidence([...rows,{...draw,pid:3}]).supported,false);});

test('branch opening alone cannot pass claimed paper-lift feedback',()=>{assert.equal(mobileFeedbackPass({frames:1,leafFrames:99},{leaf:true}),false);assert.equal(mobileFeedbackPass({frames:1},{leaf:true}),false);assert.equal(mobileFeedbackPass({frames:0,leafFrames:0},{leaf:true}),false);assert.equal(mobileFeedbackPass({frames:1,ms:15,leafFrames:2,leafMs:28},{leaf:true}),true);assert.equal(mobileFeedbackPass({frames:1,ms:15}),true);});

test('one or two callbacks cannot conceal a split-second feedback stall',()=>{
 assert.equal(mobileFeedbackPass({frames:1,ms:200}),false);
 assert.equal(mobileFeedbackPass({frames:1,ms:15,leafFrames:2,leafMs:200},{leaf:true}),false);
 for(const ms of [undefined,NaN,Infinity,-1])assert.equal(mobileFeedbackPass({frames:1,ms}),false);
});
test('mobile scroll retains startup and trailing stalls instead of dropping warm frames',()=>{
 const first=mobileScrollEvidence({startMs:0,endMs:250,frames:[200,216,232]});assert.equal(first.supported,true);assert.equal(first.max,200);assert.equal(first.over50,1);
 const tail=mobileScrollEvidence({startMs:0,endMs:250,frames:[16,32,48]});assert.equal(tail.max,202);
 for(const frames of [[],[16],[NaN,32]])assert.equal(mobileScrollEvidence({startMs:0,endMs:250,frames}).supported,false);
});
