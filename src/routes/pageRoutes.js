import { Router } from 'express';
import { PageController } from '../controllers/PageController.js';
import { requireGuest, requireRole } from '../middleware/auth.js';
import { Role } from '../models/index.js';

export const pageRoutes = Router();

pageRoutes.get('/', PageController.root);
pageRoutes.get('/login', requireGuest, PageController.login);
pageRoutes.get('/register', requireGuest, PageController.register);
pageRoutes.get('/home', requireRole(Role.USER), PageController.home);
pageRoutes.get('/admin', requireRole(Role.ADMIN), PageController.admin);
