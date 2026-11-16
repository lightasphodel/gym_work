/**
 * Калькулятор 1ПМ: расчёт без перезагрузки страницы через GET /api/1rm.
 * Без JavaScript форма работает обычным GET-запросом.
 */
import { api } from './api.js';
import { showMessage, markInvalid } from './ui.js';

const form = document.getElementById('one-rm-form');
const errorBox = document.getElementById('one-rm-error');
const result = document.getElementById('one-rm-result');
const kg = (value) => `${String(value).replace('.', ',')} кг`;

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = { weight: form.elements.weight, reps: form.elements.reps };
  const params = new URLSearchParams({ weight: fields.weight.value, reps: fields.reps.value });
  showMessage(errorBox, '');
  markInvalid(fields, []);
  try {
    const data = await api(`/api/1rm?${params}`);
    document.getElementById('one-rm-epley').textContent = kg(data.epley);
    document.getElementById('one-rm-brzycki').textContent = kg(data.brzycki);
    result.hidden = false;
    history.replaceState(null, '', `/tools/1rm?${params}`);
  } catch (err) {
    result.hidden = true;
    showMessage(errorBox, err.message);
    markInvalid(fields, /Повторения/.test(err.message) ? ['reps'] : ['weight']);
  }
});
