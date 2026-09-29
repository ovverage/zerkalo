import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Сборка под Android.
 *
 * Capacitor отдаёт файлы приложения из локального каталога по схеме https, а не
 * file://. Это принципиально: getUserMedia работает только в защищённом
 * контексте, и по file:// камера в WebView недоступна.
 *
 * Модель распознавания и wasm-рантайм попадают внутрь APK вместе с остальными
 * файлами, поэтому приложению не нужен интернет вообще.
 */
const config: CapacitorConfig = {
  appId: 'kz.admithackathon.zerkalo',
  appName: 'Зеркало',
  webDir: 'dist/app',
  android: {
    // Без этого WebView считает содержимое небезопасным и блокирует камеру.
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: { style: 'DARK', insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
