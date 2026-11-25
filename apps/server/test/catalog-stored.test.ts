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
    assert.equal(fake.queries(),1);assert.equal(provider.mock.callCount(),1);
  }finally{release();await tick();}
  assert.equal((await fake.catalog.list({})).items[0].title,'Fresh movie');assert.equal(fake.queries(),1);
});
test('failed background refresh retains stale data and waits sixty seconds before retrying',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const provider=t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:502}));
  const fake=fixture(async()=>oldSnapshot());
  assert.equal((await fake.catalog.list({})).total,3);await tick();assert.equal(provider.mock.callCount(),1);
  now+=59999;assert.equal((await fake.catalog.list({})).total,3);assert.equal(provider.mock.callCount(),1);
  now+=2;assert.equal((await fake.catalog.list({})).total,3);await tick();assert.equal(provider.mock.callCount(),2);
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

test('a partially fetched refresh does not replace the complete previous catalog',async t=>{
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
    const action=new URL(String(input)).searchParams.get('action');
    return action==='get_live_categories'?new Response('failed',{status:502}):Response.json([{stream_id:42,name:'Partial live channel'}]);
  });
  const fake=fixture(async()=>snapshot());await fake.catalog.list({});
  await assert.rejects(fake.catalog.refresh());
  assert.deepEqual((await fake.catalog.list({})).items.map(item=>item.id),items.map(item=>item.id));
});

test('concurrent series lookups share one provider request; eviction reloads persisted episode IDs',async t=>{
  let seriesCalls=0,episodeReads=0;
  const seriesItems:ContentItem[]=Array.from({length:35},(_,i)=>({id:`xtream:series:${i}`,providerId:String(i),type:'series',title:`Series ${i}`}));
  const episode=(id:string):ContentItem=>({id,providerId:id.split(':')[2]!,type:'episode',title:'Episode',seriesId:'xtream:series:0',season:1,episode:1});
  const client={from(table:string){
    if(table==='aoa_catalog')return {select(){return {eq(){return {maybeSingle:async()=>({data:{payload:{items:seriesItems,categories:[]},updated_at:new Date().toISOString()},error:null})};}};}};
    return {upsert:async()=>({error:null}),select(){return {eq(_column:string,id:string){return {maybeSingle:async()=>{episodeReads++;return {data:{payload:episode(id)},error:null};}};}};}};
  }};
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
    seriesCalls++;await tick();const id=new URL(String(input)).searchParams.get('series_id');
    return Response.json({episodes:{1:[{id:`${id}01`,title:'Episode',season:1,episode_num:1}]}});
  });
  const catalog=new Catalog({demo:false,xtreamUrl:'https://provider.invalid',xtreamUser:'fixture',xtreamPassword:'fixture'} as Config,{client} as unknown as Store);
  const results=await Promise.all(Array.from({length:8},()=>catalog.seriesEpisodes('xtream:series:0')));
  assert.equal(seriesCalls,1);assert.equal(results[0],results[7]);
  for(let i=1;i<35;i++)await catalog.seriesEpisodes(`xtream:series:${i}`);
  assert.equal(catalog.memoryStats().episodes.entries,32);
  // Fill the separate episode cache past its count bound without retaining it in top items.
  for(let i=0;i<1001;i++)await catalog.stored(`xtream:episode:other${i}`);
  assert.equal(catalog.memoryStats().episodeItems.entries,1000);
  const before=episodeReads;assert.equal((await catalog.get('xtream:episode:001',false)).id,'xtream:episode:001');
  assert.equal(episodeReads,before+1);assert.equal(catalog.memoryStats().topItems,35);
});
