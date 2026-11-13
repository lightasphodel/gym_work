import bcrypt from 'bcrypt';
import { query } from '../config/db.js';
import { config } from '../config/config.js';
import { Role } from './enums.js';

/**
 * Учётная запись пользователя или администратора.
 *
 * Два вида блокировки:
 *  - isBlocked   — блокировка администратором (ФТ-18), снимается только администратором;
 *  - lockedUntil — временная блокировка входа после MAX_FAILED_LOGINS неудачных попыток
 *                  на LOCK_MINUTES минут (ФТ-02).
 */
export class User {
  /** Число неудачных попыток входа подряд, после которого вход временно блокируется. */
  static #MAX_FAILED_LOGINS = 5;

  /** Длительность временной блокировки входа, мин. */
  static #LOCK_MINUTES = 15;

  constructor(row) {
    this.id = row.id;
    this.login = row.login;
    this.email = row.email;
    this.passwordHash = row.password_hash;
    this.role = row.role;
    this.isBlocked = row.is_blocked;
    this.failedLogins = row.failed_logins;
    this.lockedUntil = row.locked_until;
    this.createdAt = row.created_at;
  }

  /**
   * Проверка пароля по хешу bcrypt.
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async checkPassword(password) {
    return bcrypt.compare(password, this.passwordHash);
  }

  /** Действует ли временная блокировка входа. */
  isLocked() {
    return this.lockedUntil instanceof Date && this.lockedUntil.getTime() > Date.now();
  }

  /**
   * Учёт неудачной попытки входа. При достижении MAX_FAILED_LOGINS вход блокируется
   * на LOCK_MINUTES минут, а счётчик обнуляется.
   */
  async registerFailedLogin() {
    const { rows } = await query(
      `UPDATE users
          SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
              locked_until  = CASE WHEN failed_logins + 1 >= $2
                                   THEN LOCALTIMESTAMP + make_interval(mins => $3)
                                   ELSE locked_until END
        WHERE id = $1
        RETURNING failed_logins, locked_until`,
      [this.id, User.#MAX_FAILED_LOGINS, User.#LOCK_MINUTES],
    );
    this.failedLogins = rows[0].failed_logins;
    this.lockedUntil = rows[0].locked_until;
  }

  /** Сброс счётчика неудачных попыток и временной блокировки (после успешного входа). */
  async resetFailedLogins() {
    if (this.failedLogins === 0 && this.lockedUntil === null) return;
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [this.id]);
    this.failedLogins = 0;
    this.lockedUntil = null;
  }

  /** Блокировка учётной записи администратором. */
  async block() {
    await query('UPDATE users SET is_blocked = TRUE WHERE id = $1', [this.id]);
    this.isBlocked = true;
  }

  /** Разблокировка учётной записи; сбрасывает и временную блокировку входа. */
  async unblock() {
    await query(
      'UPDATE users SET is_blocked = FALSE, failed_logins = 0, locked_until = NULL WHERE id = $1',
      [this.id],
    );
    this.isBlocked = false;
    this.failedLogins = 0;
    this.lockedUntil = null;
  }

  /** Хеш пароля и счётчик попыток наружу не передаются. */
  toJSON() {
    return {
      id: this.id,
      login: this.login,
      email: this.email,
      role: this.role,
      isBlocked: this.isBlocked,
      isLocked: this.isLocked(),
      createdAt: this.createdAt,
    };
  }

  /**
   * @param {number} id
   * @returns {Promise<User|null>}
   */
  static async findById(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    return rows.length ? new User(rows[0]) : null;
  }

  /**
   * @param {string} login
   * @returns {Promise<User|null>}
   */
  static async findByLogin(login) {
    const { rows } = await query('SELECT * FROM users WHERE login = $1', [login]);
    return rows.length ? new User(rows[0]) : null;
  }

  /** @returns {Promise<User[]>} */
  static async findAll() {
    const { rows } = await query('SELECT * FROM users ORDER BY id');
    return rows.map((r) => new User(r));
  }

  /**
   * Создание учётной записи. Пароль сохраняется только в виде хеша bcrypt.
   * @param {{login: string, email: string, password: string, role?: string}} data
   * @returns {Promise<User>}
   */
  static async create(data) {
    const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);
    const { rows } = await query(
      `INSERT INTO users (login, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.login, data.email, passwordHash, data.role ?? Role.USER],
    );
    return new User(rows[0]);
  }
}
