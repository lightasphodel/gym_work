/**
 * Подключение к СУБД PostgreSQL.
 * Общий пул подключений, через который модели выполняют параметризованные SQL-запросы.
 */
import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// NUMERIC (вес, тоннаж, 1ПМ) -> number
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (результаты COUNT/SUM) -> number
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));
// DATE -> строка 'YYYY-MM-DD' (без сдвига часового пояса)
types.setTypeParser(types.builtins.DATE, (v) => v);

// Часовой пояс сессии СУБД совпадает с часовым поясом сервера приложения,
// чтобы значения TIMESTAMP (например, users.locked_until) сравнивались корректно.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const pool = new Pool({
  ...config.db,
  options: `-c TimeZone=${timeZone}`,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[БД] Ошибка простаивающего подключения:', err.message);
});

/**
 * Выполнить параметризованный запрос через пул.
 * @param {string} text SQL с плейсхолдерами $1, $2, ...
 * @param {unknown[]} [params]
 */
export function query(text, params = []) {
  return pool.query(text, params);
}

/**
 * Выполнить несколько запросов в одной транзакции.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Проверка доступности СУБД при запуске сервера. */
export async function checkConnection() {
  await pool.query('SELECT 1');
}

export async function closePool() {
  await pool.end();
}

/**
 * Формирование SET-части UPDATE из разрешённых полей объекта data.
 * @param {Record<string, string>} fieldMap соответствие «свойство модели → столбец таблицы»
 * @param {Record<string, unknown>} data   изменяемые значения (неизвестные свойства игнорируются)
 * @param {unknown[]} params               массив параметров запроса (дополняется)
 * @returns {string} например "title = $1, goal = $2" или пустая строка
 */
export function buildSet(fieldMap, data, params) {
  const parts = [];
  for (const [prop, column] of Object.entries(fieldMap)) {
    if (data[prop] !== undefined) {
      params.push(data[prop]);
      parts.push(`${column} = $${params.length}`);
    }
  }
  return parts.join(', ');
}
