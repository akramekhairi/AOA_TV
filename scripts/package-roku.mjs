import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Minimal deterministic ZIP writer: package only Roku runtime files, never local settings.
const root = resolve('apps/roku');
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(brs|xml|png|jpg|jpeg|ttf|json)$/.test(entry.name) && !entry.name.endsWith('.json')) files.push(path);
  }
}
files.push(resolve(root, 'manifest'));
for (const folder of ['source', 'components', 'images', 'fonts']) {
  try { await walk(resolve(root, folder)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const local = [], central = []; let offset = 0;
for (const path of files.sort()) {
  const name = Buffer.from(relative(root, path).split(sep).join('/'));
  const source = await readFile(path), compressed = deflateRawSync(source), crc = crc32(source);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(source.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(source.length, 24);
  directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  central.push(directory, name); offset += header.length + name.length + compressed.length;
}
const directories = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directories.length, 12); end.writeUInt32LE(offset, 16);
await mkdir('dist', { recursive: true });
await writeFile('dist/AOA_TV.zip', Buffer.concat([...local, directories, end]));
console.log(`Built dist/AOA_TV.zip (${files.length} runtime files; no configuration or credentials)`);
