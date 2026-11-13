import { query, buildSet } from '../config/db.js';

/** Изменяемые параметры упражнения программы (ФТ-16: замена упражнения, параметры нагрузки). */
const FIELDS = {
  exerciseId: 'exercise_id',
  orderNo: 'order_no',
  sets: 'sets',
  repsMin: 'reps_min',
  repsMax: 'reps_max',
  restSec: 'rest_sec',
  workingWeight: 'working_weight',
};

/**
 * Упражнение тренировочного дня с параметрами нагрузки (композиция с ProgramDay).
 */
export class ProgramExercise {
  constructor(row) {
    this.id = row.id;
    this.programDayId = row.program_day_id;
    this.exerciseId = row.exercise_id;
    this.orderNo = row.order_no;
    this.sets = row.sets;
    this.repsMin = row.reps_min;
    this.repsMax = row.reps_max;
    this.restSec = row.rest_sec;
    this.workingWeight = row.working_weight;
  }

  /**
   * Изменение параметров упражнения программы.
   * @param {{exerciseId?: number, orderNo?: number, sets?: number, repsMin?: number,
   *          repsMax?: number, restSec?: number, workingWeight?: number}} data
   */
  async update(data) {
    const params = [];
    const set = buildSet(FIELDS, data, params);
    if (!set) return;
    params.push(this.id);
    const { rows } = await query(
      `UPDATE program_exercises SET ${set} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    Object.assign(this, new ProgramExercise(rows[0]));
  }

  /**
   * Сохранение нового рабочего веса.
   * @param {number} weight
   */
  async updateWeight(weight) {
    await query('UPDATE program_exercises SET working_weight = $1 WHERE id = $2', [weight, this.id]);
    this.workingWeight = weight;
  }

  /**
   * @param {number} dayId
   * @returns {Promise<ProgramExercise[]>}
   */
  static async findByDay(dayId) {
    const { rows } = await query(
      'SELECT * FROM program_exercises WHERE program_day_id = $1 ORDER BY order_no',
      [dayId],
    );
    return rows.map((r) => new ProgramExercise(r));
  }
}
