// Bounded native driver-status diagnostic. Does not create an automation session
// or prove Safari's automation-permission setting: owner-death window cleanup
// cannot currently be established from verified local lifecycle evidence.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {listenServer,closeServer,browserToolCLI} from '../browser-test-lib.mjs';
browserToolCLI();
const runtime=ensureToolRuntime({runTimeoutMs:30000});await runtime.ready;
const reservation=createServer();await listenServer(reservation,{runtime});const port=reservation.address().port;await closeServer(reservation);
const child=await runtime.spawn('/usr/bin/safaridriver',['--port',String(port)],{label:'native Safari driver status',stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>log=(log+b).slice(-16000));child.stderr.on('data',b=>log=(log+b).slice(-16000));
const report={engine:'native Safari',settingsChanged:false,sessionCreated:false,automationSessionVerified:false,availability:'unsupported',reason:'Driver status does not verify Safari automation permission or owner-death cleanup of an automation window'};
try{report.driverStatus=await runtime.deadline('Safari driver status',async signal=>{for(;;){if(child.exitCode!==null||child.signalCode!==null)throw Error('safaridriver exited');try{const r=await fetch('http://127.0.0.1:'+port+'/status',{signal});return {status:r.status,body:await r.json()};}catch(e){if(signal.aborted)throw e;}await new Promise(r=>setTimeout(r,100));}},{timeoutMs:10000});process.exitCode=64;}
catch(error){report.error=error.message;process.exitCode=1;}
finally{child.kill('SIGTERM');report.driverLog=log;const out=resolve(process.env.HW_OUT||'output/playwright/startup-safari-access');await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
