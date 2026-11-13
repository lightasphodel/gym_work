import { Router } from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, registerRules, loginRules } from '../middleware/validate.js';

export const authRoutes = Router();

authRoutes.post('/register', validate(registerRules), AuthController.register);
authRoutes.post('/login', validate(loginRules), AuthController.login);
authRoutes.post('/logout', AuthController.logout);
authRoutes.get('/me', requireAuth, AuthController.me);
