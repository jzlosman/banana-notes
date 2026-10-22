import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/application/persistence';
import type { Library } from '../src/domain';
const lib=(id:string):Library=>({version:1,notes:[],selectedID:id,activeTag:null});
test('writes serialize and coalesce newest pending state, never write an older state last',async()=>{
  let unblock!:()=>void; const gate=new Promise<void>(r=>unblock=r); const writes:string[]=[];
  let concurrent=0,max=0;
  const queue=new SaveQueue({save:async v=>{ concurrent++; max=Math.max(max,concurrent); writes.push(v.selectedID!); if(writes.length===1)await gate; concurrent--; }},()=>{});
  queue.enqueue(lib('one')); queue.enqueue(lib('two')); queue.enqueue(lib('three')); unblock(); await queue.flush();
  assert.deepEqual(writes,['one','three']); assert.equal(max,1);
});
test('failed save reports error and keeps latest state for retry',async()=>{
  let fail=true; const writes:string[]=[]; const states:string[]=[];
  const queue=new SaveQueue({save:async v=>{if(fail)throw new Error('Disk full'); writes.push(v.selectedID!);}},state=>states.push(state));
  queue.enqueue(lib('one')); await assert.rejects(queue.flush()); assert.ok(states.includes('error'));
  fail=false; queue.enqueue(lib('latest')); await queue.flush(); assert.deepEqual(writes,['latest']); assert.equal(states.at(-1),'saved');
});
test('snapshots are detached from later mutable adapter callers',async()=>{
  const writes:Library[]=[]; const queue=new SaveQueue({save:async v=>{writes.push(v);}},()=>{});
  const value=lib('original'); queue.enqueue(value); value.selectedID='mutated'; await queue.flush(); assert.equal(writes[0].selectedID,'original');
});
