import { toPlain } from '../utils/toPlain.js';

/**
 * Страницы администратора: панель, пользователи, справочник, шаблоны, резервные копии.
 */
export class AdminController {
  /** GET /admin — панель администратора. */
  static index(req, res) {
    res.render('admin', { title: 'Панель администратора', user: toPlain(req.user) });
  }
}
