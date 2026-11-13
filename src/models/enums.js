/**
 * Перечисления диаграммы классов (пакет models).
 * Значения совпадают с перечислимыми типами PostgreSQL в db/schema.sql.
 */

/** Роль пользователя */
export const Role = Object.freeze({
  USER: 'USER',
  ADMIN: 'ADMIN',
});

/** Цель тренировок */
export const Goal = Object.freeze({
  GENERAL: 'GENERAL',
  HYPERTROPHY: 'HYPERTROPHY',
  STRENGTH: 'STRENGTH',
  ENDURANCE: 'ENDURANCE',
});

/** Уровень подготовки */
export const Level = Object.freeze({
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
});

/** Статус программы */
export const ProgramStatus = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
});

/** Тип личного рекорда */
export const RecordType = Object.freeze({
  MAX_WEIGHT: 'MAX_WEIGHT',
  MAX_REPS: 'MAX_REPS',
  MAX_1RM: 'MAX_1RM',
  MAX_TONNAGE: 'MAX_TONNAGE',
});

/** Решение алгоритма адаптации рабочего веса */
export const Decision = Object.freeze({
  INCREASE: 'INCREASE',
  KEEP: 'KEEP',
  DECREASE: 'DECREASE',
});
