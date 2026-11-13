import { query } from '../config/db.js';

/**
 * Личный рекорд пользователя в упражнении.
 */
export class PersonalRecord {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.exerciseId = row.exercise_id;
    this.type = row.type;
    this.value = row.value;
    this.achievedAt = row.achieved_at;
  }

  /**
   * Текущие (наилучшие) рекорды пользователя в упражнении — по одному на каждый тип.
   * @param {number} userId
   * @param {number} exId
   * @returns {Promise<PersonalRecord[]>}
   */
  static async findBest(userId, exId) {
    const { rows } = await query(
      `SELECT DISTINCT ON (type) *
         FROM personal_records
        WHERE user_id = $1 AND exercise_id = $2
        ORDER BY type, value DESC, achieved_at DESC`,
      [userId, exId],
    );
    return rows.map((r) => new PersonalRecord(r));
  }

  /**
   * @param {{userId: number, exerciseId: number, type: string, value: number, achievedAt?: string}} data
   * @returns {Promise<PersonalRecord>}
   */
  static async create(data) {
    const { rows } = await query(
      `INSERT INTO personal_records (user_id, exercise_id, type, value, achieved_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE)) RETURNING *`,
      [data.userId, data.exerciseId, data.type, data.value, data.achievedAt ?? null],
    );
    return new PersonalRecord(rows[0]);
  }
}
