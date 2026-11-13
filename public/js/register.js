import { api } from './api.js';
import { showMessage, markInvalid, setBusy } from './ui.js';

const form = document.getElementById('register-form');
const errorBox = document.getElementById('form-error');
const fields = {
  login: form.elements.login,
  email: form.elements.email,
  password: form.elements.password,
  passwordConfirm: form.elements.passwordConfirm,
};

const LOGIN_PATTERN = /^[A-Za-z0-9_.-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Предварительная проверка на клиенте; окончательная выполняется сервером. */
function check(values) {
  if (!LOGIN_PATTERN.test(values.login)) {
    return ['login', 'Логин: от 3 до 50 символов — латинские буквы, цифры, «_», «.», «-»'];
  }
  if (!EMAIL_PATTERN.test(values.email) || values.email.length > 100) {
    return ['email', 'Укажите корректный адрес электронной почты'];
  }
  if (values.password.length < 8 || !/\p{L}/u.test(values.password) || !/\d/.test(values.password)) {
    return ['password', 'Пароль: не менее 8 символов, хотя бы одна буква и одна цифра'];
  }
  if (values.password !== values.passwordConfirm) {
    return ['passwordConfirm', 'Пароли не совпадают'];
  }
  return null;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(errorBox, '');

  const values = {
    login: fields.login.value.trim(),
    email: fields.email.value.trim(),
    password: fields.password.value,
    passwordConfirm: fields.passwordConfirm.value,
  };

  const problem = check(values);
  markInvalid(fields, problem ? [problem[0]] : []);
  if (problem) {
    showMessage(errorBox, problem[1]);
    fields[problem[0]].focus();
    return;
  }

  setBusy(form, true);
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: { login: values.login, email: values.email, password: values.password },
    });
    location.assign('/login?registered=1');
  } catch (err) {
    showMessage(errorBox, err.message);
  } finally {
    setBusy(form, false);
  }
});
