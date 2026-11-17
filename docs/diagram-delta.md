# Расхождения кода с рисунками 1.7 и 1.8 (этап 13)

Сверка выполнена 17.11.2026 командой `npm run check:diagram` (`scripts/check-diagram.js`). Эталон — таблицы «Пакет models», «Пакет services» и «Разрешённые дополнения» из CLAUDE.md: они перенесены с диаграммы классов 1:1, и скрипт разбирает их как есть.

Что проверяется:
- имена классов, атрибутов и методов;
- видимость (`+` / `–` = `#`), `static`, имена параметров;
- начальные значения `maxIncreasePct = 0.10`, `failLimit = 2`, `MAX_FAILED_LOGINS = 5`, `LOCK_MINUTES = 15` и их неизменяемость `{readOnly}`;
- JSDoc публичных методов сервисов (`@param`, тип `@returns`);
- инкапсуляция моделей: нет публичных полей, сеттеров и `toJSON`; у `User` нет геттеров `passwordHash`, `failedLogins`, `lockedUntil`;
- `models` не импортируют `services`;
- перечисления совпадают с ENUM PostgreSQL, атрибуты моделей — со столбцами таблиц `db/schema.sql`.

Сверку выполняет и тест `tests/diagram.test.js` в составе `npm test`.

**Итог: расхождений 0.** Ниже — что нужно дорисовать на рисунках и как пояснить в записке то, что на них сознательно не показано.

## 1. Дорисовать на рисунке 1.8 (диаграмма классов)

| Класс | Член | Где используется |
|---|---|---|
| ExerciseMedia | <u>+ findById(id): ExerciseMedia</u> — статический, подчеркнуть, поставить после `create(data)` | Маршрут `GET /media/:id`, метод `ExerciseController.media`: отдаёт файл с заголовком `Content-Type` = `mimeType`. Изображения и видео на карточке упражнения `/exercises/:id` загружаются по этому адресу |

Других дополнений нет: каждый метод кода есть на диаграмме, и каждый метод диаграммы реализован.

## 2. На рисунке 1.8 не показано — пояснение для записки (раздел 1.5)

| Что в коде | Почему не на диаграмме |
|---|---|
| Get-аксессоры атрибутов моделей (`user.login`, `program.status` …) | Атрибуты закрыты (`#`), состояние меняется только методами класса, чтение — через свойства-аксессоры, которые по соглашению UML не показываются. Сеттеров нет. У `User` нет аксессоров `passwordHash`, `failedLogins`, `lockedUntil`: их состояние доступно только через `checkPassword()` и `isLocked()` |
| `Workout.#sets` и аксессор `sets` | Реализация композиции Workout ◆— WorkoutSet (1 : 1..*): подходы загружаются вместе с тренировкой, по ним синхронно считается `calcTonnage()` |
| `ProgramGenerator.#selector`; `#metrics` у WeightAdaptationService, RecordDetector, ProgressAnalytics | Реализация зависимостей «use» (пунктирные стрелки → ExerciseSelector и → StrengthMetrics). Объект передаётся в конструктор, по умолчанию создаётся новый. Конструкторы на диаграмме не показываются |
| Типы `Split`, `Series`, `BalanceReport`, `Regularity`, `Result` | Структуры данных результата: описаны JSDoc `@typedef` в файлах сервисов, классами не являются |
| `HttpError` (`src/middleware/errorHandler.js`) | Инфраструктурный класс веб-слоя (ошибка с кодом HTTP-ответа), вне пакетов models и services |
| Контроллеры, `WorkoutPage` (`public/js/WorkoutPage.js`) | Относятся к представлению и контроллеру MVC; на рис. 1.8 показаны только пакеты models и services |

**Асинхронность — одна фраза для записки.** Методы, обращающиеся к базе данных или к bcrypt, асинхронные (возвращают Promise); на диаграмме указан тип результата Promise.

- Синхронные методы моделей: `User.isLocked()`, `TrainingProfile.isComplete()`, `Workout.calcTonnage()`, `WorkoutSet.volume()`.
- Синхронные методы сервисов: все методы `StrengthMetrics`, `#selectSplit`, `#evaluateSets`, `#decide`, `#calcStep`, `#roundToEquipment`, `#isBetter`.
- Остальные методы асинхронные, в том числе `#pickExercises` и `#calcStartWeight` (читают справочник групп мышц).

## 3. Рисунок 1.7 (физическая модель БД)

| Изменение | Описание |
|---|---|
| Добавить в таблицу `users` столбец `locked_until TIMESTAMP` (после `failed_logins`) | Атрибут `User.lockedUntil` есть на диаграмме классов и в `schema.sql`, на рис. 1.7 его нет. Время окончания временной блокировки входа (ФТ-02); NULL — блокировки нет |
| Таблицу `session` не рисовать | Служебная таблица хранилища сессий express-session (connect-pg-simple): `sid`, `sess`, `expire`. Не относится к предметной области и не входит в резервную копию (`pg_dump --exclude-table=session`). В разделе 4.2.6 упомянуть одной фразой |

Остальные таблицы, столбцы, типы, ENUM и ключи `schema.sql` совпадают с рис. 1.7. Ограничения сверх модели (CHECK, частичный уникальный индекс `programs_one_active_idx`, правила ON DELETE) описываются в разделе 1.4: см. «Что поправить в записке», п. 5 в `docs/PLAN.md`.

## 4. Результат сверки

| Пакет | Класс | Атрибутов | Методов | Дополнения | Результат |
|---|---|---|---|---|---|
| models | User | 11 | 10 | — | совпадает |
| models | TrainingProfile | 7 | 4 | — | совпадает |
| models | Program | 8 | 8 | — | совпадает |
| models | ProgramDay | 4 | 1 | — | совпадает |
| models | ProgramExercise | 9 | 3 | — | совпадает |
| models | Exercise | 8 | 5 | — | совпадает |
| models | ExerciseMedia | 5 | 3 | `static findById(id)` | совпадает |
| models | MuscleGroup | 3 | 1 | — | совпадает |
| models | Workout | 6 | 5 | — | совпадает |
| models | WorkoutSet | 6 | 5 | — | совпадает |
| models | WeightHistory | 6 | 1 | — | совпадает |
| models | PersonalRecord | 6 | 2 | — | совпадает |
| models | BackupLog | 6 | 2 | — | совпадает |
| services | ProgramGenerator | 1 | 4 | — | совпадает |
| services | ExerciseSelector | 0 | 2 | — | совпадает |
| services | ProgressAnalytics | 0 | 4 | — | совпадает |
| services | WeightAdaptationService | 2 | 5 | — | совпадает |
| services | StrengthMetrics | 0 | 3 | — | совпадает |
| services | RecordDetector | 0 | 2 | — | совпадает |
| services | BackupService | 2 | 3 | — | совпадает |

У `User` 11 атрибутов: 9 полей экземпляра и 2 статические константы `{readOnly}`.

| Перечисление | Значения | ENUM PostgreSQL |
|---|---|---|
| Role | USER, ADMIN | user_role — совпадает |
| Goal | GENERAL, HYPERTROPHY, STRENGTH, ENDURANCE | goal — совпадает |
| Level | BEGINNER, INTERMEDIATE, ADVANCED | level — совпадает |
| ProgramStatus | DRAFT, ACTIVE, ARCHIVED | program_status — совпадает |
| Decision | INCREASE, KEEP, DECREASE | decision — совпадает |
| RecordType | MAX_WEIGHT, MAX_REPS, MAX_1RM, MAX_TONNAGE | record_type — совпадает |

**Проверка самого скрипта.** В копии кода временно были внесены ошибки:
- геттер `passwordHash` и сеттер у `User`;
- лишний метод у `Exercise`;
- другое имя параметра в `WorkoutSet.findHistory`;
- `#failLimit = 3`;
- публичный `isBetter` вместо `#isBetter`.

Скрипт нашёл все 7 расхождений, после этого код возвращён в исходное состояние.
