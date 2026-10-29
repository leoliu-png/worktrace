import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {recordSweepResult} from '../lib/sweep-result.mjs';

test('a blocked inspection retains its scenario and is not recorded as a successful sweep',()=>{
 const store=new Store(':memory:');try{
  store.set('sweepIndex',2);store.set('lastSweep',{at:'2026-10-26T00:00:00Z',answer:{summary:'Earlier result'}});
  recordSweepResult(store,{outcome:'blocked',blockedReason:'登录页面不可访问',summary:'未完成',feedbackSubmitted:false},{directory:'evidence',index:2});
  assert.equal(store.get('sweepIndex'),2);assert.equal(store.get('lastSweep').answer.summary,'Earlier result');
  assert.equal(store.get('lastSweepAttempt').state,'FAILED');assert.match(store.get('lastSweepAttempt').summary,/登录/);
  assert.equal(store.status().events[0].type,'sweep_failed');
 }finally{store.close();}
});

test('a completed inspection with no finding advances to the next scenario',()=>{
 const store=new Store(':memory:');try{
  recordSweepResult(store,{outcome:'completed',blockedReason:'',summary:'已检查，未发现问题',feedbackSubmitted:false},{directory:'evidence',index:2});
  assert.equal(store.get('sweepIndex'),3);assert.equal(store.get('lastSweepAttempt').state,'COMPLETED');
  assert.equal(store.get('lastSweep').answer.feedbackSubmitted,false);
  assert.equal(store.status().events[0].type,'sweep_finished');
  assert.throws(()=>recordSweepResult(store,{outcome:'unknown'},{directory:'evidence',index:3}));
 }finally{store.close();}
});
