import { query, withTransaction, buildSet } from '../config/db.js';

/** Изменяемые свойства упражнения. */
const FIELDS = {
  name: 'name',
  primaryMuscleId: 'primary_muscle_id',
  equipment: 'equipment',
  difficulty: 'difficulty',
  technique: 'technique',
  weightStep: 'weight_step',
};

/** Запись вспомогательных групп мышц (ассоциация «вспомогательные», таблица exercise_muscles). */
async function saveSecondaryMuscles(client, exerciseId, muscleIds) {
  await client.query('DELETE FROM exercise_muscles WHERE exercise_id = $1', [exerciseId]);
  for (const muscleId of new Set(muscleIds)) {
    await client.query(
      'INSERT INTO exercise_muscles (exercise_id, muscle_group_id) VALUES ($1, $2)',
      [exerciseId, muscleId],
    );
  }
}

/**
 * Упражнение справочника (ФТ-13).
 * Основная группа мышц — primaryMuscleId, вспомогательные хранятся в таблице exercise_muscles.
 */
export class Exercise {
  #id;
  #name;
  #primaryMuscleId;
  #equipment;
  #difficulty;
  #technique;
  #weightStep;
  #isActive;

  /** @param {object} row строка таблицы exercises */
  constructor(row) {
    this.#id = row.id;
    this.#name = row.name;
    this.#primaryMuscleId = row.primary_muscle_id;
    this.#equipment = row.equipment;
    this.#difficulty = row.difficulty;
    this.#technique = row.technique;
    this.#weightStep = row.weight_step;
    this.#isActive = row.is_active;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get primaryMuscleId() { return this.#primaryMuscleId; }
  get equipment() { return this.#equipment; }
  get difficulty() { return this.#difficulty; }
  get technique() { return this.#technique; }
  get weightStep() { return this.#weightStep; }
  get isActive() { return this.#isActive; }

  /**
   * Изменение упражнения. Если передан secondaryMuscleIds, список вспомогательных
   * групп мышц заменяется целиком.
   * @param {{name?: string, primaryMuscleId?: number, equipment?: string, difficulty?: number,
   *          technique?: string, weightStep?: number, secondaryMuscleIds?: number[]}} data
   */
  async update(data) {
    const params = [];
    const set = buildSet(FIELDS, data, params);
    await withTransaction(async (client) => {
      if (set) {
        params.push(this.#id);
        const { rows } = await client.query(
          `UPDATE exercises SET ${set} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        const r = rows[0];
        this.#name = r.name;
        this.#primaryMuscleId = r.primary_muscle_id;
        this.#equipment = r.equipment;
        this.#difficulty = r.difficulty;
        this.#technique = r.technique;
        this.#weightStep = r.weight_step;
      }
      if (Array.isArray(data.secondaryMuscleIds)) {
        await saveSecondaryMuscles(client, this.#id, data.secondaryMuscleIds);
      }
    });
  }

  /** Деактивация: упражнение не удаляется физически, чтобы сохранить историю тренировок. */
  async deactivate() {
    await query('UPDATE exercises SET is_active = FALSE WHERE id = $1', [this.#id]);
    this.#isActive = false;
  }

  /**
   * @param {{name: string, primaryMuscleId: number, equipment: string, difficulty: number,
   *          technique?: string, weightStep: number, secondaryMuscleIds?: number[]}} data
   * @returns {Promise<Exercise>}
   */
  static async create(data) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exercises (name, primary_muscle_id, equipment, difficulty, technique, weight_step)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.name, data.primaryMuscleId, data.equipment, data.difficulty, data.technique ?? null, data.weightStep],
      );
      const exercise = new Exercise(rows[0]);
      await saveSecondaryMuscles(client, exercise.id, data.secondaryMuscleIds ?? []);
      return exercise;
    });
  }

  /**
   * @param {number} id
   * @returns {Promise<Exercise|null>}
   */
  static async findById(id) {
    const { rows } = await query('SELECT * FROM exercises WHERE id = $1', [id]);
    return rows.length ? new Exercise(rows[0]) : null;
  }

  /**
   * Поиск упражнений по фильтру.
   * @param {{
   *   muscleId?: number,            // основная или вспомогательная группа мышц
   *   equipment?: string|string[],  // требуемый инвентарь (один или любой из списка)
   *   difficulty?: number,          // максимальный уровень сложности (включительно)
   *   includeInactive?: boolean     // по умолчанию только активные
   * }} [filter]
   * @returns {Promise<Exercise[]>}
   */
  static async search(filter = {}) {
    const where = [];
    const params = [];

    if (!filter.includeInactive) {
      where.push('e.is_active');
    }
    if (filter.muscleId !== undefined && filter.muscleId !== null) {
      params.push(filter.muscleId);
      where.push(`(e.primary_muscle_id = $${params.length}
        OR EXISTS (SELECT 1 FROM exercise_muscles em
                    WHERE em.exercise_id = e.id AND em.muscle_group_id = $${params.length}))`);
    }
    if (Array.isArray(filter.equipment)) {
      params.push(filter.equipment);
      where.push(`e.equipment = ANY($${params.length})`);
    } else if (filter.equipment) {
      params.push(filter.equipment);
      where.push(`e.equipment = $${params.length}`);
    }
    if (filter.difficulty !== undefined && filter.difficulty !== null) {
      // Упражнения не сложнее заданного уровня (генератору нужны все доступные уровню).
      params.push(filter.difficulty);
      where.push(`e.difficulty <= $${params.length}`);
    }

    const sql = `SELECT e.* FROM exercises e
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY e.name`;
    const { rows } = await query(sql, params);
    return rows.map((r) => new Exercise(r));
  }
}
