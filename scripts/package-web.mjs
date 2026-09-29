import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
execFileSync(process.execPath, ['scripts/verify-release.mjs'], { stdio: 'inherit' });
mkdirSync('release', { recursive: true });
const archive = resolve('release/zerkalo-web.zip');
rmSync(archive, { force: true });
try { execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: 'dist', stdio: 'inherit' }); }
catch { throw Error('Для архива нужна утилита zip. Сам каталог dist уже пригоден для размещения.'); }
const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync('release/zerkalo-web.sha256', `${sha}  zerkalo-web.zip\n`);
console.log(`Prepared ${archive}`);
