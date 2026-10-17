// Optional image seam for phone mask checks: sharp is an optional dependency, resolved by package
// name from the separately locked tools/browser project (its own lockfile); a missing package fails
// closed with UNSUPPORTED on every use, never a substitute. Used by verify-mobile.mjs and the
// browser diagnostics.
import {createRequire} from 'node:module';
const UNSUPPORTED='UNSUPPORTED: sharp is not available; install the optional dependency (see docs/TESTING.md)';
const requireFromBrowser=createRequire(new URL('./browser/package.json',import.meta.url));
let api=null,resolved=false;
function load(){
  if(resolved)return api;
  resolved=true;
  try{api=requireFromBrowser('sharp');}catch{api=null;}
  return api;
}
export function loadSharp(){const mod=load();if(!mod)throw Error(UNSUPPORTED);return mod;}
export function sharpAvailable(){return !!load();}
