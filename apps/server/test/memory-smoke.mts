// Credential-free representative load, also run inside the production Linux image.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {config} from '../src/config.js';
import {createApp} from '../src/app.js';
import {Catalog} from '../src/catalog.js';
import type {Store} from '../src/store.js';

process.env.LOG_LEVEL='silent';
const settings=config({DEMO_MODE:'true',ADMIN_KEY:'memory-test-admin-000000000000',ASSET_SIGNING_KEY:'memory-test-signing-000000000000000000',FONT_PATH:resolve(import.meta.dirname,'../../../assets/fonts/NotoSansArabic-Regular.ttf')});
const realFetch=globalThis.fetch;
let maxRss=0;let maxHeap=0;let maxExternal=0;let providerActive=0;let providerPeak=0;
const sample=()=>{const m=process.memoryUsage();maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);maxExternal=Math.max(maxExternal,m.external);};
const monitor=setInterval(sample,10);monitor.unref();
let snapshot:any;
const client={from(table:string){assert.equal(table,'aoa_catalog');return {
  select(){return {eq(){return {async maybeSingle(){return {data:snapshot||null,error:null};}};}};},
  async upsert(row:any){sample();const bytes=Buffer.byteLength(JSON.stringify(row));assert.ok(bytes>1_000_000);snapshot={payload:row.payload,updated_at:row.updated_at};sample();return {error:null};}
};}};
globalThis.fetch=async(input:any)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'provider.invalid');
  providerActive++;providerPeak=Math.max(providerPeak,providerActive);
  try{
    await new Promise(r=>setTimeout(r,1));
    const action=url.searchParams.get('action')!;
    if(action.endsWith('_categories'))return Response.json([{category_id:1,category_name:'Catalog'}]);
    const count=action==='get_vod_streams'?26421:action==='get_live_streams'?2000:4000;
    const rows=Array.from({length:count},(_,id)=>({stream_id:id,series_id:id,name:`Title ${id}`,stream_icon:`https://images.invalid/${id}.jpg`,plot:`Story ${id} ${'description '.repeat(45)}`,container_extension:'mp4',category_id:1,release_date:'2025-01-01'}));
    const response=Response.json(rows);sample();return response;
  }finally{providerActive--;}
};
const {app,store,assets}=await createApp(settings);
try{
  const catalog=new Catalog({...settings,demo:false,xtreamUrl:'https://provider.invalid'}, {client} as unknown as Store);
  const token=(await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'Memory fixture'}})).json().token;
  const headers={authorization:`Bearer ${token}`};
  await store.change(state=>{
    for(let i=0;i<1000;i++)state.progress[`xtream:episode:${i}`]={contentId:`xtream:episode:${i}`,item:{id:`xtream:episode:${i}`,providerId:String(i),type:'episode',title:`Episode ${i}`,seriesId:`xtream:series:${Math.floor(i/10)}`,season:1,episode:i%10},position:60,duration:120,completed:false,updatedAt:new Date(i).toISOString()};
  });
  const poll=async()=>{
    for(const path of ['/health','/ready','/api/v1/progress','/api/v1/favorites','/api/v1/roku/commands'])assert.equal((await app.inject({url:path,headers})).statusCode,200);
  };
  for(let cycle=0;cycle<3;cycle++){
    const refresh=catalog.refresh();
    const artwork=Promise.allSettled(Array.from({length:40},(_,i)=>assets.get(`text:description:${cycle}-${i} ${'Example title '.repeat(60)}`)));
    for(let i=0;i<10;i++){await poll();await catalog.list({pageSize:'100',q:'Title'});sample();}
    await refresh;const renders=await artwork;
    assert.ok(renders.some(r=>r.status==='fulfilled'));assert.ok(renders.some(r=>r.status==='rejected'&&(r.reason as any).statusCode===429));
    assert.equal((await catalog.list({})).total,32421);assert.equal(providerPeak,1);
    assert.ok(assets.memoryStats().cacheBytes<=16*1024*1024);assert.equal(assets.memoryStats().pending,0);sample();
  }
  // Restart-style warm snapshot load exercises the durable catalog read path.
  const restored=new Catalog({...settings,demo:false}, {client} as unknown as Store);
  assert.equal((await restored.list({pageSize:'1'})).total,32421);await poll();sample();
  const peak=process.resourceUsage().maxRSS*1024;maxRss=Math.max(maxRss,peak);
  const cgroupPeak=await readFile('/sys/fs/cgroup/memory.peak','utf8').then(s=>Number(s.trim())).catch(()=>undefined);
  console.log(JSON.stringify({catalogItems:32421,refreshes:3,maxRssMiB:Math.ceil(maxRss/1024/1024),maxHeapMiB:Math.ceil(maxHeap/1024/1024),maxExternalMiB:Math.ceil(maxExternal/1024/1024),cgroupPeakMiB:cgroupPeak?Math.ceil(cgroupPeak/1024/1024):undefined,assets:assets.memoryStats()}));
  assert.ok(maxRss<460*1024*1024,'Peak RSS must remain below 460 MiB');
}finally{globalThis.fetch=realFetch;clearInterval(monitor);await app.close();}
