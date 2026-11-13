/**
 * Клиентский модуль обращения к REST API сервера (JSON).
 */
export class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * @param {string} url
 * @param {{method?: string, body?: unknown}} [options]
 */
export async function api(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? 'Сервер не ответил на запрос. Повторите попытку позже',
      data?.errors ?? [],
    );
  }
  return data;
}
