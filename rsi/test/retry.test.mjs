import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskFailureAction,roleTimeout,agentFailure} from '../lib/retry.mjs';
test('temporary agent failures retry automatically and escalate on the third',()=>{const error=Object.assign(Error('network'),{retryable:true});let task={metadata:{}};for(let count=1;count<=3;count++){const result=taskFailureAction(task,error);assert.equal(result.state,count<3?'QUEUED':'ESCALATED');assert.equal(result.metadata.infrastructureRetries,count);task={metadata:{...task.metadata,...result.metadata}};}});
test('graceful stop and daily quota keep tasks queued without consuming failure retries',()=>{for(const [error,options]of [[Error('stop'),{aborted:true}],[Object.assign(Error('quota'),{code:'AGENT_QUOTA'}),{}]]){const result=taskFailureAction({metadata:{retryAttempt:2}},error,options);assert.equal(result.state,'QUEUED');assert.equal(result.metadata.retryAttempt,3);assert.equal(result.metadata.infrastructureRetries,undefined);}});
test('scope and deterministic safety errors never retry automatically',()=>{assert.equal(taskFailureAction({metadata:{}},Error('scope violation')).state,'ESCALATED');});
test('role timeouts cap short decisions and respect a smaller configured limit',()=>{assert.equal(roleTimeout({agentTimeoutSeconds:900},'triage'),120000);assert.equal(roleTimeout({agentTimeoutSeconds:900},'reviewer'),240000);assert.equal(roleTimeout({agentTimeoutSeconds:60},'developer'),60000);});
test('model capacity retries, while exhausted credits and authentication require intervention',()=>{
 const failure=message=>agentFailure({code:1,out:JSON.stringify({type:'turn.failed',error:{message}})});
 assert.deepEqual({kind:failure('Selected model is at capacity').kind,retryable:failure('Selected model is at capacity').retryable},{kind:'transient',retryable:true});
 assert.deepEqual({kind:failure('Your workspace is out of credits').kind,retryable:failure('Your workspace is out of credits').retryable},{kind:'quota',retryable:false});
 assert.equal(failure('401 unauthorized').kind,'authentication');
});
