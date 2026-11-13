/**
 * Инициализация базы данных: выполнение db/schema.sql.
 * Запуск: npm run db:init            — только если таблиц ещё нет
 *         npm run db:init -- --force — пересоздать схему (ВСЕ ДАННЫЕ БУДУТ УДАЛЕНЫ)
 */
import fs from 'node:fs';
import { config } from '../src/config/config.js';
import { pool, closePool } from '../src/config/db.js';

const force = process.argv.includes('--force');

try {
  const { rows } = await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS exists");
  if (rows[0].exists && !force) {
    console.error('Схема уже создана. Для пересоздания (с удалением всех данных) выполните: npm run db:init -- --force');
    process.exitCode = 1;
  } else {
    const sql = fs.readFileSync(config.paths.schema, 'utf8');
    await pool.query(sql);
    console.log(`Схема базы данных ${config.db.database} создана.`);
  }
} catch (err) {
  console.error('Ошибка инициализации БД:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
