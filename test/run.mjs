/** Собирает тесты esbuild-ом и запускает встроенным в Node тест-раннером. */
import { build } from 'esbuild';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Каталог намеренно не node_modules: встроенный в Node тест-раннер его игнорирует.
const dir = '.test-build';

mkdirSync(dir, { recursive: true });

await build({
  entryPoints: readdirSync('test').filter(name => name.endsWith('.test.ts')).map(name => `test/${name}`),
  bundle: true,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: dir,
  // С outdir esbuild по умолчанию пишет .js — нам нужен .mjs, иначе список
  // собранных файлов окажется пустым и node --test пойдёт искать тесты сам.
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});

// Файлы перечисляем явно: раскрытие шаблонов у node --test зависит от версии.
const built = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `${dir}/${name}`);

const res = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' });
rmSync(dir, { force: true, recursive: true });
process.exit(res.status ?? 1);
