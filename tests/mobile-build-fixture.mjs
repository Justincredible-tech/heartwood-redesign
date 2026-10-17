import {after} from 'node:test';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// One phone build shared by the mobile tests of a single `node --test` process, built into a fresh owned
// temp directory — never the checkout's publish/ tree, and only that owned directory is ever removed.
// `html` is the composed day page (the page a visit actually loads); the build's own return `html` is the
// index redirect stub in the current epoch, so it is not used here.
import {buildMobile} from '../tools/build-mobile.mjs';
let built;
const buildOwned = async () => {
  const owned = await mkdtemp(join(await realpath(tmpdir()), 'heartwood-mobile-build-'));
  try { const result = await buildMobile({out: join(owned, 'mobile')}); return {...result, html: await readFile(join(result.out, 'day.html'), 'utf8'), owned}; }
  catch (error) { await rm(owned, {recursive: true, force: true}); throw error; }
};
export const mobileBuild = () => built || (built = buildOwned());
after(async()=>{if(!built)return;const result=await built.catch(()=>null);if(result?.owned)await rm(result.owned,{recursive:true,force:true});});
