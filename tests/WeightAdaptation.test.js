import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Приватные #evaluateSets, #decide, #calcStep, #roundToEquipment и #isBetter проверяются
// сценарно через adapt(workout) и detect(workout); модели подменяются mock.method.
process.env.SESSION_SECRET ??= 'test-secret';
const {
  Workout, WorkoutSet, WeightHistory, ProgramExercise, Program, Exercise, PersonalRecord,
} = await import('../src/models/index.js');
const { WeightAdaptationService, RecordDetector } = await import('../src/services/index.js');

afterEach(() => mock.restoreAll());

const CURRENT = 100; // id текущей тренировки

const set = (workoutId, peId, no, weight, reps) =>
  new WorkoutSet({ id: workoutId * 100 + no, workout_id: workoutId, program_exercise_id: peId, set_no: no, weight, reps });

const workoutOf = (sets) => new Workout(
  { id: CURRENT, user_id: 7, program_day_id: 1, date: '2026-11-16', tonnage: 0, is_completed: true }, sets,
);

const pe = (over = {}) => new ProgramExercise({
  id: 10, program_day_id: 1, exercise_id: 3, order_no: 1, sets: 3,
  reps_min: 8, reps_max: 12, rest_sec: 90, working_weight: 80, ...over,
});

const EQUIPMENT = {
  barbell: { equipment: 'штанга', weight_step: 2.5 },
  dumbbell: { equipment: 'гантели', weight_step: 1 },
  machine: { equipment: 'тренажёр', weight_step: 5 },
  bodyweight: { equipment: 'собственный вес', weight_step: 0 },
};

/**
 * Запуск adapt с подменами. reps — повторения подходов текущей тренировки (вес = weight),
 * past — массив прошлых тренировок (массивы повторений), от новых к старым.
 */
async function runAdapt({
  reps, weight = 80, past = [], kind = 'barbell', goal = 'STRENGTH', peOver = {},
}) {
  const programExercise = pe({ working_weight: weight, ...peOver });
  mock.method(ProgramExercise, 'findByDay', async () => [programExercise]);
  mock.method(Program, 'findActive', async () => new Program({
    id: 1, owner_id: 7, title: 'П', goal, level: 'BEGINNER', is_template: false, status: 'ACTIVE', created_at: new Date(),
  }));
  mock.method(Exercise, 'findById', async () => new Exercise({
    id: 3, name: 'Упражнение', primary_muscle_id: 1, difficulty: 1, technique: '', is_active: true, ...EQUIPMENT[kind],
  }));
  const pastSets = past.flatMap((list, i) => list.map((r, j) => set(CURRENT - 1 - i, 10, j + 1, weight, r)));
  const history = mock.method(WorkoutSet, 'findHistory', async () => pastSets);
  const updateWeight = mock.method(ProgramExercise.prototype, 'updateWeight', async () => {});
  const created = mock.method(WeightHistory, 'create', async (d) => d);

  const workout = workoutOf(reps.map((r, i) => set(CURRENT, 10, i + 1, weight, r)));
  const result = await new WeightAdaptationService().adapt(workout);
  return { result, history, updateWeight, created, entry: created.mock.calls[0]?.arguments[0] };
}

// ---------- Решения (#evaluateSets, #decide) ----------

test('adapt: ABOVE (все подходы на верхней границе) → INCREASE', async () => {
  const { entry, updateWeight, history } = await runAdapt({ reps: [12, 12, 12] });
  assert.equal(entry.decision, 'INCREASE');
  assert.equal(entry.oldWeight, 80);
  assert.equal(entry.newWeight, 82.5);
  assert.equal(updateWeight.mock.calls[0].arguments[0], 82.5);
  assert.deepEqual(history.mock.calls[0].arguments, [10, 2], 'история за failLimit = 2 тренировки');
});

test('adapt: WITHIN (внутри диапазона) → KEEP, вес не меняется', async () => {
  const { entry, updateWeight } = await runAdapt({ reps: [10, 9, 8] });
  assert.equal(entry.decision, 'KEEP');
  assert.equal(entry.newWeight, 80);
  assert.equal(updateWeight.mock.callCount(), 0);
});

test('adapt: BELOW один раз (прошлая тренировка в диапазоне) → KEEP', async () => {
  const { entry } = await runAdapt({ reps: [9, 7, 6], past: [[10, 9, 9]] });
  assert.equal(entry.decision, 'KEEP');
  assert.equal(entry.newWeight, 80);
});

test('adapt: BELOW без прошлых тренировок → KEEP', async () => {
  const { entry } = await runAdapt({ reps: [7, 6, 6], past: [] });
  assert.equal(entry.decision, 'KEEP');
});

test('adapt: BELOW дважды подряд → DECREASE, не меньше чем на 10 %, кратно 2,5', async () => {
  const { entry, updateWeight } = await runAdapt({ reps: [7, 6, 6], past: [[7, 7, 6]] });
  assert.equal(entry.decision, 'DECREASE');
  assert.ok(entry.newWeight <= 80 * 0.9);
  assert.equal(entry.newWeight % 2.5, 0);
  assert.equal(entry.newWeight, 70);
  assert.equal(updateWeight.mock.calls[0].arguments[0], 70);
});

test('adapt: подходы текущей тренировки в истории не считаются прошлой тренировкой', async () => {
  const programExercise = pe();
  mock.method(ProgramExercise, 'findByDay', async () => [programExercise]);
  mock.method(Program, 'findActive', async () => null);
  mock.method(Exercise, 'findById', async () => new Exercise({ id: 3, name: 'У', primary_muscle_id: 1, difficulty: 1,
    technique: '', is_active: true, ...EQUIPMENT.barbell }));
  const current = [7, 6, 6].map((r, i) => set(CURRENT, 10, i + 1, 80, r));
  mock.method(WorkoutSet, 'findHistory', async () => current); // findHistory включает текущую тренировку
  mock.method(ProgramExercise.prototype, 'updateWeight', async () => {});
  const created = mock.method(WeightHistory, 'create', async (d) => d);
  await new WeightAdaptationService().adapt(workoutOf(current));
  assert.equal(created.mock.calls[0].arguments[0].decision, 'KEEP');
});

// ---------- Шаг и округление (#calcStep, #roundToEquipment) ----------

test('adapt: гантели — новый вес кратен 1 кг, рост ≤ 10 %', async () => {
  const { entry } = await runAdapt({ reps: [12, 12, 12], weight: 12, kind: 'dumbbell' });
  assert.equal(entry.decision, 'INCREASE');
  assert.equal(entry.newWeight, 13);
  assert.equal(entry.newWeight % 1, 0);
  assert.ok(entry.newWeight <= 12 * 1.1);
});

test('adapt: штанга — кратно 2,5 и рост ≤ 10 % при любом весе', async () => {
  for (const weight of [40, 60, 82.5, 100, 140]) {
    const { entry } = await runAdapt({ reps: [12, 12, 12], weight });
    assert.equal(entry.newWeight % 2.5, 0, `вес ${weight}`);
    assert.ok(entry.newWeight <= weight * 1.1 + 1e-9, `вес ${weight}: ${entry.newWeight}`);
    assert.ok(entry.newWeight > weight, `вес ${weight} растёт`);
    mock.restoreAll();
  }
});

test('adapt: шаг инвентаря больше 10 % — вес не меняется, решение KEEP', async () => {
  // Штанга 20 кг: +2,5 = 12,5 % > 10 %; гантели 8 кг: +1 = 12,5 %.
  for (const [weight, kind] of [[20, 'barbell'], [8, 'dumbbell'], [40, 'machine']]) {
    const { entry, updateWeight } = await runAdapt({ reps: [12, 12, 12], weight, kind });
    assert.equal(entry.decision, 'KEEP', kind);
    assert.equal(entry.newWeight, weight);
    assert.equal(updateWeight.mock.callCount(), 0);
    mock.restoreAll();
  }
});

test('adapt: тренажёр — кратно 5 кг', async () => {
  const { entry } = await runAdapt({ reps: [12, 12, 12], weight: 60, kind: 'machine' });
  assert.equal(entry.newWeight, 65);
});

// ---------- Проверка по 1ПМ ----------

test('adapt: новый вес не выше 1ПМ × верхняя граница интенсивности цели', async () => {
  // GENERAL (до 70 % 1ПМ): 80 кг × 12 → 1ПМ ≈ 113,6; 70 % ≈ 79,5 < 82,5 — рост невозможен.
  const capped = await runAdapt({ reps: [12, 12, 12], goal: 'GENERAL' });
  assert.equal(capped.entry.decision, 'KEEP');
  assert.equal(capped.entry.newWeight, 80);
  mock.restoreAll();
  // 80 кг × 15 → 1ПМ ≈ 125,5; 70 % ≈ 87,8 — рост до 82,5 допустим.
  const allowed = await runAdapt({ reps: [15, 15, 15], goal: 'GENERAL' });
  assert.equal(allowed.entry.decision, 'INCREASE');
  assert.equal(allowed.entry.newWeight, 82.5);
});

// ---------- Особые случаи ----------

test('adapt: внесены не все рабочие подходы — упражнение не адаптируется', async () => {
  const { result, created, updateWeight } = await runAdapt({ reps: [12, 12] });
  assert.equal(result.length, 0);
  assert.equal(created.mock.callCount(), 0);
  assert.equal(updateWeight.mock.callCount(), 0);
});

test('adapt: собственный вес — решение сохраняется, вес не меняется', async () => {
  const { entry, updateWeight } = await runAdapt({ reps: [12, 12, 12], weight: 0, kind: 'bodyweight' });
  assert.equal(entry.decision, 'INCREASE');
  assert.equal(entry.newWeight, 0);
  assert.equal(updateWeight.mock.callCount(), 0);
});

test('adapt: рабочий вес не задан (копия шаблона) — базой служит вес подходов', async () => {
  const programExercise = pe({ working_weight: 0 });
  mock.method(ProgramExercise, 'findByDay', async () => [programExercise]);
  mock.method(Program, 'findActive', async () => null);
  mock.method(Exercise, 'findById', async () => new Exercise({ id: 3, name: 'У', primary_muscle_id: 1, difficulty: 1,
    technique: '', is_active: true, ...EQUIPMENT.barbell }));
  mock.method(WorkoutSet, 'findHistory', async () => []);
  const updateWeight = mock.method(ProgramExercise.prototype, 'updateWeight', async () => {});
  const created = mock.method(WeightHistory, 'create', async (d) => d);
  // GENERAL по умолчанию: 60 × 10 — внутри диапазона → KEEP, рабочий вес = 60
  await new WeightAdaptationService().adapt(workoutOf([10, 10, 9].map((r, i) => set(CURRENT, 10, i + 1, 60, r))));
  const entry = created.mock.calls[0].arguments[0];
  assert.deepEqual([entry.decision, entry.oldWeight, entry.newWeight], ['KEEP', 0, 60]);
  assert.equal(updateWeight.mock.calls[0].arguments[0], 60);
});

// ---------- RecordDetector (#isBetter) ----------

/** Запуск detect: подходы [вес, повторения] одного упражнения; best — текущие рекорды. */
async function runDetect(sets, best) {
  mock.method(ProgramExercise, 'findByDay', async () => [pe()]);
  const findBest = mock.method(PersonalRecord, 'findBest', async () => best.map(([type, value]) =>
    new PersonalRecord({ id: 1, user_id: 7, exercise_id: 3, type, value, achieved_at: '2026-11-01' })));
  const created = mock.method(PersonalRecord, 'create', async (d) => d);
  const records = await new RecordDetector().detect(workoutOf(sets.map(([w, r], i) => set(CURRENT, 10, i + 1, w, r))));
  return { records, created, findBest };
}

const asMap = (records) => Object.fromEntries(records.map((r) => [r.type, r.value]));

test('detect: первая тренировка — рекорды по всем четырём показателям', async () => {
  const { records, findBest } = await runDetect([[80, 8], [80, 7], [75, 8]], []);
  assert.deepEqual(findBest.mock.calls[0].arguments, [7, 3]);
  assert.deepEqual(asMap(records), { MAX_WEIGHT: 80, MAX_REPS: 8, MAX_1RM: 101.3, MAX_TONNAGE: 1800 });
});

test('detect: рекорд создаётся только при превышении текущего', async () => {
  const { records, created } = await runDetect([[80, 8], [80, 7], [75, 8]],
    [['MAX_WEIGHT', 80], ['MAX_REPS', 10], ['MAX_1RM', 100], ['MAX_TONNAGE', 1900]]);
  // Вес равен рекорду, повторений и тоннажа меньше — только 1ПМ (101,3 > 100)
  assert.deepEqual(asMap(records), { MAX_1RM: 101.3 });
  assert.equal(created.mock.callCount(), 1);
  assert.equal(created.mock.calls[0].arguments[0].achievedAt, '2026-11-16');
});

test('detect: собственный вес — нулевой вес, 1ПМ и тоннаж рекордами не считаются', async () => {
  const { records } = await runDetect([[0, 12], [0, 10]], []);
  assert.deepEqual(asMap(records), { MAX_REPS: 12 });
});
