import { query } from '../config/db.js';

/**
 * Тренировочный день программы (композиция с Program).
 */
export class ProgramDay {
  constructor(row) {
    this.id = row.id;
    this.programId = row.program_id;
    this.dayNumber = row.day_number;
    this.title = row.title;
  }

  /**
   * @param {number} programId
   * @returns {Promise<ProgramDay[]>}
   */
  static async findByProgram(programId) {
    const { rows } = await query(
      'SELECT * FROM program_days WHERE program_id = $1 ORDER BY day_number',
      [programId],
    );
    return rows.map((r) => new ProgramDay(r));
  }
}
