import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserQaDisposition,recoverableToolingResult} from '../lib/qa-disposition.mjs';

test('missing instrumentation routes to human review without claiming a pass',()=>{
 const qa={passed:false,failureKind:'tooling',summary:'多图粘贴无法验证',blockedCapabilities:['multi_image_paste'],checks:[{name:'多图粘贴',passed:false,evidence:'工具不支持'}]};
 const result=browserQaDisposition(qa,[]);
 assert.equal(result.status,'unverified');assert.equal(result.unverifiedChecks[0].name,'多图粘贴');assert.deepEqual(result.blockedCapabilities,['multi_image_paste']);assert.equal(qa.passed,false);
});

test('recovery requires matching passed gates and refuses prior product defects on the same version',()=>{
 const sha='a'.repeat(40),qa={failureKind:'tooling',summary:'无法验证',checks:[]};
 const task={state:'ESCALATED',metadata:{escalationKind:'verification_tooling',sourceSha:sha,findings:{qa},checks:{passed:true,sourceSha:sha,artifactHash:'hash',tests:{success:true},results:['lint','typecheck','test','build'].map(name=>({name,passed:true}))},review:{verdict:'Approve',sourceSha:sha}}};
 const tooling={role:'qa',state:'COMPLETED',metadata:{sourceSha:sha,answer:qa}};
 assert.equal(recoverableToolingResult(task,[tooling]).status,'unverified');
 assert.throws(()=>recoverableToolingResult(task,[tooling,{role:'qa',state:'COMPLETED',metadata:{sourceSha:sha,answer:{failureKind:'product'}}}]),/产品问题/);
 assert.throws(()=>recoverableToolingResult({...task,metadata:{...task.metadata,review:{verdict:'Approve',sourceSha:'other'}}},[tooling]),/独立评审/);
 assert.throws(()=>recoverableToolingResult(task,[{...tooling,metadata:{...tooling.metadata,sourceSha:'other'}}]),/候选版本一致/);
});

test('product failures remain blocking even when screenshots or checks are missing',()=>{
 assert.equal(browserQaDisposition({passed:false,failureKind:'product',summary:'内容丢失',checks:[]},[]).status,'product_failure');
 assert.equal(browserQaDisposition({passed:true,failureKind:'product',summary:'内容丢失',checks:[]},[]).status,'product_failure');
});

test('a pass requires checks and screenshot evidence; ambiguous results remain unverified',()=>{
 const qa={passed:true,failureKind:'none',checks:[{name:'保存',passed:true,evidence:'截图'}]};
 assert.equal(browserQaDisposition(qa,['screen.png']).status,'passed');
 assert.equal(browserQaDisposition(qa,[]).status,'unverified');
 assert.equal(browserQaDisposition({...qa,checks:[]},['screen.png']).status,'unverified');
 assert.equal(browserQaDisposition({...qa,checks:[{name:'保存',passed:false}]},['screen.png']).status,'unverified');
});
