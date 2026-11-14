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
