// Public art jobs own only typed art-directory transactions. Private SDK cleanup stays private.
export async function cleanupOwnedResource(resource,{run,signal,deadlineAt}={}){
 if(resource?.kind!=='mobile-art-directory')throw Error('Unsupported typed resource cleanup '+resource?.kind);
 const {recoverArtTransaction}=await import('./art-transaction.mjs');
 return recoverArtTransaction(resource,{run,signal,deadlineAt});
}
