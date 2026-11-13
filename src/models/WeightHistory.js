import { query } from '../config/db.js';

/**
 * Запись истории изменения рабочего веса (результат алгоритма адаптации).
 */
export class WeightHistory {
  constructor(row) {
    this.id = row.id;
    this.programExerciseId = row.program_exercise_id;
    this.date = row.date;
    this.oldWeight = row.old_weight;
    this.newWeight = row.new_weight;
    this.decision = row.decision;
  }

  /**
   * @param {{programExerciseId: number, oldWeight: number, newWeight: number, decision: string, date?: string}} data
   * @returns {Promise<WeightHistory>}
   */
  static async create(data) {
    const { rows } = await query(
      `INSERT INTO weight_history (program_exercise_id, date, old_weight, new_weight, decision)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5) RETURNING *`,
      [data.programExerciseId, data.date ?? null, data.oldWeight, data.newWeight, data.decision],
    );
    return new WeightHistory(rows[0]);
  }
}
