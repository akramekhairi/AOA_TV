import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000',FONT_PATH:resolve(import.meta.dirname,'../../../assets/fonts/NotoSansArabic-Regular.ttf')});
type App=Awaited<ReturnType<typeof createApp>>['app'];
const headers=(token:string)=>({authorization:`Bearer ${token}`});
async function enroll(app:App){
  const response=await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'TV'}});
  assert.equal(response.statusCode,200);return response.json().token as string;
}
async function pair(app:App,roku:string,name:string){
  const code=await app.inject({method:'POST',url:'/api/v1/pairing/code',headers:headers(roku)});assert.equal(code.statusCode,200);
  const claim=await app.inject({method:'POST',url:'/api/v1/pairing/claim',payload:{code:code.json().code,name}});assert.equal(claim.statusCode,200);return claim.json().token as string;
}
test('a household artwork burst and health checks cannot exhaust TV or command budgets',async t=>{
  const {app,assets}=await createApp(settings);t.after(()=>app.close());const roku=await enroll(app);const phone=await pair(app,roku,'Phone');
  const asset=new URL(assets.url('text:title:English 2026'));const url=asset.pathname+asset.search;
  for(let i=0;i<300;i++){const response=await app.inject({url});assert.equal(response.statusCode,200,`asset ${i}`);}
  for(let i=0;i<120;i++)assert.equal((await app.inject({url:'/health'})).statusCode,200);
  const limited=await app.inject({url:'/health'});assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);
  assert.equal((await app.inject({url:'/api/v1/tv/status',headers:headers(phone)})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/roku/commands',headers:headers(roku)})).statusCode,200);
  const command=await app.inject({method:'POST',url:'/api/v1/commands',headers:headers(phone),payload:{action:'play',contentId:'xtream:movie:2'}});assert.equal(command.statusCode,200);
  assert.equal((await app.inject({url:asset.pathname+'?e=0&s=invalid'})).statusCode,403);
});
test('authenticated device budgets remain isolated behind the same proxy IP',async t=>{
  const {app}=await createApp(settings);t.after(()=>app.close());const roku=await enroll(app);const first=await pair(app,roku,'First');const second=await pair(app,roku,'Second');
  for(let i=0;i<240;i++)assert.equal((await app.inject({url:'/api/v1/tv/status',headers:headers(first)})).statusCode,200);
  const limited=await app.inject({url:'/api/v1/tv/status',headers:headers(first)});assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);assert.ok(!limited.body.includes(first));
  assert.equal((await app.inject({url:'/api/v1/tv/status',headers:headers(second)})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/roku/commands',headers:headers(roku)})).statusCode,200);
});
test('pairing and enrollment retain strict per-IP limits despite changing bearer headers',async t=>{
  const {app}=await createApp(settings);t.after(()=>app.close());const roku=await enroll(app);
  for(let i=0;i<6;i++)assert.equal((await app.inject({method:'POST',url:'/api/v1/pairing/code',headers:headers(roku)})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/pairing/code',headers:headers(roku)})).statusCode,429);
  for(let i=0;i<8;i++)assert.equal((await app.inject({method:'POST',url:'/api/v1/pairing/claim',headers:headers(`changing-${i}`),payload:{code:'000000',name:'Phone'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/pairing/claim',headers:headers('another-token'),payload:{code:'000000',name:'Phone'}})).statusCode,429);
  // Enrollment above consumed one of the original five requests per minute.
  for(let i=0;i<4;i++)assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{...headers(`changing-${i}`),'x-admin-key':'invalid'},payload:{name:'TV'}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':'invalid'},payload:{name:'TV'}})).statusCode,429);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/enroll',remoteAddress:'192.0.2.8',headers:{'x-admin-key':'invalid'},payload:{name:'TV'}})).statusCode,401);
});
