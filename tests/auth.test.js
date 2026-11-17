import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

// Этап 13: регистрация и вход (ФТ-01, ФТ-02) — модель User подменяется, БД не нужна.
process.env.SESSION_SECRET ??= 'test-secret';
const { AuthController } = await import('../src/controllers/AuthController.js');
const { registerRules, loginRules } = await import('../src/middleware/validate.js');
const { User } = await import('../src/models/index.js');

afterEach(() => mock.restoreAll());

const PASSWORD = 'Secret123';
const hash = bcrypt.hashSync(PASSWORD, 4); // низкая стоимость — только для скорости теста

function userRow(overrides = {}) {
  return {
    id: 5, login: 'ivan', email: 'ivan@example.com', password_hash: hash, role: 'USER',
    is_blocked: false, failed_logins: 0, locked_until: null, created_at: new Date(), ...overrides,
  };
}

function fakeReq(body) {
  const session = {
    regenerated: false,
    regenerate(cb) { this.regenerated = true; cb(); },
    save(cb) { cb(); },
  };
  return { body, session };
}

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
}

async function loginError(body) {
  try {
    await AuthController.login(fakeReq(body), fakeRes());
  } catch (err) {
    return err;
  }
  return null;
}

// ---------- ФТ-01. Регистрация ----------

test('registerRules: корректные данные — без ошибок', () => {
  assert.deepEqual(registerRules({ login: 'ivan_1', email: 'ivan@example.com', password: PASSWORD }), []);
});

test('registerRules: недопустимый логин, e-mail и слабый пароль — сообщение по каждому полю', () => {
  const errors = registerRules({ login: 'ив', email: 'ivan@', password: 'abcdefgh' });
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Логин/);
  assert.match(errors[1], /электронной почты/);
  assert.match(errors[2], /букву и одну цифру/);
  assert.ok(registerRules({ login: 'ivan', email: 'ivan@example.com', password: 'Ab1' })
    .some((e) => /не менее/.test(e)));
});

test('register: роль всегда USER, e-mail приводится к нижнему регистру, ответ 201 без хеша пароля', async () => {
  const created = mock.method(User, 'create', async (data) => new User(userRow({ ...data, password_hash: hash })));
  const res = fakeRes();
  await AuthController.register(
    { body: { login: 'ivan', email: ' Ivan@Example.COM ', password: PASSWORD, role: 'ADMIN' } }, res);
  assert.equal(created.mock.calls[0].arguments[0].role, 'USER');
  assert.equal(created.mock.calls[0].arguments[0].email, 'ivan@example.com');
  assert.equal(res.statusCode, 201);
  assert.ok(!JSON.stringify(res.body).includes(hash));
});

test('register: занятый логин — 409 «Пользователь с таким логином уже зарегистрирован»', async () => {
  mock.method(User, 'create', async () => {
    throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_login_ak' });
  });
  await assert.rejects(
    AuthController.register({ body: { login: 'ivan', email: 'x@example.com', password: PASSWORD } }, fakeRes()),
    { status: 409, message: /логином уже зарегистрирован/ },
  );
});

test('register: занятый e-mail — 409', async () => {
  mock.method(User, 'create', async () => {
    throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_email_ak' });
  });
  await assert.rejects(
    AuthController.register({ body: { login: 'petr', email: 'ivan@example.com', password: PASSWORD } }, fakeRes()),
    { status: 409, message: /электронной почты уже используется/ },
  );
});

// ---------- ФТ-02. Авторизация ----------

test('loginRules: пустые логин и пароль — две ошибки', () => {
  assert.equal(loginRules({ login: '  ', password: '' }).length, 2);
});

test('login: верный пароль — новая сессия с ролью, счётчик неудач сброшен, переход на стартовую страницу', async () => {
  mock.method(User, 'findByLogin', async () => new User(userRow({ role: 'ADMIN' })));
  const reset = mock.method(User.prototype, 'resetFailedLogins', async () => {});
  const req = fakeReq({ login: ' ivan ', password: PASSWORD });
  const res = fakeRes();
  await AuthController.login(req, res);
  assert.equal(reset.mock.callCount(), 1);
  assert.equal(req.session.regenerated, true);
  assert.deepEqual(req.session.user, { id: 5, login: 'ivan', role: 'ADMIN' });
  assert.equal(res.body.redirect, '/admin');
});

test('login: неверный пароль — 401 с тем же сообщением, что и для неизвестного логина; попытка учтена', async () => {
  mock.method(User, 'findByLogin', async () => new User(userRow()));
  const failed = mock.method(User.prototype, 'registerFailedLogin', async () => {});
  const err = await loginError({ login: 'ivan', password: 'Wrong1234' });
  assert.equal(err.status, 401);
  assert.equal(err.message, 'Неверный логин или пароль');
  assert.equal(failed.mock.callCount(), 1);
});

test('login: действующая временная блокировка — 429, пароль не проверяется', async () => {
  mock.method(User, 'findByLogin', async () =>
    new User(userRow({ locked_until: new Date(Date.now() + 10 * 60_000) })));
  const check = mock.method(User.prototype, 'checkPassword', async () => true);
  const err = await loginError({ login: 'ivan', password: PASSWORD });
  assert.equal(err.status, 429);
  assert.equal(check.mock.callCount(), 0);
});

test('login: блокировка истекла — вход выполняется', async () => {
  mock.method(User, 'findByLogin', async () =>
    new User(userRow({ locked_until: new Date(Date.now() - 60_000) })));
  mock.method(User.prototype, 'resetFailedLogins', async () => {});
  const res = fakeRes();
  await AuthController.login(fakeReq({ login: 'ivan', password: PASSWORD }), res);
  assert.equal(res.body.redirect, '/home');
});

test('login: учётная запись заблокирована администратором — 403 даже при верном пароле, сессия не создаётся', async () => {
  mock.method(User, 'findByLogin', async () => new User(userRow({ is_blocked: true })));
  mock.method(User.prototype, 'resetFailedLogins', async () => {});
  const req = fakeReq({ login: 'ivan', password: PASSWORD });
  await assert.rejects(AuthController.login(req, fakeRes()), { status: 403, message: /заблокирована/ });
  assert.equal(req.session.regenerated, false);
  assert.equal(req.session.user, undefined);
});
