import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Device, PlaybackCommand, Progress, TvStatus } from '@aoa/shared';
import type { Config } from './config.js';
export interface State {
  devices: Record<string, Device & {tokenHash:string; revoked?:boolean}>;
  pairings: Record<string, {expiresAt:string; rokuId:string}>;
  commands: Record<string, PlaybackCommand>;
  favorites: string[]; progress: Record<string,Progress>; subtitles: Record<string,{id:string|null;offset:number}>;
  hiddenProgress?: Record<string,string>;
  pairingDisplay?: {id:string;code:string;rokuId:string;connectionId:string;expiresAt:string;deliverBy:string;shown:boolean;dismissed:boolean};
  lastPairingRequestAt?: string;
  tv: TvStatus; activeSession?: string; activeContentId?:string;
}
const initial = (): State => ({devices:{},pairings:{},commands:{},favorites:[],progress:{},subtitles:{},tv:{online:false,state:'idle'}});
export class Store {
  client?:SupabaseClient; private memory=initial(); private queue=Promise.resolve();private version:number|undefined;private checkedAt=0;private reading?:Promise<void>;
  constructor(config:Config) { if (!config.demo) this.client=createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)})}}); }
  async init() { if(this.client) await this.read(); }
  private async refresh(force=false):Promise<void> {
    if(!this.client)return;
    if(!force&&this.version!==undefined&&this.checkedAt>Date.now()-5000)return;
    if(this.reading)return this.reading;
    this.reading=(async()=>{
      // Poll only the tiny revision field; never re-download the whole household
      // on each auth/status/empty command poll. CAS writes update this local cache.
      if(!force&&this.version!==undefined){const check=await this.client!.from('aoa_state').select('version').eq('id','home').single();if(check.error||!check.data)throw new Error('Persistence unavailable');if(check.data.version===this.version){this.checkedAt=Date.now();return;}}
      const {data,error}=await this.client!.from('aoa_state').select('payload,version').eq('id','home').single();
      if(error||!data)throw new Error('Persistence unavailable');
      // A local write may have committed while the network read was in flight.
      if(this.version===undefined||data.version>=this.version){this.memory=data.payload as State;this.version=data.version;}this.checkedAt=Date.now();
    })();try{await this.reading;}finally{this.reading=undefined;}
  }
  async read():Promise<State> {
    await this.refresh();return structuredClone(this.memory);
  }
  async change<T>(fn:(state:State)=>T):Promise<T> {
    const prev=this.queue;let release!:()=>void;this.queue=new Promise<void>(r=>{release=r;});await prev;
    try {
      if(!this.client){const state=structuredClone(this.memory);const result=fn(state);this.memory=state;return result;}
      await this.refresh();
      for(let attempt=0;attempt<12;attempt++) {
        const version=this.version!;const state=structuredClone(this.memory);const result=fn(state);
        const updated=await this.client.from('aoa_state').update({payload:state,version:version+1}).eq('id','home').eq('version',version).select('version');
        if(updated.error)throw new Error('Persistence unavailable');
        if(updated.data?.length){this.memory=state;this.version=version+1;this.checkedAt=Date.now();return result;}
        await this.refresh(true);
      }
      throw new Error('State busy; retry request');
    }finally{release();}
  }
}
