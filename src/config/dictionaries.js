/**
 * Справочные значения интерфейса: допустимый инвентарь и русские названия
 * значений перечислений. Это не перечисления модели (они — в src/models/enums.js),
 * а подписи для страниц и список для проверки ввода.
 */
import { Goal, Level, RecordType, Decision } from '../models/enums.js';

/** Виды инвентаря (exercises.equipment, training_profiles.equipment), как в db/seed.sql. */
export const EQUIPMENT = Object.freeze(['штанга', 'гантели', 'тренажёр', 'собственный вес']);

/** Названия целей тренировок. */
export const goalNames = Object.freeze({
  [Goal.GENERAL]: 'Общая физическая подготовка',
  [Goal.HYPERTROPHY]: 'Набор мышечной массы',
  [Goal.STRENGTH]: 'Развитие силы',
  [Goal.ENDURANCE]: 'Силовая выносливость',
});

/** Названия уровней подготовки. */
export const levelNames = Object.freeze({
  [Level.BEGINNER]: 'Начальный',
  [Level.INTERMEDIATE]: 'Средний',
  [Level.ADVANCED]: 'Продвинутый',
});

/** Названия уровней сложности упражнения (exercises.difficulty). */
export const difficultyNames = Object.freeze({
  1: 'Начальная',
  2: 'Средняя',
  3: 'Высокая',
});

/** Допустимое число тренировок в неделю в анкете профиля. */
export const WORKOUTS_PER_WEEK = Object.freeze({ min: 2, max: 6 });

/** Допустимая масса тела в анкете профиля, кг. */
export const BODY_WEIGHT = Object.freeze({ min: 30, max: 300 });

/** Названия типов личных рекордов. */
export const recordTypeNames = Object.freeze({
  [RecordType.MAX_WEIGHT]: 'Максимальный вес',
  [RecordType.MAX_REPS]: 'Максимум повторений',
  [RecordType.MAX_1RM]: 'Расчётный 1ПМ',
  [RecordType.MAX_TONNAGE]: 'Тоннаж упражнения',
});

/** Названия решений алгоритма адаптации. */
export const decisionNames = Object.freeze({
  [Decision.INCREASE]: 'Увеличение',
  [Decision.KEEP]: 'Сохранение',
  [Decision.DECREASE]: 'Снижение',
});
