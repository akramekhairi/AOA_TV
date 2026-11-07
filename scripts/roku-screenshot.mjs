import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');
const host=process.env.ROKU_HOST,password=process.env.ROKU_DEV_PASSWORD;
if(!host||!password||!/^\d+\.\d+\.\d+\.\d+$/.test(host))throw new Error('Configure Roku private environment fields.');
const escape=value=>value.replaceAll('\\','\\\\').replaceAll('"','\\"');
if(/[\r\n\0]/.test(password))throw new Error('Invalid password format');
async function request(path,args=[]){return new Promise((resolve,reject)=>{
  const p=spawn(process.platform==='win32'?'curl.exe':'curl',['--config','-','--digest','--silent','--fail','--max-time','20',...args,`http://${host}${path}`],{stdio:['pipe','pipe','pipe']});
  p.stdin.end(`user = "${escape('rokudev:'+password)}"\n`);const chunks=[];p.stdout.on('data',b=>chunks.push(b));p.stderr.resume();p.on('error',()=>reject(new Error('curl unavailable')));p.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(`Roku developer request failed (${code})`)));
});}
const html=(await request('/plugin_inspect',['--form','mysubmit=Screenshot'])).toString('utf8');
if(!/dev\.(png|jpg)/i.test(html))throw new Error('Installer did not provide a screenshot. Keep AOA TV in the foreground.');
const match=html.match(/(?:src|href)=["']([^"']*(?:dev\.(?:png|jpg))[^"']*)["']/i);
const path=match?.[1]?.split('?')[0]||'/pkgs/dev.jpg';
if(!/^\/?(?:pkgs\/)?dev\.(png|jpg)$/.test(path))throw new Error('Unexpected screenshot path');
const bytes=await request(path.startsWith('/')?path:'/'+path);
await mkdir('.local',{recursive:true});const target='.local/roku-screen.'+(path.endsWith('png')?'png':'jpg');await writeFile(target,bytes);
console.log(`Saved ${target}`);
