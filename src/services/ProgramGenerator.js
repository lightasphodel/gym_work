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

/** Ошибка, понятная пользователю (статус ответа — как у notImplemented). */
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
