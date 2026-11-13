import { query, withTransaction } from '../config/db.js';
import { WorkoutSet } from './WorkoutSet.js';

/**
 * Выполненная тренировка. Включает подходы WorkoutSet (композиция 1..*).
 * Подходы хранятся в закрытом поле #sets — это реализация линии композиции
 * Workout ◆— WorkoutSet на диаграмме классов, отдельным атрибутом она не показывается.
 */
export class Workout {
  #id;
  #userId;
  #programDayId;
  #date;
  #tonnage;
  #isCompleted;
  /** @type {WorkoutSet[]} */
  #sets;

  /**
   * @param {object} row строка таблицы workouts
   * @param {WorkoutSet[]} [sets] подходы тренировки
   */
  constructor(row, sets = []) {
    this.#id = row.id;
    this.#userId = row.user_id;
    this.#programDayId = row.program_day_id;
    this.#date = row.date;
    this.#tonnage = row.tonnage;
    this.#isCompleted = row.is_completed;
    this.#sets = [...sets];
  }

  get id() { return this.#id; }
  get userId() { return this.#userId; }
  get programDayId() { return this.#programDayId; }
  get date() { return this.#date; }
  get tonnage() { return this.#tonnage; }
  get isCompleted() { return this.#isCompleted; }
  /** Копия списка подходов: изменить его снаружи нельзя. */
  get sets() { return [...this.#sets]; }

  /**
   * Тоннаж тренировки T = Σ Wi · ri (формула 1.3) — сумма объёмов подходов WorkoutSet.volume().
   * Результат округляется до 0,01 (точность столбца workouts.tonnage).
   * @returns {number}
   */
  calcTonnage() {
    const sum = this.#sets.reduce((acc, set) => acc + set.volume(), 0);
    return Math.round(sum * 100) / 100;
  }

  /** Удаление тренировки вместе с подходами (композиция, ON DELETE CASCADE). */
  async remove() {
    await query('DELETE FROM workouts WHERE id = $1', [this.#id]);
  }

  /**
   * Тренировка вместе с подходами.
   * @param {number} id
   * @returns {Promise<Workout|null>}
   */
  static async findById(id) {
    const { rows } = await query('SELECT * FROM workouts WHERE id = $1', [id]);
    if (!rows.length) return null;
    const sets = await WorkoutSet.findByWorkout(id);
    return new Workout(rows[0], sets);
  }

  /**
   * Сохранение тренировки и подходов в одной транзакции.
   * Тоннаж считается calcTonnage() по созданным подходам и записывается в той же транзакции.
   * Тренировка считается завершённой, если по каждому упражнению дня внесены все подходы.
   * @param {number} userId
   * @param {number} dayId
   * @param {Array<{programExerciseId: number, setNo: number, weight: number, reps: number}>} sets
   * @returns {Promise<Workout>}
   */
  static async create(userId, dayId, sets) {
    if (!Array.isArray(sets) || sets.length === 0) {
      const err = new Error('Тренировка должна содержать хотя бы один подход');
      err.status = 400;
      throw err;
    }
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
      const workoutRow = rows[0];

      const created = [];
      for (const s of sets) {
        const setRes = await client.query(
          `INSERT INTO workout_sets (workout_id, program_exercise_id, set_no, weight, reps)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [workoutRow.id, s.programExerciseId, s.setNo, s.weight, s.reps],
        );
        created.push(new WorkoutSet(setRes.rows[0]));
      }

      const tonnage = new Workout(workoutRow, created).calcTonnage();

      const done = new Map();
      for (const s of created) {
        done.set(s.programExerciseId, (done.get(s.programExerciseId) ?? 0) + 1);
      }
      const isCompleted =
        planned.size > 0 && [...planned].every(([peId, plan]) => (done.get(peId) ?? 0) >= plan);

      const saved = await client.query(
        'UPDATE workouts SET tonnage = $1, is_completed = $2 WHERE id = $3 RETURNING *',
        [tonnage, isCompleted, workoutRow.id],
      );
      return new Workout(saved.rows[0], created);
    });
  }

  /**
   * Тренировки пользователя за период (включительно) вместе с подходами.
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
    if (!rows.length) return [];

    // Подходы всех найденных тренировок — одним запросом.
    const setRes = await query(
      'SELECT * FROM workout_sets WHERE workout_id = ANY($1) ORDER BY id',
      [rows.map((r) => r.id)],
    );
    const byWorkout = new Map();
    for (const r of setRes.rows) {
      if (!byWorkout.has(r.workout_id)) byWorkout.set(r.workout_id, []);
      byWorkout.get(r.workout_id).push(new WorkoutSet(r));
    }
    return rows.map((r) => new Workout(r, byWorkout.get(r.id) ?? []));
  }
}
