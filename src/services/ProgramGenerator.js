import { Goal } from '../models/enums.js';
import { notImplemented } from './notImplemented.js';

/**
 * Генерация индивидуальной программы по профилю пользователя (ФТ-04).
 * Использует ExerciseSelector для подбора упражнений.
 */
export class ProgramGenerator {
  /**
   * Параметры нагрузки по цели тренировок (таблица 1.1, рекомендации ACSM).
   * intensity — % от 1ПМ, reps — диапазон повторений, restSec — отдых между подходами, с.
   */
  #loadTable = Object.freeze({
    [Goal.GENERAL]: { intensity: [60, 70], reps: [8, 12], restSec: [60, 120] },
    [Goal.HYPERTROPHY]: { intensity: [70, 85], reps: [6, 12], restSec: [60, 120] },
    [Goal.STRENGTH]: { intensity: [80, 100], reps: [1, 6], restSec: [120, 300] },
    [Goal.ENDURANCE]: { intensity: [0, 70], reps: [10, 25], restSec: [60, 120] },
  });

  /**
   * @param {import('../models/TrainingProfile.js').TrainingProfile} profile
   * @returns {Promise<import('../models/Program.js').Program>}
   */
  async generate(profile) {
    notImplemented('ProgramGenerator.generate');
  }

  /** Выбор схемы сплита по уровню и числу тренировок в неделю. */
  #selectSplit(level, days) {
    notImplemented('ProgramGenerator.selectSplit');
  }

  /** Подбор упражнений для схемы сплита с учётом инвентаря. */
  #pickExercises(split, equipment) {
    notImplemented('ProgramGenerator.pickExercises');
  }

  /** Расчёт стартового рабочего веса упражнения. */
  #calcStartWeight(exercise, profile) {
    notImplemented('ProgramGenerator.calcStartWeight');
  }
}
