import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Журнал тренировок (ФТ-17) и страница ошибок — без БД, модели подменяются mock.method.
process.env.SESSION_SECRET ??= 'test-secret';
const { WorkoutController } = await import('../src/controllers/WorkoutController.js');
const { errorHandler, HttpError } = await import('../src/middleware/errorHandler.js');
const { Workout, WorkoutSet } = await import('../src/models/index.js');

afterEach(() => mock.restoreAll());

const workoutOf = (userId, sets = [[1, 80, 8], [2, 80, 7]]) => new Workout(
  { id: 30, user_id: userId, program_day_id: 5, date: '2026-11-16', tonnage: 1200, is_completed: true },
  sets.map(([id, weight, reps], i) => new WorkoutSet({ id, workout_id: 30, program_exercise_id: 10, set_no: i + 1, weight, reps })),
);

function fakeRes() {
  return { redirect(url) { this.redirectedTo = url; } };
}

const req = (params, body = {}) => ({ user: { id: 7 }, params, body, query: {} });

test('updateSet: исправление веса и повторений, возврат в журнал к тренировке', async () => {
  mock.method(Workout, 'findById', async () => workoutOf(7));
  const update = mock.method(WorkoutSet.prototype, 'update', async () => {});
  const res = fakeRes();
  await WorkoutController.updateSet(req({ id: '30', setId: '2' }, { weight: '82,5', reps: '6', from: '2026-11-01', to: '2026-11-30' }), res);
  assert.deepEqual(update.mock.calls[0].arguments, [82.5, 6]);
  assert.equal(update.mock.calls[0].this.id, 2);
  assert.equal(res.redirectedTo, '/workouts?done=updated&from=2026-11-01&to=2026-11-30#workout-30');
});

test('updateSet: чужая тренировка и несуществующий подход — 404', async () => {
  mock.method(Workout, 'findById', async () => workoutOf(99));
  await assert.rejects(WorkoutController.updateSet(req({ id: '30', setId: '1' }, { weight: '80', reps: '8' }), fakeRes()), { status: 404 });
  mock.restoreAll();
  mock.method(Workout, 'findById', async () => workoutOf(7));
  await assert.rejects(WorkoutController.updateSet(req({ id: '30', setId: '77' }, { weight: '80', reps: '8' }), fakeRes()), { status: 404 });
});

test('updateSet: некорректные значения — 400, подход не меняется', async () => {
  mock.method(Workout, 'findById', async () => workoutOf(7));
  const update = mock.method(WorkoutSet.prototype, 'update', async () => {});
  for (const body of [{ weight: '-1', reps: '8' }, { weight: '80', reps: '0' }, { weight: '80', reps: '8.5' }, {}]) {
    await assert.rejects(WorkoutController.updateSet(req({ id: '30', setId: '1' }, body), fakeRes()), { status: 400 });
  }
  assert.equal(update.mock.callCount(), 0);
});

test('removeSet: единственный подход не удаляется — ошибка 409 из WorkoutSet.remove()', async () => {
  mock.method(Workout, 'findById', async () => workoutOf(7, [[1, 80, 8]]));
  mock.method(WorkoutSet.prototype, 'remove', async () => {
    throw new HttpError(409, 'Это единственный подход тренировки — удалите тренировку целиком');
  });
  await assert.rejects(WorkoutController.removeSet(req({ id: '30', setId: '1' }), fakeRes()), { status: 409 });
});

test('removeWorkout: тренировка удаляется целиком', async () => {
  const workout = workoutOf(7);
  mock.method(Workout, 'findById', async () => workout);
  const remove = mock.method(Workout.prototype, 'remove', async () => {});
  const res = fakeRes();
  await WorkoutController.removeWorkout(req({ id: '30' }), res);
  assert.equal(remove.mock.calls[0].this, workout);
  assert.equal(res.redirectedTo, '/workouts?done=workoutRemoved');
});

test('errorHandler: ошибка страницы — страница error с кодом и сообщением, для API — JSON', () => {
  const page = {
    originalUrl: '/workouts/30/sets/1/delete', method: 'POST',
  };
  const res = {
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    render(view, locals, cb) { this.view = view; this.locals = locals; cb(null, '<html>'); },
    send(body) { this.body = body; },
    type() { return this; },
    json(body) { this.body = body; },
  };
  errorHandler(new HttpError(409, 'Это единственный подход'), page, res, () => {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.view, 'error');
  assert.equal(res.locals.message, 'Это единственный подход');

  const apiRes = { ...res, view: undefined, body: undefined };
  errorHandler(new HttpError(400, 'Неверно'), { originalUrl: '/api/workouts', method: 'POST' }, apiRes, () => {});
  assert.deepEqual(apiRes.body, { error: 'Неверно' });
});
