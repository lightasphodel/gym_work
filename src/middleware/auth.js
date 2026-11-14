import { User, Role } from '../models/index.js';
import { isApiRequest } from './errorHandler.js';

/** Стартовая страница для роли. */
export function homePathFor(role) {
  return role === Role.ADMIN ? '/admin' : '/home';
}

function destroySession(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

function deny(req, res, status, message) {
  if (isApiRequest(req)) {
    return res.status(status).json({ error: message });
  }
  if (status === 401) {
    return res.redirect('/login');
  }
  return res.status(403).render('403', { title: 'Доступ запрещён', pageClass: 'page--glow' });
}

/**
 * Проверка действующей сессии.
 * Учётная запись перечитывается из БД при каждом запросе, поэтому блокировка
 * и смена роли администратором вступают в силу сразу.
 */
export async function requireAuth(req, res, next) {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    return deny(req, res, 401, 'Требуется вход в систему');
  }

  const user = await User.findById(sessionUser.id);
  if (!user) {
    await destroySession(req);
    return deny(req, res, 401, 'Сессия недействительна. Войдите снова');
  }
  if (user.isBlocked) {
    await destroySession(req);
    return deny(req, res, 401, 'Учётная запись заблокирована. Обратитесь к администратору');
  }
  if (user.role !== sessionUser.role) {
    req.session.user.role = user.role;
  }

  req.user = user;
  next();
}

/**
 * Проверка роли. Использование: router.get('/admin', requireRole(Role.ADMIN), handler)
 * @param {...string} roles допустимые роли
 */
export function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return deny(req, res, 403, 'Недостаточно прав для выполнения операции');
      }
      next();
    },
  ];
}

/** Страницы входа и регистрации доступны только неавторизованным посетителям. */
export function requireGuest(req, res, next) {
  const sessionUser = req.session?.user;
  if (sessionUser) {
    return res.redirect(homePathFor(sessionUser.role));
  }
  next();
}
