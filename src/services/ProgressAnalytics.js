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
