/** Audit the exact static publish directory; never publish the working tree. */
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const digest = data => createHash('sha256').update(data).digest('hex');
const models = JSON.parse(await readFile(join(root, 'scripts/models.json'), 'utf8'));
const files = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isSymbolicLink()) throw Error(`Symlink in publish output: ${full}`);
    if (item.isDirectory()) await walk(full); else files.push(full);
  }
}
await walk(dist);
for (const file of files) {
  const path = file.slice(dist.length + 1);
  if (/(^|\/)(\.git|\.env[^/]*|node_modules|test|src|\.backups)(\/|$)|\.(map|ts|pem|key|jks|keystore)$/.test(path)) throw Error(`Unexpected publish file: ${path}`);
  if (/\.(html|css|js|json|md)$/.test(path)) {
    const text = await readFile(file, 'utf8');
    if (/gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) throw Error(`Potential secret: ${path}`);
  }
}
for (const model of models) {
  const data = await readFile(join(dist, 'app/models', model.file));
  if (data.length !== model.bytes || digest(data) !== model.sha256) throw Error(`Invalid model: ${model.file}`);
}
const wasm = (await readdir(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'))).filter(f => /\.(js|wasm)$/.test(f));
for (const file of wasm) {
  const expected = await readFile(join(root, 'node_modules/@mediapipe/tasks-vision/wasm', file));
  const actual = await readFile(join(dist, 'app/wasm', file));
  if (digest(actual) !== digest(expected)) throw Error(`Runtime mismatch: ${file}`);
}
const clips = (await readdir(join(root, 'public/exercises'))).filter(f => f.endsWith('.mp4'));
if (clips.length !== 11) throw Error('Expected 11 exercise clips');
for (const clip of clips) {
  const data = await readFile(join(dist, 'app/exercises', clip));
  if (!data.subarray(0, 32).includes(Buffer.from('ftyp'))) throw Error(`Invalid MP4: ${clip}`);
  await access(join(dist, 'app/exercises', clip.replace('.mp4', '.svg')));
}
for (const page of ['index.html', 'app/index.html']) {
  const path = join(dist, page), html = await readFile(path, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(https?:|data:|mailto:)/.test(ref)) continue;
    let local = resolve(dirname(path), ref.split(/[?#]/)[0]);
    if (!local.startsWith(dist + '/') && local !== dist) throw Error(`Escaping URL: ${ref}`);
    if ((await stat(local)).isDirectory()) local = join(local, 'index.html');
    await access(local);
  }
}
let bytes = 0; for (const file of files) bytes += (await stat(file)).size;
console.log(`PASS: ${files.length} static files, ${(bytes / 1048576).toFixed(1)} MiB; 3 verified models, ${wasm.length} runtime files, 11 videos + posters; no source maps or local secrets.`);
