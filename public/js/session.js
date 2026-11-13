/**
 * Общий модуль страниц после входа: данные текущего пользователя и выход.
 */
import { api } from './api.js';
import { showMessage } from './ui.js';

const ROLE_NAMES = { USER: 'Пользователь', ADMIN: 'Администратор' };

function formatValue(field, value) {
  if (field === 'role') return ROLE_NAMES[value] ?? value;
  if (field === 'createdAt') return new Date(value).toLocaleDateString('ru-RU');
  return value ?? '';
}

async function loadCurrentUser() {
  try {
    const { user } = await api('/api/auth/me');
    document.querySelectorAll('[data-user-login]').forEach((el) => {
      el.textContent = user.login;
    });
    document.querySelectorAll('[data-user-field]').forEach((el) => {
      el.textContent = formatValue(el.dataset.userField, user[el.dataset.userField]);
    });
  } catch (err) {
    if (err.status === 401) {
      location.assign('/login');
      return;
    }
    showMessage(document.getElementById('page-error'), err.message);
  }
}

document.getElementById('logout-button')?.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    location.assign('/login');
  }
});

loadCurrentUser();
