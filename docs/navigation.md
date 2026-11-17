# Схема навигации (раздел 4.2.5)

Меню в шапке зависит от роли из сессии. На ширине больше 1100 px меню показывается в строку, на 1100 px и меньше открывается кнопкой-бургером. Логотип «Тренировочный дневник» ведёт на стартовую страницу роли: `/home` у пользователя, `/admin` у администратора, `/login` у гостя.

```mermaid
flowchart LR
  subgraph Гость
    login["/login<br>Вход"] <--> register["/register<br>Регистрация"]
  end

  login -- "роль USER" --> home
  login -- "роль ADMIN" --> admin

  subgraph Пользователь
    home["/home<br>Главная"]
    programs["/programs<br>Программа"]
    templates["/programs/templates<br>Шаблоны"]
    program["/programs/:id<br>Программа (черновик, правка)"]
    wnew["/workouts/new<br>Тренировка"]
    journal["/workouts<br>Журнал"]
    stats["/stats<br>Статистика"]
    ex["/exercises<br>Справочник"]
    exone["/exercises/:id<br>Упражнение"]
    rm["/tools/1rm<br>Калькулятор 1ПМ"]
    profile["/profile<br>Профиль"]

    home --> programs & journal & stats & rm & ex & profile
    programs --> templates --> program
    programs -- "Составить программу" --> program
    programs -- "Начать тренировку" --> wnew
    program -- "Активировать" --> programs
    wnew -- "после сохранения" --> programs
    journal --> wnew
    stats --> rm
    ex --> exone
    program --> exone
    profile -. "не заполнен" .-> programs
  end

  subgraph Администратор
    admin["/admin<br>Панель"]
    users["/admin/users<br>Пользователи"]
    aex["/admin/exercises<br>Справочник"]
    aexform["/admin/exercises/new, /:id/edit<br>Упражнение"]
    atpl["/admin/templates<br>Шаблоны"]
    atplnew["/admin/templates/new<br>Новый шаблон"]
    atplone["/admin/templates/:id<br>Шаблон"]
    abk["/admin/backups<br>Резервные копии"]
    admin --> users & aex & atpl & abk
    aex --> aexform
    atpl --> atplnew --> atplone
    atpl --> atplone
  end
```

## Меню по ролям

| Роль | Пункты меню (по порядку) |
|---|---|
| Гость | Вход, Регистрация |
| Пользователь | Программа, Тренировка, Журнал, Статистика, Упражнения, 1ПМ, Профиль, *логин* (только в меню-бургере), Выйти |
| Администратор | Панель, Пользователи, Упражнения, Шаблоны, Резервные копии, Выйти |

## Служебные страницы

- `403` — страница недоступна роли (например, пользователь открыл `/admin`).
- `404` — адрес не найден, упражнение, программа или тренировка не найдены либо принадлежат другому пользователю.
- `error` — запрос не выполнен (400, 409, 413, 500) с сообщением на русском языке.

Скриншоты всех страниц на 1440 / 820 / 375 px лежат в `docs/screenshots/` (имя файла: `<страница>-<ширина>.png`).
