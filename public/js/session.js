/**
 * Общий модуль страниц после входа: выход из системы.
 * Данные пользователя выводит сервер при рендеринге страницы (EJS).
 */
import { api } from './api.js';

document.getElementById('logout-button')?.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    location.assign('/login');
  }
});
