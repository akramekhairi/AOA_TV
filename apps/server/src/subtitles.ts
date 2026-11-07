import type { ContentItem, SubtitleResult } from '@aoa/shared';
import type { Config } from './config.js';
import { HttpError } from './catalog.js';
import { normalizeSearch } from '@aoa/shared';
import type { Assets } from './assets.js';
const api='https://api.opensubtitles.com/api/v1';
export function shiftSrt(source:string,offset:number):string {
  return source.replace(/(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})/g,(_m,h,m,s,ms)=>{const n=Math.max(0,Number(h)*3600000+Number(m)*60000+Number(s)*1000+Number(ms)+Math.round(offset*1000));return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;});
}
export class Subtitles {
  private token='';private tokenUntil=0;private matches=new Map<string,{at:number;results:SubtitleResult[]}>();private downloads=new Map<string,string>();private loading=new Map<string,Promise<string>>();
  constructor(private config:Config,private assets:Assets){}
  private async request(path:string,method='GET',body?:unknown,auth=false):Promise<any> {
    if(!this.config.subtitlesKey)throw new HttpError(503,'OpenSubtitles is not configured');
    const response=await fetch(api+path,{method,headers:{'Api-Key':this.config.subtitlesKey,'User-Agent':'AOA_TV v0.1.0','Content-Type':'application/json',...(auth?{Authorization:`Bearer ${await this.login()}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(response.status===429||response.status===406)throw new HttpError(429,'OpenSubtitles quota exhausted; retry later');if(response.status===401||response.status===403)throw new HttpError(503,'OpenSubtitles credentials rejected');if(!response.ok)throw new HttpError(502,'OpenSubtitles service unavailable');return response.json();
  }
  private async login(){if(this.token&&this.tokenUntil>Date.now())return this.token;if(!this.config.subtitlesUser||!this.config.subtitlesPassword)throw new HttpError(503,'OpenSubtitles download account is not configured');const data=await this.request('/login','POST',{username:this.config.subtitlesUser,password:this.config.subtitlesPassword});if(!data.token)throw new HttpError(502,'OpenSubtitles login failed');this.token=data.token;this.tokenUntil=Date.now()+20*3600000;return this.token;}
  async search(item:ContentItem,query?:string) {
    if(!['movie','episode'].includes(item.type))throw new HttpError(400,'Subtitles support movies and episodes');
    if(this.config.demo)return {results:[{id:'demo-english',label:'English · Demo captions',language:'en',score:100,strongMatch:true}],suggestedId:'demo-english'};
    const params=new URLSearchParams({languages:'en',query:query||item.title,type:item.type==='episode'?'episode':'movie'});
    if(item.imdbId)params.set('imdb_id',item.imdbId.replace(/^tt/,''));else if(item.tmdbId)params.set('tmdb_id',item.tmdbId);
    if(item.season)params.set('season_number',String(item.season));if(item.episode)params.set('episode_number',String(item.episode));
    const cacheKey=item.id+'|'+(query||'');const cached=this.matches.get(cacheKey);let results:SubtitleResult[];
    if(cached&&cached.at>Date.now()-300000)results=cached.results;
    else {const data=await this.request('/subtitles?'+params);results=(data.data||[]).filter((r:any)=>r.attributes?.language==='en').flatMap((r:any)=>{
      const a=r.attributes,f=a.feature_details||{};const identity=!!((item.imdbId&&String(f.imdb_id)===item.imdbId.replace(/^tt/,''))||(item.tmdbId&&String(f.tmdb_id)===item.tmdbId));const episodeMatch=item.type!=='episode'||(Number(f.season_number)===item.season&&Number(f.episode_number)===item.episode);const titleMatch=normalizeSearch(f.title||f.movie_name||'')===normalizeSearch(item.title);const yearMatch=!item.year||Number(f.year)===item.year;const strongMatch=episodeMatch&&(identity||(titleMatch&&yearMatch));const score=(identity?70:titleMatch?50:10)+(episodeMatch?15:0)+(yearMatch?10:0)+(a.from_trusted?5:0);
      return (a.files||[]).map((file:any)=>({id:String(file.file_id),label:String(a.release||file.file_name||f.title||'English subtitle'),language:'en',score,strongMatch,downloadCount:Number(a.download_count)||0}));
    }).sort((a:SubtitleResult,b:SubtitleResult)=>b.score-a.score||(b.downloadCount||0)-(a.downloadCount||0));this.matches.set(cacheKey,{at:Date.now(),results});if(this.matches.size>500)this.matches.delete(this.matches.keys().next().value!);}
    return {results,suggestedId:results.find(r=>r.strongMatch)?.id};
  }
  async validate(item:ContentItem,id:string) {for(const [key,value]of this.matches)if(key.startsWith(item.id+'|')&&value.at>Date.now()-300000&&value.results.some(r=>r.id===id))return;const {results}=await this.search(item);if(!results.some(r=>r.id===id))throw new HttpError(400,'Subtitle must be selected from this item’s English search results');}
  async url(id:string,offset:number):Promise<string> {
    const descriptor=`subtitle:${id}:${offset}`;
    if(await this.assets.readStored(descriptor))return this.assets.url(descriptor);
    const stored=await this.assets.readStored(`subtitle:${id}:0`);
    if(stored)this.downloads.set(id,stored.bytes.toString('utf8'));
    const cached=this.downloads.get(id);if(cached)return this.assets.put(descriptor,{bytes:Buffer.from(shiftSrt(cached,offset)),mime:'application/x-subrip; charset=utf-8'});
    if(this.loading.has(id)){await this.loading.get(id);return this.url(id,offset);}
    const pending=this.download(id);this.loading.set(id,pending);try{const source=await pending;this.downloads.set(id,source);if(this.downloads.size>10)this.downloads.delete(this.downloads.keys().next().value!);await this.assets.put(`subtitle:${id}:0`,{bytes:Buffer.from(source),mime:'application/x-subrip; charset=utf-8'});return await this.assets.put(descriptor,{bytes:Buffer.from(shiftSrt(source,offset)),mime:'application/x-subrip; charset=utf-8'});}finally{this.loading.delete(id);}
  }
  private async download(id:string){if(this.config.demo)return '1\n00:00:01,000 --> 00:00:04,000\nWelcome to AOA TV demo.\n';if(!/^\d+$/.test(id))throw new HttpError(400,'Invalid subtitle ID');const data=await this.request('/download','POST',{file_id:Number(id),sub_format:'srt'},true);if(!data.link)throw new HttpError(502,'Subtitle download unavailable');const link=new URL(data.link);if(link.protocol!=='https:')throw new HttpError(502,'Invalid subtitle download URL');const response=await fetch(link,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new HttpError(502,'Subtitle download failed');const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw new HttpError(413,'Subtitle too large');if(!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text))throw new HttpError(502,'Invalid SRT subtitle');return text;}
}
