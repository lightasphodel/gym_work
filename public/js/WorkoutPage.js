/**
 * Клиентский модуль сохранения тренировки (участник WorkoutPage на диаграмме
 * последовательности, рисунок 1.9): проверка введённых значений, отправка
 * POST /api/workouts и вывод результата — тоннажа, рекордов и новых рабочих весов
 * с пояснением решения алгоритма адаптации.
 */
import { api } from './api.js';
import { showMessage, setBusy } from './ui.js';

const WEIGHT_MAX = 999.99;
const REPS_MIN = 1;
const REPS_MAX = 50;

const formatKg = (value) => `${String(Math.round(value * 100) / 100).replace('.', ',')} кг`;

export class WorkoutPage {
  /**
   * @param {HTMLFormElement} form форма с подходами (строки tr[data-set])
   * @param {HTMLElement} errorBox блок сообщения об ошибке
   * @param {HTMLElement} resultBox блок результата
   */
  constructor(form, errorBox, resultBox) {
    this.form = form;
    this.errorBox = errorBox;
    this.resultBox = resultBox;
    this.dayId = Number(form.dataset.dayId);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.save();
    });
  }

  /**
   * Сбор и проверка подходов. Подход с пустым полем повторений не выполнен и не отправляется.
   * @returns {{sets: Array<object>, error: string|null, field: HTMLInputElement|null}}
   */
  validate() {
    const sets = [];
    let error = null;
    let field = null;
    for (const row of this.form.querySelectorAll('tr[data-set]')) {
      const weightInput = row.querySelector('input[name="weight"]');
      const repsInput = row.querySelector('input[name="reps"]');
      weightInput.setAttribute('aria-invalid', 'false');
      repsInput.setAttribute('aria-invalid', 'false');
      if (repsInput.value.trim() === '') continue;

      const weight = Number(weightInput.value.replace(',', '.'));
      const reps = Number(repsInput.value);
      if (!error && (weightInput.value.trim() === '' || !Number.isFinite(weight) || weight < 0 || weight > WEIGHT_MAX)) {
        error = `Вес — неотрицательное число до ${String(WEIGHT_MAX).replace('.', ',')} кг`;
        field = weightInput;
      } else if (!error && (!Number.isInteger(reps) || reps < REPS_MIN || reps > REPS_MAX)) {
        error = `Повторения — целое число от ${REPS_MIN} до ${REPS_MAX}`;
        field = repsInput;
      }
      sets.push({
        programExerciseId: Number(row.dataset.pe),
        setNo: Number(row.dataset.setNo),
        weight: Math.round(weight * 100) / 100,
        reps,
      });
    }
    if (!error && sets.length === 0) {
      error = 'Внесите повторения хотя бы в одном подходе';
      field = this.form.querySelector('input[name="reps"]');
    }
    field?.setAttribute('aria-invalid', 'true');
    return { sets, error, field };
  }

  /** Проверка, отправка на сервер и вывод результата. */
  async save() {
    showMessage(this.errorBox, '');
    const { sets, error, field } = this.validate();
    if (error) {
      showMessage(this.errorBox, error);
      field?.focus();
      return;
    }
    setBusy(this.form, true);
    try {
      const result = await api('/api/workouts', { method: 'POST', body: { programDayId: this.dayId, sets } });
      this.showResult(result);
      // Повторная отправка той же тренировки не нужна.
      for (const control of this.form.elements) control.disabled = true;
    } catch (err) {
      showMessage(this.errorBox, err.message);
      setBusy(this.form, false);
    }
  }

  /**
   * Вывод ответа сервера { tonnage, isCompleted, records, adaptations }.
   * Данные выводятся через textContent.
   */
  showResult({ tonnage, isCompleted, records, adaptations }) {
    const box = this.resultBox;
    box.querySelector('#result-tonnage').textContent = formatKg(tonnage);
    box.querySelector('#result-incomplete').hidden = isCompleted;

    const adaptList = box.querySelector('#result-adaptations');
    adaptList.replaceChildren();
    if (adaptations.length === 0) {
      adaptList.append(item('Ни в одном упражнении не внесены все подходы — рабочие веса не изменились.'));
    }
    for (const a of adaptations) {
      const li = item('');
      const name = document.createElement('strong');
      name.textContent = `${a.exerciseName}: `;
      const weight = document.createElement('span');
      weight.className = 'num-accent';
      weight.textContent = formatKg(a.newWeight);
      li.append(name, weight, ` — ${a.decisionName.toLowerCase()}. ${a.explanation}`);
      adaptList.append(li);
    }

    const recordList = box.querySelector('#result-records');
    recordList.replaceChildren(...records.map((r) => item(
      `${r.exerciseName}: ${r.typeName.toLowerCase()} — ${r.type === 'MAX_REPS' ? r.value : formatKg(r.value)}`,
    )));
    box.querySelector('#result-records-title').hidden = records.length === 0;

    box.hidden = false;
    box.focus();
  }
}

function item(text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

const form = document.getElementById('workout-form');
if (form) {
  new WorkoutPage(form, document.getElementById('workout-error'), document.getElementById('workout-result'));
}
