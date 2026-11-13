import { notImplemented } from './notImplemented.js';

/**
 * Подбор упражнений по группе мышц, инвентарю и сложности (ФТ-12).
 */
export class ExerciseSelector {
  /**
   * @param {number} muscleId
   * @param {string|string[]} equipment
   * @param {number} difficulty
   * @returns {Promise<import('../models/Exercise.js').Exercise[]>}
   */
  async filter(muscleId, equipment, difficulty) {
    notImplemented('ExerciseSelector.filter');
  }

  /**
   * Предложение равноценной замены упражнения.
   * @param {number} exerciseId
   * @param {string|string[]} equipment
   * @returns {Promise<import('../models/Exercise.js').Exercise[]>}
   */
  async suggestReplacement(exerciseId, equipment) {
    notImplemented('ExerciseSelector.suggestReplacement');
  }
}
