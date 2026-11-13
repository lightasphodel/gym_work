import { notImplemented } from './notImplemented.js';

/**
 * Алгоритм адаптации рабочих весов (ФТ-05).
 * Методы соответствуют этапам декомпозиции блока «Адаптировать рабочие веса» (рисунок 1.5).
 */
export class WeightAdaptationService {
  /** Максимальное увеличение веса за один шаг (10 %, рекомендация ACSM 2–10 %). */
  #maxIncreasePct = 0.10;

  /** Число тренировок подряд ниже нижней границы диапазона, после которого вес снижается. */
  #failLimit = 2;

  /**
   * @param {import('../models/Workout.js').Workout} workout
   * @returns {Promise<import('../models/WeightHistory.js').WeightHistory[]>}
   */
  async adapt(workout) {
    notImplemented('WeightAdaptationService.adapt');
  }

  /** Этап 1. Оценка выполнения подходов относительно диапазона повторений. */
  #evaluateSets(sets, repsMin, repsMax) {
    notImplemented('WeightAdaptationService.evaluateSets');
  }

  /** Этап 3. Решение о корректировке с учётом предыдущих тренировок. */
  #decide(result, history) {
    notImplemented('WeightAdaptationService.decide');
  }

  /** Расчёт шага изменения веса. */
  #calcStep(exercise, weight) {
    notImplemented('WeightAdaptationService.calcStep');
  }

  /** Этап 4. Округление до значения, которое можно набрать доступным инвентарём. */
  #roundToEquipment(weight, equipment) {
    notImplemented('WeightAdaptationService.roundToEquipment');
  }
}
