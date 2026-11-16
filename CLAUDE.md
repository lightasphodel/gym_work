# CLAUDE.md — правила проекта для Claude Code

Курсовой проект: **Web-приложение формирования индивидуальных тренировочных программ с алгоритмом адаптации рабочих весов** (БГУИР, ПиРWEB, гр. 472303).

Источники истины (в `docs/`):
- `docs/class-diagram.png` — UML-диаграмма классов (рис. 1.8). **Главный источник.** Если таблицы ниже расходятся с картинкой — права картинка; сообщи о расхождении.
- `docs/db-model.png` — физическая модель БД (рис. 1.7).
- `docs/note.md` — текст пояснительной записки.
- `docs/PLAN.md` — этапы работы, `docs/AUDIT.md` — отчёт аудита.

**Главное правило: код совпадает с диаграммой классов.** Имена классов, атрибутов, методов, сигнатуры, видимость (+ / –) и статичность переносятся 1:1. Метода нет на диаграмме и в «Разрешённых дополнениях» — не добавляй, остановись и спроси.

---

## Стек и принятые отклонения

- Node.js LTS, npm, Express 5, **ES modules**. Именованный экспорт `export class X` и бочки `src/models/index.js`, `src/services/index.js` — **допустимы, не переделывать**.
- Точка входа — `src/app.js` (не переносить).
- `.env` читается через `process.loadEnvFile` (dotenv не нужен).
- MVC: Model = `src/models`, View = **EJS** `src/views`, Controller = `src/controllers`.
- PostgreSQL, `pg`, общий пул; только параметризованные запросы.
- Пакеты: `bcrypt` (cost 12), `express-session`, `multer`, `ejs`, `helmet`, `connect-pg-simple`, `node-cron`. Chart.js — локально в `public/vendor`.
- Один CSS: `public/css/styles.css`. Без инлайн-стилей.
- Интерфейс — на русском; идентификаторы — на английском.
- Тесты: `node:test`, `npm test` = `node --test tests/`.
- Инфраструктурные классы вне моделей и сервисов допустимы и на диаграмму классов не попадают: `HttpError` (middleware/errorHandler.js). Их нужно упомянуть в записке.

## Пакет models — 13 классов + 6 перечислений

Перечисления — `src/models/enums.js`, `Object.freeze`, значения = ENUM PostgreSQL: Role, Goal, Level, ProgramStatus, Decision, RecordType.

Подчёркнутые на диаграмме методы — `static`.

| Класс | Атрибуты (все «–») | Методы |
|---|---|---|
| User | id, login, email, passwordHash, role, isBlocked, failedLogins, lockedUntil, createdAt; static #MAX_FAILED_LOGINS = 5 {readOnly}; static #LOCK_MINUTES = 15 {readOnly} | checkPassword(password); isLocked(); registerFailedLogin(); resetFailedLogins(); block(); unblock(); **static** findById(id), findByLogin(login), findAll(), create(data) |
| TrainingProfile | id, userId, goal, level, workoutsPerWeek, equipment: string[], bodyWeight | isComplete(); update(data); **static** create(data), findByUser(userId) |
| Program | id, ownerId, title, goal, level, isTemplate, status, createdAt | copyFor(userId); update(data); activate(); archive(); **static** create(data), findActive(userId), findById(id), findTemplates() |
| ProgramDay | id, programId, dayNumber, title | **static** findByProgram(programId) |
| ProgramExercise | id, programDayId, exerciseId, orderNo, sets, repsMin, repsMax, restSec, workingWeight | update(data); updateWeight(weight); **static** findByDay(dayId) |
| Exercise | id, name, primaryMuscleId, equipment, difficulty, technique, weightStep, isActive | update(data); deactivate(); **static** create(data), findById(id), search(filter) |
| ExerciseMedia | id, exerciseId, mediaType, mimeType, data: Buffer | remove(); **static** create(data), findByExercise(exId) |
| MuscleGroup | id, name, antagonistId | **static** findAll() |
| Workout | id, userId, programDayId, date, tonnage, isCompleted | calcTonnage(): number; remove(); **static** findById(id), create(userId, dayId, sets), findByPeriod(userId, from, to) |
| WorkoutSet | id, workoutId, programExerciseId, setNo, weight, reps | volume(); update(weight, reps); remove(); **static** findHistory(peId, limit), findByWorkout(workoutId) |
| WeightHistory | id, programExerciseId, date, oldWeight, newWeight, decision | **static** create(data) |
| PersonalRecord | id, userId, exerciseId, type, value, achievedAt | **static** findBest(userId, exId), create(data) |
| BackupLog | id, adminId, fileName, type, createdAt, status | **static** create(data), findAll() |

### Разрешённые дополнения (нет на картинке — дорисовать на этапе 13)

| Класс | Член | Зачем |
|---|---|---|
| ExerciseMedia | static findById(id) | маршрут `/media/:id` |

Больше дополнений нет. `ProgramDay.create` и `ProgramExercise.create` **не нужны**: дни и упражнения создаёт `Program.create(data)` из вложенной структуры `data.days[].exercises[]` в одной транзакции. Замена упражнения выполняется через `ProgramExercise.update({ exerciseId })`.

### Инкапсуляция моделей

- Атрибуты — приватные поля `#`. Чтение — через get-аксессоры только для чтения; сеттеров нет. По соглашению UML аксессоры на диаграмме не показываются, в записке это объясняет одна фраза.
- **Без геттеров:** `User.passwordHash`, `User.failedLogins`, `User.lockedUntil`. Снаружи их состояние доступно только через `checkPassword()` и `isLocked()`.
- Состояние меняется только методами с диаграммы.
- `static #MAX_FAILED_LOGINS` и `static #LOCK_MINUTES` — константы. Присвоить их можно только в объявлении, рядом стоит комментарий `// {readOnly}`.
- Конструктор принимает строку БД (`snake_case`) и сам раскладывает её по `#`-полям. Отдельный mapRow не нужен.
- **`toJSON()` в моделях нет.** Для JSON-ответов используется функция `src/utils/toPlain.js`: она собирает get-аксессоры прототипа и пропускает значения-`Buffer`.
- `models` не импортируют `services`. `Workout.calcTonnage()` — синхронный, без параметров, Σ `WorkoutSet.volume()` по подходам тренировки.

### Асинхронность

Методы с БД и bcrypt — `async`; тип на диаграмме = тип результата Promise. `null`, если запись не найдена.

## Пакет services — 7 классов

| Класс | Атрибуты | Методы |
|---|---|---|
| ProgramGenerator | – loadTable: object | + generate(profile): Program; – selectSplit(level, days): Split; – pickExercises(split, equipment): Exercise[]; – calcStartWeight(exercise, profile): number |
| ExerciseSelector | — | + filter(muscleId, equipment, difficulty): Exercise[]; + suggestReplacement(exerciseId, equipment): Exercise[] |
| ProgressAnalytics | — | + getProgress(userId, exerciseId, from, to): Series; + getTonnage(userId, period): number; + analyzeBalance(userId, week): BalanceReport; + getRegularity(userId): Regularity |
| WeightAdaptationService | – maxIncreasePct = 0.10; – failLimit = 2 | + adapt(workout): WeightHistory[]; – evaluateSets(sets, repsMin, repsMax): Result; – decide(result, history): Decision; – calcStep(exercise, weight): number; – roundToEquipment(weight, equipment): number |
| StrengthMetrics | — | + epley(weight, reps); + brzycki(weight, reps); + tonnage(sets) |
| RecordDetector | — | + detect(workout): PersonalRecord[]; – isBetter(current, best): boolean |
| BackupService | – backupDir: string; – schedule: string | + createBackup(adminId): BackupLog; + restore(fileName); + listBackups(): BackupLog[] |

- Приватные члены — `#`.
- `Split`, `Series`, `BalanceReport`, `Regularity`, `Result` — JSDoc `@typedef` в файле сервиса, не классы.
- Зависимости: ProgramGenerator → ExerciseSelector; WeightAdaptationService, RecordDetector, ProgressAnalytics → StrengthMetrics. Сервисы получают зависимости в конструкторе со значением по умолчанию (`constructor(selector = new ExerciseSelector())`). Конструкторы на диаграмме не показываются.
- Публичные методы сервисов имеют полный JSDoc (`@param`, `@returns`) — он пойдёт в листинг приложения.

## Тестирование приватных методов

`#`-методы не вызываются из тестов и не делаются публичными. Они проверяются сценарно через публичный метод; модели подменяются `mock.method` из `node:test`. Подмена работает, потому что модуль экспортирует один объект класса:

```js
import { test, mock } from 'node:test';
import { WorkoutSet, WeightHistory, ProgramExercise } from '../src/models/index.js';

mock.method(WorkoutSet, 'findHistory', async () => [/* прошлые подходы */]);
mock.method(ProgramExercise.prototype, 'updateWeight', async () => {});
const created = mock.method(WeightHistory, 'create', async (d) => d);
// adapt(workout) → проверить created.mock.calls[0].arguments[0].decision и newWeight
```

| Приватный метод | Через | Что проверяем |
|---|---|---|
| #evaluateSets, #decide | adapt() | ABOVE→INCREASE; WITHIN→KEEP; BELOW один раз→KEEP; BELOW дважды подряд→DECREASE |
| #calcStep, #roundToEquipment | adapt() | newWeight: штанга кратно 2,5, гантели кратно 1, рост ≤ 10 % (при малом весе — ровно один шаг инвентаря) |
| #selectSplit | generate() | мок `Program.create`: `data.days.length` и названия дней при 3 / 4 / 5 тренировках |
| #pickExercises, #calcStartWeight | generate() | мок `ExerciseSelector.prototype.filter`; проверяем упражнения и стартовые веса в `data.days[].exercises[]` |
| #isBetter | detect() | мок `PersonalRecord.findBest`: рекорд создаётся только при превышении |

## Контроллеры и маршруты

Контроллеры: AuthController, ProfileController, ProgramController, WorkoutController, ExerciseController, AnalyticsController, AdminController. `PageController` разносится по ним. Клиентский модуль сохранения тренировки — `public/js/WorkoutPage.js`.

Страницы (EJS): `/login`, `/register`, `/profile`, `/programs`, `/programs/templates`, `/workouts/new`, `/workouts`, `/exercises`, `/exercises/:id`, `/stats`, `/tools/1rm`, `/admin/users`, `/admin/exercises`, `/admin/templates`, `/admin/backups`.

API (JSON): `POST /api/workouts` → 201 `{ tonnage, records, adaptations }`; `GET /api/stats/progress|tonnage|balance|regularity`; `GET /api/exercises/:id/replacements`; `GET /api/1rm`; `GET /media/:id`.

Порядок `WorkoutController.save`: сессия → `Workout.create()` → `RecordDetector.detect()` → `WeightAdaptationService.adapt()` → 201.

## Интерфейс — шаблон «Железный план»

Все страницы оформляются по макету `design/gym-figma-mockup/` (UI Kit — `13-ui-kit.svg`, `ui-kit.png`); требования и токены — `prompt_claude_code.md`. Из макета берётся только внешний вид, тексты — свои. Логотип — «Тренировочный дневник».

- Только классы и переменные из `public/css/styles.css`. Новый цвет или размер — новая переменная в `:root`, не литерал в правиле.
- Каркас страницы: `header.site-header` (`.brand`, `button.burger[aria-controls="site-nav"]`, `nav.nav#site-nav` с `.nav__link`, активный — `aria-current="page"`) → `main.page > .container` (`h1.page__title`, `p.page__intro`, `.page__content`) → `footer.site-footer`; подключить `/js/nav.js`. На этапе 0.3 шапка и футер переносятся в EJS-partials без изменения разметки.
- Компоненты: `.button--primary`, `.button--ghost`, `.button-row`; `.hero` (`.hero__title`, `.hero__lead`); `.card` (неоновая полоса сверху); `.day-card` / `.day-card--rest`; `.chips` + `.chip` (вкл. — `aria-pressed="true"` или `.chip-input:checked + .chip`), бейдж — `.chip--static`, `.chip--success`, `.chip--error`; `.result` (`.result__score`); `.gallery` + `.gallery__item`, просмотр — `dialog.viewer`; `.form` / `.form-card` / `.field` (`.field__hint`, `.field__error`), ошибка поля — `aria-invalid="true"`; `.alert--error` / `.alert--success`; `.table-wrap` + `.table`; `.pagination`; `.num-accent`; сетки `.grid-3`, `.grid-4`.
- Брейкпоинты `1100px` (планшет) и `600px` (смартфон, меню-бургер). Поля контейнера 16 px на всех ширинах (по SVG), контент на 1440 — 1068 px.
- Проверка новой страницы — на 1440 / 820 / 375 px.

## Стиль работы

- Сначала план (plan mode), затем код, затем `npm test`.
- После этапа обнови «Журнал этапов» в `docs/PLAN.md`, сделай коммит `stage-N: …`.
- Не трогай файлы вне задачи этапа. Не переименовывай члены диаграммы.
- Комментарии — на русском.
