import { query, withTransaction } from '../config/db.js';

/** Пересчёт тоннажа тренировки после изменения её подходов (формула 1.3). */
async function refreshTonnage(client, workoutId) {
  await client.query(
    `UPDATE workouts
        SET tonnage = (SELECT COALESCE(SUM(weight * reps), 0)
                         FROM workout_sets WHERE workout_id = $1)
      WHERE id = $1`,
    [workoutId],
  );
}

/**
 * Подход тренировки (композиция с Workout, кратность 1..*).
 */
export class WorkoutSet {
  #id;
  #workoutId;
  #programExerciseId;
  #setNo;
  #weight;
  #reps;

  /** @param {object} row строка таблицы workout_sets */
  constructor(row) {
    this.#id = row.id;
    this.#workoutId = row.workout_id;
    this.#programExerciseId = row.program_exercise_id;
    this.#setNo = row.set_no;
    this.#weight = row.weight;
    this.#reps = row.reps;
  }

  get id() { return this.#id; }
  get workoutId() { return this.#workoutId; }
  get programExerciseId() { return this.#programExerciseId; }
  get setNo() { return this.#setNo; }
  get weight() { return this.#weight; }
  get reps() { return this.#reps; }

  /**
   * Объём подхода: вес × повторения.
   * @returns {number}
   */
  volume() {
    return this.#weight * this.#reps;
  }

  /**
   * Исправление веса и количества повторений (ФТ-17) с пересчётом тоннажа тренировки.
   * @param {number} weight
   * @param {number} reps
   */
  async update(weight, reps) {
    await withTransaction(async (client) => {
      await client.query('UPDATE workout_sets SET weight = $1, reps = $2 WHERE id = $3', [
        weight,
        reps,
        this.#id,
      ]);
      await refreshTonnage(client, this.#workoutId);
    });
    this.#weight = weight;
    this.#reps = reps;
  }

  /**
   * Удаление подхода (ФТ-17) с пересчётом тоннажа тренировки.
   * Единственный подход не удаляется: тренировка включает не менее одного подхода (1..*),
   * в этом случае удаляется тренировка целиком (Workout.remove()).
   */
  async remove() {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = $1',
        [this.#workoutId],
      );
      if (rows[0].n <= 1) {
        const err = new Error('Это единственный подход тренировки — удалите тренировку целиком');
        err.status = 409;
        throw err;
      }
      await client.query('DELETE FROM workout_sets WHERE id = $1', [this.#id]);
      await refreshTonnage(client, this.#workoutId);
    });
  }

  /**
   * Подходы тренировки в порядке внесения.
   * @param {number} workoutId
   * @returns {Promise<WorkoutSet[]>}
   */
  static async findByWorkout(workoutId) {
    const { rows } = await query(
      'SELECT * FROM workout_sets WHERE workout_id = $1 ORDER BY id',
      [workoutId],
    );
    return rows.map((r) => new WorkoutSet(r));
  }

  /**
   * Подходы упражнения программы за последние limit тренировок (от новых к старым).
   * @param {number} peId  идентификатор ProgramExercise
   * @param {number} limit количество последних тренировок
   * @returns {Promise<WorkoutSet[]>}
   */
  static async findHistory(peId, limit) {
    const { rows } = await query(
      `SELECT ws.*
         FROM workout_sets ws
         JOIN workouts w ON w.id = ws.workout_id
        WHERE ws.program_exercise_id = $1
          AND ws.workout_id IN (
                SELECT w2.id FROM workouts w2
                 WHERE EXISTS (SELECT 1 FROM workout_sets s
                                WHERE s.workout_id = w2.id AND s.program_exercise_id = $1)
                 ORDER BY w2.date DESC, w2.id DESC
                 LIMIT $2)
        ORDER BY w.date DESC, w.id DESC, ws.set_no`,
      [peId, limit],
    );
    return rows.map((r) => new WorkoutSet(r));
  }
}
