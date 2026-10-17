export function functionalVerdict(report,expected,cleanup,blocked){
  const failures=[...(report.failures||[])],checks=report.checks||[];
  if(!Array.isArray(expected)||!expected.length)failures.push('No declared functional journeys');
  for(const name of expected||[]){const matches=checks.filter(c=>c.name===name);if(matches.length!==1||matches[0].pass!==true)failures.push('Missing, duplicate or failed positive journey: '+name);}
  if(checks.some(c=>!expected.includes(c.name)||c.pass!==true))failures.push('Unexpected or failed journey');
  if(!cleanup||!Array.isArray(cleanup.errors)||cleanup.errors.length)failures.push('Cleanup not proved clean');
  if(!Array.isArray(blocked)||blocked.length)failures.push('Network guard not proved clean');
  return {passed:failures.length===0,failures:[...new Set(failures)]};
}
