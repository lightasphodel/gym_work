import { notImplemented } from './notImplemented.js';

/**
 * Статистика силового прогресса, баланс нагрузки и регулярность (ФТ-07, ФТ-08, ФТ-10, ФТ-11).
 */
export class ProgressAnalytics {
  /** Ряды рабочего веса, расчётного 1ПМ и тоннажа по упражнению за период. */
  async getProgress(userId, exerciseId, from, to) {
    notImplemented('ProgressAnalytics.getProgress');
  }

  /** Тоннаж за период (тренировка, неделя, месяц). */
  async getTonnage(userId, period) {
    notImplemented('ProgressAnalytics.getTonnage');
  }

  /** Анализ баланса нагрузки по группам мышц за неделю. */
  async analyzeBalance(userId, week) {
    notImplemented('ProgressAnalytics.analyzeBalance');
  }

  /** Календарь, серия тренировок без пропусков, процент выполнения программы. */
  async getRegularity(userId) {
    notImplemented('ProgressAnalytics.getRegularity');
  }
}
