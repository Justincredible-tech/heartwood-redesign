/* Local process identity for cleanup authorization, not process-name matching.
 * macOS: libproc birth microseconds + KERN_PROCARGS2 inherited ownership token.
 * Linux: /proc birth ticks + boot ID + inherited ownership token.
 * Refuse unavailable identity; never signal by PID alone. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <libproc.h>
#include <sys/proc.h>
#include <sys/sysctl.h>
#else
#include <dirent.h>
#endif
struct identity { int pid,ppid,pgid; char birth[128]; };
static int identify(int pid,struct identity *p) {
#ifdef __APPLE__
  struct proc_bsdinfo b;int n=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof b);
  if(n==sizeof b&&b.pbi_status==SZOMB)return -1;
  if(n!=sizeof b||!b.pbi_start_tvsec){
    struct kinfo_proc k;size_t size=sizeof k;int mib[]={CTL_KERN,KERN_PROC,KERN_PROC_PID,pid};
    if(sysctl(mib,4,&k,&size,NULL,0)==0&&(size==0||(size==sizeof k&&k.kp_proc.p_stat==SZOMB)))return -1;
    return 0;
  }
  p->pid=pid;p->ppid=b.pbi_ppid;p->pgid=b.pbi_pgid;
  snprintf(p->birth,sizeof p->birth,"%llu:%llu",(unsigned long long)b.pbi_start_tvsec,(unsigned long long)b.pbi_start_tvusec);return 1;
#else
  char file[128],buf[8192],boot[80];snprintf(file,sizeof file,"/proc/%d/stat",pid);FILE *f=fopen(file,"r");if(!f)return 0;
  if(!fgets(buf,sizeof buf,f)){fclose(f);return 0;}fclose(f);char *end=strrchr(buf,')');if(!end)return 0;
  if(end[2]=='Z')return -1;char *save=NULL,*field=strtok_r(end+2," ",&save);int i=0;unsigned long long start=0;
  while(field){if(i==1)p->ppid=atoi(field);if(i==2)p->pgid=atoi(field);if(i==19)start=strtoull(field,NULL,10);field=strtok_r(NULL," ",&save);i++;}
  f=fopen("/proc/sys/kernel/random/boot_id","r");if(!f)return 0;if(!fgets(boot,sizeof boot,f)){fclose(f);return 0;}fclose(f);boot[strcspn(boot,"\n")]=0;
  p->pid=pid;snprintf(p->birth,sizeof p->birth,"%s:%llu",boot,start);return start>0;
#endif
}
static int owns(int pid,const char *token,const char *scope) {
  if(!token||!*token)return 0;char *buf=NULL;size_t n=0,start=0;
#ifdef __APPLE__
  int mib[]={CTL_KERN,KERN_PROCARGS2,pid};if(sysctl(mib,3,NULL,&n,NULL,0)||n<sizeof(int))return 0;
  buf=malloc(n);if(!buf)return 0;if(sysctl(mib,3,buf,&n,NULL,0)){free(buf);return 0;}
  int argc=0;memcpy(&argc,buf,sizeof argc);size_t pos=sizeof argc;while(pos<n&&buf[pos])pos++;while(pos<n&&!buf[pos])pos++;
  for(int i=0;i<argc&&pos<n;i++){while(pos<n&&buf[pos])pos++;pos++;}start=pos;
#else
  char path[128];snprintf(path,sizeof path,"/proc/%d/environ",pid);FILE *f=fopen(path,"rb");if(!f)return 0;
  size_t cap=4096;buf=malloc(cap);if(!buf){fclose(f);return 0;}int c;while((c=fgetc(f))!=EOF){if(n==cap){cap*=2;char *next=realloc(buf,cap);if(!next){free(buf);fclose(f);return 0;}buf=next;}buf[n++]=(char)c;}fclose(f);
#endif
  const char key[]="HW_TOOL_RUN_TOKEN=";int found=0,scopefound=!scope;size_t tokenlen=strlen(token);
  for(size_t pos=start;pos<n;){size_t end=pos;while(end<n&&buf[end])end++;if(end-pos==sizeof(key)-1+tokenlen&&!memcmp(buf+pos,key,sizeof(key)-1)&&!memcmp(buf+pos+sizeof(key)-1,token,tokenlen)){found=1;}const char skey[]="HW_TOOL_SCOPE_TOKEN=";size_t slen=scope?strlen(scope):0;if(scope&&end-pos>=sizeof(skey)-1+slen&&!memcmp(buf+pos,skey,sizeof(skey)-1)&&!memcmp(buf+pos+sizeof(skey)-1,scope,slen)&&(end-pos==sizeof(skey)-1+slen||buf[pos+sizeof(skey)-1+slen]=='/'))scopefound=1;pos=end+1;}
  free(buf);return found&&scopefound;
}
static void print(const struct identity *p,int matched){printf("{\"pid\":%d,\"ppid\":%d,\"pgid\":%d,\"birth\":\"%s\",\"tokenMatched\":%s}",p->pid,p->ppid,p->pgid,p->birth,matched?"true":"false");}
int main(int argc,char **argv){
#ifdef __APPLE__
  /* Publication never replaces a foreign destination, even an empty directory.
     The caller has already journaled an inode/marker-owned directory in opaque
     scratch. This syscall closes the missing-marker allocation window. */
  if(argc==9&&!strcmp(argv[1],"--move-directory-no-replace")){
    if(!owns(getpid(),argv[8],NULL))return 6;
    struct stat source,parent;char target[4096];if(strlen(argv[3])>=sizeof target)return 2;
    strcpy(target,argv[3]);char *slash=strrchr(target,'/');if(!slash||slash==target||!slash[1])return 2;*slash=0;
    if(lstat(argv[2],&source)||lstat(target,&parent)||!S_ISDIR(source.st_mode)||!S_ISDIR(parent.st_mode)||S_ISLNK(source.st_mode)||S_ISLNK(parent.st_mode))return 3;
    if((unsigned long long)source.st_dev!=strtoull(argv[4],NULL,10)||(unsigned long long)source.st_ino!=strtoull(argv[5],NULL,10)||(unsigned long long)parent.st_dev!=strtoull(argv[6],NULL,10)||(unsigned long long)parent.st_ino!=strtoull(argv[7],NULL,10))return 3;
    if(renamex_np(argv[2],argv[3],RENAME_EXCL)){fprintf(stderr,"owned no-replace publication failed: %s\n",strerror(errno));return errno==EEXIST?17:errno==EXDEV?18:5;}return 0;
  }
#endif
  if(argc==2&&strcmp(argv[1],"--owned")){struct identity p;int pid=atoi(argv[1]);if(pid<=1)return 2;int state=identify(pid,&p);if(state<0)return 1;if(!state){if(kill(pid,0)==0||errno==EPERM)return 6;return errno==ESRCH?1:2;}print(&p,0);puts("");return 0;}
  if((argc==3||argc==4)&&!strcmp(argv[1],"--owned")){
    if(!owns(getpid(),argv[2],argc==4?argv[3]:NULL)){fprintf(stderr,"token visibility unavailable\n");return 6;}puts("[");int first=1;
#ifdef __APPLE__
    int count=proc_listallpids(NULL,0);if(count<=0)return 2;int *pids=calloc(count+128,sizeof(int));if(!pids)return 2;count=proc_listallpids(pids,(count+128)*sizeof(int));
    for(int i=0;i<count;i++){int pid=pids[i];
#else
    DIR *dir=opendir("/proc");if(!dir)return 2;struct dirent *d;while((d=readdir(dir))){int pid=atoi(d->d_name);
#endif
      struct identity p;if(pid>1&&pid!=getpid()&&owns(pid,argv[2],argc==4?argv[3]:NULL)){int state=identify(pid,&p);if(state<0)continue;if(!state){if(kill(pid,0)==0||errno==EPERM)return 6;continue;}if(!first)puts(",");print(&p,1);first=0;}
    }
#ifdef __APPLE__
    free(pids);
#else
    closedir(dir);
#endif
    puts("\n]");return 0;
  }
  if((argc==6||argc==7)&&!strcmp(argv[1],"--signal")){
    int pid=atoi(argv[2]),sig=atoi(argv[4]);if(pid<=1||sig<=0||sig>=NSIG)return 2;struct identity p;
    if(identify(pid,&p)<=0||strcmp(p.birth,argv[3]))return 3;
    if(strcmp(argv[5],"--registered")&&!owns(pid,argv[5],argc==7?argv[6]:NULL))return 4;
    /* Recheck incarnation immediately before the syscall. macOS has no pidfd;
       this narrows, but does not make atomic, the POSIX identity/signal boundary. */
    struct identity again;if(identify(pid,&again)<=0||strcmp(p.birth,again.birth))return 3;
    return kill(pid,sig)==0?0:errno==ESRCH?3:5;
  }
  fprintf(stderr,"usage: process-identity PID | --owned TOKEN | --signal PID BIRTH SIGNAL TOKEN|--registered\n");return 2;
}
