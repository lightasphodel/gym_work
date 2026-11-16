import { Router } from 'express';
import { ProgramController } from '../controllers/ProgramController.js';
import { requireAuth } from '../middleware/auth.js';

/** REST API (JSON) для динамических операций страниц. */
export const apiRoutes = Router();

// Равноценные замены упражнения с инвентарём пользователя (ФТ-12)
apiRoutes.get('/exercises/:id/replacements', requireAuth, ProgramController.replacements);
