// Bound retained metadata by both estimated bytes and count. Values are immutable.
export class MetadataCache<T> {
  private entries = new Map<string, {value:T; bytes:number; expires:number}>();
  private bytes = 0;
  constructor(private maxEntries:number, private maxBytes:number, private ttl:number) {}
  get(key:string):T|undefined {
    this.prune();
    const entry=this.entries.get(key);if(!entry)return undefined;
    this.entries.delete(key);this.entries.set(key,entry);return entry.value;
  }
  set(key:string,value:T) {
    this.prune();this.delete(key);
    const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>this.maxBytes)return;
    while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes)this.delete(this.entries.keys().next().value!);
    this.entries.set(key,{value,bytes,expires:Date.now()+this.ttl});this.bytes+=bytes;
  }
  private delete(key:string){const entry=this.entries.get(key);if(entry)this.bytes-=entry.bytes;this.entries.delete(key);}
  private prune(){const now=Date.now();for(const [key,entry] of this.entries)if(entry.expires<=now)this.delete(key);}
  clear(){this.entries.clear();this.bytes=0;}
  stats(){this.prune();return {entries:this.entries.size,bytes:this.bytes};}
}
