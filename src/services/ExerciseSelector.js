import { Exercise } from '../models/index.js';

/**
 * Упражнения с основной группой мышц muscleId — первыми, затем те,
 * где группа вспомогательная. Внутри групп сохраняется порядок справочника.
 * @param {Exercise[]} list
 * @param {number} muscleId
 */
function primaryFirst(list, muscleId) {
  return [
    ...list.filter((e) => e.primaryMuscleId === muscleId),
    ...list.filter((e) => e.primaryMuscleId !== muscleId),
  ];
}

/**
 * Подбор упражнений по группе мышц, инвентарю и сложности (ФТ-12).
 */
export class ExerciseSelector {
  /**
   * Активные упражнения на группу мышц с доступным инвентарём не сложнее заданного уровня.
   * Сначала идут упражнения, для которых группа — основная.
   * @param {number} muscleId группа мышц (основная или вспомогательная)
   * @param {string|string[]} equipment доступный инвентарь (один вид или список)
   * @param {number} difficulty максимальная сложность техники (1–3, включительно)
   * @returns {Promise<Exercise[]>}
   */
  async filter(muscleId, equipment, difficulty) {
    const list = await Exercise.search({ muscleId, equipment, difficulty });
    return primaryFirst(list, muscleId);
  }

  /**
   * Равноценная замена упражнения: активные упражнения на ту же основную группу мышц
   * с доступным инвентарём (сначала с той же основной группой, затем с этой группой
   * среди вспомогательных). Само упражнение в список не входит.
   * @param {number} exerciseId заменяемое упражнение
   * @param {string|string[]} [equipment] доступный инвентарь; не задан — любой
   * @returns {Promise<Exercise[]>} пустой массив, если упражнение не найдено
   */
  async suggestReplacement(exerciseId, equipment) {
    const exercise = await Exercise.findById(exerciseId);
    if (!exercise) return [];
    const filter = { muscleId: exercise.primaryMuscleId };
    if (equipment !== undefined && equipment !== null && equipment.length !== 0) {
      filter.equipment = equipment;
    }
    const list = await Exercise.search(filter);
    return primaryFirst(list.filter((e) => e.id !== exercise.id), exercise.primaryMuscleId);
  }
}
