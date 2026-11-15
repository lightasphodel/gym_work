import { config } from '../config/config.js';
import { Goal, Level } from '../models/enums.js';
import { EQUIPMENT, WORKOUTS_PER_WEEK, BODY_WEIGHT } from '../config/dictionaries.js';

/**
 * Валидация входных данных.
 * @param {(body: Record<string, unknown>) => string[]} rules функция, возвращающая список ошибок
 */
export function validate(rules) {
  return (req, res, next) => {
    const errors = rules(req.body ?? {});
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }
    next();
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isString = (v) => typeof v === 'string';

/** Правила регистрации (ФТ-01). */
export function registerRules(body) {
  const errors = [];
  const { login, email, password } = body;
  const sec = config.security;

  if (!isString(login) || !sec.loginPattern.test(login)) {
    errors.push('Логин: от 3 до 50 символов — латинские буквы, цифры, «_», «.», «-»');
  }
  if (!isString(email) || email.length > sec.emailMaxLength || !EMAIL_PATTERN.test(email)) {
    errors.push('Укажите корректный адрес электронной почты');
  }
  if (!isString(password)) {
    errors.push('Укажите пароль');
  } else {
    if (password.length < sec.passwordMinLength) {
      errors.push(`Пароль должен содержать не менее ${sec.passwordMinLength} символов`);
    }
    if (Buffer.byteLength(password, 'utf8') > sec.passwordMaxLength) {
      errors.push('Пароль слишком длинный');
    }
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
      errors.push('Пароль должен содержать хотя бы одну букву и одну цифру');
    }
  }
  return errors;
}

/** Правила авторизации (ФТ-02). */
export function loginRules(body) {
  const errors = [];
  if (!isString(body.login) || body.login.trim() === '') errors.push('Введите логин');
  if (!isString(body.password) || body.password === '') errors.push('Введите пароль');
  return errors;
}

const WEIGHT_PATTERN = /^\d{1,3}([.,]\d{1,2})?$/;

/**
 * Проверка анкеты тренировочного профиля (ФТ-03).
 * Данные приходят из HTML-формы: все значения — строки, отмеченные чекбоксы
 * инвентаря — строка (один) или массив (несколько).
 * @param {Record<string, unknown>} body
 * @returns {{data: {goal: string, level: string, workoutsPerWeek: number, equipment: string[], bodyWeight: number},
 *            errors: Record<string, string>}} errors пуст, если анкета корректна
 */
export function parseProfile(body) {
  const errors = {};
  const text = (v) => (isString(v) ? v.trim() : '');

  const goal = text(body.goal);
  if (!Object.values(Goal).includes(goal)) {
    errors.goal = 'Выберите цель тренировок';
  }

  const level = text(body.level);
  if (!Object.values(Level).includes(level)) {
    errors.level = 'Выберите уровень подготовки';
  }

  const wpwText = text(body.workoutsPerWeek);
  const workoutsPerWeek = Number(wpwText);
  if (!/^\d+$/.test(wpwText) || workoutsPerWeek < WORKOUTS_PER_WEEK.min || workoutsPerWeek > WORKOUTS_PER_WEEK.max) {
    errors.workoutsPerWeek =
      `Число тренировок в неделю — целое от ${WORKOUTS_PER_WEEK.min} до ${WORKOUTS_PER_WEEK.max}`;
  }

  const rawEquipment = body.equipment === undefined ? [] : [body.equipment].flat();
  const equipment = [...new Set(rawEquipment.map(text))];
  if (equipment.length === 0) {
    errors.equipment = 'Отметьте хотя бы один вид инвентаря';
  } else if (!equipment.every((e) => EQUIPMENT.includes(e))) {
    errors.equipment = 'Выбран неизвестный вид инвентаря';
  }

  const bwText = text(body.bodyWeight);
  const bodyWeight = Number(bwText.replace(',', '.'));
  if (!WEIGHT_PATTERN.test(bwText) || bodyWeight < BODY_WEIGHT.min || bodyWeight > BODY_WEIGHT.max) {
    errors.bodyWeight =
      `Масса тела — число от ${BODY_WEIGHT.min} до ${BODY_WEIGHT.max} кг, не более двух знаков после запятой`;
  }

  return { data: { goal, level, workoutsPerWeek, equipment, bodyWeight }, errors };
}
