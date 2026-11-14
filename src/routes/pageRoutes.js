import { Router } from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { ProfileController } from '../controllers/ProfileController.js';
import { AdminController } from '../controllers/AdminController.js';
import { requireGuest, requireRole } from '../middleware/auth.js';
import { Role } from '../models/index.js';

/** Страницы (EJS). Доступ проверяется промежуточным ПО до рендеринга. */
export const pageRoutes = Router();

pageRoutes.get('/', AuthController.root);
pageRoutes.get('/login', requireGuest, AuthController.loginPage);
pageRoutes.get('/register', requireGuest, AuthController.registerPage);
pageRoutes.get('/home', requireRole(Role.USER), ProfileController.home);
pageRoutes.get('/admin', requireRole(Role.ADMIN), AdminController.index);
