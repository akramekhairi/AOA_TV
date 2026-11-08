import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import sharp from 'sharp';
import type { Category, ContentItem } from '@aoa/shared';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { Catalog, HttpError } from './catalog.js';
export interface Asset {bytes:Buffer;mime:string}
const MAX_POSTER_BYTES=10*1024*1024;
const RENDER_SETTINGS={revision:4,family:'Noto Sans Arabic, Noto Sans, Noto Sans Symbols, Noto Sans Symbols 2',titleSize:42,descriptionSize:26,width:1100,dpi:72,align:'right',wrap:'word',foreground:'white',posterWidth:600,posterHeight:900,posterQuality:82};
export function publicPosterAddress(address:string):boolean {
  if(isIP(address)===6){const [first,second=0]=address.split(':').map(value=>parseInt(value||'0',16));return first>=0x2000&&first<=0x3fff&&first!==0x2002&&!(first===0x2001&&(second<0x200||second===0xdb8))&&!(first===0x3fff&&second<0x1000);}
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
type PosterResponse={status:number;location?:string;length?:string;body:AsyncIterable<Uint8Array>;destroy:()=>void};
type PosterDependencies={resolve:(host:string)=>Promise<LookupAddress[]>;request:(url:URL,address:LookupAddress,signal:AbortSignal)=>Promise<PosterResponse>};
const posterDependencies:PosterDependencies={resolve:host=>lookup(host,{all:true}),request:(url,address,signal)=>new Promise((resolve,reject)=>{
  // Pin the validated address to the socket; a second DNS lookup must not bypass SSRF checks.
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{signal,lookup:(_host,options,callback)=>{if(options.all)(callback as any)(null,[address]);else callback(null,address.address,address.family);}},response=>resolve({status:response.statusCode||0,location:response.headers.location,length:response.headers['content-length'],body:response,destroy:()=>response.destroy()}));
  request.on('error',reject);request.end();
})};
export async function fetchPosterBytes(source:string,allowedHosts:string[],dependencies:PosterDependencies=posterDependencies):Promise<Buffer>{
  const allowed=new Set(allowedHosts.map(host=>host.trim().toLowerCase()).filter(Boolean));
  const signal=AbortSignal.timeout(15000);let url:URL;
  try{url=new URL(source);}catch{throw new HttpError(400,'Unsupported poster URL');}
  for(let redirects=0;redirects<=3;redirects++){
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&url.port!==(url.protocol==='https:'?'443':'80'))throw new HttpError(400,'Unsupported poster URL');
    if(!allowed.has(url.hostname.toLowerCase()))throw new HttpError(403,'Poster hostname is not allowed');
    const host=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=await dependencies.resolve(host);
    if(!addresses.length||addresses.some(address=>!publicPosterAddress(address.address)))throw new HttpError(403,'Private poster address blocked');
    signal.throwIfAborted();const response=await dependencies.request(url,addresses[0],signal);
    if([301,302,303,307,308].includes(response.status)){
      response.destroy();if(redirects===3||!response.location)throw new HttpError(502,'Poster redirect limit exceeded');
      let next:URL;try{next=new URL(response.location,url);}catch{throw new HttpError(502,'Invalid poster redirect');}
      if(url.protocol==='https:'&&next.protocol==='http:')throw new HttpError(403,'Insecure poster redirect');url=next;continue;
    }
    if(response.status<200||response.status>=300){response.destroy();throw new HttpError(502,'Poster unavailable');}
    if(Number(response.length)>MAX_POSTER_BYTES){response.destroy();throw new HttpError(413,'Poster too large');}
    let size=0;const chunks:Uint8Array[]=[];
    try{for await(const chunk of response.body){signal.throwIfAborted();size+=chunk.length;if(size>MAX_POSTER_BYTES)throw new HttpError(413,'Poster too large');chunks.push(chunk);}}finally{response.destroy();}
    return Buffer.concat(chunks);
  }
  throw new HttpError(502,'Poster unavailable');
}
export class Assets {
  private cache=new Map<string,Asset>();private size=0;private fontHash='';private pending=new Map<string,Promise<Asset>>();private running=0;private waiters:(()=>void)[]=[];private uploads=Promise.resolve();
  constructor(private config:Config,private store:Store,private catalog:Catalog) {}
  async init(){
    const directory=dirname(this.config.fontPath);const paths=[this.config.fontPath,join(directory,'NotoSans-Regular.ttf'),join(directory,'NotoSansSymbols-Regular.ttf'),join(directory,'NotoSansSymbols2-Regular.ttf')];
    const hash=createHash('sha256').update(JSON.stringify(RENDER_SETTINGS)).update(JSON.stringify(sharp.versions));
    for(const path of paths){const bytes=await readFile(path);if(bytes.length<10000)throw new Error('Bundled render font is invalid');hash.update(bytes);}
    this.fontHash=hash.digest('hex');
    const runtime=await mkdtemp(join(tmpdir(),'aoa-fonts-'));const cache=join(runtime,'cache');await mkdir(cache);
    const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
    const fontconfig=join(runtime,'fonts.conf');
    await writeFile(fontconfig,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${escape(directory)}</dir><cachedir>${escape(cache)}</cachedir><alias><family>sans-serif</family><prefer><family>Noto Sans Arabic</family><family>Noto Sans</family><family>Noto Sans Symbols</family><family>Noto Sans Symbols 2</family></prefer></alias></fontconfig>`);
    process.env.FONTCONFIG_FILE=fontconfig;
    // Explicitly register every bundled face with Pango, including platforms where
    // fontconfig was initialized before this service started.
    for(const path of paths)await sharp({text:{text:'A',fontfile:path,font:'sans-serif 12',rgba:true}}).png().toBuffer();
  }
  private key(descriptor:string){return createHash('sha256').update(`render-v2:${this.fontHash}:${descriptor}`).digest('hex');}
  private signature(key:string,expires:string){return createHmac('sha256',this.config.signingKey).update(`${key}.${expires}`).digest('hex');}
  url(descriptor:string,ttl=3600){const key=Buffer.from(descriptor).toString('base64url')+(descriptor.startsWith('subtitle:')?'.srt':'');const bucket=Math.max(1,Math.min(900,Math.floor(ttl/4)));const expires=String(Math.floor(Date.now()/1000/bucket)*bucket+ttl);return `${this.config.publicUrl}/api/v1/assets/${key}?e=${expires}&s=${this.signature(key,expires)}`;}
  verify(key:string,expires:string,signature:string){if(key.length>16000||!/^\d+$/.test(expires)||Number(expires)<Date.now()/1000||Number(expires)>Date.now()/1000+86401)throw new HttpError(403,'Asset URL expired');const expected=Buffer.from(this.signature(key,expires));const actual=Buffer.from(signature||'');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new HttpError(403,'Invalid asset signature');return Buffer.from(key.endsWith('.srt')?key.slice(0,-4):key,'base64url').toString('utf8');}
  decorate(item:ContentItem):ContentItem {return {...item,poster:item.poster?this.url(`poster:${item.id}`):undefined,titleImage:this.url(`text:title:${item.title.slice(0,300)}`),descriptionImage:item.description?this.url(`text:description:${item.description.slice(0,1800)}`):undefined};}
  category(item:Category):Category{return {...item,titleImage:this.url(`text:title:${item.title.slice(0,300)}`)};}
  private remember(key:string,asset:Asset){if(asset.bytes.length>10*1024*1024)throw new HttpError(413,'Asset too large');const old=this.cache.get(key);if(old)this.size-=old.bytes.length;this.cache.delete(key);while(this.size+asset.bytes.length>64*1024*1024&&this.cache.size){const first=this.cache.keys().next().value!;this.size-=this.cache.get(first)!.bytes.length;this.cache.delete(first);}this.cache.set(key,asset);this.size+=asset.bytes.length;}
  async put(descriptor:string,asset:Asset) {
    const key=this.key(descriptor);if(this.cache.has(key))return this.url(descriptor);this.remember(key,asset);
    if(this.store.client){
      const previous=this.uploads;let release!:()=>void;this.uploads=new Promise<void>(r=>{release=r;});await previous;
      try {const bucket=this.store.client.storage.from(this.config.bucket);const listing=await bucket.list('',{limit:1000,sortBy:{column:'created_at',order:'asc'}});if(listing.error)throw new HttpError(503,'Asset storage unavailable');const files=listing.data||[];let total=files.reduce((sum,f)=>sum+Number(f.metadata?.size||0),0);const remove:string[]=[];for(const file of files){if(total+asset.bytes.length<=128*1024*1024&&files.length-remove.length<900)break;remove.push(file.name);total-=Number(file.metadata?.size||0);}if(remove.length){const result=await bucket.remove(remove);if(result.error)throw new HttpError(503,'Asset cache cleanup failed');}const {error}=await bucket.upload(key,asset.bytes,{contentType:asset.mime,upsert:true});if(error)throw new HttpError(503,'Asset storage unavailable');}finally{release();}
    }
    return this.url(descriptor);
  }
  async get(descriptor:string):Promise<Asset> {
    const key=this.key(descriptor);const cached=this.cache.get(key);if(cached)return cached;const pending=this.pending.get(key);if(pending)return pending;if(this.pending.size>=48)throw new HttpError(429,'Asset renderer busy; retry shortly');
    const work=(async()=>{if(this.running>=2)await new Promise<void>(r=>this.waiters.push(r));this.running++;try{return await this.load(descriptor,key);}finally{this.running--;this.waiters.shift()?.();}})();this.pending.set(key,work);try{return await work;}finally{this.pending.delete(key);}
  }
  async readStored(descriptor:string):Promise<Asset|undefined>{
    const key=this.key(descriptor);const cached=this.cache.get(key);if(cached)return cached;
    if(!this.store.client)return undefined;
    const {data,error}=await this.store.client.storage.from(this.config.bucket).download(key);
    if(data){const asset={bytes:Buffer.from(await data.arrayBuffer()),mime:data.type||'application/octet-stream'};this.remember(key,asset);return asset;}
    if(error&&!/not found/i.test(error.message))throw new HttpError(503,'Asset storage unavailable');
    return undefined;
  }
  private async load(descriptor:string,key:string):Promise<Asset> {
    if(this.store.client){const {data,error}=await this.store.client.storage.from(this.config.bucket).download(key);if(data){const asset={bytes:Buffer.from(await data.arrayBuffer()),mime:data.type||'application/octet-stream'};this.remember(key,asset);return asset;}if(error&&!(error.message.includes('not found')||error.message.includes('Object not found')))throw new HttpError(503,'Asset storage unavailable');}
    let asset:Asset;
    if(descriptor.startsWith('text:')) {
      const [,kind,...parts]=descriptor.split(':');const text=parts.join(':');if(text.length>1800)throw new HttpError(400,'Text too long');
      // Pango/HarfBuzz shapes Arabic using the explicitly supplied bundled font.
      const escaped=text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
      const bytes=await sharp({text:{text:`<span foreground="white">${escaped}</span>`,font:`${RENDER_SETTINGS.family} ${kind==='title'?RENDER_SETTINGS.titleSize:RENDER_SETTINGS.descriptionSize}`,fontfile:this.config.fontPath,width:RENDER_SETTINGS.width,rgba:true,align:'right',wrap:'word',dpi:RENDER_SETTINGS.dpi}}).png().toBuffer();asset={bytes,mime:'image/png'};
    }else if(descriptor.startsWith('poster:')) {
      const item=await this.catalog.get(descriptor.slice(7),false);if(!item.poster)throw new HttpError(404,'Poster not found');
      const allowed=(process.env.POSTER_ALLOWED_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(this.config.xtreamUrl)allowed.push(new URL(this.config.xtreamUrl).hostname.toLowerCase());
      const input=await fetchPosterBytes(item.poster,allowed);
      try{const bytes=await sharp(input,{limitInputPixels:40_000_000,pages:1,failOn:'warning'}).resize({width:600,height:900,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();asset={bytes,mime:'image/jpeg'};}catch{throw new HttpError(502,'Invalid poster image');}
    }else throw new HttpError(404,'Asset not found');
    await this.put(descriptor,asset);return asset;
  }
}

