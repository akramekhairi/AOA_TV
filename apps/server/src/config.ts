import { resolve } from 'node:path';
export interface Config {
  demo: boolean; port: number; host: string; publicUrl: string; adminKey: string; signingKey: string;
  supabaseUrl: string; supabaseKey: string; bucket: string; xtreamUrl: string; xtreamUser: string; xtreamPassword: string;
  subtitlesKey: string; subtitlesUser: string; subtitlesPassword: string; fontPath: string; corsOrigin: string[];
  trustProxy: false | string[];
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const demo = env.DEMO_MODE === 'true';
  const value = (key: string) => env[key] || '';
  const required = demo ? ['ADMIN_KEY','ASSET_SIGNING_KEY'] : ['ADMIN_KEY','ASSET_SIGNING_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','XTREAM_URL','XTREAM_USERNAME','XTREAM_PASSWORD'];
  for (const key of required) if (!value(key)) throw new Error(`Missing ${key}; use DEMO_MODE=true explicitly for fictional fixtures`);
  if (value('ADMIN_KEY').length < 24 || value('ASSET_SIGNING_KEY').length < 32) throw new Error('ADMIN_KEY must be at least 24 characters and ASSET_SIGNING_KEY at least 32');
  const port = Number(env.PORT || 3001);
  return { demo, trustProxy:env.TRUST_PROXY?env.TRUST_PROXY.split(',').map(s=>s.trim()).filter(Boolean):false, port, host: env.HOST || '0.0.0.0', publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/,''), adminKey:value('ADMIN_KEY'), signingKey:value('ASSET_SIGNING_KEY'), supabaseUrl:value('SUPABASE_URL'), supabaseKey:value('SUPABASE_SERVICE_ROLE_KEY'), bucket:env.ASSET_BUCKET || 'aoa-private-assets', xtreamUrl:value('XTREAM_URL').replace(/\/$/,''), xtreamUser:value('XTREAM_USERNAME'), xtreamPassword:value('XTREAM_PASSWORD'), subtitlesKey:value('OPENSUBTITLES_API_KEY'), subtitlesUser:value('OPENSUBTITLES_USERNAME'), subtitlesPassword:value('OPENSUBTITLES_PASSWORD'), fontPath: env.FONT_PATH || resolve(process.cwd(), process.cwd().endsWith('server') ? '../../assets/fonts/NotoSansArabic-Regular.ttf' : 'assets/fonts/NotoSansArabic-Regular.ttf'), corsOrigin:(env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(x=>x.trim()) };
}
