# Локальные модели позы

Приложение использует Google MediaPipe Pose Landmarker. **Heavy** включена по умолчанию; Full и Lite доступны в настройках.

| Модель | Файл | Размер | SHA-256 |
| --- | --- | --- | --- |
| Heavy | `pose_landmarker_heavy.task` | 29.2 MiB | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` |
| Full | `pose_landmarker_full.task` | 9.0 MiB | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| Lite | `pose_landmarker_lite.task` | 5.5 MiB | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |

Официальные источники:

- [Документация Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
- [Heavy, float16](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task).
- [Full, float16](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task).
- [Lite, float16](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task).

Таблица выше фиксирует содержимое файлов для этой версии приложения. Модели не хранятся в Git: `npm ci` автоматически запускает `scripts/prepare-assets.mjs`, который скачивает закреплённую версию `float16/1`, сверяет размер и SHA-256 из `scripts/models.json`. Повторная подготовка: `npm run prepare:assets`. Они включаются в веб-сборку и APK без повторной загрузки из Google во время тренировки.

Рантайм в `../wasm/` соответствует зафиксированному npm-пакету `@mediapipe/tasks-vision` версии `0.10.35`. Включены обычный, модульный и вариант без SIMD для совместимости окружений. Источники и лицензии перечислены в [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
