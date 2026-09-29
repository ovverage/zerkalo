import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Приложение собирается в dist/app, лендинг кладётся рядом в dist (см.
 * scripts/build-landing.mjs). Так у Capacitor есть каталог, где приложение
 * лежит в корне, а на вебе лендинг остаётся главной страницей.
 *
 * base: './' обязателен: одни и те же файлы открываются и по адресу /app/ на
 * сайте, и из корня внутри Android-приложения.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist/app',
    emptyOutDir: true,
  },
});
