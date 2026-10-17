import {resolveBuildFeatures} from '../source/build-features.mjs';

export function exclusionOptions(args,value){
  if(args.includes('--help')&&args.length!==1)
    throw Error('--help cannot be combined with build options');
  if(args.filter(arg=>arg==='--exclude'||arg.startsWith('--exclude=')).length>1)
    throw Error('Duplicate --exclude option');
  return resolveBuildFeatures(value);
}
export function supervisedFeatureOptions(values,args){
  const features=exclusionOptions(args,values.exclude);
  if(values.phone&&!features.phone)throw Error('A direct phone build cannot exclude phone');
  if(values.out!==undefined&&(!values.phone||!values.out))throw Error('--out requires --phone and a nonempty directory');
  return {exclude:[...features.excluded]};
}
