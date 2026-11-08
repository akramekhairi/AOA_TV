import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CommandAction, Device, PlaybackCommand, TvStatus } from '@aoa/shared';
import type { Config } from './config.js';
import { Store, type State } from './store.js';
import { Catalog, HttpError } from './catalog.js';
import { Assets } from './assets.js';
import { Subtitles } from './subtitles.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const cleanDevice=(device:Device):Device=>({id:device.id,name:device.name,kind:device.kind,createdAt:device.createdAt});
const timestamp=()=>new Date().toISOString();
function body(req:FastifyRequest):Record<string,any>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new HttpError(400,'JSON object required');return req.body as any;}
function name(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>80)throw new HttpError(400,'Name must contain 1–80 characters');return value.trim();}
function number(value:unknown,label:string,min=0,max=604800){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new HttpError(400,`Invalid ${label}`);return value;}
function contentId(value:unknown){if(typeof value!=='string'||!/^xtream:(live|movie|series|episode):[a-zA-Z0-9_-]+$/.test(value))throw new HttpError(400,'Invalid content ID');return value;}
const commandView=(command:PlaybackCommand):PlaybackCommand=>command.status==='pending'&&Date.parse(command.expiresAt)<=Date.now()?{...command,status:'expired'}:command;
function issue(state:State,input:{action:CommandAction;contentId?:string;position?:number;subtitleId?:string|null;offset?:number}) {
  if(input.action==='play'){for(const prior of Object.values(state.commands))if(prior.status==='pending')prior.status='expired';state.activeSession=randomUUID();state.activeContentId=input.contentId;}
  if(!state.activeSession)throw new HttpError(409,'No playback session');
  const command:PlaybackCommand={id:randomUUID(),...input,sessionId:state.activeSession,expiresAt:new Date(Date.now()+60000).toISOString(),status:'pending'};
  state.commands[command.id]=command;
  // Bound persistent state while retaining recent commands for idempotent acknowledgements.
  const entries=Object.values(state.commands);if(entries.length>300)for(const old of entries.slice(0,entries.length-300))delete state.commands[old.id];
  return command;
}
export async function createApp(config:Config) {
  const app=Fastify({logger:{level:process.env.LOG_LEVEL||'info',redact:['req.headers.authorization','req.headers.x-admin-key','req.body','res.body']},disableRequestLogging:true,bodyLimit:65536,trustProxy:false});
  await app.register(cors,{origin:config.corsOrigin,methods:['GET','POST','PUT','DELETE','OPTIONS'],allowedHeaders:['Authorization','Content-Type','X-Admin-Key']});
  await app.register(rateLimit,{max:240,timeWindow:'1 minute'});
  const store=new Store(config);await store.init();const catalog=new Catalog(config,store);const assets=new Assets(config,store,catalog);await assets.init();const subtitles=new Subtitles(config,assets);
  let rokuPresence: {deviceId:string;at:number} | undefined;
  app.decorateRequest('device',null);
  const auth=async(req:FastifyRequest)=>{const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token||token.length>200)throw new HttpError(401,'Device token required');const state=await store.read();const device=Object.values(state.devices).find(d=>!d.revoked&&safeEqual(d.tokenHash,hash(token)));if(!device)throw new HttpError(401,'Device token invalid or revoked');(req as any).device=cleanDevice(device);};
  const roku=async(req:FastifyRequest)=>{await auth(req);if((req as any).device.kind!=='roku')throw new HttpError(403,'Roku device required');};
  app.setErrorHandler((unknownError,_req,reply)=>{const error=unknownError as {statusCode?:number;message:string};const status=error.statusCode&&error.statusCode>=400&&error.statusCode<600?error.statusCode:500;if(status>=500)app.log.error({code:status},'Request failed');reply.code(status).send({error:status===500?'Service unavailable':error.message});});
  app.get('/health',()=>({ok:true,demo:config.demo}));
  const base='/api/v1';
  app.post(base+'/admin/enroll',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async req=>{
    if(!safeEqual(String(req.headers['x-admin-key']||''),config.adminKey))throw new HttpError(401,'Invalid admin key');const deviceName=name(body(req).name);const token=randomBytes(32).toString('base64url');const device:Device={id:randomUUID(),name:deviceName,kind:'roku',createdAt:timestamp()};
    await store.change(state=>{for(const d of Object.values(state.devices))if(d.kind==='roku')d.revoked=true;state.pairings={};state.devices[device.id]={...device,tokenHash:hash(token)};});return {token,device};
  });
  app.post(base+'/pairing/code',{preHandler:roku,config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async req=>store.change(state=>{
    for(const [code,pair]of Object.entries(state.pairings))if(Date.parse(pair.expiresAt)<Date.now()||pair.rokuId===(req as any).device.id)delete state.pairings[code];let code:string;do{code=String(randomInt(100000,1000000));}while(state.pairings[code]);const expiresAt=new Date(Date.now()+300000).toISOString();state.pairings[code]={expiresAt,rokuId:(req as any).device.id};return {code,expiresAt};
  }));
  app.post(base+'/pairing/claim',{config:{rateLimit:{max:8,timeWindow:'10 minutes'}}},async req=>{
    const input=body(req);const deviceName=name(input.name);if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw new HttpError(400,'Six digit code required');const token=randomBytes(32).toString('base64url');const device:Device={id:randomUUID(),name:deviceName,kind:'phone',createdAt:timestamp()};
    await store.change(state=>{const pair=state.pairings[input.code];if(!pair||Date.parse(pair.expiresAt)<=Date.now()||state.devices[pair.rokuId]?.revoked)throw new HttpError(400,'Pairing code invalid or expired');if(Object.values(state.devices).filter(d=>!d.revoked&&d.kind==='phone').length>=20)throw new HttpError(409,'Revoke a phone before pairing another');delete state.pairings[input.code];state.devices[device.id]={...device,tokenHash:hash(token)};});return {token,device};
  });
  app.get(base+'/devices',{preHandler:auth},async()=>({devices:Object.values((await store.read()).devices).filter(d=>!d.revoked).map(cleanDevice)}));
  app.delete<{Params:{id:string}}>(base+'/devices/:id',{preHandler:roku},async req=>{await store.change(state=>{const device=state.devices[req.params.id];if(!device||device.revoked)throw new HttpError(404,'Device not found');if(device.kind!=='phone')throw new HttpError(400,'Only phones can be revoked');device.revoked=true;});return {ok:true};});
  app.get<{Querystring:{type?:string;q?:string;categoryId?:string;page?:string;pageSize?:string}}>(base+'/catalog',{preHandler:auth},async req=>{const page=await catalog.list(req.query);return {...page,items:page.items.map(item=>assets.decorate(item))};});
  app.get<{Querystring:{type?:string}}>(base+'/categories',{preHandler:auth},async req=>({categories:(await catalog.categoryList(req.query.type)).map(item=>assets.category(item))}));
  app.get<{Params:{id:string}}>(base+'/content/:id',{preHandler:auth},async req=>assets.decorate(await catalog.get(contentId(req.params.id))));
  app.get<{Params:{id:string}}>(base+'/series/:id/episodes',{preHandler:auth},async req=>({items:(await catalog.seriesEpisodes(contentId(req.params.id))).map(item=>assets.decorate(item))}));
  app.post(base+'/catalog/refresh',{preHandler:auth,config:{rateLimit:{max:2,timeWindow:'1 minute'}}},async()=>{await catalog.refresh();return {ok:true};});
  app.get(base+'/favorites',{preHandler:auth},async()=>{const state=await store.read();const items=await Promise.all(state.favorites.map(async id=>{try{return assets.decorate(await catalog.get(id));}catch(e){if(e instanceof HttpError&&e.statusCode===404)return undefined;throw e;}}));return {items:items.filter(Boolean)};});
  app.put<{Params:{id:string}}>(base+'/favorites/:id',{preHandler:auth},async req=>{const item=await catalog.get(contentId(req.params.id));await store.change(state=>{if(!state.favorites.includes(item.id)){if(state.favorites.length>=1000)throw new HttpError(409,'Favorite limit reached');state.favorites.push(item.id);}});return {ok:true};});
  app.delete<{Params:{id:string}}>(base+'/favorites/:id',{preHandler:auth},async req=>{await store.change(state=>{state.favorites=state.favorites.filter(id=>id!==req.params.id);});return {ok:true};});
  app.get(base+'/progress',{preHandler:auth},async()=>{
    const state=await store.read();const items=[];const nextIds=new Set<string>();
    for(const progress of Object.values(state.progress).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)) {
      let item;try{item=await catalog.get(progress.contentId);}catch(e){if(e instanceof HttpError&&e.statusCode===404)continue;throw e;}
      if(!progress.completed&&progress.position>0)items.push({...progress,item:assets.decorate(item)});
      if(progress.completed&&item.type==='episode'&&item.seriesId){const episodes=await catalog.seriesEpisodes(item.seriesId);const next=episodes[episodes.findIndex(e=>e.id===item.id)+1];if(next&&!state.progress[next.id]?.completed&&!nextIds.has(next.id)){nextIds.add(next.id);const p=state.progress[next.id]||{contentId:next.id,position:0,duration:0,completed:false,updatedAt:progress.updatedAt};if(!p.position)items.push({...p,item:assets.decorate(next)});}}
    }
    return {items};
  });
  app.get(base+'/tv/status',{preHandler:auth},async()=>{
    const state=await store.read();const device=rokuPresence&&state.devices[rokuPresence.deviceId];
    const seen=Math.max(Date.parse(state.tv.updatedAt||'')||0,device&&!device.revoked?rokuPresence!.at:0);
    return {...state.tv,online:seen>Date.now()-30000};
  });
  app.post(base+'/commands',{preHandler:auth},async req=>{
    const input=body(req);const actions:CommandAction[]=['play','pause','resume','stop','seek','subtitles'];if(!actions.includes(input.action))throw new HttpError(400,'Invalid action');
    let id:string|undefined;if(input.action==='play'){id=contentId(input.contentId);const item=await catalog.get(id);if(item.type==='series')throw new HttpError(400,'Choose an episode');}
    if(input.action==='seek'&&input.position===undefined)throw new HttpError(400,'Position required');if(input.position!==undefined)number(input.position,'position');if(input.offset!==undefined)number(input.offset,'offset',-600,600);
    if(input.action==='subtitles') {
      const state=await store.read();const item=await catalog.get(contentId(state.activeContentId));if(!['movie','episode'].includes(item.type))throw new HttpError(400,'Subtitles support movies and episodes');if(input.subtitleId!==null&&typeof input.subtitleId!=='string')throw new HttpError(400,'Subtitle ID or null required');const offset=input.offset??0;if(input.subtitleId!==null){await subtitles.validate(item,input.subtitleId);await subtitles.url(input.subtitleId,offset);}
      return store.change(current=>{if(current.activeSession!==state.activeSession)throw new HttpError(409,'Playback changed; retry subtitle selection');current.subtitles[item.id]={id:input.subtitleId,offset};return issue(current,{action:'subtitles',contentId:item.id,position:current.tv.sessionId===current.activeSession?current.tv.position||0:0,subtitleId:input.subtitleId,offset});});
    }
    return store.change(state=>issue(state,{action:input.action,contentId:id||state.activeContentId,...(input.position!==undefined?{position:input.position}:input.action==='play'?{position:state.progress[id!]?.completed?0:state.progress[id!]?.position||0}:{})}));
  });
  app.get<{Params:{id:string}}>(base+'/commands/:id',{preHandler:auth},async req=>{const command=(await store.read()).commands[req.params.id];if(!command)throw new HttpError(404,'Command not found');return commandView(command);});
  app.get(base+'/roku/commands',{preHandler:roku},async req=>{
    const state=await store.read();
    // Receiving commands proves reachability even if playback status is delayed.
    // Keep high-frequency presence in memory; status heartbeats persist as usual.
    rokuPresence={deviceId:(req as any).device.id,at:Date.now()};
    return {commands:Object.values(state.commands).map(commandView).filter(c=>c.status==='pending')};
  });
  app.post<{Params:{id:string}}>(base+'/roku/commands/:id/ack',{preHandler:roku},async req=>{
    const input=body(req);if(!['acknowledged','failed'].includes(input.status))throw new HttpError(400,'Invalid acknowledgement');await store.change(state=>{const command=state.commands[req.params.id];if(!command)throw new HttpError(404,'Command not found');if(command.status!=='pending')return;if(Date.parse(command.expiresAt)<=Date.now()){command.status='expired';return;}command.status=input.status;if(input.status==='failed')command.error=String(input.error||'Playback failed').slice(0,300);});return {ok:true};
  });
  app.get<{Params:{commandId:string}}>(base+'/roku/playback/:commandId',{preHandler:roku},async req=>{
    const state=await store.read();const command=state.commands[req.params.commandId];if(!command||!['play','subtitles'].includes(command.action))throw new HttpError(404,'Playback command not found');if(commandView(command).status==='expired'||command.status==='failed')throw new HttpError(410,'Command expired or failed');if(command.sessionId!==state.activeSession)throw new HttpError(409,'Playback session superseded');const item=await catalog.get(command.contentId||state.activeContentId!);const selection=state.subtitles[item.id];let subtitleUrl:string|undefined;let warning:string|undefined;
    if(selection?.id){try{subtitleUrl=await subtitles.url(selection.id,selection.offset);}catch{warning='English subtitles are temporarily unavailable. Video can continue without captions.';}}
    return {item:assets.decorate(item),url:catalog.stream(item),streamFormat:item.type==='live'&&!config.demo?'hls':item.extension||'mp4',position:command.position??state.tv.position??0,sessionId:command.sessionId,subtitleUrl,warning};
  });
  app.post(base+'/roku/status',{preHandler:roku},async req=>{
    const input=body(req);if(typeof input.state!=='string'||!['idle','buffering','playing','paused','stopped','finished','error'].includes(input.state))throw new HttpError(400,'Invalid playback state');if(input.position!==undefined)number(input.position,'position');if(input.duration!==undefined)number(input.duration,'duration');
    const conflict=await store.change(state=>{
      // Liveness belongs to the authenticated Roku, independently of playback.
      // A delayed report must not replace a newer session or make the TV offline.
      state.tv.updatedAt=timestamp();state.tv.online=true;
      if(state.activeSession&&!input.sessionId&&input.state==='idle')return;
      if(state.activeSession&&input.sessionId!==state.activeSession)return 'Stale playback session';
      if(input.contentId&&input.contentId!==state.activeContentId)return 'Content does not match session';
      state.tv={online:true,state:input.state,contentId:state.activeContentId,position:input.position,duration:input.duration,sessionId:state.activeSession,updatedAt:timestamp()};
    });
    if(conflict)throw new HttpError(409,conflict);return {ok:true};
  });
  app.put(base+'/roku/progress',{preHandler:roku},async req=>{
    const input=body(req);const id=contentId(input.contentId);const position=number(input.position,'position'),duration=number(input.duration,'duration');if(typeof input.completed!=='boolean')throw new HttpError(400,'Completed boolean required');const item=await catalog.get(id);await store.change(state=>{if(input.sessionId!==state.activeSession||id!==state.activeContentId)throw new HttpError(409,'Stale playback session');if(item.type==='live')return;state.progress[id]={contentId:id,position:duration?Math.min(position,duration):position,duration,completed:input.completed||(duration>0&&position/duration>=0.95),updatedAt:timestamp()};const entries=Object.values(state.progress).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));for(const old of entries.slice(1000))delete state.progress[old.contentId];});return {ok:true};
  });
  app.get<{Querystring:{contentId?:string;query?:string}}>(base+'/subtitles/search',{preHandler:auth,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>subtitles.search(await catalog.get(contentId(req.query.contentId)),req.query.query?.slice(0,200)));
  app.post(base+'/subtitles/select',{preHandler:auth},async req=>{
    const input=body(req);const item=await catalog.get(contentId(input.contentId));if(!['movie','episode'].includes(item.type))throw new HttpError(400,'Subtitles support movies and episodes');if(input.subtitleId!==null&&(typeof input.subtitleId!=='string'||input.subtitleId.length>40))throw new HttpError(400,'Invalid subtitle ID');const offset=input.offset===undefined?0:number(input.offset,'offset',-600,600);if(input.subtitleId!==null){await subtitles.validate(item,input.subtitleId);await subtitles.url(input.subtitleId,offset);}
    await store.change(state=>{state.subtitles[item.id]={id:input.subtitleId,offset};if(state.activeContentId===item.id&&state.activeSession&&state.tv.sessionId===state.activeSession&&['playing','paused','buffering'].includes(state.tv.state))issue(state,{action:'subtitles',contentId:item.id,position:state.tv.position||0,subtitleId:input.subtitleId,offset});});return {ok:true};
  });
  app.get<{Params:{key:string};Querystring:{e:string;s:string}}>(base+'/assets/:key',async(req,reply)=>{const descriptor=assets.verify(req.params.key,req.query.e||'',req.query.s||'');const asset=await assets.get(descriptor);return reply.header('Cache-Control','private, max-age=300').type(asset.mime).send(asset.bytes);});
  return {app,store,catalog,assets};
}
