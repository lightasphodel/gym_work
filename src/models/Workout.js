import { query, withTransaction } from '../config/db.js';

/**
 * Выполненная тренировка. Включает подходы WorkoutSet (композиция).
 */
export class Workout {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.programDayId = row.program_day_id;
    this.date = row.date;
    this.tonnage = row.tonnage;
    this.isCompleted = row.is_completed;
  }

  /**
   * Расчёт тоннажа тренировки T = Σ Wi · ri (формула 1.3) и сохранение его в записи.
   * @param {import('pg').PoolClient} [client] подключение текущей транзакции
   * @returns {Promise<number>}
   */
  async calcTonnage(client) {
    const db = client ?? { query };
    const { rows } = await db.query(
      `UPDATE workouts
          SET tonnage = (SELECT COALESCE(SUM(weight * reps), 0)
                           FROM workout_sets WHERE workout_id = $1)
        WHERE id = $1
        RETURNING tonnage`,
      [this.id],
    );
    this.tonnage = rows[0].tonnage;
    return this.tonnage;
  }

  /** Удаление тренировки вместе с подходами (композиция, ON DELETE CASCADE). */
  async remove() {
    await query('DELETE FROM workouts WHERE id = $1', [this.id]);
  }

  /**
   * @param {number} id
   * @returns {Promise<Workout|null>}
   */
  static async findById(id) {
    const { rows } = await query('SELECT * FROM workouts WHERE id = $1', [id]);
    return rows.length ? new Workout(rows[0]) : null;
  }

  /**
   * Сохранение тренировки и подходов в одной транзакции с расчётом тоннажа.
   * Тренировка считается завершённой, если по каждому упражнению дня внесены все подходы.
   * @param {number} userId
   * @param {number} dayId
   * @param {Array<{programExerciseId: number, setNo: number, weight: number, reps: number}>} sets
   * @returns {Promise<Workout>}
   */
  static async create(userId, dayId, sets) {
    return withTransaction(async (client) => {
      // Подходы должны относиться к упражнениям выбранного тренировочного дня.
      const peRes = await client.query(
        'SELECT id, sets FROM program_exercises WHERE program_day_id = $1',
        [dayId],
      );
      const planned = new Map(peRes.rows.map((r) => [r.id, r.sets]));
      for (const s of sets) {
        if (!planned.has(s.programExerciseId)) {
          throw new Error(`Упражнение ${s.programExerciseId} не относится к тренировочному дню ${dayId}`);
        }
      }

      const { rows } = await client.query(
        'INSERT INTO workouts (user_id, program_day_id) VALUES ($1, $2) RETURNING *',
        [userId, dayId],
      );
      const workout = new Workout(rows[0]);

      for (const s of sets) {
        await client.query(
          `INSERT INTO workout_sets (workout_id, program_exercise_id, set_no, weight, reps)
           VALUES ($1, $2, $3, $4, $5)`,
          [workout.id, s.programExerciseId, s.setNo, s.weight, s.reps],
        );
      }

      await workout.calcTonnage(client);

      const done = new Map();
      for (const s of sets) {
        done.set(s.programExerciseId, (done.get(s.programExerciseId) ?? 0) + 1);
      }
      const isCompleted =
        planned.size > 0 && [...planned].every(([peId, plan]) => (done.get(peId) ?? 0) >= plan);
      if (isCompleted) {
        await client.query('UPDATE workouts SET is_completed = TRUE WHERE id = $1', [workout.id]);
        workout.isCompleted = true;
      }
      return workout;
    });
  }

  /**
   * Тренировки пользователя за период (включительно).
   * @param {number} userId
   * @param {string} from 'YYYY-MM-DD'
   * @param {string} to   'YYYY-MM-DD'
   * @returns {Promise<Workout[]>}
   */
  static async findByPeriod(userId, from, to) {
    const { rows } = await query(
      `SELECT * FROM workouts
        WHERE user_id = $1 AND date BETWEEN $2 AND $3
        ORDER BY date, id`,
      [userId, from, to],
    );
    return rows.map((r) => new Workout(r));
  }
}
