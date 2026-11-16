import { Program, ProgramDay, ProgramExercise, Exercise, Workout, Decision } from '../models/index.js';
import { RecordDetector, WeightAdaptationService } from '../services/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseWorkoutSets } from '../middleware/validate.js';
import { recordTypeNames, decisionNames } from '../config/dictionaries.js';
import { parseId } from '../utils/parseId.js';
import { loadProgramView } from './programView.js';

const recordDetector = new RecordDetector();
const adaptationService = new WeightAdaptationService();

const kg = (value) => `${String(Math.round(Number(value) * 100) / 100).replace('.', ',')} кг`;

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
}
