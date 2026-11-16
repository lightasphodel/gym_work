# Аудит репозитория (этап 0)

Дата: 13.11.2026. Сверка: код ↔ диаграмма классов (рис. 1.8, файл `docs/Диаграмма_ классов.png`) ↔ физическая модель БД (рис. 1.7, `docs/db-model.png`) ↔ CLAUDE.md.
Обозначения: ✅ совпадает · ⚠️ отличается · ❌ отсутствует · ➕ лишнее.

## 0. Входные данные и расхождения самих документов

| # | Наблюдение |
|---|---|
| 0.1 | Диаграмма классов лежит как `docs/Диаграмма_ классов.png`, а CLAUDE.md ссылается на `docs/class-diagram.png`. Файла `docs/note.md` нет. |
| 0.2 | **Диаграмма на картинке новее таблиц CLAUDE.md.** На ней есть члены, которых нет ни в таблице моделей, ни в «Разрешённых дополнениях»: `User`: `– MAX_FAILED_LOGINS = 5 {readOnly}` (static), `– LOCK_MINUTES = 15 {readOnly}` (static), `isLocked()`, `registerFailedLogin()`, `resetFailedLogins()`; `TrainingProfile.update(data)`, `static create(data)`; `Program.update(data)`; `ProgramExercise.update(data)`; `Workout.remove()`, `static findById(id)`; `WorkoutSet.update(weight, reps)`, `remove()`, `static findByWorkout(workoutId)`; `ExerciseMedia.remove()`. |
| 0.3 | Часть «Разрешённых дополнений» уже нарисована на диаграмме (их можно убрать из списка): `User.findById/findAll/lockedUntil`, `Program.findById/findTemplates`, `Exercise.create/update/findById`, `ExerciseMedia.create`. |
| 0.4 | Часть «Разрешённых дополнений» противоречит диаграмме: `User.registerLoginAttempt(success)` (на диаграмме — `registerFailedLogin()` + `resetFailedLogins()`), `TrainingProfile.save(data)` (на диаграмме — `create` + `update`; PLAN этап 5 тоже ссылается на `save`). Не нарисованы и в коде не нужны: `ProgramDay.create`, `ProgramExercise.create` (дни и упражнения создаёт `Program.create` в одной транзакции), `ProgramExercise.replaceExercise` (покрывается `update({exerciseId})`). Остаётся реально нужным только `ExerciseMedia.findById(id)` (маршрут `/media/:id`). |
| 0.5 | «14 классов models»: на диаграмме и в таблице CLAUDE.md — **13** классов + 6 перечислений (14 — число таблиц БД, вместе с `exercise_muscles`). |
| 0.6 | На диаграмме все атрибуты моделей помечены `–` (private); в CLAUDE.md правило «`–` → `#`» сформулировано только для сервисов. |

Дальше код сверяется с **картинкой** (главный источник по CLAUDE.md).

## 1. Классы models и services против диаграммы

### Общие отличия (для всех классов)
| Пункт | Диаграмма / CLAUDE.md | Код |
|---|---|---|
| Экспорт | `export default class` | ⚠️ именованный `export class X` + бочки `src/models/index.js`, `src/services/index.js` |
| Видимость атрибутов моделей | `–` (private) | ⚠️ публичные поля `this.id = …` |
| Тип результата методов с БД | `T` | ⚠️ `Promise<T>` (async) — неизбежно для `pg`, считать допустимым |
| snake_case → camelCase | функция `src/db/mapRow.js` | ⚠️ файла нет, отображение вручную в `constructor(row)` каждого класса |
| Не найдено | `User`, `Program`… | возвращается `null` — допустимо |

### Перечисления — `src/models/enums.js`
✅ Все 6 (`Role, Goal, Level, ProgramStatus, RecordType, Decision`) — `Object.freeze`, значения совпадают с диаграммой и ENUM БД.

### Пакет models (13 из 13 файлов есть)

| Класс | Атрибуты | Методы |
|---|---|---|
| **User** | ✅ все 9 (вкл. `lockedUntil`), видимость ⚠️ public. ✅ `static #MAX_FAILED_LOGINS = 5`, `static #LOCK_MINUTES = 15`; ⚠️ `{readOnly}` не обеспечен (приватное поле можно переприсвоить внутри класса) | ✅ `checkPassword(password)` (async), `isLocked()`, `registerFailedLogin()`, `resetFailedLogins()`, `block()`, `unblock()`, static `findById`, `findByLogin`, `findAll`, `create(data)`. ➕ `toJSON()` |
| **TrainingProfile** | ✅ все 7, ⚠️ public | ✅ `isComplete()`, `update(data)`, static `create(data)`, `findByUser(userId)`. Замечание: `isComplete()` не проверяет `bodyWeight`, а он нужен для `calcStartWeight` |
| **Program** | ✅ все 8, ⚠️ public | ✅ `copyFor(userId)`, `update(data)`, `activate()`, `archive()`, static `create(data)`, `findActive(userId)`. ❌ **static `findById(id)`**, ❌ **static `findTemplates()`** |
| **ProgramDay** | ✅ все 4, ⚠️ public | ✅ static `findByProgram(programId)` |
| **ProgramExercise** | ✅ все 9, ⚠️ public | ✅ `update(data)`, `updateWeight(weight)`, static `findByDay(dayId)` |
| **Exercise** | ✅ все 8, ⚠️ public | ✅ `update(data)`, `deactivate()`, static `create(data)`, `findById(id)`, `search(filter)`. Замечание к этапу 8: `search` фильтрует `difficulty =`, а генератору нужно `≤ maxDifficulty` |
| **ExerciseMedia** | ✅ все 5, ⚠️ public | ✅ `remove()`, static `create(data)`, `findByExercise(exId)`. ➕ `toJSON()`. ❌ `static findById(id)` (разрешённое дополнение, нужно для `/media/:id`) |
| **MuscleGroup** | ✅ все 3, ⚠️ public | ✅ static `findAll()` |
| **Workout** | ✅ все 6, ⚠️ public | ⚠️ **`calcTonnage(client)`**: лишний параметр, async, считает тоннаж SQL-запросом `SUM(weight*reps)`, а не Σ `WorkoutSet.volume()` (нарушение правила CLAUDE.md). ✅ `remove()`, static `findById(id)`, `create(userId, dayId, sets)` (транзакция ✅, tonnage ✅, `isCompleted` ✅), `findByPeriod(userId, from, to)` |
| **WorkoutSet** | ✅ все 6, ⚠️ public | ✅ `volume()`, `update(weight, reps)`, `remove()`, static `findHistory(peId, limit)`. ❌ **static `findByWorkout(workoutId)`** |
| **WeightHistory** | ✅ все 6, ⚠️ public | ✅ static `create(data)` |
| **PersonalRecord** | ✅ все 6, ⚠️ public | ✅ static `findBest(userId, exId): PersonalRecord[]`, `create(data)` |
| **BackupLog** | ✅ все 6, ⚠️ public | ✅ static `create(data)`, `findAll()` |

### Пакет services (7 из 7 файлов есть, реализован только StrengthMetrics)

| Класс | Атрибуты | Методы | Состояние |
|---|---|---|---|
| **ProgramGenerator** | ✅ `#loadTable`; ⚠️ значения не совпадают со спецификацией PLAN (табл. 1.1): STRENGTH `reps [1,6]` вместо 3–6, ENDURANCE `[10,25]` вместо 12–20, отдых диапазонами вместо 90/90/180/60 с; нет подходов по уровню (2–3 / 3–4 / 4–5) | ✅ `generate(profile)`, `#selectSplit(level, days)`, `#pickExercises(split, equipment)`, `#calcStartWeight(exercise, profile)` | заглушки 501; ⚠️ нет зависимости → ExerciseSelector; ❌ typedef `Split` |
| **ExerciseSelector** | — | ✅ `filter(muscleId, equipment, difficulty)`, `suggestReplacement(exerciseId, equipment)` | заглушки |
| **ProgressAnalytics** | — | ✅ `getProgress`, `getTonnage`, `analyzeBalance`, `getRegularity` (сигнатуры совпадают) | заглушки; ❌ typedef `Series/BalanceReport/Regularity`; ⚠️ JSDoc без `@param/@returns`; нет зависимости → StrengthMetrics |
| **WeightAdaptationService** | ✅ `#maxIncreasePct = 0.10`, `#failLimit = 2` | ✅ `adapt(workout)`, `#evaluateSets`, `#decide`, `#calcStep`, `#roundToEquipment` | заглушки; ❌ typedef `Result`; нет зависимости → StrengthMetrics |
| **StrengthMetrics** | — | ✅ `epley`, `brzycki`, `tonnage` (экземплярные, как на диаграмме) | ✅ реализован; ⚠️ нет округления до 0,1 (PLAN, этап 9) |
| **RecordDetector** | — | ✅ `detect(workout)`, `#isBetter(current, best)` | заглушки; нет зависимости → StrengthMetrics |
| **BackupService** | ✅ `#backupDir`, `#schedule` (пустая строка) | ✅ `createBackup(adminId)`, `restore(fileName)`, `listBackups()` | заглушки |

## 2. Лишние классы и публичные методы

| Что | Где | Рекомендация |
|---|---|---|
| ➕ `User.toJSON()` | src/models/User.js | Технический (скрывает `passwordHash`). Внести в «Разрешённые дополнения» как служебный; если атрибуты станут `#`, `toJSON()` понадобится всем моделям |
| ➕ `ExerciseMedia.toJSON()` | src/models/ExerciseMedia.js | То же (не отдаёт `data`) |
| ⚠️ параметр `client` у `Workout.calcTonnage` | src/models/Workout.js | Убрать, привести к `calcTonnage(): number` |
| ➕ класс `HttpError` | src/middleware/errorHandler.js | Инфраструктура, не модель/сервис — оставить, упомянуть в записке |
| ➕ класс `PageController` | src/controllers/PageController.js | Нет в списке контроллеров CLAUDE.md; при переходе на EJS разнести по Auth/Profile/…/AdminController |
| ➕ `services/notImplemented.js`, `models/index.js`, `services/index.js` | — | Служебные; бочки убрать при переходе на `export default` (или оставить с реэкспортом default) |
| ➕ `config/config.js`, `middleware/securityHeaders.js`, `middleware/errorHandler.js` | — | Нет в структуре CLAUDE.md; securityHeaders заменить на `helmet` (этап 12) |

Методов, которых нет ни на диаграмме, ни в «Разрешённых дополнениях», кроме двух `toJSON()`, — нет.

## 3. db/schema.sql против физической модели (рис. 1.7)

| Проверка | Результат |
|---|---|
| Таблицы | ✅ все 14 (`users, training_profiles, backup_logs, muscle_groups, exercises, exercise_media, exercise_muscles, programs, program_days, program_exercises, workouts, workout_sets, weight_history, personal_records`) |
| Столбцы и типы | ✅ совпадают поштучно (VARCHAR(50/100/255/10/20), SMALLINT, NUMERIC(5,2)/(4,2)/(6,2)/(10,2), TEXT[], TEXT, BYTEA, DATE, TIMESTAMP, BOOLEAN) |
| ➕ `users.locked_until TIMESTAMP` | ⚠️ есть в SQL и на диаграмме классов, **нет на рис. 1.7** — дорисовать |
| ENUM | ✅ `user_role, goal, level, program_status, decision, record_type` — имена и значения совпадают |
| FK | ✅ все 15 связей; `programs.owner_id` и `muscle_groups.antagonist_id` допускают NULL (ромб на модели) |
| AK | ✅ `users.login` (AK1), `users.email` (AK2), `training_profiles.user_id`, `program_days(program_id, day_number)`, `exercises.name`, `muscle_groups.name` (AK1), `muscle_groups.antagonist_id` (AK2) |
| Зависимая сущность | ✅ `exercise_muscles` с составным PK |
| ➕ сверх модели | CHECK-ограничения, `programs_owner_template_chk`, частичный уникальный индекс `programs_one_active_idx`, индексы по FK, DEFAULT, правила `ON DELETE` — не противоречат модели, описать в разделе 1.4 записки |
| Мелочь | `workout_sets_reps_chk` допускает `reps >= 0`, а UI по PLAN — целое 1–50 |
| ❌ `db/seed.sql` | отсутствует (группы мышц с антагонистами, 25–30 упражнений, admin, шаблон) |
| ❌ таблица `session` | для connect-pg-simple (этап 12) |

## 4. Стек

| Требование | Есть? | Комментарий |
|---|---|---|
| ESM | ✅ | `"type": "module"`, везде `import/export` |
| EJS | ❌ | статические `src/views/*.html` через `res.sendFile`; нет пакета `ejs`, view engine, `layouts/`, `partials/` |
| express-session | ✅ | хранилище в памяти; cookie `sameSite: 'lax'` (этап 12 требует `strict` + connect-pg-simple) |
| bcrypt | ✅ | `^6.0.0`, cost из `.env` = 12 (этап 12 указывает 10) |
| multer | ❌ | нет пакета и `src/middleware/upload.js` |
| Единый `public/css/styles.css` | ✅ | других CSS нет, `style=`/`<style>`/`@import` нет, в JS `.style.` нет |
| `npm test`, `tests/` | ❌ | нет скрипта и каталога |
| helmet, dotenv, connect-pg-simple, node-cron, Chart.js (`public/vendor`) | ❌ | dotenv заменён `process.loadEnvFile` (допустимо); остальное — этапы 11–12 |
| Структура | ⚠️ | `src/app.js` вместо `app.js` в корне; порт 3000/HTTP по умолчанию вместо 443/3443; нет `src/db/mapRow.js`; `node_modules` и `package-lock.json` отсутствуют |

## 5. Этапы 1–7 PLAN.md

| Этап | Статус | Что сделано / чего нет |
|---|---|---|
| 1. Каркас | 🟡 частично | ✅ ESM, Express 5, `.env.example`, `npm run dev/start`, MVC-каталоги. ❌ EJS, ❌ `npm test` + `tests/`, ❌ `mapRow.js`, `upload.js`, ⚠️ `app.js` не в корне |
| 2. БД | 🟡 частично | ✅ `schema.sql` по рис. 1.7 (+ `locked_until`), `scripts/init-db.js`. ❌ `seed.sql` |
| 3. Модели | 🟡 почти | ✅ 13 классов + enums. ❌ `Program.findById`, `Program.findTemplates`, `WorkoutSet.findByWorkout`; ⚠️ `Workout.calcTonnage`; ⚠️ `export default`, видимость атрибутов |
| 4. Аутентификация | 🟢 выполнен (кроме EJS) | ✅ регистрация/вход/выход (REST + статические страницы), express-session, bcrypt, `requireAuth`, `requireRole`, блокировка 5 попыток / 15 мин, регенерация сессии, одинаковое сообщение об ошибке |
| 5. Профиль | 🔴 нет | модель готова; нет ProfileController, маршрутов, страницы `/profile` |
| 6. Справочник — чтение | 🔴 нет | модели готовы; нет ExerciseController, `/exercises`, `/exercises/:id` |
| 7. Админ — пользователи | 🔴 нет | `block/unblock/findAll` есть; нет AdminController, `/admin/users` (сейчас только заглушка `/admin`) |

**Вывод:** продолжать с этапов 1–3 (доделки), затем 5–7.

## Список исправлений по приоритету

**P0 — документы и диаграмма (до любого кода)**
1. Привести CLAUDE.md к картинке: обновить таблицу моделей (п. 0.2), убрать из «Разрешённых дополнений» уже нарисованное (0.3) и противоречащее (0.4), оставить `ExerciseMedia.findById` и служебный `toJSON()`; исправить «14 классов» → 13; поправить PLAN этап 5 (`save` → `create/update`).
2. Переименовать `docs/Диаграмма_ классов.png` → `docs/class-diagram.png` (или исправить ссылку), положить `docs/note.md`.
3. ✅ **Закрыт на этапе 0.2:** атрибуты всех 13 моделей — `#`-поля + get-аксессоры без сеттеров, `toJSON()` удалены, для JSON — `src/utils/toPlain.js`. Было: решить видимость атрибутов моделей (на диаграмме `–`): рекомендую `#поле` + публичный геттер и `toJSON()` — либо зафиксировать в CLAUDE.md, что атрибуты моделей публичны (отклонение, отразить в записке).

**P1 — этапы 1–3 (фундамент)**
4. ✅ **Закрыт на этапе 0.2** (+ `ExerciseMedia.findById`, `Program.create` с вложенными днями/упражнениями в одной транзакции). Было: модели: добавить `Program.findById`, `Program.findTemplates`, `WorkoutSet.findByWorkout`; переписать `Workout.calcTonnage()` без параметра через Σ `WorkoutSet.volume()`, `create()` считает тоннаж из созданных `WorkoutSet` внутри транзакции.
5. Перейти на `export default class` во всех 20 классах (обновить импорты/бочки).
6. `src/db/mapRow.js` и использовать его в моделях.
7. ✅ **Закрыт на этапе 0.3:** `src/config/views.js` (view engine ejs, обёртка-макет `layouts/main.ejs`), `partials/header|nav|footer|account`, 6 страниц в EJS, меню по роли из сессии; `PageController` удалён → `AuthController.root/loginPage/registerPage`, `ProfileController.home`, `AdminController.index`. Было: EJS: пакет `ejs`, `app.set('view engine')`, `views/layouts`, `views/partials`, перевод 6 HTML-страниц; `PageController` разнести по контроллерам из CLAUDE.md.
8. ✅ **Закрыт на этапе 0.2:** `tests/StrengthMetrics.test.js`, `tests/toPlain.test.js`, `tests/models.test.js`; скрипт — `node --test "tests/**/*.test.js"` (Node 22+ не принимает каталог). Было: `npm test` (`node --test tests/`), каталог `tests/`, первые тесты `StrengthMetrics`.
9. ✅ **Закрыт на этапе 0.3:** `db/seed.sql` + `npm run db:seed` (идемпотентный): 12 групп мышц, 4 пары антагонистов, 29 упражнений, `exercise_muscles`, admin / admin123, шаблон «Full Body для начинающих». Было: `db/seed.sql`.
10. ✅ **Закрыт на этапе 0.3:** `uploadMedia(field)` — memoryStorage, 10 МБ, jpg/png/webp/mp4 по MIME, расширению и сигнатуре файла, `file.mediaType`. Было: `multer` + `src/middleware/upload.js` (нужно к этапу 8); ~~`ExerciseMedia.findById`~~ ✅ 0.2.
11. Перенести `src/app.js` → `app.js` (или исправить структуру в CLAUDE.md).

**P2 — этапы 5–7**
12. ✅ **Закрыт на этапах 5–7:** `ProfileController.profilePage/save`, `/profile` (GET/POST, PRG), первый раз `TrainingProfile.create`, затем `update`; серверная проверка `parseProfile` (validate.js). Было: ProfileController + `/profile` (`TrainingProfile.create/update`; ~~`isComplete()` — добавить проверку `bodyWeight`~~ ✅ 0.2).
13. ✅ **Закрыт на этапах 5–7:** `ExerciseController.list/show/media`, `/exercises` (фильтр по группе мышц, инвентарю, сложности через `Exercise.search`), `/exercises/:id`, `/media/:id` (`ExerciseMedia.findById`). Было: ExerciseController (чтение) + `/exercises`, `/exercises/:id`, `MuscleGroup.findAll()`.
14. ✅ **Закрыт на этапах 5–7:** `AdminController.users/block/unblock`, `/admin/users`, POST `/admin/users/:id/block|unblock`; свою запись заблокировать нельзя (400). Было: AdminController + `/admin/users`, `block()/unblock()`.

**P3 — записать сейчас, исправлять на своих этапах**
15. ✅ **Закрыт на этапе 8:** `#loadTable` = табл. 1.1 (отдых 90/90/180/60 с) + подходы по уровню 3/4/5; `ProgramGenerator` получает `ExerciseSelector` в конструкторе; typedef `Split`; `ExerciseSelector.filter/suggestReplacement` реализованы. Было: Этап 8: `#loadTable` привести к табл. 1.1 PLAN (+ подходы по уровню); ~~`Exercise.search` — `difficulty <=`~~ ✅ 0.2; зависимость ProgramGenerator → ExerciseSelector; typedef `Split`.
16. ✅ **Закрыт на этапе 0.2** (решение — CLAUDE.md, «Тестирование приватных методов»: сценарно через публичный метод + `mock.method`). Было: этапы 8–9: PLAN требует тестов для приватных `#selectSplit`, `#calcStartWeight`, `#decide`, `#roundToEquipment` — напрямую из теста их не вызвать; нужно решение (тестировать через `generate()/adapt()` с моками или иначе).
17. ✅ **Закрыт на этапе 9:** `StrengthMetrics` округляет до 0,1; typedef `Result` в WeightAdaptationService; `WeightAdaptationService` и `RecordDetector` реализованы, зависимость → StrengthMetrics в конструкторе. Было: Этап 9: округление до 0,1 в `StrengthMetrics`; typedef `Result`; ~~CHECK `reps` согласовать с 1–50~~ ✅ 0.2 (`BETWEEN 1 AND 50`).
18. Этап 10: typedef `Series/BalanceReport/Regularity`, полный JSDoc.
19. Этап 12: helmet вместо `securityHeaders`, `sameSite: 'strict'`, connect-pg-simple + таблица `session`, bcrypt cost 10 vs 12, HTTPS 443/3443 + редирект HTTP→HTTPS, `npm run cert`.
20. Рис. 1.7: дорисовать `users.locked_until`. README: раздел «Открытые вопросы» п. 4 устарел (методы уже на диаграмме).
21. ✅ **Закрыт на этапе 0.2:** `static #MAX_FAILED_LOGINS = 5; // {readOnly}`, `static #LOCK_MINUTES = 15; // {readOnly}`. Было: мелочь: `{readOnly}` у `User.#MAX_FAILED_LOGINS/#LOCK_MINUTES` — объявить через `static get` или оставить с комментарием.
