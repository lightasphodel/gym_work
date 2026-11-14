/**
 * Меню-бургер шапки (смартфон, ширина ≤ 600 px).
 * Состояние хранится в aria-expanded кнопки; видимость меню задаёт CSS.
 */
const burger = document.querySelector('.burger');
const nav = burger && document.getElementById(burger.getAttribute('aria-controls'));

function setOpen(open) {
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}

if (burger && nav) {
  burger.addEventListener('click', () => {
    setOpen(burger.getAttribute('aria-expanded') !== 'true');
  });

  // Esc закрывает меню и возвращает фокус на кнопку.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      burger.focus();
    }
  });

  // Клик вне шапки закрывает меню.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.site-header')) setOpen(false);
  });

  // При переходе к планшетной ширине меню снова показывается в строку.
  window.matchMedia('(min-width: 601px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}
