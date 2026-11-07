import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');
const base = process.env.PUBLIC_URL || 'http://127.0.0.1:3001';
const health = await (await fetch(base + '/health')).json();
assert.equal(health.demo, true, 'Smoke test refuses production services');
async function api(path, token = '', method = 'GET', body, admin = false) {
  const response = await fetch(base + '/api/v1' + path, {method, headers: {
    ...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {}),
    ...(admin ? {'X-Admin-Key': process.env.ADMIN_KEY} : {})
  }, ...(body ? {body: JSON.stringify(body)} : {})});
  assert.equal(response.ok, true, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
const roku = await api('/admin/enroll', '', 'POST', {name:'Smoke Roku'}, true);
const pairing = await api('/pairing/code', roku.token, 'POST', {});
const phone = await api('/pairing/claim', '', 'POST', {code:pairing.code, name:'Smoke phone'});
const catalog = await api('/catalog?type=movie', phone.token);
assert.ok(catalog.items.length);
const movie = catalog.items[0];
await api('/favorites/' + encodeURIComponent(movie.id), phone.token, 'PUT', {});
assert.ok((await api('/favorites', phone.token)).items.some(x=>x.id===movie.id));
const command = await api('/commands', phone.token, 'POST', {action:'play',contentId:movie.id});
assert.ok((await api('/roku/commands', roku.token)).commands.some(x=>x.id===command.id));
const playback = await api('/roku/playback/' + command.id, roku.token);
assert.ok(playback.url);
await api('/roku/status', roku.token, 'POST', {state:'playing',contentId:movie.id,position:60,duration:600,sessionId:command.sessionId});
await api('/roku/progress', roku.token, 'PUT', {contentId:movie.id,position:60,duration:600,completed:false,sessionId:command.sessionId});
await api('/roku/commands/' + command.id + '/ack', roku.token, 'POST', {status:'acknowledged'});
assert.equal((await api('/commands/' + command.id, phone.token)).status,'acknowledged');
assert.ok((await api('/progress', phone.token)).items.some(x=>x.contentId===movie.id));
const image = await fetch(movie.titleImage); assert.equal(image.ok,true);
await mkdir('.local', {recursive:true}); await writeFile('.local/arabic-preview.png', Buffer.from(await image.arrayBuffer()));
await api('/devices/' + phone.device.id, roku.token, 'DELETE');
const revoked = await fetch(base+'/api/v1/favorites',{headers:{Authorization:`Bearer ${phone.token}`}});
assert.equal(revoked.status,401);
console.log('Demo smoke passed: pairing, catalog, favorites, commands, playback contract, progress, Arabic PNG, revocation.');
console.log('Actual video playback and browser UI were not exercised.');
