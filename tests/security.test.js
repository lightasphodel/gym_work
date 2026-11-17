import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Этап 12: вход не раскрывает существование логина; восстановление копии требует подтверждения.
process.env.SESSION_SECRET ??= 'test-secret';
const { AuthController, isUnknownLoginLocked, registerUnknownLogin } = await import('../src/controllers/AuthController.js');
const { AdminController } = await import('../src/controllers/AdminController.js');
const { BackupService } = await import('../src/services/BackupService.js');
const { User, BackupLog } = await import('../src/models/index.js');

afterEach(() => mock.restoreAll());

test('неизвестный логин: после 5 неудачных попыток — та же временная блокировка (429), что и у существующего', async () => {
  mock.method(User, 'findByLogin', async () => null);
  const login = `ghost_${Date.now()}`;
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    try {
      await AuthController.login({ body: { login, password: 'wrong-password-1' } }, {});
    } catch (err) {
      statuses.push(err.status);
    }
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 429, 429]);
});

test('неизвестный логин: блокировка снимается через 15 минут, регистр логина не важен', () => {
  const login = `Ghost_${Date.now()}`;
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i += 1) registerUnknownLogin(login, t0);
  assert.equal(isUnknownLoginLocked(login.toLowerCase(), t0 + 60_000), true);
  assert.equal(isUnknownLoginLocked(login, t0 + 15 * 60_000 + 1), false);
});

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; },
    redirect(url) { this.redirectedTo = url; },
  };
}

function mockBackupPage() {
  mock.method(BackupService.prototype, 'listBackups', async () => []);
  mock.method(BackupLog, 'findAll', async () => []);
  mock.method(User, 'findAll', async () => []);
}

test('восстановление без подтверждения — 400, pg_restore не запускается', async () => {
  mockBackupPage();
  const restore = mock.method(BackupService.prototype, 'restore', async () => {});
  const res = fakeRes();
  await AdminController.backupRestore(
    { user: { id: 1 }, body: { fileName: 'fitness_db_20261117_120000.dump.enc' }, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.locals.error, /Подтвердите восстановление/);
  assert.equal(restore.mock.callCount(), 0);
});

test('восстановление с подтверждением — restore и запись RESTORE в журнал от имени администратора', async () => {
  mockBackupPage();
  const restore = mock.method(BackupService.prototype, 'restore', async () => {});
  const created = mock.method(BackupLog, 'create', async (d) => d);
  const res = fakeRes();
  const fileName = 'fitness_db_20261117_120000.dump.enc';
  await AdminController.backupRestore({ user: { id: 7 }, body: { fileName, confirm: 'yes' }, query: {} }, res);
  assert.deepEqual(restore.mock.calls[0].arguments, [fileName]);
  assert.deepEqual(created.mock.calls[0].arguments[0], { adminId: 7, fileName, type: 'RESTORE', status: 'SUCCESS' });
  assert.match(res.redirectedTo, /done=restored/);
});

test('ошибка восстановления — запись ERROR в журнал и сообщение на странице', async () => {
  mockBackupPage();
  mock.method(BackupService.prototype, 'restore', async () => {
    throw Object.assign(new Error('Не удалось восстановить базу данных из копии; данные не изменены'), { status: 500 });
  });
  const created = mock.method(BackupLog, 'create', async (d) => d);
  const res = fakeRes();
  await AdminController.backupRestore(
    { user: { id: 7 }, body: { fileName: 'fitness_db_20261117_120000.dump.enc', confirm: 'yes' }, query: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(created.mock.calls[0].arguments[0].status, 'ERROR');
  assert.match(res.locals.error, /данные не изменены/);
});
