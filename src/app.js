/**
 * Серверный модуль приложения (Express).
 * Архитектура MVC:
 *   models/      – модель данных и доступ к БД
 *   views/       – EJS-представления: макет, фрагменты, страницы (+ public/: единая таблица стилей и клиентские модули)
 *   controllers/ – обработка запросов, обращение к сервисам и моделям
 *   services/    – бизнес-логика
 *
 * Безопасность: HTTPS (TLS-сертификат из certs/, HTTP перенаправляется на HTTPS),
 * заголовки helmet (в том числе Content-Security-Policy), сессии в PostgreSQL
 * (connect-pg-simple) с cookie httpOnly / secure / sameSite=strict.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { config } from './config/config.js';
import { pool, checkConnection, closePool } from './config/db.js';
import { setupViews, viewLocals } from './config/views.js';
import { router } from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { BackupService } from './services/index.js';
import { User, Role } from './models/index.js';

/** HTTPS включается, когда в .env заданы оба пути TLS (сертификат создаёт npm run cert). */
const tlsConfigured = Boolean(config.server.tlsKeyPath && config.server.tlsCertPath);
const useHttps = tlsConfigured;

export const app = express();

app.disable('x-powered-by');
setupViews(app);

// Заголовки безопасности. Скрипты, стили и медиа — только с этого же сервера;
// data: нужен для встроенной SVG-стрелки списков (styles.css) и пустого favicon.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: useHttps ? [] : null,
    },
  },
  strictTransportSecurity: useHttps ? { maxAge: 31536000 } : false,
  referrerPolicy: { policy: 'same-origin' },
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Сессии хранятся в таблице session (не теряются при перезапуске сервера).
const PgSession = connectPgSimple(session);
app.use(
  session({
    name: config.session.cookieName,
    secret: config.session.secret,
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict', // cookie не отправляется с запросами с чужих сайтов (защита форм от CSRF)
      secure: useHttps,
      maxAge: config.session.maxAgeMs,
    },
  }),
);

app.use(express.static(config.paths.public, { index: false }));
app.use(viewLocals);
app.use(router);
app.use(notFound);
app.use(errorHandler);

/** Имя хоста из заголовка Host для перенаправления (только допустимые символы). */
function redirectHost(hostHeader) {
  const host = String(hostHeader ?? '').replace(/:\d+$/, '');
  return /^[a-z0-9.-]{1,253}$/i.test(host) ? host : 'localhost';
}

/** HTTP-сервер, перенаправляющий все запросы на HTTPS (301). */
function createRedirectServer() {
  return http.createServer((req, res) => {
    const port = config.server.port === 443 ? '' : `:${config.server.port}`;
    res.writeHead(301, { Location: `https://${redirectHost(req.headers.host)}${port}${req.url}` });
    res.end();
  });
}

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

/** Резервное копирование по расписанию (ФТ-15): запись в журнал — от имени первого активного администратора. */
function startBackupSchedule() {
  if (!config.backup.key) {
    console.warn('[Резервное копирование] BACKUP_KEY не задан — копии по расписанию не создаются.');
    return;
  }
  // eslint-disable-next-line no-new
  new BackupService({
    scheduledBy: async () => (await User.findAll()).find((u) => u.role === Role.ADMIN && !u.isBlocked)?.id ?? null,
  });
  console.log(`[Резервное копирование] Расписание: ${config.backup.schedule}`);
}

async function start() {
  if (tlsConfigured && !(fs.existsSync(config.server.tlsKeyPath) && fs.existsSync(config.server.tlsCertPath))) {
    console.error('[Сервер] Файлы TLS-сертификата не найдены. Создайте их командой: npm run cert');
    process.exit(1);
  }
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

  let redirectServer = null;
  if (useHttps && config.server.httpPort && config.server.httpPort !== config.server.port) {
    redirectServer = createRedirectServer();
    redirectServer.on('error', (err) => {
      console.warn(`[Сервер] Перенаправление HTTP → HTTPS не запущено (порт ${config.server.httpPort}): ${err.message}`);
    });
    redirectServer.listen(config.server.httpPort, () => {
      console.log(`[Сервер] Перенаправление: http://localhost:${config.server.httpPort} → HTTPS`);
    });
  }

  startBackupSchedule();

  const shutdown = () => {
    console.log('[Сервер] Остановка...');
    redirectServer?.close();
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
