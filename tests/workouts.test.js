import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// WorkoutController.save — порядок по диаграмме последовательности (рисунок 1.9);
// калькулятор 1ПМ. Модели и сервисы подменяются mock.method, БД не нужна.
process.env.SESSION_SECRET ??= 'test-secret';
const { WorkoutController, explainDecision } = await import('../src/controllers/WorkoutController.js');
const { AnalyticsController } = await import('../src/controllers/AnalyticsController.js');
const { Program, ProgramDay, ProgramExercise, Exercise, Workout, WorkoutSet } = await import('../src/models/index.js');
const { RecordDetector, WeightAdaptationService } = await import('../src/services/index.js');

afterEach(() => mock.restoreAll());

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const pe = new ProgramExercise({ id: 10, program_day_id: 5, exercise_id: 3, order_no: 1, sets: 2,
  reps_min: 8, reps_max: 12, rest_sec: 90, working_weight: 80 });

/** Подмены моделей и сервисов; calls — общий журнал вызовов для проверки порядка. */
function setup({ activeDays = [5] } = {}) {
  const calls = [];
  mock.method(Program, 'findActive', async () => new Program({ id: 1, owner_id: 7, title: 'П', goal: 'STRENGTH',
    level: 'BEGINNER', is_template: false, status: 'ACTIVE', created_at: new Date() }));
  mock.method(ProgramDay, 'findByProgram', async () =>
    activeDays.map((id, i) => new ProgramDay({ id, program_id: 1, day_number: i + 1, title: 'День' })));
  mock.method(ProgramExercise, 'findByDay', async () => [pe]);
  mock.method(Exercise, 'search', async () => [new Exercise({ id: 3, name: 'Жим штанги лёжа', primary_muscle_id: 1,
    equipment: 'штанга', difficulty: 2, technique: '', weight_step: 2.5, is_active: true })]);
  const create = mock.method(Workout, 'create', async (userId, dayId, sets) => {
    calls.push('Workout.create');
    return new Workout({ id: 50, user_id: userId, program_day_id: dayId, date: '2026-11-16', tonnage: 1920, is_completed: true },
      sets.map((s, i) => new WorkoutSet({ id: i + 1, workout_id: 50, program_exercise_id: s.programExerciseId,
        set_no: s.setNo, weight: s.weight, reps: s.reps })));
  });
  mock.method(RecordDetector.prototype, 'detect', async () => {
    calls.push('RecordDetector.detect');
    return [{ exerciseId: 3, type: 'MAX_WEIGHT', value: 80 }];
  });
  mock.method(WeightAdaptationService.prototype, 'adapt', async () => {
    calls.push('WeightAdaptationService.adapt');
    return [{ programExerciseId: 10, oldWeight: 80, newWeight: 82.5, decision: 'INCREASE' }];
  });
  return { calls, create };
}

const body = (over = {}) => ({
  programDayId: 5,
  sets: [{ programExerciseId: 10, setNo: 1, weight: 80, reps: 12 }, { programExerciseId: 10, setNo: 2, weight: 80, reps: 12 }],
  ...over,
});

test('save: порядок рисунка 1.9 — Workout.create → detect → adapt, ответ 201', async () => {
  const { calls, create } = setup();
  const res = fakeRes();
  await WorkoutController.save({ user: { id: 7 }, body: body() }, res);

  assert.deepEqual(calls, ['Workout.create', 'RecordDetector.detect', 'WeightAdaptationService.adapt']);
  assert.deepEqual(create.mock.calls[0].arguments.slice(0, 2), [7, 5]);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.tonnage, 1920);
  assert.deepEqual(res.body.records, [{ exerciseId: 3, exerciseName: 'Жим штанги лёжа', type: 'MAX_WEIGHT',
    typeName: 'Максимальный вес', value: 80 }]);
  const [a] = res.body.adaptations;
  assert.deepEqual([a.exerciseName, a.oldWeight, a.newWeight, a.decision], ['Жим штанги лёжа', 80, 82.5, 'INCREASE']);
  assert.match(a.explanation, /увеличен с 80 кг до 82,5 кг/);
});

test('save: день не из активной программы — 400, тренировка не сохраняется', async () => {
  const { create } = setup({ activeDays: [6] });
  await assert.rejects(WorkoutController.save({ user: { id: 7 }, body: body() }, fakeRes()), { status: 400 });
  assert.equal(create.mock.callCount(), 0);
});

test('save: некорректные подходы — 400 со списком ошибок, тренировка не сохраняется', async () => {
  const { create, calls } = setup();
  const res = fakeRes();
  await WorkoutController.save({ user: { id: 7 }, body: body({ sets: [
    { programExerciseId: 10, setNo: 1, weight: -5, reps: 12 },
    { programExerciseId: 10, setNo: 2, weight: 80, reps: 51 },
    { programExerciseId: 99, setNo: 1, weight: 80, reps: 8 },
  ] }) }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors.length, 3);
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(calls, []);
});

test('save: пустой список подходов — 400', async () => {
  const { create } = setup();
  const res = fakeRes();
  await WorkoutController.save({ user: { id: 7 }, body: body({ sets: [] }) }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
});

test('explainDecision: пояснения для каждого решения', () => {
  const ex = { weightStep: 2.5 };
  const sets = (reps) => reps.map((r) => ({ reps: r }));
  assert.match(explainDecision({ decision: 'DECREASE', oldWeight: 80, newWeight: 70 }, pe, sets([6, 6]), ex), /снижен с 80 кг до 70 кг/);
  assert.match(explainDecision({ decision: 'KEEP', oldWeight: 80, newWeight: 80 }, pe, sets([10, 9]), ex), /в пределах диапазона 8–12/);
  assert.match(explainDecision({ decision: 'KEEP', oldWeight: 80, newWeight: 80 }, pe, sets([7, 9]), ex), /будет снижен/);
  assert.match(explainDecision({ decision: 'KEEP', oldWeight: 20, newWeight: 20 }, pe, sets([12, 12]), ex), /допустимую интенсивность/);
  assert.match(explainDecision({ decision: 'INCREASE', oldWeight: 0, newWeight: 0 }, pe, sets([12, 12]), { weightStep: 0 }), /увеличьте число повторений/);
});

// ---------- Калькулятор 1ПМ ----------

test('GET /api/1rm: 80 кг × 8 → Эпли 101,3, Бжицки 99,3', () => {
  const res = fakeRes();
  AnalyticsController.oneRm({ query: { weight: '80', reps: '8' } }, res);
  assert.deepEqual(res.body, { weight: 80, reps: 8, epley: 101.3, brzycki: 99.3 });
});

test('GET /api/1rm: некорректные значения — 400', () => {
  for (const query of [{ weight: '0', reps: '8' }, { weight: '80', reps: '37' }, { weight: 'abc', reps: '8' }, {}]) {
    const res = fakeRes();
    AnalyticsController.oneRm({ query }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.ok(res.body.error);
  }
});
