/**
 * Справочные значения интерфейса: допустимый инвентарь и русские названия
 * значений перечислений. Это не перечисления модели (они — в src/models/enums.js),
 * а подписи для страниц и список для проверки ввода.
 */
import { Goal, Level } from '../models/enums.js';

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
