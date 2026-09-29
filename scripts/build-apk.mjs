/**
 * Сборка APK.
 *
 * Отдельный скрипт, а не строчка в package.json, из-за двух вещей, о которые
 * спотыкается любой, кто собирает проект впервые:
 *
 *  1. Текущий проект с Capacitor 8 собирается с JDK 21. На машине обычно стоит
 *     более новый JDK, и Gradle падает с невнятной ошибкой про версию класса.
 *     Здесь мы явно ищем подходящий и говорим, если его нет.
 *  2. Gradle нужен путь к Android SDK. Ищем его в привычных местах и пишем в
 *     local.properties, чтобы не требовать переменных окружения.
 */

import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const ANDROID_DIR = 'android';
const APK_SOURCE = join(ANDROID_DIR, 'app/build/outputs/apk/debug/app-debug.apk');
const APK_TARGET = 'dist/zerkalo.apk';

/** Capacitor 8 компилирует Java с sourceCompatibility VERSION_21. */
const JDK_MIN = 21;
const JDK_MAX = 21;

const exists = (path) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

function javaMajor(javaHome) {
  const bin = join(javaHome, 'bin', platform() === 'win32' ? 'java.exe' : 'java');
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const text = `${res.stderr ?? ''}${res.stdout ?? ''}`;
  const match = text.match(/version "(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function findJdk() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  // Каталоги, куда JDK кладут дистрибутивы и ручная распаковка.
  for (const dir of [
    join(homedir(), '.local/share/android-toolchain'),
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
  ]) {
    if (!(await exists(dir))) continue;
    for (const name of await readdir(dir)) {
      candidates.push(join(dir, name));
      candidates.push(join(dir, name, 'Contents/Home'));
    }
  }

  for (const candidate of candidates) {
    if (!(await exists(join(candidate, 'bin')))) continue;
    const major = javaMajor(candidate);
    if (major >= JDK_MIN && major <= JDK_MAX) return { home: candidate, major };
  }
  return null;
}

async function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), '.local/share/android-toolchain/sdk'),
    join(homedir(), 'Android/Sdk'),
    join(homedir(), 'Library/Android/sdk'),
    '/opt/android-sdk',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await exists(join(candidate, 'platform-tools'))) return candidate;
    if (await exists(join(candidate, 'cmdline-tools'))) return candidate;
  }
  return null;
}

const jdk = await findJdk();
if (!jdk) {
  console.error(
    `Не найден JDK ${JDK_MIN}–${JDK_MAX}. Android Gradle Plugin с другими версиями не работает.\n` +
      'Поставьте, например, Temurin 21 и укажите путь в JAVA_HOME.',
  );
  process.exit(1);
}

const sdk = await findSdk();
if (!sdk) {
  console.error(
    'Не найден Android SDK. Укажите путь в ANDROID_HOME либо установите его через Android Studio.',
  );
  process.exit(1);
}

await writeFile(join(ANDROID_DIR, 'local.properties'), `sdk.dir=${resolve(sdk)}\n`);
console.log(`JDK ${jdk.major}: ${jdk.home}`);
console.log(`Android SDK: ${sdk}`);

const gradlew = platform() === 'win32' ? 'gradlew.bat' : './gradlew';
const build = spawnSync(gradlew, ['assembleDebug', '--no-daemon'], {
  cwd: ANDROID_DIR,
  stdio: 'inherit',
  env: { ...process.env, JAVA_HOME: jdk.home, ANDROID_HOME: resolve(sdk) },
});

if (build.status !== 0) process.exit(build.status ?? 1);

if (await exists(APK_SOURCE)) {
  await mkdir('dist', { recursive: true });
  await copyFile(APK_SOURCE, APK_TARGET);
  console.log(`\nAPK собран: ${APK_TARGET}`);
} else {
  console.error(`Gradle отработал, но APK не найден по пути ${APK_SOURCE}`);
  process.exit(1);
}
