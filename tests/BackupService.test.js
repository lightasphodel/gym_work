import { test, mock, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';

// BackupService без PostgreSQL: execFile подменяется (имитация pg_dump / pg_restore),
// журнал BackupLog — mock.method; каталог копий — временный.
const KEY = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET ??= 'test-secret';
process.env.BACKUP_KEY = KEY;
process.env.DB_PASSWORD = 'secret-db-password';
const { BackupService, BackupType, BackupStatus } = await import('../src/services/BackupService.js');
const { BackupLog } = await import('../src/models/index.js');

const DUMP = Buffer.from('PGDMP — содержимое дампа для проверки '.repeat(50));
let dir;

before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-backup-')); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  mock.restoreAll();
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
});

const logRow = (over) => new BackupLog({ id: 1, admin_id: 1, file_name: 'x', type: 'MANUAL', created_at: new Date(), status: 'SUCCESS', ...over });

/** Подмена execFile: pg_dump пишет DUMP в файл --file, pg_restore сохраняет полученный файл. */
function mockTools({ failDump = false } = {}) {
  const calls = [];
  const restored = [];
  mock.method(childProcess, 'execFile', (file, args, options, cb) => {
    calls.push({ file, args, options });
    if (path.basename(file).startsWith('pg_dump')) {
      if (failDump) return cb(Object.assign(new Error('pg_dump failed'), { code: 1 }), '', 'connection refused');
      fs.writeFileSync(args[args.indexOf('--file') + 1], DUMP);
    } else {
      restored.push(fs.readFileSync(args.at(-1)));
    }
    cb(null, '', '');
  });
  return { calls, restored };
}

test('createBackup: pg_dump через execFile без shell, пароль только в окружении, файл зашифрован', async () => {
  const { calls } = mockTools();
  const created = mock.method(BackupLog, 'create', async (d) => logRow({ file_name: d.fileName, type: d.type, status: d.status }));
  const log = await new BackupService({ backupDir: dir }).createBackup(5);

  const [call] = calls;
  assert.match(path.basename(call.file), /^pg_dump/);
  assert.equal(call.options.shell, undefined, 'без командной оболочки');
  assert.ok(call.args.includes('--format=custom') && call.args.includes('--exclude-table=session'));
  assert.ok(!call.args.join(' ').includes('secret-db-password'), 'пароля нет в аргументах');
  assert.equal(call.options.env.PGPASSWORD, 'secret-db-password');

  assert.deepEqual(created.mock.calls[0].arguments[0],
    { adminId: 5, fileName: log.fileName, type: BackupType.MANUAL, status: BackupStatus.SUCCESS });
  assert.match(log.fileName, /^fitness_db_\d{8}_\d{6}\.dump\.enc$/);
  assert.deepEqual(fs.readdirSync(dir), [log.fileName], 'временный файл удалён');

  const enc = fs.readFileSync(path.join(dir, log.fileName));
  assert.equal(enc.subarray(0, 5).toString('latin1'), 'FDBK1');
  assert.ok(!enc.includes(Buffer.from('PGDMP')), 'содержимое дампа не хранится открыто');
  const iv = enc.subarray(5, 17);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), iv);
  decipher.setAuthTag(enc.subarray(-16));
  assert.ok(Buffer.concat([decipher.update(enc.subarray(17, -16)), decipher.final()]).equals(DUMP));
});

test('createBackup: ошибка pg_dump — запись ERROR в журнале, файлов не остаётся', async () => {
  mockTools({ failDump: true });
  const created = mock.method(BackupLog, 'create', async (d) => logRow(d));
  await assert.rejects(new BackupService({ backupDir: dir }).createBackup(5), { status: 500 });
  assert.equal(created.mock.calls[0].arguments[0].status, BackupStatus.ERROR);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('restore: недопустимые имена и обход пути — отказ без запуска pg_restore', async () => {
  const { calls } = mockTools();
  const service = new BackupService({ backupDir: dir });
  for (const name of ['../.env', '..\\fitness_db_20261117_120000.dump.enc', 'fitness_db_20261117_120000.dump',
    '/etc/passwd', 'fitness_db_x.dump.enc', '', null]) {
    await assert.rejects(service.restore(name), { status: 400 }, String(name));
  }
  await assert.rejects(service.restore('fitness_db_20261117_120000.dump.enc'), { status: 404 });
  assert.equal(calls.length, 0);
});

test('restore: расшифровка и pg_restore --clean --single-transaction с исходным дампом', async () => {
  const { restored, calls } = mockTools();
  mock.method(BackupLog, 'create', async (d) => logRow({ file_name: d.fileName, type: d.type }));
  const service = new BackupService({ backupDir: dir });
  const log = await service.createBackup(5);

  mock.method(BackupLog, 'findAll', async () => [logRow({ file_name: log.fileName })]);
  await service.restore(log.fileName);
  const restoreCall = calls.find((c) => path.basename(c.file).startsWith('pg_restore'));
  for (const flag of ['--clean', '--if-exists', '--single-transaction']) assert.ok(restoreCall.args.includes(flag), flag);
  assert.ok(restored[0].equals(DUMP), 'pg_restore получил расшифрованный дамп');
  assert.deepEqual(fs.readdirSync(dir), [log.fileName], 'расшифрованный временный файл удалён');
});

test('restore: подменённый файл копии не восстанавливается', async () => {
  const { calls } = mockTools();
  mock.method(BackupLog, 'create', async (d) => logRow({ file_name: d.fileName }));
  mock.method(BackupLog, 'findAll', async () => []);
  const service = new BackupService({ backupDir: dir });
  const log = await service.createBackup(5);
  const file = path.join(dir, log.fileName);
  const data = fs.readFileSync(file);
  data[30] ^= 0xff; // изменён один байт шифртекста
  fs.writeFileSync(file, data);

  await assert.rejects(service.restore(log.fileName), { status: 400 });
  assert.ok(!calls.some((c) => path.basename(c.file).startsWith('pg_restore')));
  assert.deepEqual(fs.readdirSync(dir), [log.fileName]);
});

test('restore: записи о более поздних копиях возвращаются в журнал', async () => {
  mockTools();
  const service = new BackupService({ backupDir: dir });
  mock.method(BackupLog, 'create', async (d) => logRow({ file_name: d.fileName }));
  const restoredCopy = (await service.createBackup(1)).fileName;
  const later = 'fitness_db_20991231_235959.dump.enc'; // копия, сделанная после восстанавливаемой
  fs.writeFileSync(path.join(dir, later), 'x');
  mock.restoreAll();
  mockTools();

  // Журнал до восстановления — обе копии; после (данные из старой копии) — только первая.
  const journals = [
    [logRow({ id: 2, file_name: later, admin_id: 3 }), logRow({ id: 1, file_name: restoredCopy })],
    [logRow({ id: 1, file_name: restoredCopy })],
  ];
  let call = 0;
  mock.method(BackupLog, 'findAll', async () => journals[Math.min(call++, 1)]);
  const created = mock.method(BackupLog, 'create', async (d) => logRow(d));
  await service.restore(restoredCopy);
  assert.deepEqual(created.mock.calls.map((c) => c.arguments[0]),
    [{ adminId: 3, fileName: later, type: 'MANUAL', status: 'SUCCESS' }]);
});

test('listBackups: только успешные копии, файлы которых есть в каталоге', async () => {
  fs.writeFileSync(path.join(dir, 'fitness_db_20261117_100000.dump.enc'), 'x');
  mock.method(BackupLog, 'findAll', async () => [
    logRow({ id: 4, file_name: 'fitness_db_20261117_100000.dump.enc', type: 'RESTORE' }),
    logRow({ id: 3, file_name: 'fitness_db_20261117_120000.dump.enc' }), // файла нет
    logRow({ id: 2, file_name: 'fitness_db_20261117_100000.dump.enc', type: 'SCHEDULED' }),
    logRow({ id: 1, file_name: 'fitness_db_20261117_110000.dump.enc', status: 'ERROR' }),
  ]);
  const list = await new BackupService({ backupDir: dir }).listBackups();
  assert.deepEqual(list.map((l) => l.id), [2]);
});

test('расписание: некорректное выражение cron — ошибка при включении', () => {
  assert.throws(() => new BackupService({ backupDir: dir, schedule: 'каждый день', scheduledBy: async () => 1 }));
});
