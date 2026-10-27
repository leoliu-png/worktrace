import path from 'node:path';
import {allowedPath} from './git.mjs';
import {sourceAccess} from './source-access.mjs';

const productScope=/^src\/(?:components\/(?!rsi|console-shell|console-page-frame|account|language-toggle|feedback-list)[\w/\[\]-]+(?:\.test)?(?:\.tsx?)?|app\/console\/(?:logs|feedback|my-logs)(?:\/[\w/\[\]-]+(?:\.test)?(?:\.tsx?)?)?|lib\/(?:feedback[\w.-]*|markdown[\w.-]*)\.tsx?)$/;
export const automatableScope=file=>typeof file==='string'&&(productScope.test(file)||/^src\/lib\/pasted-work-log-images(?:\.test)?\.ts$/.test(file))&&allowedPath(file,[file]);
export function validScopePlan(scope,acceptance,config){
 return Array.isArray(scope)&&scope.length>0&&scope.length<=config.maxChangedFiles&&scope.every(automatableScope)&&Array.isArray(acceptance)&&acceptance.length>0&&acceptance.every(item=>typeof item==='string'&&item.trim());
}

// Read only the same product sources available to the isolated source tool.
export function planningContext(root,task,{requestedFiles=[]}={}){
 const source=sourceAccess(root,[]),catalog=source.list(),known=new Set(catalog),scope=task.metadata.scopeFiles||task.metadata.previousScopeFiles||[];
 const original=[task.title,task.description].filter(Boolean).join('\n'),text=[original,task.metadata.agentInstructions].filter(Boolean).join('\n');
 const mine=/我的(?:工作)?日志|我的工作轨迹|my[ -]logs/i.test(text),editing=/编辑|修改|\bedit/i.test(text),creating=/新建(?:工作)?日志|创建(?:工作)?日志|new.*log|logs\/new/i.test(text);
 const relevant=mine?['src/app/console/my-logs/page.tsx','src/components/my-log-list.tsx',...(editing?['src/app/console/logs/[id]/edit/page.tsx']:[])]:creating?['src/app/console/logs/new/page.tsx']:/反馈|feedback/i.test(original)?['src/app/console/feedback/page.tsx','src/components/feedback-form.tsx']:editing?['src/app/console/logs/[id]/edit/page.tsx','src/app/console/my-logs/page.tsx','src/components/my-log-list.tsx']:['src/app/console/logs/page.tsx','src/app/console/logs/[id]/page.tsx','src/app/console/logs/new/page.tsx'];
 const seeds=scope.length?catalog.filter(file=>allowedPath(file,scope)&&!file.includes('.test.')):relevant.filter(file=>known.has(file));
 const selected=[...new Set([...requestedFiles.filter(file=>known.has(file)),...relevant.filter(file=>known.has(file)),...seeds])].slice(0,8),files=[],dependencies=new Set();
 function resolveImport(file,specifier){
  const base=specifier.startsWith('@/')?'src/'+specifier.slice(2):specifier.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)):'';
  return [base,base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx'].find(candidate=>known.has(candidate));
 }
 for(let index=0;index<selected.length&&files.length<10;index++){
  const file=selected[index];let item;try{item=source.read(file);}catch{continue;}
  files.push({file,content:item.content.slice(0,10000),truncated:item.content.length>10000,currentlyWritable:allowedPath(file,scope)});
  for(const match of item.content.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)){
   const dependency=resolveImport(file,match[1]);if(!dependency)continue;
   if(seeds.includes(file)&&automatableScope(dependency)&&!allowedPath(dependency,scope))dependencies.add(dependency);
   if(!selected.includes(dependency)&&selected.length<10)selected.push(dependency);
  }
 }
 return {catalog:catalog.filter(automatableScope).slice(0,200),files,missingRequestedFiles:requestedFiles.filter(file=>!known.has(file)),dependenciesOutsideScope:[...dependencies]};
}
