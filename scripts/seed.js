/**
 * Заполнение базы данных начальными данными: выполнение db/seed.sql
 * (группы мышц, упражнения, администратор admin / admin123, шаблонная программа).
 * Запуск: npm run db:seed (после npm run db:init). Повторный запуск не создаёт дублей.
 */
import fs from 'node:fs';
import { config } from '../src/config/config.js';
import { pool, closePool } from '../src/config/db.js';

try {
  const sql = fs.readFileSync(config.paths.seed, 'utf8');
  await pool.query(sql);

  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM muscle_groups)               AS muscles,
            (SELECT COUNT(*) FROM exercises)                   AS exercises,
            (SELECT COUNT(*) FROM programs WHERE is_template)  AS templates`,
  );
  const { muscles, exercises, templates } = rows[0];
  console.log(`Начальные данные загружены: групп мышц — ${muscles}, упражнений — ${exercises}, шаблонов — ${templates}.`);
} catch (err) {
  console.error('Ошибка загрузки начальных данных:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
