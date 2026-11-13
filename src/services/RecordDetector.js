import { notImplemented } from './notImplemented.js';

/**
 * Автоматическое определение личных рекордов (ФТ-09).
 */
export class RecordDetector {
  /**
   * @param {import('../models/Workout.js').Workout} workout
   * @returns {Promise<import('../models/PersonalRecord.js').PersonalRecord[]>}
   */
  async detect(workout) {
    notImplemented('RecordDetector.detect');
  }

  /** Новое значение лучше текущего рекорда. */
  #isBetter(current, best) {
    notImplemented('RecordDetector.isBetter');
  }
}
