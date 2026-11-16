import { Program, TrainingProfile, Exercise, ProgramStatus } from '../models/index.js';
import { ProgramGenerator, ExerciseSelector } from '../services/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseId } from '../utils/parseId.js';
import { toPlain } from '../utils/toPlain.js';
import { loadProgramView, findProgramExercise, saveDay } from './programView.js';

const generator = new ProgramGenerator();
const selector = new ExerciseSelector();

/** Инвентарь пользователя для подбора замен; упражнения с собственным весом доступны всегда. */
async function availableEquipment(userId) {
  const profile = await TrainingProfile.findByUser(userId);
  return profile ? [...new Set([...profile.equipment, 'собственный вес'])] : undefined;
}

/** Личная программа текущего пользователя из параметра :id; чужая или шаблон — 404. */
async function findOwnProgram(req) {
  const id = parseId(req.params.id);
  const program = id && (await Program.findById(id));
  if (!program || program.isTemplate || program.ownerId !== req.user.id) {
    throw new HttpError(404, 'Программа не найдена');
  }
  return program;
}

/** То же, но программа должна быть изменяемой (не в архиве). */
async function findEditableProgram(req) {
  const program = await findOwnProgram(req);
  if (program.status === ProgramStatus.ARCHIVED) {
    throw new HttpError(409, 'Программа в архиве и не изменяется');
  }
  return program;
}

/**
 * Черновик текущего сеанса. У Program нет поиска программ пользователя (только findActive),
 * поэтому id последнего черновика (сгенерированного или скопированного) хранится в сессии.
 */
async function sessionDraft(req) {
  const id = req.session.draftProgramId;
  if (!id) return null;
  const program = await Program.findById(id);
  if (!program || program.ownerId !== req.user.id || program.status !== ProgramStatus.DRAFT) {
    delete req.session.draftProgramId;
    return null;
  }
  return program;
}

/** Новый черновик заменяет прежний: прежний переводится в архив. */
async function rememberDraft(req, program) {
  const previous = await sessionDraft(req);
  if (previous && previous.id !== program.id) await previous.archive();
  req.session.draftProgramId = program.id;
}

/** Страница программы (просмотр и изменение параметров). */
async function renderProgram(req, res, program, extra = {}) {
  const [view, active] = await Promise.all([loadProgramView(program), Program.findActive(req.user.id)]);
  res.render('program', {
    title: program.title,
    ...view,
    activeProgram: active && active.id !== program.id ? toPlain(active) : null,
    editable: program.status !== ProgramStatus.ARCHIVED,
    actionBase: `/programs/${program.id}`,
    catalog: null,
    errors: {},
    values: {},
    message: req.query.saved ? 'Изменения сохранены' : req.query.replaced ? 'Упражнение заменено' : '',
    error: '',
    scripts: program.status !== ProgramStatus.ARCHIVED ? ['/js/programPage.js'] : [],
    ...extra,
  });
}

/** Страница «Мои программы». */
async function renderPrograms(req, res, extra = {}) {
  const [active, draft, profile] = await Promise.all([
    Program.findActive(req.user.id),
    sessionDraft(req),
    TrainingProfile.findByUser(req.user.id),
  ]);
  res.render('programs', {
    title: 'Программа тренировок',
    active: active ? await loadProgramView(active) : null,
    draft: draft ? toPlain(draft) : null,
    profileComplete: Boolean(profile?.isComplete()),
    message: req.query.activated ? 'Программа активирована' : req.query.archived ? 'Программа перенесена в архив' : '',
    error: '',
    ...extra,
  });
}

/**
 * Программы тренировок пользователя: генерация (ФТ-04), шаблоны и их копирование (ФТ-16),
 * изменение параметров и замена упражнений (ФТ-12, ФТ-16), активация.
 */
export class ProgramController {
  /** GET /programs — активная программа и черновик. */
  static async list(req, res) {
    await renderPrograms(req, res);
  }

  /** POST /programs/generate — генерация программы по профилю (черновик). */
  static async generate(req, res) {
    const profile = await TrainingProfile.findByUser(req.user.id);
    if (!profile?.isComplete()) {
      return res.redirect('/profile?required=1');
    }
    let program;
    try {
      program = await generator.generate(profile);
    } catch (err) {
      if (err.status >= 400 && err.status < 500) {
        res.status(err.status);
        return renderPrograms(req, res, { error: err.message });
      }
      throw err;
    }
    await rememberDraft(req, program);
    res.redirect(`/programs/${program.id}`);
  }

  /** GET /programs/templates — опубликованные шаблонные программы. */
  static async templates(req, res) {
    const published = (await Program.findTemplates()).filter((p) => p.status === ProgramStatus.ACTIVE);
    const templates = [];
    for (const t of published) templates.push(await loadProgramView(t));
    res.render('program-templates', { title: 'Шаблонные программы', templates });
  }

  /** POST /programs/templates/:id/copy — личная копия шаблона (черновик). */
  static async copyTemplate(req, res) {
    const id = parseId(req.params.id);
    const template = id && (await Program.findById(id));
    if (!template || !template.isTemplate || template.status !== ProgramStatus.ACTIVE) {
      throw new HttpError(404, 'Шаблон не найден');
    }
    const copy = await template.copyFor(req.user.id);
    await rememberDraft(req, copy);
    res.redirect(`/programs/${copy.id}`);
  }

  /** GET /programs/:id — программа пользователя. */
  static async show(req, res) {
    const program = await findOwnProgram(req);
    await renderProgram(req, res, program);
  }

  /** POST /programs/:id/days/:dayId — параметры нагрузки упражнений дня. */
  static async saveDay(req, res) {
    const program = await findEditableProgram(req);
    const { errors, dayNumber } = await saveDay(program, parseId(req.params.dayId), req.body ?? {});
    if (Object.keys(errors).length > 0) {
      res.status(400);
      return renderProgram(req, res, program, {
        errors, values: req.body, error: `День ${dayNumber}: проверьте отмеченные поля`,
      });
    }
    res.redirect(`/programs/${program.id}?saved=1#day-${dayNumber}`);
  }

  /** POST /programs/:id/exercises/:peId/replace — замена упражнения равноценным. */
  static async replaceExercise(req, res) {
    const program = await findEditableProgram(req);
    const pe = await findProgramExercise(program, parseId(req.params.peId));
    const exerciseId = parseId(req.body?.exerciseId);
    const options = await selector.suggestReplacement(pe.exerciseId, await availableEquipment(req.user.id));
    const replacement = options.find((e) => e.id === exerciseId);
    if (!replacement) {
      throw new HttpError(400, 'Выберите упражнение из предложенного списка');
    }
    // Для упражнения с собственным весом рабочий вес не задаётся.
    const data = { exerciseId };
    if (!(Number(replacement.weightStep) > 0)) data.workingWeight = 0;
    await pe.update(data);
    res.redirect(`/programs/${program.id}?replaced=1`);
  }

  /**
   * POST /programs/:id/activate — активация черновика. Если есть активная программа,
   * нужно подтверждение (confirm=yes): прежняя переводится в архив.
   */
  static async activate(req, res) {
    const program = await findOwnProgram(req);
    if (program.status !== ProgramStatus.DRAFT) {
      throw new HttpError(409, 'Активировать можно только черновик');
    }
    const current = await Program.findActive(req.user.id);
    if (current && req.body?.confirm !== 'yes') {
      res.status(409);
      return renderProgram(req, res, program, {
        error: `Подтвердите замену активной программы «${current.title}»`,
      });
    }
    if (current) await current.archive();
    await program.activate();
    if (req.session.draftProgramId === program.id) delete req.session.draftProgramId;
    res.redirect('/programs?activated=1');
  }

  /** POST /programs/:id/archive — отказ от черновика или завершение активной программы. */
  static async archive(req, res) {
    const program = await findEditableProgram(req);
    await program.archive();
    if (req.session.draftProgramId === program.id) delete req.session.draftProgramId;
    res.redirect('/programs?archived=1');
  }

  /** GET /api/exercises/:id/replacements — равноценные замены с инвентарём пользователя (JSON). */
  static async replacements(req, res) {
    const id = parseId(req.params.id);
    if (!id || !(await Exercise.findById(id))) {
      throw new HttpError(404, 'Упражнение не найдено');
    }
    const list = await selector.suggestReplacement(id, await availableEquipment(req.user.id));
    res.json({ replacements: toPlain(list) });
  }
}
