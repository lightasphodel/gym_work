/**
 * Страница программы: замена упражнения равноценным (ФТ-12, ФТ-16).
 * Кнопка «Заменить» запрашивает список замен у GET /api/exercises/:id/replacements
 * и открывает окно с выбором; выбор отправляется формой на сервер.
 */
import { api } from './api.js';
import { showMessage } from './ui.js';

const dialog = document.getElementById('replace-dialog');
const form = document.getElementById('replace-form');
const select = document.getElementById('replace-select');
const current = document.getElementById('replace-current');
const errorBox = document.getElementById('replace-error');
const field = document.getElementById('replace-field');
const submit = document.getElementById('replace-submit');
// Адрес программы: /programs/<id>
const base = location.pathname.replace(/\/$/, '');

async function openReplace(button) {
  current.textContent = `Сейчас: ${button.dataset.name}`;
  showMessage(errorBox, '');
  select.replaceChildren();
  form.action = `${base}/exercises/${button.dataset.replace}/replace`;
  button.disabled = true;
  try {
    const { replacements } = await api(`/api/exercises/${button.dataset.exercise}/replacements`);
    for (const ex of replacements) {
      select.append(new Option(`${ex.name} (${ex.equipment})`, ex.id));
    }
    const empty = replacements.length === 0;
    field.hidden = empty;
    submit.hidden = empty;
    if (empty) showMessage(errorBox, 'Равноценных упражнений с вашим инвентарём в справочнике нет');
  } catch (err) {
    field.hidden = true;
    submit.hidden = true;
    showMessage(errorBox, err.message);
  } finally {
    button.disabled = false;
  }
  dialog.showModal();
}

if (dialog) {
  for (const button of document.querySelectorAll('[data-replace]')) {
    button.addEventListener('click', () => openReplace(button));
  }
  document.getElementById('replace-cancel').addEventListener('click', () => dialog.close());
}
