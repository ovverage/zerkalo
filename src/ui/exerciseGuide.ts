import { esc } from '../core/dom';
import type { ExerciseSpec } from '../engine/types';
import { exerciseGuide, exerciseMedia } from '../exercises/guides';
import { GROUP_LABEL } from '../exercises/registry';

export function guideVideo(spec: ExerciseSpec): string {
  return `<div class="guide-media" data-gesture-section data-gesture-label="Видеопоказ">
    <video class="guide-video" data-guide-video muted loop playsinline controls preload="metadata"
      poster="${exerciseMedia(spec.id, 'svg')}" aria-label="Видеопоказ: ${esc(spec.name)}">
      <source src="${exerciseMedia(spec.id, 'mp4')}" type="video/mp4">
    </video>
    <p class="guide-media__caption">Анимированный видеопоказ · 8 секунд · без звука</p>
    <p class="guide-media__error" data-video-error role="status" hidden>Видео недоступно. Исходная поза показана на иллюстрации, шаги описаны рядом.</p>
  </div>`;
}

export function guideContent(spec: ExerciseSpec): string {
  const guide = exerciseGuide(spec.id);
  return `<div class="exercise-guide">
    <div class="exercise-guide__visual">
      ${guideVideo(spec)}
    </div>
    <div class="exercise-guide__details">
      <p class="guide-eyebrow">${GROUP_LABEL[spec.group]} · ${spec.mode === 'hold' ? 'Удержание позы' : 'Повторения'}</p>
      <section class="guide-section" data-gesture-section data-gesture-label="Исходная поза"><h3>01 <span>Исходная поза</span></h3><p>${esc(guide.start)}</p></section>
      <section class="guide-section guide-section--camera" data-gesture-section data-gesture-label="Положение камеры"><h3>02 <span>Куда поставить камеру</span></h3>
        <strong>${esc(guide.camera)}</strong><p>${esc(guide.placement)}</p>
        <p class="guide-visible"><b>В кадре:</b> ${esc(guide.visible)}</p>
      </section>
      <section class="guide-section" data-gesture-section data-gesture-label="Как двигаться"><h3>03 <span>Как двигаться</span></h3>
        <ol>${spec.howTo.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
      </section>
    </div>
  </div>`;
}

/** Controls remain available when autoplay is blocked or reduced motion is preferred. */
export function playGuideVideos(root: HTMLElement): void {
  for (const video of root.querySelectorAll<HTMLVideoElement>('[data-guide-video]')) {
    video.muted = true;
    const showError = () => video.parentElement?.querySelector('[data-video-error]')?.removeAttribute('hidden');
    video.addEventListener('error', showError, { once: true });
    video.querySelector('source')?.addEventListener('error', showError, { once: true });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) void video.play().catch(() => {});
  }
}

export function stopGuideVideos(root: HTMLElement): void {
  for (const video of root.querySelectorAll<HTMLVideoElement>('[data-guide-video]')) video.pause();
}
