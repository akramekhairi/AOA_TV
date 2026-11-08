import type { CatalogPage, Category, ContentItem, MediaType } from '@aoa/shared';
import { normalizeSearch } from '@aoa/shared';
import type { Config } from './config.js';
import type { Store } from './store.js';
const types=['live','movie','series'] as const;
export class HttpError extends Error { constructor(public statusCode:number,message:string){super(message);} }
export async function jsonFetch(url:string, init:RequestInit={}) { const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new HttpError(502,'Upstream service unavailable');return response.json(); }
export class Catalog {
  private items=new Map<string,ContentItem>(); private categories:Category[]=[]; private expires=0; private loading?:Promise<void>; private episodes=new Map<string,{expires:number;items:ContentItem[]}>();private hydrated=new Set<string>();
  private ttl=24*60*60_000; private forceRefresh=false;
  constructor(private config:Config,private store?:Store) {}
  private async provider(action:string, extra:Record<string,string>={}) {
    const url=new URL(this.config.xtreamUrl+'/player_api.php');Object.entries({username:this.config.xtreamUser,password:this.config.xtreamPassword,action,...extra}).forEach(([k,v])=>url.searchParams.set(k,v));
    return jsonFetch(url.href);
  }
  async refresh() {if(this.loading)await this.loading;this.expires=0;this.episodes.clear();this.hydrated.clear();this.forceRefresh=true;try{await this.ensure();}finally{this.forceRefresh=false;}}
  private async ensure() {
    if(this.expires>Date.now())return;
    if(this.loading)return this.loading;
    this.loading=this.load().finally(()=>{this.loading=undefined;});return this.loading;
  }
  private async load() {
    if(!this.config.demo&&!this.forceRefresh&&this.store?.client){
      const result=await this.store.client.from('aoa_catalog').select('payload,updated_at').eq('id','top').maybeSingle();
      if(result.error)throw new HttpError(503,'Catalog cache unavailable');
      if(result.data&&Date.parse(result.data.updated_at)+this.ttl>Date.now()){
        this.items=new Map((result.data.payload.items as ContentItem[]).map(item=>[item.id,item]));
        this.categories=result.data.payload.categories as Category[];this.expires=Date.parse(result.data.updated_at)+this.ttl;return;
      }
    }
    if(this.config.demo) {
      this.categories=types.map(type=>({id:`demo-${type}`,title:type==='live'?'Live channels':type==='movie'?'أفلام خيالية':'مسلسلات خيالية',type}));
      for(const item of [
        {id:'xtream:live:1',providerId:'1',type:'live',title:'AOA Demo Channel',categoryId:'demo-live',description:'Fictional live channel for interface demonstration.'},
        {id:'xtream:movie:2',providerId:'2',type:'movie',title:'رحلة إلى النجوم',categoryId:'demo-movie',year:2025,description:'فيلم خيالي عن رحلة عائلية إلى النجوم.',extension:'mp4'},
        {id:'xtream:series:3',providerId:'3',type:'series',title:'حكايات المدينة',categoryId:'demo-series',description:'مسلسل خيالي عن الصداقة والمغامرات.'}
      ] as ContentItem[]) this.items.set(item.id,item);
    } else {
      const results=await Promise.all(types.map(async type=>{
        const action=type==='movie'?'vod':type;const [items,categories]=await Promise.all([this.provider(`get_${action}${type==='series'?'':'_streams'}`),this.provider(`get_${action}_categories`)]);
        if(!Array.isArray(items)||!Array.isArray(categories))throw new HttpError(502,'Invalid provider catalog');
        return {items:items.map((row:any)=>this.map(row,type)),categories:categories.map((row:any)=>({id:`${type}:${row.category_id}`,title:String(row.category_name),type}))};
      }));
      const map=new Map<string,ContentItem>();for(const result of results)for(const item of result.items)map.set(item.id,item);
      this.items=map;this.hydrated.clear();this.categories=results.flatMap(result=>result.categories);
      if(this.store?.client){const saved=await this.store.client.from('aoa_catalog').upsert({id:'top',payload:{items:[...map.values()],categories:this.categories},updated_at:new Date().toISOString()});if(saved.error)throw new HttpError(503,'Catalog cache unavailable');}
    }
    this.expires=Date.now()+this.ttl;
  }
  private map(row:any,type:MediaType):ContentItem {
    const providerId=String(type==='series'?row.series_id:row.stream_id??row.id);
    const year=Number(String(row.releaseDate||row.release_date||row.year||'').slice(0,4));
    return {id:`xtream:${type}:${providerId}`,providerId,type,title:String(row.name||row.title||'Untitled'),categoryId:row.category_id?`${type}:${row.category_id}`:undefined,poster:row.stream_icon||row.cover||row.movie_image||undefined,description:row.plot||row.description||undefined,year:year||undefined,extension:row.container_extension||undefined,imdbId:row.imdb_id||row.imdb||undefined,tmdbId:row.tmdb_id?String(row.tmdb_id):undefined};
  }
  async list(query:{type?:string;q?:string;categoryId?:string;page?:string;pageSize?:string}):Promise<CatalogPage> {
    await this.ensure();if(query.type&&!types.includes(query.type as any))throw new HttpError(400,'Invalid catalog type');
    const page=Number(query.page||1),pageSize=Number(query.pageSize||30);if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new HttpError(400,'Invalid pagination');
    const q=normalizeSearch(query.q||'');const found=[...this.items.values()].filter(item=>item.type!=='episode'&&(!query.type||item.type===query.type)&&(!query.categoryId||item.categoryId===query.categoryId)&&(!q||normalizeSearch(item.title).includes(q)));
    return {items:found.slice((page-1)*pageSize,page*pageSize),total:found.length,page,pageSize};
  }
  async categoryList(type?:string) {await this.ensure();if(type&&!types.includes(type as any))throw new HttpError(400,'Invalid category type');return this.categories.filter(c=>!type||c.type===type);}
  async stored(id:string):Promise<ContentItem|undefined> {
    if(this.config.demo)return this.get(id,false);
    const local=this.items.get(id);if(local)return local;
    if(!this.store?.client)return undefined;
    if(id.startsWith('xtream:episode:')){const result=await this.store.client.from('aoa_content').select('payload').eq('id',id).maybeSingle();if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');if(result.data){const item=result.data.payload as ContentItem;this.items.set(id,item);return item;}return undefined;}
    const result=await this.store.client.from('aoa_catalog').select('payload').eq('id','top').maybeSingle();if(result.error)throw new HttpError(503,'Catalog cache unavailable');
    for(const item of (result.data?.payload.items||[]) as ContentItem[])if(!this.items.has(item.id))this.items.set(item.id,item);
    return this.items.get(id);
  }
  async storedEpisodes(seriesId:string):Promise<ContentItem[]> {
    if(this.config.demo)return this.seriesEpisodes(seriesId);
    const cached=this.episodes.get(seriesId);if(cached)return cached.items;
    if(!this.store?.client)return [];
    const result=await this.store.client.from('aoa_content').select('payload').eq('payload->>seriesId',seriesId).limit(1000);
    if(result.error)throw new HttpError(503,'Episode metadata unavailable');
    return (result.data||[]).map(row=>row.payload as ContentItem).sort((a,b)=>(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0));
  }
  async get(id:string,hydrate=true):Promise<ContentItem> {
    await this.ensure();let item=this.items.get(id);
    // Episode IDs don't contain the parent series. Persist discovered metadata so restarts
    // never require scanning every series on the provider.
    if(!item&&id.startsWith('xtream:episode:')&&this.store?.client){const result=await this.store.client.from('aoa_content').select('payload').eq('id',id).maybeSingle();if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');if(result.data){item=result.data.payload as ContentItem;this.items.set(id,item);}}
    if(!item&&id.startsWith('xtream:episode:')&&this.config.demo){await this.seriesEpisodes('xtream:series:3');item=this.items.get(id);}
    if(!item)throw new HttpError(404,'Content not found');
    if(hydrate && !this.config.demo && item.type==='movie' && !this.hydrated.has(id)) {
      const detail=await this.provider('get_vod_info',{vod_id:item.providerId}); const info=detail.info||{};
      item={...item,description:info.plot||item.description,poster:info.movie_image||item.poster,imdbId:info.imdb_id||item.imdbId,tmdbId:info.tmdb_id?String(info.tmdb_id):item.tmdbId,year:Number(String(info.releasedate||'').slice(0,4))||item.year};this.items.set(id,item);this.hydrated.add(id);
    }
    return item;
  }
  async seriesEpisodes(id:string):Promise<ContentItem[]> {
    await this.ensure();const series=this.items.get(id);if(!series||series.type!=='series')throw new HttpError(404,'Series not found');
    const cached=this.episodes.get(id);if(cached&&cached.expires>Date.now()){for(const item of cached.items)this.items.set(item.id,item);return cached.items;}
    let items:ContentItem[];
    if(this.config.demo)items=[1,2,3].map(n=>({id:`xtream:episode:${30+n}`,providerId:String(30+n),type:'episode',title:`حكايات المدينة - الحلقة ${n}`,seriesId:id,season:1,episode:n,extension:'mp4',description:'حلقة خيالية للعرض التجريبي.'}));
    else {
      const detail=await this.provider('get_series_info',{series_id:series.providerId});
      items=Object.values(detail.episodes||{}).flat().map((row:any)=>({...this.map({...row,stream_id:row.id,...row.info,name:row.title},'episode'),seriesId:id,season:Number(row.season),episode:Number(row.episode_num)}));
    }
    items.sort((a,b)=>(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0));
    if(this.store?.client&&items.length){for(let index=0;index<items.length;index+=200){const result=await this.store.client.from('aoa_content').upsert(items.slice(index,index+200).map(item=>({id:item.id,payload:item,updated_at:new Date().toISOString()})));if(result.error)throw new HttpError(503,'Catalog metadata storage unavailable');}}
    for(const item of items)this.items.set(item.id,item);this.episodes.set(id,{expires:Date.now()+this.ttl,items});return items;
  }
  stream(item:ContentItem) {
    if(item.type==='series')throw new HttpError(400,'Choose an episode');
    if(this.config.demo)return 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const kind=item.type==='live'?'live':item.type==='movie'?'movie':'series';const ext=item.type==='live'?'m3u8':item.extension||'mp4';
    return `${this.config.xtreamUrl}/${kind}/${encodeURIComponent(this.config.xtreamUser)}/${encodeURIComponent(this.config.xtreamPassword)}/${encodeURIComponent(item.providerId)}.${encodeURIComponent(ext)}`;
  }
}
