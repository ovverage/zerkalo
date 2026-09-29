# Сторонние материалы

Этот файл описывает происхождение включённых материалов. Он не задаёт лицензию на собственный код проекта.

| Компонент | Где используется | Источник и условия |
| --- | --- | --- |
| MediaPipe Tasks Vision `0.10.35` | Загрузка модели и WASM в `public/wasm/` | [MediaPipe](https://github.com/google-ai-edge/mediapipe), Apache License 2.0; [текст лицензии](docs/licenses/MediaPipe-Apache-2.0.txt) |
| Pose Landmarker Heavy / Full / Lite | Файлы `.task` в `public/models/` | Модели Google MediaPipe; [источники](public/models/README.md), [официальная документация и ссылки на модели](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) |
| Inter | Локальный шрифт, поставляемый через `@fontsource/inter` | [Inter](https://github.com/rsms/inter), SIL Open Font License 1.1; [текст лицензии](docs/licenses/Inter-OFL.txt) |
| Тестовое изображение позы | `test/fixtures/pose.png`, только браузерный стенд | Пример из документации Google; [источник и атрибуция](test/fixtures/README.md). Не включается в приложение. |
| Capacitor | Android-оболочка и стандартный каркас проекта | [Capacitor](https://github.com/ionic-team/capacitor), MIT; условия поставляются с зависимостями |

Баннер в `docs/assets/` и видеопоказы в `public/exercises/` созданы для этого проекта. Видеопоказы генерируются из исходника `scripts/build-exercise-videos.py`; съёмки людей и сторонние видеозаписи для них не использовались.

Остальные зависимости, включая Vite и TypeScript, перечислены с точными разрешёнными версиями в `package-lock.json`; их лицензии находятся в соответствующих npm-пакетах.
