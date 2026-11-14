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
      await bcrypt.compare(password, await getDummyHash());
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
