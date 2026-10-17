// Optional browser seam. playwright-core is an optional dependency: build and portable tests never
// need it. Resolved by package name from the separately locked tools/browser project (its own
// lockfile); a missing package fails closed with UNSUPPORTED, and a requested browser suite never
// silently skips or passes. The exports are lazy forwarding proxies: the first real use resolves the
// installed package; function members stay bound to their real owner object (chromium.launch(...),
// chromium.name() keep their receiver), and an absent package throws UNSUPPORTED instead of
// substituting an empty object.
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const UNSUPPORTED='UNSUPPORTED: playwright-core is not available; install the optional dependency (see docs/TESTING.md)';
const requireFromBrowser=createRequire(new URL('./browser/package.json',import.meta.url));
let api=null,resolved=false,lastError=null;
function load(){
  if(resolved)return api;
  resolved=true;
  try{api=requireFromBrowser('playwright-core');}catch(error){lastError=error;}
  if(api&&!['chromium','firefox','webkit','devices'].some(name=>api[name]!==undefined))api=null;
  if(!api&&lastError)api=null;
  return api;
}
function required(){const mod=load();if(!mod)throw Error(UNSUPPORTED);return mod;}
export function browserAvailable(){return !!load();}
export function playwrightCorePath(...segments){required();return join(dirname(requireFromBrowser.resolve('playwright-core/package.json')),...segments);}
const RESERVED=new Set(['then','toJSON','inspect','constructor','valueOf','toString']);
const boundMembers=new WeakMap();
function member(owner,prop){
  const value=owner[prop];
  if(typeof value!=='function')return value;
  let cached=boundMembers.get(owner);
  if(!cached)boundMembers.set(owner,cached=new Map());
  if(!cached.has(prop))cached.set(prop,value.bind(owner));
  return cached.get(prop);
}
// One lazy member of the resolved package: get/apply/construct all resolve through required() on use.
// The proxy target is a bound function: callable and constructible like the real members, but owning
// no `prototype` property, so every member object (chromium, firefox, webkit, devices) forwards freely
// without Proxy invariants constraining the forwarded properties.
const lazyTarget=function(){}.bind(undefined);
function lazy(name){
  let proxy;
  proxy=new Proxy(lazyTarget,{
    get:(_,prop)=>{
      if(typeof prop==='symbol')return prop===Symbol.toStringTag?'playwright-core':undefined;
      if(RESERVED.has(prop))return undefined;
      return member(required()[name],prop);
    },
    apply:(_,thisArg,args)=>Reflect.apply(required()[name],thisArg,args),
    construct:(_,args,newTarget)=>Reflect.construct(required()[name],args,newTarget===proxy?required()[name]:newTarget)});
  return proxy;
}
export const chromium=lazy('chromium');
export const firefox=lazy('firefox');
export const webkit=lazy('webkit');
export const devices=lazy('devices');
