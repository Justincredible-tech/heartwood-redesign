/** Pure, Node-only CLI validation. Call before importing generators or writing output. */
import {parseArgs} from 'node:util';

export function parseToolArgs({args=process.argv.slice(2),booleans=[],strings=[],minPositionals=0,maxPositionals=0}={}){
  if(!Number.isInteger(minPositionals)||minPositionals<0)throw Error('minPositionals must be a nonnegative integer');
  if(!Number.isInteger(maxPositionals)||maxPositionals<0)throw Error('maxPositionals must be a nonnegative integer');
  if(minPositionals>maxPositionals)throw Error('minPositionals ('+minPositionals+') exceeds maxPositionals ('+maxPositionals+'): the positional bounds are unrepresentable');
  const options={help:{type:'boolean',short:'h'}};
  for(const name of booleans)options[name]={type:'boolean'};
  for(const name of strings)options[name]={type:'string'};
  const parsed=parseArgs({args,options,strict:true,allowPositionals:maxPositionals>0});
  if(!parsed.values.help&&(parsed.positionals.length<minPositionals||parsed.positionals.length>maxPositionals))throw Error('Expected '+minPositionals+' to '+maxPositionals+' positional arguments');
  return {...parsed,help:!!parsed.values.help};
}
export function showToolHelp(parsed,usage){
  if(!parsed.help)return false;
  console.log(usage);process.exit(0);
}

// Entry aliases must invoke their real CLI; unrelated imports stay inert.
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function isToolMain(moduleURL,argv=process.argv){
 if(!argv[1])return false;
 try{return realpathSync(fileURLToPath(moduleURL))===realpathSync(resolve(argv[1]));}
 catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return false;throw error;}
}
