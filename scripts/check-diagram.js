/**
 * Сверка кода с диаграммой классов (рис. 1.8) — этап 13.
 *
 * Эталон — таблицы CLAUDE.md («Пакет models», «Пакет services», «Разрешённые дополнения»),
 * перенесённые с диаграммы 1:1; скрипт разбирает их, а не хранит свою копию.
 *  - публичные и статические методы — через import (get-аксессоры пропускаются),
 *    имена параметров — из исходного текста функции;
 *  - закрытые #-поля и #-методы — разбором исходника класса регулярными выражениями;
 *  - инкапсуляция моделей: нет публичных полей, сеттеров и toJSON, у User нет геттеров
 *    passwordHash / failedLogins / lockedUntil;
 *  - перечисления enums.js = ENUM PostgreSQL, атрибуты моделей = столбцы таблиц db/schema.sql.
 *
 * Запуск: npm run check:diagram  (--md — итоговая таблица в markdown).
 * Код выхода 1, если есть необъяснённые расхождения.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Дополнения реализации, которые не являются расхождениями с диаграммой.
 * Ключ — «Класс.член»; значение — пояснение для записки.
 */
const EXPLAINED = Object.freeze({
  'Workout.#sets': 'композиция Workout ◆— WorkoutSet: подходы загружаются вместе с тренировкой (нужны calcTonnage)',
  'Workout.get sets': 'чтение подходов тренировки (копия массива)',
  'ProgramGenerator.#selector': 'зависимость ProgramGenerator → ExerciseSelector (пунктирная стрелка «use»)',
  'WeightAdaptationService.#metrics': 'зависимость → StrengthMetrics (пунктирная стрелка «use»)',
  'RecordDetector.#metrics': 'зависимость → StrengthMetrics (пунктирная стрелка «use»)',
  'ProgressAnalytics.#metrics': 'зависимость → StrengthMetrics (пунктирная стрелка «use»)',
});

/** Атрибуты, у которых не должно быть геттеров (CLAUDE.md, «Инкапсуляция моделей»). */
const HIDDEN_ATTRIBUTES = Object.freeze({ User: ['passwordHash', 'failedLogins', 'lockedUntil'] });

/** Перечисление → тип ENUM PostgreSQL. */
const ENUM_TYPES = Object.freeze({
  Role: 'user_role', Goal: 'goal', Level: 'level',
  ProgramStatus: 'program_status', Decision: 'decision', RecordType: 'record_type',
});

/** Модель → таблица физической модели. */
const MODEL_TABLES = Object.freeze({
  User: 'users', TrainingProfile: 'training_profiles', Program: 'programs',
  ProgramDay: 'program_days', ProgramExercise: 'program_exercises', Exercise: 'exercises',
  ExerciseMedia: 'exercise_media', MuscleGroup: 'muscle_groups', Workout: 'workouts',
  WorkoutSet: 'workout_sets', WeightHistory: 'weight_history', PersonalRecord: 'personal_records',
  BackupLog: 'backup_logs',
});

/** Таблицы без класса модели и почему. */
const TABLES_WITHOUT_MODEL = Object.freeze({
  exercise_muscles: 'связь «вспомогательные» Exercise — MuscleGroup (0..* : 0..*)',
  session: 'служебная таблица хранилища сессий (connect-pg-simple)',
});

// ---------------------------------------------------------------------------
// Разбор эталона — таблиц CLAUDE.md
// ---------------------------------------------------------------------------

/** Разбиение строки по разделителю вне круглых скобок. */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const clean = (s) => s.replaceAll('**', '').replaceAll('`', '').trim();

/** «– evaluateSets(sets, repsMin, repsMax): Result» → описание метода. */
function parseMethodSpec(text, isStatic) {
  const m = clean(text).match(/^([+–-])?\s*(\w+)\(([^)]*)\)\s*(?::\s*(.+))?$/);
  if (!m) throw new Error(`CLAUDE.md: не разобран метод «${text}»`);
  return {
    name: m[2],
    visibility: m[1] === '–' || m[1] === '-' ? 'private' : 'public',
    isStatic,
    params: m[3].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean),
    type: m[4]?.trim() ?? null,
  };
}

/** «static #MAX_FAILED_LOGINS = 5 {readOnly}», «– maxIncreasePct = 0.10», «equipment: string[]». */
function parseAttributeSpec(text) {
  const m = clean(text).match(/^(?:[+–-]\s*)?(static\s+)?#?(\w+)\s*(?::\s*([^={]+?))?\s*(?:=\s*([^\s{]+))?\s*(\{readOnly\})?$/);
  if (!m) throw new Error(`CLAUDE.md: не разобран атрибут «${text}»`);
  return { name: m[2], isStatic: Boolean(m[1]), type: m[3] ?? null, value: m[4] ?? null, readOnly: Boolean(m[5]) };
}

function tableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`CLAUDE.md: нет раздела «${heading}»`);
  const rows = [];
  let inTable = false;
  for (const line of markdown.slice(start + heading.length).split(/\r?\n/)) {
    if (line.startsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (/^-+$/.test(cells[0].replaceAll(':', '')) || cells[0] === 'Класс') continue;
      rows.push(cells);
    } else if (inTable) {
      break;
    }
  }
  return rows;
}

/** Эталон: { models: Map, services: Map, additions: [] } по таблицам CLAUDE.md. */
export function readSpec(claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')) {
  const parseAttrs = (cell) => (/^[—-]$/.test(cell.trim()) ? [] :
    splitTop(cell, ';').flatMap((part) => splitTop(part, ',')).map(parseAttributeSpec));

  const models = new Map();
  for (const [cls, attrs, methods] of tableRows(claudeMd, '## Пакет models')) {
    const [instancePart, staticPart = ''] = clean(methods).split(/\bstatic\b(?=\s+\w+\()/);
    models.set(clean(cls), {
      attributes: parseAttrs(attrs),
      methods: [
        ...splitTop(instancePart, ';').map((t) => parseMethodSpec(t, false)),
        ...splitTop(staticPart, ',').map((t) => parseMethodSpec(t, true)),
      ],
    });
  }

  const services = new Map();
  for (const [cls, attrs, methods] of tableRows(claudeMd, '## Пакет services')) {
    services.set(clean(cls), {
      attributes: parseAttrs(attrs),
      methods: splitTop(methods, ';').map((t) => parseMethodSpec(t, false)),
    });
  }

  const additions = tableRows(claudeMd, '### Разрешённые дополнения').map(([cls, member, why]) => {
    const m = clean(member).match(/^(static\s+)?(.+)$/);
    return { className: clean(cls), ...parseMethodSpec(m[2], Boolean(m[1])), why: clean(why) };
  });

  return { models, services, additions };
}

// ---------------------------------------------------------------------------
// Разбор кода
// ---------------------------------------------------------------------------

/** Текст между парными скобками, начиная с открывающей в позиции from. */
function balanced(text, from, open = '(', close = ')') {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  throw new Error('нет закрывающей скобки');
}

/** Имена параметров из списка «a, b = 1, { c } = {}». */
function paramNames(list) {
  return splitTop(list.replace(/\{[^}]*\}/g, '{}'), ',').map((p) => p.split('=')[0].trim());
}

function paramsOf(fn) {
  const src = fn.toString();
  return paramNames(balanced(src, src.indexOf('(')));
}

/** Тело класса (исходник) — от «export class Name {» до закрывающей скобки в начале строки. */
function classBody(source, name) {
  const m = source.match(new RegExp(`^export class ${name}\\b[^{]*\\{`, 'm'));
  if (!m) return null;
  const from = m.index + m[0].length;
  const end = source.indexOf('\n}', from);
  return source.slice(from, end);
}

/** Закрытые члены класса из исходника: члены тела класса с отступом 2 пробела. */
function privateMembers(body) {
  const fields = new Map();
  const methods = new Map();
  for (const m of body.matchAll(/^ {2}(static\s+)?(async\s+)?#(\w+)\s*(\(|=|;)/gm)) {
    const [, isStatic, , name, kind] = m;
    if (kind === '(') {
      const params = paramNames(balanced(body, m.index + m[0].length - 1));
      methods.set(name, { name, isStatic: Boolean(isStatic), params });
    } else {
      const lineEnd = body.indexOf('\n', m.index);
      const line = body.slice(m.index, lineEnd < 0 ? undefined : lineEnd);
      const value = kind === '=' ? line.slice(line.indexOf('=') + 1).split(';')[0].trim() : null;
      fields.set(name, { name, isStatic: Boolean(isStatic), value, readOnlyComment: /\/\/\s*\{readOnly\}/.test(line) });
    }
  }
  return { fields, methods };
}

/** JSDoc непосредственно перед объявлением публичного метода. */
function jsDocOf(body, name) {
  const m = body.match(new RegExp(`(/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/)\\s*\\n {2}(?:static\\s+)?(?:async\\s+)?${name}\\(`));
  if (!m) return null;
  const doc = m[1];
  // Тип тега — в фигурных скобках, которые могут быть вложенными: {Array<{weight: number}>}.
  const tags = [...doc.matchAll(/@(param|returns?)\s+(?=\{)/g)].map((t) => {
    const from = t.index + t[0].length;
    const type = balanced(doc, from, '{', '}');
    const rest = doc.slice(from + type.length + 2);
    return { tag: t[1], type, name: rest.match(/^\s+\[?(\w+)/)?.[1] };
  });
  return {
    params: tags.filter((t) => t.tag === 'param').map((t) => t.name),
    returns: tags.find((t) => t.tag !== 'param')?.type ?? null,
  };
}

/** Promise<Exercise[]|null> → Exercise[]. */
function normalizeType(type) {
  let t = type.replace(/\s/g, '');
  const p = t.match(/^Promise<(.+)>$/);
  if (p) t = p[1];
  return t.split('|').filter((x) => x !== 'null').join('|').replace(/^import\([^)]*\)\./, '');
}

function isClass(value) {
  return typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));
}

/** Публичная поверхность класса через import. */
function publicSurface(cls) {
  const surface = { methods: [], getters: [], setters: [], fields: [] };
  const scan = (target, isStatic) => {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (!isStatic && key === 'constructor') continue;
      if (isStatic && ['length', 'name', 'prototype'].includes(key)) continue;
      const d = Object.getOwnPropertyDescriptor(target, key);
      if (d.get) surface.getters.push({ name: key, isStatic });
      if (d.set) surface.setters.push({ name: key, isStatic });
      if ('value' in d) {
        if (typeof d.value === 'function') {
          surface.methods.push({
            name: key, isStatic, params: paramsOf(d.value),
            isAsync: d.value.constructor.name === 'AsyncFunction',
          });
        } else {
          surface.fields.push({ name: key, isStatic });
        }
      }
    }
  };
  scan(cls.prototype, false);
  scan(cls, true);
  return surface;
}

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Столбцы таблиц и значения ENUM из db/schema.sql. */
function readSchema(sql = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8')) {
  const tables = new Map();
  for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
    const columns = m[2].split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+\s/.test(l) && !l.startsWith('CONSTRAINT'))
      .map((l) => l.split(/\s+/)[0]);
    tables.set(m[1], columns);
  }
  const enums = new Map();
  for (const m of sql.matchAll(/CREATE TYPE (\w+)\s+AS ENUM \(([^)]*)\)/g)) {
    enums.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  }
  return { tables, enums };
}

// ---------------------------------------------------------------------------
// Сверка
// ---------------------------------------------------------------------------

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sig = (m) => `${m.isStatic ? 'static ' : ''}${m.visibility === 'private' ? '#' : ''}${m.name}(${m.params.join(', ')})`;

/**
 * Сверка кода с эталоном.
 * @returns {Promise<{problems: string[], explained: string[], classes: object[]}>}
 */
export async function checkDiagram({ spec = readSpec(), schema = readSchema() } = {}) {
  process.env.SESSION_SECRET ??= 'check-diagram'; // модели импортируют config
  const problems = [];
  const explained = [];
  const classes = [];

  const additionsFor = (cls) => spec.additions.filter((a) => a.className === cls);
  const explain = (key) => {
    if (!EXPLAINED[key]) return false;
    explained.push(`${key} — ${EXPLAINED[key]}`);
    return true;
  };

  for (const [pkg, specMap] of [['models', spec.models], ['services', spec.services]]) {
    const dir = path.join(ROOT, 'src', pkg);
    const index = await import(pathToFileURL(path.join(dir, 'index.js')));

    // Состав пакета: классы index.js и файлы каталога.
    const exported = Object.entries(index).filter(([, v]) => isClass(v)).map(([k]) => k);
    for (const name of exported) if (!specMap.has(name)) problems.push(`${pkg}: класс ${name} не на диаграмме`);
    for (const name of specMap.keys()) if (!exported.includes(name)) problems.push(`${pkg}: нет класса ${name}`);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const base = file.replace(/\.js$/, '');
      if (base === 'index' || (pkg === 'models' && base === 'enums')) continue;
      if (!specMap.has(base)) problems.push(`${pkg}: файл ${file} не соответствует классу диаграммы`);
    }

    for (const [name, expected] of specMap) {
      const cls = index[name];
      if (!cls) continue;
      const file = path.join(dir, `${name}.js`);
      const source = fs.readFileSync(file, 'utf8');
      const body = classBody(source, name) ?? '';
      const surface = publicSurface(cls);
      const priv = privateMembers(body);
      const before = problems.length;
      const where = `${name}`;
      const allowed = additionsFor(name);

      // Методы: эталон → код.
      const expectedMethods = [...expected.methods, ...allowed];
      for (const m of expectedMethods) {
        if (m.visibility === 'private') {
          const code = priv.methods.get(m.name);
          if (!code) {
            const pub = surface.methods.find((x) => x.name === m.name);
            problems.push(pub ? `${where}: ${m.name} должен быть закрытым (#)` : `${where}: нет метода ${sig(m)}`);
            continue;
          }
          if (code.isStatic !== m.isStatic) problems.push(`${where}: #${m.name} — static не совпадает`);
          if (!sameList(code.params, m.params)) problems.push(`${where}: #${m.name}(${code.params.join(', ')}) ≠ диаграмма ${sig(m)}`);
          continue;
        }
        const code = surface.methods.find((x) => x.name === m.name);
        if (!code) {
          problems.push(priv.methods.has(m.name) ? `${where}: ${m.name} должен быть публичным` : `${where}: нет метода ${sig(m)}`);
          continue;
        }
        if (code.isStatic !== m.isStatic) {
          problems.push(`${where}: ${m.name} — на диаграмме ${m.isStatic ? 'static' : 'экземплярный'}, в коде ${code.isStatic ? 'static' : 'экземплярный'}`);
        }
        if (!sameList(code.params, m.params)) problems.push(`${where}: ${m.name}(${code.params.join(', ')}) ≠ диаграмма ${sig(m)}`);
        if (pkg === 'services') {
          const doc = jsDocOf(body, m.name);
          if (!doc) {
            problems.push(`${where}: у ${m.name} нет JSDoc`);
          } else {
            if (!sameList(doc.params, m.params)) problems.push(`${where}: JSDoc @param ${m.name} — ${doc.params.join(', ') || 'нет'}`);
            if (!doc.returns) problems.push(`${where}: JSDoc ${m.name} без @returns`);
            else if (m.type && normalizeType(doc.returns) !== normalizeType(m.type)) {
              problems.push(`${where}: ${m.name} @returns {${doc.returns}} ≠ диаграмма ${m.type}`);
            }
          }
        }
      }
      // Методы: код → эталон (лишние).
      for (const m of surface.methods) {
        if (!expectedMethods.some((x) => x.name === m.name && x.visibility !== 'private')) {
          problems.push(`${where}: лишний публичный ${m.isStatic ? 'статический ' : ''}метод ${m.name}`);
        }
      }
      for (const m of priv.methods.values()) {
        if (!expected.methods.some((x) => x.name === m.name && x.visibility === 'private')) {
          if (!explain(`${name}.#${m.name}`)) problems.push(`${where}: лишний закрытый метод #${m.name}`);
        }
      }

      // Атрибуты.
      for (const a of expected.attributes) {
        const f = priv.fields.get(a.name);
        if (!f) {
          problems.push(`${where}: нет закрытого поля #${a.name}`);
          continue;
        }
        if (f.isStatic !== a.isStatic) problems.push(`${where}: #${a.name} — static не совпадает`);
        if (a.value !== null && Number(f.value) !== Number(a.value)) problems.push(`${where}: #${a.name} = ${f.value} ≠ диаграмма ${a.value}`);
        if (a.readOnly) {
          if (!f.readOnlyComment) problems.push(`${where}: у #${a.name} нет комментария // {readOnly}`);
          const assignments = [...source.matchAll(new RegExp(`#${a.name}\\s*(?:[-+*/]?=)(?!=)`, 'g'))].length;
          if (assignments !== 1) problems.push(`${where}: константе #${a.name} присваивается значение вне объявления`);
        }
      }
      for (const f of priv.fields.values()) {
        if (!expected.attributes.some((a) => a.name === f.name)) {
          if (!explain(`${name}.#${f.name}`)) problems.push(`${where}: лишнее закрытое поле #${f.name}`);
        }
      }

      // Инкапсуляция.
      for (const s of surface.setters) problems.push(`${where}: сеттер ${s.name}`);
      for (const f of surface.fields) problems.push(`${where}: публичное ${f.isStatic ? 'статическое ' : ''}поле ${f.name}`);
      if (surface.methods.some((m) => m.name === 'toJSON')) problems.push(`${where}: метод toJSON`);
      const hidden = HIDDEN_ATTRIBUTES[name] ?? [];
      for (const g of surface.getters) {
        if (g.isStatic) {
          problems.push(`${where}: статический геттер ${g.name}`);
        } else if (hidden.includes(g.name)) {
          problems.push(`${where}: геттер ${g.name} запрещён — значение доступно только через методы`);
        } else if (pkg === 'services' || !expected.attributes.some((a) => a.name === g.name && !a.isStatic)) {
          if (!explain(`${name}.get ${g.name}`)) problems.push(`${where}: лишний геттер ${g.name}`);
        }
      }

      if (pkg === 'models') {
        for (const a of expected.attributes) {
          if (a.isStatic || hidden.includes(a.name)) continue;
          if (!surface.getters.some((g) => g.name === a.name)) problems.push(`${where}: нет геттера ${a.name}`);
        }
        // Экземпляр: публичных полей нет, JSON.stringify — «{}».
        try {
          const instance = new cls({});
          if (Object.keys(instance).length) problems.push(`${where}: публичные поля экземпляра ${Object.keys(instance).join(', ')}`);
          if (JSON.stringify(instance) !== '{}') problems.push(`${where}: JSON.stringify(экземпляр) ≠ {}`);
        } catch (err) {
          problems.push(`${where}: конструктор не принимает пустую строку БД (${err.message})`);
        }
        // models не импортируют services.
        if (/from\s+['"]\.\.\/services\//.test(source)) problems.push(`${where}: модель импортирует services`);
        // Атрибуты = столбцы таблицы.
        const table = MODEL_TABLES[name];
        const columns = schema.tables.get(table);
        if (!columns) {
          problems.push(`${where}: нет таблицы ${table} в schema.sql`);
        } else {
          const attrs = expected.attributes.filter((a) => !a.isStatic).map((a) => snake(a.name));
          for (const c of attrs) if (!columns.includes(c)) problems.push(`${where}: атрибута ${c} нет в таблице ${table}`);
          for (const c of columns) if (!attrs.includes(c)) problems.push(`${table}: столбец ${c} без атрибута в ${name}`);
        }
      }

      classes.push({
        pkg, name,
        attributes: expected.attributes.length,
        methods: expected.methods.length,
        additions: allowed.map(sig),
        asyncMethods: surface.methods.filter((m) => m.isAsync).map((m) => m.name),
        ok: problems.length === before,
      });
    }
  }

  // Перечисления.
  const enums = await import(pathToFileURL(path.join(ROOT, 'src', 'models', 'enums.js')));
  for (const [name, type] of Object.entries(ENUM_TYPES)) {
    const e = enums[name];
    if (!e) { problems.push(`enums.js: нет перечисления ${name}`); continue; }
    if (!Object.isFrozen(e)) problems.push(`enums.js: ${name} не заморожено (Object.freeze)`);
    const values = Object.values(e);
    const pg = schema.enums.get(type) ?? [];
    if (!sameList(values, pg)) problems.push(`${name} [${values.join(', ')}] ≠ ENUM ${type} [${pg.join(', ')}]`);
    classes.push({ pkg: 'enums', name, values, ok: sameList(values, pg) && Object.isFrozen(e) });
  }
  for (const name of Object.keys(enums)) if (!ENUM_TYPES[name]) problems.push(`enums.js: перечисление ${name} не на диаграмме`);

  // Таблицы без модели.
  const modelTables = Object.values(MODEL_TABLES);
  for (const table of schema.tables.keys()) {
    if (modelTables.includes(table)) continue;
    if (TABLES_WITHOUT_MODEL[table]) explained.push(`таблица ${table} — ${TABLES_WITHOUT_MODEL[table]}`);
    else problems.push(`schema.sql: таблица ${table} без класса модели`);
  }
  for (const a of spec.additions) explained.push(`${a.className}.${sig(a)} — разрешённое дополнение (${a.why}); дорисовать на рис. 1.8`);

  return { problems, explained, classes };
}

/** Итоговая таблица в markdown (для docs/diagram-delta.md). */
export function toMarkdown({ problems, explained, classes }) {
  const lines = ['| Пакет | Класс | Атрибутов | Методов | Дополнения | Результат |', '|---|---|---|---|---|---|'];
  for (const c of classes.filter((x) => x.pkg !== 'enums')) {
    lines.push(`| ${c.pkg} | ${c.name} | ${c.attributes} | ${c.methods} | ${c.additions.map((a) => `\`${a}\``).join(', ') || '—'} | ${c.ok ? 'совпадает' : 'расхождение'} |`);
  }
  lines.push('', '| Перечисление | Значения | ENUM PostgreSQL |', '|---|---|---|');
  for (const c of classes.filter((x) => x.pkg === 'enums')) {
    lines.push(`| ${c.name} | ${c.values.join(', ')} | ${ENUM_TYPES[c.name]} — ${c.ok ? 'совпадает' : 'расхождение'} |`);
  }
  lines.push('', `Расхождений: **${problems.length}**.`);
  for (const p of problems) lines.push(`- ${p}`);
  lines.push('', 'Пояснено (не расхождения):');
  for (const e of explained) lines.push(`- ${e}`);
  return lines.join('\n');
}

function printReport(report) {
  for (const pkg of ['models', 'services']) {
    console.log(`\nПакет ${pkg}`);
    for (const c of report.classes.filter((x) => x.pkg === pkg)) {
      const extra = c.additions.length ? `; дополнения: ${c.additions.join(', ')}` : '';
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(24)} атрибутов ${String(c.attributes).padStart(2)}, методов ${String(c.methods).padStart(2)}${extra}`);
    }
  }
  console.log('\nПеречисления');
  for (const c of report.classes.filter((x) => x.pkg === 'enums')) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(24)} ${c.values.join(', ')}`);
  }
  console.log('\nПояснено (не расхождения):');
  for (const e of report.explained) console.log(`  · ${e}`);
  console.log(`\nРасхождений: ${report.problems.length}`);
  for (const p of report.problems) console.log(`  ✗ ${p}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await checkDiagram();
  if (process.argv.includes('--md')) console.log(toMarkdown(report));
  else printReport(report);
  process.exitCode = report.problems.length ? 1 : 0;
}
