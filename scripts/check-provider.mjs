process.loadEnvFile('.env');
const origin=process.env.XTREAM_URL?.replace(/\/$/,'');
if(!origin||!process.env.XTREAM_USERNAME||!process.env.XTREAM_PASSWORD)throw new Error('Fill the three XTREAM fields in private .env.');
async function request(action){
  const url=new URL(origin+'/player_api.php');
  url.searchParams.set('username',process.env.XTREAM_USERNAME);url.searchParams.set('password',process.env.XTREAM_PASSWORD);
  if(action)url.searchParams.set('action',action);
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(30000)});}catch{throw new Error('Provider connection failed; verify the private URL and connection.');}
  if(!response.ok)throw new Error(`Provider returned HTTP ${response.status}`);
  try{return await response.json();}catch{throw new Error('Provider returned non-JSON content.');}
}
try{
  const account=await request();
  if(String(account.user_info?.auth)!=='1')throw new Error('Provider rejected the configured credentials.');
  console.log('Provider authentication accepted.');
  for(const [label,action] of [['Live','get_live_streams'],['Movies','get_vod_streams'],['Series','get_series']]){
    const rows=await request(action);if(!Array.isArray(rows))throw new Error(`Invalid ${label} catalog`);
    console.log(`${label}: ${rows.length} entries; ${rows.filter(r=>/[\u0600-\u06ff]/.test(r.name||'')).length} contain Arabic titles.`);
  }
  console.log('Provider API checked from this computer. Render connectivity and actual Roku playback remain separate checks.');
}catch(error){console.error(error.message);process.exitCode=1;}
