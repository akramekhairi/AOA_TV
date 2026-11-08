import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Catalog} from '../src/catalog.js';
import type {Config} from '../src/config.js';
import type {Store} from '../src/store.js';
import type {ContentItem} from '@aoa/shared';

const items:ContentItem[]=[1,2,3].map(n=>({id:`xtream:movie:${n}`,providerId:String(n),type:'movie',title:`Movie ${n}`}));
function fixture(read:()=>Promise<unknown>) {
  let queries=0;
  const client={from(table:string){assert.equal(table,'aoa_catalog');return {select(){return {eq(column:string,id:string){assert.equal(column,'id');assert.equal(id,'top');return {maybeSingle(){queries++;return read();}};}};}};}};
  return {catalog:new Catalog({demo:false,xtreamUrl:'https://provider.invalid',xtreamUser:'fixture',xtreamPassword:'fixture'} as Config,{client} as unknown as Store),queries:()=>queries};
}
const snapshot=()=>({data:{payload:{items,categories:[]},updated_at:new Date().toISOString()},error:null});

test('parallel stored lookups download one snapshot and preserve requested order without provider calls',async t=>{
  const upstream=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Provider must never be queried by stored()');});
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const fake=fixture(async()=>{await blocked;return snapshot();});
  const pending=Promise.all([3,1,2].map(n=>fake.catalog.stored(`xtream:movie:${n}`)));
  assert.equal(fake.queries(),1);release();
  assert.deepEqual((await pending).map(item=>item?.id),['xtream:movie:3','xtream:movie:1','xtream:movie:2']);
  assert.equal(fake.queries(),1);assert.equal(upstream.mock.callCount(),0);
  assert.equal(await fake.catalog.stored('xtream:movie:missing'),undefined);
  assert.equal(await fake.catalog.stored('xtream:series:missing'),undefined);
  assert.equal(fake.queries(),1);
});
test('successful empty snapshots cache absent IDs instead of re-downloading',async()=>{
  const fake=fixture(async()=>({data:null,error:null}));
  assert.deepEqual(await Promise.all([1,2,3].map(n=>fake.catalog.stored(`xtream:movie:${n}`))),[undefined,undefined,undefined]);
  assert.equal(await fake.catalog.stored('xtream:movie:4'),undefined);assert.equal(fake.queries(),1);
});
test('failed snapshot reads release singleflight and allow a later retry',async()=>{
  let failed=true;
  const fake=fixture(async()=>failed?{data:null,error:{message:'database unavailable'}}:snapshot());
  const outcomes=await Promise.allSettled([1,2,3].map(n=>fake.catalog.stored(`xtream:movie:${n}`)));
  assert.ok(outcomes.every(result=>result.status==='rejected'&&result.reason.statusCode===503));assert.equal(fake.queries(),1);
  failed=false;assert.equal((await fake.catalog.stored('xtream:movie:2'))?.id,'xtream:movie:2');assert.equal(fake.queries(),2);
});
test('normal cache load also marks stored top snapshot ready, including missing IDs',async t=>{
  const upstream=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Fresh cache must avoid provider');});
  const fake=fixture(async()=>snapshot());
  assert.equal((await fake.catalog.list({})).total,3);assert.equal(fake.queries(),1);
  assert.equal(await fake.catalog.stored('xtream:movie:missing'),undefined);assert.equal(fake.queries(),1);assert.equal(upstream.mock.callCount(),0);
});
