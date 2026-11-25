import type {ContentItem, Progress} from '@aoa/shared';
import type {State} from './store.js';

export const favoriteId=(item:ContentItem)=>item.type==='episode'?item.seriesId: item.id;

export async function continueWatching(state:State, resolve:(id:string)=>Promise<ContentItem|undefined>):Promise<Progress[]> {
  const items:Progress[]=[];const seen=new Set<string>();
  const ordered=Object.values(state.progress).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.contentId.localeCompare(b.contentId));
  for(const progress of ordered){
    let item=progress.item;
    try{item??=await resolve(progress.contentId);}catch{continue;}
    if(!item||item.type==='live')continue;
    const key=item.type==='episode'?(item.seriesId||item.id):item.id;
    if(seen.has(key))continue;
    // Select the latest episode before applying visibility; never revive an older one.
    seen.add(key);
    if(state.hiddenProgress?.[item.id])continue;
    const hiddenAt=state.hiddenProgress?.[key];
    if(hiddenAt&&hiddenAt>=progress.updatedAt)continue;
    if(item.type==='episode'||!progress.completed&&progress.position>0)items.push({...progress,item});
    if(items.length===100)break;
  }
  return items;
}
