import { PersonalRecord, ProgramExercise, RecordType } from '../models/index.js';
import { StrengthMetrics } from './StrengthMetrics.js';

/**
 * Автоматическое определение личных рекордов при сохранении тренировки (ФТ-09).
 */
export class RecordDetector {
  #metrics;

  /** @param {StrengthMetrics} [metrics] */
  constructor(metrics = new StrengthMetrics()) {
    this.#metrics = metrics;
  }

  /**
   * Новые личные рекорды тренировки. По каждому упражнению считаются наибольший вес,
   * наибольшее число повторений, наибольший расчётный 1ПМ (формула Эпли, 1.1) и тоннаж
   * упражнения за тренировку (1.3); значения сравниваются с текущими рекордами
   * PersonalRecord.findBest, превысившие сохраняются.
   * @param {import('../models/Workout.js').Workout} workout сохранённая тренировка с подходами
   * @returns {Promise<PersonalRecord[]>} новые рекорды (пустой массив, если их нет)
   */
  async detect(workout) {
    const dayExercises = await ProgramExercise.findByDay(workout.programDayId);
    const exerciseOf = new Map(dayExercises.map((pe) => [pe.id, pe.exerciseId]));

    // Подходы тренировки по упражнениям справочника.
    const byExercise = new Map();
    for (const set of workout.sets) {
      const exerciseId = exerciseOf.get(set.programExerciseId);
      if (exerciseId === undefined) continue;
      if (!byExercise.has(exerciseId)) byExercise.set(exerciseId, []);
      byExercise.get(exerciseId).push(set);
    }

    const records = [];
    for (const [exerciseId, sets] of byExercise) {
      const values = {
        [RecordType.MAX_WEIGHT]: Math.max(...sets.map((s) => Number(s.weight))),
        [RecordType.MAX_REPS]: Math.max(...sets.map((s) => s.reps)),
        [RecordType.MAX_1RM]: Math.max(...sets.map((s) => this.#metrics.epley(Number(s.weight), s.reps))),
        [RecordType.MAX_TONNAGE]: this.#metrics.tonnage(sets.map((s) => ({ weight: Number(s.weight), reps: s.reps }))),
      };
      const best = await PersonalRecord.findBest(workout.userId, exerciseId);
      for (const [type, value] of Object.entries(values)) {
        if (this.#isBetter(value, best.find((r) => r.type === type))) {
          records.push(await PersonalRecord.create({
            userId: workout.userId,
            exerciseId,
            type,
            value,
            achievedAt: workout.date,
          }));
        }
      }
    }
    return records;
  }

  /**
   * Новое значение лучше текущего рекорда: строго больше него; если рекорда ещё нет —
   * любое положительное значение (вес 0 у упражнений с собственным весом рекордом не считается).
   * @param {number} current значение в этой тренировке
   * @param {PersonalRecord|undefined} best текущий рекорд того же типа
   * @returns {boolean}
   */
  #isBetter(current, best) {
    if (!(current > 0)) return false;
    return best === undefined || current > Number(best.value);
  }
}
