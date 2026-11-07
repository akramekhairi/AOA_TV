import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const keys = ['ADMIN_KEY','ASSET_SIGNING_KEY','SUPABASE_SERVICE_ROLE_KEY','XTREAM_PASSWORD','ROKU_DEV_PASSWORD','OPENSUBTITLES_API_KEY','OPENSUBTITLES_PASSWORD','RENDER_API_KEY','SUPABASE_ACCESS_TOKEN'];
const secrets = keys.map(k=>process.env[k]).filter(v=>v && v.length>=4);
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('No tracked files to check; stage the project first.');
const failures = [];
for(const file of files) {
  if(/(^|\/)(\.local|node_modules|dist)\//.test(file)||/(^|\/)\.env(?!\.example$)(\.|$)/.test(file)) failures.push(file+' (private/generated file)');
  const source=execFileSync('git',['show',':'+file],{maxBuffer:10*1024*1024});
  if(secrets.some(s=>source.includes(Buffer.from(s)))) failures.push(file+' (contains a configured secret)');
  if(/^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----$/m.test(source.toString('utf8'))) failures.push(file+' (private key)');
}
if(failures.length){console.error([...new Set(failures)].join('\n'));process.exitCode=1;}
else console.log(`Checked ${files.length} tracked files: no private configuration or configured secrets found.`);
