import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';
import type { Category, ContentItem } from '@aoa/shared';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { Catalog, HttpError } from './catalog.js';
export interface Asset {bytes:Buffer;mime:string}
export class Assets {
  private cache=new Map<string,Asset>();private size=0;private font!:Buffer;private fontHash='';private pending=new Map<string,Promise<Asset>>();private running=0;private waiters:(()=>void)[]=[];private uploads=Promise.resolve();
  constructor(private config:Config,private store:Store,private catalog:Catalog) {}
  async init(){this.font=await readFile(this.config.fontPath);if(this.font.length<10000)throw new Error('Arabic font is invalid');this.fontHash=createHash('sha256').update(this.font).digest('hex').slice(0,12);}
  private key(descriptor:string){return createHash('sha256').update(`render-v2:${this.fontHash}:${descriptor}`).digest('hex');}
  private signature(key:string,expires:string){return createHmac('sha256',this.config.signingKey).update(`${key}.${expires}`).digest('hex');}
  url(descriptor:string,ttl=3600){const key=Buffer.from(descriptor).toString('base64url');const expires=String(Math.floor(Date.now()/1000)+ttl);return `${this.config.publicUrl}/api/v1/assets/${key}?e=${expires}&s=${this.signature(key,expires)}`;}
  verify(key:string,expires:string,signature:string){if(key.length>16000||!/^\d+$/.test(expires)||Number(expires)<Date.now()/1000||Number(expires)>Date.now()/1000+86401)throw new HttpError(403,'Asset URL expired');const expected=Buffer.from(this.signature(key,expires));const actual=Buffer.from(signature||'');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new HttpError(403,'Invalid asset signature');return Buffer.from(key,'base64url').toString('utf8');}
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
      const bytes=await sharp({text:{text:`<span foreground="white">${escaped}</span>`,font:`Noto Sans Arabic ${kind==='title'?42:26}`,fontfile:this.config.fontPath,width:1100,rgba:true,align:'right',wrap:'word',dpi:72}}).png().toBuffer();asset={bytes,mime:'image/png'};
    }else if(descriptor.startsWith('poster:')) {
      const item=await this.catalog.get(descriptor.slice(7));if(!item.poster)throw new HttpError(404,'Poster not found');const url=new URL(item.poster);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new HttpError(400,'Unsupported poster URL');
      const allowed=(process.env.POSTER_ALLOWED_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(this.config.xtreamUrl)allowed.push(new URL(this.config.xtreamUrl).hostname.toLowerCase());if(!allowed.includes(url.hostname.toLowerCase()))throw new HttpError(403,'Poster hostname is not allowed');
      const addresses=await lookup(url.hostname,{all:true});if(addresses.some(a=>a.family===6?!/^[23][0-9a-f]{0,3}:/i.test(a.address):/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|192\.0\.|2[2-5]\d\.)/.test(a.address)))throw new HttpError(403,'Private poster address blocked');
      // URLs originate exclusively from the configured provider, never from client input.
      const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw new HttpError(502,'Poster unavailable');const max=10*1024*1024;let size=0;const chunks:Uint8Array[]=[];if(!response.body)throw new HttpError(502,'Poster unavailable');for await(const chunk of response.body as any){size+=chunk.length;if(size>max)throw new HttpError(413,'Poster too large');chunks.push(chunk);}const bytes=await sharp(Buffer.concat(chunks)).resize({width:600,height:900,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();asset={bytes,mime:'image/jpeg'};
    }else throw new HttpError(404,'Asset not found');
    await this.put(descriptor,asset);return asset;
  }
}
