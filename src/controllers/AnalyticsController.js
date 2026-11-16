import { StrengthMetrics, ProgressAnalytics } from '../services/index.js';
import { Program, Exercise, PersonalRecord, RecordType } from '../models/index.js';
import { parseOneRm, parseDate, parseProgressQuery } from '../middleware/validate.js';
import { loadProgramView } from './programView.js';

const metrics = new StrengthMetrics();
const analytics = new ProgressAnalytics();

const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Ответ 400 со списком ошибок. */
function badRequest(res, errors) {
  return res.status(400).json({ error: errors[0], errors });
}

/**
 * Силовые показатели и статистика: калькулятор 1ПМ (ФТ-06), тоннаж (ФТ-07),
 * прогресс (ФТ-08), баланс нагрузки (ФТ-10), регулярность (ФТ-11).
 */
export class AnalyticsController {
  /**
   * GET /stats — страница статистики: показатели, графики (данные — /api/stats/*, Chart.js),
   * календарь регулярности и таблица личных рекордов (рендерится сервером).
   */
  static async statsPage(req, res) {
    const today = localToday();
    const active = await Program.findActive(req.user.id);
    // Упражнения для выбора: из активной программы, иначе — весь справочник.
    let exercises = [];
    if (active) {
      const seen = new Set();
      for (const day of (await loadProgramView(active)).days) {
        for (const ex of day.exercises) {
          if (!seen.has(ex.exerciseId)) {
            seen.add(ex.exerciseId);
            exercises.push({ id: ex.exerciseId, name: ex.name });
          }
        }
      }
    }
    if (exercises.length === 0) {
      exercises = (await Exercise.search({})).map((e) => ({ id: e.id, name: e.name }));
    }

    const records = [];
    for (const ex of exercises) {
      const best = await PersonalRecord.findBest(req.user.id, ex.id);
      if (best.length === 0) continue;
      const value = (type) => best.find((r) => r.type === type)?.value ?? null;
      records.push({
        name: ex.name,
        maxWeight: value(RecordType.MAX_WEIGHT),
        maxReps: value(RecordType.MAX_REPS),
        max1rm: value(RecordType.MAX_1RM),
        maxTonnage: value(RecordType.MAX_TONNAGE),
        achievedAt: best.map((r) => r.achievedAt).sort().at(-1),
      });
    }

    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
    res.render('stats', {
      title: 'Статистика',
      exercises,
      records,
      from,
      to: today,
      week: today,
      scripts: ['/vendor/chart.umd.min.js', '/js/stats.js'],
    });
  }

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
    if (messages.length > 0) return badRequest(res, messages);
    res.json({
      weight: data.weight,
      reps: data.reps,
      epley: metrics.epley(data.weight, data.reps),
      brzycki: metrics.brzycki(data.weight, data.reps),
    });
  }

  /** GET /api/stats/progress?exerciseId=&from=&to= — ряды рабочего веса, 1ПМ и тоннажа (Series). */
  static async progress(req, res) {
    const { data, errors } = parseProgressQuery(req.query, localToday());
    if (errors.length > 0) return badRequest(res, errors);
    res.json(await analytics.getProgress(req.user.id, data.exerciseId, data.from, data.to));
  }

  /** GET /api/stats/tonnage?period=workout|week|month — тоннаж за период. */
  static async tonnage(req, res) {
    const period = typeof req.query.period === 'string' ? req.query.period : 'week';
    if (!['workout', 'week', 'month'].includes(period)) {
      return badRequest(res, ['Период — workout, week или month']);
    }
    res.json({ period, tonnage: await analytics.getTonnage(req.user.id, period) });
  }

  /** GET /api/stats/balance?week=YYYY-MM-DD — баланс нагрузки за неделю (BalanceReport). */
  static async balance(req, res) {
    let week;
    if (req.query.week !== undefined && req.query.week !== '') {
      week = parseDate(req.query.week);
      if (!week) return badRequest(res, ['Дата недели — в формате ГГГГ-ММ-ДД']);
    }
    res.json(await analytics.analyzeBalance(req.user.id, week));
  }

  /** GET /api/stats/regularity — календарь, серия и процент выполнения программы (Regularity). */
  static async regularity(req, res) {
    res.json(await analytics.getRegularity(req.user.id));
  }
}
