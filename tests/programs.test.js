import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Этап 8 без БД: проверка форм и сценарии контроллеров с подменой моделей (mock.method).
process.env.SESSION_SECRET ??= 'test-secret';
const { parseExerciseForm, parseLoadParams, parseTemplateForm } = await import('../src/middleware/validate.js');
const { ProgramController } = await import('../src/controllers/ProgramController.js');
const { AdminController } = await import('../src/controllers/AdminController.js');
const { Program, ProgramDay, ProgramExercise, Exercise, MuscleGroup, TrainingProfile } =
  await import('../src/models/index.js');
const { ExerciseSelector } = await import('../src/services/index.js');

afterEach(() => mock.restoreAll());

// ---------- Проверка форм ----------

const exerciseBody = {
  name: '  Жим   лёжа ', primaryMuscleId: '1', secondaryMuscleIds: ['4', '1'],
  equipment: 'штанга', difficulty: '2', weightStep: '2,5', technique: 'Описание',
};

test('parseExerciseForm: корректная форма; основная группа не дублируется во вспомогательных', () => {
  const { data, errors } = parseExerciseForm(exerciseBody, [1, 4]);
  assert.deepEqual(errors, {});
  assert.deepEqual(data, {
    name: 'Жим лёжа', primaryMuscleId: 1, secondaryMuscleIds: [4], equipment: 'штанга',
    difficulty: 2, weightStep: 2.5, technique: 'Описание',
  });
});

test('parseExerciseForm: ошибки по полям', () => {
  const { errors } = parseExerciseForm(
    { name: 'Ж', primaryMuscleId: '9', secondaryMuscleIds: '77', equipment: 'гиря', difficulty: '4', weightStep: '-1' },
    [1, 4],
  );
  assert.deepEqual(Object.keys(errors).sort(),
    ['difficulty', 'equipment', 'name', 'primaryMuscleId', 'secondaryMuscleIds', 'weightStep']);
});

test('parseLoadParams: значения по упражнениям дня, границы и порядок повторений', () => {
  const body = { sets_5: '4', repsMin_5: '6', repsMax_5: '10', restSec_5: '120', workingWeight_5: '62,5',
    sets_6: '0', repsMin_6: '12', repsMax_6: '8', restSec_6: '700', workingWeight_6: '10.555' };
  const { changes, errors } = parseLoadParams(body, [5, 6]);
  assert.deepEqual(changes.get(5), { sets: 4, repsMin: 6, repsMax: 10, restSec: 120, workingWeight: 62.5 });
  assert.deepEqual(Object.keys(errors).sort(), ['repsMax_6', 'restSec_6', 'sets_6', 'workingWeight_6']);
});

test('parseLoadParams: замена упражнения в шаблоне — только из разрешённых', () => {
  const body = { sets_5: '3', repsMin_5: '8', repsMax_5: '12', restSec_5: '90', workingWeight_5: '0', exerciseId_5: '99' };
  assert.ok(parseLoadParams(body, [5], { exerciseIds: new Set([1, 2]) }).errors.exerciseId_5);
  const ok = parseLoadParams({ ...body, exerciseId_5: '2' }, [5], { exerciseIds: new Set([1, 2]) });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.changes.get(5).exerciseId, 2);
});

test('parseTemplateForm: структура для Program.create, пустые строки пропускаются', () => {
  const body = {
    title: 'Верх/низ', goal: 'HYPERTROPHY', level: 'INTERMEDIATE', sets: '4', repsMin: '6', repsMax: '12', restSec: '90',
    day1_title: 'Верх', day1_ex1: '3', day1_ex2: '', day1_ex3: '7',
    day2_title: 'Низ', day2_ex1: '', day2_ex2: '8', day2_ex3: '',
  };
  const { data, errors } = parseTemplateForm(body, { days: 2, perDay: 3, exerciseIds: new Set([3, 7, 8]) });
  assert.deepEqual(errors, {});
  assert.equal(data.isTemplate, true);
  assert.equal(data.ownerId, null);
  assert.deepEqual(data.days.map((d) => [d.dayNumber, d.title, d.exercises.map((e) => [e.exerciseId, e.orderNo])]),
    [[1, 'Верх', [[3, 1], [7, 2]]], [2, 'Низ', [[8, 1]]]]);
  assert.deepEqual(data.days[0].exercises[0],
    { exerciseId: 3, orderNo: 1, sets: 4, repsMin: 6, repsMax: 12, restSec: 90, workingWeight: 0 });
});

test('parseTemplateForm: день без упражнений и неизвестное упражнение — ошибки', () => {
  const body = { title: 'Шаблон', goal: 'GENERAL', level: 'BEGINNER', sets: '3', repsMin: '8', repsMax: '12', restSec: '90',
    day1_title: 'А', day1_ex1: '', day2_title: 'Б', day2_ex1: '55' };
  const { errors } = parseTemplateForm(body, { days: 2, perDay: 1, exerciseIds: new Set([3]) });
  assert.ok(errors.day1_ex1);
  assert.ok(errors.day2_ex1);
});

// ---------- ProgramController ----------

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; },
    redirect(url) { this.redirectedTo = url; },
    json(body) { this.body = body; },
  };
}

const programRow = (over = {}) => ({ id: 20, owner_id: 7, title: 'Черновик', goal: 'GENERAL', level: 'BEGINNER',
  is_template: false, status: 'DRAFT', created_at: new Date(), ...over });

/** Подмены для отрисовки страницы программы (loadProgramView). */
function mockProgramView() {
  mock.method(ProgramDay, 'findByProgram', async () => []);
  mock.method(Exercise, 'search', async () => []);
  mock.method(MuscleGroup, 'findAll', async () => []);
}

const req = (params = {}, body = {}, session = {}) => ({ user: { id: 7 }, params, body, query: {}, session });

test('activate: при наличии активной программы без подтверждения — 409, ничего не меняется', async () => {
  mockProgramView();
  const draft = new Program(programRow());
  const active = new Program(programRow({ id: 10, title: 'Текущая', status: 'ACTIVE' }));
  mock.method(Program, 'findById', async () => draft);
  mock.method(Program, 'findActive', async () => active);
  const activate = mock.method(Program.prototype, 'activate', async () => {});
  const archive = mock.method(Program.prototype, 'archive', async () => {});

  const res = fakeRes();
  await ProgramController.activate(req({ id: '20' }), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.locals.error, /Текущая/);
  assert.equal(activate.mock.callCount(), 0);
  assert.equal(archive.mock.callCount(), 0);
});

test('activate: с подтверждением — прежняя в архив, новая активна, черновик сеанса очищен', async () => {
  const draft = new Program(programRow());
  const active = new Program(programRow({ id: 10, status: 'ACTIVE' }));
  mock.method(Program, 'findById', async () => draft);
  mock.method(Program, 'findActive', async () => active);
  const activate = mock.method(Program.prototype, 'activate', async () => {});
  const archive = mock.method(Program.prototype, 'archive', async () => {});

  const session = { draftProgramId: 20 };
  const res = fakeRes();
  await ProgramController.activate(req({ id: '20' }, { confirm: 'yes' }, session), res);
  assert.equal(archive.mock.calls[0].this, active);
  assert.equal(activate.mock.calls[0].this, draft);
  assert.equal(session.draftProgramId, undefined);
  assert.equal(res.redirectedTo, '/programs?activated=1');
});

test('show: чужая программа и шаблон — 404', async () => {
  mock.method(Program, 'findById', async () => new Program(programRow({ owner_id: 99 })));
  await assert.rejects(ProgramController.show(req({ id: '20' }), fakeRes()), { status: 404 });
  mock.restoreAll();
  mock.method(Program, 'findById', async () => new Program(programRow({ owner_id: null, is_template: true })));
  await assert.rejects(ProgramController.show(req({ id: '20' }), fakeRes()), { status: 404 });
});

test('replaceExercise: только упражнение из предложенных замен', async () => {
  const program = new Program(programRow());
  const pe = new ProgramExercise({ id: 30, program_day_id: 40, exercise_id: 1, order_no: 1, sets: 3,
    reps_min: 8, reps_max: 12, rest_sec: 90, working_weight: 40 });
  const replacement = new Exercise({ id: 2, name: 'Отжимания', primary_muscle_id: 1, equipment: 'собственный вес',
    difficulty: 1, technique: '', weight_step: 0, is_active: true });
  mock.method(Program, 'findById', async () => program);
  mock.method(ProgramDay, 'findByProgram', async () => [new ProgramDay({ id: 40, program_id: 20, day_number: 1, title: 'A' })]);
  mock.method(ProgramExercise, 'findByDay', async () => [pe]);
  mock.method(TrainingProfile, 'findByUser', async () => null);
  mock.method(ExerciseSelector.prototype, 'suggestReplacement', async () => [replacement]);
  const update = mock.method(ProgramExercise.prototype, 'update', async () => {});

  await assert.rejects(ProgramController.replaceExercise(req({ id: '20', peId: '30' }, { exerciseId: '5' }), fakeRes()),
    { status: 400 });
  assert.equal(update.mock.callCount(), 0);

  const res = fakeRes();
  await ProgramController.replaceExercise(req({ id: '20', peId: '30' }, { exerciseId: '2' }), res);
  // Замена на упражнение с собственным весом обнуляет рабочий вес
  assert.deepEqual(update.mock.calls[0].arguments[0], { exerciseId: 2, workingWeight: 0 });
  assert.equal(res.redirectedTo, '/programs/20?replaced=1');
});

test('copyTemplate: неопубликованный шаблон не копируется; копия становится черновиком сеанса', async () => {
  const hidden = new Program(programRow({ id: 1, owner_id: null, is_template: true, status: 'DRAFT' }));
  mock.method(Program, 'findById', async () => hidden);
  const copyFor = mock.method(Program.prototype, 'copyFor', async () => new Program(programRow({ id: 21 })));
  await assert.rejects(ProgramController.copyTemplate(req({ id: '1' }), fakeRes()), { status: 404 });
  assert.equal(copyFor.mock.callCount(), 0);

  mock.restoreAll();
  const published = new Program(programRow({ id: 1, owner_id: null, is_template: true, status: 'ACTIVE' }));
  const previousDraft = new Program(programRow({ id: 19 }));
  mock.method(Program, 'findById', async (id) => (id === 1 ? published : previousDraft));
  mock.method(Program.prototype, 'copyFor', async () => new Program(programRow({ id: 21 })));
  const archive = mock.method(Program.prototype, 'archive', async () => {});
  const session = { draftProgramId: 19 };
  const res = fakeRes();
  await ProgramController.copyTemplate(req({ id: '1' }, {}, session), res);
  assert.equal(session.draftProgramId, 21);
  assert.equal(archive.mock.calls[0].this, previousDraft, 'прежний черновик — в архив');
  assert.equal(res.redirectedTo, '/programs/21');
});

test('generate: незаполненный профиль — переход к анкете', async () => {
  mock.method(TrainingProfile, 'findByUser', async () => null);
  const res = fakeRes();
  await ProgramController.generate(req(), res);
  assert.equal(res.redirectedTo, '/profile?required=1');
});

// ---------- AdminController: справочник ----------

const muscles = [new MuscleGroup({ id: 1, name: 'Грудь', antagonist_id: null })];

test('exerciseCreate: занятое название — 409 и сообщение у поля, медиа не сохраняются', async () => {
  mock.method(MuscleGroup, 'findAll', async () => muscles);
  mock.method(Exercise, 'create', async () => {
    throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'exercises_name_ak' });
  });
  const res = fakeRes();
  await AdminController.exerciseCreate({ body: { ...exerciseBody, secondaryMuscleIds: [] }, files: [], query: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.view, 'admin-exercise-form');
  assert.match(res.locals.errors.name, /уже есть/);
});

test('exerciseCreate: ошибка загрузки файла — форма с сообщением, упражнение не создаётся', async () => {
  mock.method(MuscleGroup, 'findAll', async () => muscles);
  const create = mock.method(Exercise, 'create', async () => null);
  const res = fakeRes();
  const uploadError = Object.assign(new Error('Допустимые форматы файлов: JPG, PNG, WEBP, MP4'), { status: 400 });
  await AdminController.exerciseCreate(
    { body: { ...exerciseBody, secondaryMuscleIds: [] }, files: [], uploadError, query: {} }, res);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(res.statusCode, 400);
  assert.match(res.locals.errors.media, /JPG/);
});

test('exerciseDeactivate: упражнение не удаляется, а деактивируется', async () => {
  const ex = new Exercise({ id: 3, name: 'Жим', primary_muscle_id: 1, equipment: 'штанга', difficulty: 1,
    technique: '', weight_step: 2.5, is_active: true });
  mock.method(Exercise, 'findById', async () => ex);
  const deactivate = mock.method(Exercise.prototype, 'deactivate', async () => {});
  const res = fakeRes();
  await AdminController.exerciseDeactivate({ params: { id: '3' } }, res);
  assert.equal(deactivate.mock.callCount(), 1);
  assert.match(res.redirectedTo, /done=deactivated/);
});
