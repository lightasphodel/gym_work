/** Ошибка с HTTP-статусом и сообщением для пользователя. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

/** Неизвестный маршрут. */
export function notFound(req, res) {
  if (isApiRequest(req)) {
    return res.status(404).json({ error: 'Ресурс не найден' });
  }
  res.status(404).render('404', { title: 'Страница не найдена', pageClass: 'page--glow' });
}

/** Централизованная обработка ошибок. Внутренние подробности клиенту не передаются. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status ?? err.statusCode ?? 500;
  let message = err.message;

  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Некорректный формат данных запроса';
  }
  if (status >= 500) {
    console.error(`[Ошибка] ${req.method} ${req.originalUrl}:`, err);
    if (status === 500) message = 'Внутренняя ошибка сервера';
  }

  if (res.headersSent) return next(err);
  if (isApiRequest(req)) {
    return res.status(status).json({ error: message });
  }
  if (status === 404) {
    return notFound(req, res);
  }
  // Страница ошибки в общем оформлении; если отрисовка не удалась — простой текст.
  res.status(status).render('error', { title: 'Ошибка', status, message, pageClass: 'page--glow' }, (renderErr, html) => {
    if (renderErr) return res.type('text/plain; charset=utf-8').send(message);
    res.send(html);
  });
}
