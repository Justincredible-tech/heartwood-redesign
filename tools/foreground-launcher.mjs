// Shared foreground-build parent policy. Importing allocates no resources.
export function admitForegroundLauncher(platform,pid){
 if(platform!=='win32'&&(!Number.isSafeInteger(pid)||pid<=1))throw Object.assign(Error('Foreground public build requires a live POSIX launcher; initial parent '+pid),{exitCode:125});
 return pid;
}
export function watchForegroundLauncher({parentPid=process.ppid,platform=process.platform,intervalMs=250,getStep=()=>'',onRetire}={}){
 if(typeof onRetire!=='function'||typeof getStep!=='function'||!Number.isInteger(intervalMs)||intervalMs<1||intervalMs>250)throw Error('Invalid foreground launcher watcher options');
 admitForegroundLauncher(platform,parentPid);
 let timer,closed=false,ipc=false;
 const release=()=>{if(closed)return;closed=true;clearInterval(timer);if(ipc)process.removeListener('disconnect',disconnected);};
 const retire=message=>{if(closed)return;release();onRetire(Object.assign(Error(message+' at '+getStep()),{exitCode:143}),143);};
 const disconnected=()=>retire('build launcher IPC disconnected');
 const inspect=()=>{if(process.ppid!==parentPid)retire('build launcher retired: parent '+parentPid+' became '+process.ppid);};
 if(platform!=='win32'){inspect();if(!closed){timer=setInterval(inspect,intervalMs);timer.unref();}}
 if(!closed&&process.channel){ipc=true;process.once('disconnect',disconnected);}
 return release;
}
