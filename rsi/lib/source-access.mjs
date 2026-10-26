import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {allowedPath} from './git.mjs';

const readable=file=>/^src\/(?:components\/|app\/console\/(?:feedback|logs)\/|lib\/(?:feedback|markdown))/.test(file)&&/\.(?:tsx?|css)$/.test(file)&&allowedPath(file,['src']);
const fingerprint=text=>createHash('sha256').update(text).digest('hex');
export function sourceAccess(root,scope){
 const base=realpathSync(root);
 function resolve(file,{write=false}={}){
  if(typeof file!=='string'||file.includes('\\')||file.includes(':')||file.split('/').some(part=>!part||part==='.'||part==='..')||!readable(file)||write&&!allowedPath(file,scope))throw Error('File is outside the approved source scope.');
  const target=path.resolve(base,file);if(!target.startsWith(base+path.sep))throw Error('Path escaped task checkout.');
  let current=base;for(const part of file.split('/')){current=path.join(current,part);try{if(lstatSync(current).isSymbolicLink())throw Error('Source symlinks are not allowed.');}catch(error){if(error.code!=='ENOENT')throw error;}}
  return target;
 }
 return {
  list(){const files=[];function visit(dir){if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const absolute=path.join(dir,entry.name);if(entry.isDirectory())visit(absolute);else{const relative=path.relative(base,absolute).replaceAll('\\','/');if(readable(relative))files.push(relative);}}}for(const dir of ['src/components','src/app/console/feedback','src/app/console/logs','src/lib'])visit(path.join(base,dir));return files.sort().slice(0,500);},
  read(file){const target=resolve(file);if(!existsSync(target))return {file,exists:false,sha256:null,content:''};if(lstatSync(target).size>100000)throw Error('Source file is too large.');const content=readFileSync(target,'utf8');return {file,exists:true,sha256:fingerprint(content),content};},
  write(file,content,expectedHash){const target=resolve(file,{write:true});if(typeof content!=='string'||Buffer.byteLength(content)>100000)throw Error('Source content exceeds the size limit.');const actual=existsSync(target)?fingerprint(readFileSync(target,'utf8')):null;if(expectedHash!==actual)throw Error('File changed since it was read; read it again before writing.');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content);return {file,sha256:fingerprint(content),bytes:Buffer.byteLength(content)};}
 };
}
