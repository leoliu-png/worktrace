import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {allowedPath} from './git.mjs';

const styles=['src/app/styles.css','src/app/rsi.css'];
const dependency=/^node_modules\/(?:codemirror-live-markdown|@codemirror\/(?:view|state|language|lang-markdown)|@lezer\/markdown)\/(?:dist\/[^/]+\.(?:js|css|ts)|package\.json)$/;
const readable=file=>styles.includes(file)||/^src\/(?:components\/|app\/console\/(?:feedback|logs|my-logs)\/|app\/actions\/work-logs\.ts$|lib\/(?:feedback|markdown)|lib\/work-log-draft\.ts$|lib\/pasted-work-log-images(?:\.test)?\.ts$)/.test(file)&&/\.(?:tsx?|css)$/.test(file)&&allowedPath(file,['src']);
const fingerprint=text=>createHash('sha256').update(text).digest('hex');
export function sourceAccess(root,scope){
 const base=realpathSync(root);
 function resolve(file,{write=false}={}){
  if(typeof file!=='string'||file.includes('\\')||file.includes(':')||file.split('/').some(part=>!part||part==='.'||part==='..')||!(readable(file)||!write&&dependency.test(file))||write&&(!readable(file)||!allowedPath(file,scope)))throw Error('File is outside the approved source scope.');
  const target=path.resolve(base,file);if(!target.startsWith(base+path.sep))throw Error('Path escaped task checkout.');
  if(dependency.test(file)){const modules=realpathSync(path.join(base,'node_modules')),resolved=realpathSync(target);if(!resolved.startsWith(modules+path.sep))throw Error('Dependency escaped node_modules.');return resolved;}
  let current=base;for(const part of file.split('/')){current=path.join(current,part);try{if(lstatSync(current).isSymbolicLink())throw Error('Source symlinks are not allowed.');}catch(error){if(error.code!=='ENOENT')throw error;}}
  return target;
 }
 return {
  list(){const files=[];function visit(dir){if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const absolute=path.join(dir,entry.name);if(entry.isDirectory())visit(absolute);else{const relative=path.relative(base,absolute).replaceAll('\\','/');if(readable(relative))files.push(relative);}}}for(const dir of ['src/components','src/app/console/feedback','src/app/console/logs','src/app/console/my-logs','src/app/actions','src/lib'])visit(path.join(base,dir));return [...files,...styles.filter(file=>existsSync(path.join(base,file)))].sort().slice(0,500);},
  read(file,{startLine=1,endLine=startLine+79,query}={}){const target=resolve(file);if(!existsSync(target))return {file,exists:false,sha256:null,content:''};if(lstatSync(target).size>5000000)throw Error('Source file is too large.');const content=readFileSync(target,'utf8'),lines=content.split('\n');if(query){const hits=[];for(let i=0;i<lines.length&&hits.length<12;i++)if(lines[i].toLowerCase().includes(query.toLowerCase()))hits.push({line:i+1,text:lines[i].slice(0,350)});return {file,exists:true,sha256:fingerprint(content),totalLines:lines.length,hits};}if(!Number.isInteger(startLine)||startLine<1||!Number.isInteger(endLine)||endLine<startLine)throw Error('Invalid source range.');const end=Math.min(endLine,startLine+159,lines.length);return {file,exists:true,sha256:fingerprint(content),startLine,endLine:end,totalLines:lines.length,content:lines.slice(startLine-1,end).join('\n').slice(0,7000)};},
  patch(file,oldText,newText,expectedHash){const target=resolve(file,{write:true}),content=readFileSync(target,'utf8');if(fingerprint(content)!==expectedHash)throw Error('File changed; read it again.');if(!oldText||content.split(oldText).length!==2)throw Error('Patch must match exactly one source span.');return this.write(file,content.replace(oldText,()=>newText),expectedHash);},
  write(file,content,expectedHash){const target=resolve(file,{write:true});if(typeof content!=='string'||Buffer.byteLength(content)>100000)throw Error('Source content exceeds the size limit.');const actual=existsSync(target)?fingerprint(readFileSync(target,'utf8')):null;if(expectedHash!==actual)throw Error('File changed since it was read; read it again before writing.');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content);return {file,sha256:fingerprint(content),bytes:Buffer.byteLength(content)};}
 };
}
