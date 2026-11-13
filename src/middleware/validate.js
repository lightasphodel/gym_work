import { config } from '../config/config.js';

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
