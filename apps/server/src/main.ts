import { config } from './config.js';
import { createApp } from './app.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// npm workspace scripts run from apps/server; keep private environment at repository root.
const envPath=resolve(import.meta.dirname,'../../../.env');
if(existsSync(envPath))process.loadEnvFile(envPath);
const settings=config();
const {app}=await createApp(settings);
await app.listen({port:settings.port,host:settings.host});
for(const event of ['SIGTERM','SIGINT'] as const)process.on(event,()=>{app.close().then(()=>process.exit(0));});
