import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Assets, fetchPosterBytes, publicPosterAddress } from '../src/assets.js';
import { config } from '../src/config.js';
import type { Store } from '../src/store.js';
import type { Catalog } from '../src/catalog.js';

const fontDirectory=resolve(import.meta.dirname,'../../../assets/fonts');
test('signed image URLs remain stable during polling and still expire',()=>{
  const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000'});
  const assets=new Assets(settings,{} as Store,{} as Catalog),original=Date.now,now=Date.UTC(2026,10,8,12,1);
  try{Date.now=()=>now;const first=assets.url('text:title:Test');Date.now=()=>now+10000;assert.equal(assets.url('text:title:Test'),first);
    Date.now=()=>now+900000;assert.notEqual(assets.url('text:title:Test'),first);
    const url=new URL(first);assert.equal(assets.verify(url.pathname.split('/').pop()!,url.searchParams.get('e')!,url.searchParams.get('s')!),'text:title:Test');
    Date.now=()=>now+3600000;assert.throws(()=>assets.verify(url.pathname.split('/').pop()!,url.searchParams.get('e')!,url.searchParams.get('s')!),{statusCode:403});
  }finally{Date.now=original;}
});
// Verify actual Unicode mappings in the bundled OpenType cmap, rather than merely
// checking that PNG generation succeeds (missing-glyph boxes also produce PNGs).
function glyph(font:Buffer,code:number):number {
  let cmap=0;for(let i=0;i<font.readUInt16BE(4);i++){const table=12+i*16;if(font.toString('ascii',table,table+4)==='cmap')cmap=font.readUInt32BE(table+8);}
  for(let i=0;i<font.readUInt16BE(cmap+2);i++){
    const start=cmap+font.readUInt32BE(cmap+4+i*8+4),format=font.readUInt16BE(start);
    if(format===12){for(let j=0;j<font.readUInt32BE(start+12);j++){const p=start+16+j*12,first=font.readUInt32BE(p),last=font.readUInt32BE(p+4);if(code>=first&&code<=last)return font.readUInt32BE(p+8)+code-first;}}
    if(format===4&&code<=65535){const count=font.readUInt16BE(start+6)/2;for(let j=0;j<count;j++){const end=font.readUInt16BE(start+14+j*2),first=font.readUInt16BE(start+16+count*2+j*2);if(code<first||code>end)continue;const delta=font.readInt16BE(start+16+count*4+j*2),rangeAt=start+16+count*6+j*2,offset=font.readUInt16BE(rangeAt);const value=offset?font.readUInt16BE(rangeAt+offset+(code-first)*2):code;return value?(value+delta)&65535:0;}}
  }return 0;
}
test('bundled fallback fonts cover mixed Arabic, Latin, numbers, punctuation and symbols',async()=>{
  const fonts=await Promise.all(['NotoSansArabic-Regular.ttf','NotoSans-Regular.ttf','NotoSansSymbols-Regular.ttf','NotoSansSymbols2-Regular.ttf'].map(file=>readFile(resolve(fontDirectory,file))));
  for(const character of '\u0627\u0644\u0639\u0631\u0628\u064a\u0629English2026()[]:!?&\u2013\u2014\u2605\u2600\u266c')assert.ok(fonts.some(font=>glyph(font,character.codePointAt(0)!)),`No font covers ${character}`);
  const settings=config({DEMO_MODE:'true',ADMIN_KEY:'test-admin-key-000000000000',ASSET_SIGNING_KEY:'test-signing-secret-000000000000000000',FONT_PATH:resolve(fontDirectory,'NotoSansArabic-Regular.ttf')});
  const assets=new Assets(settings,{} as Store,{} as Catalog);await assets.init();
  const asset=await assets.get('text:title:\u0627\u0644\u0639\u0631\u0628\u064a\u0629 English 2026 \u2014 \u2605');
  assert.equal(asset.mime,'image/png');const metadata=await sharp(asset.bytes).metadata();assert.ok(metadata.width!>200&&metadata.width!<=1100);assert.ok(metadata.height!>20);
  if(process.env.AOA_RENDER_SAMPLE){await mkdir(resolve(import.meta.dirname,'../../../.local'),{recursive:true});await writeFile(resolve(import.meta.dirname,'../../../.local/mixed-font-sample.png'),asset.bytes);}
});

const allowed=['posters.example','cdn.example'];
function fixture(responses:{status:number;location?:string;length?:string;chunks?:Buffer[]}[],addresses=['93.184.216.34']){
  const calls:string[]=[];let destroyed=0;
  return {calls,get destroyed(){return destroyed;},dependencies:{resolve:async()=>addresses.map(address=>({address,family:address.includes(':')?6:4})),request:async(url:URL,address:{address:string})=>{assert.ok(addresses.includes(address.address));calls.push(url.href);const response=responses.shift()!;return {...response,body:(async function*(){yield* response.chunks||[Buffer.from('image')];})(),destroy:()=>{destroyed++;}};}}};
}
test('poster fetch follows bounded relative and approved CDN redirects',async()=>{
  const fake=fixture([{status:302,location:'/next'},{status:307,location:'https://cdn.example/cover'},{status:200}]);
  assert.equal((await fetchPosterBytes('https://posters.example/start',allowed,fake.dependencies)).toString(),'image');assert.equal(fake.calls.length,3);assert.equal(fake.destroyed,3);
});
test('poster redirects cannot escape allowlist, expose credentials, downgrade TLS or loop',async()=>{
  for(const location of ['https://other.example/image','https://user:secret@cdn.example/image','http://cdn.example/image','file:///etc/passwd']){
    const fake=fixture([{status:302,location}]);await assert.rejects(fetchPosterBytes('https://posters.example/start',allowed,fake.dependencies));assert.equal(fake.calls.length,1);
  }
  const loop=fixture(Array.from({length:4},()=>({status:302,location:'/again'})));await assert.rejects(fetchPosterBytes('https://posters.example/start',allowed,loop.dependencies),/redirect limit/);assert.equal(loop.calls.length,4);
});
test('poster DNS checks reject every private/reserved address including mixed DNS answers',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::']){
    assert.equal(publicPosterAddress(address),false,address);const fake=fixture([],[address,'93.184.216.34']);await assert.rejects(fetchPosterBytes('https://posters.example/start',allowed,fake.dependencies),/Private/);assert.equal(fake.calls.length,0);
  }
  assert.equal(publicPosterAddress('2606:4700:4700::1111'),true);
});
test('poster download enforces declared and streamed byte limits and closes responses',async()=>{
  for(const response of [{status:200,length:String(11*1024*1024)},{status:200,chunks:[Buffer.alloc(6*1024*1024),Buffer.alloc(5*1024*1024)]}]){
    const fake=fixture([response]);await assert.rejects(fetchPosterBytes('https://posters.example/start',allowed,fake.dependencies),/too large/);assert.equal(fake.destroyed,1);
  }
});


