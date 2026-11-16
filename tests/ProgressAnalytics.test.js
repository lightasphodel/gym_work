import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ProgressAnalytics на фиктивных данных: модели подменяются mock.method,
// «сегодня» фиксируется mock.timers (среда, 18.11.2026; неделя — с понедельника 16.11).
process.env.SESSION_SECRET ??= 'test-secret';
const {
  Workout, WorkoutSet, ProgramExercise, Exercise, MuscleGroup, TrainingProfile, Program,
} = await import('../src/models/index.js');
const { ProgressAnalytics } = await import('../src/services/index.js');

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

const MUSCLES = [
  [1, 'Грудь', 2], [2, 'Спина', 1], [3, 'Бицепс', 4], [4, 'Трицепс', 3],
  [5, 'Квадрицепс', 6], [6, 'Бицепс бедра', 5], [7, 'Пресс', null],
].map(([id, name, antagonist]) => new MuscleGroup({ id, name, antagonist_id: antagonist }));

// Упражнения: 11 — грудь, 12 — спина, 13 — бицепс, 14 — квадрицепс
const CATALOG = [[11, 1], [12, 2], [13, 3], [14, 5]].map(([id, muscle]) => new Exercise({
  id, name: `Упражнение ${id}`, primary_muscle_id: muscle, equipment: 'штанга', difficulty: 1,
  technique: '', weight_step: 2.5, is_active: true,
}));
// Упражнения программы дня 1: pe 101 → упражнение 11 и т. д.
const DAY_EXERCISES = [[101, 11], [102, 12], [103, 13], [104, 14]].map(([id, exerciseId], i) => new ProgramExercise({
  id, program_day_id: 1, exercise_id: exerciseId, order_no: i + 1, sets: 3, reps_min: 8, reps_max: 12, rest_sec: 90, working_weight: 0,
}));

let nextId = 1;
/** Тренировка: date, completed, подходы [[peId, вес, повторения] …]. */
function workout(date, completed, sets = []) {
  const id = nextId++;
  const list = sets.map(([pe, weight, reps], i) => new WorkoutSet({
    id: id * 100 + i, workout_id: id, program_exercise_id: pe, set_no: i + 1, weight, reps,
  }));
  const tonnage = list.reduce((sum, s) => sum + s.volume(), 0);
  return new Workout({ id, user_id: 7, program_day_id: 1, date, tonnage, is_completed: completed }, list);
}
const repeat = (n, set) => Array.from({ length: n }, () => set);

/** Подмены моделей: findByPeriod фильтрует тренировки по датам, как SQL BETWEEN. */
function setup(workouts, { plan = 2, programCreated = new Date(2026, 9, 26), withProgram = true } = {}) {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12, 0) });
  const findByPeriod = mock.method(Workout, 'findByPeriod', async (userId, from, to) =>
    workouts.filter((w) => w.date >= from && w.date <= to));
  mock.method(ProgramExercise, 'findByDay', async () => DAY_EXERCISES);
  mock.method(Exercise, 'search', async () => CATALOG);
  mock.method(MuscleGroup, 'findAll', async () => MUSCLES);
  mock.method(TrainingProfile, 'findByUser', async () => new TrainingProfile({
    id: 1, user_id: 7, goal: 'GENERAL', level: 'BEGINNER', workouts_per_week: plan, equipment: [], body_weight: 80,
  }));
  mock.method(Program, 'findActive', async () => (withProgram ? new Program({
    id: 1, owner_id: 7, title: 'П', goal: 'GENERAL', level: 'BEGINNER', is_template: false, status: 'ACTIVE',
    created_at: programCreated,
  }) : null));
  return { findByPeriod };
}

// ---------- analyzeBalance ----------

test('analyzeBalance: подходы и тоннаж по группам мышц только за выбранную неделю', async () => {
  const { findByPeriod } = setup([
    workout('2026-11-12', true, repeat(5, [102, 50, 10])), // прошлая неделя — не учитывается
    workout('2026-11-16', true, [...repeat(3, [101, 60, 10]), ...repeat(3, [102, 50, 10]), ...repeat(2, [103, 20, 12])]),
    workout('2026-11-18', true, [...repeat(3, [101, 60, 10]), ...repeat(4, [104, 80, 8])]),
  ]);
  const report = await new ProgressAnalytics().analyzeBalance(7);
  assert.deepEqual(findByPeriod.mock.calls[0].arguments, [7, '2026-11-16', '2026-11-22']);
  assert.deepEqual([report.from, report.to, report.threshold], ['2026-11-16', '2026-11-22', 1.5]);
  const group = (name) => report.groups.find((g) => g.name === name);
  assert.deepEqual([group('Грудь').sets, group('Грудь').tonnage], [6, 3600]);
  assert.deepEqual([group('Спина').sets, group('Спина').tonnage], [3, 1500]);
  assert.deepEqual([group('Квадрицепс').sets, group('Трицепс').sets, group('Пресс').sets], [4, 0, 0]);
});

test('analyzeBalance: пары антагонистов — ratio = max/min, предупреждение при ratio > 1,5', async () => {
  setup([
    workout('2026-11-16', true, [...repeat(6, [101, 60, 10]), ...repeat(3, [102, 50, 10]), ...repeat(2, [103, 20, 12]),
      ...repeat(4, [104, 80, 8])]),
  ]);
  const { pairs } = await new ProgressAnalytics().analyzeBalance(7, '2026-11-20');
  assert.equal(pairs.length, 3, 'пресс без антагониста в пары не входит');
  const chest = pairs.find((p) => p.first === 'Грудь');
  assert.deepEqual([chest.firstSets, chest.secondSets, chest.ratio], [6, 3, 2]);
  assert.match(chest.warning, /«Грудь» в 2 раза больше, чем на «Спина»/);
  // Нагрузка только на одну мышцу пары
  assert.match(pairs.find((p) => p.first === 'Бицепс').warning, /только на «Бицепс»/);
  assert.equal(pairs.find((p) => p.first === 'Бицепс').ratio, null);
});

test('analyzeBalance: соотношение в пределах порога — без предупреждения; пустая пара — без оценки', async () => {
  setup([workout('2026-11-09', true, [...repeat(4, [101, 60, 10]), ...repeat(3, [102, 50, 10])])]);
  const { pairs, from } = await new ProgressAnalytics().analyzeBalance(7, '2026-11-11');
  assert.equal(from, '2026-11-09');
  const chest = pairs.find((p) => p.first === 'Грудь');
  assert.equal(chest.ratio, 1.33);
  assert.equal(chest.warning, null);
  const legs = pairs.find((p) => p.first === 'Квадрицепс');
  assert.deepEqual([legs.ratio, legs.warning], [null, null]);
});

test('analyzeBalance: ровно 1,5 — ещё не дисбаланс', async () => {
  setup([workout('2026-11-16', true, [...repeat(3, [101, 60, 10]), ...repeat(2, [102, 50, 10])])]);
  const chest = (await new ProgressAnalytics().analyzeBalance(7)).pairs.find((p) => p.first === 'Грудь');
  assert.deepEqual([chest.ratio, chest.warning], [1.5, null]);
});

// ---------- getRegularity ----------

const HISTORY = () => [
  workout('2026-10-27', true), workout('2026-10-29', true), // неделя 26.10: 2 из 2
  workout('2026-11-03', true), workout('2026-11-05', false), // неделя 02.11: 1 из 2 (одна не завершена)
  workout('2026-11-10', true), workout('2026-11-12', true), // неделя 09.11: 2 из 2
  workout('2026-11-17', true), // текущая неделя 16.11: пока 1 из 2
];

test('getRegularity: календарь, серия, процент выполнения', async () => {
  setup(HISTORY());
  const r = await new ProgressAnalytics().getRegularity(7);
  assert.equal(r.calendar.length, 7);
  assert.deepEqual(r.calendar[3], { date: '2026-11-05', completed: false });
  assert.equal(r.planPerWeek, 2);
  // Текущая неделя ещё не выполнена — не прерывает серию; неделя 09.11 выполнена, 02.11 — нет.
  assert.equal(r.streak, 1);
  // С 26.10: 4 недели × 2 = 8 запланировано, завершено 6 → 75 %.
  assert.equal(r.since, '2026-10-26');
  assert.equal(r.completionPct, 75);
});

test('getRegularity: серия растёт, когда план выполнен и в текущей неделе', async () => {
  setup([
    workout('2026-10-27', true), workout('2026-10-29', true),
    workout('2026-11-03', true), workout('2026-11-04', true),
    workout('2026-11-10', true), workout('2026-11-12', true),
    workout('2026-11-16', true), workout('2026-11-17', true),
  ]);
  const r = await new ProgressAnalytics().getRegularity(7);
  assert.equal(r.streak, 4);
  assert.equal(r.completionPct, 100);
});

test('getRegularity: пропущенная неделя обрывает серию', async () => {
  setup([workout('2026-10-27', true), workout('2026-10-29', true), workout('2026-11-10', true), workout('2026-11-12', true)]);
  const r = await new ProgressAnalytics().getRegularity(7);
  assert.equal(r.streak, 1);
});

test('getRegularity: без активной программы процент выполнения не считается', async () => {
  setup(HISTORY(), { withProgram: false });
  const r = await new ProgressAnalytics().getRegularity(7);
  assert.equal(r.completionPct, null);
  assert.equal(r.since, null);
  assert.equal(r.streak, 1);
});

test('getRegularity: процент не превышает 100', async () => {
  setup([workout('2026-11-16', true), workout('2026-11-17', true), workout('2026-11-18', true)],
    { programCreated: new Date(2026, 10, 16, 9, 0) });
  assert.equal((await new ProgressAnalytics().getRegularity(7)).completionPct, 100);
});

// ---------- getProgress, getTonnage ----------

test('getProgress: ряды по датам; тренировки одного дня объединяются', async () => {
  setup([
    workout('2026-11-02', true, [[101, 60, 10], [101, 60, 8], [102, 50, 10]]),
    workout('2026-11-09', true, [[101, 62.5, 10]]),
    workout('2026-11-09', true, [[101, 65, 6]]),
  ]);
  const s = await new ProgressAnalytics().getProgress(7, 11, '2026-11-01', '2026-11-30');
  assert.deepEqual(s.labels, ['2026-11-02', '2026-11-09']);
  assert.deepEqual(s.workingWeight, [60, 65]);
  assert.deepEqual(s.e1rm, [80, 83.3]); // Эпли: 60 × (1 + 10/30) = 80; 62,5 × (1 + 10/30) = 83,3
  assert.deepEqual(s.tonnage, [1080, 1015]);
});

test('getTonnage: последняя тренировка, неделя, месяц; неизвестный период — 400', async () => {
  setup([
    workout('2026-10-30', true, [[101, 100, 10]]), // 1000, октябрь
    workout('2026-11-10', true, [[101, 50, 10]]), // 500, прошлая неделя
    workout('2026-11-17', true, [[101, 40, 10]]), // 400, текущая неделя
  ]);
  const service = new ProgressAnalytics();
  assert.equal(await service.getTonnage(7, 'workout'), 400);
  assert.equal(await service.getTonnage(7, 'week'), 400);
  assert.equal(await service.getTonnage(7, 'month'), 900);
  await assert.rejects(service.getTonnage(7, 'year'), { status: 400 });
});

// ---------- API: проверка параметров ----------

const { AnalyticsController } = await import('../src/controllers/AnalyticsController.js');
const { parseProgressQuery, parseDate } = await import('../src/middleware/validate.js');

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('parseDate: только существующие даты ГГГГ-ММ-ДД', () => {
  assert.equal(parseDate('2026-11-16'), '2026-11-16');
  for (const v of ['2026-02-30', '16.11.2026', '2026-1-1', '', undefined]) assert.equal(parseDate(v), null, String(v));
});

test('parseProgressQuery: по умолчанию 90 дней до сегодня; ошибки периода', () => {
  assert.deepEqual(parseProgressQuery({ exerciseId: '5' }, '2026-11-18').data,
    { exerciseId: 5, from: '2026-08-21', to: '2026-11-18' });
  assert.ok(parseProgressQuery({}, '2026-11-18').errors.includes('Выберите упражнение'));
  assert.equal(parseProgressQuery({ exerciseId: '5', from: '2026-11-20', to: '2026-11-01' }, '2026-11-18').errors[0],
    'Начало периода позже его конца');
  assert.equal(parseProgressQuery({ exerciseId: '5', from: '2020-01-01', to: '2026-11-01' }, '2026-11-18').errors[0],
    'Период — не длиннее двух лет');
});

test('API статистики: неверные параметры — 400 без обращения к сервису', async () => {
  const findByPeriod = mock.method(Workout, 'findByPeriod', async () => []);
  for (const [method, query] of [['progress', { exerciseId: 'x' }], ['tonnage', { period: 'year' }], ['balance', { week: '2026-13-01' }]]) {
    const res = fakeRes();
    await AnalyticsController[method]({ user: { id: 7 }, query }, res);
    assert.equal(res.statusCode, 400, method);
    assert.ok(res.body.error);
  }
  assert.equal(findByPeriod.mock.callCount(), 0);
});
