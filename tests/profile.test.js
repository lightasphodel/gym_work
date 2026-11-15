import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Проверка анкеты профиля (ФТ-03) и сохранения без БД: модели подменяются mock.method.
process.env.SESSION_SECRET ??= 'test-secret';
const { parseProfile } = await import('../src/middleware/validate.js');
const { ProfileController } = await import('../src/controllers/ProfileController.js');
const { TrainingProfile } = await import('../src/models/index.js');

const valid = {
  goal: 'HYPERTROPHY',
  level: 'BEGINNER',
  workoutsPerWeek: '3',
  equipment: ['штанга', 'гантели'],
  bodyWeight: '72.5',
};

afterEach(() => mock.restoreAll());

test('parseProfile: корректная анкета — без ошибок, числа приведены', () => {
  const { data, errors } = parseProfile(valid);
  assert.deepEqual(errors, {});
  assert.deepEqual(data, {
    goal: 'HYPERTROPHY',
    level: 'BEGINNER',
    workoutsPerWeek: 3,
    equipment: ['штанга', 'гантели'],
    bodyWeight: 72.5,
  });
});

test('parseProfile: тренировок в неделю — целое от 2 до 6', () => {
  for (const v of ['1', '7', '2.5', '', 'три']) {
    assert.ok(parseProfile({ ...valid, workoutsPerWeek: v }).errors.workoutsPerWeek, `значение «${v}»`);
  }
  for (const v of ['2', '6']) {
    assert.equal(parseProfile({ ...valid, workoutsPerWeek: v }).errors.workoutsPerWeek, undefined);
  }
});

test('parseProfile: один отмеченный чекбокс (строка) превращается в массив', () => {
  const { data, errors } = parseProfile({ ...valid, equipment: 'собственный вес' });
  assert.deepEqual(errors, {});
  assert.deepEqual(data.equipment, ['собственный вес']);
});

test('parseProfile: инвентарь обязателен и только из списка', () => {
  assert.ok(parseProfile({ ...valid, equipment: undefined }).errors.equipment);
  assert.ok(parseProfile({ ...valid, equipment: ['штанга', 'гиря'] }).errors.equipment);
});

test('parseProfile: масса тела с запятой, границы 30–300 кг', () => {
  assert.equal(parseProfile({ ...valid, bodyWeight: '72,5' }).data.bodyWeight, 72.5);
  assert.equal(parseProfile({ ...valid, bodyWeight: '72,5' }).errors.bodyWeight, undefined);
  for (const v of ['29.99', '300.01', '0', '-70', '70.123', 'abc', '']) {
    assert.ok(parseProfile({ ...valid, bodyWeight: v }).errors.bodyWeight, `значение «${v}»`);
  }
});

test('parseProfile: цель и уровень — только значения перечислений', () => {
  const { errors } = parseProfile({ ...valid, goal: 'FAT_LOSS', level: '' });
  assert.ok(errors.goal);
  assert.ok(errors.level);
});

/** Минимальная замена объекта ответа Express. */
function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; },
    redirect(url) { this.redirectedTo = url; },
  };
}

const req = (body) => ({ user: { id: 7 }, body, query: {} });

test('ProfileController.save: первый раз — TrainingProfile.create', async () => {
  mock.method(TrainingProfile, 'findByUser', async () => null);
  const created = mock.method(TrainingProfile, 'create', async (d) => d);
  const updated = mock.method(TrainingProfile.prototype, 'update', async () => {});

  const res = fakeRes();
  await ProfileController.save(req(valid), res);

  assert.equal(created.mock.callCount(), 1);
  assert.equal(updated.mock.callCount(), 0);
  assert.equal(created.mock.calls[0].arguments[0].userId, 7);
  assert.equal(created.mock.calls[0].arguments[0].workoutsPerWeek, 3);
  assert.equal(res.redirectedTo, '/profile?saved=1');
});

test('ProfileController.save: профиль уже есть — update', async () => {
  const existing = new TrainingProfile({
    id: 1, user_id: 7, goal: 'GENERAL', level: 'BEGINNER',
    workouts_per_week: 2, equipment: ['тренажёр'], body_weight: 70,
  });
  mock.method(TrainingProfile, 'findByUser', async () => existing);
  const created = mock.method(TrainingProfile, 'create', async (d) => d);
  const updated = mock.method(TrainingProfile.prototype, 'update', async () => {});

  const res = fakeRes();
  await ProfileController.save(req(valid), res);

  assert.equal(created.mock.callCount(), 0);
  assert.equal(updated.mock.callCount(), 1);
  assert.equal(updated.mock.calls[0].this, existing);
  assert.deepEqual(updated.mock.calls[0].arguments[0].equipment, ['штанга', 'гантели']);
  assert.equal(res.redirectedTo, '/profile?saved=1');
});

test('ProfileController.save: ошибка в анкете — 400, форма с введёнными значениями, ничего не сохраняется', async () => {
  mock.method(TrainingProfile, 'findByUser', async () => null);
  const created = mock.method(TrainingProfile, 'create', async (d) => d);

  const res = fakeRes();
  await ProfileController.save(req({ ...valid, workoutsPerWeek: '9' }), res);

  assert.equal(created.mock.callCount(), 0);
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'profile');
  assert.ok(res.locals.errors.workoutsPerWeek);
  assert.equal(res.locals.form.workoutsPerWeek, '9');
  assert.equal(res.redirectedTo, undefined);
});
