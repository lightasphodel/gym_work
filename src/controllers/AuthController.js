import bcrypt from 'bcrypt';
import { config } from '../config/config.js';
import { User, Role } from '../models/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { homePathFor } from '../middleware/auth.js';
import { toPlain } from '../utils/toPlain.js';

const INVALID_CREDENTIALS = 'Неверный логин или пароль';
// Срок блокировки (lockedUntil) закрыт в модели User, поэтому сообщение без числа минут.
const LOCKED_MESSAGE = 'Слишком много неудачных попыток входа. Вход временно заблокирован, повторите попытку позже';

// Хеш-заглушка: при несуществующем логине пароль всё равно проверяется,
// чтобы по времени ответа нельзя было определить, существует ли учётная запись.
let dummyHashPromise = null;
function getDummyHash() {
  dummyHashPromise ??= bcrypt.hash('dummy-password-0', config.security.bcryptRounds);
  return dummyHashPromise;
}

/**
 * Учёт неудачных попыток входа под несуществующими логинами.
 * Временная блокировка (429) у существующей учётной записи иначе отличала бы её от
 * несуществующей; для неизвестных логинов применяется то же правило — 5 попыток подряд,
 * блокировка на 15 минут (как User.MAX_FAILED_LOGINS и User.LOCK_MINUTES).
 * Хранится в памяти процесса; размер ограничен, устаревшие записи удаляются.
 */
const UNKNOWN_LOGIN_LIMIT = 5;
const UNKNOWN_LOCK_MS = 15 * 60 * 1000;
const UNKNOWN_MAX_ENTRIES = 10_000;
const unknownLogins = new Map();

/** @returns {boolean} действует ли блокировка для неизвестного логина */
export function isUnknownLoginLocked(login, now = Date.now()) {
  const entry = unknownLogins.get(login.toLowerCase());
  if (!entry) return false;
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    unknownLogins.delete(login.toLowerCase());
    return false;
  }
  return Boolean(entry.lockedUntil);
}

/** Неудачная попытка под неизвестным логином; на пятой — блокировка. */
export function registerUnknownLogin(login, now = Date.now()) {
  const key = login.toLowerCase();
  if (unknownLogins.size >= UNKNOWN_MAX_ENTRIES && !unknownLogins.has(key)) {
    for (const [k, v] of unknownLogins) {
      if (!v.lockedUntil || v.lockedUntil <= now) unknownLogins.delete(k);
    }
    if (unknownLogins.size >= UNKNOWN_MAX_ENTRIES) unknownLogins.delete(unknownLogins.keys().next().value);
  }
  const entry = unknownLogins.get(key) ?? { failed: 0, lockedUntil: null };
  entry.failed += 1;
  if (entry.failed >= UNKNOWN_LOGIN_LIMIT) {
    entry.failed = 0;
    entry.lockedUntil = now + UNKNOWN_LOCK_MS;
  }
  unknownLogins.set(key, entry);
}

function regenerateSession(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

function saveSession(req) {
  return new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
}

/**
 * Регистрация, вход, выход и данные текущего пользователя (ФТ-01, ФТ-02).
 */
export class AuthController {
  /** GET / — перенаправление на стартовую страницу роли или на вход. */
  static root(req, res) {
    const sessionUser = req.session?.user;
    res.redirect(sessionUser ? homePathFor(sessionUser.role) : '/login');
  }

  /** GET /login — страница входа. */
  static loginPage(req, res) {
    res.render('login', {
      title: 'Вход',
      pageClass: 'page--hero page--glow',
      containerClass: 'auth',
      scripts: ['/js/login.js'],
    });
  }

  /** GET /register — страница регистрации. */
  static registerPage(req, res) {
    res.render('register', {
      title: 'Регистрация',
      pageClass: 'page--hero page--glow',
      containerClass: 'auth',
      scripts: ['/js/register.js'],
    });
  }

  /** POST /api/auth/register */
  static async register(req, res) {
    const { login, email, password } = req.body;
    try {
      const user = await User.create({
        login,
        email: email.trim().toLowerCase(),
        password,
        role: Role.USER, // через регистрацию создаются только пользователи
      });
      res.status(201).json({ user: toPlain(user) });
    } catch (err) {
      if (err.code === '23505') {
        if (err.constraint === 'users_login_ak') {
          throw new HttpError(409, 'Пользователь с таким логином уже зарегистрирован');
        }
        if (err.constraint === 'users_email_ak') {
          throw new HttpError(409, 'Этот адрес электронной почты уже используется');
        }
      }
      throw err;
    }
  }

  /** POST /api/auth/login */
  static async login(req, res) {
    const login = req.body.login.trim();
    const { password } = req.body;

    const user = await User.findByLogin(login);
    if (!user) {
      // Ответ и время ответа — как для существующего логина с неверным паролем.
      if (isUnknownLoginLocked(login)) throw new HttpError(429, LOCKED_MESSAGE);
      await bcrypt.compare(password, await getDummyHash());
      registerUnknownLogin(login);
      if (isUnknownLoginLocked(login)) throw new HttpError(429, LOCKED_MESSAGE);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    // Временная блокировка входа (ФТ-02): во время блокировки пароль не проверяется.
    if (user.isLocked()) {
      throw new HttpError(429, LOCKED_MESSAGE);
    }

    const ok = await user.checkPassword(password);
    if (!ok) {
      await user.registerFailedLogin();
      if (user.isLocked()) {
        throw new HttpError(429, LOCKED_MESSAGE);
      }
      throw new HttpError(401, INVALID_CREDENTIALS);
    }
    await user.resetFailedLogins();

    if (user.isBlocked) {
      throw new HttpError(403, 'Учётная запись заблокирована. Обратитесь к администратору');
    }

    // Новый идентификатор сессии после входа — защита от фиксации сессии.
    await regenerateSession(req);
    req.session.user = { id: user.id, login: user.login, role: user.role };
    await saveSession(req);

    res.json({ user: toPlain(user), redirect: homePathFor(user.role) });
  }

  /** POST /api/auth/logout */
  static async logout(req, res) {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie(config.session.cookieName);
    res.status(204).end();
  }

  /** GET /api/auth/me */
  static me(req, res) {
    res.json({ user: toPlain(req.user) });
  }
}
