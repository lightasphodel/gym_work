import { config } from '../config/config.js';
import { Goal, Level } from '../models/enums.js';
import { EQUIPMENT, WORKOUTS_PER_WEEK, BODY_WEIGHT } from '../config/dictionaries.js';

/**
 * Валидация входных данных.
 * @param {(body: Record<string, unknown>) => string[]} rules функция, возвращающая список ошибок
 */
export function validate(rules) {
  return (req, res, next) => {
    const errors = rules(req.body ?? {});
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }
    next();
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isString = (v) => typeof v === 'string';

/** Правила регистрации (ФТ-01). */
export function registerRules(body) {
  const errors = [];
  const { login, email, password } = body;
  const sec = config.security;

  if (!isString(login) || !sec.loginPattern.test(login)) {
    errors.push('Логин: от 3 до 50 символов — латинские буквы, цифры, «_», «.», «-»');
  }
  if (!isString(email) || email.length > sec.emailMaxLength || !EMAIL_PATTERN.test(email)) {
    errors.push('Укажите корректный адрес электронной почты');
  }
  if (!isString(password)) {
    errors.push('Укажите пароль');
  } else {
    if (password.length < sec.passwordMinLength) {
      errors.push(`Пароль должен содержать не менее ${sec.passwordMinLength} символов`);
    }
    if (Buffer.byteLength(password, 'utf8') > sec.passwordMaxLength) {
      errors.push('Пароль слишком длинный');
    }
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
      errors.push('Пароль должен содержать хотя бы одну букву и одну цифру');
    }
  }
  return errors;
}

/** Правила авторизации (ФТ-02). */
export function loginRules(body) {
  const errors = [];
  if (!isString(body.login) || body.login.trim() === '') errors.push('Введите логин');
  if (!isString(body.password) || body.password === '') errors.push('Введите пароль');
  return errors;
}

const WEIGHT_PATTERN = /^\d{1,3}([.,]\d{1,2})?$/;

/**
 * Проверка анкеты тренировочного профиля (ФТ-03).
 * Данные приходят из HTML-формы: все значения — строки, отмеченные чекбоксы
 * инвентаря — строка (один) или массив (несколько).
 * @param {Record<string, unknown>} body
 * @returns {{data: {goal: string, level: string, workoutsPerWeek: number, equipment: string[], bodyWeight: number},
 *            errors: Record<string, string>}} errors пуст, если анкета корректна
 */
export function parseProfile(body) {
  const errors = {};
  const text = (v) => (isString(v) ? v.trim() : '');

  const goal = text(body.goal);
  if (!Object.values(Goal).includes(goal)) {
    errors.goal = 'Выберите цель тренировок';
  }

  const level = text(body.level);
  if (!Object.values(Level).includes(level)) {
    errors.level = 'Выберите уровень подготовки';
  }

  const wpwText = text(body.workoutsPerWeek);
  const workoutsPerWeek = Number(wpwText);
  if (!/^\d+$/.test(wpwText) || workoutsPerWeek < WORKOUTS_PER_WEEK.min || workoutsPerWeek > WORKOUTS_PER_WEEK.max) {
    errors.workoutsPerWeek =
      `Число тренировок в неделю — целое от ${WORKOUTS_PER_WEEK.min} до ${WORKOUTS_PER_WEEK.max}`;
  }

  const rawEquipment = body.equipment === undefined ? [] : [body.equipment].flat();
  const equipment = [...new Set(rawEquipment.map(text))];
  if (equipment.length === 0) {
    errors.equipment = 'Отметьте хотя бы один вид инвентаря';
  } else if (!equipment.every((e) => EQUIPMENT.includes(e))) {
    errors.equipment = 'Выбран неизвестный вид инвентаря';
  }

  const bwText = text(body.bodyWeight);
  const bodyWeight = Number(bwText.replace(',', '.'));
  if (!WEIGHT_PATTERN.test(bwText) || bodyWeight < BODY_WEIGHT.min || bodyWeight > BODY_WEIGHT.max) {
    errors.bodyWeight =
      `Масса тела — число от ${BODY_WEIGHT.min} до ${BODY_WEIGHT.max} кг, не более двух знаков после запятой`;
  }

  return { data: { goal, level, workoutsPerWeek, equipment, bodyWeight }, errors };
}

// ---------- Этап 8: справочник, параметры нагрузки, шаблоны ----------

const MAX_ID = 2 ** 31 - 1;
const text = (v) => (isString(v) ? v.trim() : '');

/** Целое из строки формы в диапазоне [min, max] или null. */
function intIn(value, min, max) {
  const s = text(value);
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Число с не более чем двумя знаками после запятой (запятая допустима) в [min, max] или null. */
function decimalIn(value, min, max) {
  const s = text(value);
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return n >= min && n <= max ? n : null;
}

/** Значения поля формы с несколькими флажками: строка или массив → массив строк. */
const listOf = (v) => (v === undefined ? [] : [v].flat().filter(isString));

/** Пределы параметров нагрузки упражнения программы. */
export const LOAD_LIMITS = Object.freeze({
  sets: [1, 10],
  reps: [1, 50],
  restSec: [0, 600],
  workingWeight: [0, 999.99],
});

/**
 * Проверка формы упражнения справочника (ФТ-13).
 * @param {Record<string, unknown>} body
 * @param {number[]} muscleIds существующие группы мышц
 * @returns {{data: {name: string, primaryMuscleId: number, secondaryMuscleIds: number[], equipment: string,
 *            difficulty: number, weightStep: number, technique: string|null}, errors: Record<string, string>}}
 */
export function parseExerciseForm(body, muscleIds) {
  const errors = {};
  const name = text(body.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) {
    errors.name = 'Название — от 2 до 100 символов';
  }
  const primaryMuscleId = intIn(body.primaryMuscleId, 1, MAX_ID);
  if (!muscleIds.includes(primaryMuscleId)) {
    errors.primaryMuscleId = 'Выберите основную группу мышц';
  }
  const secondary = listOf(body.secondaryMuscleIds).map((v) => intIn(v, 1, MAX_ID));
  if (!secondary.every((id) => muscleIds.includes(id))) {
    errors.secondaryMuscleIds = 'Выбрана неизвестная группа мышц';
  }
  const secondaryMuscleIds = [...new Set(secondary)].filter((id) => id !== primaryMuscleId);
  const equipment = text(body.equipment);
  if (!EQUIPMENT.includes(equipment)) {
    errors.equipment = 'Выберите инвентарь';
  }
  const difficulty = intIn(body.difficulty, 1, 3);
  if (difficulty === null) {
    errors.difficulty = 'Сложность — от 1 до 3';
  }
  const weightStep = decimalIn(body.weightStep, 0, 20);
  if (weightStep === null) {
    errors.weightStep = 'Шаг веса — число от 0 до 20 кг, не более двух знаков после запятой';
  }
  const technique = text(body.technique);
  if (technique.length > 5000) {
    errors.technique = 'Описание техники — не более 5000 символов';
  }
  return {
    data: { name, primaryMuscleId, secondaryMuscleIds, equipment, difficulty, weightStep, technique: technique || null },
    errors,
  };
}

/**
 * Проверка параметров нагрузки упражнений одного дня программы (ФТ-16, ФТ-14).
 * Поля формы: sets_<id>, repsMin_<id>, repsMax_<id>, restSec_<id>, workingWeight_<id>
 * и (для шаблона) exerciseId_<id>, где id — ProgramExercise.id.
 * @param {Record<string, unknown>} body
 * @param {number[]} ids упражнения дня
 * @param {{exerciseIds?: Set<number>}} [options] exerciseIds — допустимые упражнения для замены
 * @returns {{changes: Map<number, object>, errors: Record<string, string>}}
 */
export function parseLoadParams(body, ids, { exerciseIds } = {}) {
  const changes = new Map();
  const errors = {};
  const [sMin, sMax] = LOAD_LIMITS.sets;
  const [rMin, rMax] = LOAD_LIMITS.reps;
  const [tMin, tMax] = LOAD_LIMITS.restSec;
  const [wMin, wMax] = LOAD_LIMITS.workingWeight;

  for (const id of ids) {
    const sets = intIn(body[`sets_${id}`], sMin, sMax);
    const repsMin = intIn(body[`repsMin_${id}`], rMin, rMax);
    const repsMax = intIn(body[`repsMax_${id}`], rMin, rMax);
    const restSec = intIn(body[`restSec_${id}`], tMin, tMax);
    const workingWeight = decimalIn(body[`workingWeight_${id}`], wMin, wMax);

    if (sets === null) errors[`sets_${id}`] = `Подходы — целое от ${sMin} до ${sMax}`;
    if (repsMin === null) errors[`repsMin_${id}`] = `Повторения — целое от ${rMin} до ${rMax}`;
    if (repsMax === null) errors[`repsMax_${id}`] = `Повторения — целое от ${rMin} до ${rMax}`;
    else if (repsMin !== null && repsMax < repsMin) errors[`repsMax_${id}`] = 'Верхняя граница повторений меньше нижней';
    if (restSec === null) errors[`restSec_${id}`] = `Отдых — целое от ${tMin} до ${tMax} с`;
    if (workingWeight === null) {
      errors[`workingWeight_${id}`] = `Рабочий вес — от ${wMin} до ${wMax} кг, не более двух знаков после запятой`;
    }

    const data = { sets, repsMin, repsMax, restSec, workingWeight };
    if (exerciseIds) {
      const exerciseId = intIn(body[`exerciseId_${id}`], 1, MAX_ID);
      if (!exerciseIds.has(exerciseId)) errors[`exerciseId_${id}`] = 'Выберите упражнение из справочника';
      data.exerciseId = exerciseId;
    }
    changes.set(id, data);
  }
  return { changes, errors };
}

/**
 * Проверка названия, цели и уровня программы (шаблона).
 * @param {Record<string, unknown>} body
 * @returns {{data: {title: string, goal: string, level: string}, errors: Record<string, string>}}
 */
export function parseProgramMeta(body) {
  const errors = {};
  const title = text(body.title).replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 100) errors.title = 'Название — от 3 до 100 символов';
  const goal = text(body.goal);
  if (!Object.values(Goal).includes(goal)) errors.goal = 'Выберите цель тренировок';
  const level = text(body.level);
  if (!Object.values(Level).includes(level)) errors.level = 'Выберите уровень подготовки';
  return { data: { title, goal, level }, errors };
}

/** Пределы структуры нового шаблона: число дней и упражнений в дне. */
export const TEMPLATE_LIMITS = Object.freeze({ days: [1, 6], perDay: [1, 8] });

/**
 * Проверка формы нового шаблона программы (ФТ-14): название, цель, уровень, общие
 * параметры нагрузки, названия дней (day<N>_title) и упражнения (day<N>_ex<K>; пустое — пропуск).
 * @param {Record<string, unknown>} body
 * @param {{days: number, perDay: number, exerciseIds: Set<number>}} shape
 * @returns {{data: object, errors: Record<string, string>}} data — структура для Program.create
 */
export function parseTemplateForm(body, { days, perDay, exerciseIds }) {
  const { data: meta, errors } = parseProgramMeta(body);
  const [sMin, sMax] = LOAD_LIMITS.sets;
  const [rMin, rMax] = LOAD_LIMITS.reps;
  const [tMin, tMax] = LOAD_LIMITS.restSec;
  const sets = intIn(body.sets, sMin, sMax);
  const repsMin = intIn(body.repsMin, rMin, rMax);
  const repsMax = intIn(body.repsMax, rMin, rMax);
  const restSec = intIn(body.restSec, tMin, tMax);
  if (sets === null) errors.sets = `Подходы — целое от ${sMin} до ${sMax}`;
  if (repsMin === null) errors.repsMin = `Повторения — целое от ${rMin} до ${rMax}`;
  if (repsMax === null) errors.repsMax = `Повторения — целое от ${rMin} до ${rMax}`;
  else if (repsMin !== null && repsMax < repsMin) errors.repsMax = 'Верхняя граница повторений меньше нижней';
  if (restSec === null) errors.restSec = `Отдых — целое от ${tMin} до ${tMax} с`;

  const dayList = [];
  for (let d = 1; d <= days; d += 1) {
    const title = text(body[`day${d}_title`]).replace(/\s+/g, ' ');
    if (title.length < 1 || title.length > 100) errors[`day${d}_title`] = 'Название дня — от 1 до 100 символов';
    const exercises = [];
    let invalid = false;
    for (let k = 1; k <= perDay; k += 1) {
      const raw = text(body[`day${d}_ex${k}`]);
      if (raw === '') continue;
      const exerciseId = intIn(raw, 1, MAX_ID);
      if (!exerciseIds.has(exerciseId)) {
        errors[`day${d}_ex${k}`] = 'Выберите упражнение из справочника';
        invalid = true;
        continue;
      }
      exercises.push({ exerciseId, orderNo: exercises.length + 1, sets, repsMin, repsMax, restSec, workingWeight: 0 });
    }
    if (exercises.length === 0 && !invalid) {
      errors[`day${d}_ex1`] = 'В дне должно быть хотя бы одно упражнение';
    }
    dayList.push({ dayNumber: d, title, exercises });
  }
  return { data: { ...meta, ownerId: null, isTemplate: true, days: dayList }, errors };
}
