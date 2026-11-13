/**
 * Расчёт силовых показателей (ФТ-06, ФТ-07).
 * Используется сервисами WeightAdaptationService, RecordDetector и ProgressAnalytics.
 */
export class StrengthMetrics {
  /**
   * Оценка 1ПМ по формуле Б. Эпли (1.1): 1ПМ = W · (1 + r / 30).
   * @param {number} weight вес отягощения, кг
   * @param {number} reps   количество повторений
   * @returns {number}
   */
  epley(weight, reps) {
    return weight * (1 + reps / 30);
  }

  /**
   * Оценка 1ПМ по формуле М. Бжицки (1.2): 1ПМ = W · 36 / (37 − r).
   * Формула определена при r < 37.
   * @param {number} weight вес отягощения, кг
   * @param {number} reps   количество повторений
   * @returns {number}
   */
  brzycki(weight, reps) {
    if (reps >= 37) {
      throw new RangeError('Формула Бжицки применима при количестве повторений меньше 37');
    }
    return (weight * 36) / (37 - reps);
  }

  /**
   * Тоннаж (1.3): T = Σ Wi · ri.
   * @param {Array<{weight: number, reps: number}>} sets
   * @returns {number}
   */
  tonnage(sets) {
    return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
  }
}
