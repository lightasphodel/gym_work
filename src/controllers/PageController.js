import path from 'node:path';
import { config } from '../config/config.js';
import { homePathFor } from '../middleware/auth.js';

function sendView(res, name) {
  res.sendFile(path.join(config.paths.views, `${name}.html`));
}

/**
 * Выдача страниц представления (View).
 * Доступ к страницам проверяется на сервере промежуточным ПО до их отправки.
 */
export class PageController {
  /** GET / — перенаправление на стартовую страницу роли или на вход. */
  static root(req, res) {
    const sessionUser = req.session?.user;
    res.redirect(sessionUser ? homePathFor(sessionUser.role) : '/login');
  }

  static login(req, res) {
    sendView(res, 'login');
  }

  static register(req, res) {
    sendView(res, 'register');
  }

  /** Главная страница пользователя. */
  static home(req, res) {
    sendView(res, 'home');
  }

  /** Панель администратора. */
  static admin(req, res) {
    sendView(res, 'admin');
  }
}
