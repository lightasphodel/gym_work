import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ejs from 'ejs';

// Шаблоны проверяются без сервера и БД: меню зависит от роли из сессии.
const views = path.resolve(import.meta.dirname, '..', 'src', 'views');
const render = (file, locals) => ejs.renderFile(path.join(views, file), locals);

const layoutLocals = (currentUser, currentPath) => ({
  title: 'Проверка',
  body: '<p id="page-body">содержимое</p>',
  currentUser,
  currentPath,
});

test('layout: каркас страницы — шапка, main.page > .container, футер, nav.js', async () => {
  const html = await render('layouts/main.ejs', {
    ...layoutLocals(null, '/login'),
    pageClass: 'page--hero',
    scripts: ['/js/login.js'],
  });
  assert.match(html, /<title>Проверка — Тренировочный дневник<\/title>/);
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<button type="button" class="burger"[^>]*aria-controls="site-nav"/);
  assert.match(html, /<main class="page page--hero">\s*<div class="container">\s*<p id="page-body">/);
  assert.match(html, /<footer class="site-footer">/);
  assert.match(html, /src="\/js\/nav.js"/);
  assert.match(html, /src="\/js\/login.js"/);
});

test('nav: гость видит «Вход» и «Регистрация», без кнопки выхода', async () => {
  const html = await render('partials/nav.ejs', { currentUser: null, currentPath: '/login' });
  assert.match(html, /href="\/login" aria-current="page">Вход</);
  assert.match(html, /href="\/register">Регистрация</);
  assert.doesNotMatch(html, /logout-button/);
});

test('nav: пользователь видит свои пункты, логин и «Выйти»', async () => {
  const html = await render('partials/nav.ejs', {
    currentUser: { id: 2, login: 'ivan', role: 'USER' },
    currentPath: '/home',
  });
  assert.match(html, /href="\/home" aria-current="page">Главная</);
  assert.match(html, /<span class="nav__user">ivan<\/span>/);
  assert.match(html, /id="logout-button"/);
  assert.doesNotMatch(html, /\/admin/);
  assert.doesNotMatch(html, /href="\/login"/);
});

test('nav: администратор видит панель администратора', async () => {
  const html = await render('partials/nav.ejs', {
    currentUser: { id: 1, login: 'admin', role: 'ADMIN' },
    currentPath: '/admin',
  });
  assert.match(html, /href="\/admin" aria-current="page">Панель администратора</);
  assert.doesNotMatch(html, /href="\/home"/);
});

test('nav: логин экранируется', async () => {
  const html = await render('partials/nav.ejs', {
    currentUser: { id: 3, login: '<script>', role: 'USER' },
    currentPath: '/home',
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('layout: модуль выхода session.js подключается только для вошедшего пользователя', async () => {
  const guest = await render('layouts/main.ejs', layoutLocals(null, '/xyz'));
  const user = await render('layouts/main.ejs', layoutLocals({ id: 2, login: 'ivan', role: 'USER' }, '/xyz'));
  assert.doesNotMatch(guest, /session\.js/);
  assert.match(user, /src="\/js\/session.js"/);
});

// ---------- Этапы 5–7: меню, профиль, справочник, пользователи ----------

const dictionaries = await import('../src/config/dictionaries.js');
const pageLocals = {
  equipmentList: dictionaries.EQUIPMENT,
  goalNames: dictionaries.goalNames,
  levelNames: dictionaries.levelNames,
  difficultyNames: dictionaries.difficultyNames,
  roleNames: { USER: 'Пользователь', ADMIN: 'Администратор' },
  formatDate: (v) => (v ? new Date(v).toLocaleDateString('ru-RU') : ''),
};

test('nav: у пользователя есть «Профиль» и «Упражнения»; на карточке упражнения активен «Упражнения»', async () => {
  const html = await render('partials/nav.ejs', {
    currentUser: { id: 2, login: 'ivan', role: 'USER' },
    currentPath: '/exercises/5',
  });
  assert.match(html, /href="\/profile">Профиль</);
  assert.match(html, /href="\/exercises" aria-current="page">Упражнения</);
  assert.equal(html.match(/aria-current/g).length, 1);
});

test('nav: на /admin/users активен только пункт «Пользователи»', async () => {
  const html = await render('partials/nav.ejs', {
    currentUser: { id: 1, login: 'admin', role: 'ADMIN' },
    currentPath: '/admin/users',
  });
  assert.match(html, /href="\/admin\/users" aria-current="page">Пользователи</);
  assert.match(html, /href="\/admin">Панель администратора</);
  assert.equal(html.match(/aria-current/g).length, 1);
});

test('profile: ошибка поля — aria-invalid, сообщение и введённое значение сохраняются', async () => {
  const html = await render('profile.ejs', {
    ...pageLocals,
    form: { goal: 'STRENGTH', level: '', workoutsPerWeek: '9', equipment: ['гантели'], bodyWeight: '80' },
    errors: { workoutsPerWeek: 'Число тренировок в неделю — целое от 2 до 6' },
    saved: false,
    isNew: true,
  });
  assert.match(html, /name="workoutsPerWeek"[^>]*value="9" aria-invalid="true"/);
  assert.match(html, /id="workoutsPerWeek-error">Число тренировок/);
  assert.match(html, /<option value="STRENGTH" selected>/);
  assert.match(html, /value="гантели" checked/);
  assert.doesNotMatch(html, /value="штанга" checked/);
  assert.match(html, /class="alert alert--error"/);
});

test('profile: после сохранения — сообщение об успехе', async () => {
  const html = await render('profile.ejs', {
    ...pageLocals,
    form: { goal: 'GENERAL', level: 'BEGINNER', workoutsPerWeek: 3, equipment: [], bodyWeight: 70 },
    errors: {},
    saved: true,
    isNew: false,
  });
  assert.match(html, /alert--success[^>]*>Профиль сохранён/);
  assert.doesNotMatch(html, /aria-invalid="true"/);
});

test('admin-users: у своей записи нет кнопок, у заблокированного — «Разблокировать»', async () => {
  const html = await render('admin-users.ejs', {
    ...pageLocals,
    selfId: 1,
    message: '',
    users: [
      { id: 1, login: 'admin', email: 'a@x.ru', role: 'ADMIN', isBlocked: false, locked: false, createdAt: new Date() },
      { id: 2, login: 'ivan', email: 'i@x.ru', role: 'USER', isBlocked: true, locked: false, createdAt: new Date() },
      { id: 3, login: 'olga', email: 'o@x.ru', role: 'USER', isBlocked: false, locked: false, createdAt: new Date() },
    ],
  });
  assert.doesNotMatch(html, /\/admin\/users\/1\//);
  assert.match(html, /Это вы/);
  assert.match(html, /action="\/admin\/users\/2\/unblock"/);
  assert.doesNotMatch(html, /action="\/admin\/users\/2\/block"/);
  assert.match(html, /action="\/admin\/users\/3\/block"/);
  assert.match(html, /chip--error">Заблокирован</);
});

test('exercises: фильтр из строки запроса — некорректные значения отбрасываются', async () => {
  process.env.SESSION_SECRET ??= 'test-secret';
  const { parseExerciseFilter } = await import('../src/controllers/ExerciseController.js');
  assert.deepEqual(parseExerciseFilter({ muscle: '3', equipment: 'гантели', difficulty: '2' }),
    { muscleId: 3, equipment: 'гантели', difficulty: 2 });
  assert.deepEqual(parseExerciseFilter({ muscle: '0', equipment: 'гиря', difficulty: '9' }),
    { muscleId: null, equipment: null, difficulty: null });
  assert.deepEqual(parseExerciseFilter({ muscle: "1 OR 1=1", difficulty: ['1'] }),
    { muscleId: null, equipment: null, difficulty: null });
});

test('exercises: таблица со ссылками на карточки и сообщение о пустом результате', async () => {
  const base = { ...pageLocals, filter: { muscleId: null, equipment: null, difficulty: null }, muscles: [], muscleNames: { 1: 'Грудь' } };
  const html = await render('exercises.ejs', {
    ...base,
    exercises: [{ id: 4, name: 'Жим штанги лёжа', primaryMuscleId: 1, equipment: 'штанга', difficulty: 2 }],
  });
  assert.match(html, /<a href="\/exercises\/4">Жим штанги лёжа<\/a>/);
  assert.match(html, /<td>Грудь<\/td>/);
  assert.match(html, /<td>Средняя<\/td>/);
  const empty = await render('exercises.ejs', { ...base, exercises: [] });
  assert.match(empty, /Ничего не найдено/);
  assert.doesNotMatch(empty, /<table/);
});
