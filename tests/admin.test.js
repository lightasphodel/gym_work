import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Блокировка пользователей администратором (ФТ-18) без БД: User.findById и методы подменяются.
process.env.SESSION_SECRET ??= 'test-secret';
const { AdminController } = await import('../src/controllers/AdminController.js');
const { User } = await import('../src/models/index.js');

const userRow = (id, login, isBlocked = false, role = 'USER') => ({
  id, login, email: `${login}@example.com`, password_hash: 'x', role,
  is_blocked: isBlocked, failed_logins: 0, locked_until: null, created_at: new Date(),
});

const admin = new User(userRow(1, 'admin', false, 'ADMIN'));

function fakeRes() {
  return { redirect(url) { this.redirectedTo = url; } };
}

const req = (id) => ({ user: admin, params: { id: String(id) }, query: {} });

afterEach(() => mock.restoreAll());

test('block: пользователь блокируется, переход к списку с сообщением', async () => {
  const target = new User(userRow(2, 'ivan'));
  mock.method(User, 'findById', async () => target);
  const block = mock.method(User.prototype, 'block', async () => {});

  const res = fakeRes();
  await AdminController.block(req(2), res);

  assert.equal(block.mock.callCount(), 1);
  assert.equal(block.mock.calls[0].this, target);
  assert.equal(res.redirectedTo, '/admin/users?done=blocked&login=ivan');
});

test('block: свою учётную запись заблокировать нельзя — 400, block() не вызывается', async () => {
  mock.method(User, 'findById', async () => new User(userRow(1, 'admin', false, 'ADMIN')));
  const block = mock.method(User.prototype, 'block', async () => {});

  await assert.rejects(AdminController.block(req(1), fakeRes()), { status: 400 });
  assert.equal(block.mock.callCount(), 0);
});

test('block: повторная блокировка не меняет запись', async () => {
  mock.method(User, 'findById', async () => new User(userRow(2, 'ivan', true)));
  const block = mock.method(User.prototype, 'block', async () => {});

  const res = fakeRes();
  await AdminController.block(req(2), res);

  assert.equal(block.mock.callCount(), 0);
  assert.equal(res.redirectedTo, '/admin/users?done=already&login=ivan');
});

test('unblock: вызывается User.unblock()', async () => {
  mock.method(User, 'findById', async () => new User(userRow(2, 'ivan', true)));
  const unblock = mock.method(User.prototype, 'unblock', async () => {});

  const res = fakeRes();
  await AdminController.unblock(req(2), res);

  assert.equal(unblock.mock.callCount(), 1);
  assert.equal(res.redirectedTo, '/admin/users?done=unblocked&login=ivan');
});

test('block/unblock: несуществующий или некорректный id — 404 без обращения к БД для некорректного', async () => {
  const findById = mock.method(User, 'findById', async () => null);

  await assert.rejects(AdminController.block(req(999), fakeRes()), { status: 404 });
  await assert.rejects(AdminController.unblock(req('abc'), fakeRes()), { status: 404 });
  assert.equal(findById.mock.callCount(), 1);
});
