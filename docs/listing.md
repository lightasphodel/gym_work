# Листинг классов пакета services

Файл сформирован командой `npm run docs:listing` из каталога `src/services`; не редактировать вручную.

## Листинг 1 — StrengthMetrics.js

Класс `StrengthMetrics` — расчёт 1ПМ (формулы 1.1, 1.2) и тоннажа (1.3). Файл `src/services/StrengthMetrics.js`, строк: 42.

```js
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
```

## Листинг 2 — WeightAdaptationService.js

Класс `WeightAdaptationService` — алгоритм адаптации рабочих весов (ФТ-05). Файл `src/services/WeightAdaptationService.js`, строк: 198.

```js
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

        // Вес с отягощением не изменился (граница по 1ПМ или округление до инвентаря) — сохранить.
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
   * Шаг увеличения веса: 2–10 % текущего веса (рекомендация ACSM), но не меньше шага
   * упражнения. Если 10 % меньше шага упражнения (малый вес: тренажёр до 50 кг, штанга
   * до 25 кг, гантели до 10 кг), вес растёт ровно на один шаг — меньшее изменение
   * инвентарём не набрать. Для упражнений без отягощения — 0.
   * @param {Exercise} exercise
   * @param {number} weight текущий рабочий вес, кг
   * @returns {number} шаг, кг
   */
  #calcStep(exercise, weight) {
    const step = Number(exercise.weightStep);
    if (!(step > 0)) return 0;
    const byPercent = Math.min(Math.max(step, weight * MIN_INCREASE_PCT), weight * this.#maxIncreasePct);
    return Math.max(byPercent, step);
  }

  /**
   * Этап 4. Округление до ближайшего значения, которое можно набрать инвентарём и которое
   * не больше расчётного (рост не превышает шаг calcStep и границу по 1ПМ): штанга — кратно 2,5 кг,
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
```

## Листинг 3 — RecordDetector.js

Класс `RecordDetector` — определение личных рекордов (ФТ-09). Файл `src/services/RecordDetector.js`, строк: 71.

```js
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
```

## Листинг 4 — ProgramGenerator.js

Класс `ProgramGenerator` — генерация тренировочной программы (ФТ-04). Файл `src/services/ProgramGenerator.js`, строк: 263.

```js
import { Program, MuscleGroup, Goal, Level, ProgramStatus } from '../models/index.js';
import { goalNames } from '../config/dictionaries.js';
import { ExerciseSelector } from './ExerciseSelector.js';

/**
 * Схема сплита — распределение групп мышц по тренировочным дням.
 * @typedef {object} Split
 * @property {string} name          название схемы
 * @property {number} maxDifficulty максимальная сложность техники упражнений (по уровню подготовки)
 * @property {Array<{title: string, muscles: string[]}>} days дни; muscles — группы мышц
 *           (по одному упражнению на элемент; повтор группы — второе упражнение на неё)
 */

/** Инвентарь, который есть всегда: упражнения с собственным весом. */
const BODYWEIGHT = 'собственный вес';

/** Максимальная сложность техники по уровню подготовки. */
const MAX_DIFFICULTY = Object.freeze({
  [Level.BEGINNER]: 1,
  [Level.INTERMEDIATE]: 2,
  [Level.ADVANCED]: 3,
});

const FULL_BODY = Object.freeze(['Квадрицепс', 'Грудь', 'Спина', 'Бицепс бедра', 'Передняя дельта', 'Пресс']);
const UPPER = Object.freeze(['Грудь', 'Спина', 'Передняя дельта', 'Средняя дельта', 'Бицепс', 'Трицепс']);
const LOWER = Object.freeze(['Квадрицепс', 'Бицепс бедра', 'Ягодицы', 'Икры', 'Пресс']);

/** Сплит по группам мышц (5–6 тренировок в неделю). */
const MUSCLE_SPLIT_DAYS = Object.freeze([
  { title: 'Грудь и трицепс', muscles: ['Грудь', 'Грудь', 'Трицепс', 'Трицепс'] },
  { title: 'Спина и бицепс', muscles: ['Спина', 'Спина', 'Бицепс', 'Бицепс'] },
  { title: 'Ноги', muscles: ['Квадрицепс', 'Квадрицепс', 'Бицепс бедра', 'Икры'] },
  { title: 'Плечи', muscles: ['Передняя дельта', 'Средняя дельта', 'Задняя дельта'] },
  { title: 'Ягодицы и пресс', muscles: ['Ягодицы', 'Бицепс бедра', 'Пресс', 'Пресс'] },
  { title: 'Ноги — B', muscles: ['Квадрицепс', 'Бицепс бедра', 'Ягодицы', 'Икры'] },
]);

/**
 * Коэффициенты стартового рабочего веса — доля массы тела по группе мышц
 * для уровней [BEGINNER, INTERMEDIATE, ADVANCED] (упражнение со штангой или в тренажёре).
 */
const START_COEFFICIENTS = Object.freeze({
  'Квадрицепс': [0.5, 0.8, 1.1],
  'Ягодицы': [0.5, 0.8, 1.1],
  'Икры': [0.5, 0.8, 1.1],
  'Бицепс бедра': [0.4, 0.6, 0.85],
  'Грудь': [0.4, 0.6, 0.85],
  'Спина': [0.4, 0.6, 0.85],
  'Передняя дельта': [0.25, 0.4, 0.55],
  'Средняя дельта': [0.06, 0.09, 0.12],
  'Задняя дельта': [0.06, 0.09, 0.12],
  'Бицепс': [0.15, 0.25, 0.35],
  'Трицепс': [0.15, 0.25, 0.35],
  'Пресс': [0, 0, 0],
});
const DEFAULT_COEFFICIENTS = Object.freeze([0.2, 0.3, 0.4]);
const LEVEL_INDEX = Object.freeze({ [Level.BEGINNER]: 0, [Level.INTERMEDIATE]: 1, [Level.ADVANCED]: 2 });

/** Поправка на инвентарь: для гантелей вес указывается на одну гантель. */
const EQUIPMENT_FACTOR = Object.freeze({
  'штанга': 1,
  'тренажёр': 1,
  'гантели': 0.4,
  [BODYWEIGHT]: 0,
});

/** Ошибка, понятная пользователю: status — код HTTP-ответа (400, 422). */
function userError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Генерация индивидуальной программы по профилю пользователя (ФТ-04).
 * Использует ExerciseSelector для подбора упражнений.
 */
export class ProgramGenerator {
  /**
   * Параметры нагрузки по цели тренировок — таблица 1.1 записки (рекомендации ACSM):
   * intensity — % от 1ПМ, reps — диапазон повторений, restSec — отдых между подходами, с
   * (середина диапазона таблицы). sets — число подходов по уровню подготовки
   * (дополнение к таблице 1.1).
   */
  #loadTable = Object.freeze({
    goals: Object.freeze({
      [Goal.GENERAL]: { intensity: [60, 70], reps: [8, 12], restSec: 90 },
      [Goal.HYPERTROPHY]: { intensity: [70, 85], reps: [6, 12], restSec: 90 },
      [Goal.STRENGTH]: { intensity: [80, 100], reps: [1, 6], restSec: 180 },
      [Goal.ENDURANCE]: { intensity: [0, 70], reps: [10, 25], restSec: 60 },
    }),
    sets: Object.freeze({
      [Level.BEGINNER]: 3,
      [Level.INTERMEDIATE]: 4,
      [Level.ADVANCED]: 5,
    }),
  });

  #selector;

  /** @param {ExerciseSelector} [selector] */
  constructor(selector = new ExerciseSelector()) {
    this.#selector = selector;
  }

  /**
   * Генерация программы: проверка профиля, выбор сплита, подбор упражнений,
   * расчёт подходов, повторений, отдыха (таблица 1.1) и стартовых весов.
   * Программа сохраняется одним вызовом Program.create в статусе DRAFT —
   * пользователь просматривает её, при необходимости меняет упражнения и веса и активирует.
   * @param {import('../models/TrainingProfile.js').TrainingProfile} profile тренировочный профиль
   * @returns {Promise<Program>} программа-черновик
   * @throws {Error} status 400 — профиль не заполнен; 422 — для дня не нашлось упражнений
   */
  async generate(profile) {
    if (!profile?.isComplete()) {
      throw userError(400, 'Заполните тренировочный профиль: цель, уровень, число тренировок в неделю и массу тела');
    }
    const load = this.#loadTable.goals[profile.goal];
    const sets = this.#loadTable.sets[profile.level];
    const split = this.#selectSplit(profile.level, profile.workoutsPerWeek);
    const picked = await this.#pickExercises(split, profile.equipment);

    const days = [];
    let slot = 0;
    for (const [index, day] of split.days.entries()) {
      const exercises = [];
      for (let i = 0; i < day.muscles.length; i += 1) {
        const exercise = picked[slot++];
        if (!exercise) continue; // для группы нет упражнения с доступным инвентарём
        exercises.push({
          exerciseId: exercise.id,
          orderNo: exercises.length + 1,
          sets,
          repsMin: load.reps[0],
          repsMax: load.reps[1],
          restSec: load.restSec,
          workingWeight: await this.#calcStartWeight(exercise, profile),
        });
      }
      if (exercises.length === 0) {
        throw userError(422,
          `Для дня «${day.title}» не нашлось упражнений с выбранным инвентарём. Отметьте в профиле больше видов инвентаря`);
      }
      days.push({ dayNumber: index + 1, title: day.title, exercises });
    }

    return Program.create({
      ownerId: profile.userId,
      title: `${split.name} — ${goalNames[profile.goal] ?? profile.goal}`,
      goal: profile.goal,
      level: profile.level,
      isTemplate: false,
      status: ProgramStatus.DRAFT,
      days,
    });
  }

  /**
   * Выбор схемы сплита по числу тренировок в неделю: 2–3 — на всё тело,
   * 4 — верх / низ, 5 и более — по группам мышц. Уровень задаёт сложность упражнений.
   * @param {string} level
   * @param {number} days
   * @returns {Split}
   */
  #selectSplit(level, days) {
    const maxDifficulty = MAX_DIFFICULTY[level] ?? 1;
    const letters = ['A', 'B', 'C'];
    if (days <= 3) {
      const count = Math.max(1, days);
      return {
        name: 'Всё тело',
        maxDifficulty,
        days: letters.slice(0, count).map((l) => ({ title: `Всё тело — ${l}`, muscles: [...FULL_BODY] })),
      };
    }
    if (days === 4) {
      return {
        name: 'Верх / низ',
        maxDifficulty,
        days: [
          { title: 'Верх тела — A', muscles: [...UPPER] },
          { title: 'Низ тела — A', muscles: [...LOWER] },
          { title: 'Верх тела — B', muscles: [...UPPER] },
          { title: 'Низ тела — B', muscles: [...LOWER] },
        ],
      };
    }
    return {
      name: 'Сплит по группам мышц',
      maxDifficulty,
      days: MUSCLE_SPLIT_DAYS.slice(0, Math.min(days, MUSCLE_SPLIT_DAYS.length))
        .map((d) => ({ title: d.title, muscles: [...d.muscles] })),
    };
  }

  /**
   * Подбор упражнений для схемы сплита. Результат идёт в порядке групп мышц
   * split.days[].muscles[]: по одному элементу на группу; null — подходящего упражнения нет.
   * Упражнения с собственным весом доступны всегда. Если по сложности уровня упражнений нет,
   * берутся самые простые из доступных. Варианты чередуются по дням, внутри дня не повторяются.
   * @param {Split} split
   * @param {string[]} equipment инвентарь из профиля
   * @returns {Promise<Array<import('../models/Exercise.js').Exercise|null>>}
   */
  async #pickExercises(split, equipment) {
    const muscles = await MuscleGroup.findAll();
    const idByName = new Map(muscles.map((m) => [m.name, m.id]));
    const available = [...new Set([...(equipment ?? []), BODYWEIGHT])];

    const cache = new Map();
    const candidatesFor = async (muscleId) => {
      if (!cache.has(muscleId)) {
        let list = await this.#selector.filter(muscleId, available, split.maxDifficulty);
        if (list.length === 0) {
          const any = await this.#selector.filter(muscleId, available, 3);
          const easiest = Math.min(...any.map((e) => e.difficulty));
          list = any.filter((e) => e.difficulty === easiest);
        }
        cache.set(muscleId, list);
      }
      return cache.get(muscleId);
    };

    const result = [];
    for (const [dayIndex, day] of split.days.entries()) {
      const used = new Set();
      for (const name of day.muscles) {
        const muscleId = idByName.get(name);
        const candidates = muscleId ? await candidatesFor(muscleId) : [];
        const free = candidates.filter((e) => !used.has(e.id));
        // Сначала упражнения, где группа основная; вспомогательная — запасной вариант.
        const primary = free.filter((e) => e.primaryMuscleId === muscleId);
        const pool = primary.length ? primary : free;
        const exercise = pool.length ? pool[dayIndex % pool.length] : null;
        if (exercise) used.add(exercise.id);
        result.push(exercise);
      }
    }
    return result;
  }

  /**
   * Стартовый рабочий вес: масса тела × коэффициент (уровень, группа мышц) × поправка
   * на инвентарь, округление до шага изменения веса упражнения. Для упражнений
   * с собственным весом (шаг 0) — 0. Пользователь может изменить вес до активации программы.
   * @param {import('../models/Exercise.js').Exercise} exercise
   * @param {import('../models/TrainingProfile.js').TrainingProfile} profile
   * @returns {Promise<number>}
   */
  async #calcStartWeight(exercise, profile) {
    const step = Number(exercise.weightStep);
    if (!(step > 0)) return 0;
    const muscles = await MuscleGroup.findAll();
    const muscle = muscles.find((m) => m.id === exercise.primaryMuscleId);
    const coefficient = (START_COEFFICIENTS[muscle?.name] ?? DEFAULT_COEFFICIENTS)[LEVEL_INDEX[profile.level] ?? 0];
    const factor = EQUIPMENT_FACTOR[exercise.equipment] ?? 1;
    const raw = Number(profile.bodyWeight) * coefficient * factor;
    if (!(raw > 0)) return 0;
    const rounded = Math.max(step, Math.round(raw / step) * step);
    return Math.round(rounded * 100) / 100;
  }
}
```

## Листинг 5 — ExerciseSelector.js

Класс `ExerciseSelector` — подбор упражнений и замена (ФТ-12). Файл `src/services/ExerciseSelector.js`, строк: 51.

```js
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
```

## Листинг 6 — ProgressAnalytics.js

Класс `ProgressAnalytics` — статистика прогресса, тоннаж, баланс нагрузки, регулярность (ФТ-07, 08, 10, 11). Файл `src/services/ProgressAnalytics.js`, строк: 268.

```js
import {
  Workout, ProgramExercise, Exercise, MuscleGroup, TrainingProfile, Program, ProgramDay,
} from '../models/index.js';
import { StrengthMetrics } from './StrengthMetrics.js';

/**
 * Ряды силового прогресса по упражнению (для графиков).
 * @typedef {object} Series
 * @property {number} exerciseId
 * @property {string[]} labels        даты тренировок 'YYYY-MM-DD'
 * @property {number[]} workingWeight наибольший вес подхода в упражнении, кг
 * @property {number[]} e1rm          наибольший расчётный 1ПМ (формула Эпли), кг
 * @property {number[]} tonnage       тоннаж упражнения за тренировку, кг
 */

/**
 * Баланс нагрузки по группам мышц за неделю.
 * @typedef {object} BalanceReport
 * @property {string} from начало недели (понедельник)
 * @property {string} to   конец недели (воскресенье)
 * @property {number} threshold порог дисбаланса (отношение числа подходов)
 * @property {Array<{muscleId: number, name: string, sets: number, tonnage: number}>} groups
 * @property {Array<{first: string, second: string, firstSets: number, secondSets: number,
 *           ratio: number|null, warning: string|null}>} pairs пары мышц-антагонистов
 */

/**
 * Показатели регулярности занятий.
 * @typedef {object} Regularity
 * @property {Array<{date: string, completed: boolean}>} calendar даты тренировок
 * @property {number} streak подряд недель с выполненным планом
 * @property {number|null} completionPct процент выполнения программы (нет активной — null)
 * @property {number|null} planPerWeek запланировано тренировок в неделю
 * @property {string|null} since дата, с которой считается выполнение программы
 */

/** Порог дисбаланса: подходов на одну мышцу пары больше, чем на антагониста, более чем в 1,5 раза. */
const BALANCE_THRESHOLD = 1.5;

/** Окно календаря и серии, недель. */
const REGULARITY_WEEKS = 52;

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Локальная дата 'YYYY-MM-DD' (Date или строка из БД). */
function toISO(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
const today = () => toISO(new Date());
const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => fromMs(dayMs(iso) + n * DAY_MS);
/** Понедельник недели, содержащей дату. */
const weekStart = (iso) => addDays(iso, -((new Date(dayMs(iso)).getUTCDay() + 6) % 7));

/** Ошибка, понятная пользователю (статус ответа). */
function userError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Определитель упражнения справочника для подхода тренировки:
 * подход → упражнение программы (ProgramExercise.findByDay дня тренировки) → exerciseId.
 * @param {Workout[]} workouts
 * @returns {Promise<(workout: Workout, set: import('../models/WorkoutSet.js').WorkoutSet) => number|undefined>}
 */
async function exerciseResolver(workouts) {
  const byDay = new Map();
  for (const w of workouts) {
    if (byDay.has(w.programDayId)) continue;
    const list = await ProgramExercise.findByDay(w.programDayId);
    byDay.set(w.programDayId, new Map(list.map((pe) => [pe.id, pe.exerciseId])));
  }
  return (workout, set) => byDay.get(workout.programDayId)?.get(set.programExerciseId);
}

/**
 * Статистика силового прогресса, баланс нагрузки и регулярность (ФТ-07, ФТ-08, ФТ-10, ФТ-11).
 */
export class ProgressAnalytics {
  #metrics;

  /** @param {StrengthMetrics} [metrics] */
  constructor(metrics = new StrengthMetrics()) {
    this.#metrics = metrics;
  }

  /**
   * Ряды рабочего веса, расчётного 1ПМ и тоннажа по упражнению за период (ФТ-08).
   * Точка ряда — дата тренировки с этим упражнением; несколько тренировок за день объединяются.
   * @param {number} userId
   * @param {number} exerciseId упражнение справочника
   * @param {string} from начало периода 'YYYY-MM-DD' (включительно)
   * @param {string} to   конец периода 'YYYY-MM-DD' (включительно)
   * @returns {Promise<Series>}
   */
  async getProgress(userId, exerciseId, from, to) {
    const workouts = await Workout.findByPeriod(userId, from, to);
    const exerciseOf = await exerciseResolver(workouts);
    const byDate = new Map();
    for (const w of workouts) {
      const sets = w.sets
        .filter((s) => exerciseOf(w, s) === exerciseId)
        .map((s) => ({ weight: Number(s.weight), reps: s.reps }));
      if (sets.length === 0) continue;
      const date = toISO(w.date);
      const point = byDate.get(date) ?? { weight: 0, e1rm: 0, tonnage: 0 };
      point.weight = Math.max(point.weight, ...sets.map((s) => s.weight));
      point.e1rm = Math.max(point.e1rm, ...sets.map((s) => this.#metrics.epley(s.weight, s.reps)));
      point.tonnage = round(point.tonnage + this.#metrics.tonnage(sets), 1);
      byDate.set(date, point);
    }
    const labels = [...byDate.keys()].sort();
    return {
      exerciseId,
      labels,
      workingWeight: labels.map((d) => byDate.get(d).weight),
      e1rm: labels.map((d) => byDate.get(d).e1rm),
      tonnage: labels.map((d) => byDate.get(d).tonnage),
    };
  }

  /**
   * Тоннаж (формула 1.3) за последнюю тренировку, текущую неделю или текущий месяц (ФТ-07).
   * @param {number} userId
   * @param {'workout'|'week'|'month'} period
   * @returns {Promise<number>} тоннаж, кг
   * @throws {Error} status 400 — неизвестный период
   */
  async getTonnage(userId, period) {
    const t = today();
    let from;
    if (period === 'workout') from = addDays(weekStart(t), -7 * (REGULARITY_WEEKS - 1));
    else if (period === 'week') from = weekStart(t);
    else if (period === 'month') from = `${t.slice(0, 8)}01`;
    else throw userError(400, 'Период — workout, week или month');

    const workouts = await Workout.findByPeriod(userId, from, t);
    if (period === 'workout') {
      return workouts.length ? Number(workouts[workouts.length - 1].tonnage) : 0;
    }
    return round(workouts.reduce((sum, w) => sum + Number(w.tonnage), 0), 2);
  }

  /**
   * Баланс нагрузки за неделю (ФТ-10): число рабочих подходов и тоннаж по группам мышц
   * (по основной группе упражнения) и сравнение мышц-антагонистов. Предупреждение —
   * если подходов на одну мышцу пары больше, чем на другую, более чем в BALANCE_THRESHOLD раз
   * или нагрузка есть только на одну мышцу пары.
   * @param {number} userId
   * @param {string} [week] любая дата недели 'YYYY-MM-DD'; по умолчанию — текущая неделя
   * @returns {Promise<BalanceReport>}
   */
  async analyzeBalance(userId, week) {
    const from = weekStart(week ?? today());
    const to = addDays(from, 6);
    const [workouts, muscles, catalog] = await Promise.all([
      Workout.findByPeriod(userId, from, to),
      MuscleGroup.findAll(),
      Exercise.search({ includeInactive: true }),
    ]);
    const exerciseOf = await exerciseResolver(workouts);
    const muscleOfExercise = new Map(catalog.map((e) => [e.id, e.primaryMuscleId]));

    const totals = new Map(muscles.map((m) => [m.id, { sets: 0, tonnage: 0 }]));
    for (const w of workouts) {
      for (const s of w.sets) {
        const total = totals.get(muscleOfExercise.get(exerciseOf(w, s)));
        if (!total) continue;
        total.sets += 1;
        total.tonnage = round(total.tonnage + Number(s.weight) * s.reps, 1);
      }
    }

    const byId = new Map(muscles.map((m) => [m.id, m]));
    const pairs = [];
    const seen = new Set();
    for (const m of muscles) {
      const other = byId.get(m.antagonistId);
      if (!other || seen.has(m.id) || seen.has(other.id)) continue;
      seen.add(m.id);
      seen.add(other.id);
      const a = totals.get(m.id).sets;
      const b = totals.get(other.id).sets;
      let ratio = null;
      let warning = null;
      if (a > 0 && b > 0) {
        ratio = round(Math.max(a, b) / Math.min(a, b), 2);
        if (ratio > BALANCE_THRESHOLD) {
          const [more, less] = a > b ? [m.name, other.name] : [other.name, m.name];
          warning = `Дисбаланс: подходов на «${more}» в ${String(round(ratio, 1)).replace('.', ',')} раза больше, чем на «${less}»`;
        }
      } else if (a > 0 || b > 0) {
        const [loaded, idle] = a > 0 ? [m.name, other.name] : [other.name, m.name];
        warning = `Нагрузка только на «${loaded}»: на «${idle}» за неделю нет ни одного подхода`;
      }
      pairs.push({ first: m.name, second: other.name, firstSets: a, secondSets: b, ratio, warning });
    }

    return {
      from,
      to,
      threshold: BALANCE_THRESHOLD,
      groups: muscles.map((m) => ({ muscleId: m.id, name: m.name, ...totals.get(m.id) })),
      pairs,
    };
  }

  /**
   * Регулярность занятий за последние 52 недели (ФТ-11): календарь тренировок; серия —
   * число недель подряд, в которых завершённых тренировок не меньше запланированного
   * (текущая неделя, пока план не выполнен, серию не прерывает); процент выполнения —
   * завершённые тренировки с даты создания активной программы к запланированным
   * (план × число начатых недель), не более 100.
   * @param {number} userId
   * @returns {Promise<Regularity>}
   */
  async getRegularity(userId) {
    const t = today();
    const windowStart = addDays(weekStart(t), -7 * (REGULARITY_WEEKS - 1));
    const [workouts, profile, program] = await Promise.all([
      Workout.findByPeriod(userId, windowStart, t),
      TrainingProfile.findByUser(userId),
      Program.findActive(userId),
    ]);

    const calendarMap = new Map();
    const completedByWeek = new Map();
    for (const w of workouts) {
      const date = toISO(w.date);
      calendarMap.set(date, (calendarMap.get(date) ?? false) || w.isCompleted);
      if (w.isCompleted) {
        const ws = weekStart(date);
        completedByWeek.set(ws, (completedByWeek.get(ws) ?? 0) + 1);
      }
    }
    const calendar = [...calendarMap].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, completed]) => ({ date, completed }));

    let planPerWeek = profile?.workoutsPerWeek ?? null;
    if (!planPerWeek && program) planPerWeek = (await ProgramDay.findByProgram(program.id)).length || null;

    let streak = 0;
    if (planPerWeek) {
      let week = weekStart(t);
      if ((completedByWeek.get(week) ?? 0) < planPerWeek) week = addDays(week, -7);
      while (week >= windowStart && (completedByWeek.get(week) ?? 0) >= planPerWeek) {
        streak += 1;
        week = addDays(week, -7);
      }
    }

    let completionPct = null;
    let since = null;
    if (program && planPerWeek) {
      since = toISO(program.createdAt);
      if (since < windowStart) since = windowStart;
      const done = workouts.filter((w) => w.isCompleted && toISO(w.date) >= since).length;
      const weeks = Math.floor((dayMs(weekStart(t)) - dayMs(weekStart(since))) / (7 * DAY_MS)) + 1;
      completionPct = Math.min(100, Math.round((done / (planPerWeek * weeks)) * 100));
    }

    return { calendar, streak, completionPct, planPerWeek, since };
  }
}
```

## Листинг 7 — BackupService.js

Класс `BackupService` — резервное копирование и восстановление БД (ФТ-15). Файл `src/services/BackupService.js`, строк: 272.

```js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import cron from 'node-cron';
import { config } from '../config/config.js';
import { BackupLog } from '../models/index.js';

/** Вид операции в журнале резервного копирования (backup_logs.type). */
export const BackupType = Object.freeze({
  MANUAL: 'MANUAL', // копия по запросу администратора
  SCHEDULED: 'SCHEDULED', // копия по расписанию
  RESTORE: 'RESTORE', // восстановление (запись делает AdminController)
});

/** Результат операции (backup_logs.status). */
export const BackupStatus = Object.freeze({ SUCCESS: 'SUCCESS', ERROR: 'ERROR' });

/** Имя файла копии: fitness_db_ГГГГММДД_ЧЧММСС[_N].dump.enc — только такие файлы восстанавливаются. */
const FILE_PATTERN = /^fitness_db_\d{8}_\d{6}(?:_\d{1,3})?\.dump\.enc$/;

/** Формат зашифрованного файла: метка (5 Б) + IV (12 Б) + шифртекст + тег GCM (16 Б). */
const MAGIC = Buffer.from('FDBK1', 'latin1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Контекст запуска по расписанию: createBackup определяет по нему вид копии. */
const scheduledRun = new AsyncLocalStorage();

/** Одновременно выполняется одна операция копирования или восстановления. */
let busy = false;

function userError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Путь к утилите PostgreSQL (каталог PG_BIN_DIR или PATH). */
function tool(name) {
  return config.backup.pgBinDir ? path.join(config.backup.pgBinDir, name) : name;
}

/** Параметры подключения: пароль — через переменную окружения, а не в аргументах. */
function pgArgs() {
  return ['--host', config.db.host, '--port', String(config.db.port), '--username', config.db.user];
}
function pgEnv() {
  return { ...process.env, PGPASSWORD: config.db.password ?? '' };
}

/** Запуск утилиты через execFile (без командной оболочки). */
function run(file, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { env: pgEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr ?? '').trim();
          return reject(err);
        }
        resolve(stdout);
      });
  });
}

/** Ключ AES-256 из BACKUP_KEY (64 шестнадцатеричных символа). */
function encryptionKey() {
  const hex = config.backup.key ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw userError(500, 'Не задан ключ шифрования резервных копий BACKUP_KEY (64 шестнадцатеричных символа)');
  }
  return Buffer.from(hex, 'hex');
}

/** Шифрование файла AES-256-GCM (потоком). */
async function encryptFile(src, dest, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false });
  await new Promise((resolve, reject) => {
    out.on('error', reject);
    out.end(cipher.getAuthTag(), resolve);
  });
}

/** Расшифровка с проверкой тега GCM: подменённый файл или чужой ключ — ошибка 400. */
async function decryptFile(src, dest, key) {
  const { size } = await fsp.stat(src);
  const headerLength = MAGIC.length + IV_LENGTH;
  if (size < headerLength + TAG_LENGTH) throw userError(400, 'Файл резервной копии повреждён');
  const handle = await fsp.open(src, 'r');
  const header = Buffer.alloc(headerLength);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    await handle.read(header, 0, headerLength, 0);
    await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw userError(400, 'Файл не является резервной копией приложения');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(src, { start: headerLength, end: size - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(dest, { mode: 0o600 }),
    );
  } catch {
    await fsp.rm(dest, { force: true });
    throw userError(400, 'Файл резервной копии повреждён или зашифрован другим ключом');
  }
}

/** Имя нового файла копии по местному времени (без совпадений с существующими). */
function newFileName(dir) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = `fitness_db_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let name = `${base}.dump.enc`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i += 1) name = `${base}_${i}.dump.enc`;
  return name;
}

/**
 * Резервное копирование и восстановление БД утилитами pg_dump / pg_restore (ФТ-15).
 * Файлы копий шифруются AES-256-GCM ключом BACKUP_KEY; каждая операция записывается в журнал BackupLog.
 */
export class BackupService {
  #backupDir;
  #schedule;

  /**
   * @param {{backupDir?: string, schedule?: string, scheduledBy?: () => Promise<number|null>}} [options]
   *   scheduledBy — включить копирование по расписанию #schedule (node-cron); функция возвращает
   *   id администратора, от имени которого запись попадает в журнал.
   */
  constructor({ backupDir = config.backup.dir, schedule = config.backup.schedule, scheduledBy = null } = {}) {
    this.#backupDir = backupDir;
    this.#schedule = schedule;
    if (scheduledBy) {
      if (!cron.validate(this.#schedule)) {
        throw new Error(`Некорректное расписание резервного копирования BACKUP_SCHEDULE: «${this.#schedule}»`);
      }
      cron.schedule(this.#schedule, async () => {
        try {
          const adminId = await scheduledBy();
          if (!adminId) {
            console.warn('[Резервное копирование] Нет активного администратора — копия по расписанию пропущена');
            return;
          }
          const log = await scheduledRun.run(true, () => this.createBackup(adminId));
          console.log(`[Резервное копирование] Создана копия по расписанию: ${log.fileName}`);
        } catch (err) {
          console.error(`[Резервное копирование] Ошибка копии по расписанию: ${err.message}`);
        }
      });
    }
  }

  /**
   * Создание резервной копии: pg_dump (формат custom, без таблицы сессий) во временный файл,
   * шифрование AES-256-GCM в каталог копий, запись в журнал. При ошибке в журнал
   * пишется запись со статусом ERROR, а временные файлы удаляются.
   * @param {number} adminId администратор, выполнивший (или от имени которого выполнена) операция
   * @returns {Promise<BackupLog>} запись журнала о созданной копии
   * @throws {Error} status 409 — выполняется другая операция; 500 — ошибка pg_dump или нет ключа
   */
  async createBackup(adminId) {
    if (busy) throw userError(409, 'Уже выполняется резервное копирование или восстановление. Повторите позже');
    busy = true;
    const type = scheduledRun.getStore() ? BackupType.SCHEDULED : BackupType.MANUAL;
    let fileName = '';
    let target = '';
    let tmp = '';
    try {
      await fsp.mkdir(this.#backupDir, { recursive: true });
      fileName = newFileName(this.#backupDir);
      target = path.join(this.#backupDir, fileName);
      tmp = path.join(this.#backupDir, `.${fileName}.tmp`);
      const key = encryptionKey();
      await run(tool('pg_dump'), [
        ...pgArgs(), '--format=custom', '--exclude-table=session', '--no-owner', '--no-privileges',
        '--file', tmp, config.db.database,
      ]);
      await encryptFile(tmp, target, key);
      return await BackupLog.create({ adminId, fileName, type, status: BackupStatus.SUCCESS });
    } catch (err) {
      if (target) await fsp.rm(target, { force: true });
      await BackupLog.create({ adminId, fileName: fileName || '—', type, status: BackupStatus.ERROR }).catch(() => {});
      if (err.status) throw err;
      console.error('[Резервное копирование] pg_dump:', err.stderr || err.message);
      throw userError(500, 'Не удалось создать резервную копию');
    } finally {
      if (tmp) await fsp.rm(tmp, { force: true });
      busy = false;
    }
  }

  /**
   * Восстановление БД из копии: проверка имени файла (только копии из каталога), расшифровка
   * с проверкой целостности, pg_restore --clean в одной транзакции. Таблица сессий не
   * затрагивается. Записи журнала о копиях, которые сделаны позже восстановленной и потому
   * отсутствуют в ней, добавляются заново. Запись о самом восстановлении делает контроллер.
   * @param {string} fileName имя файла копии в каталоге копий
   * @returns {Promise<void>}
   * @throws {Error} status 400 — недопустимое имя или повреждённый файл; 404 — файла нет;
   *   409 — выполняется другая операция; 500 — ошибка pg_restore (данные не изменены)
   */
  async restore(fileName) {
    if (typeof fileName !== 'string' || !FILE_PATTERN.test(fileName) || path.basename(fileName) !== fileName) {
      throw userError(400, 'Недопустимое имя файла резервной копии');
    }
    const source = path.join(this.#backupDir, fileName);
    if (!fs.existsSync(source)) throw userError(404, 'Файл резервной копии не найден');
    if (busy) throw userError(409, 'Уже выполняется резервное копирование или восстановление. Повторите позже');
    busy = true;
    const tmp = path.join(this.#backupDir, `.restore-${crypto.randomBytes(6).toString('hex')}.dump`);
    try {
      const key = encryptionKey();
      const journalBefore = await BackupLog.findAll();
      await decryptFile(source, tmp, key);
      try {
        await run(tool('pg_restore'), [
          ...pgArgs(), '--clean', '--if-exists', '--single-transaction', '--no-owner', '--no-privileges',
          '--dbname', config.db.database, tmp,
        ]);
      } catch (err) {
        console.error('[Резервное копирование] pg_restore:', err.stderr || err.message);
        throw userError(500, 'Не удалось восстановить базу данных из копии; данные не изменены');
      }
      // Копии, сделанные позже восстановленной, остаются доступными для восстановления.
      const journalAfter = new Set((await BackupLog.findAll()).map((l) => l.fileName));
      const files = new Set(await fsp.readdir(this.#backupDir));
      for (const log of journalBefore.slice().reverse()) {
        if (log.status === BackupStatus.SUCCESS && log.type !== BackupType.RESTORE
          && files.has(log.fileName) && !journalAfter.has(log.fileName)) {
          await BackupLog.create({ adminId: log.adminId, fileName: log.fileName, type: log.type, status: log.status })
            .catch(() => {}); // администратора нет в восстановленных данных
          journalAfter.add(log.fileName);
        }
      }
    } finally {
      await fsp.rm(tmp, { force: true });
      busy = false;
    }
  }

  /**
   * Доступные для восстановления копии: успешные записи журнала (по запросу и по расписанию),
   * файлы которых есть в каталоге копий; новые — первыми.
   * @returns {Promise<BackupLog[]>}
   */
  async listBackups() {
    const [logs, files] = await Promise.all([
      BackupLog.findAll(),
      fsp.readdir(this.#backupDir).catch(() => []),
    ]);
    const present = new Set(files);
    const seen = new Set();
    return logs.filter((l) => {
      const ok = l.status === BackupStatus.SUCCESS && l.type !== BackupType.RESTORE
        && present.has(l.fileName) && !seen.has(l.fileName);
      if (ok) seen.add(l.fileName);
      return ok;
    });
  }
}
```
