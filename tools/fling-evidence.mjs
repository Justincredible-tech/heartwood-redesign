import {mobileScrollEvidence} from './mobile-acceptance.mjs';
export function flingFrameEvidence(window){
 const observed=mobileScrollEvidence(window||{});
 return {...observed,passed:observed.supported&&observed.p95<25&&observed.max<=50};
}
export function referenceFrameAdmission({difference,flatShare,hasPrevious}){
 if(typeof hasPrevious!=='boolean'||!Number.isFinite(flatShare)||flatShare<0||flatShare>1||(hasPrevious&&(!Number.isFinite(difference)||difference<0)))throw Error('UNSUPPORTED fling reference: invalid finite convergence measurements');
 return hasPrevious&&difference<.6&&flatShare<.002;
}
export async function settleReferenceFrame({readFrame,meanDifference,flatShare,wait,attempts=75}){
 if(![readFrame,meanDifference,flatShare,wait].every(f=>typeof f==='function')||!Number.isInteger(attempts)||attempts<2||attempts>75)throw Error('Invalid bounded fling reference selection');
 let previous;const observations=[];
 for(let k=0;k<attempts;k++){
  await wait(k?400:150);const frame=await readFrame(),observed={attempt:k+1,hasPrevious:previous!==undefined,difference:previous===undefined?null:meanDifference(previous,frame),flatShare:flatShare(frame)};
  const accepted=referenceFrameAdmission(observed);observations.push(observed);
  if(accepted)return {frame,proof:{converged:true,attempts:k+1,observations}};
  previous=frame;
 }
 const e=Error('UNSUPPORTED fling reference: viewport never converged after '+attempts+' bounded samples');e.code='HW_FLING_REFERENCE_UNSUPPORTED';e.proof={converged:false,attempts,observations};throw e;
}
