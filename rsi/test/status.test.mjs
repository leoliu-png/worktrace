import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {statusReport} from '../lib/status.mjs';
import {defaultSettings} from '../lib/config.mjs';

test('an expired agent call is not presented as healthy running work',()=>{
 const store=new Store(':memory:');try{
  store.set('appReady',true);store.set('enabled',true);
  const id=store.startRun(null,'user'),startedAt=new Date(Date.now()-15*3600000).toISOString();
  store.db.prepare('UPDATE runs SET started_at=? WHERE id=?').run(startedAt,id);
  store.set('activeProcess',{runId:id,pid:123,role:'user'});
  store.set('currentWork',{kind:'sweep',startedAt});
  const report=statusReport(defaultSettings,store);
  assert.equal(report.runtime.state,'BACKOFF');assert.match(report.runtime.title,/已超时/);
  assert.match(report.runtime.description,/不会被记录为成功/);
 }finally{store.close();}
});

test('a later failed sweep is visible instead of a stale successful result',()=>{
 const store=new Store(':memory:');try{
  store.set('appReady',true);store.set('enabled',false);
  store.set('lastSweep',{at:'2026-10-26T09:00:00Z',answer:{summary:'Old completed check'}});
  store.set('lastSweepAttempt',{state:'FAILED',at:'2026-10-27T08:00:00Z',summary:'调用中断，未完成检查'});
  const report=statusReport(defaultSettings,store);
  assert.equal(report.runtime.state,'PAUSED');assert.equal(report.runtime.agent,null);
  assert.match(report.runtime.lastSweep.summary,/巡检未完成/);
  store.set('lastSweep',{at:'2026-10-27T09:00:00Z',answer:{summary:'New completed check'}});
  assert.equal(statusReport(defaultSettings,store).runtime.lastSweep.summary,'New completed check');
 }finally{store.close();}
});
