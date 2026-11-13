import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrengthMetrics } from '../src/services/StrengthMetrics.js';

const metrics = new StrengthMetrics();

test('epley: 80 кг × 8 повторений ≈ 101,3 кг (формула 1.1)', () => {
  assert.ok(Math.abs(metrics.epley(80, 8) - 101.33) < 0.01);
});

test('epley: одно повторение ≈ рабочий вес', () => {
  assert.ok(Math.abs(metrics.epley(100, 1) - 103.33) < 0.01);
});

test('brzycki: 80 кг × 8 повторений ≈ 99,3 кг (формула 1.2)', () => {
  assert.ok(Math.abs(metrics.brzycki(80, 8) - 99.31) < 0.01);
});

test('brzycki: одно повторение = рабочий вес', () => {
  assert.equal(metrics.brzycki(100, 1), 100);
});

test('brzycki: при 37 и более повторениях — RangeError', () => {
  assert.throws(() => metrics.brzycki(50, 37), RangeError);
});

test('tonnage: Σ Wi · ri (формула 1.3)', () => {
  const sets = [
    { weight: 80, reps: 8 },
    { weight: 80, reps: 7 },
    { weight: 75, reps: 8 },
  ];
  assert.equal(metrics.tonnage(sets), 640 + 560 + 600);
});

test('tonnage: пустой список подходов — 0', () => {
  assert.equal(metrics.tonnage([]), 0);
});
