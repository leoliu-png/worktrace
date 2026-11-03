import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {run} from './process.mjs';
import {sourceAccess} from './source-access.mjs';
import {automatableScope} from './scope-policy.mjs';
import {allowedPath} from './git.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
// Synchronize only approved product changes, keeping the developer's other edits and Git index.
export async function syncAcceptedWorkspace(config,task){
 const {baseSha,sourceSha,scopeFiles=[]}=task.metadata;
 if(!/^[a-f0-9]{40}$/.test(baseSha||'')||!/^[a-f0-9]{40}$/.test(sourceSha||''))throw Error('Invalid accepted versions.');
 const directory=path.join(config.home,'workspace-sync',task.id,sourceSha+'-'+Date.now());mkdirSync(directory,{recursive:true});
 const invoke=args=>run('git',args,{cwd:config.projectRoot,timeout:15000});
 const changed=await invoke(['diff','--name-status','--no-renames',baseSha,sourceSha]);if(changed.code!==0)throw Error('Cannot read accepted changes.');
 const files=changed.out.trim().split('\n').filter(Boolean).map(line=>{const [kind,file]=line.split('\t');if(!['A','M'].includes(kind)||!automatableScope(file)||!allowedPath(file,scopeFiles))throw Error('Accepted change is outside the safe product scope.');return file;});
 const access=sourceAccess(config.projectRoot,files),plans=[],conflicts=[];
 for(const [index,file]of files.entries()){
  const current=access.read(file,{startLine:1,endLine:1}),target=path.join(config.projectRoot,file),ours=current.exists?readFileSync(target,'utf8'):'';
  const baseResult=await invoke(['show',baseSha+':'+file]),theirsResult=await invoke(['show',sourceSha+':'+file]);
  if(theirsResult.code!==0)throw Error('Accepted source is unavailable.');
  const normalize=text=>text.replaceAll('\r\n','\n');
  const base=normalize(baseResult.code===0?baseResult.out:''),theirs=normalize(theirsResult.out),currentText=normalize(ours);
  const ending=ours.includes('\r\n')?'\r\n':'\n';
  let merged=theirs;
  if(currentText===theirs){plans.push({file,ours,merged:ours,expectedHash:current.sha256});continue;}
  if(currentText!==base){
   const inputs=['ours','base','accepted'].map(name=>path.join(directory,index+'-'+name));
   for(const [n,text]of [currentText,base,theirs].entries())writeFileSync(inputs[n],text);
   const merge=await invoke(['merge-file','--stdout',...inputs]);
   if(merge.code!==0){conflicts.push(file);continue;}merged=merge.out;
  }
  plans.push({file,ours,merged:merged.replaceAll('\n',ending),expectedHash:current.sha256});
 }
 if(conflicts.length)return {state:'CONFLICT',sourceSha,files,conflicts,directory,message:'验收运行版已更新；开发目录存在合并冲突，保留本地改动，尚未同步：'+conflicts.join('、')};
 for(const plan of plans)if(access.read(plan.file,{startLine:1,endLine:1}).sha256!==plan.expectedHash)return {state:'CONFLICT',sourceSha,files,conflicts:[plan.file],directory,message:'同步期间本地文件发生变化，保留本地内容，未写入验收改动。'};
 const written=[];
 try{
  for(const plan of plans){
   if(plan.ours===plan.merged)continue;
   const backup=path.join(directory,'before',plan.file);mkdirSync(path.dirname(backup),{recursive:true});writeFileSync(backup,plan.ours);
   access.write(plan.file,plan.merged,plan.expectedHash);written.push(plan);
  }
 }catch(error){
  for(const plan of written.reverse())if(access.read(plan.file,{startLine:1,endLine:1}).sha256===hash(plan.merged)){if(plan.expectedHash===null){const target=path.resolve(config.projectRoot,plan.file);if(target.startsWith(path.resolve(config.projectRoot)+path.sep)&&existsSync(target))unlinkSync(target);}else access.write(plan.file,plan.ours,hash(plan.merged));}
  throw error;
 }
 const result={state:'SYNCED',sourceSha,files,directory,message:'已将验收改动同步到开发目录，其他本地修改和 Git 暂存区保留。'};
 writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));return result;
}
