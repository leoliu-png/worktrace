import path from 'node:path';
import {existsSync,mkdirSync,symlinkSync,readFileSync} from 'node:fs';
import {run} from './process.mjs';
import {cleanEnvironment} from './config.mjs';
export async function git(config,args,cwd=config.projectRoot){const result=await run('git',args,{cwd,env:cleanEnvironment(),timeout:30000});if(result.code!==0)throw Error(`Git 操作失败：${result.err.slice(0,500)}`);return result.out.trimEnd();}
export async function integrationHead(config){const existing=await run('git',['rev-parse','--verify',config.integrationRef],{cwd:config.projectRoot,env:cleanEnvironment()});if(existing.code===0)return existing.out.trim();const head=await git(config,['rev-parse','HEAD']);await git(config,['update-ref',config.integrationRef,head]);return head;}
export async function checkout(config,name,sha,{branch=false}={}){
 if(!/^[a-z0-9-]{1,90}$/.test(name))throw Error('Invalid worktree name.');
 const root=path.join(config.home,'worktrees');mkdirSync(root,{recursive:true});const target=path.resolve(root,name);
 if(!target.startsWith(path.resolve(root)+path.sep))throw Error('Worktree escaped runtime root.');
 if(!existsSync(target))await git(config,['worktree','add',...(branch?['-b',`codex/rsi-${name}`]:['--detach']),target,sha]);
 else if(await git(config,['rev-parse','HEAD'],target)!==sha&&!branch)throw Error('Unexpected existing worktree commit.');
 if(!existsSync(path.join(target,'node_modules')))symlinkSync(path.join(config.projectRoot,'node_modules'),path.join(target,'node_modules'),'junction');
 const nested=path.join(target,'rsi/node_modules');if(!existsSync(nested))symlinkSync(path.join(config.projectRoot,'rsi/node_modules'),nested,'junction');
 if(existsSync(path.join(target,'.env'))||existsSync(path.join(target,'.env.local')))throw Error('Unexpected environment file in local worktree.');
 return target;
}
const forbidden=/(^|\/)(rsi|\.git|\.github|\.private|node_modules|prisma)(\/|$)|(^|\/)(AGENTS\.md|package(?:-lock)?\.json|pnpm-lock\.yaml|next\.config\.[^/]+|middleware\.[^/]+|auth\.[^/]+|\.env[^/]*|vitest\.config\.[^/]+|tsconfig\.json)$|src\/lib\/(db|access|session|api-keys|mobius|time-off)/i;
export function allowedPath(filename,scope){const file=filename.replaceAll('\\','/');if(file.startsWith('/')||file.split('/').includes('..')||forbidden.test(file))return false;if(!file.startsWith('src/'))return false;return scope.some(item=>{const normalized=item.replace(/\/$/,'');return file===normalized||file.startsWith(normalized+'/')||file===normalized.replace(/\.tsx?$/,'.test.ts');});}
export function unsafeDiffReason(diff){const added=diff.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++')).join('\n');if(/(?:from\s*|(?:import|require)\s*\()\s*['"](?:node:)?(?:fs|child_process|process|os|net|http|https|tls|worker_threads|vm)(?:\/|['"])/.test(added))return '新增宿主系统或网络执行能力，需人工审查后再运行检查。';if(/\b(?:eval|Function|execSync|execFile|spawn|rmSync|unlinkSync|truncateSync)\s*\(|dangerouslySetInnerHTML|process\.env|DROP\s+TABLE|DELETE\s+FROM/i.test(added))return '新增高风险执行、环境读取或破坏性操作，需人工审查。';return null;}
export async function commitCandidate(config,task,cwd){
 const status=await git(config,['status','--porcelain','-uall'],cwd);if(!status)throw Error('开发 Agent 没有产生代码改动。');
 const changes=status.split('\n').map(line=>({kind:line.slice(0,2),file:line.slice(3).replace(/^"|"$/g,'')}));
 if(changes.length>config.maxChangedFiles||changes.some(x=>/[DR]/.test(x.kind)||!allowedPath(x.file,task.metadata.scopeFiles)))throw Error('改动包含删除、重命名或超出已批准范围的文件，已转人工。');
 const unstaged=await git(config,['diff','--stat'],cwd);if(unstaged.length>5000)throw Error('Change set too large.');
 await git(config,['add','--',...changes.map(x=>x.file)],cwd);
 const diff=await git(config,['diff','--cached','--no-ext-diff','--unified=3'],cwd);
 if(Buffer.byteLength(diff)>config.maxDiffBytes||/(?:wtk_|fmtopat_|mob_)[a-zA-Z0-9_-]{15,}|sk-[a-zA-Z0-9_-]{20,}/.test(diff))throw Error('Diff exceeds the limit or appears to contain a credential.');
 const unsafe=unsafeDiffReason(diff);if(unsafe)throw Error(unsafe);
 await git(config,['-c','core.hooksPath='+path.join(config.home,'no-hooks'),'commit','-m',`fix: ${task.title.replace(/\s+/g,' ').slice(0,80)} (RSI ${task.id.slice(0,8)})`],cwd);
 const sourceSha=await git(config,['rev-parse','HEAD'],cwd);return {sourceSha,files:changes.map(x=>x.file),diff};
}
export function relatedContext(cwd,files){return files.filter(file=>/\.tsx?$/.test(file)).map(file=>`\nFILE ${file}\n${readFileSync(path.join(cwd,file),'utf8').slice(0,18000)}`).join('\n').slice(0,100000);}
