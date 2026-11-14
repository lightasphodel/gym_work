import { toPlain } from '../utils/toPlain.js';

/**
 * Страницы пользователя: главная, тренировочный профиль (ФТ-03, этап 5).
 */
export class ProfileController {
  /** GET /home — главная страница пользователя. */
  static home(req, res) {
    res.render('home', { title: 'Главная', user: toPlain(req.user) });
  }
}
