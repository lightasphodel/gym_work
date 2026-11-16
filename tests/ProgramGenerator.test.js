import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Приватные #selectSplit, #pickExercises, #calcStartWeight проверяются сценарно
// через generate(profile); модели и ExerciseSelector подменяются mock.method.
process.env.SESSION_SECRET ??= 'test-secret';
const { Program, MuscleGroup, Exercise, TrainingProfile, ProgramDay, ProgramExercise } =
  await import('../src/models/index.js');
const { ProgramGenerator, ExerciseSelector } = await import('../src/services/index.js');

const MUSCLES = ['Грудь', 'Спина', 'Бицепс', 'Трицепс', 'Квадрицепс', 'Бицепс бедра',
  'Передняя дельта', 'Задняя дельта', 'Средняя дельта', 'Ягодицы', 'Икры', 'Пресс']
  .map((name, i) => new MuscleGroup({ id: i + 1, name, antagonist_id: null }));
const muscleId = (name) => MUSCLES.find((m) => m.name === name).id;

let nextId = 1;
const exercise = (name, muscle, equipment, difficulty, step) => new Exercise({
  id: nextId++, name, primary_muscle_id: muscleId(muscle), equipment, difficulty,
  technique: '', weight_step: step, is_active: true,
});

// Небольшой справочник: по одному-два упражнения на группу.
const CATALOG = [
  exercise('Жим штанги лёжа', 'Грудь', 'штанга', 1, 2.5),
  exercise('Жим гантелей', 'Грудь', 'гантели', 1, 1),
  exercise('Отжимания', 'Грудь', 'собственный вес', 1, 0),
  exercise('Тяга штанги', 'Спина', 'штанга', 1, 2.5),
  exercise('Тяга гантели', 'Спина', 'гантели', 1, 1),
  exercise('Подтягивания', 'Спина', 'собственный вес', 2, 0),
  exercise('Приседания', 'Квадрицепс', 'штанга', 3, 2.5),
  exercise('Выпады', 'Квадрицепс', 'гантели', 2, 1),
  exercise('Румынская тяга', 'Бицепс бедра', 'штанга', 1, 2.5),
  exercise('Жим стоя', 'Передняя дельта', 'штанга', 1, 2.5),
  exercise('Махи', 'Средняя дельта', 'гантели', 1, 1),
  exercise('Разведения', 'Задняя дельта', 'гантели', 1, 1),
  exercise('Подъём на бицепс', 'Бицепс', 'штанга', 1, 2.5),
  exercise('Молот', 'Бицепс', 'гантели', 1, 1),
  exercise('Французский жим', 'Трицепс', 'штанга', 1, 2.5),
  exercise('Брусья', 'Трицепс', 'собственный вес', 1, 0),
  exercise('Ягодичный мост', 'Ягодицы', 'штанга', 1, 2.5),
  exercise('Скручивания', 'Пресс', 'собственный вес', 1, 0),
  exercise('Подъёмы ног', 'Пресс', 'собственный вес', 1, 0),
  // Икры — только тренажёр
  exercise('Подъёмы на носки', 'Икры', 'тренажёр', 1, 5),
];
const byName = (name) => CATALOG.find((e) => e.name === name);

/** Подмена ExerciseSelector.filter по справочнику CATALOG (только основная группа). */
function mockFilter() {
  return mock.method(ExerciseSelector.prototype, 'filter', async (mId, equipment, difficulty) =>
    CATALOG.filter((e) => e.primaryMuscleId === mId && equipment.includes(e.equipment) && e.difficulty <= difficulty));
}

const profile = (over = {}) => new TrainingProfile({
  id: 1, user_id: 42, goal: 'HYPERTROPHY', level: 'BEGINNER', workouts_per_week: 3,
  equipment: ['штанга', 'гантели'], body_weight: 80, ...over,
});

/** Запуск generate с подменами; возвращает data, переданные в Program.create. */
async function generate(over) {
  mock.method(MuscleGroup, 'findAll', async () => MUSCLES);
  mockFilter();
  const create = mock.method(Program, 'create', async (data) => data);
  await new ProgramGenerator().generate(profile(over));
  assert.equal(create.mock.callCount(), 1, 'Program.create вызывается один раз');
  return create.mock.calls[0].arguments[0];
}

const names = (day) => day.exercises.map((x) => CATALOG.find((e) => e.id === x.exerciseId).name);

afterEach(() => mock.restoreAll());

test('generate: незаполненный профиль — ошибка 400, программа не создаётся', async () => {
  const create = mock.method(Program, 'create', async (d) => d);
  await assert.rejects(new ProgramGenerator().generate(profile({ body_weight: null })), { status: 400 });
  assert.equal(create.mock.callCount(), 0);
});

test('selectSplit через generate: 3 тренировки — «Всё тело» A/B/C', async () => {
  const data = await generate({ workouts_per_week: 3 });
  assert.deepEqual(data.days.map((d) => d.title), ['Всё тело — A', 'Всё тело — B', 'Всё тело — C']);
  assert.deepEqual(data.days.map((d) => d.dayNumber), [1, 2, 3]);
  assert.equal(data.status, 'DRAFT');
  assert.equal(data.isTemplate, false);
  assert.equal(data.ownerId, 42);
  assert.match(data.title, /^Всё тело — /);
});

test('selectSplit через generate: 2 тренировки — два дня на всё тело', async () => {
  const data = await generate({ workouts_per_week: 2 });
  assert.deepEqual(data.days.map((d) => d.title), ['Всё тело — A', 'Всё тело — B']);
});

test('selectSplit через generate: 4 тренировки — верх / низ', async () => {
  const data = await generate({ workouts_per_week: 4 });
  assert.deepEqual(data.days.map((d) => d.title),
    ['Верх тела — A', 'Низ тела — A', 'Верх тела — B', 'Низ тела — B']);
});

test('selectSplit через generate: 5 тренировок — сплит по группам мышц', async () => {
  const data = await generate({ workouts_per_week: 5, level: 'ADVANCED' });
  assert.deepEqual(data.days.map((d) => d.title),
    ['Грудь и трицепс', 'Спина и бицепс', 'Ноги', 'Плечи', 'Ягодицы и пресс']);
  // Две позиции на грудь — два разных упражнения
  const chest = names(data.days[0]).filter((n) => /Жим|Отжимания/.test(n));
  assert.equal(new Set(chest).size, chest.length);
});

test('loadTable: подходы по уровню, повторения и отдых по цели (таблица 1.1)', async () => {
  const cases = [
    [{ goal: 'GENERAL', level: 'BEGINNER' }, 3, 8, 12, 90],
    [{ goal: 'HYPERTROPHY', level: 'INTERMEDIATE' }, 4, 6, 12, 90],
    [{ goal: 'STRENGTH', level: 'ADVANCED' }, 5, 1, 6, 180],
    [{ goal: 'ENDURANCE', level: 'BEGINNER' }, 3, 10, 25, 60],
  ];
  for (const [over, sets, repsMin, repsMax, restSec] of cases) {
    const data = await generate(over);
    for (const ex of data.days.flatMap((d) => d.exercises)) {
      assert.deepEqual([ex.sets, ex.repsMin, ex.repsMax, ex.restSec], [sets, repsMin, repsMax, restSec], over.goal);
    }
    mock.restoreAll();
  }
});

test('pickExercises через generate: только доступный инвентарь + собственный вес', async () => {
  const data = await generate({ equipment: ['гантели'] });
  const used = data.days.flatMap((d) => d.exercises).map((x) => CATALOG.find((e) => e.id === x.exerciseId));
  assert.ok(used.length > 0);
  for (const e of used) assert.ok(['гантели', 'собственный вес'].includes(e.equipment), e.name);
});

test('pickExercises через generate: сложность не выше уровня, при отсутствии — самое простое', async () => {
  // BEGINNER, только штанга: на квадрицепс есть лишь «Приседания» (сложность 3) — берётся оно.
  const data = await generate({ equipment: ['штанга'] });
  const day = names(data.days[0]);
  assert.ok(day.includes('Приседания'));
  // «Выпады» (гантели) не попадают — гантелей нет в профиле.
  assert.ok(!day.includes('Выпады'));
});

test('pickExercises через generate: варианты чередуются по дням Full Body', async () => {
  const data = await generate({ equipment: ['штанга', 'гантели'] });
  const chestByDay = data.days.map((d) => names(d)[1]); // вторая позиция — грудь
  assert.notEqual(chestByDay[0], chestByDay[1]);
});

test('pickExercises через generate: группа без упражнений пропускается, порядок 1..n сохраняется', async () => {
  // Низ тела без тренажёра: «Икры» пропускаются.
  const data = await generate({ workouts_per_week: 4, equipment: ['штанга'] });
  const lower = data.days[1];
  assert.ok(!names(lower).includes('Подъёмы на носки'));
  assert.deepEqual(lower.exercises.map((x) => x.orderNo), lower.exercises.map((_, i) => i + 1));
});

test('generate: день без единого упражнения — ошибка 422', async () => {
  mock.method(MuscleGroup, 'findAll', async () => MUSCLES);
  mock.method(ExerciseSelector.prototype, 'filter', async () => []);
  const create = mock.method(Program, 'create', async (d) => d);
  await assert.rejects(new ProgramGenerator().generate(profile()), { status: 422 });
  assert.equal(create.mock.callCount(), 0);
});

test('calcStartWeight через generate: масса × коэффициент, округление по шагу', async () => {
  const data = await generate({ body_weight: 80, level: 'BEGINNER', equipment: ['штанга', 'гантели'] });
  const weightOf = (name) => data.days.flatMap((d) => d.exercises)
    .find((x) => x.exerciseId === byName(name).id)?.workingWeight;
  // Грудь, штанга: 80 × 0,4 = 32 → кратно 2,5 → 32,5
  assert.equal(weightOf('Жим штанги лёжа'), 32.5);
  // Спина, гантели: 80 × 0,4 × 0,4 = 12,8 → кратно 1 → 13
  assert.equal(weightOf('Тяга гантели'), 13);
  // Собственный вес — 0
  assert.equal(weightOf('Скручивания'), 0);
  for (const ex of data.days.flatMap((d) => d.exercises)) {
    const step = CATALOG.find((e) => e.id === ex.exerciseId).weightStep;
    if (step > 0) assert.equal(Math.round((ex.workingWeight / step) * 1000) % 1000, 0, 'кратно шагу');
  }
});

test('calcStartWeight через generate: продвинутому — больше, чем начинающему', async () => {
  const beginner = await generate({ level: 'BEGINNER' });
  mock.restoreAll();
  const advanced = await generate({ level: 'ADVANCED' });
  const w = (data) => data.days[0].exercises[1].workingWeight;
  assert.ok(w(advanced) > w(beginner));
});

// ---------- ExerciseSelector ----------

test('ExerciseSelector.filter: упражнения с основной группой — первыми', async () => {
  const secondary = new Exercise({ id: 900, name: 'А-упражнение', primary_muscle_id: 2, equipment: 'штанга',
    difficulty: 1, technique: '', weight_step: 2.5, is_active: true });
  const search = mock.method(Exercise, 'search', async () => [secondary, byName('Жим штанги лёжа')]);
  const list = await new ExerciseSelector().filter(muscleId('Грудь'), ['штанга'], 2);
  assert.deepEqual(search.mock.calls[0].arguments[0], { muscleId: 1, equipment: ['штанга'], difficulty: 2 });
  assert.deepEqual(list.map((e) => e.id), [byName('Жим штанги лёжа').id, 900]);
});

test('ExerciseSelector.suggestReplacement: та же основная группа, без самого упражнения', async () => {
  const bench = byName('Жим штанги лёжа');
  mock.method(Exercise, 'findById', async () => bench);
  const search = mock.method(Exercise, 'search', async () =>
    CATALOG.filter((e) => e.primaryMuscleId === bench.primaryMuscleId));
  const list = await new ExerciseSelector().suggestReplacement(bench.id, ['гантели', 'собственный вес']);
  assert.equal(search.mock.calls[0].arguments[0].muscleId, bench.primaryMuscleId);
  assert.deepEqual(search.mock.calls[0].arguments[0].equipment, ['гантели', 'собственный вес']);
  assert.ok(!list.some((e) => e.id === bench.id));
  assert.deepEqual(list.map((e) => e.name), ['Жим гантелей', 'Отжимания']);
});

test('ExerciseSelector.suggestReplacement: неизвестное упражнение — пустой список', async () => {
  mock.method(Exercise, 'findById', async () => null);
  assert.deepEqual(await new ExerciseSelector().suggestReplacement(999, []), []);
});

// ---------- Program.copyFor ----------

test('copyFor: личная копия шаблона со всеми днями и упражнениями, статус DRAFT', async () => {
  const template = new Program({ id: 5, owner_id: null, title: 'Full Body', goal: 'GENERAL',
    level: 'BEGINNER', is_template: true, status: 'ACTIVE', created_at: new Date() });
  mock.method(ProgramDay, 'findByProgram', async () => [
    new ProgramDay({ id: 10, program_id: 5, day_number: 1, title: 'День 1' }),
    new ProgramDay({ id: 11, program_id: 5, day_number: 2, title: 'День 2' }),
  ]);
  mock.method(ProgramExercise, 'findByDay', async (dayId) => [
    new ProgramExercise({ id: dayId * 10, program_day_id: dayId, exercise_id: 3, order_no: 1,
      sets: 3, reps_min: 8, reps_max: 12, rest_sec: 90, working_weight: 0 }),
  ]);
  const create = mock.method(Program, 'create', async (d) => d);

  const copy = await template.copyFor(42);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(copy.ownerId, 42);
  assert.equal(copy.isTemplate, false);
  assert.equal(copy.status, 'DRAFT');
  assert.deepEqual(copy.days.map((d) => [d.dayNumber, d.title, d.exercises.length]), [[1, 'День 1', 1], [2, 'День 2', 1]]);
  assert.deepEqual(copy.days[0].exercises[0],
    { exerciseId: 3, orderNo: 1, sets: 3, repsMin: 8, repsMax: 12, restSec: 90, workingWeight: 0 });
});

test('copyFor: личную программу копировать нельзя', async () => {
  const own = new Program({ id: 6, owner_id: 7, title: 'Моя', goal: 'GENERAL', level: 'BEGINNER',
    is_template: false, status: 'ACTIVE', created_at: new Date() });
  const create = mock.method(Program, 'create', async (d) => d);
  await assert.rejects(own.copyFor(42));
  assert.equal(create.mock.callCount(), 0);
});
