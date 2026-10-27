import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const defaultSettings={enabled:true,sweepMinutes:60,pollSeconds:60,maxTasksPerDay:6,maxAgentRunsPerDay:16,maxRepairRounds:5,maxStageAttempts:3,maxVerificationAttempts:5,maxInfrastructureFailures:6,developerReasoningEffort:'high',reviewerReasoningEffort:'high',agentTimeoutSeconds:900,commandTimeoutSeconds:300,maxChangedFiles:12,maxDiffBytes:100000,browserChannel:process.platform==='win32'?'msedge':'',controlPort:3044,appPort:3040,stagePort:3042};
export function loadConfig(){
 const home=path.resolve(process.env.RSI_HOME||path.join(projectRoot,'../service-runtime'));
 if(home===projectRoot||home.startsWith(projectRoot+path.sep))throw Error('RSI_HOME must be outside the source checkout.');
 mkdirSync(home,{recursive:true});
 const filename=path.join(home,'config.json');
 if(!existsSync(filename))writeFileSync(filename,JSON.stringify(defaultSettings,null,2));
 const settings=validateSettings({...defaultSettings,...JSON.parse(readFileSync(filename,'utf8'))});
 const secretFile=path.join(home,'control-secret');
 if(!existsSync(secretFile))writeFileSync(secretFile,randomBytes(32).toString('hex'),{mode:0o600});
 return {...settings,home,projectRoot,configFile:filename,controlSecret:readFileSync(secretFile,'utf8').trim(),database:path.join(home,'runtime.db'),worktraceDatabase:path.join(home,'worktrace.db'),integrationRef:'refs/heads/codex/rsi-local-integration',codexEntry:process.env.RSI_CODEX_ENTRY||'',appUrl:`http://127.0.0.1:${settings.appPort}`,stageUrl:`http://127.0.0.1:${settings.stagePort}`};
}
export function validateSettings(value){
 for(const [key,min,max]of [['sweepMinutes',10,1440],['pollSeconds',10,600],['maxTasksPerDay',1,20],['maxAgentRunsPerDay',1,100],['maxRepairRounds',1,8],['maxStageAttempts',1,3],['maxVerificationAttempts',1,8],['maxInfrastructureFailures',1,9],['agentTimeoutSeconds',60,1800],['commandTimeoutSeconds',30,900],['maxChangedFiles',1,30],['maxDiffBytes',1000,300000],['controlPort',1024,65000],['appPort',1024,65000],['stagePort',1024,65000]]){
  if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw Error(`Invalid setting: ${key}`);
 }
 for(const key of ['developerReasoningEffort','reviewerReasoningEffort'])if(!['medium','high'].includes(value[key]))throw Error(`Invalid setting: ${key}`);
 if(new Set([value.controlPort,value.appPort,value.appPort+1,value.stagePort,value.stagePort+1]).size!==5)throw Error('Local ports must be distinct.');
 if(typeof value.enabled!=='boolean'||!['','chromium','chrome','msedge'].includes(value.browserChannel))throw Error('Invalid runtime settings.');
 return Object.fromEntries(Object.keys(defaultSettings).map(key=>[key,value[key]]));
}
export function cleanEnvironment(extra={}){
 const env={};
 for(const key of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATHEXT','PROCESSOR_ARCHITECTURE','HOME','CODEX_HOME','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'])if(process.env[key])env[key]=process.env[key];
 return {...env,NEXT_TELEMETRY_DISABLED:'1',...extra};
}
export function publicSettings(config){return Object.fromEntries(Object.keys(defaultSettings).map(key=>[key,config[key]]));}
