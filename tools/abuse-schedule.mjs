// Work ceilings, not sleeps. Measured concurrent M4Pro diagnostics:650 hover
// cycles53s;54 modal cycles179.7s. Absolute gates and sample counts are unchanged.
const rates={'leak-leaf-open-close':5000,'leak-leaf-hover':250,'leak-network-hover':250,'leak-chip-filter':500,'leak-finder':500};
export function abuseItemBudget({name,config,cycles=null,warm=4,control=false},{seconds=8,quick=false}={}){
 if(typeof name!=='string'||!name||typeof config!=='string'||!config||!Number.isFinite(seconds)||seconds<=0||!Number.isSafeInteger(warm)||warm<0||typeof control!=='boolean'||typeof quick!=='boolean')throw Error('Invalid abuse schedule item');
 if(cycles!==null){if(!Number.isSafeInteger(cycles)||cycles<1||!rates[name])throw Error('Invalid/unknown leak schedule');return 20000+(cycles+warm)*rates[name]*(control?2:1);}
 const windowMs=name==='troll-combined'?Math.max(seconds*1000,quick?30000:90000):seconds*1000;
 return Math.ceil(20000+2*windowMs);
}
export function abuseSchedule({items,routes,seconds,quick=false,chaos=false,chaosMs=420000,deferred=false}){
 if(!Array.isArray(items)||(!items.length&&!chaos)||!Array.isArray(routes)||!routes.length||routes.some(r=>typeof r!=='string'||!r)||new Set(routes).size!==routes.length||!Number.isFinite(chaosMs)||chaosMs<=0||chaosMs>2147483647||!Number.isFinite(seconds)||seconds<=0||typeof quick!=='boolean'||typeof chaos!=='boolean'||typeof deferred!=='boolean')throw Error('Invalid/empty abuse schedule');
 const stages=items.map(item=>({...item,timeoutMs:abuseItemBudget(item,{seconds,quick})}));
 if(stages.some(s=>!Number.isSafeInteger(s.timeoutMs)||s.timeoutMs>2147483647))throw Error('Abuse schedule exceeds supported timer range');
 const timeoutMs=Math.max(60000,Math.ceil(30000+routes.length*(stages.reduce((n,s)=>n+s.timeoutMs,0)+(chaos?chaosMs+20000:0)+(deferred?180000:0))));
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs>2147483647)throw Error('Abuse schedule exceeds supported timer range');
 return {stages,timeoutMs,interpretation:'Finite source-derived work ceiling; no delay is inserted. Scenario budgets terminate blocked work; original cycles/windows/gates remain.'};
}
