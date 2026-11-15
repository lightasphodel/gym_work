import { TrainingProfile } from '../models/index.js';
import { parseProfile } from '../middleware/validate.js';
import { toPlain } from '../utils/toPlain.js';

/** Значения полей анкеты из сохранённого профиля (или пустые для нового). */
function formFromProfile(profile) {
  return {
    goal: profile?.goal ?? '',
    level: profile?.level ?? '',
    workoutsPerWeek: profile?.workoutsPerWeek ?? '',
    equipment: profile?.equipment ?? [],
    bodyWeight: profile?.bodyWeight ?? '',
  };
}

/** Введённые значения анкеты для повторного показа формы с ошибками. */
function formFromBody(body) {
  const text = (v) => (typeof v === 'string' ? v : '');
  return {
    goal: text(body.goal),
    level: text(body.level),
    workoutsPerWeek: text(body.workoutsPerWeek),
    equipment: body.equipment === undefined ? [] : [body.equipment].flat().filter((v) => typeof v === 'string'),
    bodyWeight: text(body.bodyWeight),
  };
}

function renderProfile(res, { form, errors = {}, saved = false, isNew }) {
  res.render('profile', {
    title: 'Тренировочный профиль',
    form,
    errors,
    saved,
    isNew,
  });
}

/**
 * Страницы пользователя: главная, тренировочный профиль (ФТ-03).
 */
export class ProfileController {
  /** GET /home — главная страница пользователя. */
  static async home(req, res) {
    const profile = await TrainingProfile.findByUser(req.user.id);
    res.render('home', {
      title: 'Главная',
      user: toPlain(req.user),
      profileComplete: Boolean(profile?.isComplete()),
    });
  }

  /** GET /profile — анкета тренировочного профиля. */
  static async profilePage(req, res) {
    const profile = await TrainingProfile.findByUser(req.user.id);
    renderProfile(res, {
      form: formFromProfile(profile),
      saved: req.query.saved === '1',
      isNew: !profile,
    });
  }

  /**
   * POST /profile — сохранение анкеты. Первый раз профиль создаётся
   * (TrainingProfile.create), затем изменяется (update). Проверка — на сервере.
   */
  static async save(req, res) {
    const body = req.body ?? {};
    const { data, errors } = parseProfile(body);
    const profile = await TrainingProfile.findByUser(req.user.id);

    if (Object.keys(errors).length > 0) {
      res.status(400);
      return renderProfile(res, { form: formFromBody(body), errors, isNew: !profile });
    }

    if (profile) {
      await profile.update(data);
    } else {
      await TrainingProfile.create({ userId: req.user.id, ...data });
    }
    res.redirect('/profile?saved=1');
  }
}
