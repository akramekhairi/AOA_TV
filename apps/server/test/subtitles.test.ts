import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Subtitles} from '../src/subtitles.js';
import type {Config} from '../src/config.js';

test('corrected subtitle titles match only the requested episode; quotas remain actionable',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const subtitles=new Subtitles({demo:false,subtitlesKey:'test-key'} as Config,{} as any);
  const item={id:'xtream:episode:1',providerId:'1',type:'episode' as const,title:'Provider decorated title',season:2,episode:3,year:2020};
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[3,4].map(episode=>({attributes:{language:'en',feature_details:{title:'Correct Title',year:2020,season_number:2,episode_number:episode},files:[{file_id:episode}]}}))}),{status:200});
  const result=await subtitles.search(item,'Correct Title');assert.equal(result.suggestedId,'3');assert.equal(result.results.find(r=>r.id==='4')?.strongMatch,false);
  const unknown=await subtitles.search({...item,id:'xtream:episode:2',episode:undefined},'Correct Title');assert.equal(unknown.suggestedId,undefined);
  globalThis.fetch=async()=>new Response('{}',{status:429});
  await assert.rejects(()=>subtitles.search({...item,id:'xtream:episode:9'}),{statusCode:429,message:'OpenSubtitles quota exhausted; retry later'});
});
