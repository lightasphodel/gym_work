/**
 * Просмотр медиафайлов упражнения: клик по элементу галереи открывает
 * окно dialog.viewer с изображением или видео. Закрытие — кнопкой «Закрыть» или Esc.
 */
const viewer = document.getElementById('media-viewer');
const body = document.getElementById('media-viewer-body');
const caption = document.getElementById('media-viewer-caption');

if (viewer && body) {
  for (const item of document.querySelectorAll('.gallery__item')) {
    item.addEventListener('click', () => {
      const isVideo = item.dataset.type === 'video';
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.src = item.dataset.src;
      if (isVideo) {
        media.controls = true;
        media.autoplay = true;
      } else {
        media.alt = item.querySelector('img')?.alt ?? '';
      }
      body.replaceChildren(media);
      caption.textContent = item.querySelector('.gallery__caption')?.textContent ?? '';
      viewer.showModal();
    });
  }

  // После закрытия видео останавливается и окно очищается.
  viewer.addEventListener('close', () => body.replaceChildren());
}
