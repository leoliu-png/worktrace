import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {git} from '../lib/git.mjs';
test('git preserves porcelain leading status space for unstaged first file',async()=>{const root=mkdtempSync(path.join(tmpdir(),'worktrace-git-test-'));try{const config={projectRoot:root};await git(config,['init','--quiet']);writeFileSync(path.join(root,'sample.txt'),'one');await git(config,['add','sample.txt']);await git(config,['-c','user.name=RSI Test','-c','user.email=rsi-test@example.invalid','-c','core.hooksPath='+path.join(root,'no-hooks'),'commit','--quiet','-m','fixture']);writeFileSync(path.join(root,'sample.txt'),'two');const output=await git(config,['status','--porcelain','-uall']);assert.equal(output,' M sample.txt');assert.equal(output.slice(3),'sample.txt');}finally{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('worktrace-git-test-'));rmSync(resolved,{recursive:true});}});
