/**
 * Заголовки безопасности HTTP-ответов.
 * @param {{https: boolean}} options
 */
export function securityHeaders({ https }) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (https) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}
