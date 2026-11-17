import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDiagram, readSpec } from '../scripts/check-diagram.js';

// Этап 13: код совпадает с диаграммой классов (эталон — таблицы CLAUDE.md).

test('эталон CLAUDE.md: 13 классов models, 7 классов services, одно разрешённое дополнение', () => {
  const spec = readSpec();
  assert.equal(spec.models.size, 13);
  assert.equal(spec.services.size, 7);
  assert.deepEqual(spec.additions.map((a) => `${a.className}.${a.name}`), ['ExerciseMedia.findById']);
});

test('сверка с диаграммой классов: расхождений нет', async () => {
  const { problems } = await checkDiagram();
  assert.deepEqual(problems, []);
});
