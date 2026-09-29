/** Мелкие утилиты разметки. Экраны рендерятся строками — их так проще читать. */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Экранирование текста, который попадает в innerHTML. */
export const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export const cls = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

/** Склонение русских существительных по числу. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export const reps = (n: number): string => `${n} ${plural(n, 'повторение', 'повторения', 'повторений')}`;
export const secs = (n: number): string => `${n} ${plural(n, 'секунда', 'секунды', 'секунд')}`;

/** Длительность в формате «4 мин 12 с». */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} мин ${s} с` : `${s} с`;
}

export function dateLabel(at: number): string {
  return new Date(at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Цвет для показателя качества: единая шкала во всём интерфейсе. */
export function qualityTone(q: number): 'good' | 'mid' | 'bad' {
  if (q >= 85) return 'good';
  if (q >= 60) return 'mid';
  return 'bad';
}
