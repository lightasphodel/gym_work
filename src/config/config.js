/**
 * Конфигурация приложения.
 * Параметры читаются из файла .env (см. .env.example) встроенными средствами Node.js,
 * без сторонних пакетов.
 */
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Не задан обязательный параметр ${name} в файле .env`);
  }
  return value;
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

function resolveFromRoot(p) {
  return p ? path.resolve(rootDir, p) : '';
}

export const config = Object.freeze({
  rootDir,
  env: optional('NODE_ENV', 'development'),

  server: Object.freeze({
    port: Number(optional('PORT', '3000')),
    // Порт HTTP-сервера, перенаправляющего на HTTPS (используется только при заданных TLS-путях).
    httpPort: Number(optional('HTTP_PORT', '3000')),
    tlsKeyPath: resolveFromRoot(optional('TLS_KEY_PATH')),
    tlsCertPath: resolveFromRoot(optional('TLS_CERT_PATH')),
  }),

  db: Object.freeze({
    host: optional('DB_HOST', 'localhost'),
    port: Number(optional('DB_PORT', '5432')),
    database: optional('DB_NAME', 'fitness_db'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD'),
  }),

  session: Object.freeze({
    secret: required('SESSION_SECRET'),
    cookieName: 'fitness.sid',
    maxAgeMs: Number(optional('SESSION_MAX_AGE_HOURS', '8')) * 60 * 60 * 1000,
  }),

  security: Object.freeze({
    // Cost-фактор bcrypt: не ниже 12, даже если в .env указано меньше.
    bcryptRounds: Math.max(12, Number(optional('BCRYPT_ROUNDS', '12')) || 12),
    // Требования к учётным данным (ФТ-01)
    loginPattern: /^[A-Za-z0-9_.-]{3,50}$/,
    emailMaxLength: 100,
    passwordMinLength: 8,
    passwordMaxLength: 72, // ограничение алгоритма bcrypt
  }),

  backup: Object.freeze({
    dir: resolveFromRoot(optional('BACKUP_DIR', './backups')),
    pgBinDir: optional('PG_BIN_DIR'),
    // Расписание резервного копирования (cron: минута час день месяц день_недели), по умолчанию — 03:00 ежедневно.
    schedule: optional('BACKUP_SCHEDULE', '0 3 * * *'),
    // Ключ AES-256-GCM для шифрования файлов копий: 64 шестнадцатеричных символа (32 байта).
    key: optional('BACKUP_KEY'),
  }),

  paths: Object.freeze({
    views: path.join(rootDir, 'src', 'views'),
    public: path.join(rootDir, 'public'),
    schema: path.join(rootDir, 'db', 'schema.sql'),
    seed: path.join(rootDir, 'db', 'seed.sql'),
  }),
});
