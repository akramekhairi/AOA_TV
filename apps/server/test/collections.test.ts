import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import type {ContentItem,Progress} from '@aoa/shared';
import {continueWatching} from '../src/collections.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {config} from '../src/config.js';

const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000',FONT_PATH:resolve(import.meta.dirname,'../../../assets/fonts/NotoSansArabic-Regular.ttf')});
const episode=(n:number,series='a'):ContentItem=>({id:`xtream:episode:${series}${n}`,providerId:String(n),type:'episode',title:`Episode ${n}`,seriesId:`xtream:series:${series}`,season:1,episode:n});
const progress=(item:ContentItem,date:number,completed=false):Progress=>({contentId:item.id,item,position:completed?100:40,duration:100,completed,updatedAt:new Date(date).toISOString()});

test('Continue Watching selects by last viewing time, retains completed latest episodes, and never changes episode progress',async()=>{
  const state=await new Store(settings).read();
  for(const p of [progress(episode(18),100),progress(episode(17),300,true),progress(episode(15),200),progress(episode(1,'b'),250)])state.progress[p.contentId]=p;
  const movie:ContentItem={id:'xtream:movie:1',providerId:'1',type:'movie',title:'Movie'};
  state.progress[movie.id]=progress(movie,280);const before=structuredClone(state.progress);
  const items=await continueWatching(state,async()=>{throw Error('Metadata already embedded');});
  assert.deepEqual(items.map(p=>p.contentId),['xtream:episode:a17',movie.id,'xtream:episode:b1']);
  assert.equal(items[0]!.completed,true);assert.deepEqual(state.progress,before);
  state.progress[movie.id]!.completed=true;
  assert.equal((await continueWatching(state,async()=>undefined)).length,2);
});

test('grouping precedes the limit; hidden series and legacy hidden latest episodes cannot revive older episodes',async()=>{
  const state=await new Store(settings).read();
  for(let n=0;n<120;n++){const p=progress(episode(n),1000+n);state.progress[p.contentId]=p;}
  const other=progress(episode(1,'b'),1);state.progress[other.contentId]=other;
  assert.equal((await continueWatching(state,async()=>undefined)).length,2);
  state.hiddenProgress={'xtream:series:a':new Date(2000).toISOString()};
  assert.deepEqual((await continueWatching(state,async()=>undefined)).map(p=>p.contentId),[other.contentId]);
  state.progress['xtream:episode:a119']!.updatedAt=new Date(3000).toISOString();
  assert.equal((await continueWatching(state,async()=>undefined)).length,2);
  state.hiddenProgress={'xtream:episode:a119':new Date(2000).toISOString()};
  assert.equal((await continueWatching(state,async()=>undefined)).length,1);
});

test('unavailable metadata and live channels do not hide other series; ties are deterministic',async()=>{
  const state=await new Store(settings).read();
  for(const p of [progress(episode(1,'b'),100),progress(episode(1,'a'),100)])state.progress[p.contentId]=p;
  state.progress.missing={contentId:'missing',position:1,duration:2,completed:false,updatedAt:new Date(200).toISOString()};
  const live:ContentItem={id:'xtream:live:1',providerId:'1',type:'live',title:'Live'};state.progress[live.id]=progress(live,300);
  assert.deepEqual((await continueWatching(state,async()=>{throw Error('Unavailable');})).map(p=>p.contentId),['xtream:episode:a1','xtream:episode:b1']);
});

async function setup(t:any){
  const result=await createApp(settings);t.after(()=>result.app.close());
  const enrolled=await result.app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'Test Roku'}});
  const headers={authorization:`Bearer ${enrolled.json().token}`};
  return {...result,call:(method:any,path:string,payload?:any)=>result.app.inject({method,url:'/api/v1'+path,headers,payload})};
}

test('episode favorites normalize existing IDs, deduplicate parents, preserve unresolved IDs and support add/remove aliases',async t=>{
  const {call,store,catalog}=await setup(t);await catalog.seriesEpisodes('xtream:series:3');
  await store.change(state=>{state.favorites=['xtream:episode:31','xtream:series:3','xtream:episode:32','xtream:episode:missing','xtream:movie:2'];});
  assert.deepEqual((await call('GET','/favorites')).json().items.map((i:ContentItem)=>i.id),['xtream:series:3','xtream:movie:2']);
  assert.deepEqual((await store.read()).favorites,['xtream:series:3','xtream:episode:missing','xtream:movie:2']);
  assert.equal((await call('PUT','/favorites/xtream:episode:31')).statusCode,200);
  assert.equal((await store.read()).favorites.filter(id=>id==='xtream:series:3').length,1);
  assert.equal((await call('DELETE','/favorites/xtream:episode:32')).statusCode,200);
  assert.ok(!(await store.read()).favorites.includes('xtream:series:3'));
  assert.equal((await call('PUT','/favorites/xtream:episode:32')).statusCode,200);
  assert.ok((await store.read()).favorites.includes('xtream:series:3'));
});

test('episode detail offers immediate successor across seasons, independent saved progress, and no successor for the finale',async t=>{
  const {call,catalog,store}=await setup(t);const episodes=await catalog.seriesEpisodes('xtream:series:3');
  episodes[1]!.season=2;episodes[1]!.episode=1;
  catalog.storedEpisodes=async()=>episodes;catalog.seriesEpisodes=async()=>episodes;
  await store.change(state=>{state.progress[episodes[1]!.id]=progress(episodes[1]!,100);});
  const detail=(await call('GET','/content/xtream:episode:31')).json();
  assert.equal(detail.nextEpisode.id,'xtream:episode:32');assert.equal(detail.nextEpisode.season,2);
  const next=(await call('GET','/content/xtream:episode:32')).json();assert.equal(next.progress.position,40);
  assert.equal((await call('POST','/commands',{action:'play',contentId:detail.nextEpisode.id})).json().position,35);
  assert.equal((await call('GET','/content/xtream:episode:33')).json().nextEpisode,undefined);
  catalog.storedEpisodes=async()=>{throw Error('Storage unavailable');};
  const degraded=await call('GET','/content/xtream:episode:31');assert.equal(degraded.statusCode,200);assert.equal(degraded.json().nextEpisode,undefined);
});

test('removing an episode card hides its whole series and a subsequent viewing restores it without losing any progress',async t=>{
  const {call,catalog,store}=await setup(t);const episodes=await catalog.seriesEpisodes('xtream:series:3');
  await store.change(state=>{for(const [n,item] of episodes.entries())state.progress[item.id]=progress(item,100+n);});
  assert.equal((await call('DELETE','/progress/xtream:episode:33')).statusCode,200);
  assert.equal((await call('GET','/progress')).json().items.length,0);
  const before=(await store.read()).progress;
  const command=(await call('POST','/commands',{action:'play',contentId:'xtream:episode:31'})).json();
  assert.equal((await call('PUT','/roku/progress',{contentId:'xtream:episode:31',sessionId:command.sessionId,position:50,duration:100,completed:false})).statusCode,200);
  const items=(await call('GET','/progress')).json().items;assert.equal(items.length,1);assert.equal(items[0].contentId,'xtream:episode:31');
  const after=(await store.read()).progress;assert.equal(Object.keys(after).length,3);assert.deepEqual(after['xtream:episode:32'],before['xtream:episode:32']);
});
