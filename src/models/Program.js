import { query, withTransaction, buildSet } from '../config/db.js';
import { ProgramStatus } from './enums.js';
import { ProgramDay } from './ProgramDay.js';
import { ProgramExercise } from './ProgramExercise.js';

/** Изменяемые свойства программы. Статус меняется только методами activate() и archive(). */
const FIELDS = { title: 'title', goal: 'goal', level: 'level' };

/**
 * Тренировочная программа: личная (ownerId задан) или шаблонная (isTemplate, ownerId = null).
 * Состоит из тренировочных дней ProgramDay (композиция).
 */
export class Program {
  constructor(row) {
    this.id = row.id;
    this.ownerId = row.owner_id;
    this.title = row.title;
    this.goal = row.goal;
    this.level = row.level;
    this.isTemplate = row.is_template;
    this.status = row.status;
    this.createdAt = row.created_at;
  }

  /**
   * Создание личной копии шаблонной программы со всеми днями и упражнениями (ФТ-16).
   * Копия создаётся в статусе DRAFT.
   * @param {number} userId
   * @returns {Promise<Program>}
   */
  async copyFor(userId) {
    if (!this.isTemplate) {
      throw new Error('Копировать можно только шаблонную программу');
    }
    const days = await ProgramDay.findByProgram(this.id);
    const daysData = [];
    for (const day of days) {
      const exercises = await ProgramExercise.findByDay(day.id);
      daysData.push({
        dayNumber: day.dayNumber,
        title: day.title,
        exercises: exercises.map((pe) => ({
          exerciseId: pe.exerciseId,
          orderNo: pe.orderNo,
          sets: pe.sets,
          repsMin: pe.repsMin,
          repsMax: pe.repsMax,
          restSec: pe.restSec,
          workingWeight: pe.workingWeight,
        })),
      });
    }
    return Program.create({
      ownerId: userId,
      title: this.title,
      goal: this.goal,
      level: this.level,
      isTemplate: false,
      status: ProgramStatus.DRAFT,
      days: daysData,
    });
  }

  /**
   * Изменение названия, цели и уровня программы.
   * @param {{title?: string, goal?: string, level?: string}} data
   */
  async update(data) {
    const params = [];
    const set = buildSet(FIELDS, data, params);
    if (!set) return;
    params.push(this.id);
    const { rows } = await query(
      `UPDATE programs SET ${set} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    Object.assign(this, new Program(rows[0]));
  }

  /**
   * Активация программы. Прежняя активная программа владельца переводится в архив
   * (история тренировок при этом сохраняется).
   */
  async activate() {
    await withTransaction(async (client) => {
      if (this.ownerId !== null) {
        await client.query(
          `UPDATE programs SET status = $1
            WHERE owner_id = $2 AND status = $3 AND id <> $4`,
          [ProgramStatus.ARCHIVED, this.ownerId, ProgramStatus.ACTIVE, this.id],
        );
      }
      await client.query('UPDATE programs SET status = $1 WHERE id = $2', [
        ProgramStatus.ACTIVE,
        this.id,
      ]);
    });
    this.status = ProgramStatus.ACTIVE;
  }

  /** Перевод программы в архив. */
  async archive() {
    await query('UPDATE programs SET status = $1 WHERE id = $2', [ProgramStatus.ARCHIVED, this.id]);
    this.status = ProgramStatus.ARCHIVED;
  }

  /**
   * Создание программы вместе с днями и упражнениями в одной транзакции.
   * @param {{
   *   ownerId: number|null, title: string, goal: string, level: string,
   *   isTemplate?: boolean, status?: string,
   *   days?: Array<{dayNumber: number, title: string, exercises?: Array<{
   *     exerciseId: number, orderNo: number, sets: number, repsMin: number,
   *     repsMax: number, restSec: number, workingWeight?: number }>}>
   * }} data
   * @returns {Promise<Program>}
   */
  static async create(data) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO programs (owner_id, title, goal, level, is_template, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          data.ownerId ?? null,
          data.title,
          data.goal,
          data.level,
          data.isTemplate ?? false,
          data.status ?? ProgramStatus.DRAFT,
        ],
      );
      const program = new Program(rows[0]);

      for (const day of data.days ?? []) {
        const dayRes = await client.query(
          `INSERT INTO program_days (program_id, day_number, title)
           VALUES ($1, $2, $3) RETURNING id`,
          [program.id, day.dayNumber, day.title],
        );
        const dayId = dayRes.rows[0].id;
        for (const ex of day.exercises ?? []) {
          await client.query(
            `INSERT INTO program_exercises
               (program_day_id, exercise_id, order_no, sets, reps_min, reps_max, rest_sec, working_weight)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [dayId, ex.exerciseId, ex.orderNo, ex.sets, ex.repsMin, ex.repsMax, ex.restSec, ex.workingWeight ?? 0],
          );
        }
      }
      return program;
    });
  }

  /**
   * Активная программа пользователя.
   * @param {number} userId
   * @returns {Promise<Program|null>}
   */
  static async findActive(userId) {
    const { rows } = await query(
      `SELECT * FROM programs
        WHERE owner_id = $1 AND status = $2 AND NOT is_template
        LIMIT 1`,
      [userId, ProgramStatus.ACTIVE],
    );
    return rows.length ? new Program(rows[0]) : null;
  }
}
