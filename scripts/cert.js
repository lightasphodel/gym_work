/**
 * Самоподписанный TLS-сертификат для разработки: certs/key.pem и certs/cert.pem
 * (RSA 2048, SHA-256, 365 дней, subjectAltName localhost и 127.0.0.1).
 * Запуск: npm run cert            — если файлов ещё нет
 *         npm run cert -- --force — пересоздать
 * Используется утилита openssl (из PATH, переменной OPENSSL_PATH или Git for Windows);
 * вызов — execFile без командной оболочки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'certs');
const keyPath = path.join(dir, 'key.pem');
const certPath = path.join(dir, 'cert.pem');
const force = process.argv.includes('--force');

const candidates = [
  process.env.OPENSSL_PATH,
  'openssl',
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files/Git/mingw64/bin/openssl.exe',
].filter(Boolean);

async function findOpenssl() {
  for (const candidate of candidates) {
    try {
      await run(candidate, ['version']);
      return candidate;
    } catch {
      // следующий вариант
    }
  }
  return null;
}

if (!force && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Сертификат уже есть: certs/cert.pem. Пересоздать: npm run cert -- --force');
} else {
  const openssl = await findOpenssl();
  if (!openssl) {
    console.error('Не найдена утилита openssl. Установите её или укажите путь в переменной OPENSSL_PATH.');
    process.exitCode = 1;
  } else {
    fs.mkdirSync(dir, { recursive: true });
    await run(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=localhost/O=Training Diary (dev)',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);
    console.log('Созданы certs/key.pem и certs/cert.pem (самоподписанный сертификат, 365 дней).');
    console.log('В .env: TLS_KEY_PATH=certs/key.pem, TLS_CERT_PATH=certs/cert.pem, PORT=3443.');
  }
}
