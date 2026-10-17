/** Pure acceptance for exact orphan cleanup; never starts or signals a process. */
export function assessOrphanRecovery({meta,result,report,child,registryRemoved,startedAt}){
 const same=(a,b)=>!!a&&!!b&&a.pid===b.pid&&a.birth===b.birth;
 const ended=Date.parse(report?.finishedAt),fresh=report?.schema===1&&report.runId===meta?.token&&same(report.owner,meta.worker)&&ended>=startedAt&&report.supervisor?.pid===result?.pid&&child?.pid===result.pid&&child?.scopeToken===result.scopeToken&&same(child,report.supervisor);
 const recovery=report?.recovery,intent=!!fresh&&recovery?.mode==='exact-orphan'&&recovery.token===meta.token&&same(recovery.owner,meta.worker)&&same(recovery.watchdog,report.supervisor)&&[recovery.startedAt,recovery.finishedAt,recovery.deadlineAt].every(Number.isFinite)&&recovery.startedAt>=startedAt&&recovery.finishedAt>=recovery.startedAt&&recovery.finishedAt<=recovery.deadlineAt&&recovery.finishedAt===ended&&recovery.status===0&&recovery.completed===true&&Number.isInteger(report.status)&&report.status>=0&&report.status<=255&&recovery.originalStatus===report.status;
 const empty=rows=>Array.isArray(rows)&&rows.length===0;
 const commandClean=result?.status===0&&result.timedOut===false&&result.signal===null&&result.error===null&&['errors','remaining','observedLeftovers'].every(name=>empty(result.cleanup?.[name]));
 const clean=!!intent&&registryRemoved===true&&commandClean&&empty(report.errors)&&empty(report.unsupported)&&empty(report.cleanup?.remaining)&&empty(report.cleanup?.errors);
 return {fresh:!!fresh,intent:!!intent,clean,originalStatus:report?.status};
}
