import { query } from '../config/db.js';

/**
 * Медиафайл упражнения (изображение или видео), хранится в БД в поле BYTEA.
 * Для JSON-ответов используется toPlain(): двоичные данные (Buffer) в результат не попадают.
 */
export class ExerciseMedia {
  #id;
  #exerciseId;
  #mediaType;
  #mimeType;
  #data;

  /** @param {object} row строка таблицы exercise_media */
  constructor(row) {
    this.#id = row.id;
    this.#exerciseId = row.exercise_id;
    this.#mediaType = row.media_type;
    this.#mimeType = row.mime_type;
    this.#data = row.data; // Buffer
  }

  get id() { return this.#id; }
  get exerciseId() { return this.#exerciseId; }
  get mediaType() { return this.#mediaType; }
  get mimeType() { return this.#mimeType; }
  get data() { return this.#data; }

  /** Удаление медиафайла. */
  async remove() {
    await query('DELETE FROM exercise_media WHERE id = $1', [this.#id]);
  }

  /**
   * @param {{exerciseId: number, mediaType: string, mimeType: string, data: Buffer}} data
   * @returns {Promise<ExerciseMedia>}
   */
  static async create(data) {
    const { rows } = await query(
      `INSERT INTO exercise_media (exercise_id, media_type, mime_type, data)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.exerciseId, data.mediaType, data.mimeType, data.data],
    );
    return new ExerciseMedia(rows[0]);
  }

  /**
   * Медиафайл по идентификатору (маршрут /media/:id отдаёт его с типом mimeType).
   * @param {number} id
   * @returns {Promise<ExerciseMedia|null>}
   */
  static async findById(id) {
    const { rows } = await query('SELECT * FROM exercise_media WHERE id = $1', [id]);
    return rows.length ? new ExerciseMedia(rows[0]) : null;
  }

  /**
   * @param {number} exId
   * @returns {Promise<ExerciseMedia[]>}
   */
  static async findByExercise(exId) {
    const { rows } = await query(
      'SELECT * FROM exercise_media WHERE exercise_id = $1 ORDER BY id',
      [exId],
    );
    return rows.map((r) => new ExerciseMedia(r));
  }
}
