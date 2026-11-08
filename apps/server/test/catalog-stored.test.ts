import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Catalog} from '../src/catalog.js';
import type {Config} from '../src/config.js';
import type {Store} from '../src/store.js';
import type {ContentItem} from '@aoa/shared';

const items:ContentItem[]=[1,2,3].map(n=>({id:`xtream:movie:${n}`,providerId:String(n),type:'movie',title:`Movie ${n}`}));
function fixture(read:()=>Promise<unknown>,persist:()=>Promise<unknown>=async()=>({error:null})) {
  let queries=0;
  const client={from(table:string){assert.equal(table,'aoa_catalog');return {upsert:persist,select(){return {eq(column:string,id:string){assert.equal(column,'id');assert.equal(id,'top');return {maybeSingle(){queries++;return read();}};}};}};}};
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

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const oldSnapshot=()=>({data:{payload:{items,categories:[{id:'movie:old',title:'Saved movies',type:'movie'}]},updated_at:new Date(Date.now()-48*60*60*1000).toISOString()},error:null});
const providerResponse=(url:string|URL|Request)=>{
  const action=new URL(String(url)).searchParams.get('action');
  return Response.json(action==='get_vod_streams'?[{stream_id:9,name:'Fresh movie'}]:[]);
};
test('stale snapshot serves items and categories immediately while exactly one provider refresh is blocked',{timeout:1000},async t=>{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  const provider=t.mock.method(globalThis,'fetch',async(url:string|URL|Request)=>{await blocked;return providerResponse(url);});
  const fake=fixture(async()=>oldSnapshot());
  try {
    const page=await fake.catalog.list({});assert.equal(page.total,3);
    assert.equal((await fake.catalog.categoryList())[0].title,'Saved movies');
    await Promise.all([fake.catalog.list({}),fake.catalog.list({}),fake.catalog.categoryList()]);
    assert.equal(fake.queries(),1);assert.equal(provider.mock.callCount(),6);
  }finally{release();await tick();}
  assert.equal((await fake.catalog.list({})).items[0].title,'Fresh movie');assert.equal(fake.queries(),1);
});
test('failed background refresh retains stale data and waits sixty seconds before retrying',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const provider=t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:502}));
  const fake=fixture(async()=>oldSnapshot());
  assert.equal((await fake.catalog.list({})).total,3);await tick();assert.equal(provider.mock.callCount(),6);
  now+=59999;assert.equal((await fake.catalog.list({})).total,3);assert.equal(provider.mock.callCount(),6);
  now+=2;assert.equal((await fake.catalog.list({})).total,3);await tick();assert.equal(provider.mock.callCount(),12);
  assert.equal(fake.queries(),1);
});
test('cache persistence failure keeps fresh provider data usable and explicit refresh reports failure',async t=>{
  const provider=t.mock.method(globalThis,'fetch',async(url:string|URL|Request)=>providerResponse(url));
  const fake=fixture(async()=>({data:null,error:null}),async()=>({error:{message:'write failed'}}));
  const page=await fake.catalog.list({});assert.equal(page.total,1);assert.equal(page.items[0].title,'Fresh movie');
  assert.equal((await fake.catalog.list({})).items[0].title,'Fresh movie');assert.equal(provider.mock.callCount(),6);
  await assert.rejects(fake.catalog.refresh(),(error:any)=>error.statusCode===503);
  assert.equal((await fake.catalog.list({})).items[0].title,'Fresh movie');assert.equal(provider.mock.callCount(),12);
});
test('initial empty catalog waits for provider and propagates provider failure',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:502}));
  const fake=fixture(async()=>({data:null,error:null}));
  await assert.rejects(fake.catalog.list({}),(error:any)=>error.statusCode===502);
});
