import { query } from '../config/db.js';

/**
 * Запись журнала резервного копирования.
 */
export class BackupLog {
  constructor(row) {
    this.id = row.id;
    this.adminId = row.admin_id;
    this.fileName = row.file_name;
    this.type = row.type;
    this.createdAt = row.created_at;
    this.status = row.status;
  }

  /**
   * @param {{adminId: number, fileName: string, type: string, status: string}} data
   * @returns {Promise<BackupLog>}
   */
  static async create(data) {
    const { rows } = await query(
      `INSERT INTO backup_logs (admin_id, file_name, type, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.adminId, data.fileName, data.type, data.status],
    );
    return new BackupLog(rows[0]);
  }

  /** @returns {Promise<BackupLog[]>} */
  static async findAll() {
    const { rows } = await query('SELECT * FROM backup_logs ORDER BY created_at DESC, id DESC');
    return rows.map((r) => new BackupLog(r));
  }
}
