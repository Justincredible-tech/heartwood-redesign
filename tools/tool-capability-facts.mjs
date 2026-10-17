/** Inert, bounded source registration facts. Never executes a runner or approves source. */
import {posix,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assessCapabilityCatalog} from './tool-capability-catalog.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const relative=p=>typeof p==='string'&&p.length>0&&p.length<2048&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const limit=4096,maintained=p=>p.startsWith('tools/')||p.startsWith('tests/');

// This is a deliberately small lexer, not a JavaScript evaluator. Strings,
// comments, regex bodies and template bodies cannot become code declarations.
export function sourceTokens(source){
 if(typeof source!=='string'||Buffer.byteLength(source)>8*1024*1024)throw Error('source token input exceeds8MiB');
 const tokens=[];let i=0;const push=(kind,v)=>{if(tokens.length>=500000)throw Error('source token ceiling exceeded');tokens.push({kind,v});};
 while(i<source.length){const c=source[i],n=source[i+1];if(/\s/.test(c)){i++;continue;}
  if(c==='/'&&n==='/'){i+=2;while(i<source.length&&source[i]!=='\n')i++;continue;}
  if(c==='/'&&n==='*'){const end=source.indexOf('*/',i+2);if(end<0)throw Error('unterminated comment');i=end+2;continue;}
  if(c==='"'||c==="'"){const q=c;let v='';i++;let closed=false;while(i<source.length){let x=source[i++];if(x===q){closed=true;break;}if(x==='\\'){x=source[i++];const simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};if(x==='u'||x==='x'){const size=x==='u'?4:2,h=source.slice(i,i+size);if(!new RegExp('^[a-fA-F0-9]{'+size+'}$').test(h))throw Error('unsupported string escape');v+=String.fromCharCode(parseInt(h,16));i+=size;}else if(x==='\n'){}else v+=simple[x]??x;}else {if(x==='\n'||x==='\r')throw Error('unterminated string');v+=x;}}if(!closed)throw Error('unterminated string');push('string',v);continue;}
  if(c==='`'){i++;let closed=false;while(i<source.length){const x=source[i++];if(x==='\\'){i++;continue;}if(x==='`'){closed=true;break;}}if(!closed)throw Error('unterminated template');push('opaque','template');continue;}
  const prev=tokens.at(-1)?.v;if(c==='/'&&(!prev||['=','(','[','{',',',':','!','?',';','return','throw','=>','&&','||'].includes(prev))){i++;let escaped=false,bracket=false,closed=false;while(i<source.length){const x=source[i++];if(escaped){escaped=false;continue;}if(x==='\\'){escaped=true;continue;}if(x==='[')bracket=true;if(x===']')bracket=false;if(x==='/'&&!bracket){closed=true;break;}if(x==='\n')throw Error('unterminated regex');}if(!closed)throw Error('unterminated regex');while(/[a-z]/i.test(source[i]||'')&&i<source.length)i++;push('opaque','regex');continue;}
  if(/[A-Za-z_$]/.test(c)){let v=c;i++;while(i<source.length&&/[\w$]/.test(source[i]))v+=source[i++];push('id',v);continue;}
  if(/\d/.test(c)){let v=c;i++;while(i<source.length&&/[\w.]/.test(source[i]))v+=source[i++];push('number',v);continue;}
  const op=['===','!==','=>','==','!=','&&','||','??','?.','...'].find(x=>source.startsWith(x,i));push('punct',op||c);i+=(op||c).length;
 }
 return tokens;
}
const seq=(tokens,values)=>tokens.some((_,i)=>values.every((v,j)=>tokens[i+j]?.v===v));
function literalArray(tokens,start){
 if(tokens[start]?.v!=='[')throw Error('expected literal array');const values=[];let i=start+1;
 while(tokens[i]?.v!==']'){if(i>=tokens.length)throw Error('unterminated array');let v;if(tokens[i].v==='['){const nested=literalArray(tokens,i);v=nested.values;i=nested.end;}else if(tokens[i].kind==='string'){v=tokens[i++].v;}else throw Error('registration array must contain literal strings/arrays');values.push(v);if(tokens[i]?.v===','){i++;continue;}if(tokens[i]?.v!==']')throw Error('unsupported registration array expression');}
 return {values,end:i+1};
}
function declaredArray(tokens,name){const starts=[];for(let i=0;i<tokens.length-3;i++)if(tokens[i].v==='const'&&tokens[i+1].v===name&&tokens[i+2].v==='=')starts.push(i+3);if(starts.length!==1)throw Error('exactly one const '+name+' literal declaration required');return literalArray(tokens,starts[0]).values;}
function functionBody(tokens,name){const begin=tokens.findIndex((t,i)=>t.v==='function'&&tokens[i+1]?.v===name);if(begin<0||tokens[begin+2]?.v!=='(')throw Error('missing function '+name);let start=begin+3,parens=1;for(;start<tokens.length&&parens;start++){if(tokens[start].v==='(')parens++;if(tokens[start].v===')')parens--;}if(parens||tokens[start]?.v!=='{')throw Error('unsupported function parameters '+name);let depth=1,end=start+1;for(;end<tokens.length&&depth;end++){if(tokens[end].v==='{')depth++;if(tokens[end].v==='}')depth--;}if(depth)throw Error('unterminated '+name);return tokens.slice(start+1,end-1);}
function localImports(tokens){const refs=[];for(let i=0;i<tokens.length;i++){if(tokens[i].kind!=='id'||tokens[i].v!=='import'||tokens[i+1]?.v==='('||tokens[i+1]?.v==='.')continue;let end=i+1;while(end<tokens.length&&![';','import','export'].includes(tokens[end].v))end++;const block=tokens.slice(i,end);const from=block.findIndex(t=>t.kind==='id'&&t.v==='from');const p=from>=0?block[from+1]:block[1];if(p?.kind==='string'&&p.v.startsWith('.'))refs.push(p.v);}return refs;}

// These two reviewed actors are source contracts, not independent test commands.
// Only punctuation affects scope; a quoted brace/name cannot invent a call.
const actorCallers=new Map([['tests/fixtures/retain-temp-worker.mjs','tests/retain-temp.test.mjs'],['tests/fixtures/timing-peer.mjs','tests/optional/timing-environment.lifecycle.test.mjs']]);
const punct=(t,v)=>t?.kind==='punct'&&t.v===v;
const sameTokens=(a,b)=>a.length===b.length&&a.every((t,i)=>t.kind===b[i].kind&&t.v===b[i].v);
const prefix=(tokens,source)=>{const p=sourceTokens(source);return sameTokens(tokens.slice(0,p.length),p);};
const exact=(tokens,source)=>sameTokens(tokens,sourceTokens(source));
const includesSource=(tokens,source)=>{const p=sourceTokens(source);return tokens.some((_,i)=>sameTokens(tokens.slice(i,i+p.length),p));};
function sourceStatements(tokens){
 const rows=[];let start=0;const stack=[];
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.kind!=='punct')continue;if(['(','[','{'].includes(t.v))stack.push(t.v);else if([')',']','}'].includes(t.v)){if(stack.pop()!=={')':'(',']':'[','}':'{'}[t.v])throw Error('unsupported unbalanced actor source');}
  const declaration=['function','async','try','if','for'].includes(tokens[start]?.v)&&tokens[start]?.kind==='id';
  if(!stack.length&&(t.v===';'||t.v==='}'&&declaration&&!['finally','catch','else'].includes(tokens[i+1]?.v))){rows.push(tokens.slice(start,i+1));start=i+1;}
 }if(stack.length)throw Error('unsupported unbalanced actor source');if(start<tokens.length)rows.push(tokens.slice(start));return rows;
}
function callArguments(tokens,opening){
 if(!punct(tokens[opening],'('))throw Error('actor call opening required');const rows=[];let start=opening+1;const stack=[];
 for(let i=start;i<tokens.length;i++){const t=tokens[i];if(t.kind!=='punct')continue;if(!stack.length&&t.v===')'){rows.push(tokens.slice(start,i));if(!tokens.slice(i+1).every(t=>punct(t,';')))throw Error('unsupported trailing actor call expression');return rows;}if(!stack.length&&t.v===','){rows.push(tokens.slice(start,i));start=i+1;continue;}if(['(','[','{'].includes(t.v))stack.push(t.v);else if([')',']','}'].includes(t.v)){if(stack.pop()!=={')':'(',']':'[','}':'{'}[t.v])throw Error('unbalanced actor call');}}
 throw Error('unterminated actor call');
}
function optionFields(tokens){
 if(!punct(tokens[0],'{')||!punct(tokens.at(-1),'}'))throw Error('literal actor options required');const fields=new Map();
 for(const row of callArguments([...sourceTokens('options('),...tokens.slice(1,-1),...sourceTokens(')')],1)){if(row[0]?.kind!=='id'||!punct(row[1],':')||row.length<3||fields.has(row[0].v))throw Error('unique literal actor option fields required');fields.set(row[0].v,row.slice(2));}return fields;
}
const countCalls=(tokens,name)=>tokens.filter((t,i)=>t.kind==='id'&&t.v===name&&punct(tokens[i+1],'(')).length;
function activeTestBodies(tokens,contract){
 const statements=sourceStatements(tokens),imports=statements.filter(row=>row[0]?.kind==='id'&&row[0].v==='import'&&row.some(t=>t.kind==='string'&&t.v==='node:test'));
 if(imports.length!==1||!exact(imports[0],"import test from 'node:test';"))throw Error('one direct node:test binding required; alternate test bindings unsupported');
 // Only the actual direct calls and retained cleanup hook are supported. A
 // genuine focus/dynamic/alias reference makes activity unknown; string,
 // comment, regex and template text never becomes a modifier.
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.kind==='id'&&['import','require'].includes(t.v)&&punct(tokens[i+1],'(')&&tokens[i+2]?.kind==='string'&&tokens[i+2].v==='node:test')throw Error('dynamic node:test binding is unsupported for active actor coverage');if(t.kind!=='id'||t.v!=='test')continue;const imported=tokens[i-1]?.kind==='id'&&tokens[i-1].v==='import'&&tokens[i+1]?.kind==='id'&&tokens[i+1].v==='from';
  if(!imported&&!punct(tokens[i+1],'(')&&!(punct(tokens[i+1],'.')&&tokens[i+2]?.kind==='id'&&tokens[i+2].v==='after'&&punct(tokens[i+3],'(')))throw Error('focused, dynamic or aliased test binding is unsupported for active actor coverage');
 }
 return statements.filter(row=>prefix(row,'test(')).map(row=>{const args=callArguments(row,1);if(args[0]?.length!==1||args[0][0].kind!=='string')throw Error('literal active test name required');
  if(contract==='retained'){if(args.length!==3)throw Error('retained active test requires exactly name/options/callback');const options=optionFields(args[1]);if(options.size!==1||!exact(options.get('timeout')||[],'7000'))throw Error('retained active test admits only literal timeout7000; skip/todo/focus/unknown options unsupported');}
  else if(contract==='timing'){if(args.length!==2)throw Error('timing active test requires exactly name/callback with no options');}
  else throw Error('unsupported active actor test option contract');
  const callback=args.at(-1),skip=callback[0]?.v==='async'?1:0;if(!prefix(callback.slice(skip),'()=>{')||!punct(callback.at(-1),'}'))throw Error('supported direct test callback required');return sourceStatements(callback.slice(skip+4,-1));});
}
function requireReview(path,role,current,reviewFacts){
 const rows=reviewFacts.filter(row=>row.path===path);if(rows.length!==1)throw Error('one independently reviewed current actor/caller fact required: '+path);const row=rows[0];
 if(row.role!==role||row.sourceSha256!==current.get(path)?.sourceSha256||!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.length>32||row.evidence.some(e=>!relative(e?.path)||!/^[a-f0-9]{64}$/.test(e?.sourceSha256||'')))throw Error('current '+role+' source/evidence identity required: '+path);
 return row;
}
function retainedInvocations(actor,caller,path){
 const roots=sourceStatements(caller),actorRoots=sourceStatements(actor),tests=activeTestBodies(caller,'retained');
 if(!roots.some(row=>exact(row,"import {spawnSync} from 'node:child_process';"))||!roots.some(row=>exact(row,"import {join,resolve} from 'node:path';"))||!roots.some(row=>prefix(row,'const root=')&&includesSource(row,"fixture=join(import.meta.dirname,'fixtures/retain-temp-worker.mjs')")))throw Error('retained actor path/import binding changed');
 const invokes=roots.filter(row=>prefix(row,'const invoke='));if(invokes.length!==1||!prefix(invokes[0],'const invoke=(actor,receipt)=>spawnSync('))throw Error('direct retained invoke binding required');
 const args=callArguments(invokes[0],sourceTokens('const invoke=(actor,receipt)=>spawnSync').length);if(args.length!==3||!exact(args[0],'process.execPath')||!exact(args[1],'[fixture,actor,...(receipt?[receipt]:[])]'))throw Error('retained actor argv changed');const options=optionFields(args[2]);if(options.size!==3||!options.has('env')||!exact(options.get('timeout')||[],'6000')||!exact(options.get('encoding')||[],"'utf8'"))throw Error('retained actor unique6s options changed');
 if(!actorRoots.some(row=>exact(row,'const [actor,receiptPath]=process.argv.slice(2);'))||!actorRoots.some(row=>exact(row,"assert(['ownership','stdout'].includes(actor),'Unknown retention fixture actor');"))||!actorRoots.some(row=>exact(row,"assert(process.argv.length===(actor==='stdout'?4:3),'Unexpected retention fixture arguments');"))||!actorRoots.some(row=>exact(row,"if(actor==='stdout')assert(typeof receiptPath==='string'&&receiptPath,'stdout actor requires an owned receipt path');"))||!actorRoots.some(row=>exact(row,"await (actor==='ownership'?ownershipActor:stdoutActor)();")))throw Error('retained actor admitted argument/dispatch contract changed');
 const ownership=tests.filter(body=>exact(body[0],"const r=invoke('ownership');")),stdout=tests.filter(body=>exact(body[0],"const receiptPath=join(receipts,'stdout-owner.json'),result=invoke('stdout',receiptPath);"));if(tests.length!==2||ownership.length!==1||stdout.length!==1||tests.some(body=>countCalls(body.flat(),'invoke')!==1))throw Error('exactly both direct active retained test calls required');
 return [{mode:'ownership',argv:[path,'ownership'],stdin:'unused',timeoutMs:6000},{mode:'stdout',argv:[path,'stdout',{kind:'owned-parent-receipt',binding:'receiptPath'}],stdin:'unused',timeoutMs:6000}];
}
function timingInvocations(actor,caller,path){
 const tests=activeTestBodies(caller,'timing'),actorRoots=sourceStatements(actor);if(tests.length!==1)throw Error('one direct timing lifecycle test required');const body=tests[0];
 if(!prefix(body[0],"assert.equal(process.platform,'darwin',")||!exact(body[1],"const runtime=ensureToolRuntime({name:'owned Mac timing lifecycle fixture',runTimeoutMs:30000});")||!exact(body[2],'await runtime.ready;')||!prefix(body[4],'try{')||body.length!==5)throw Error('direct Mac lifecycle callback/lease structure changed');
 const tried=body[4];let depth=0,end=-1;for(let i=1;i<tried.length;i++){if(punct(tried[i],'{'))depth++;if(punct(tried[i],'}')&&--depth===0){end=i;break;}}
 const operations=sourceStatements(tried.slice(2,end)),spawns=operations.filter(row=>prefix(row,'peer=await runtime.spawn('));if(spawns.length!==1)throw Error('one direct timing peer spawn required');
 const args=callArguments(spawns[0],sourceTokens('peer=await runtime.spawn').length);if(args.length!==3||!exact(args[0],'process.execPath')||!exact(args[1],"[resolve(import.meta.dirname,'..','fixtures/timing-peer.mjs')]"))throw Error('timing peer argv/path changed');
 const spawned=operations.indexOf(spawns[0]),ended=operations.findIndex(row=>exact(row,'peer.stdin.end();')),ready=operations.findIndex(row=>prefix(row,"peerReady=await runtime.deadline('exact independent timing peer ready',"));if(ready<=spawned||ended<=ready||operations.slice(0,ended).some(row=>prefix(row,'return')||prefix(row,'throw')))throw Error('direct timing peer readiness/stdin lifetime changed');
 const readinessArgs=callArguments(operations[ready],sourceTokens('peerReady=await runtime.deadline').length),exit=operations.findIndex(row=>prefix(row,"const ended=await runtime.deadline('independent peer exit',"));if(readinessArgs.length!==3||!exact(readinessArgs[2],'{timeoutMs:5000}')||exit<=ended)throw Error('timing peer readiness/exit bound changed');const exitArgs=callArguments(operations[exit],sourceTokens('const ended=await runtime.deadline').length);if(exitArgs.length!==3||!exact(exitArgs[1],'()=>peer.toolClosed')||!exact(exitArgs[2],'{timeoutMs:3000}'))throw Error('timing peer actual exit bound changed');
 if(!actorRoots.some(row=>exact(row,"const {ensureToolRuntime}=await import('../../tools/tool-runtime.mjs');"))||!actorRoots.some(row=>exact(row,"const runtime=ensureToolRuntime({name:'short independent timing-label peer',runTimeoutMs:15000});"))||!actorRoots.some(row=>exact(row,'await runtime.ready;'))||!actorRoots.some(row=>exact(row,'process.stdin.resume();'))||!actorRoots.some(row=>exact(row,"await new Promise(resolve=>process.stdin.once('end',resolve));"))||!actorRoots.some(row=>prefix(row,"const cleanup=await runtime.shutdown('peer assertion observation complete');")))throw Error('timing peer current stdin/lease contract changed');
 return [{mode:'stdin-peer',argv:[path],stdin:'parent-end-after-ready',readinessTimeoutMs:5000,exitTimeoutMs:3000}];
}

export function sourceRegistrationFacts(inventory,sources,{supportPaths=[],reviewFacts=[]}={}){
 if(!Array.isArray(inventory)||inventory.length>limit)throw Error('invalid bounded registration census');
 if(!Array.isArray(reviewFacts)||reviewFacts.length>limit)throw Error('invalid bounded independent review facts');
 const current=new Map(inventory.map(r=>[r.path,r])),registrationFacts=[],failures=[];
 const get=path=>{const s=sources.get(path);if(typeof s!=='string'||!current.has(path)||sha(s)!==current.get(path).sourceSha256)throw Error('missing/current source identity required: '+path);return sourceTokens(s);};
 const add=(path,kind,members)=>{const unique=[...new Set(members)].sort();for(const member of unique)if(!current.has(member))failures.push({kind:'registered-source-missing',path:member,reason:'active registered source is absent from census; runner '+path});const present=unique.filter(p=>current.has(p));if(present.length)registrationFacts.push({path,sourceSha256:current.get(path).sourceSha256,kind,members:present});};
 const attempt=(path,fn)=>{try{fn();}catch(error){failures.push({kind:'unsupported-registration-source',path,reason:error.message});}};
 attempt('tools/test-all.mjs',()=>{const t=get('tools/test-all.mjs'),commands=declaredArray(t,'commands'),extra=declaredArray(t,'additionalTests');
  if(!seq(t,['const','nodeTests','=','commands','.','find','(','args','=>','args','[','0',']','===','--test',')'])||!seq(t,['for','(','const','path','of','additionalTests',')'])||!seq(t,['nodeTests','.','push','(','path',')'])||!seq(t,['await','runSuiteCommands','(','rt',',','commands']))throw Error('active Node additionalTests append/execution contract changed');
  if(commands.some(c=>!Array.isArray(c)||!c.length)||extra.some(p=>typeof p!=='string'))throw Error('invalid command literal roster');
  const tests=commands.filter(c=>c[0]==='--test');if(tests.length!==1)throw Error('one active Node test command required');const members=[...tests[0].slice(1),...extra];if(new Set(members).size!==members.length)throw Error('duplicate active Node test member');add('tools/test-all.mjs','literal-path',[...members,...commands.filter(c=>c[0]!=='--test').map(c=>c[0])]);
 });
 if(registrationFacts.some(f=>f.path==='tools/test-all.mjs'&&f.members.includes('tools/test-fork-graph.mjs')))attempt('tools/test-fork-graph.mjs',()=>{const tokens=get('tools/test-fork-graph.mjs'),plan=functionBody(tokens,'graphTestPlan'),main=functionBody(tokens,'main');
  if(!seq(plan,['command',':','uv',',','args',':','[','run',',','--offline',',','--no-project',',','--',',','python',',','join','(','root',',','tests/test_graph_driver.py',')',',','-v',']'])||!seq(main,['const','plan','=','graphTestPlan','(','python',')'])||!seq(main,['await','runtime','.','runCommand','(','plan','.','command',',','plan','.','args']))throw Error('active offline graph delegated test command changed');
  add('tools/test-fork-graph.mjs','delegated-test-command',['tests/test_graph_driver.py']);
 });
 let retired=[];
 attempt('tools/test-properties.mjs',()=>{const t=get('tools/test-properties.mjs');retired=declaredArray(t,'retired');
  if(retired.some(p=>typeof p!=='string'||!relative(p)||p.includes('/'))||!seq(t,['f','.','endsWith','(','.property.test.mjs',')','&&','!','retired','.','includes','(','f',')']))throw Error('active property selector contract changed');
  add('tools/test-properties.mjs','dynamic-property-selector',inventory.map(r=>r.path).filter(p=>/^tests\/[^/]+\.property\.test\.mjs$/.test(p)&&!retired.includes(posix.basename(p))));
 });
 attempt('tools/test-browser-all.mjs',()=>{const body=functionBody(get('tools/test-browser-all.mjs'),'browserStagePlan');
  if(!seq(body,['stages','.','push','(','{','name',',','cat',',','args'])||!seq(body,['return','stages',';']))throw Error('active browser stage append/return contract changed');
  const members=[];for(let i=0;i<body.length;i++){if(body[i].v!=='add'||body[i+1]?.v!=='(')continue;let depth=0,comma=0,j=i+2;for(;j<body.length;j++){const v=body[j].v;if(v==='('||v==='['||v==='{')depth++;if(v===')'&&depth===0)break;if(v===')'||v===']'||v==='}')depth--;if(v===','&&depth===0&&++comma===2){j++;break;}}
   if(comma!==2||body[j]?.v!=='[')continue;let level=1;for(j++;j<body.length&&level;j++){const v=body[j].v;if(v==='[')level++;if(v===']')level--;if(level&&body[j].kind==='string'&&/^(tools\/|tests\/|output\/).*\.(mjs|js|sh)$/.test(v))members.push(v);}
  }add('tools/test-browser-all.mjs','browser-stage-args',members);
 });
 // Registered helper imports are observed, not inferred from a filename. Only
 // independently current reviewed support roles can remove a test obligation.
 const supports=new Set(supportPaths),registered=new Set(registrationFacts.flatMap(f=>f.members)),queue=[...registered].filter(p=>p.startsWith('tests/')),visited=new Set();
 while(queue.length){const caller=queue.shift();if(visited.has(caller))continue;visited.add(caller);attempt(caller,()=>{const targets=localImports(get(caller)).map(p=>posix.normalize(posix.join(posix.dirname(caller),p))).filter(p=>relative(p)&&current.has(p)&&supports.has(p));add(caller,'imported-test-helper',targets);for(const p of targets)queue.push(p);});}
 const candidates=new Set([...reviewFacts.filter(row=>row.role==='test-actor').map(row=>row.path),...supportPaths.filter(path=>actorCallers.has(path))]);
 for(const path of candidates)attempt(path,()=>{const caller=actorCallers.get(path);if(!caller)throw Error('unsupported reviewed actor contract');const actorReview=requireReview(path,'test-actor',current,reviewFacts),callerReview=requireReview(caller,'test',current,reviewFacts);if(!registered.has(caller))throw Error('reviewed actor parent is not actively registered');const actor=get(path),parent=get(caller),sourceInvocations=path.endsWith('/retain-temp-worker.mjs')?retainedInvocations(actor,parent,path):timingInvocations(actor,parent,path);registrationFacts.push({path:caller,sourceSha256:current.get(caller).sourceSha256,kind:'test-actor-caller',members:[path],actorSourceSha256:current.get(path).sourceSha256,sourceInvocations,reviewEvidence:{actor:actorReview.evidence,caller:callerReview.evidence},scope:'source-only-not-runtime-acceptance'});});
 return {registrationFacts,failures,retiredSelector:retired.map(p=>'tests/'+p)};
}

/** Observe independent current facts; seed catalog rows never approve themselves. */
export async function collectCapabilityFacts({root,inventory,sources,policy,catalog,read}){
 if(!Array.isArray(inventory)||inventory.length>limit||typeof read!=='function')throw Error('bounded facts inputs required');
 const current=new Map(inventory.map(r=>[r.path,r])),reviewFacts=[],retirementFacts=[],evidenceFacts=[],failures=[],cache=new Map();let bytesRead=0;
 const input=async path=>{if(!relative(path))throw Error('unsafe proof path');if(cache.has(path))return cache.get(path);const bytes=Buffer.from(await read(join(root,path)));bytesRead+=bytes.length;if(bytesRead>256*1024*1024)throw Error('facts input exceeds256MiB');cache.set(path,bytes);return bytes;};
 for(const row of policy.reviewedFiles||[]){if(!current.has(row.path)||row.sourceSha256!==current.get(row.path).sourceSha256||!row.reason)continue;const evidence=Array.isArray(row.evidence)?row.evidence:[row.evidence];if(!evidence.length||evidence.some(p=>!relative(p)))continue;
  try{const hashes=[];for(const path of evidence)hashes.push({path,sourceSha256:sha(await input(path))});reviewFacts.push({path:row.path,sourceSha256:row.sourceSha256,role:row.role,evidence:hashes});if(row.role==='retired-cli')retirementFacts.push({path:row.path,sourceSha256:row.sourceSha256,reason:row.reason,evidence:hashes});}
  catch(error){failures.push({kind:'unavailable-catalog-review-evidence',path:row.path,reason:error.message});}
 }
 const supportPaths=reviewFacts.filter(r=>['test-helper','parser-fixture','test-actor'].includes(r.role)).map(r=>r.path),registration=sourceRegistrationFacts(inventory,sources,{supportPaths,reviewFacts});failures.push(...registration.failures);
 // Existing documented property retirement is an independent source fact,
 // not a seed catalog label. Unknown/current-unreviewed tests cannot borrow it.
 for(const path of registration.retiredSelector){const review=reviewFacts.find(r=>r.path===path);if(!review||retirementFacts.some(r=>r.path===path))continue;try{
   const testProperties=current.get('tools/test-properties.mjs');if(!testProperties)throw Error('tools/test-properties.mjs is not present');
   const source=await input('tools/test-properties.mjs'),retired=(/const retired=\[([^\]]*)\]/.exec(source.toString('utf8'))?.[1]||'').split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);
   if(!retired.includes(path))throw Error('the explicit retired list in tools/test-properties.mjs does not name this path');
   let docs=null;try{const bytes=await input('tools/BUILD.md'),lines=bytes.toString('utf8').split(/\r?\n/).filter(line=>line.startsWith('| `'+path+'` | Excluded from `tools/test-properties.mjs` (explicit `retired` list).'));if(lines.length===1)docs={path:'tools/BUILD.md',sourceSha256:sha(bytes),reason:lines[0]};}catch{}
   retirementFacts.push({path,sourceSha256:review.sourceSha256,reason:docs?docs.reason:'explicit retired list in tools/test-properties.mjs',evidence:[...(docs?[{path:docs.path,sourceSha256:docs.sourceSha256}]:[]),{path:'tools/test-properties.mjs',sourceSha256:testProperties.sourceSha256}]});
  }catch(error){failures.push({kind:'unproved-property-retirement',path,reason:error.message});}}
 const wanted=[...new Set((catalog?.entries||[]).flatMap(r=>r.disposition==='generated-browser-copy'?(r.provenance||[]).map(p=>p.path):[]))];if(wanted.length>limit)throw Error('provenance inputs exceed4096');
 for(const path of wanted){try{const bytes=await input(path);let members=[];
   if(/^output\/playwright\/staged-candidates\/[^/]+\/subject\/staged-candidate\.json$/.test(path)){const receipt=JSON.parse(bytes);if(receipt.schema!==1||!Array.isArray(receipt.records)||receipt.records.length>20000)throw Error('unsupported bounded generated receipt');members=receipt.records.filter(r=>relative(r?.path)&&/^(site\/|published-optimized\/).*\.js$/.test(r.path)&&/^[a-f0-9]{64}$/.test(r.sha256||'')&&Number.isSafeInteger(r.bytes)&&r.bytes>=0).map(r=>({path:r.path,sourceSha256:r.sha256,bytes:r.bytes}));}
   else {const source=current.get(path),review=reviewFacts.find(r=>r.path===path&&r.role==='generated-browser-artifact');if(!source||!review||sha(bytes)!==source.sourceSha256)throw Error('proof is not an independently reviewed current generated artifact');members=[{path,sourceSha256:source.sourceSha256,bytes:bytes.length}];}
   evidenceFacts.push({path,sourceSha256:sha(bytes),members});
  }catch(error){failures.push({kind:'unavailable-generated-proof',path:String(path),reason:error.message});}}
 const enhancedInventory=inventory.map(row=>({...row,supportOnly:supportPaths.includes(row.path)}));
 return {inventory:enhancedInventory,reviewFacts,retirementFacts,evidenceFacts,registrationFacts:registration.registrationFacts,failures,retiredSelector:registration.retiredSelector,observedProofBytes:bytesRead};
}

export function draftCapabilityCatalog(inventory,facts,{seed}={}){
 const entries=inventory.map(row=>{const registrations=facts.registrationFacts.filter(f=>f.members.includes(row.path)).map(f=>({path:f.path,sourceSha256:f.sourceSha256,kind:f.kind,member:row.path,...(f.kind==='test-actor-caller'?{actorSourceSha256:f.actorSourceSha256,sourceInvocations:f.sourceInvocations,reviewEvidence:f.reviewEvidence,scope:f.scope}:{})})),review=facts.reviewFacts.find(f=>f.path===row.path&&f.sourceSha256===row.sourceSha256),retirement=facts.retirementFacts.find(f=>f.path===row.path&&f.sourceSha256===row.sourceSha256),scope=maintained(row.path)?'maintained':'historical';
  const disposition=retirement?'retired-source':scope==='historical'?'historical-source':row.path.startsWith('tests/')&&!row.supportOnly?'maintained-test':'maintained-source';
  const status=retirement?'retired-preserved':registrations.length?'source-registered':disposition==='maintained-test'?'unregistered':scope==='historical'?'historical-not-executed':'manual-not-executed';
  const entry={path:row.path,sourceSha256:row.sourceSha256,scope,disposition,capabilityId:'source:'+row.path,reviewStatus:review?'reviewed':'unreviewed',coverage:{status,registration:registrations,proofs:[]},runtimeAcceptance:'NOT_RUN_BY_CATALOG'};
  if(retirement)entry.retirement={reason:retirement.reason,evidence:retirement.evidence.map(e=>e.path)};
  const previous=seed?.entries?.find(e=>e.path===row.path&&e.sourceSha256===row.sourceSha256&&e.disposition==='generated-browser-copy');
  if(scope==='historical'&&previous){const probe={schema:1,claim:'inventory and source registration only; no runtime acceptance',entries:[{...entry,disposition:'generated-browser-copy',coverage:{status:'browser-artifact-not-cli',proofs:[],registration:[]},provenance:previous.provenance}]};if(assessCapabilityCatalog(probe,[row],facts).passed){entry.disposition='generated-browser-copy';entry.coverage={status:'browser-artifact-not-cli',proofs:[],registration:[]};entry.provenance=previous.provenance;}}
  return entry;
 });
 return {schema:1,claim:'inventory and source registration only; no runtime acceptance',entries};
}

export function assessCatalogGate({catalog,inventory,facts,existingFailures=[]}){
 const assessment=assessCapabilityCatalog(catalog,inventory,facts),catalogFailures=[...(facts.failures||[]),...assessment.failures].map(row=>({...row,line:1}));
 return {assessment,catalogFailures,failures:[...existingFailures,...catalogFailures],passed:existingFailures.length===0&&catalogFailures.length===0};
}
