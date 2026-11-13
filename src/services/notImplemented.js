/** Заглушка для методов, которые реализуются на следующих этапах. */
export function notImplemented(method) {
  const err = new Error(`${method}: метод будет реализован на следующем этапе`);
  err.status = 501;
  throw err;
}
