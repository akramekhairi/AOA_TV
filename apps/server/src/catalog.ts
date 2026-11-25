import type { CatalogPage, Category, ContentItem, MediaType } from '@aoa/shared';
import { normalizeSearch } from '@aoa/shared';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { MetadataCache } from './cache.js';
const types=['live','movie','series'] as const;
export class HttpError extends Error { constructor(public statusCode:number,message:string){super(message);} }
export async function jsonFetch(url:string, init:RequestInit={}) { const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new HttpError(502,'Upstream service unavailable');return response.json(); }
export class Catalog {
  private items=new Map<string,ContentItem>(); private categories:Category[]=[]; private expires=0; private loading?:Promise<void>; private episodes=new MetadataCache<ContentItem[]>(32,4*1024*1024,24*60*60_000);
  private episodeItems=new MetadataCache<ContentItem>(1000,8*1024*1024,24*60*60_000);
  private hydrated=new MetadataCache<ContentItem>(128,4*1024*1024,24*60*60_000);
  private episodeLoading=new Map<string,Promise<ContentItem[]>>();private detailLoading=new Map<string,Promise<ContentItem>>();
  private ttl=24*60*60_000; private refreshAfter=0; private hasTopSnapshot=false;
  private storedTopReady=false; private storedTopLoading?:Promise<void>;
  constructor(private config:Config,private store?:Store) {}
  private async provider(action:string, extra:Record<string,string>={}) {
    const url=new URL(this.config.xtreamUrl+'/player_api.php');Object.entries({username:this.config.xtreamUser,password:this.config.xtreamPassword,action,...extra}).forEach(([k,v])=>url.searchParams.set(k,v));
    return jsonFetch(url.href);
  }
  async refresh() {
    if(this.loading)return this.loading;
    this.expires=0;
    await this.startLoad();
  }
  private async ensure() {
    if(this.expires>Date.now())return;
    if(!this.config.demo&&!this.storedTopReady)await this.loadStoredTop();
    if(this.expires>Date.now())return;
    if(this.hasTopSnapshot) {
      if(!this.loading&&Date.now()>=this.refreshAfter)void this.startLoad().catch(()=>{/* Keep serving the last valid snapshot. */});
      return;
    }
    try {await this.startLoad();} catch(error) {
      // A failed persistence write must not hide successfully fetched provider data.
      if(!this.hasTopSnapshot)throw error;
    }
  }
  private startLoad():Promise<void> {
    if(this.loading)return this.loading;
    this.loading=this.load().catch(error=>{this.refreshAfter=Date.now()+60000;throw error;}).finally(()=>{this.loading=undefined;});
    return this.loading;
  }
  private async load() {
    if(this.config.demo) {
      this.categories=types.map(type=>({id:`demo-${type}`,title:type==='live'?'Live channels':type==='movie'?'أفلام خيالية':'مسلسلات خيالية',type}));
      for(const item of [
        {id:'xtream:live:1',providerId:'1',type:'live',title:'AOA Demo Channel',categoryId:'demo-live',description:'Fictional live channel for interface demonstration.'},
        {id:'xtream:movie:2',providerId:'2',type:'movie',title:'رحلة إلى النجوم',categoryId:'demo-movie',year:2025,description:'فيلم خيالي عن رحلة عائلية إلى النجوم.',extension:'mp4'},
        {id:'xtream:series:3',providerId:'3',type:'series',title:'حكايات المدينة',categoryId:'demo-series',description:'مسلسل خيالي عن الصداقة والمغامرات.'}
      ] as ContentItem[]) this.items.set(item.id,item);
    } else {
      // Raw provider collections can be large. Keep only one response alive at a time.
      const map=new Map<string,ContentItem>();const categories:Category[]=[];
      for(const type of types){
        const action=type==='movie'?'vod':type;
        await this.loadCollection(`get_${action}${type==='series'?'':'_streams'}`,type,map);
        const rows=await this.provider(`get_${action}_categories`);
        if(!Array.isArray(rows))throw new HttpError(502,'Invalid provider catalog');
        for(const row of rows)categories.push({id:`${type}:${row.category_id}`,title:String(row.category_name),type});
      }
      // Commit the complete new snapshot together; failed refreshes keep the old one.
      this.items=map;this.hydrated.clear();this.episodes.clear();this.episodeItems.clear();this.categories=categories;
      this.expires=Date.now()+this.ttl;this.storedTopReady=true;this.hasTopSnapshot=true;this.refreshAfter=0;
      if(this.store?.client){const saved=await this.store.client.from('aoa_catalog').upsert({id:'top',payload:{items:[...map.values()],categories:this.categories},updated_at:new Date().toISOString()});if(saved.error)throw new HttpError(503,'Catalog cache unavailable');}
    }
    this.expires=Date.now()+this.ttl;this.storedTopReady=true;this.hasTopSnapshot=true;this.refreshAfter=0;
  }
  private async loadCollection(action:string,type:MediaType,target:Map<string,ContentItem>){
    const rows=await this.provider(action);if(!Array.isArray(rows))throw new HttpError(502,'Invalid provider catalog');
    for(const row of rows){const item=this.map(row,type);target.set(item.id,item);}
  }
  memoryStats(){return {topItems:this.items.size,episodes:this.episodes.stats(),episodeItems:this.episodeItems.stats(),details:this.hydrated.stats(),episodeJobs:this.episodeLoading.size,detailJobs:this.detailLoading.size};}
  private map(row:any,type:MediaType):ContentItem {
    const providerId=String(type==='series'?row.series_id:row.stream_id??row.id);
    const year=Number(String(row.releaseDate||row.release_date||row.year||'').slice(0,4));
    return {id:`xtream:${type}:${providerId}`,providerId,type,title:String(row.name||row.title||'Untitled'),categoryId:row.category_id?`${type}:${row.category_id}`:undefined,poster:row.stream_icon||row.cover||row.movie_image||undefined,description:row.plot||row.description||undefined,year:year||undefined,extension:row.container_extension||undefined,imdbId:row.imdb_id||row.imdb||undefined,tmdbId:row.tmdb_id?String(row.tmdb_id):undefined};
  }
  async list(query:{type?:string;q?:string;categoryId?:string;page?:string;pageSize?:string}):Promise<CatalogPage> {
    await this.ensure();if(query.type&&!types.includes(query.type as any))throw new HttpError(400,'Invalid catalog type');
    const page=Number(query.page||1),pageSize=Number(query.pageSize||30);if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new HttpError(400,'Invalid pagination');
    const q=normalizeSearch(query.q||'');const items:ContentItem[]=[];let total=0;const start=(page-1)*pageSize;
    for(const item of this.items.values()){if(item.type==='episode'||query.type&&item.type!==query.type||query.categoryId&&item.categoryId!==query.categoryId||q&&!normalizeSearch(item.title).includes(q))continue;if(total>=start&&items.length<pageSize)items.push(item);total++;}
    return {items,total,page,pageSize};
  }
  async categoryList(type?:string) {await this.ensure();if(type&&!types.includes(type as any))throw new HttpError(400,'Invalid category type');return this.categories.filter(c=>!type||c.type===type);}
  async stored(id:string):Promise<ContentItem|undefined> {
    if(this.config.demo)return this.get(id,false);
    const local=this.items.get(id)||this.episodeItems.get(id);if(local)return local;
    if(!this.store?.client)return undefined;
    if(id.startsWith('xtream:episode:')){const result=await this.store.client.from('aoa_content').select('payload').eq('id',id).maybeSingle();if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');if(result.data){const item=result.data.payload as ContentItem;this.episodeItems.set(id,item);return item;}return undefined;}
    await this.loadStoredTop();
    return this.items.get(id);
  }
  private async loadStoredTop():Promise<void> {
    if(this.storedTopReady||!this.store?.client)return;
    if(this.storedTopLoading)return this.storedTopLoading;
    // Favorites and progress resolve many IDs in parallel. Download the persisted
    // snapshot once, including when the requested IDs are absent. This path must
    // never trigger a provider refresh or metadata hydration.
    this.storedTopLoading=(async()=>{
      const result=await this.store!.client!.from('aoa_catalog').select('payload,updated_at').eq('id','top').maybeSingle();
      if(result.error)throw new HttpError(503,'Catalog cache unavailable');
      if(result.data&&!this.hasTopSnapshot) {
        for(const item of (result.data.payload.items||[]) as ContentItem[])if(!this.items.has(item.id))this.items.set(item.id,item);
        this.categories=(result.data.payload.categories||[]) as Category[];
        this.expires=Date.parse(result.data.updated_at)+this.ttl;
        this.hasTopSnapshot=true;
      }
      this.storedTopReady=true;
    })().finally(()=>{this.storedTopLoading=undefined;});
    return this.storedTopLoading;
  }
  async storedEpisodes(seriesId:string):Promise<ContentItem[]> {
    if(this.config.demo)return this.seriesEpisodes(seriesId);
    const cached=this.episodes.get(seriesId);if(cached)return cached;
    if(!this.store?.client)return [];
    const result=await this.store.client.from('aoa_content').select('payload').eq('payload->>seriesId',seriesId).limit(1000);
    if(result.error)throw new HttpError(503,'Episode metadata unavailable');
    return (result.data||[]).map(row=>row.payload as ContentItem).sort((a,b)=>(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0));
  }
  async get(id:string,hydrate=true):Promise<ContentItem> {
    await this.ensure();let item=this.items.get(id)||this.episodeItems.get(id);
    // Episode IDs don't contain the parent series. Persist discovered metadata so restarts
    // never require scanning every series on the provider.
    if(!item&&id.startsWith('xtream:episode:')&&this.store?.client){const result=await this.store.client.from('aoa_content').select('payload').eq('id',id).maybeSingle();if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');if(result.data){item=result.data.payload as ContentItem;this.episodeItems.set(id,item);}}
    if(!item&&id.startsWith('xtream:episode:')&&this.config.demo){item=(await this.seriesEpisodes('xtream:series:3')).find(episode=>episode.id===id);}
    if(!item)throw new HttpError(404,'Content not found');
    if(hydrate&&!this.config.demo&&item.type==='movie') {
      const cached=this.hydrated.get(id);if(cached)return cached;
      const pending=this.detailLoading.get(id);if(pending)return pending;
      if(this.detailLoading.size>=4)throw new HttpError(503,'Metadata busy; retry shortly');
      const base=item;
      const work=(async()=>{const detail=await this.provider('get_vod_info',{vod_id:base.providerId});const info=detail.info||{};
        const enriched={...base,description:info.plot||base.description,poster:info.movie_image||base.poster,imdbId:info.imdb_id||base.imdbId,tmdbId:info.tmdb_id?String(info.tmdb_id):base.tmdbId,year:Number(String(info.releasedate||'').slice(0,4))||base.year};
        this.hydrated.set(id,enriched);return enriched;})();
      this.detailLoading.set(id,work);try{return await work;}finally{this.detailLoading.delete(id);}
    }
    return item;
  }
  async seriesEpisodes(id:string):Promise<ContentItem[]> {
    await this.ensure();const series=this.items.get(id);if(!series||series.type!=='series')throw new HttpError(404,'Series not found');
    const cached=this.episodes.get(id);if(cached)return cached;
    const pending=this.episodeLoading.get(id);if(pending)return pending;
    if(this.episodeLoading.size>=2)throw new HttpError(503,'Metadata busy; retry shortly');
    const work=this.loadEpisodes(id,series);this.episodeLoading.set(id,work);
    try{return await work;}finally{this.episodeLoading.delete(id);}
  }
  private async loadEpisodes(id:string,series:ContentItem):Promise<ContentItem[]> {
    let items:ContentItem[];
    if(this.config.demo)items=[1,2,3].map(n=>({id:`xtream:episode:${30+n}`,providerId:String(30+n),type:'episode',title:`حكايات المدينة - الحلقة ${n}`,seriesId:id,season:1,episode:n,extension:'mp4',description:'حلقة خيالية للعرض التجريبي.'}));
    else {
      const detail=await this.provider('get_series_info',{series_id:series.providerId});
      items=Object.values(detail.episodes||{}).flat().map((row:any)=>({...this.map({...row,stream_id:row.id,...row.info,name:row.title},'episode'),seriesId:id,season:Number(row.season),episode:Number(row.episode_num)}));
    }
    items.sort((a,b)=>(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0));
    if(this.store?.client&&items.length){for(let index=0;index<items.length;index+=200){const result=await this.store.client.from('aoa_content').upsert(items.slice(index,index+200).map(item=>({id:item.id,payload:item,updated_at:new Date().toISOString()})));if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');}}
    for(const item of items)this.episodeItems.set(item.id,item);this.episodes.set(id,items);return items;
  }
  stream(item:ContentItem) {
    if(item.type==='series')throw new HttpError(400,'Choose an episode');
    if(this.config.demo)return 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const kind=item.type==='live'?'live':item.type==='movie'?'movie':'series';const ext=item.type==='live'?'m3u8':item.extension||'mp4';
    return `${this.config.xtreamUrl}/${kind}/${encodeURIComponent(this.config.xtreamUser)}/${encodeURIComponent(this.config.xtreamPassword)}/${encodeURIComponent(item.providerId)}.${encodeURIComponent(ext)}`;
  }
}
