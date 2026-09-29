/** Доступ к камере с разбором причин отказа — пользователю нужен точный совет. */

export type CameraFailure =
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

export class CameraError extends Error {
  constructor(
    readonly reason: CameraFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

const MESSAGES: Record<CameraFailure, string> = {
  denied:
    'Браузер заблокировал камеру. Нажмите на иконку камеры в адресной строке и разрешите доступ, затем обновите страницу.',
  'not-found': 'Камера не найдена. Подключите камеру или откройте деморежим — он показывает симуляцию.',
  'in-use': 'Камера занята другим приложением. Закройте Zoom, Meet или Skype и попробуйте снова.',
  'insecure-context':
    'Камера доступна только по HTTPS или на localhost. Откройте страницу по защищённому адресу.',
  unsupported: 'Этот браузер не умеет работать с камерой. Откройте Chrome, Edge, Firefox или Safari.',
  unknown: 'Не удалось включить камеру.',
};

export interface CameraStart {
  video: HTMLVideoElement;
  stream: MediaStream;
}

export async function startCamera(video: HTMLVideoElement): Promise<CameraStart> {
  if (!window.isSecureContext) {
    throw new CameraError('insecure-context', MESSAGES['insecure-context']);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', MESSAGES.unsupported);
  }

  let stream: MediaStream;
  try {
    const request = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    });
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    stream = await Promise.race([
      request.then(result => {
        if (expired) stopCamera(result);
        return result;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new CameraError('unknown', 'Нет ответа на запрос камеры за 30 секунд. Разреши доступ в браузере и попробуй снова; также доступна симуляция.'));
        }, 30000);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch (err) {
    if (err instanceof CameraError) throw err;
    throw new CameraError(classify(err), MESSAGES[classify(err)]);
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try { await Promise.all([video.play(), waitForFrame(video)]); }
  catch (error) { stopCamera(stream); video.srcObject = null; throw error; }
  return { video, stream };
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

function classify(err: unknown): CameraFailure {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'unknown';
  }
}

function waitForFrame(video: HTMLVideoElement, errorMessage?: string): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const fail = (message: string): void => {
      cleanup();
      reject(new CameraError(errorMessage ? 'not-found' : 'unknown', message));
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void =>
      fail(errorMessage ?? 'Источник видео не удалось загрузить.');

    const timer = window.setTimeout(
      () => fail(errorMessage ?? 'Видео не запустилось за 10 секунд.'),
      10_000,
    );

    function cleanup(): void {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', onError);
    }

    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}
