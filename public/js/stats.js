/**
 * Страница статистики: показатели, графики Chart.js и календарь регулярности.
 * Данные — GET /api/stats/progress | tonnage | balance | regularity (JSON).
 * Chart.js подключается локально (/vendor/chart.umd.min.js) как глобальный объект Chart.
 * Цвета графиков берутся из CSS-переменных styles.css (--chart-1, --chart-2, --muted, --steel).
 */
import { api } from './api.js';
import { showMessage } from './ui.js';

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const THEME = {
  series1: color('--chart-1'),
  series2: color('--chart-2'),
  text: color('--muted'),
  ink: color('--ink'),
  grid: color('--steel'),
  surface: color('--card'),
  font: color('--font'),
};

const errorBox = document.getElementById('stats-error');
const kg = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} кг`;
const num = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const fullDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// ---------- Общие настройки Chart.js ----------

const { Chart } = window;
Chart.defaults.color = THEME.text;
Chart.defaults.font.family = THEME.font;
Chart.defaults.font.size = 13;
Chart.defaults.borderColor = THEME.grid;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 };
Chart.defaults.plugins.tooltip.backgroundColor = THEME.surface;
Chart.defaults.plugins.tooltip.borderColor = THEME.grid;
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = THEME.ink;
Chart.defaults.plugins.tooltip.bodyColor = THEME.ink;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.boxHeight = 12;

/** Ось значений: сетка приглушённая, подписи в ink-цвете текста. */
const valueAxis = (title) => ({
  beginAtZero: true,
  grid: { color: THEME.grid },
  border: { display: false },
  title: { display: Boolean(title), text: title },
  ticks: { callback: (v) => num(v) },
});
const categoryAxis = () => ({ grid: { display: false }, border: { color: THEME.grid } });

// ---------- Показатели и календарь ----------

async function loadKpis() {
  const [workout, week, month, regularity] = await Promise.all([
    api('/api/stats/tonnage?period=workout'),
    api('/api/stats/tonnage?period=week'),
    api('/api/stats/tonnage?period=month'),
    api('/api/stats/regularity'),
  ]);
  document.getElementById('kpi-workout').textContent = kg(workout.tonnage);
  document.getElementById('kpi-week').textContent = kg(week.tonnage);
  document.getElementById('kpi-month').textContent = kg(month.tonnage);
  document.getElementById('kpi-streak').textContent = `${regularity.streak} нед.`;
  document.getElementById('kpi-completion').textContent =
    regularity.completionPct === null ? 'нет активной программы' : `${regularity.completionPct} %`;
  document.getElementById('kpi-plan').textContent = regularity.planPerWeek
    ? `${regularity.planPerWeek} трениров. в неделю${regularity.since ? ` с ${fullDate(regularity.since)}` : ''}`
    : 'не задан';
  renderCalendar(regularity.calendar);
}

/** Календарь 12 недель × 7 дней; отметка ✓ / • и подпись дня — статус не передаётся только цветом. */
function renderCalendar(calendar) {
  const box = document.getElementById('calendar');
  const byDate = new Map(calendar.map((d) => [d.date, d.completed]));
  const now = new Date();
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (new Date(todayMs).getUTCDay() + 6) % 7;
  const firstMonday = todayMs - (dow + 7 * 11) * 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  const cells = [document.createElement('span')];
  for (const name of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) {
    const head = document.createElement('span');
    head.className = 'calendar__head';
    head.textContent = name;
    cells.push(head);
  }
  for (let week = 0; week < 12; week += 1) {
    const weekStart = firstMonday + week * 7 * 86400000;
    const label = document.createElement('span');
    label.className = 'calendar__week';
    label.textContent = shortDate(iso(weekStart));
    cells.push(label);
    for (let d = 0; d < 7; d += 1) {
      const ms = weekStart + d * 86400000;
      const date = iso(ms);
      const cell = document.createElement('span');
      cell.className = 'calendar__day';
      cell.setAttribute('role', 'gridcell');
      let status = 'без тренировки';
      if (byDate.has(date)) {
        const done = byDate.get(date);
        cell.classList.add(done ? 'calendar__day--done' : 'calendar__day--partial');
        cell.textContent = done ? '✓' : '•';
        status = done ? 'тренировка завершена' : 'тренировка внесена не полностью';
      } else if (ms > todayMs) {
        cell.classList.add('calendar__day--future');
        status = 'ещё не наступил';
      }
      if (ms === todayMs) cell.classList.add('calendar__day--today');
      cell.setAttribute('aria-label', `${fullDate(date)}: ${status}`);
      cell.title = `${fullDate(date)}: ${status}`;
      cells.push(cell);
    }
  }
  box.replaceChildren(...cells);
}

// ---------- Силовой прогресс ----------

const weightChart = new Chart(document.getElementById('chart-weight'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'Рабочий вес', data: [], borderColor: THEME.series1, backgroundColor: THEME.series1 },
      { label: 'Расчётный 1ПМ (Эпли)', data: [], borderColor: THEME.series2, backgroundColor: THEME.series2 },
    ].map((d) => ({ ...d, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: THEME.surface,
      pointBorderWidth: 2, tension: 0 })),
  },
  options: {
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', align: 'start' },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${kg(c.parsed.y)}` } },
    },
    // offset: точки не садятся на ось Y (в том числе единственная точка периода)
    scales: { x: { ...categoryAxis(), offset: true }, y: valueAxis('кг') },
  },
});

const tonnageChart = new Chart(document.getElementById('chart-tonnage'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{ label: 'Тоннаж', data: [], backgroundColor: THEME.series1, borderRadius: 4,
      borderSkipped: 'start', maxBarThickness: 32 }],
  },
  options: {
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `Тоннаж: ${kg(c.parsed.y)}` } },
    },
    scales: { x: categoryAxis(), y: valueAxis('кг') },
  },
});

async function loadProgress() {
  const form = document.getElementById('progress-form');
  const params = new URLSearchParams({
    exerciseId: form.elements.exerciseId.value,
    from: form.elements.from.value,
    to: form.elements.to.value,
  });
  const series = await api(`/api/stats/progress?${params}`);
  const labels = series.labels.map(shortDate);
  weightChart.data.labels = labels;
  weightChart.data.datasets[0].data = series.workingWeight;
  weightChart.data.datasets[1].data = series.e1rm;
  weightChart.update();
  tonnageChart.data.labels = labels;
  tonnageChart.data.datasets[0].data = series.tonnage;
  tonnageChart.update();
  document.getElementById('progress-empty').hidden = series.labels.length > 0;

  document.getElementById('progress-table').replaceChildren(...series.labels.map((date, i) =>
    row([fullDate(date), num(series.workingWeight[i]), num(series.e1rm[i]), num(series.tonnage[i])], [1, 2, 3])));
}

// ---------- Баланс нагрузки ----------

const balanceChart = new Chart(document.getElementById('chart-balance'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{ label: 'Рабочих подходов', data: [], backgroundColor: THEME.series1, borderRadius: 4,
      borderSkipped: 'start', maxBarThickness: 20 }],
  },
  options: {
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `Подходов: ${c.parsed.x}` } },
    },
    scales: {
      x: { ...valueAxis(''), ticks: { precision: 0 } },
      y: { grid: { display: false }, border: { color: THEME.grid }, ticks: { color: THEME.ink } },
    },
  },
});

async function loadBalance() {
  const week = document.getElementById('balance-form').elements.week.value;
  const report = await api(`/api/stats/balance?week=${encodeURIComponent(week)}`);
  document.getElementById('balance-range').textContent = `Неделя ${fullDate(report.from)} — ${fullDate(report.to)}`;

  balanceChart.data.labels = report.groups.map((g) => g.name);
  balanceChart.data.datasets[0].data = report.groups.map((g) => g.sets);
  balanceChart.update();

  const warnings = report.pairs.filter((p) => p.warning);
  const box = document.getElementById('balance-warnings');
  box.replaceChildren(...warnings.map((p) => {
    const alert = document.createElement('div');
    alert.className = 'alert alert--error';
    alert.setAttribute('role', 'status');
    alert.textContent = `⚠ ${p.warning}`;
    return alert;
  }));
  if (warnings.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'text-muted';
    ok.textContent = report.groups.some((g) => g.sets > 0)
      ? `Дисбаланса нет: подходы на мышцы-антагонисты отличаются не более чем в ${num(report.threshold)} раза.`
      : 'За эту неделю тренировок нет.';
    box.append(ok);
  }

  document.getElementById('balance-table').replaceChildren(...report.pairs.map((p) => row([
    `${p.first} / ${p.second}`,
    `${p.firstSets} / ${p.secondSets}`,
    p.ratio === null ? '—' : num(p.ratio),
    p.warning ? 'дисбаланс' : (p.firstSets + p.secondSets > 0 ? 'в норме' : 'нет нагрузки'),
  ], [1, 2])));
}

// ---------- Вспомогательное ----------

function row(values, numericColumns = []) {
  const tr = document.createElement('tr');
  values.forEach((v, i) => {
    const td = document.createElement('td');
    if (numericColumns.includes(i)) td.className = 'is-numeric';
    td.textContent = v;
    tr.append(td);
  });
  return tr;
}

async function run(task) {
  try {
    await task();
  } catch (err) {
    showMessage(errorBox, err.message);
  }
}

document.getElementById('progress-form').addEventListener('submit', (e) => {
  e.preventDefault();
  showMessage(errorBox, '');
  run(loadProgress);
});
document.getElementById('balance-form').addEventListener('submit', (e) => {
  e.preventDefault();
  showMessage(errorBox, '');
  run(loadBalance);
});

run(loadKpis);
if (document.getElementById('progress-exercise').value) run(loadProgress);
run(loadBalance);
