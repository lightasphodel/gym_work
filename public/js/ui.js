/**
 * Общие функции интерфейса.
 */

/** Показать сообщение в блоке .alert (пустой текст — скрыть). */
export function showMessage(element, text) {
  if (!element) return;
  element.textContent = text ?? '';
  element.hidden = !text;
}

/** Отметить поля с ошибкой для вспомогательных технологий и стилей. */
export function markInvalid(fields, invalidNames) {
  for (const [name, input] of Object.entries(fields)) {
    input.setAttribute('aria-invalid', invalidNames.includes(name) ? 'true' : 'false');
  }
}

/** Блокировка кнопки отправки на время запроса. */
export function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = busy;
}
