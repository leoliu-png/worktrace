import {spawn} from 'node:child_process';
import {createServer,request as requestHttp} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,createWriteStream,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encode} from 'next-auth/jwt';
import Database from 'better-sqlite3';
import {cleanEnvironment} from './config.mjs';
import {registerSourceLoader} from './source-loader.mjs';
import {run} from './process.mjs';
import {git} from './git.mjs';
import {fixtureRole,fixtureCookieName,localLoginResponse} from './local-login.mjs';
let dbModule;
export async function appDatabase(config){if(!dbModule){registerSourceLoader(path.join(config.projectRoot,'src'));dbModule=await import(pathToFileURL(path.join(config.projectRoot,'src/lib/db.ts')).href);}return dbModule.createDatabase(config.worktraceDatabase);}
export async function seed(config){
 const db=await appDatabase(config);const users={member:db.findOrCreateUser('rsi.user@feedmob.com','RSI 体验用户'),memberB:db.findOrCreateUser('rsi.user.b@feedmob.com','RSI 体验用户 B'),adminA:db.findOrCreateUser('rsi.admin.a@feedmob.com','本地验收人 A'),adminB:db.findOrCreateUser('rsi.admin.b@feedmob.com','本地验收人 B')};
 for(const user of [users.adminA,users.adminB])if(user.role!=='ADMIN'){db.setUserRole(user.id,'ADMIN',user.id);user.role='ADMIN';}
 if(!db.queryWorkLogs({authorId:users.member.id}).items.length)db.createWorkLog(users.member.id,{reportDate:new Date().toISOString().slice(0,10),title:'RSI 合成工作日志',completed:['记录本地体验场景'],markdownContent:'# RSI 合成工作日志\n\n## Done\n1. 记录本地体验场景\n   - 核对编辑和查看\n\n## Todos\n- [ ] 后续验收\n'});
 db.close();return users;
}
export function appEnvironment(config,publicPort,database=config.worktraceDatabase){
 const uploads=path.join(config.home,'uploads');mkdirSync(uploads,{recursive:true});
 return cleanEnvironment({NODE_ENV:'production',AUTH_SECRET:config.appAuthSecret,KEY_ENCRYPTION_SECRET:config.appEncryptionSecret,AUTH_GOOGLE_ID:'rsi-fixture',AUTH_GOOGLE_SECRET:'rsi-fixture',AUTH_URL:`http://127.0.0.1:${publicPort}`,AUTH_TRUST_HOST:'true',NEXT_PUBLIC_APP_URL:config.appUrl,LOCAL_DATABASE_PATH:database,WORKTRACE_UPLOAD_DIR:uploads,MOBIUS_PAT:'',MOBIUS_SYNC_AUTHOR_EMAILS:'',MOBIUS_MCP_URL:'https://127.0.0.1:1/api/mcp',TIME_OFF_PAT:'',TIME_OFF_ACCOUNT_EMAIL:'',TIME_OFF_BASE_URL:'https://127.0.0.1:1',OPENROUTER_API_KEY:'',TYPESAFE_API_KEY:'',RSI_CONTROL_URL:`http://127.0.0.1:${config.controlPort}`,RSI_CONTROL_TOKEN:config.controlSecret,NODE_OPTIONS:`--import ${pathToFileURL(path.join(config.projectRoot,'rsi/lib/outbound-guard.mjs')).href}`});
}
export class AppManager{
 constructor(config,store,users){this.config=config;this.store=store;this.users=users;this.instances=new Map();}
 async start(name,root,{dev=false}={}){
  await this.stop(name);const config=this.config,port=name==='stage'?config.stagePort:config.appPort;
  let database=config.worktraceDatabase;
  if(name==='stage'){const dataRoot=path.join(config.home,'stage-data');mkdirSync(dataRoot,{recursive:true});database=path.join(dataRoot,path.basename(root)+'.db');if(!existsSync(database)){const source=new Database(config.worktraceDatabase,{readonly:true});try{await source.backup(database);}finally{source.close();}}}
  const log=createWriteStream(path.join(config.home,`${name}-server.log`),{flags:'a'});
  const child=spawn(process.execPath,[path.join(config.projectRoot,'node_modules/next/dist/bin/next'),dev?'dev':'start','--hostname','127.0.0.1','--port',String(port+1)],{cwd:root,env:{...appEnvironment(config,port,database),NODE_ENV:dev?'development':'production'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});let exited=false;child.once('exit',()=>{exited=true;log.end();});
  const proxy=createServer(async(req,res)=>{
   const login=localLoginResponse(req.url||'/',req.method,port);
   if(login){req.resume();res.writeHead(login.status,login.headers).end(login.body);return;}
   const role=fixtureRole(req.headers.cookie,port);
   // Re-encode on long-running services; synthetic sessions must not expire after day one.
   const user=this.users[role];const token=await encode({secret:config.appAuthSecret,salt:'authjs.session-token',maxAge:4*60*60,token:{email:user.email,name:user.name,worktraceUserId:user.id,role:user.role}});
   const cookies=(req.headers.cookie||'').split(';').filter(part=>!part.trim().match(/^(?:__Secure-)?authjs\.session-token(?:=|\.)/)).join(';');
   const upstream=requestHttp({hostname:'127.0.0.1',port:port+1,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`,'x-forwarded-host':`127.0.0.1:${port}`,'x-forwarded-proto':'http',cookie:`${cookies}; authjs.session-token=${token}`}},response=>{const removed=response.headers['set-cookie']?.some(item=>/^(?:__Secure-)?authjs\.session-token=;/.test(item)&&/Max-Age=0/i.test(item));if(removed)response.headers['set-cookie'].push(`${fixtureCookieName(port)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);res.writeHead(response.statusCode||502,response.headers);response.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('本地应用正在启动，请稍后刷新。');});req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',resolve);});
  this.instances.set(name,{child,proxy,root,dev,port});this.store.set(`${name}Runtime`,{pid:child.pid,parentPid:process.pid,root,port,dev});
  for(let attempt=0;attempt<60;attempt++){
   if(exited)throw Error(`${name} 应用退出，请查看服务日志。`);
   try{const response=await fetch(`http://127.0.0.1:${port}/console/feedback`,{signal:AbortSignal.timeout(1500)});if(response.ok){this.store.event(null,'app_ready',`${name} 本地应用已启动`,{port});return;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,700));
  }
  throw Error(`${name} 本地应用启动超时。`);
 }
 async stop(name){const instance=this.instances.get(name);if(!instance)return;this.instances.delete(name);await new Promise(resolve=>{instance.proxy.close(resolve);instance.proxy.closeAllConnections();});if(process.platform==='win32')await run('taskkill',['/PID',String(instance.child.pid),'/T','/F'],{timeout:10000});else instance.child.kill('SIGTERM');this.store.set(`${name}Runtime`,null);}
 async stopAll(){await Promise.all([...this.instances.keys()].map(name=>this.stop(name)));}
}
