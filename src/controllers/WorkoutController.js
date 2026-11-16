import { Program, ProgramDay, ProgramExercise, Exercise, Workout, Decision } from '../models/index.js';
import { RecordDetector, WeightAdaptationService } from '../services/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseWorkoutSets, parseSetEdit, parseDate, JOURNAL_DAYS } from '../middleware/validate.js';
import { recordTypeNames, decisionNames } from '../config/dictionaries.js';
import { parseId } from '../utils/parseId.js';
import { loadProgramView } from './programView.js';

const recordDetector = new RecordDetector();
const adaptationService = new WeightAdaptationService();

const kg = (value) => `${String(Math.round(Number(value) * 100) / 100).replace('.', ',')} кг`;

const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Тренировка текущего пользователя из параметра :id; чужая или отсутствующая — 404. */
async function findOwnWorkout(req) {
  const id = parseId(req.params.id);
  const workout = id && (await Workout.findById(id));
  if (!workout || workout.userId !== req.user.id) throw new HttpError(404, 'Тренировка не найдена');
  return workout;
}

/** Подход тренировки из параметра :setId; 404, если в тренировке его нет. */
function findSet(workout, req) {
  const setId = parseId(req.params.setId);
  const set = workout.sets.find((s) => s.id === setId);
  if (!set) throw new HttpError(404, 'Подход не найден');
  return set;
}

/** Возврат в журнал к той же тренировке. */
function backToJournal(res, req, workout, done) {
  const from = typeof req.body?.from === 'string' ? parseDate(req.body.from) : null;
  const to = typeof req.body?.to === 'string' ? parseDate(req.body.to) : null;
  const query = new URLSearchParams({ done });
  if (from && to) { query.set('from', from); query.set('to', to); }
  res.redirect(`/workouts?${query}${workout ? `#workout-${workout.id}` : ''}`);
}

/**
 * Пояснение решения алгоритма адаптации для пользователя.
 * @param {import('../models/WeightHistory.js').WeightHistory} entry запись истории
 * @param {ProgramExercise} pe упражнение программы
 * @param {Array<{reps: number}>} sets подходы упражнения в этой тренировке
 * @param {Exercise|undefined} exercise
 */
export function explainDecision(entry, pe, sets, exercise) {
  const weighted = Number(exercise?.weightStep) > 0;
  const allTop = sets.every((s) => s.reps >= pe.repsMax);
  switch (entry.decision) {
    case Decision.INCREASE:
      return weighted
        ? `Во всех подходах достигнута верхняя граница диапазона (${pe.repsMax} повт.) — вес увеличен с ${kg(entry.oldWeight)} до ${kg(entry.newWeight)}`
        : 'Во всех подходах достигнута верхняя граница диапазона — увеличьте число повторений или усложните вариант упражнения';
    case Decision.DECREASE:
      return weighted
        ? `Две тренировки подряд повторений меньше нижней границы (${pe.repsMin}) — вес снижен с ${kg(entry.oldWeight)} до ${kg(entry.newWeight)}`
        : 'Две тренировки подряд повторений меньше нижней границы — выполняйте упрощённый вариант упражнения';
    default:
      if (Number(entry.oldWeight) === 0 && Number(entry.newWeight) > 0) {
        return `Рабочий вес не был задан — по результатам тренировки он установлен: ${kg(entry.newWeight)}`;
      }
      if (allTop && weighted) {
        return `Верхняя граница достигнута, но больший вес превысил бы допустимую интенсивность для цели (по оценке 1ПМ) — вес сохранён: ${kg(entry.newWeight)}`;
      }
      if (sets.some((s) => s.reps < pe.repsMin)) {
        return weighted
          ? `Повторений меньше нижней границы (${pe.repsMin}). Если это повторится на следующей тренировке, вес будет снижен`
          : `Повторений меньше нижней границы (${pe.repsMin}). Если это повторится, перейдите к упрощённому варианту упражнения`;
      }
      return weighted
        ? `Результат в пределах диапазона ${pe.repsMin}–${pe.repsMax} — вес сохранён: ${kg(entry.newWeight)}`
        : `Результат в пределах диапазона ${pe.repsMin}–${pe.repsMax}`;
  }
}

/**
 * Тренировки: страница ввода результатов и сохранение (ФТ-17) с определением рекордов (ФТ-09)
 * и адаптацией рабочих весов (ФТ-05) — диаграмма последовательности, рисунок 1.9.
 */
export class WorkoutController {
  /** GET /workouts/new?day= — выбор дня активной программы и ввод подходов. */
  static async newPage(req, res) {
    const active = await Program.findActive(req.user.id);
    if (!active) {
      return res.render('workout-new', { title: 'Тренировка', program: null, days: [], day: null });
    }
    const view = await loadProgramView(active);
    const dayId = parseId(req.query.day);
    const day = view.days.find((d) => d.id === dayId) ?? null;
    res.render('workout-new', {
      title: day ? `Тренировка: ${day.title}` : 'Тренировка',
      program: view.program,
      days: view.days,
      day,
      scripts: day ? ['/js/WorkoutPage.js'] : [],
    });
  }

  /**
   * POST /api/workouts — сохранение тренировки. Порядок по диаграмме последовательности:
   * сессия (requireRole) → Workout.create() (транзакция, calcTonnage) → RecordDetector.detect()
   * → WeightAdaptationService.adapt() → 201 { tonnage, records, adaptations }.
   */
  static async save(req, res) {
    const body = req.body ?? {};
    const dayId = typeof body.programDayId === 'number' ? body.programDayId : parseId(String(body.programDayId ?? ''));

    // День должен принадлежать активной программе текущего пользователя.
    const active = await Program.findActive(req.user.id);
    const days = active ? await ProgramDay.findByProgram(active.id) : [];
    if (!days.some((d) => d.id === dayId)) {
      throw new HttpError(400, 'Выберите тренировочный день активной программы');
    }
    const dayExercises = await ProgramExercise.findByDay(dayId);
    const { sets, errors } = parseWorkoutSets(body.sets, dayExercises.map((pe) => pe.id));
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }

    const workout = await Workout.create(req.user.id, dayId, sets);
    const records = await recordDetector.detect(workout);
    const adaptations = await adaptationService.adapt(workout);

    // Названия упражнений и пояснения для ответа.
    const catalog = await Exercise.search({ includeInactive: true });
    const exerciseById = new Map(catalog.map((e) => [e.id, e]));
    const peById = new Map(dayExercises.map((pe) => [pe.id, pe]));

    res.status(201).json({
      workoutId: workout.id,
      tonnage: Number(workout.tonnage),
      isCompleted: workout.isCompleted,
      records: records.map((r) => ({
        exerciseId: r.exerciseId,
        exerciseName: exerciseById.get(r.exerciseId)?.name ?? '',
        type: r.type,
        typeName: recordTypeNames[r.type] ?? r.type,
        value: Number(r.value),
      })),
      adaptations: adaptations.map((h) => {
        const pe = peById.get(h.programExerciseId);
        const exercise = exerciseById.get(pe?.exerciseId);
        const peSets = workout.sets.filter((s) => s.programExerciseId === h.programExerciseId);
        return {
          programExerciseId: h.programExerciseId,
          exerciseName: exercise?.name ?? '',
          oldWeight: Number(h.oldWeight),
          newWeight: Number(h.newWeight),
          decision: h.decision,
          decisionName: decisionNames[h.decision] ?? h.decision,
          explanation: pe ? explainDecision(h, pe, peSets, exercise) : '',
        };
      }),
    });
  }

  /**
   * GET /workouts?from=&to= — журнал тренировок за период (по умолчанию последние 30 дней),
   * новые сверху; ссылки «Раньше / Позже» сдвигают период.
   */
  static async journal(req, res) {
    const today = localToday();
    let to = parseDate(req.query.to) ?? today;
    let from = parseDate(req.query.from) ?? shiftDate(to, -(JOURNAL_DAYS - 1));
    let error = '';
    if (from > to) {
      error = 'Начало периода позже его конца — показаны последние 30 дней';
      to = today;
      from = shiftDate(today, -(JOURNAL_DAYS - 1));
    }
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

    const [workouts, catalog, active] = await Promise.all([
      Workout.findByPeriod(req.user.id, from, to),
      Exercise.search({ includeInactive: true }),
      Program.findActive(req.user.id),
    ]);
    const exerciseName = new Map(catalog.map((e) => [e.id, e.name]));
    const dayTitles = new Map(
      (active ? await ProgramDay.findByProgram(active.id) : []).map((d) => [d.id, `День ${d.dayNumber}. ${d.title}`]),
    );
    const peByDay = new Map();
    for (const w of workouts) {
      if (!peByDay.has(w.programDayId)) {
        peByDay.set(w.programDayId, new Map((await ProgramExercise.findByDay(w.programDayId)).map((pe) => [pe.id, pe])));
      }
    }

    const messages = {
      updated: 'Подход исправлен',
      removed: 'Подход удалён',
      workoutRemoved: 'Тренировка удалена',
    };
    res.render('workouts', {
      title: 'Журнал тренировок',
      scripts: ['/js/confirm.js'],
      from,
      to,
      earlier: { from: shiftDate(from, -days), to: shiftDate(from, -1) },
      later: to < today ? { from: shiftDate(to, 1), to: shiftDate(to, days) > today ? today : shiftDate(to, days) } : null,
      message: messages[req.query.done] ?? '',
      error,
      workouts: workouts.slice().reverse().map((w) => {
        const pes = peByDay.get(w.programDayId);
        return {
          id: w.id,
          date: w.date,
          dayTitle: dayTitles.get(w.programDayId) ?? 'День прежней программы',
          tonnage: Number(w.tonnage),
          isCompleted: w.isCompleted,
          sets: w.sets.map((s) => ({
            id: s.id,
            setNo: s.setNo,
            weight: Number(s.weight),
            reps: s.reps,
            exercise: exerciseName.get(pes?.get(s.programExerciseId)?.exerciseId) ?? 'Упражнение удалено из программы',
          })),
        };
      }),
    });
  }

  /** POST /workouts/:id/sets/:setId — исправление веса и повторений подхода (тоннаж пересчитывается). */
  static async updateSet(req, res) {
    const workout = await findOwnWorkout(req);
    const set = findSet(workout, req);
    const { data, errors } = parseSetEdit(req.body ?? {});
    if (errors.length > 0) throw new HttpError(400, errors.join('. '));
    await set.update(data.weight, data.reps);
    backToJournal(res, req, workout, 'updated');
  }

  /** POST /workouts/:id/sets/:setId/delete — удаление подхода; единственный подход не удаляется (409). */
  static async removeSet(req, res) {
    const workout = await findOwnWorkout(req);
    const set = findSet(workout, req);
    await set.remove();
    backToJournal(res, req, workout, 'removed');
  }

  /** POST /workouts/:id/delete — удаление тренировки вместе с подходами. */
  static async removeWorkout(req, res) {
    const workout = await findOwnWorkout(req);
    await workout.remove();
    backToJournal(res, req, null, 'workoutRemoved');
  }
}
