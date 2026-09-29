/**
 * Аппаратная кнопка «назад» на Android.
 *
 * По умолчанию Capacitor закрывает приложение, если в истории браузера ничего
 * нет, — а у нас одностраничное приложение без записей в истории. То есть
 * нажатие «назад» посреди подхода выбрасывало бы из приложения совсем.
 *
 * На вебе слушатель просто никогда не срабатывает: у плагина есть веб-реализация,
 * которая ничего не делает, поэтому отдельная проверка платформы не нужна.
 */

import { App as CapacitorApp } from '@capacitor/app';

export interface BackHandler {
  /** Вернуть true, если нажатие обработано и выходить из приложения не нужно. */
  (): boolean;
}

export function handleBackButton(onBack: BackHandler): void {
  void CapacitorApp.addListener('backButton', () => {
    if (onBack()) return;
    void CapacitorApp.exitApp();
  });
}
