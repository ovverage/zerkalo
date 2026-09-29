import { PoseDetector } from '../src/vision/poseDetector';
const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#results')!;
const canvas = document.querySelector<HTMLCanvasElement>('#source')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const ctx = canvas.getContext('2d')!;
button.onclick = async () => {
  button.disabled = true;
  const detector = new PoseDetector();
  let stream: MediaStream | null = null;
  let frame = 0;
  let rotation = 0;
  let shift = 0;
  const lines: string[] = [];
  const log = (line: string) => { lines.push(line); output.textContent = lines.join('\n'); };
  try {
    await detector.load('heavy', (p) => { output.textContent = `Загрузка Heavy: ${Math.round(p.ratio * 100)}% · ${p.phase} ${p.detail ?? ""}`; });
    log('PASS — модель Heavy загружена, рантайм запущен');
    const img = new Image();
    img.src = '/test/fixtures/pose.png';
    await img.decode();
    function draw() {
      ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 960, 540);
      ctx.save();
      ctx.translate(480 + shift, 270); ctx.rotate(rotation);
      const scale = 0.7 * Math.min(960 / img.width, 540 / img.height);
      ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale);
      ctx.restore();
      frame = requestAnimationFrame(draw);
    }
    draw();
    stream = canvas.captureStream(20);
    video.srcObject = stream;
    await video.play();
    for (const scenario of [
      { name: 'центр', shift: 0, rotation: 0 },
      { name: 'левая часть кадра', shift: -230, rotation: 0 },
      { name: 'правая часть кадра', shift: 230, rotation: 0 },
      { name: 'горизонтальная ориентация', shift: 0, rotation: Math.PI / 2 },
    ]) {
      shift = scenario.shift;
      rotation = scenario.rotation;
      detector.reset();
      let found = false;
      const start = performance.now();
      let inferMs = 0, samples = 0;
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 70));
        const before = performance.now();
        const body = detector.detect(video, before);
        inferMs += performance.now() - before; samples++;
        if (body && body.visibility.filter((v) => v > 0.45).length > 12) {
          found = true;
          if (body.world.length !== 33) throw new Error('Неверное число суставов');
          if (detector.detect(video, before + 1) !== body) throw new Error('Повторная обработка одного видеокадра');
          break;
        }
      }
      log(`${found ? 'PASS' : 'FAIL'} — ${scenario.name}: ${Math.round(performance.now() - start)} мс, занятость интерфейса ${Math.round(inferMs / samples)} мс/вызов`);
    }
    log('Проверка завершена. Это проверка модели на изображении, не оценка точности на живой тренировке.');
  } catch (e) { log(`FAIL — ${e instanceof Error ? e.message : e}`); }
  finally {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    detector.close();
    button.disabled = false;
  }
};
