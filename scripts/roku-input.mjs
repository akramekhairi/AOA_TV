import {readFile} from 'node:fs/promises';
process.loadEnvFile('.env');
const host=process.env.ROKU_HOST;
if(!host||!/^\d+\.\d+\.\d+\.\d+$/.test(host))throw new Error('Set ROKU_HOST');
const mode=process.argv[2];
async function key(value){const r=await fetch(`http://${host}:8060/keypress/${encodeURIComponent(value)}`,{method:'POST',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Roku input failed (${r.status})`);}
if(mode==='base'||mode==='token'){
 const enrollment=JSON.parse(await readFile('.local/roku-enrollment.json','utf8'));
 const value=mode==='base'?enrollment.backendUrl:enrollment.token;
 for(const char of value)await key('Lit_'+char);
 console.log(`Entered ${mode==='base'?'backend URL':'device token'} into the focused Roku setup field; value not logged.`);
}else if(mode==='key'){
 for(const value of process.argv.slice(3)){if(!/^(Up|Down|Left|Right|Select|Back|Home|Play|Rev|Fwd|InstantReplay|Info|Backspace|Enter)$/.test(value))throw new Error('Unsupported key');await key(value);}
 console.log('Sent requested Roku keys.');
}else throw new Error('Use base, token, or key followed by remote keys.');
