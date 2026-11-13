import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlain } from '../src/utils/toPlain.js';

// Модели импортируют конфигурацию, которая требует SESSION_SECRET; к БД тесты не обращаются.
process.env.SESSION_SECRET ??= 'test-secret';
const { User, ExerciseMedia, Workout, WorkoutSet } = await import('../src/models/index.js');

const userRow = {
  id: 7,
  login: 'ivan',
  email: 'ivan@example.com',
  password_hash: '$2b$12$secretsecretsecretsecretsecretsecretsecretsecretsec',
  role: 'USER',
  is_blocked: false,
  failed_logins: 3,
  locked_until: null,
  created_at: new Date('2026-11-01T10:00:00Z'),
};

test('JSON.stringify(user) даёт {}: атрибуты модели закрыты', () => {
  assert.equal(JSON.stringify(new User(userRow)), '{}');
});

test('toPlain(user): только get-аксессоры, без passwordHash, failedLogins, lockedUntil', () => {
  const plain = toPlain(new User(userRow));
  assert.deepEqual(plain, {
    id: 7,
    login: 'ivan',
    email: 'ivan@example.com',
    role: 'USER',
    isBlocked: false,
    createdAt: userRow.created_at,
  });
  assert.ok(!('passwordHash' in plain));
  assert.ok(!('failedLogins' in plain));
  assert.ok(!('lockedUntil' in plain));
  assert.ok(!JSON.stringify(plain).includes(userRow.password_hash));
});

test('у модели нет сеттеров: присваивание атрибуту — TypeError', () => {
  const user = new User(userRow);
  assert.throws(() => {
    user.role = 'ADMIN';
  }, TypeError);
  assert.equal(user.role, 'USER');
});

test('toPlain(media): двоичные данные (Buffer) пропускаются', () => {
  const media = new ExerciseMedia({
    id: 1,
    exercise_id: 2,
    media_type: 'image',
    mime_type: 'image/png',
    data: Buffer.from([1, 2, 3]),
  });
  assert.deepEqual(toPlain(media), { id: 1, exerciseId: 2, mediaType: 'image', mimeType: 'image/png' });
});

test('toPlain: массив моделей и вложенные модели', () => {
  const sets = [
    new WorkoutSet({ id: 1, workout_id: 5, program_exercise_id: 9, set_no: 1, weight: 80, reps: 8 }),
    new WorkoutSet({ id: 2, workout_id: 5, program_exercise_id: 9, set_no: 2, weight: 80, reps: 7 }),
  ];
  const workout = new Workout(
    { id: 5, user_id: 7, program_day_id: 3, date: '2026-11-13', tonnage: 1200, is_completed: true },
    sets,
  );
  const [plain] = toPlain([workout]);
  assert.equal(plain.id, 5);
  assert.equal(plain.tonnage, 1200);
  assert.deepEqual(plain.sets[1], {
    id: 2, workoutId: 5, programExerciseId: 9, setNo: 2, weight: 80, reps: 7,
  });
});

test('toPlain: примитивы, Date и простые объекты возвращаются как есть', () => {
  const date = new Date();
  const obj = { a: 1 };
  assert.equal(toPlain(5), 5);
  assert.equal(toPlain(null), null);
  assert.equal(toPlain(date), date);
  assert.equal(toPlain(obj), obj);
});
