import { api } from './api.js';
import { showMessage, markInvalid, setBusy } from './ui.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('form-error');
const successBox = document.getElementById('form-success');
const fields = {
  login: form.elements.login,
  password: form.elements.password,
};

if (new URLSearchParams(location.search).has('registered')) {
  showMessage(successBox, 'Учётная запись создана. Войдите, используя логин и пароль.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(errorBox, '');
  showMessage(successBox, '');

  const login = fields.login.value.trim();
  const password = fields.password.value;

  const empty = Object.entries({ login, password })
    .filter(([, v]) => v === '')
    .map(([k]) => k);
  markInvalid(fields, empty);
  if (empty.length) {
    showMessage(errorBox, 'Введите логин и пароль');
    fields[empty[0]].focus();
    return;
  }

  setBusy(form, true);
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { login, password } });
    location.assign(data.redirect);
  } catch (err) {
    showMessage(errorBox, err.message);
    fields.password.value = '';
    fields.password.focus();
  } finally {
    setBusy(form, false);
  }
});
