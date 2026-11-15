import { User } from '../models/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseId } from '../utils/parseId.js';
import { toPlain } from '../utils/toPlain.js';

/** Сообщения после действий со списком пользователей (параметр done). */
const DONE_MESSAGES = Object.freeze({
  blocked: (login) => `Учётная запись ${login} заблокирована`,
  unblocked: (login) => `Учётная запись ${login} разблокирована`,
  already: (login) => `Учётная запись ${login} уже заблокирована`,
});

/** Пользователь из параметра :id маршрута; 404, если его нет. */
async function findTarget(req) {
  const id = parseId(req.params.id);
  const user = id && (await User.findById(id));
  if (!user) {
    throw new HttpError(404, 'Пользователь не найден');
  }
  return user;
}

function redirectDone(res, done, user) {
  res.redirect(`/admin/users?done=${done}&login=${encodeURIComponent(user.login)}`);
}

/**
 * Страницы администратора: панель, пользователи (ФТ-18), справочник, шаблоны, резервные копии.
 */
export class AdminController {
  /** GET /admin — панель администратора. */
  static index(req, res) {
    res.render('admin', { title: 'Панель администратора', user: toPlain(req.user) });
  }

  /** GET /admin/users — список учётных записей. */
  static async users(req, res) {
    const users = await User.findAll();
    const message = DONE_MESSAGES[req.query.done];
    const login = typeof req.query.login === 'string' ? req.query.login : '';

    res.render('admin-users', {
      title: 'Пользователи',
      // isLocked() — метод, а не аксессор, поэтому в toPlain() не попадает: добавляется явно.
      users: users.map((u) => ({ ...toPlain(u), locked: u.isLocked() })),
      selfId: req.user.id,
      message: message && login ? message(login) : '',
    });
  }

  /** POST /admin/users/:id/block — блокировка. Свою учётную запись заблокировать нельзя. */
  static async block(req, res) {
    const user = await findTarget(req);
    if (user.id === req.user.id) {
      throw new HttpError(400, 'Нельзя заблокировать собственную учётную запись');
    }
    if (user.isBlocked) {
      return redirectDone(res, 'already', user);
    }
    await user.block();
    redirectDone(res, 'blocked', user);
  }

  /** POST /admin/users/:id/unblock — разблокировка (снимает и временную блокировку входа). */
  static async unblock(req, res) {
    const user = await findTarget(req);
    await user.unblock();
    redirectDone(res, 'unblocked', user);
  }
}
