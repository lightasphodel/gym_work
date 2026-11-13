import { query } from '../config/db.js';

/**
 * Группа мышц. antagonistId — ссылка на мышцу-антагониста (используется при анализе баланса).
 */
export class MuscleGroup {
  #id;
  #name;
  #antagonistId;

  /** @param {object} row строка таблицы muscle_groups */
  constructor(row) {
    this.#id = row.id;
    this.#name = row.name;
    this.#antagonistId = row.antagonist_id;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get antagonistId() { return this.#antagonistId; }

  /** @returns {Promise<MuscleGroup[]>} */
  static async findAll() {
    const { rows } = await query('SELECT * FROM muscle_groups ORDER BY name');
    return rows.map((r) => new MuscleGroup(r));
  }
}
