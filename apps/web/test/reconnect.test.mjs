import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../src/reconnect.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {revalidate}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function environment(){const page=Object.assign(new EventTarget(),{hidden:false}),window=new EventTarget(),timers=new Map();let id=0;return {page,window,timers,schedule:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},cancel:id=>timers.delete(id),tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}};}

test('foreground, pageshow, online and focus replace suspended requests without duplicate loops',async()=>{
  const env=environment(),signals=[];let resumes=0;
  const stop=revalidate(signal=>{signals.push(signal);return new Promise(()=>{});},assert.fail,()=>resumes++,env);
  for(const event of ['pageshow','online','focus']){env.window.dispatchEvent(new Event(event));assert.ok(signals.at(-2).aborted);}
  env.page.hidden=true;env.page.dispatchEvent(new Event('visibilitychange'));assert.ok(signals.at(-1).aborted);assert.equal(signals.length,4);
  env.page.hidden=false;env.page.dispatchEvent(new Event('visibilitychange'));assert.equal(signals.length,5);assert.equal(resumes,4);
  stop();assert.ok(signals.at(-1).aborted);env.window.dispatchEvent(new Event('online'));assert.equal(signals.length,5);assert.equal(env.timers.size,0);
});

test('transient failures retry with capped backoff and reset after recovery',async()=>{
  const env=environment();let offline=true,errors=0;
  const stop=revalidate(async()=>{if(offline)throw new Error('warming');},()=>errors++,()=>{},env);
  await flush();
  for(const delay of [1000,2000,4000,8000,16000,30000,30000]){assert.equal(env.timers.size,1);assert.equal([...env.timers.values()][0].delay,delay);env.tick();await flush();}
  offline=false;env.tick();await flush();assert.equal([...env.timers.values()][0].delay,10000);assert.equal(errors,8);
  stop();assert.equal(env.timers.size,0);
});

test('late completion of a suspended poll cannot schedule a second loop',async()=>{
  const env=environment(),resolves=[];
  const stop=revalidate(()=>new Promise(resolve=>resolves.push(resolve)),assert.fail,()=>{},env);
  env.window.dispatchEvent(new Event('pageshow'));resolves[0]();await flush();assert.equal(env.timers.size,0);
  resolves[1]();await flush();assert.equal(env.timers.size,1);stop();
});

test('rate limited polling honors server cooldown',async()=>{
  const env=environment();const stop=revalidate(async()=>{throw {retryAfterMs:45000};},()=>{},()=>{},env);
  await flush();assert.equal([...env.timers.values()][0].delay,45000);stop();
});
