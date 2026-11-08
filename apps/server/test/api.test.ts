import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { shiftSrt } from '../src/subtitles.js';
const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000',FONT_PATH:resolve(import.meta.dirname,'../../../assets/fonts/NotoSansArabic-Regular.ttf')});
test('pairing, isolation, queued sessions, progress, acknowledgements and Arabic assets',async(t)=>{
  const {app,store}=await createApp(settings);t.after(()=>app.close());
  const call=async(method:any,url:string,token?:string,payload?:unknown)=>app.inject({method,url:'/api/v1'+url,headers:token?{authorization:`Bearer ${token}`}:{},...(payload!==undefined?{payload:payload as any}:{})});
  const enroll=await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'Roku'}});assert.equal(enroll.statusCode,200);const roku=enroll.json().token;
  const pair=(await call('POST','/pairing/code',roku)).json();const claim=await call('POST','/pairing/claim',undefined,{code:pair.code,name:'Phone'});assert.equal(claim.statusCode,200);const phone=claim.json();assert.equal((await call('POST','/pairing/claim',undefined,{code:pair.code,name:'Attacker'})).statusCode,400);
  assert.equal((await call('GET','/roku/commands',phone.token)).statusCode,403);
  const catalog=(await call('GET','/catalog',phone.token)).json();assert.equal(catalog.total,3);assert.ok(!JSON.stringify(catalog).includes('BigBuckBunny'));assert.ok(catalog.items.every((i:any)=>!i.url));
  const titleUrl=new URL(catalog.items[1].titleImage);const image=await app.inject({method:'GET',url:titleUrl.pathname+titleUrl.search});assert.equal(image.statusCode,200);assert.equal(image.headers['content-type'],'image/png');assert.ok(image.rawPayload.length>100);
  const invalidImage=await app.inject({method:'GET',url:titleUrl.pathname+'?e=0&s=invalid'});assert.equal(invalidImage.statusCode,403);
  const first=(await call('POST','/commands',phone.token,{action:'play',contentId:'xtream:movie:2',position:0})).json();assert.ok(first.sessionId);
  const pause=(await call('POST','/commands',phone.token,{action:'pause'})).json();assert.equal(pause.sessionId,first.sessionId);
  const second=(await call('POST','/commands',phone.token,{action:'play',contentId:'xtream:episode:31'})).json();assert.notEqual(first.sessionId,second.sessionId);
  await call('POST','/roku/status',roku,{state:'playing',sessionId:second.sessionId,contentId:'xtream:episode:31',position:7});
  await store.change(state=>{state.tv.updatedAt='2000-01-01T00:00:00.000Z';});
  assert.equal((await call('GET','/tv/status',phone.token)).json().online,false);
  assert.equal((await call('PUT','/roku/progress',roku,{contentId:'xtream:movie:2',position:3,duration:20,completed:false,sessionId:first.sessionId})).statusCode,409);
  assert.equal((await call('POST','/roku/status',roku,{state:'playing',sessionId:first.sessionId})).statusCode,409);
  const live=(await call('GET','/tv/status',phone.token)).json();assert.equal(live.online,true);assert.equal(live.sessionId,second.sessionId);assert.equal(live.position,7);
  await store.change(state=>{state.tv.updatedAt='2000-01-01T00:00:00.000Z';});
  const beforePoll=await store.read();assert.equal((await call('GET','/roku/commands',roku)).statusCode,200);
  assert.equal((await call('GET','/tv/status',phone.token)).json().online,true);assert.deepEqual(await store.read(),beforePoll);
  assert.equal((await call('POST','/roku/status',roku,{state:'idle'})).statusCode,200);
  assert.equal((await call('GET','/tv/status',phone.token)).json().sessionId,second.sessionId);
  const realNow=Date.now;const later=realNow()+31000;
  try { Date.now=()=>later;assert.equal((await call('GET','/tv/status',phone.token)).json().online,false); }
  finally { Date.now=realNow; }
  assert.equal((await call('PUT','/roku/progress',roku,{contentId:'xtream:episode:31',position:20,duration:20,completed:true,sessionId:second.sessionId})).statusCode,200);
  const progress=(await call('GET','/progress',phone.token)).json();assert.ok(progress.items.some((p:any)=>p.contentId==='xtream:episode:32'&&p.position===0));
  const playback=await call('GET',`/roku/playback/${second.id}`,roku);assert.equal(playback.statusCode,200);assert.ok(playback.json().url.startsWith('https:'));assert.equal((await call('GET',`/roku/playback/${second.id}`,phone.token)).statusCode,403);
  assert.equal((await call('POST',`/roku/commands/${second.id}/ack`,roku,{status:'acknowledged'})).statusCode,200);await call('POST',`/roku/commands/${second.id}/ack`,roku,{status:'failed',error:'late failure'});assert.equal((await call('GET',`/commands/${second.id}`,phone.token)).json().status,'acknowledged');
  const subtitleSearch=(await call('GET','/subtitles/search?contentId=xtream%3Aepisode%3A31',phone.token)).json();assert.equal(subtitleSearch.suggestedId,'demo-english');assert.equal((await call('POST','/subtitles/select',phone.token,{contentId:'xtream:episode:31',subtitleId:'demo-english',offset:1.5})).statusCode,200);
  const saved=(await call('GET','/subtitles/selection?contentId=xtream%3Aepisode%3A31',phone.token)).json();assert.deepEqual(saved,{subtitleId:'demo-english',offset:1.5});
  const track=(await call('GET',`/roku/playback/${second.id}`,roku)).json().subtitleUrl;const trackUrl=new URL(track);assert.ok(trackUrl.pathname.endsWith('.srt'));
  const srt=await app.inject({method:'GET',url:trackUrl.pathname+trackUrl.search});assert.equal(srt.statusCode,200);assert.match(srt.body,/00:00:02,500/);
  await store.change(state=>{state.commands[first.id].expiresAt='2000-01-01T00:00:00.000Z';});assert.equal((await call('GET',`/commands/${first.id}`,phone.token)).json().status,'expired');
  assert.equal((await call('DELETE',`/devices/${phone.device.id}`,roku)).statusCode,200);assert.equal((await call('GET','/catalog',phone.token)).statusCode,401);
});
test('SRT positive and negative shifts preserve cue indices and clamp timestamps',()=>{
  const source='1\n00:00:01,500 --> 00:00:03,100\nHello\n';assert.match(shiftSrt(source,1.25),/00:00:02,750 --> 00:00:04,350/);assert.match(shiftSrt(source,-2),/00:00:00,000 --> 00:00:01,100/);
});

test('Roku-issued playback saves progress without hydration and resumes five seconds earlier',async(t)=>{
  const {app,store,catalog}=await createApp(settings);t.after(()=>app.close());
  const enrolled=await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'Roku'}});
  const headers={authorization:`Bearer ${enrolled.json().token}`};
  const call=(method:any,url:string,payload?:any)=>app.inject({method,url:'/api/v1'+url,headers,payload});
  const get=catalog.get.bind(catalog);catalog.get=async(id,hydrate=true)=>{assert.equal(hydrate,false,'Progress and playback must not hydrate upstream metadata');return get(id,false);};
  const play=(await call('POST','/commands',{action:'play',contentId:'xtream:movie:2'})).json();
  assert.ok(play.sessionId);
  assert.equal((await call('GET',`/roku/playback/${play.id}`)).statusCode,200);
  assert.equal((await call('PUT','/roku/progress',{contentId:'xtream:movie:2',sessionId:play.sessionId,position:40,duration:300,completed:false})).statusCode,200);
  assert.equal((await store.read()).progress['xtream:movie:2'].position,40);
  await store.change(state=>{state.progress['xtream:movie:missing']={contentId:'xtream:movie:missing',position:20,duration:60,completed:false,updatedAt:new Date().toISOString()};});
  const progress=(await call('GET','/progress')).json();assert.equal(progress.items.length,1);assert.equal(progress.items[0].position,40);
  assert.equal((await call('POST','/commands',{action:'play',contentId:'xtream:movie:2'})).json().position,35);
  assert.equal((await call('POST','/commands',{action:'play',contentId:'xtream:movie:2',position:0})).json().position,0);
});
