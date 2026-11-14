import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// errorHandler импортирует конфигурацию, которая требует SESSION_SECRET.
process.env.SESSION_SECRET ??= 'test-secret';
const { uploadMedia, MAX_FILE_SIZE } = await import('../src/middleware/upload.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(8)]);

let server;
let url;

before(async () => {
  const app = express();
  app.post('/api/upload', uploadMedia('files'), (req, res) => {
    res.json(req.files.map((f) => ({ name: f.originalname, mediaType: f.mediaType, size: f.size })));
  });
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/api/upload`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function send(files) {
  const form = new FormData();
  for (const [content, name, type] of files) {
    form.append('files', new Blob([content], { type }), name);
  }
  return fetch(url, { method: 'POST', body: form });
}

test('upload: PNG и MP4 принимаются, mediaType = image / video', async () => {
  const res = await send([
    [PNG, 'press.png', 'image/png'],
    [MP4, 'press.mp4', 'video/mp4'],
  ]);
  assert.equal(res.status, 200);
  assert.deepEqual(
    (await res.json()).map((f) => f.mediaType),
    ['image', 'video'],
  );
});

test('upload: недопустимый формат (.txt) → 400', async () => {
  const res = await send([[Buffer.from('hello'), 'notes.txt', 'text/plain']]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /JPG, PNG, WEBP, MP4/);
});

test('upload: расширение не соответствует MIME-типу → 400', async () => {
  const res = await send([[PNG, 'image.gif', 'image/png']]);
  assert.equal(res.status, 400);
});

test('upload: содержимое не PNG при типе image/png → 400', async () => {
  const res = await send([[Buffer.from('<?php echo 1; ?>'), 'shell.png', 'image/png']]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /не соответствует формату/);
});

test('upload: файл больше 10 МБ → 413', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_SIZE)]);
  const res = await send([[big, 'big.png', 'image/png']]);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /10 МБ/);
});
