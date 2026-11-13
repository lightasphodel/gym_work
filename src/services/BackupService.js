import { config } from '../config/config.js';
import { notImplemented } from './notImplemented.js';

/**
 * Резервное копирование и восстановление БД утилитами pg_dump / pg_restore (ФТ-15).
 */
export class BackupService {
  #backupDir = config.backup.dir;
  #schedule = '';

  /**
   * @param {number} adminId
   * @returns {Promise<import('../models/BackupLog.js').BackupLog>}
   */
  async createBackup(adminId) {
    notImplemented('BackupService.createBackup');
  }

  /** @param {string} fileName */
  async restore(fileName) {
    notImplemented('BackupService.restore');
  }

  /** @returns {Promise<import('../models/BackupLog.js').BackupLog[]>} */
  async listBackups() {
    notImplemented('BackupService.listBackups');
  }
}
