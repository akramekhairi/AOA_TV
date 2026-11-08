import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/api.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {request,ApiError}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('requests use scoped authorization and never browser-cache API responses',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://backend.test/api/v1/favorites');assert.equal(options.headers.get('Authorization'),'Bearer phone-secret');assert.equal(options.cache,'no-store');return Response.json({items:[]});};assert.deepEqual(await request('https://backend.test','phone-secret','/favorites'),{items:[]});}finally{globalThis.fetch=original;}});
test('backend errors preserve actionable details but hide credentials and URLs',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({error:'Quota exhausted: https://provider.test/user/password?key=private token=secret'},{status:429});await assert.rejects(request('https://backend.test','t','/subtitles/search'),error=>error instanceof ApiError&&error.status===429&&error.message.includes('Quota exhausted')&&!error.message.includes('secret')&&!error.message.includes('provider.test'));}finally{globalThis.fetch=original;}});
test('only authoritative revoked credentials invalidate the pairing',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({error:'Device token invalid or revoked'},{status:401});await assert.rejects(request('https://backend.test','t','/favorites'),e=>e.invalidCredentials&&/no longer paired/.test(e.message));for(const status of [401,403,429,500,502,503,504]){globalThis.fetch=async()=>new Response('proxy unavailable',{status});await assert.rejects(request('https://backend.test','t','/favorites'),e=>e instanceof ApiError&&!e.invalidCredentials);}}finally{globalThis.fetch=original;}});

test('network failures preserve pairing and late suspended responses are cancelled',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>{throw new TypeError('offline');};await assert.rejects(request('https://backend.test','t','/tv/status'),e=>e.status===0&&!e.invalidCredentials);const controller=new AbortController();globalThis.fetch=async()=>{controller.abort();return Response.json({online:false});};await assert.rejects(request('https://backend.test','t','/tv/status',{},controller.signal),{name:'AbortError'});}finally{globalThis.fetch=original;}});
test('caller cancellation propagates without a misleading connectivity error',async()=>{const original=globalThis.fetch;try{const controller=new AbortController();controller.abort();globalThis.fetch=async(_url,options)=>{options.signal.throwIfAborted();};await assert.rejects(request('https://backend.test','t','/catalog',{},controller.signal),{name:'AbortError'});}finally{globalThis.fetch=original;}});

test('rate limits expose Retry-After without discarding pairing',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({error:'Rate limited'},{status:429,headers:{'Retry-After':'45'}});await assert.rejects(request('https://backend.test','t','/tv/status'),e=>e.retryAfterMs===45000&&!e.invalidCredentials);}finally{globalThis.fetch=original;}});

test('network, timeout, unavailable service and readiness failures have distinct actionable messages',async()=>{
  const original=globalThis.fetch;const originalTimeout=AbortSignal.timeout;
  try {
    globalThis.fetch=async()=>{throw new TypeError('offline');};
    await assert.rejects(request('https://backend.test','','/pairing/request',{method:'POST'}),e=>/internet connection/.test(e.message)&&!/waking|address/.test(e.message));
    AbortSignal.timeout=()=>{const controller=new AbortController();controller.abort(new DOMException('timed out','TimeoutError'));return controller.signal;};
    globalThis.fetch=async(_url,options)=>{options.signal.throwIfAborted();};
    await assert.rejects(request('https://backend.test','','/pairing/request',{method:'POST'}),e=>/request timed out/.test(e.message)&&!/waking/.test(e.message));
    AbortSignal.timeout=originalTimeout;
    for(const status of [502,503,504]) {
      globalThis.fetch=async()=>new Response('gateway failure',{status,headers:{'Retry-After':'35'}});
      await assert.rejects(request('https://backend.test','','/pairing/request',{method:'POST'}),e=>e.retryAfterMs===35000&&/temporarily unavailable|service timed out/.test(e.message)&&!/waking/.test(e.message));
    }
    globalThis.fetch=async()=>Response.json({error:'Service is not ready. Please try again shortly.'},{status:503});
    await assert.rejects(request('https://backend.test','','/pairing/request',{method:'POST'}),e=>/not ready/.test(e.message));
  } finally {globalThis.fetch=original;AbortSignal.timeout=originalTimeout;}
});
test('pairing requests are unauthenticated, accept only pending metadata and never auto retry mutations',async()=>{
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://backend.test/api/v1/pairing/request');assert.equal(options.method,'POST');assert.equal(options.headers.has('Authorization'),false);assert.equal(options.body,undefined);return Response.json({status:'pending',expiresAt:'2026-11-08T16:00:00.000Z',reused:false,retryAfterSeconds:30},{status:202});};
    const result=await request('https://backend.test','','/pairing/request',{method:'POST'});
    assert.equal(result.status,'pending');assert.equal(result.token,undefined);assert.equal(result.code,undefined);assert.equal(calls,1);
    calls=0;globalThis.fetch=async()=>{calls++;return new Response('unavailable',{status:503});};
    await assert.rejects(request('https://backend.test','','/pairing/request',{method:'POST'}));assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
