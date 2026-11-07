import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Private credentials are loaded from .env, never shell arguments or logs.
process.loadEnvFile?.(resolve('.env'));
const origin = process.env.PUBLIC_URL;
const key = process.env.ADMIN_KEY;
if (!origin || !key) throw new Error('Set PUBLIC_URL and ADMIN_KEY in private .env first.');
const response = await fetch(`${origin.replace(/\/$/, '')}/api/v1/admin/enroll`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
  body: JSON.stringify({ name: 'Apartment Roku' }), signal: AbortSignal.timeout(120000)
});
if (!response.ok) throw new Error(`Enrollment failed (HTTP ${response.status}). Check backend settings.`);
const result = await response.json();
await mkdir('.local', { recursive: true });
await writeFile('.local/roku-enrollment.json', JSON.stringify({ backendUrl: origin, ...result }, null, 2));
console.log('Saved private Roku setup details to .local/roku-enrollment.json. Do not share or commit this file.');
