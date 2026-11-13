import { query } from '../config/db.js';

/**
 * Медиафайл упражнения (изображение или видео), хранится в БД в поле BYTEA.
 */
export class ExerciseMedia {
  constructor(row) {
    this.id = row.id;
    this.exerciseId = row.exercise_id;
    this.mediaType = row.media_type;
    this.mimeType = row.mime_type;
    this.data = row.data; // Buffer
  }

  /** Удаление медиафайла. */
  async remove() {
    await query('DELETE FROM exercise_media WHERE id = $1', [this.id]);
  }

  /** Двоичные данные в JSON не включаются. */
  toJSON() {
    return {
      id: this.id,
      exerciseId: this.exerciseId,
      mediaType: this.mediaType,
      mimeType: this.mimeType,
    };
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
