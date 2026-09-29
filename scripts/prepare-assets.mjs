/** Prepare reproducible local runtime assets. No camera data leaves the device. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? resolve(process.argv[2]) : join(root, 'public');
const models = JSON.parse(await readFile(join(root, 'scripts/models.json'), 'utf8'));
const packageRoot = join(root, 'node_modules/@mediapipe/tasks-vision');
const runtime = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (runtime.version !== '0.10.35') throw new Error('Expected MediaPipe 0.10.35; review runtime and models before upgrading.');

async function hash(path) {
  const digest = createHash('sha256');
  try {
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest('hex');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

await mkdir(join(output, 'models'), { recursive: true });
await mkdir(join(output, 'wasm'), { recursive: true });
for (const name of ['vision_wasm_internal', 'vision_wasm_module_internal', 'vision_wasm_nosimd_internal']) {
  for (const extension of ['js', 'wasm']) {
    const file = `${name}.${extension}`;
    await copyFile(join(packageRoot, 'wasm', file), join(output, 'wasm', file));
  }
}
console.log('MediaPipe runtime copied from pinned npm dependency.');

for (const model of models) {
  const target = join(output, 'models', model.file);
  if (await hash(target) === model.sha256) {
    console.log(`${model.name}: verified local model`);
    continue;
  }
  const temporary = `${target}.download`;
  try {
    console.log(`${model.name}: downloading official model (${model.bytes} bytes)…`);
    let data;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(model.url, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
        data = Buffer.from(await response.arrayBuffer());
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.log(`${model.name}: network interrupted; retry ${attempt}/2…`);
        await new Promise((done) => setTimeout(done, 1000 * attempt));
      }
    }
    if (data.length !== model.bytes || createHash('sha256').update(data).digest('hex') !== model.sha256) {
      throw new Error('Model checksum mismatch; no unverified model was installed.');
    }
    await writeFile(temporary, data);
    await rename(temporary, target);
    console.log(`${model.name}: downloaded and verified`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`${model.name}: ${error.message}. Retry with npm run prepare:assets.`, { cause: error });
  }
}
console.log('Local models and WASM are ready for web and Android builds.');
