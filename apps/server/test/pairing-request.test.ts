import {test} from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';import {config} from '../src/config.js';
const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000'});
async function setup(t:any){const result=await createApp(settings);t.after(()=>result.app.close());const enrolled=await result.app.inject({method:'POST',url:'/api/v1/admin/enroll',headers:{'x-admin-key':settings.adminKey},payload:{name:'TV'}});const token=enrolled.json().token;
 const call=(method:any,path:string,authenticated=false,payload?:unknown,ip='192.0.2.1')=>result.app.inject({method,url:'/api/v1'+path,headers:authenticated?{authorization:`Bearer ${token}`}:{},payload:payload as any,remoteAddress:ip});return {...result,call};}
test('phone pairing requires a live session-aware Roku and exposes no code anonymously',async t=>{
 const {call}=await setup(t);assert.equal((await call('POST','/pairing/request')).statusCode,503);
 await call('GET','/roku/commands',true);assert.equal((await call('POST','/pairing/request')).statusCode,503);
 assert.equal((await call('GET','/roku/commands?connectionId=session-one')).statusCode,401);
});
test('pairing display is independent of playback, reuses codes, dismisses and claims once',async t=>{
 const {call,store}=await setup(t);await call('GET','/roku/commands?connectionId=session-one',true);
 const request=await call('POST','/pairing/request');assert.equal(request.statusCode,202);assert.equal(request.json().code,undefined);assert.equal(request.json().token,undefined);
 const pending=(await call('GET','/roku/commands?connectionId=session-one',true)).json();assert.match(pending.pairingDisplay.code,/^\d{6}$/);assert.deepEqual(pending.commands,[]);assert.equal((await store.read()).activeSession,undefined);
 const display=pending.pairingDisplay;await call('POST','/roku/pairing/display',true,{requestId:display.id,status:'shown'});
 assert.equal((await call('POST','/pairing/request')).json().reused,true);assert.equal((await call('GET','/roku/commands?connectionId=session-one',true)).json().pairingDisplay.id,display.id);
 await call('POST','/roku/pairing/display',true,{requestId:display.id,status:'dismissed'});await call('POST','/roku/pairing/display',true,{requestId:display.id,status:'shown'});
 assert.equal((await call('GET','/roku/commands?connectionId=session-one',true)).json().pairingDisplay,undefined);
 const cooldown=await call('POST','/pairing/request');assert.equal(cooldown.statusCode,429);assert.ok(Number(cooldown.headers['retry-after'])>0);
 assert.equal((await call('POST','/pairing/claim',false,{code:display.code,name:' '})).statusCode,400);
 assert.equal((await call('POST','/pairing/claim',false,{code:display.code,name:'New phone'})).statusCode,200);
 assert.equal((await call('POST','/pairing/claim',false,{code:display.code,name:'Another phone'})).statusCode,400);
});
test('pairing display expires before delivery and does not replay across Roku sessions',async t=>{
 const {call}=await setup(t);await call('GET','/roku/commands?connectionId=session-one',true);await call('POST','/pairing/request');
 assert.equal((await call('GET','/roku/commands?connectionId=session-two',true)).json().pairingDisplay,undefined);
 const original=Date.now;const now=original();try{Date.now=()=>now+16000;assert.equal((await call('GET','/roku/commands?connectionId=session-one',true)).json().pairingDisplay,undefined);Date.now=()=>now+400000;assert.equal((await call('POST','/pairing/request')).statusCode,503);}finally{Date.now=original;}
});
test('liveness remains healthy while storage readiness reports unavailable',async t=>{
 const {app,store}=await setup(t);assert.equal((await app.inject('/ready')).statusCode,200);const read=store.read.bind(store);store.read=async()=>{throw Error('Storage offline');};assert.equal((await app.inject('/health')).statusCode,200);assert.equal((await app.inject('/ready')).statusCode,503);store.read=read;
});
