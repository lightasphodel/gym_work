/**
 * Приём медиафайлов упражнений (ФТ-13): multer, хранение в памяти —
 * содержимое файла затем сохраняется в БД (exercise_media.data, BYTEA).
 */
import path from 'node:path';
import multer from 'multer';
import { HttpError } from './errorHandler.js';

/** Максимальный размер одного файла — 10 МБ. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Максимальное число файлов в одном запросе. */
export const MAX_FILES = 10;

const FORMAT_MESSAGE = 'Допустимые форматы файлов: JPG, PNG, WEBP, MP4';
const SIZE_MESSAGE = 'Размер файла не должен превышать 10 МБ';

/** Допустимые форматы: MIME-тип → расширения и вид медиафайла (exercise_media.media_type). */
const FORMATS = {
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], mediaType: 'image' },
  'image/png': { extensions: ['.png'], mediaType: 'image' },
  'image/webp': { extensions: ['.webp'], mediaType: 'image' },
  'video/mp4': { extensions: ['.mp4'], mediaType: 'video' },
};

/**
 * Проверка сигнатуры (первых байтов) файла: MIME-тип, присланный браузером,
 * можно подменить, а содержимое — нет.
 * @param {Buffer} buf
 * @param {string} mimeType
 */
function hasSignature(buf, mimeType) {
  const ascii = (start, end) => buf.subarray(start, end).toString('latin1');
  switch (mimeType) {
    case 'image/jpeg':
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4':
      return buf.length >= 12 && ascii(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/** Отбор по MIME-типу и расширению до приёма содержимого. */
function fileFilter(req, file, cb) {
  const format = FORMATS[file.mimetype];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!format || !format.extensions.includes(ext)) {
    return cb(new HttpError(400, FORMAT_MESSAGE));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter,
});

/** Перевод ошибок multer в сообщения для пользователя. */
function toHttpError(err) {
  if (!(err instanceof multer.MulterError)) return err;
  if (err.code === 'LIMIT_FILE_SIZE') return new HttpError(413, SIZE_MESSAGE);
  if (err.code === 'LIMIT_FILE_COUNT') return new HttpError(400, `Можно загрузить не более ${MAX_FILES} файлов`);
  return new HttpError(400, 'Не удалось принять файл. Проверьте поле формы и повторите попытку');
}

/**
 * Промежуточное ПО загрузки медиафайлов из поля формы field (multipart/form-data).
 * Результат — req.files: [{ originalname, mimetype, size, buffer, mediaType }],
 * где mediaType — 'image' | 'video'.
 * @param {string} field имя поля формы
 */
export function uploadMedia(field) {
  const receive = upload.array(field, MAX_FILES);
  return (req, res, next) => {
    receive(req, res, (err) => {
      if (err) return next(toHttpError(err));
      for (const file of req.files ?? []) {
        if (!hasSignature(file.buffer, file.mimetype)) {
          return next(new HttpError(400, `Файл «${file.originalname}» повреждён или не соответствует формату. ${FORMAT_MESSAGE}`));
        }
        file.mediaType = FORMATS[file.mimetype].mediaType;
      }
      next();
    });
  };
}

/**
 * Вариант uploadMedia для HTML-форм: ошибка проверки файла (формат, размер, сигнатура)
 * не прерывает запрос, а сохраняется в req.uploadError, чтобы контроллер показал её
 * у поля формы. Принятые до ошибки поля формы доступны в req.body.
 * @param {string} field имя поля формы
 */
export function uploadMediaForForm(field) {
  const receive = uploadMedia(field);
  return (req, res, next) => {
    receive(req, res, (err) => {
      if (err && err.status >= 400 && err.status < 500) {
        req.uploadError = err;
        req.files = [];
        return next();
      }
      next(err);
    });
  };
}
