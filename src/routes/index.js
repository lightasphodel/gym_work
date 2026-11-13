import { Router } from 'express';
import { authRoutes } from './authRoutes.js';
import { pageRoutes } from './pageRoutes.js';

/** Корневой маршрутизатор: REST API и страницы. */
export const router = Router();

router.use('/api/auth', authRoutes);
router.use('/', pageRoutes);
