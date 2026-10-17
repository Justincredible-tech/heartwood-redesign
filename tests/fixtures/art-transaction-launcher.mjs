import {join} from 'node:path';
import {createToolRuntime} from '../../tools/mobile-art/lifecycle/tool-runtime.mjs';
const [root,mode]=process.argv.slice(2),rt=createToolRuntime({name:'owned art death-control launcher',runTimeoutMs:15000,shutdownMs:8000});await rt.ready;
const child=await rt.spawn(process.execPath,[join(import.meta.dirname,'art-transaction-worker.mjs'),root,mode],{stdio:['ignore','inherit','inherit'],label:'owned art worker'});
await rt.deadline('focused child transaction lifecycle',()=>child.toolClosed,{timeoutMs:12000});await rt.shutdown('launcher child ended');
