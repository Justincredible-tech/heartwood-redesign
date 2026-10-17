// Inert authenticated phase records consumed by the independent supervisor.
// A Promise timer in the worker is useful for prompt async failure, but does not bound CPU stalls.
import assert from 'node:assert/strict';
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
const text=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\x00-\x1f\x7f]/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
function validLease(lease){assert(lease&&text(lease.token)&&text(lease.scopeToken)&&Number.isSafeInteger(lease.scopeOwner?.pid)&&lease.scopeOwner.pid>1&&text(lease.scopeOwner.birth),'Invalid exact phase lease');assert(lease.deadlineAt===null||positive(lease.deadlineAt),'Invalid phase lease deadline');}
export function makePhaseDeadline({token,scopeToken,scopeOwner,deadlineAt,label,timeoutMs,startedAt,nonce}){
 const lease={token,scopeToken,scopeOwner,deadlineAt};validLease(lease);assert(text(label)&&text(nonce)&&positive(startedAt)&&positive(timeoutMs)&&timeoutMs<=600000,'Invalid bounded phase metadata');
 const record={schema:1,token,scopeToken,owner:{pid:scopeOwner.pid,birth:scopeOwner.birth},nonce,label,startedAt,budgetMs:timeoutMs,deadlineAt:Math.min(startedAt+timeoutMs,deadlineAt??Infinity)};
 assert(record.deadlineAt>startedAt,'Cannot begin a phase after its total deadline');return record;
}
export function validatePhaseDeadline(record,{lease,now}){
 validLease(lease);assert(record&&record.schema===1&&record.token===lease.token&&record.scopeToken===lease.scopeToken&&record.owner?.pid===lease.scopeOwner.pid&&record.owner?.birth===lease.scopeOwner.birth,'Phase owner/token/scope incarnation changed');
 assert(text(record.nonce)&&text(record.label)&&positive(now)&&positive(record.startedAt)&&record.startedAt<=now&&positive(record.budgetMs)&&record.budgetMs<=600000&&positive(record.deadlineAt)&&record.deadlineAt>record.startedAt,'Invalid phase deadline metadata');
 assert(record.deadlineAt===Math.min(record.startedAt+record.budgetMs,lease.deadlineAt??Infinity),'Phase deadline extends or changes its authenticated budget');return {record,expired:now>=record.deadlineAt};
}
export function readPhaseDeadline(path){
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 try{const before=fstatSync(fd);assert(before.isFile()&&before.size>0&&before.size<=8192,'Phase record must be regular <=8KiB');const bytes=Buffer.alloc(before.size+1);let size=0;while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}const after=fstatSync(fd);assert(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'Phase record changed while reading');return JSON.parse(bytes.subarray(0,size).toString('utf8'));}finally{closeSync(fd);}
}
