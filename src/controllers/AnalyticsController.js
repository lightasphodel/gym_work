import { StrengthMetrics } from '../services/index.js';
import { parseOneRm } from '../middleware/validate.js';

const metrics = new StrengthMetrics();

/**
 * Силовые показатели и статистика: калькулятор 1ПМ (ФТ-06).
 * Графики прогресса, баланс и регулярность — этап 10.
 */
export class AnalyticsController {
  /** GET /tools/1rm?weight=&reps= — калькулятор 1ПМ (работает и без JavaScript). */
  static oneRmPage(req, res) {
    const submitted = req.query.weight !== undefined || req.query.reps !== undefined;
    const { data, errors } = parseOneRm(req.query);
    const ok = submitted && Object.keys(errors).length === 0;
    if (submitted && !ok) res.status(400);
    res.render('one-rm', {
      title: 'Калькулятор 1ПМ',
      form: {
        weight: typeof req.query.weight === 'string' ? req.query.weight : '',
        reps: typeof req.query.reps === 'string' ? req.query.reps : '',
      },
      errors: submitted ? errors : {},
      result: ok ? { epley: metrics.epley(data.weight, data.reps), brzycki: metrics.brzycki(data.weight, data.reps) } : null,
      scripts: ['/js/oneRm.js'],
    });
  }

  /** GET /api/1rm?weight=&reps= — оценки 1ПМ по формулам Эпли (1.1) и Бжицки (1.2), JSON. */
  static oneRm(req, res) {
    const { data, errors } = parseOneRm(req.query);
    const messages = Object.values(errors);
    if (messages.length > 0) {
      return res.status(400).json({ error: messages[0], errors: messages });
    }
    res.json({
      weight: data.weight,
      reps: data.reps,
      epley: metrics.epley(data.weight, data.reps),
      brzycki: metrics.brzycki(data.weight, data.reps),
    });
  }
}
