/** Same transform for video, skeleton and tracking box. */
export function containTransform(videoW: number, videoH: number, boxW: number, boxH: number) {
  if (videoW < 1 || videoH < 1) return { scale: 1, dx: 0, dy: 0 };
  const scale = Math.min(boxW / videoW, boxH / videoH);
  return { scale, dx: (boxW - videoW * scale) / 2, dy: (boxH - videoH * scale) / 2 };
}
