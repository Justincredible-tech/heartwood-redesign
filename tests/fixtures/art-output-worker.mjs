import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runOwnedArtTransaction} from '../../tools/mobile-art-runtime.mjs';
const [root,mode]=process.argv.slice(2),parent=join(root,'source/mobile'),out=join(parent,'.art-stage-'+randomUUID());
await runOwnedArtTransaction({timeoutMs:15000,shutdownMs:8000,output:out,projectRoot:root,sourcePath:join(parent,'art')},async runtime=>{
 if(mode==='foreign-output'){await mkdir(out);await writeFile(join(out,'foreign.txt'),'KEEP');console.log('@@artOutput '+JSON.stringify({mode,out}));}
 const ownership=await runtime.ensureOutputDirectory(out,{reason:'exact owned output allocation regression'});await writeFile(join(out,'owned.txt'),'OWNED');
 const repeated=await runtime.registerOutput(out,{keep:false,reason:'exact existing owned record revalidation'});if(JSON.stringify(repeated)!==JSON.stringify(ownership))throw Error('Output record changed during revalidation');
 const meta=JSON.parse(await readFile(join(process.env.HW_TOOL_RUN_DIR,'run.json'),'utf8'));console.log('@@artOutput '+JSON.stringify({mode,out,token:meta.token,worker:meta.worker,helper:meta.helper,runDir:process.env.HW_TOOL_RUN_DIR,scratch:process.env.TMPDIR}));
 if(mode==='publication-death')await new Promise(resolve=>setTimeout(resolve,60000));
});
