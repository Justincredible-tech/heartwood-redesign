/** A successful child status cannot bless forced cleanup or missing evidence. */
export function commandCleanupProblems(result){
 const problems=[];
 for(const name of ['errors','remaining','observedLeftovers']){
  const rows=result?.cleanup?.[name];
  if(!Array.isArray(rows))problems.push('unsupported cleanup evidence: '+name);
  else if(rows.length)problems.push(name+': '+rows.length+' cleanup issue(s)');
 }
 return problems;
}
