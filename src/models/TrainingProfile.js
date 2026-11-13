import { query, buildSet } from '../config/db.js';

/** Соответствие свойств модели столбцам таблицы training_profiles (изменяемые поля). */
const FIELDS = {
  goal: 'goal',
  level: 'level',
  workoutsPerWeek: 'workouts_per_week',
  equipment: 'equipment',
  bodyWeight: 'body_weight',
};

/**
 * Тренировочный профиль пользователя (композиция с User).
 */
export class TrainingProfile {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.goal = row.goal;
    this.level = row.level;
    this.workoutsPerWeek = row.workouts_per_week;
    this.equipment = row.equipment ?? [];
    this.bodyWeight = row.body_weight;
  }

  /** Профиль заполнен, если указаны цель, уровень и число тренировок в неделю. */
  isComplete() {
    return Boolean(this.goal && this.level && this.workoutsPerWeek);
  }

  /**
   * Изменение профиля (ФТ-03). Передаются только изменяемые свойства.
   * @param {{goal?: string, level?: string, workoutsPerWeek?: number, equipment?: string[], bodyWeight?: number}} data
   */
  async update(data) {
    const params = [];
    const set = buildSet(FIELDS, data, params);
    if (!set) return;
    params.push(this.id);
    const { rows } = await query(
      `UPDATE training_profiles SET ${set} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    Object.assign(this, new TrainingProfile(rows[0]));
  }

  /**
   * @param {{userId: number, goal?: string, level?: string, workoutsPerWeek?: number, equipment?: string[], bodyWeight?: number}} data
   * @returns {Promise<TrainingProfile>}
   */
  static async create(data) {
    const { rows } = await query(
      `INSERT INTO training_profiles (user_id, goal, level, workouts_per_week, equipment, body_weight)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        data.userId,
        data.goal ?? null,
        data.level ?? null,
        data.workoutsPerWeek ?? null,
        data.equipment ?? [],
        data.bodyWeight ?? null,
      ],
    );
    return new TrainingProfile(rows[0]);
  }

  /**
   * @param {number} userId
   * @returns {Promise<TrainingProfile|null>}
   */
  static async findByUser(userId) {
    const { rows } = await query('SELECT * FROM training_profiles WHERE user_id = $1', [userId]);
    return rows.length ? new TrainingProfile(rows[0]) : null;
  }
}
