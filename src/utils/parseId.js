/**
 * Идентификатор из параметра маршрута или строки запроса.
 * @param {unknown} value
 * @returns {number|null} положительное целое или null, если значение некорректно
 */
export function parseId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null;
}
