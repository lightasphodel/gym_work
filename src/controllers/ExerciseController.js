import { Exercise, ExerciseMedia, MuscleGroup } from '../models/index.js';
import { EQUIPMENT, difficultyNames } from '../config/dictionaries.js';
import { HttpError } from '../middleware/errorHandler.js';
import { toPlain } from '../utils/toPlain.js';
import { parseId } from '../utils/parseId.js';

/**
 * Фильтр справочника из строки запроса. Некорректные значения отбрасываются
 * (фильтр по ним не применяется).
 * @param {Record<string, unknown>} q
 * @returns {{muscleId: number|null, equipment: string|null, difficulty: number|null}}
 */
export function parseExerciseFilter(q) {
  const difficulty = parseId(q.difficulty);
  return {
    muscleId: parseId(q.muscle),
    equipment: typeof q.equipment === 'string' && EQUIPMENT.includes(q.equipment) ? q.equipment : null,
    difficulty: difficulty !== null && difficulty in difficultyNames ? difficulty : null,
  };
}

/** Абзацы описания техники (по переводам строк). */
function paragraphs(text) {
  return (text ?? '').split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Справочник упражнений: список с фильтрами, карточка упражнения, медиафайлы.
 * Изменение справочника администратором — этап 8 (ФТ-13).
 */
export class ExerciseController {
  /** GET /exercises — список с фильтрами по группе мышц, инвентарю и сложности. */
  static async list(req, res) {
    const filter = parseExerciseFilter(req.query);
    const muscles = await MuscleGroup.findAll();
    const exercises = await Exercise.search(filter);
    const muscleNames = Object.fromEntries(muscles.map((m) => [m.id, m.name]));

    res.render('exercises', {
      title: 'Справочник упражнений',
      filter,
      muscles: toPlain(muscles),
      muscleNames,
      exercises: toPlain(exercises),
    });
  }

  /** GET /exercises/:id — карточка упражнения: техника и медиафайлы. */
  static async show(req, res) {
    const id = parseId(req.params.id);
    const exercise = id && (await Exercise.findById(id));
    if (!exercise || !exercise.isActive) {
      throw new HttpError(404, 'Упражнение не найдено');
    }
    const [muscles, media] = await Promise.all([
      MuscleGroup.findAll(),
      ExerciseMedia.findByExercise(exercise.id),
    ]);
    const muscle = muscles.find((m) => m.id === exercise.primaryMuscleId);

    res.render('exercise', {
      title: exercise.name,
      exercise: toPlain(exercise),
      muscleName: muscle?.name ?? '',
      technique: paragraphs(exercise.technique),
      media: toPlain(media),
      scripts: media.length ? ['/js/gallery.js'] : [],
    });
  }

  /** GET /media/:id — медиафайл упражнения с типом mimeType. */
  static async media(req, res) {
    const id = parseId(req.params.id);
    const media = id && (await ExerciseMedia.findById(id));
    if (!media) {
      throw new HttpError(404, 'Файл не найден');
    }
    res.set('Cache-Control', 'private, max-age=3600');
    res.type(media.mimeType).send(media.data);
  }
}
