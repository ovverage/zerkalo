/**
 * Собирает лендинг в корень dist рядом с приложением (dist/app).
 *
 * Лендинг — статическая страница: ни зависимостей, ни логики, гонять её через
 * бандлер незачем. Скрипт делает три вещи, которые копированием не решаются:
 * кладёт рядом шрифт, подставляет ссылку на опубликованный APK; по явному флагу
 * вместо неё прикладывает локальный APK.
 */

import { access, copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const DIST = 'dist';
const FONT_SRC = 'node_modules/@fontsource/inter/files';
const FONT_WEIGHTS = ['400', '600', '800'];
const FONT_SUBSETS = ['latin', 'cyrillic'];

/** Куда gradle кладёт отладочную сборку. */
const APK_SOURCE = 'android/app/build/outputs/apk/debug/app-debug.apk';
const APK_TARGET = `${DIST}/zerkalo.apk`;

const exists = async (path) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

await mkdir(DIST, { recursive: true });

for (const name of await readdir('landing')) {
  await cp(`landing/${name}`, `${DIST}/${name}`, { recursive: true });
}

// Шрифт берём из того же пакета, что и приложение, чтобы начертания совпадали.
await mkdir(`${DIST}/fonts`, { recursive: true });
for (const subset of FONT_SUBSETS) {
  for (const weight of FONT_WEIGHTS) {
    const file = `inter-${subset}-${weight}-normal.woff2`;
    if (await exists(`${FONT_SRC}/${file}`)) {
      await copyFile(`${FONT_SRC}/${file}`, `${DIST}/fonts/inter-${subset}-${weight}.woff2`);
    }
  }
}

// Кнопка скачивания появляется, только если APK действительно собран: битая
// ссылка на лендинге хуже, чем честная строка о том, где взять сборку.
const hasApk = process.argv.includes('--with-apk') && await exists(APK_SOURCE);
if (hasApk) await copyFile(APK_SOURCE, APK_TARGET);
const release = JSON.parse(await readFile(new URL('./android-release.json', import.meta.url), 'utf8'));
const releaseUrl = `https://github.com/ovverage/zerkalo/releases/download/v${release.version}/zerkalo-${release.version}.apk`;
if (!/^\d+\.\d+\.\d+$/.test(release.version) || release.url !== releaseUrl) {
  throw new Error('Некорректный адрес опубликованной Android-сборки');
}

const apkBlock = hasApk
  ? `<a class="btn" href="./zerkalo.apk" download>
            Скачать APK
            <span class="btn__sub">Android 7.0 и новее</span>
          </a>`
  : `<a class="btn" href="${release.url}">
            Скачать APK ${release.version}
            <span class="btn__sub">Android 7.0+ · ${Math.round(release.sizeBytes / 1024 / 1024)} МБ</span>
          </a>`;

const page = `${DIST}/index.html`;
const html = await readFile(page, 'utf8');
await writeFile(page, html.replace('<!--APK-->', apkBlock));

console.log(`лендинг собран в ${DIST}/ (APK: ${hasApk ? 'приложен' : `GitHub Release ${release.version}`})`);

// Ссылка на репозиторий — единственное место на лендинге, которое нельзя
// заполнить из кода. Предупреждаем, чтобы заглушка не уехала в деплой.
if (html.includes('href="https://github.com"')) {
  console.warn('ВНИМАНИЕ: в landing/index.html не заменён адрес репозитория.');
}
