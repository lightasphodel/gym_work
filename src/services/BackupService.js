import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import cron from 'node-cron';
import { config } from '../config/config.js';
import { BackupLog } from '../models/index.js';

/** Вид операции в журнале резервного копирования (backup_logs.type). */
export const BackupType = Object.freeze({
  MANUAL: 'MANUAL', // копия по запросу администратора
  SCHEDULED: 'SCHEDULED', // копия по расписанию
  RESTORE: 'RESTORE', // восстановление (запись делает AdminController)
});

/** Результат операции (backup_logs.status). */
export const BackupStatus = Object.freeze({ SUCCESS: 'SUCCESS', ERROR: 'ERROR' });

/** Имя файла копии: fitness_db_ГГГГММДД_ЧЧММСС[_N].dump.enc — только такие файлы восстанавливаются. */
const FILE_PATTERN = /^fitness_db_\d{8}_\d{6}(?:_\d{1,3})?\.dump\.enc$/;

/** Формат зашифрованного файла: метка (5 Б) + IV (12 Б) + шифртекст + тег GCM (16 Б). */
const MAGIC = Buffer.from('FDBK1', 'latin1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Контекст запуска по расписанию: createBackup определяет по нему вид копии. */
const scheduledRun = new AsyncLocalStorage();

/** Одновременно выполняется одна операция копирования или восстановления. */
let busy = false;

function userError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Путь к утилите PostgreSQL (каталог PG_BIN_DIR или PATH). */
function tool(name) {
  return config.backup.pgBinDir ? path.join(config.backup.pgBinDir, name) : name;
}

/** Параметры подключения: пароль — через переменную окружения, а не в аргументах. */
function pgArgs() {
  return ['--host', config.db.host, '--port', String(config.db.port), '--username', config.db.user];
}
function pgEnv() {
  return { ...process.env, PGPASSWORD: config.db.password ?? '' };
}

/** Запуск утилиты через execFile (без командной оболочки). */
function run(file, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { env: pgEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr ?? '').trim();
          return reject(err);
        }
        resolve(stdout);
      });
  });
}

/** Ключ AES-256 из BACKUP_KEY (64 шестнадцатеричных символа). */
function encryptionKey() {
  const hex = config.backup.key ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw userError(500, 'Не задан ключ шифрования резервных копий BACKUP_KEY (64 шестнадцатеричных символа)');
  }
  return Buffer.from(hex, 'hex');
}

/** Шифрование файла AES-256-GCM (потоком). */
async function encryptFile(src, dest, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false });
  await new Promise((resolve, reject) => {
    out.on('error', reject);
    out.end(cipher.getAuthTag(), resolve);
  });
}

/** Расшифровка с проверкой тега GCM: подменённый файл или чужой ключ — ошибка 400. */
async function decryptFile(src, dest, key) {
  const { size } = await fsp.stat(src);
  const headerLength = MAGIC.length + IV_LENGTH;
  if (size < headerLength + TAG_LENGTH) throw userError(400, 'Файл резервной копии повреждён');
  const handle = await fsp.open(src, 'r');
  const header = Buffer.alloc(headerLength);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    await handle.read(header, 0, headerLength, 0);
    await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw userError(400, 'Файл не является резервной копией приложения');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(src, { start: headerLength, end: size - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(dest, { mode: 0o600 }),
    );
  } catch {
    await fsp.rm(dest, { force: true });
    throw userError(400, 'Файл резервной копии повреждён или зашифрован другим ключом');
  }
}

/** Имя нового файла копии по местному времени (без совпадений с существующими). */
function newFileName(dir) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = `fitness_db_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let name = `${base}.dump.enc`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i += 1) name = `${base}_${i}.dump.enc`;
  return name;
}

/**
 * Резервное копирование и восстановление БД утилитами pg_dump / pg_restore (ФТ-15).
 * Файлы копий шифруются AES-256-GCM ключом BACKUP_KEY; каждая операция записывается в журнал BackupLog.
 */
export class BackupService {
  #backupDir;
  #schedule;

  /**
   * @param {{backupDir?: string, schedule?: string, scheduledBy?: () => Promise<number|null>}} [options]
   *   scheduledBy — включить копирование по расписанию #schedule (node-cron); функция возвращает
   *   id администратора, от имени которого запись попадает в журнал.
   */
  constructor({ backupDir = config.backup.dir, schedule = config.backup.schedule, scheduledBy = null } = {}) {
    this.#backupDir = backupDir;
    this.#schedule = schedule;
    if (scheduledBy) {
      if (!cron.validate(this.#schedule)) {
        throw new Error(`Некорректное расписание резервного копирования BACKUP_SCHEDULE: «${this.#schedule}»`);
      }
      cron.schedule(this.#schedule, async () => {
        try {
          const adminId = await scheduledBy();
          if (!adminId) {
            console.warn('[Резервное копирование] Нет активного администратора — копия по расписанию пропущена');
            return;
          }
          const log = await scheduledRun.run(true, () => this.createBackup(adminId));
          console.log(`[Резервное копирование] Создана копия по расписанию: ${log.fileName}`);
        } catch (err) {
          console.error(`[Резервное копирование] Ошибка копии по расписанию: ${err.message}`);
        }
      });
    }
  }

  /**
   * Создание резервной копии: pg_dump (формат custom, без таблицы сессий) во временный файл,
   * шифрование AES-256-GCM в каталог копий, запись в журнал. При ошибке в журнал
   * пишется запись со статусом ERROR, а временные файлы удаляются.
   * @param {number} adminId администратор, выполнивший (или от имени которого выполнена) операция
   * @returns {Promise<BackupLog>} запись журнала о созданной копии
   * @throws {Error} status 409 — выполняется другая операция; 500 — ошибка pg_dump или нет ключа
   */
  async createBackup(adminId) {
    if (busy) throw userError(409, 'Уже выполняется резервное копирование или восстановление. Повторите позже');
    busy = true;
    const type = scheduledRun.getStore() ? BackupType.SCHEDULED : BackupType.MANUAL;
    let fileName = '';
    let target = '';
    let tmp = '';
    try {
      await fsp.mkdir(this.#backupDir, { recursive: true });
      fileName = newFileName(this.#backupDir);
      target = path.join(this.#backupDir, fileName);
      tmp = path.join(this.#backupDir, `.${fileName}.tmp`);
      const key = encryptionKey();
      await run(tool('pg_dump'), [
        ...pgArgs(), '--format=custom', '--exclude-table=session', '--no-owner', '--no-privileges',
        '--file', tmp, config.db.database,
      ]);
      await encryptFile(tmp, target, key);
      return await BackupLog.create({ adminId, fileName, type, status: BackupStatus.SUCCESS });
    } catch (err) {
      if (target) await fsp.rm(target, { force: true });
      await BackupLog.create({ adminId, fileName: fileName || '—', type, status: BackupStatus.ERROR }).catch(() => {});
      if (err.status) throw err;
      console.error('[Резервное копирование] pg_dump:', err.stderr || err.message);
      throw userError(500, 'Не удалось создать резервную копию');
    } finally {
      if (tmp) await fsp.rm(tmp, { force: true });
      busy = false;
    }
  }

  /**
   * Восстановление БД из копии: проверка имени файла (только копии из каталога), расшифровка
   * с проверкой целостности, pg_restore --clean в одной транзакции. Таблица сессий не
   * затрагивается. Записи журнала о копиях, которые сделаны позже восстановленной и потому
   * отсутствуют в ней, добавляются заново. Запись о самом восстановлении делает контроллер.
   * @param {string} fileName имя файла копии в каталоге копий
   * @returns {Promise<void>}
   * @throws {Error} status 400 — недопустимое имя или повреждённый файл; 404 — файла нет;
   *   409 — выполняется другая операция; 500 — ошибка pg_restore (данные не изменены)
   */
  async restore(fileName) {
    if (typeof fileName !== 'string' || !FILE_PATTERN.test(fileName) || path.basename(fileName) !== fileName) {
      throw userError(400, 'Недопустимое имя файла резервной копии');
    }
    const source = path.join(this.#backupDir, fileName);
    if (!fs.existsSync(source)) throw userError(404, 'Файл резервной копии не найден');
    if (busy) throw userError(409, 'Уже выполняется резервное копирование или восстановление. Повторите позже');
    busy = true;
    const tmp = path.join(this.#backupDir, `.restore-${crypto.randomBytes(6).toString('hex')}.dump`);
    try {
      const key = encryptionKey();
      const journalBefore = await BackupLog.findAll();
      await decryptFile(source, tmp, key);
      try {
        await run(tool('pg_restore'), [
          ...pgArgs(), '--clean', '--if-exists', '--single-transaction', '--no-owner', '--no-privileges',
          '--dbname', config.db.database, tmp,
        ]);
      } catch (err) {
        console.error('[Резервное копирование] pg_restore:', err.stderr || err.message);
        throw userError(500, 'Не удалось восстановить базу данных из копии; данные не изменены');
      }
      // Копии, сделанные позже восстановленной, остаются доступными для восстановления.
      const journalAfter = new Set((await BackupLog.findAll()).map((l) => l.fileName));
      const files = new Set(await fsp.readdir(this.#backupDir));
      for (const log of journalBefore.slice().reverse()) {
        if (log.status === BackupStatus.SUCCESS && log.type !== BackupType.RESTORE
          && files.has(log.fileName) && !journalAfter.has(log.fileName)) {
          await BackupLog.create({ adminId: log.adminId, fileName: log.fileName, type: log.type, status: log.status })
            .catch(() => {}); // администратора нет в восстановленных данных
          journalAfter.add(log.fileName);
        }
      }
    } finally {
      await fsp.rm(tmp, { force: true });
      busy = false;
    }
  }

  /**
   * Доступные для восстановления копии: успешные записи журнала (по запросу и по расписанию),
   * файлы которых есть в каталоге копий; новые — первыми.
   * @returns {Promise<BackupLog[]>}
   */
  async listBackups() {
    const [logs, files] = await Promise.all([
      BackupLog.findAll(),
      fsp.readdir(this.#backupDir).catch(() => []),
    ]);
    const present = new Set(files);
    const seen = new Set();
    return logs.filter((l) => {
      const ok = l.status === BackupStatus.SUCCESS && l.type !== BackupType.RESTORE
        && present.has(l.fileName) && !seen.has(l.fileName);
      if (ok) seen.add(l.fileName);
      return ok;
    });
  }
}
