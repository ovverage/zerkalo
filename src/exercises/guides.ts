/** Camera recommendations complement recognition; they are not position gates. */
export interface ExerciseGuide {
  camera: string;
  placement: string;
  visible: string;
  start: string;
  demoView: 'front' | 'side';
}

const FRONT = 'Поставь камеру перед собой, примерно на высоте пояса. Направь её прямо, без сильного наклона сверху.';
const FLOOR = 'Поставь камеру сбоку или немного по диагонали, невысоко над полом. Съёмка строго сверху скрывает сгибание рук и линию корпуса.';

export const EXERCISE_GUIDES: Readonly<Record<string, ExerciseGuide>> = {
  squat: {
    camera: 'Спереди, сбоку или под углом', demoView: 'side',
    placement: 'Поставь камеру примерно на высоте таза. Сбоку или по диагонали лучше видно глубину приседа.',
    visible: 'Плечо, таз, колено и стопа хотя бы с одной стороны — и стоя, и внизу приседа.',
    start: 'Встань прямо, стопы примерно на ширине плеч. Руки вытяни перед собой.',
  },
  'jumping-jack': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Обе руки и обе ноги, включая кисти над головой и стопы в прыжке.',
    start: 'Встань прямо, ноги вместе, руки вдоль тела. Оставь место для прыжка в стороны.',
  },
  'overhead-press': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Плечи, локти, кисти и таз. Поднятые руки целиком остаются в кадре.',
    start: 'Встань прямо. Согни руки, подними кисти к уровню головы, локти разведи в стороны.',
  },
  'lateral-raise': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Плечи, локти, кисти и таз, в том числе при разведённых руках.',
    start: 'Стопы на ширине плеч, руки опущены вдоль тела, плечи расслаблены.',
  },
  lunge: {
    camera: 'Спереди или по диагонали', demoView: 'side', placement: FRONT,
    visible: 'Таз, оба колена и обе стопы на протяжении всего шага.',
    start: 'Встань прямо и оставь место для шага вперёд. После выпада вернись и смени ногу.',
  },
  'high-knees': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Плечи, таз, оба колена и стопы.',
    start: 'Встань прямо. Согни руки и по очереди поднимай колени перед собой.',
  },
  'side-bend': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Плечи, таз и колени. Оставь место по бокам для наклонов.',
    start: 'Стопы на ширине плеч, руки вдоль тела. Наклоняй корпус в сторону, сохраняя таз на месте.',
  },
  'knee-to-elbow': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'Оба плеча, локти, таз и оба колена.',
    start: 'Встань прямо, кисти у висков, локти в стороны. Тяни колено к противоположному локтю.',
  },
  'overhead-squat': {
    camera: 'Спереди', demoView: 'front', placement: FRONT,
    visible: 'От кистей над головой до стоп, включая таз и оба колена.',
    start: 'Стопы чуть шире плеч, руки прямые над головой. Сохраняй их поднятыми во время приседа.',
  },
  'push-up': {
    camera: 'Сбоку или по диагонали', demoView: 'side', placement: FLOOR,
    visible: 'Плечо, локоть, кисть, таз и колено хотя бы с одной стороны. Кисти и локти не перекрыты.',
    start: 'Прими упор лёжа на прямых руках: ладони под плечами, ноги вытянуты, корпус в одну линию.',
  },
  plank: {
    camera: 'Сбоку или по диагонали', demoView: 'side', placement: FLOOR,
    visible: 'Плечо, локоть, таз и колено хотя бы с одной стороны.',
    start: 'Обопрись на предплечья и носки. Локти под плечами, таз и плечи на одной линии с ногами.',
  },
};

export function exerciseGuide(id: string): ExerciseGuide {
  const guide = EXERCISE_GUIDES[id];
  if (!guide) throw new Error(`Нет видеопоказа для ${id}`);
  return guide;
}

export const exerciseMedia = (id: string, extension: 'mp4' | 'svg'): string =>
  `${import.meta.env.BASE_URL}exercises/${id}.${extension}`;
