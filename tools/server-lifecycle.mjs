/** Node-only lifecycle for an owned HTTP listener. Importing this module is inert. */
const checkedTimeout=value=>{
  if(!Number.isFinite(value)||value<=0)throw Error('Server timeout must be finite and positive');
  return value;
};
export async function closeServer(server,{timeoutMs=3000}={}){
  if(!server)return;
  checkedTimeout(timeoutMs);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Object.assign(Error('HTTP server close timed out'),{code:'ETIMEDOUT'})),timeoutMs);
    const done=error=>{clearTimeout(timer);if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve();};
    try{server.close(done);server.closeAllConnections?.();}catch(error){done(error);}
  });
}
export async function listenServer(server,{port=0,host='127.0.0.1',timeoutMs=5000,runtime}={}){
  checkedTimeout(timeoutMs);
  const unregister=runtime?.onCleanup('HTTP server',()=>closeServer(server),{kind:'listener',details:{host,requestedPort:port}});
  let released=false;
  const release=()=>{if(!released){released=true;unregister?.();}};
  server.once('close',release);
  try{
    await new Promise((resolve,reject)=>{
      const clear=()=>{clearTimeout(timer);server.off('error',failed);server.off('listening',ready);};
      const failed=error=>{clear();reject(error);},ready=()=>{clear();resolve();};
      const timer=setTimeout(()=>failed(Object.assign(Error('HTTP server listen timed out'),{code:'ETIMEDOUT'})),timeoutMs);
      server.once('error',failed);server.once('listening',ready);
      try{server.listen(port,host);}catch(error){failed(error);}
    });
    const address=server.address();
    runtime?.registerResource?.('listener',{host,address:typeof address==='object'?address.address:address,port:typeof address==='object'?address.port:port,scope:'owned HTTP server'});
    return server;
  }catch(error){
    try{await closeServer(server);}finally{release();server.off('close',release);}
    throw error;
  }
}
