/**
 * Создание учётной записи администратора по параметрам ADMIN_LOGIN, ADMIN_EMAIL, ADMIN_PASSWORD из .env.
 * Запуск: npm run admin:create
 */
import { closePool } from '../src/config/db.js';
import { User, Role } from '../src/models/index.js';
import { registerRules } from '../src/middleware/validate.js';

const data = {
  login: process.env.ADMIN_LOGIN ?? '',
  email: process.env.ADMIN_EMAIL ?? '',
  password: process.env.ADMIN_PASSWORD ?? '',
};

try {
  const errors = registerRules(data);
  if (errors.length) {
    console.error('Проверьте параметры ADMIN_* в .env:\n - ' + errors.join('\n - '));
    process.exitCode = 1;
  } else if (await User.findByLogin(data.login)) {
    console.log(`Пользователь «${data.login}» уже существует.`);
  } else {
    const admin = await User.create({ ...data, role: Role.ADMIN });
    console.log(`Администратор «${admin.login}» создан (id = ${admin.id}).`);
    console.log('Удалите ADMIN_PASSWORD из .env после создания.');
  }
} catch (err) {
  console.error('Ошибка создания администратора:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
