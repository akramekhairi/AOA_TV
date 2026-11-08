import {readFile,writeFile,mkdir} from 'node:fs/promises';
process.loadEnvFile('.env');
const env=process.env, mode=process.argv[2]||'inspect';
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
if(!/^[a-z0-9]+$/.test(ref))throw new Error('Invalid Supabase project URL');
async function api(base,token,path,method='GET',body){
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw new Error(`${base.includes('render')?'Render':'Supabase'} ${path.split('?')[0]} returned HTTP ${r.status}`);
  return r.status===204?null:r.json();
}
const render=(p,m,b)=>api('https://api.render.com/v1',env.RENDER_API_KEY,p,m,b);
const supa=(p,m,b)=>api('https://api.supabase.com',env.SUPABASE_ACCESS_TOKEN,p,m,b);
await mkdir('.local',{recursive:true});
try{
if(mode==='inspect'){
 const [owners,project]=await Promise.all([render('/owners?limit=100'),supa('/v1/projects/'+ref)]);
 console.log(JSON.stringify({workspaces:owners.map(r=>({id:(r.owner||r).id,name:(r.owner||r).name})),project:{name:project.name,status:project.status,region:project.region}}));
}else if(mode==='migrate'){
 await supa('/v1/projects/'+ref+'/database/query','POST',{query:await readFile('supabase/migrations/202611070001_initial.sql','utf8')});
 console.log('Applied AOA_TV tables, access policies, and private asset bucket.');
}else if(mode==='deploy'){
 const owners=(await render('/owners?limit=100')).map(r=>r.owner||r);
 if(owners.length!==1)throw new Error('Select a Render workspace before deployment.');
 const existing=(await render('/services?name=aoa-tv-api&limit=100')).map(r=>r.service||r).filter(s=>s.name==='aoa-tv-api');
 if(existing.length){const service=existing[0];if(service.repo!=='https://github.com/akramekhairi/AOA_TV')throw new Error('Existing service does not match AOA_TV repository.');await writeFile('.local/render-service.json',JSON.stringify(service));console.log(JSON.stringify({id:service.id,url:service.serviceDetails?.url,existing:true}));}
 else {
 const names=['ADMIN_KEY','ASSET_SIGNING_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','XTREAM_URL','XTREAM_USERNAME','XTREAM_PASSWORD','POSTER_ALLOWED_HOSTS','OPENSUBTITLES_API_KEY','OPENSUBTITLES_USERNAME','OPENSUBTITLES_PASSWORD'];
 const envVars=names.filter(k=>env[k]).map(key=>({key,value:env[key]}));envVars.push({key:'DEMO_MODE',value:'false'},{key:'HOST',value:'0.0.0.0'},{key:'CORS_ORIGINS',value:'https://akramekhairi.github.io'});
 const result=await render('/services','POST',{type:'web_service',name:'aoa-tv-api',ownerId:owners[0].id,repo:'https://github.com/akramekhairi/AOA_TV',branch:'main',autoDeployTrigger:'off',envVars,serviceDetails:{runtime:'docker',plan:'free',region:'virginia',numInstances:1,healthCheckPath:'/health',envSpecificDetails:{dockerfilePath:'./apps/server/Dockerfile',dockerContext:'.',dockerCommand:''}}});
 const service=result.service||result;await writeFile('.local/render-service.json',JSON.stringify(service));console.log(JSON.stringify({id:service.id,url:service.serviceDetails?.url,plan:service.serviceDetails?.plan}));
 }
}else if(mode==='sync-assets'){
 const stored=JSON.parse(await readFile('.local/render-service.json','utf8'));
 const hosts=(await readFile('.local/poster-hostnames.txt','utf8')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(!hosts.length||hosts.some(host=>!/^[a-z0-9.-]+$/i.test(host)))throw new Error('Invalid private poster hostname inventory');
 await render('/services/'+stored.id+'/env-vars/POSTER_ALLOWED_HOSTS','PUT',{value:[...new Set(hosts)].join(',')});
 for(const key of ['OPENSUBTITLES_API_KEY','OPENSUBTITLES_USERNAME','OPENSUBTITLES_PASSWORD'])if(env[key])await render('/services/'+stored.id+'/env-vars/'+key,'PUT',{value:env[key]});
 console.log('Updated approved poster hosts and any configured subtitle credentials.');
}else if(mode==='redeploy'){
 const stored=JSON.parse(await readFile('.local/render-service.json','utf8'));
 const result=await render('/services/'+stored.id+'/deploys','POST',{clearCache:'do_not_clear'});
 console.log(JSON.stringify({id:result.id,status:result.status}));
}else if(mode==='status'){
 const stored=JSON.parse(await readFile('.local/render-service.json','utf8'));const service=await render('/services/'+stored.id);const deploys=await render('/services/'+stored.id+'/deploys?limit=1');console.log(JSON.stringify({id:service.id,url:service.serviceDetails?.url,plan:service.serviceDetails?.plan,deploys:deploys.map(r=>({id:r.deploy?.id,status:r.deploy?.status}))}));
}else throw new Error('Use inspect, migrate, deploy, or status');
}catch(error){console.error(error.message);process.exitCode=1;}
