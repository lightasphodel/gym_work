import { test } from 'node:test';
import assert from 'node:assert/strict';

// Проверяются методы моделей без обращения к БД.
process.env.SESSION_SECRET ??= 'test-secret';
const { Workout, WorkoutSet, TrainingProfile } = await import('../src/models/index.js');

const workoutRow = { id: 1, user_id: 1, program_day_id: 1, date: '2026-11-13', tonnage: 0, is_completed: false };
const set = (no, weight, reps) =>
  new WorkoutSet({ id: no, workout_id: 1, program_exercise_id: 1, set_no: no, weight, reps });

test('WorkoutSet.volume() = вес × повторения', () => {
  assert.equal(set(1, 82.5, 6).volume(), 495);
});

test('Workout.calcTonnage() — синхронная Σ WorkoutSet.volume()', () => {
  const workout = new Workout(workoutRow, [set(1, 80, 8), set(2, 80, 7), set(3, 75, 8)]);
  const result = workout.calcTonnage();
  assert.equal(typeof result, 'number');
  assert.equal(result, 1800);
});

test('Workout.calcTonnage(): дробные веса округляются до 0,01', () => {
  const workout = new Workout(workoutRow, [set(1, 0.1, 3), set(2, 0.2, 3)]);
  assert.equal(workout.calcTonnage(), 0.9);
});

test('Workout.sets возвращает копию: состав подходов снаружи не меняется', () => {
  const workout = new Workout(workoutRow, [set(1, 50, 10)]);
  workout.sets.push(set(2, 100, 10));
  assert.equal(workout.sets.length, 1);
  assert.equal(workout.calcTonnage(), 500);
});

const profileRow = {
  id: 1, user_id: 1, goal: 'STRENGTH', level: 'BEGINNER',
  workouts_per_week: 3, equipment: ['штанга'], body_weight: 75,
};

test('TrainingProfile.isComplete(): заполненный профиль', () => {
  assert.equal(new TrainingProfile(profileRow).isComplete(), true);
});

test('TrainingProfile.isComplete(): без массы тела профиль не заполнен', () => {
  assert.equal(new TrainingProfile({ ...profileRow, body_weight: null }).isComplete(), false);
  assert.equal(new TrainingProfile({ ...profileRow, body_weight: 0 }).isComplete(), false);
});

test('TrainingProfile.isComplete(): без цели профиль не заполнен', () => {
  assert.equal(new TrainingProfile({ ...profileRow, goal: null }).isComplete(), false);
});
