/**
 * Серверный модуль приложения (Express).
 * Архитектура MVC:
 *   models/      – модель данных и доступ к БД
 *   views/       – HTML-страницы (+ public/: единая таблица стилей и клиентские модули)
 *   controllers/ – обработка запросов, обращение к сервисам и моделям
 *   services/    – бизнес-логика
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { config } from './config/config.js';
import { checkConnection, closePool } from './config/db.js';
import { router } from './routes/index.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const useHttps = Boolean(config.server.tlsKeyPath && config.server.tlsCertPath);

export const app = express();

app.disable('x-powered-by');
app.use(securityHeaders({ https: useHttps }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: config.session.cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: useHttps,
      maxAge: config.session.maxAgeMs,
    },
  }),
);

app.use(express.static(config.paths.public, { index: false }));
app.use(router);
app.use(notFound);
app.use(errorHandler);

function createServer() {
  if (!useHttps) {
    console.warn('[Сервер] TLS_KEY_PATH и TLS_CERT_PATH не заданы — запуск по HTTP (только для разработки).');
    return http.createServer(app);
  }
  return https.createServer(
    {
      key: fs.readFileSync(config.server.tlsKeyPath),
      cert: fs.readFileSync(config.server.tlsCertPath),
    },
    app,
  );
}

async function start() {
  try {
    await checkConnection();
  } catch (err) {
    console.error(`[БД] Не удалось подключиться к PostgreSQL (${config.db.host}:${config.db.port}/${config.db.database}): ${err.message}`);
    process.exit(1);
  }

  const server = createServer();
  server.listen(config.server.port, () => {
    const protocol = useHttps ? 'https' : 'http';
    console.log(`[Сервер] Запущен: ${protocol}://localhost:${config.server.port}`);
  });

  const shutdown = () => {
    console.log('[Сервер] Остановка...');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Запуск только при прямом вызове `node src/app.js` (при импорте в тестах сервер не стартует).
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  start();
}
