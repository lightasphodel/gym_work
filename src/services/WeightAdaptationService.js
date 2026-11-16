import {
  Program, ProgramExercise, Exercise, WorkoutSet, WeightHistory, Decision, Goal,
} from '../models/index.js';
import { StrengthMetrics } from './StrengthMetrics.js';

/**
 * Результат оценки выполнения подходов относительно целевого диапазона повторений:
 * ABOVE — во всех подходах достигнута верхняя граница; BELOW — хотя бы в одном подходе
 * повторений меньше нижней границы; WITHIN — остальные случаи.
 * @typedef {'ABOVE'|'WITHIN'|'BELOW'} Result
 */

/** Верхняя граница интенсивности по цели тренировок, доля 1ПМ (таблица 1.1). */
const INTENSITY_MAX = Object.freeze({
  [Goal.GENERAL]: 0.70,
  [Goal.HYPERTROPHY]: 0.85,
  [Goal.STRENGTH]: 1.00,
  [Goal.ENDURANCE]: 0.70,
});

/** Минимальное изменение веса, которое можно набрать инвентарём, кг (0 — вес не меняется). */
const EQUIPMENT_STEP = Object.freeze({
  'штанга': 2.5,
  'гантели': 1,
  'тренажёр': 5,
  'собственный вес': 0,
});

/** Минимальный шаг увеличения — 2 % текущего веса (нижняя граница рекомендации ACSM 2–10 %). */
const MIN_INCREASE_PCT = 0.02;

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Алгоритм адаптации рабочих весов (ФТ-05).
 * Методы соответствуют этапам декомпозиции блока «Адаптировать рабочие веса» (рисунок 1.5):
 * evaluateSets — оценить выполнение подходов; StrengthMetrics — рассчитать 1ПМ;
 * decide и calcStep — определить корректировку; roundToEquipment — рассчитать рабочий вес.
 */
export class WeightAdaptationService {
  /** Максимальное изменение веса за один шаг (10 %, рекомендация ACSM 2–10 %). */
  #maxIncreasePct = 0.10;

  /** Число тренировок подряд ниже нижней границы диапазона, после которого вес снижается. */
  #failLimit = 2;

  #metrics;

  /** @param {StrengthMetrics} [metrics] */
  constructor(metrics = new StrengthMetrics()) {
    this.#metrics = metrics;
  }

  /**
   * Адаптация рабочих весов по результатам тренировки. Обрабатываются упражнения,
   * в которых внесены все рабочие подходы (не меньше запланированных). Для каждого:
   * оценка подходов, решение с учётом прошлых тренировок, расчёт и округление нового
   * веса с проверкой по 1ПМ, сохранение веса (ProgramExercise.updateWeight) и записи
   * истории (WeightHistory.create).
   * @param {import('../models/Workout.js').Workout} workout сохранённая тренировка с подходами
   * @returns {Promise<WeightHistory[]>} записи истории по обработанным упражнениям
   */
  async adapt(workout) {
    const [dayExercises, program] = await Promise.all([
      ProgramExercise.findByDay(workout.programDayId),
      Program.findActive(workout.userId),
    ]);
    const intensityMax = INTENSITY_MAX[program?.goal] ?? INTENSITY_MAX[Goal.GENERAL];
    // Этап 2. Оценка 1ПМ подхода — среднее формул Эпли (1.1) и Бжицки (1.2); при r ≥ 37 — Эпли.
    const estimate1RM = (weight, reps) => {
      if (!(weight > 0)) return 0;
      const epley = this.#metrics.epley(weight, reps);
      return reps < 37 ? (epley + this.#metrics.brzycki(weight, reps)) / 2 : epley;
    };

    const result = [];
    for (const pe of dayExercises) {
      const sets = workout.sets.filter((s) => s.programExerciseId === pe.id);
      if (sets.length === 0 || sets.length < pe.sets) continue; // внесены не все рабочие подходы

      const exercise = await Exercise.findById(pe.exerciseId);
      if (!exercise) continue;

      // Этап 1. Оценка выполнения подходов.
      const evaluation = this.#evaluateSets(sets, pe.repsMin, pe.repsMax);

      // Прошлые тренировки в этом упражнении (без текущей), от новых к старым.
      const past = await WorkoutSet.findHistory(pe.id, this.#failLimit);
      const pastByWorkout = new Map();
      for (const s of past) {
        if (s.workoutId === workout.id) continue;
        if (!pastByWorkout.has(s.workoutId)) pastByWorkout.set(s.workoutId, []);
        pastByWorkout.get(s.workoutId).push(s);
      }
      const history = [...pastByWorkout.values()].map((list) => this.#evaluateSets(list, pe.repsMin, pe.repsMax));

      // Этап 3. Решение о корректировке.
      let decision = this.#decide(evaluation, history);

      // Текущий вес: рабочий вес программы, а если он не задан (0) — наибольший вес подходов.
      const oldWeight = Number(pe.workingWeight);
      const base = oldWeight > 0 ? oldWeight : Math.max(...sets.map((s) => Number(s.weight)));
      let newWeight = base;

      if (decision !== Decision.KEEP) {
        // Оценка 1ПМ по лучшему подходу.
        const e1rm = Math.max(...sets.map((s) => estimate1RM(Number(s.weight), s.reps)));
        const weighted = Number(exercise.weightStep) > 0;

        // Этап 4. Шаг, проверка по 1ПМ и округление до инвентаря.
        let target = decision === Decision.INCREASE
          ? base + this.#calcStep(exercise, base)
          : base - Math.max(Number(exercise.weightStep), base * this.#maxIncreasePct);
        if (weighted && e1rm > 0) target = Math.min(target, e1rm * intensityMax);
        newWeight = Math.max(0, this.#roundToEquipment(Math.max(0, target), exercise.equipment));

        // Вес с отягощением не изменился (предел 10 %, граница 1ПМ или шаг инвентаря) — сохранить.
        if (weighted && (newWeight === base || (decision === Decision.INCREASE && newWeight < base))) {
          decision = Decision.KEEP;
          newWeight = base;
        }
        if (!weighted) newWeight = base; // собственный вес: растёт число повторений, а не вес
      }

      if (newWeight !== oldWeight) await pe.updateWeight(newWeight);
      result.push(await WeightHistory.create({
        programExerciseId: pe.id,
        oldWeight,
        newWeight,
        decision,
        date: workout.date,
      }));
    }
    return result;
  }

  /**
   * Этап 1. Оценка выполнения подходов относительно диапазона повторений.
   * @param {Array<{reps: number}>} sets подходы упражнения в одной тренировке
   * @param {number} repsMin нижняя граница диапазона
   * @param {number} repsMax верхняя граница диапазона
   * @returns {Result}
   */
  #evaluateSets(sets, repsMin, repsMax) {
    if (sets.some((s) => s.reps < repsMin)) return 'BELOW';
    if (sets.every((s) => s.reps >= repsMax)) return 'ABOVE';
    return 'WITHIN';
  }

  /**
   * Этап 3. Решение о корректировке: ABOVE — увеличить; BELOW в failLimit тренировках
   * подряд (текущая и предыдущие) — снизить; иначе сохранить.
   * @param {Result} result оценка текущей тренировки
   * @param {Result[]} history оценки предыдущих тренировок, от новых к старым
   * @returns {string} значение перечисления Decision
   */
  #decide(result, history) {
    if (result === 'ABOVE') return Decision.INCREASE;
    if (result === 'BELOW') {
      const previous = history.slice(0, this.#failLimit - 1);
      if (previous.length === this.#failLimit - 1 && previous.every((r) => r === 'BELOW')) {
        return Decision.DECREASE;
      }
    }
    return Decision.KEEP;
  }

  /**
   * Шаг увеличения веса: не меньше шага упражнения и 2 % текущего веса,
   * не больше maxIncreasePct (10 %) текущего веса. Для упражнений без отягощения — 0.
   * @param {Exercise} exercise
   * @param {number} weight текущий рабочий вес, кг
   * @returns {number} шаг, кг
   */
  #calcStep(exercise, weight) {
    const step = Number(exercise.weightStep);
    if (!(step > 0)) return 0;
    return Math.min(Math.max(step, weight * MIN_INCREASE_PCT), weight * this.#maxIncreasePct);
  }

  /**
   * Этап 4. Округление до ближайшего значения, которое можно набрать инвентарём и которое
   * не больше расчётного (рост не превышает 10 % и границу по 1ПМ): штанга — кратно 2,5 кг,
   * гантели — 1 кг, тренажёр — 5 кг; собственный вес — без изменения.
   * @param {number} weight расчётный вес, кг
   * @param {string} equipment инвентарь упражнения
   * @returns {number}
   */
  #roundToEquipment(weight, equipment) {
    const step = EQUIPMENT_STEP[equipment] ?? 0.5;
    if (step === 0) return weight;
    // Допуск 1e-9 защищает от погрешности двоичного представления (82.49999… → 82.5).
    return round2(Math.floor(weight / step + 1e-9) * step);
  }
}
