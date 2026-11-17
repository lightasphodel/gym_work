import fsp from 'node:fs/promises';
import path from 'node:path';
import { User, Exercise, ExerciseMedia, MuscleGroup, Program, ProgramStatus, BackupLog } from '../models/index.js';
import { BackupService, BackupType, BackupStatus } from '../services/BackupService.js';
import { config } from '../config/config.js';
import { HttpError } from '../middleware/errorHandler.js';
import { parseExerciseForm, parseProgramMeta, parseTemplateForm, TEMPLATE_LIMITS } from '../middleware/validate.js';
import { parseId } from '../utils/parseId.js';
import { toPlain } from '../utils/toPlain.js';
import { loadProgramView, saveDay } from './programView.js';

// ---------- Пользователи (ФТ-18) ----------

/** Сообщения после действий со списком пользователей (параметр done). */
const DONE_MESSAGES = Object.freeze({
  blocked: (login) => `Учётная запись ${login} заблокирована`,
  unblocked: (login) => `Учётная запись ${login} разблокирована`,
  already: (login) => `Учётная запись ${login} уже заблокирована`,
});

/** Пользователь из параметра :id маршрута; 404, если его нет. */
async function findTarget(req) {
  const id = parseId(req.params.id);
  const user = id && (await User.findById(id));
  if (!user) {
    throw new HttpError(404, 'Пользователь не найден');
  }
  return user;
}

function redirectDone(res, done, user) {
  res.redirect(`/admin/users?done=${done}&login=${encodeURIComponent(user.login)}`);
}

// ---------- Справочник упражнений (ФТ-13) ----------

/** Упражнение из параметра :id; 404, если его нет. */
async function findExercise(req) {
  const id = parseId(req.params.id);
  const exercise = id && (await Exercise.findById(id));
  if (!exercise) throw new HttpError(404, 'Упражнение не найдено');
  return exercise;
}

/**
 * Вспомогательные группы мышц упражнения. У Exercise нет аксессора для них, поэтому
 * они определяются через Exercise.search: группа вспомогательная, если поиск по ней
 * находит упражнение, а основная группа у него другая.
 */
async function secondaryMuscleIds(exercise, muscles) {
  const found = await Promise.all(
    muscles
      .filter((m) => m.id !== exercise.primaryMuscleId)
      .map(async (m) => {
        const list = await Exercise.search({ muscleId: m.id, includeInactive: true });
        return list.some((e) => e.id === exercise.id) ? m.id : null;
      }),
  );
  return found.filter((id) => id !== null);
}

/** Значения формы из введённых данных (для повторного показа при ошибке). */
function exerciseFormFromBody(body) {
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    name: str(body.name),
    primaryMuscleId: str(body.primaryMuscleId),
    secondaryMuscleIds: body.secondaryMuscleIds === undefined ? [] : [body.secondaryMuscleIds].flat().map(String),
    equipment: str(body.equipment),
    difficulty: str(body.difficulty),
    weightStep: str(body.weightStep),
    technique: str(body.technique),
  };
}

async function renderExerciseForm(res, { exercise = null, form, errors = {}, message = '' }) {
  const [muscles, media] = await Promise.all([
    MuscleGroup.findAll(),
    exercise ? ExerciseMedia.findByExercise(exercise.id) : [],
  ]);
  res.render('admin-exercise-form', {
    title: exercise ? `Упражнение: ${exercise.name}` : 'Новое упражнение',
    exercise: exercise ? toPlain(exercise) : null,
    form,
    errors,
    message,
    muscles: toPlain(muscles),
    media: toPlain(media),
    scripts: media.length ? ['/js/gallery.js'] : [],
  });
}

/** Сохранение загруженных медиафайлов упражнения в БД (BYTEA). */
async function saveMedia(exerciseId, files) {
  for (const file of files ?? []) {
    await ExerciseMedia.create({
      exerciseId,
      mediaType: file.mediaType,
      mimeType: file.mimetype,
      data: file.buffer,
    });
  }
}

const isDuplicateName = (err) => err.code === '23505' && err.constraint === 'exercises_name_ak';
const DUPLICATE_NAME = 'Упражнение с таким названием уже есть в справочнике';

/** Проверка формы упражнения и загруженных файлов. */
async function checkExerciseForm(req) {
  const muscles = await MuscleGroup.findAll();
  const { data, errors } = parseExerciseForm(req.body ?? {}, muscles.map((m) => m.id));
  if (req.uploadError) errors.media = req.uploadError.message;
  return { data, errors, status: req.uploadError?.status ?? 400 };
}

// ---------- Шаблонные программы (ФТ-14) ----------

const TEMPLATE_STATUS = Object.freeze({
  [ProgramStatus.ACTIVE]: 'Опубликован',
  [ProgramStatus.DRAFT]: 'Не опубликован',
  [ProgramStatus.ARCHIVED]: 'Снят с публикации',
});

/** Шаблон из параметра :id; личная программа или отсутствие — 404. */
async function findTemplate(req) {
  const id = parseId(req.params.id);
  const program = id && (await Program.findById(id));
  if (!program || !program.isTemplate) throw new HttpError(404, 'Шаблон не найден');
  return program;
}

/** Число дней и упражнений в дне для формы нового шаблона (в допустимых пределах). */
function templateShape(source) {
  const clamp = (value, [min, max], fallback) => {
    const n = parseId(typeof value === 'string' ? value : '');
    return n === null ? fallback : Math.min(max, Math.max(min, n));
  };
  return {
    days: clamp(source.days, TEMPLATE_LIMITS.days, 3),
    perDay: clamp(source.perDay, TEMPLATE_LIMITS.perDay, 5),
  };
}

async function renderTemplate(req, res, program, extra = {}) {
  const [view, catalog] = await Promise.all([loadProgramView(program), Exercise.search({})]);
  let message = '';
  if (req.query.created) message = 'Шаблон создан. Опубликуйте его, чтобы пользователи могли его скопировать';
  else if (req.query.saved) message = 'Изменения сохранены';
  res.render('admin-template', {
    title: `Шаблон: ${program.title}`,
    ...view,
    statusName: TEMPLATE_STATUS[program.status],
    meta: { title: program.title, goal: program.goal, level: program.level },
    metaErrors: {},
    actionBase: `/admin/templates/${program.id}`,
    editable: true,
    catalog: toPlain(catalog),
    errors: {},
    values: {},
    message,
    error: '',
    ...extra,
  });
}

// ---------- Резервное копирование (ФТ-15) ----------

const backupService = new BackupService();

const BACKUP_TYPE_NAMES = Object.freeze({
  [BackupType.MANUAL]: 'По запросу',
  [BackupType.SCHEDULED]: 'По расписанию',
  [BackupType.RESTORE]: 'Восстановление',
});

/** Размер файла для таблицы: КБ или МБ с десятичной запятой. */
function fileSize(bytes) {
  if (bytes === null) return '—';
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / 1024 / 1024, 'МБ'] : [bytes / 1024, 'КБ'];
  return `${String(Math.round(value * 10) / 10).replace('.', ',')} ${unit}`;
}

/** Расписание cron в виде текста для простых ежедневных выражений «м ч * * *». */
function scheduleText(expr) {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr.trim());
  return m ? `ежедневно в ${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}` : `по выражению cron «${expr}»`;
}

async function renderBackups(req, res, extra = {}) {
  const [available, journal, users] = await Promise.all([
    backupService.listBackups(),
    BackupLog.findAll(),
    User.findAll(),
  ]);
  const loginById = new Map(users.map((u) => [u.id, u.login]));
  const backups = [];
  for (const b of available) {
    const stat = await fsp.stat(path.join(config.backup.dir, b.fileName)).catch(() => null);
    backups.push({ ...toPlain(b), admin: loginById.get(b.adminId) ?? '—', size: fileSize(stat?.size ?? null),
      typeName: BACKUP_TYPE_NAMES[b.type] ?? b.type });
  }
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  let message = '';
  if (req.query.done === 'created' && file) message = `Создана резервная копия ${file}`;
  else if (req.query.done === 'restored' && file) message = `База данных восстановлена из копии ${file}`;
  res.render('admin-backups', {
    title: 'Резервные копии',
    backups,
    journal: journal.slice(0, 50).map((l) => ({ ...toPlain(l), admin: loginById.get(l.adminId) ?? '—',
      typeName: BACKUP_TYPE_NAMES[l.type] ?? l.type, ok: l.status === BackupStatus.SUCCESS })),
    schedule: scheduleText(config.backup.schedule),
    keyConfigured: /^[0-9a-f]{64}$/i.test(config.backup.key ?? ''),
    message,
    error: '',
    scripts: ['/js/confirm.js'],
    ...extra,
  });
}

/** Сообщение об ошибке операции копирования для страницы (без внутренних подробностей). */
const backupError = (err, fallback) => (err.status && err.status < 500 ? err.message : err.message || fallback);

/**
 * Страницы администратора: панель, пользователи (ФТ-18), справочник (ФТ-13),
 * шаблоны (ФТ-14), резервные копии.
 */
export class AdminController {
  /** GET /admin — панель администратора. */
  static index(req, res) {
    res.render('admin', { title: 'Панель администратора', user: toPlain(req.user) });
  }

  // ---------- Пользователи (ФТ-18) ----------

  /** GET /admin/users — список учётных записей. */
  static async users(req, res) {
    const users = await User.findAll();
    const message = DONE_MESSAGES[req.query.done];
    const login = typeof req.query.login === 'string' ? req.query.login : '';

    res.render('admin-users', {
      title: 'Пользователи',
      // isLocked() — метод, а не аксессор, поэтому в toPlain() не попадает: добавляется явно.
      users: users.map((u) => ({ ...toPlain(u), locked: u.isLocked() })),
      selfId: req.user.id,
      message: message && login ? message(login) : '',
    });
  }

  /** POST /admin/users/:id/block — блокировка. Свою учётную запись заблокировать нельзя. */
  static async block(req, res) {
    const user = await findTarget(req);
    if (user.id === req.user.id) {
      throw new HttpError(400, 'Нельзя заблокировать собственную учётную запись');
    }
    if (user.isBlocked) {
      return redirectDone(res, 'already', user);
    }
    await user.block();
    redirectDone(res, 'blocked', user);
  }

  /** POST /admin/users/:id/unblock — разблокировка (снимает и временную блокировку входа). */
  static async unblock(req, res) {
    const user = await findTarget(req);
    await user.unblock();
    redirectDone(res, 'unblocked', user);
  }

  // ---------- Справочник упражнений (ФТ-13) ----------

  /** GET /admin/exercises — все упражнения, включая неактивные. */
  static async exercises(req, res) {
    const [exercises, muscles] = await Promise.all([
      Exercise.search({ includeInactive: true }),
      MuscleGroup.findAll(),
    ]);
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    res.render('admin-exercises', {
      title: 'Справочник упражнений',
      exercises: toPlain(exercises),
      muscleNames: Object.fromEntries(muscles.map((m) => [m.id, m.name])),
      message: req.query.done === 'deactivated' && name ? `Упражнение «${name}» деактивировано` : '',
    });
  }

  /** GET /admin/exercises/new — форма нового упражнения. */
  static async exerciseNew(req, res) {
    await renderExerciseForm(res, {
      form: exerciseFormFromBody({ difficulty: '1', weightStep: '2.5' }),
    });
  }

  /** POST /admin/exercises — создание упражнения с медиафайлами (multipart/form-data). */
  static async exerciseCreate(req, res) {
    const { data, errors, status } = await checkExerciseForm(req);
    if (Object.keys(errors).length === 0) {
      try {
        const exercise = await Exercise.create(data);
        await saveMedia(exercise.id, req.files);
        return res.redirect(`/admin/exercises/${exercise.id}/edit?saved=1`);
      } catch (err) {
        if (!isDuplicateName(err)) throw err;
        errors.name = DUPLICATE_NAME;
      }
    }
    res.status(errors.name === DUPLICATE_NAME ? 409 : status);
    await renderExerciseForm(res, { form: exerciseFormFromBody(req.body ?? {}), errors });
  }

  /** GET /admin/exercises/:id/edit — форма изменения упражнения. */
  static async exerciseEdit(req, res) {
    const exercise = await findExercise(req);
    const muscles = await MuscleGroup.findAll();
    let message = '';
    if (req.query.saved) message = 'Упражнение сохранено';
    else if (req.query.mediaRemoved) message = 'Медиафайл удалён';
    await renderExerciseForm(res, {
      exercise,
      form: {
        name: exercise.name,
        primaryMuscleId: String(exercise.primaryMuscleId),
        secondaryMuscleIds: (await secondaryMuscleIds(exercise, muscles)).map(String),
        equipment: exercise.equipment,
        difficulty: String(exercise.difficulty),
        weightStep: String(exercise.weightStep),
        technique: exercise.technique ?? '',
      },
      message,
    });
  }

  /** POST /admin/exercises/:id — изменение упражнения и загрузка новых медиафайлов. */
  static async exerciseUpdate(req, res) {
    const exercise = await findExercise(req);
    const { data, errors, status } = await checkExerciseForm(req);
    if (Object.keys(errors).length === 0) {
      try {
        await exercise.update(data);
        await saveMedia(exercise.id, req.files);
        return res.redirect(`/admin/exercises/${exercise.id}/edit?saved=1`);
      } catch (err) {
        if (!isDuplicateName(err)) throw err;
        errors.name = DUPLICATE_NAME;
      }
    }
    res.status(errors.name === DUPLICATE_NAME ? 409 : status);
    await renderExerciseForm(res, { exercise, form: exerciseFormFromBody(req.body ?? {}), errors });
  }

  /**
   * POST /admin/exercises/:id/deactivate — деактивация. Упражнение не удаляется:
   * оно может входить в программы и журнал тренировок; из справочника и подбора оно исчезает.
   */
  static async exerciseDeactivate(req, res) {
    const exercise = await findExercise(req);
    if (exercise.isActive) await exercise.deactivate();
    res.redirect(`/admin/exercises?done=deactivated&name=${encodeURIComponent(exercise.name)}`);
  }

  /** POST /admin/exercises/:id/media/:mediaId/delete — удаление медиафайла. */
  static async mediaDelete(req, res) {
    const exercise = await findExercise(req);
    const mediaId = parseId(req.params.mediaId);
    const media = mediaId && (await ExerciseMedia.findById(mediaId));
    if (!media || media.exerciseId !== exercise.id) throw new HttpError(404, 'Медиафайл не найден');
    await media.remove();
    res.redirect(`/admin/exercises/${exercise.id}/edit?mediaRemoved=1`);
  }

  // ---------- Шаблонные программы (ФТ-14) ----------

  /** GET /admin/templates — список шаблонов. */
  static async templates(req, res) {
    const templates = await Program.findTemplates();
    let message = '';
    if (req.query.published) message = 'Шаблон опубликован';
    else if (req.query.unpublished) message = 'Шаблон снят с публикации';
    res.render('admin-templates', {
      title: 'Шаблонные программы',
      templates: templates.map((t) => ({ ...toPlain(t), statusName: TEMPLATE_STATUS[t.status] })),
      shape: templateShape({}),
      limits: TEMPLATE_LIMITS,
      message,
    });
  }

  /** GET /admin/templates/new?days=&perDay= — форма нового шаблона заданной структуры. */
  static async templateNew(req, res) {
    res.render('admin-template-new', {
      title: 'Новый шаблон',
      shape: templateShape(req.query),
      catalog: toPlain(await Exercise.search({})),
      form: { title: '', goal: '', level: '', sets: '3', repsMin: '8', repsMax: '12', restSec: '90' },
      errors: {},
    });
  }

  /** POST /admin/templates — создание шаблона: Program.create с днями и упражнениями. */
  static async templateCreate(req, res) {
    const body = req.body ?? {};
    const shape = templateShape(body);
    const catalog = await Exercise.search({});
    const { data, errors } = parseTemplateForm(body, { ...shape, exerciseIds: new Set(catalog.map((e) => e.id)) });
    if (Object.keys(errors).length > 0) {
      res.status(400);
      return res.render('admin-template-new', {
        title: 'Новый шаблон', shape, catalog: toPlain(catalog), form: body, errors,
      });
    }
    const program = await Program.create({ ...data, status: ProgramStatus.DRAFT });
    res.redirect(`/admin/templates/${program.id}?created=1`);
  }

  /** GET /admin/templates/:id — изменение шаблона. */
  static async templateEdit(req, res) {
    await renderTemplate(req, res, await findTemplate(req));
  }

  /** POST /admin/templates/:id — название, цель и уровень шаблона. */
  static async templateUpdate(req, res) {
    const program = await findTemplate(req);
    const { data, errors } = parseProgramMeta(req.body ?? {});
    if (Object.keys(errors).length > 0) {
      res.status(400);
      return renderTemplate(req, res, program, { meta: req.body, metaErrors: errors, error: 'Проверьте поля шаблона' });
    }
    await program.update(data);
    res.redirect(`/admin/templates/${program.id}?saved=1`);
  }

  /** POST /admin/templates/:id/days/:dayId — упражнения и параметры нагрузки дня шаблона. */
  static async templateSaveDay(req, res) {
    const program = await findTemplate(req);
    const catalog = await Exercise.search({});
    const { errors, dayNumber } = await saveDay(program, parseId(req.params.dayId), req.body ?? {}, {
      exerciseIds: new Set(catalog.map((e) => e.id)),
    });
    if (Object.keys(errors).length > 0) {
      res.status(400);
      return renderTemplate(req, res, program, {
        errors, values: req.body, error: `День ${dayNumber}: проверьте отмеченные поля`,
      });
    }
    res.redirect(`/admin/templates/${program.id}?saved=1#day-${dayNumber}`);
  }

  /** POST /admin/templates/:id/publish — публикация: шаблон становится доступен пользователям. */
  static async templatePublish(req, res) {
    const program = await findTemplate(req);
    await program.activate();
    res.redirect('/admin/templates?published=1');
  }

  /** POST /admin/templates/:id/unpublish — снятие с публикации (копии пользователей сохраняются). */
  static async templateUnpublish(req, res) {
    const program = await findTemplate(req);
    await program.archive();
    res.redirect('/admin/templates?unpublished=1');
  }

  // ---------- Резервное копирование (ФТ-15) ----------

  /** GET /admin/backups — копии, журнал операций, расписание. */
  static async backups(req, res) {
    await renderBackups(req, res);
  }

  /** POST /admin/backups — резервная копия по запросу администратора. */
  static async backupCreate(req, res) {
    try {
      const log = await backupService.createBackup(req.user.id);
      res.redirect(`/admin/backups?done=created&file=${encodeURIComponent(log.fileName)}`);
    } catch (err) {
      res.status(err.status ?? 500);
      await renderBackups(req, res, { error: backupError(err, 'Не удалось создать резервную копию') });
    }
  }

  /**
   * POST /admin/backups/restore — восстановление БД из выбранной копии. Требуется подтверждение
   * (confirm=yes): текущие данные заменяются данными копии. Операция записывается в журнал.
   */
  static async backupRestore(req, res) {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
    if (req.body?.confirm !== 'yes') {
      res.status(400);
      return renderBackups(req, res, { error: 'Подтвердите восстановление: отметьте, что текущие данные будут заменены' });
    }
    try {
      await backupService.restore(fileName);
    } catch (err) {
      if (err.status !== 400 && err.status !== 404) {
        await BackupLog.create({ adminId: req.user.id, fileName, type: BackupType.RESTORE, status: BackupStatus.ERROR })
          .catch(() => {});
      }
      res.status(err.status ?? 500);
      return renderBackups(req, res, { error: backupError(err, 'Не удалось восстановить базу данных') });
    }
    // Администратора может не быть в восстановленных данных — тогда запись в журнал невозможна (FK).
    await BackupLog.create({ adminId: req.user.id, fileName, type: BackupType.RESTORE, status: BackupStatus.SUCCESS })
      .catch(() => {});
    res.redirect(`/admin/backups?done=restored&file=${encodeURIComponent(fileName)}`);
  }
}
