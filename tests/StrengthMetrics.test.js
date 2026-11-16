import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrengthMetrics } from '../src/services/StrengthMetrics.js';

const metrics = new StrengthMetrics();

test('epley: 80 кг × 8 повторений = 101,3 кг (формула 1.1, округление до 0,1)', () => {
  assert.equal(metrics.epley(80, 8), 101.3);
});

test('epley: одно повторение — 103,3 кг для 100 кг', () => {
  assert.equal(metrics.epley(100, 1), 103.3);
});

test('brzycki: 80 кг × 8 повторений = 99,3 кг (формула 1.2, округление до 0,1)', () => {
  assert.equal(metrics.brzycki(80, 8), 99.3);
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

test('tonnage: округление до 0,1', () => {
  assert.equal(metrics.tonnage([{ weight: 12.33, reps: 3 }]), 37);
  assert.equal(metrics.tonnage([{ weight: 10.25, reps: 3 }]), 30.8);
});

test('tonnage: пустой список подходов — 0', () => {
  assert.equal(metrics.tonnage([]), 0);
});
