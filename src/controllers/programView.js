/**
 * Общие функции страниц программ (ProgramController) и шаблонов (AdminController):
 * подготовка программы к отображению и сохранение параметров нагрузки дня.
 */
import { ProgramDay, ProgramExercise, Exercise, MuscleGroup } from '../models/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseLoadParams } from '../middleware/validate.js';
import { toPlain } from '../utils/toPlain.js';

/**
 * Программа для представления: дни с упражнениями, названиями упражнений и групп мышц.
 * @param {import('../models/Program.js').Program} program
 * @returns {Promise<{program: object, days: Array<object>}>}
 */
export async function loadProgramView(program) {
  const [days, catalog, muscles] = await Promise.all([
    ProgramDay.findByProgram(program.id),
    Exercise.search({ includeInactive: true }),
    MuscleGroup.findAll(),
  ]);
  const exerciseById = new Map(catalog.map((e) => [e.id, e]));
  const muscleName = new Map(muscles.map((m) => [m.id, m.name]));

  const dayViews = [];
  for (const day of days) {
    const items = await ProgramExercise.findByDay(day.id);
    dayViews.push({
      ...toPlain(day),
      exercises: items.map((pe) => {
        const ex = exerciseById.get(pe.exerciseId);
        return {
          ...toPlain(pe),
          name: ex?.name ?? 'Упражнение удалено из справочника',
          muscle: muscleName.get(ex?.primaryMuscleId) ?? '',
          equipment: ex?.equipment ?? '',
          weightStep: ex?.weightStep ?? 0,
          isActive: ex?.isActive ?? false,
        };
      }),
    });
  }
  return { program: toPlain(program), days: dayViews };
}

/**
 * Упражнение программы по id (принадлежность программе проверяется через её дни).
 * @param {import('../models/Program.js').Program} program
 * @param {number|null} peId
 * @returns {Promise<ProgramExercise>} 404, если в программе такого нет
 */
export async function findProgramExercise(program, peId) {
  if (peId) {
    for (const day of await ProgramDay.findByProgram(program.id)) {
      const pe = (await ProgramExercise.findByDay(day.id)).find((x) => x.id === peId);
      if (pe) return pe;
    }
  }
  throw new HttpError(404, 'Упражнение программы не найдено');
}

/**
 * Сохранение параметров нагрузки упражнений одного дня. Изменяются только
 * отличающиеся значения (ProgramExercise.update).
 * @param {import('../models/Program.js').Program} program
 * @param {number|null} dayId
 * @param {Record<string, unknown>} body поля формы дня
 * @param {{exerciseIds?: Set<number>}} [options] exerciseIds — разрешена замена упражнений
 *        (шаблон); текущие упражнения дня допустимы всегда
 * @returns {Promise<{errors: Record<string, string>, dayNumber: number}>}
 */
export async function saveDay(program, dayId, body, { exerciseIds } = {}) {
  const day = dayId && (await ProgramDay.findByProgram(program.id)).find((d) => d.id === dayId);
  if (!day) throw new HttpError(404, 'День программы не найден');

  const items = await ProgramExercise.findByDay(day.id);
  const allowed = exerciseIds ? new Set([...exerciseIds, ...items.map((pe) => pe.exerciseId)]) : undefined;
  const { changes, errors } = parseLoadParams(body, items.map((pe) => pe.id), { exerciseIds: allowed });
  if (Object.keys(errors).length > 0) {
    return { errors, dayNumber: day.dayNumber };
  }
  for (const pe of items) {
    const data = changes.get(pe.id);
    const diff = Object.fromEntries(Object.entries(data).filter(([key, value]) => Number(pe[key]) !== value));
    if (Object.keys(diff).length > 0) await pe.update(diff);
  }
  return { errors: {}, dayNumber: day.dayNumber };
}
