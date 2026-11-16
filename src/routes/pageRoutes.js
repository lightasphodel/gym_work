import { Router } from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { ProfileController } from '../controllers/ProfileController.js';
import { ProgramController } from '../controllers/ProgramController.js';
import { ExerciseController } from '../controllers/ExerciseController.js';
import { AdminController } from '../controllers/AdminController.js';
import { requireAuth, requireGuest, requireRole } from '../middleware/auth.js';
import { uploadMediaForForm } from '../middleware/upload.js';
import { Role } from '../models/index.js';

/** Страницы (EJS). Доступ проверяется промежуточным ПО до рендеринга. */
export const pageRoutes = Router();

const user = requireRole(Role.USER);
const admin = requireRole(Role.ADMIN);

pageRoutes.get('/', AuthController.root);
pageRoutes.get('/login', requireGuest, AuthController.loginPage);
pageRoutes.get('/register', requireGuest, AuthController.registerPage);

// Пользователь: главная и тренировочный профиль (ФТ-03)
pageRoutes.get('/home', user, ProfileController.home);
pageRoutes.get('/profile', user, ProfileController.profilePage);
pageRoutes.post('/profile', user, ProfileController.save);

// Программы тренировок (ФТ-04, ФТ-16)
pageRoutes.get('/programs', user, ProgramController.list);
pageRoutes.post('/programs/generate', user, ProgramController.generate);
pageRoutes.get('/programs/templates', user, ProgramController.templates);
pageRoutes.post('/programs/templates/:id/copy', user, ProgramController.copyTemplate);
pageRoutes.get('/programs/:id', user, ProgramController.show);
pageRoutes.post('/programs/:id/days/:dayId', user, ProgramController.saveDay);
pageRoutes.post('/programs/:id/exercises/:peId/replace', user, ProgramController.replaceExercise);
pageRoutes.post('/programs/:id/activate', user, ProgramController.activate);
pageRoutes.post('/programs/:id/archive', user, ProgramController.archive);

// Справочник упражнений — чтение (обе роли)
pageRoutes.get('/exercises', requireAuth, ExerciseController.list);
pageRoutes.get('/exercises/:id', requireAuth, ExerciseController.show);
pageRoutes.get('/media/:id', requireAuth, ExerciseController.media);

// Администратор: панель и пользователи (ФТ-18)
pageRoutes.get('/admin', admin, AdminController.index);
pageRoutes.get('/admin/users', admin, AdminController.users);
pageRoutes.post('/admin/users/:id/block', admin, AdminController.block);
pageRoutes.post('/admin/users/:id/unblock', admin, AdminController.unblock);

// Администратор: справочник упражнений (ФТ-13)
pageRoutes.get('/admin/exercises', admin, AdminController.exercises);
pageRoutes.get('/admin/exercises/new', admin, AdminController.exerciseNew);
pageRoutes.post('/admin/exercises', admin, uploadMediaForForm('media'), AdminController.exerciseCreate);
pageRoutes.get('/admin/exercises/:id/edit', admin, AdminController.exerciseEdit);
pageRoutes.post('/admin/exercises/:id', admin, uploadMediaForForm('media'), AdminController.exerciseUpdate);
pageRoutes.post('/admin/exercises/:id/deactivate', admin, AdminController.exerciseDeactivate);
pageRoutes.post('/admin/exercises/:id/media/:mediaId/delete', admin, AdminController.mediaDelete);

// Администратор: шаблонные программы (ФТ-14)
pageRoutes.get('/admin/templates', admin, AdminController.templates);
pageRoutes.get('/admin/templates/new', admin, AdminController.templateNew);
pageRoutes.post('/admin/templates', admin, AdminController.templateCreate);
pageRoutes.get('/admin/templates/:id', admin, AdminController.templateEdit);
pageRoutes.post('/admin/templates/:id', admin, AdminController.templateUpdate);
pageRoutes.post('/admin/templates/:id/days/:dayId', admin, AdminController.templateSaveDay);
pageRoutes.post('/admin/templates/:id/publish', admin, AdminController.templatePublish);
pageRoutes.post('/admin/templates/:id/unpublish', admin, AdminController.templateUnpublish);
