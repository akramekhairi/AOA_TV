import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MetadataCache} from '../src/cache.js';

test('metadata LRU enforces count, byte bounds, TTL and releases all values on clear',t=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const cache=new MetadataCache<string>(2,12,100);
  cache.set('a','aaaa');cache.set('b','bbbb');cache.get('a');cache.set('c','cccc');
  assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),'aaaa');assert.equal(cache.stats().bytes,12);
  cache.set('large','this cannot fit');assert.equal(cache.get('large'),undefined);
  now=100;assert.equal(cache.get('a'),undefined);assert.deepEqual(cache.stats(),{entries:0,bytes:0});
  cache.set('a','a');cache.clear();assert.deepEqual(cache.stats(),{entries:0,bytes:0});
});
