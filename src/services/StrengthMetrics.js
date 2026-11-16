/** Округление до 0,1 (точность отображения силовых показателей). */
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Расчёт силовых показателей (ФТ-06, ФТ-07).
 * Используется сервисами WeightAdaptationService, RecordDetector и ProgressAnalytics.
 */
export class StrengthMetrics {
  /**
   * Оценка 1ПМ по формуле Б. Эпли (1.1): 1ПМ = W · (1 + r / 30).
   * @param {number} weight вес отягощения, кг
   * @param {number} reps   количество повторений
   * @returns {number} оценка 1ПМ, кг, с точностью до 0,1
   */
  epley(weight, reps) {
    return round1(weight * (1 + reps / 30));
  }

  /**
   * Оценка 1ПМ по формуле М. Бжицки (1.2): 1ПМ = W · 36 / (37 − r).
   * Формула определена при r < 37.
   * @param {number} weight вес отягощения, кг
   * @param {number} reps   количество повторений (меньше 37)
   * @returns {number} оценка 1ПМ, кг, с точностью до 0,1
   * @throws {RangeError} при r ≥ 37
   */
  brzycki(weight, reps) {
    if (reps >= 37) {
      throw new RangeError('Формула Бжицки применима при количестве повторений меньше 37');
    }
    return round1((weight * 36) / (37 - reps));
  }

  /**
   * Тоннаж (1.3): T = Σ Wi · ri.
   * @param {Array<{weight: number, reps: number}>} sets подходы (вес, кг; повторения)
   * @returns {number} тоннаж, кг, с точностью до 0,1
   */
  tonnage(sets) {
    return round1(sets.reduce((sum, s) => sum + s.weight * s.reps, 0));
  }
}
