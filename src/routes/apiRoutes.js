import { Router } from 'express';
import { ProgramController } from '../controllers/ProgramController.js';
import { WorkoutController } from '../controllers/WorkoutController.js';
import { AnalyticsController } from '../controllers/AnalyticsController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Role } from '../models/index.js';

/** REST API (JSON) для динамических операций страниц. */
export const apiRoutes = Router();

// Равноценные замены упражнения с инвентарём пользователя (ФТ-12)
apiRoutes.get('/exercises/:id/replacements', requireAuth, ProgramController.replacements);

// Сохранение тренировки: рекорды и адаптация весов (ФТ-17, ФТ-09, ФТ-05; рисунок 1.9)
apiRoutes.post('/workouts', requireRole(Role.USER), WorkoutController.save);

// Калькулятор 1ПМ (ФТ-06)
apiRoutes.get('/1rm', requireAuth, AnalyticsController.oneRm);

// Статистика (ФТ-07, ФТ-08, ФТ-10, ФТ-11)
apiRoutes.get('/stats/progress', requireRole(Role.USER), AnalyticsController.progress);
apiRoutes.get('/stats/tonnage', requireRole(Role.USER), AnalyticsController.tonnage);
apiRoutes.get('/stats/balance', requireRole(Role.USER), AnalyticsController.balance);
apiRoutes.get('/stats/regularity', requireRole(Role.USER), AnalyticsController.regularity);
