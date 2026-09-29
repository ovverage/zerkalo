import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXERCISES } from '../src/exercises/registry';
import { EXERCISE_GUIDES, exerciseGuide } from '../src/exercises/guides';

test('каждое упражнение имеет локальный MP4, иллюстрацию и инструкцию по камере', () => {
  assert.deepEqual(Object.keys(EXERCISE_GUIDES).sort(), EXERCISES.map((e) => e.id).sort());
  for (const exercise of EXERCISES) {
    const guide = exerciseGuide(exercise.id);
    assert.ok(guide.start && guide.placement && guide.visible && guide.camera);
    const movie = readFileSync(`public/exercises/${exercise.id}.mp4`);
    assert.equal(movie.subarray(4, 8).toString(), 'ftyp');
    assert.ok(readFileSync(`public/exercises/${exercise.id}.svg`, 'utf8').includes('<svg'));
  }
});
