/**
 * Настройка представлений (View): шаблонизатор EJS и общий макет страниц.
 * Каждая страница из src/views рендерится в переменную body и вставляется
 * в макет src/views/layouts/main.ejs (шапка, меню, футер, подключение скриптов).
 */
import path from 'node:path';
import ejs from 'ejs';
import { config } from './config.js';
import { Role } from '../models/enums.js';
import { EQUIPMENT, goalNames, levelNames, difficultyNames } from './dictionaries.js';

const layoutPath = path.join(config.paths.views, 'layouts', 'main.ejs');

/** Названия ролей для интерфейса. */
const roleNames = Object.freeze({
  [Role.USER]: 'Пользователь',
  [Role.ADMIN]: 'Администратор',
});

/** Дата в формате ДД.ММ.ГГГГ. */
function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '';
}

/** Число в русской записи: десятичная запятая, без лишних нулей (32.5 → «32,5»). */
function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '';
}

/**
 * Обработчик файлов .ejs для Express: страница, затем макет.
 * Передайте layout: false в res.render, чтобы получить страницу без макета.
 */
function renderWithLayout(filePath, options, callback) {
  ejs.renderFile(filePath, options, (err, body) => {
    if (err) return callback(err);
    if (options.layout === false) return callback(null, body);
    ejs.renderFile(layoutPath, { ...options, body }, callback);
  });
}

/** @param {import('express').Express} app */
export function setupViews(app) {
  app.engine('ejs', renderWithLayout);
  app.set('view engine', 'ejs');
  app.set('views', config.paths.views);
  app.locals.roleNames = roleNames;
  app.locals.formatDate = formatDate;
  app.locals.formatNumber = formatNumber;
  app.locals.equipmentList = EQUIPMENT;
  app.locals.goalNames = goalNames;
  app.locals.levelNames = levelNames;
  app.locals.difficultyNames = difficultyNames;
}

/**
 * Данные сессии для макета: меню зависит от роли текущего пользователя.
 * Подключается до маршрутизатора.
 */
export function viewLocals(req, res, next) {
  res.locals.currentUser = req.session?.user ?? null;
  res.locals.currentPath = req.path;
  next();
}
