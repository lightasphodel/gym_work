import { Router } from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { ProfileController } from '../controllers/ProfileController.js';
import { ExerciseController } from '../controllers/ExerciseController.js';
import { AdminController } from '../controllers/AdminController.js';
import { requireAuth, requireGuest, requireRole } from '../middleware/auth.js';
import { Role } from '../models/index.js';

/** Страницы (EJS). Доступ проверяется промежуточным ПО до рендеринга. */
export const pageRoutes = Router();

pageRoutes.get('/', AuthController.root);
pageRoutes.get('/login', requireGuest, AuthController.loginPage);
pageRoutes.get('/register', requireGuest, AuthController.registerPage);

// Пользователь: главная и тренировочный профиль (ФТ-03)
pageRoutes.get('/home', requireRole(Role.USER), ProfileController.home);
pageRoutes.get('/profile', requireRole(Role.USER), ProfileController.profilePage);
pageRoutes.post('/profile', requireRole(Role.USER), ProfileController.save);

// Справочник упражнений — чтение (обе роли)
pageRoutes.get('/exercises', requireAuth, ExerciseController.list);
pageRoutes.get('/exercises/:id', requireAuth, ExerciseController.show);
pageRoutes.get('/media/:id', requireAuth, ExerciseController.media);

// Администратор: панель и пользователи (ФТ-18)
pageRoutes.get('/admin', requireRole(Role.ADMIN), AdminController.index);
pageRoutes.get('/admin/users', requireRole(Role.ADMIN), AdminController.users);
pageRoutes.post('/admin/users/:id/block', requireRole(Role.ADMIN), AdminController.block);
pageRoutes.post('/admin/users/:id/unblock', requireRole(Role.ADMIN), AdminController.unblock);
