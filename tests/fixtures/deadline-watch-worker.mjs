import {writeSync} from 'node:fs';
import {createDeadlineWatch} from '../../tools/testing/deadline-watch.mjs';
const mode=process.argv[2];
const watch=createDeadlineWatch({timeoutMs:mode==='overall'?160:2000});
await watch.ready;
if(mode==='complete'){
  const end=watch.begin('completed step',100);end();end();
  await watch.close();await watch.close();console.log('COMPLETE');
}else if(mode==='blocked'){
  watch.begin('blocked main loop',120);
  while(true){} // Deliberately blocked process proves the independent watchdog.
}else if(mode==='full-stderr'){
  watch.begin('blocked diagnostic pipe',120);
  writeSync(1,Buffer.from('FULL_PIPE_ARMED\n'));
  const bytes=Buffer.alloc(65536,120);
  try{
    while(true)writeSync(2,bytes);
  }catch(error){
    if(error.code!=='EAGAIN'){process.exit(96)}
    // Some platforms expose a nonblocking inherited pipe. Once full, hold the
    // main event loop without allocating more memory; the watcher must retire it.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
    process.exit(97);
  }
}else if(mode==='pending'){
  watch.begin('unsettled callback',120);
  await new Promise(()=>{});
}else if(mode==='overall'){
  await new Promise(()=>{});
}else if(mode==='nested'){
  const outer=watch.begin('outer step',500),inner=watch.begin('inner step',120);
  outer();await new Promise(()=>{});inner();
}else{
  await watch.close();throw Error('Unknown fixture mode');
}
