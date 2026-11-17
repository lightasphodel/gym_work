/**
 * Листинг классов пакета services для приложения к пояснительной записке (этап 13).
 * Собирает исходный код сервисов в docs/listing.md. Запуск: npm run docs:listing.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'listing.md');

/** Порядок — от алгоритмов предметной области к служебным сервисам. */
const SERVICES = [
  ['StrengthMetrics', 'расчёт 1ПМ (формулы 1.1, 1.2) и тоннажа (1.3)'],
  ['WeightAdaptationService', 'алгоритм адаптации рабочих весов (ФТ-05)'],
  ['RecordDetector', 'определение личных рекордов (ФТ-09)'],
  ['ProgramGenerator', 'генерация тренировочной программы (ФТ-04)'],
  ['ExerciseSelector', 'подбор упражнений и замена (ФТ-12)'],
  ['ProgressAnalytics', 'статистика прогресса, тоннаж, баланс нагрузки, регулярность (ФТ-07, 08, 10, 11)'],
  ['BackupService', 'резервное копирование и восстановление БД (ФТ-15)'],
];

const files = fs.readdirSync(path.join(ROOT, 'src', 'services'))
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .map((f) => f.replace(/\.js$/, ''));
const missing = files.filter((f) => !SERVICES.some(([name]) => name === f));
if (missing.length) throw new Error(`Нет в листинге: ${missing.join(', ')}`);

const parts = [
  '# Листинг классов пакета services',
  '',
  'Файл сформирован командой `npm run docs:listing` из каталога `src/services`; не редактировать вручную.',
  '',
];
SERVICES.forEach(([name, purpose], i) => {
  const rel = `src/services/${name}.js`;
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const lines = code.split('\n').length;
  parts.push(
    `## Листинг ${i + 1} — ${name}.js`,
    '',
    `Класс \`${name}\` — ${purpose}. Файл \`${rel}\`, строк: ${lines}.`,
    '',
    '```js',
    code,
    '```',
    '',
  );
});

fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
console.log(`docs/listing.md: ${SERVICES.length} листингов`);
