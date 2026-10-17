// Fresh independent owned peer fixture, not a browser and not a background service.
for(const key of ['HW_TOOL_RUN_TOKEN','HW_TOOL_RUN_DIR','HW_TOOL_SCOPE_TOKEN','HW_TOOL_SUPERVISED','HW_TOOL_SERIAL_LEASE'])delete process.env[key];
const {ensureToolRuntime}=await import('../../tools/tool-runtime.mjs');
const runtime=ensureToolRuntime({name:'short independent timing-label peer',runTimeoutMs:15000});await runtime.ready;
console.log('@@timing-peer '+JSON.stringify({token:runtime.runId,runDir:runtime.runDir,pid:process.pid,birth:runtime.ownerRecord.worker.birth}));
process.stdin.resume();await new Promise(resolve=>process.stdin.once('end',resolve));
const cleanup=await runtime.shutdown('peer assertion observation complete');if(cleanup.errors.length)process.exitCode=1;
