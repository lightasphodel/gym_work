/**
 * Преобразование объекта модели в простой объект для JSON-ответа.
 *
 * Атрибуты моделей закрыты (#-поля), поэтому JSON.stringify(model) даёт «{}».
 * Функция собирает значения get-аксессоров прототипа (и его предков) — то есть
 * ровно то, что класс разрешает читать снаружи. Значения-Buffer (двоичные данные
 * медиафайлов) пропускаются. Свойства без геттера (User.passwordHash и т. п.)
 * в результат не попадают.
 *
 * Массивы обрабатываются поэлементно, вложенные модели — рекурсивно;
 * Date, простые объекты и примитивы возвращаются как есть.
 *
 * @param {unknown} value модель, массив моделей или любое значение
 * @returns {unknown}
 */
export function toPlain(value) {
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    return value;
  }

  const result = {};
  for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(p))) {
      if (typeof descriptor.get !== 'function' || name in result) continue;
      const v = value[name];
      if (Buffer.isBuffer(v)) continue;
      result[name] = toPlain(v);
    }
  }
  return result;
}
