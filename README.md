# SYO — Show Your Opinion

Telegram Mini App для личного киноархива: найти просмотренный фильм, отложить его
и — в следующих этапах — оценить и сохранить впечатление.

Это **greenfield-реализация версии 1.0**. Prototype A (одностраничный `app.js` в
`kino/webapp/`) не является её основой: из него взяты только знания о TMDB-запросах
и список ошибок, которые здесь не повторяются.

---

## Быстрый старт

```bash
npm install
```

Скопируй `.env.example` в `.env` и вставь TMDB-токен:

```bash
cp .env.example .env
```

```bash
npm run dev
```

Приложение откроется на `http://localhost:5173` (и по сети — на IP машины, чтобы
открыть с телефона).

---

## Переменные окружения

| Переменная                 | Обязательна | Описание                                                     |
| -------------------------- | ----------- | ------------------------------------------------------------ |
| `VITE_TMDB_API_KEY`        | да\*        | Ключ TMDB API v3 (read-only).                                |
| `VITE_TMDB_ACCESS_TOKEN`   | нет         | Токен TMDB v4 (Bearer). Если задан — используется вместо v3. |
| `VITE_TMDB_API_BASE`       | нет         | Другой базовый URL API (например, собственный прокси).       |
| `VITE_TMDB_IMAGE_BASE`     | нет         | Другой базовый URL картинок.                                 |
| `VITE_TMDB_LANGUAGE`       | нет         | Язык ответов TMDB. По умолчанию `ru-RU`.                     |

\* Нужен либо `VITE_TMDB_API_KEY`, либо `VITE_TMDB_ACCESS_TOKEN`. Без них
приложение запускается и показывает локальный кэш, а в Movie Picker выводит
понятное сообщение о ненастроенном токене — оно не ломает экран.

### Где взять TMDB-токен

1. Регистрация на https://www.themoviedb.org/.
2. Settings → API → Create → Developer.
3. Скопировать **API Key (v3 auth)** в `VITE_TMDB_API_KEY`.

`.env` в `.gitignore`. Ключ TMDB попадает в клиентский бандл — это допустимо
только для публичного read-only ключа. Приватные ключи так публиковать нельзя.

---

## Проверка в Telegram

1. `npm run build` → статика в `dist/`.
2. Выложить `dist/` на любой HTTPS-хостинг (GitHub Pages, Cloudflare Pages,
   Netlify). Telegram открывает только HTTPS.
3. В @BotFather: `/mybots` → бот → *Bot Settings* → *Menu Button* → указать URL.
4. Открыть бота в Telegram и нажать кнопку меню.

Локальная проверка на телефоне без деплоя: `npm run dev` слушает `0.0.0.0`, но
Telegram требует HTTPS — понадобится туннель (`cloudflared tunnel --url http://localhost:5173`
или аналог) и указание HTTPS-URL туннеля в BotFather.

### Fallback в обычном браузере

Приложение полностью работает без Telegram: `TelegramController` определяет
отсутствие WebApp SDK и переключает safe-area на `env(safe-area-inset-*)`,
высоту — на `100dvh`, режим chrome — на «свой back», haptics — в no-op.
Роутинг настоящий, ссылки вида `/film/693134` открываются напрямую.

---

## Скрипты

| Команда                 | Что делает                                          |
| ----------------------- | --------------------------------------------------- |
| `npm run dev`           | Дев-сервер Vite.                                    |
| `npm run build`         | Проверка типов + продакшн-сборка в `dist/`.         |
| `npm run preview`       | Локальный просмотр собранного бандла.               |
| `npm run lint`          | ESLint, включая архитектурные запреты (см. ниже).   |
| `npm run format`        | Prettier.                                           |
| `npm test`              | Vitest: unit + интеграционные (jsdom).              |
| `npm run test:watch`    | Vitest в watch-режиме.                              |
| `npm run test:e2e`      | Playwright E2E (сам собирает и поднимает preview).  |
| `npm run test:e2e:install` | Скачать Chromium для Playwright (один раз).      |

---

## Архитектура

```
src/
  app/            — оболочка: навигация, Telegram, тема, performance, сеть
  pages/          — экраны: feed, movie-picker, film, diary, profile
  entities/       — модели и репозитории: film, feed, watchlist
  shared/         — api/tmdb, ui, motion, haptics, images, storage, utils, types
  styles/         — reset, global, typography
```

### Слои и правила

**UI** отображает состояние и отправляет семантические действия. Он не знает
Telegram API, не знает IndexedDB, не строит URL для TMDB. Эти запреты не просто
договорённость — они проверяются ESLint-правилами для `src/pages/**` и
`src/shared/ui/**`: прямой `fetch`, `localStorage`, `window.Telegram`,
`querySelector` там дают ошибку линта.

**Repositories** (`entities/*/*.repository.ts`) объединяют локальный кэш и сеть,
нормализуют данные и возвращают модели приложения.

**Controllers** (`app/*`):

- `TelegramController` — единственный владелец Telegram WebApp API: `ready()`,
  `expand()`, версия и платформа, viewport, safe-area, fullscreen, BackButton,
  системные цвета, haptics. Публикует нормализованное состояние и CSS-переменные.
- `NavigationController` — стек маршрутов, history браузера, видимость
  Telegram BackButton, одноразовый запрос fullscreen, семантические haptics.
- `PerformanceController` — измеряет реальный ритм кадров и понижает
  «тир» декораций (parallax → blur → ambient), не трогая данные.
- `ConnectivityController` — online/offline и разбор очереди отложенных записей.
  Постоянной плашки «Offline» нет: индикатор (`shared/ui/SyncIndicator`)
  появляется только когда синхронизация идёт дольше 2,5 с или осталась реальная
  ошибка. Сам по себе офлайн ничего не показывает — приложение работает из
  IndexedDB.

**Stores** (Zustand): активный root-таб, стек маршрутов, состояние Telegram,
тема, watchlist, снекбар, performance-тир, сеть.

**Remote data** — TanStack Query. **Persistent data** — IndexedDB через Dexie
(`films`, `feed`, `presentations`, `watchlist`, `preferences`, `syncQueue`).

**Внешние данные** проходят через Zod — и сетевые ответы TMDB, и то, что читается
из IndexedDB: испорченная запись кэша не роняет экран, а просто считается
отсутствующей.

### Telegram-first: viewport и safe-area

Жёсткого верхнего отступа в 64 px нет нигде. `TelegramController` пишет в
`<html>`:

```
--tg-viewport-height   --safe-top/right/bottom/left
--content-safe-*       --tg-controls-keepout-right   --keyboard-height
```

`--content-safe-*` — **абсолютные** значения: `safeAreaInset + contentSafeAreaInset`.
Компонент применяет только одну переменную и не может учесть inset дважды.
Вне Telegram эти же переменные получают `env(safe-area-inset-*)`, поэтому
логика вёрстки не ветвится.

`--tg-controls-keepout-right` отодвигает правые элементы от кластера
close/menu, когда Telegram не зарезервировал под него вертикальную полосу.

### Два режима chrome

| Режим                          | Наша кнопка «назад» | Telegram BackButton |
| ------------------------------ | ------------------- | ------------------- |
| A. Fullscreen / обычный браузер | видима              | скрыт               |
| B. Telegram chrome              | не рендерится       | видим               |

Правило живёт в одном месте — компоненте `shared/ui/BackControl` плюс
`TelegramController.setBackButtonVisible()`. Двух кнопок «назад» одновременно
быть не может по построению.

### Film Presentation Preflight

`pages/film/film.presentation.ts` до отрисовки hero:
получает detailed-данные → выбирает logo-кандидата (`film.logo.ts`) → грузит и
декодирует его → проверяет контраст через canvas (`shared/images/logoClassifier.ts`)
→ выбирает режим logo/text → готовит preview постера и бэкдропа → возвращает
**замороженный** объект.

Пока решение не принято, заголовок не рисуется вовсе (в DOM остаётся только
доступный `<h1>` для скринридера). Поэтому текст не мелькает перед логотипом.
Если логотип не успел в бюджет (420 мс) — hero фиксируется на тексте до
следующего открытия; решение кэшируется в IndexedDB.

Тона логотипа: `light` — как есть; `dark-monochrome` — инвертируется;
`dark-colored` — обесцвечивается и осветляется; `unsafe` (в том числе
tainted canvas из-за CORS) — текстовый заголовок. Текстовый заголовок всегда
тёпло-белый и никогда не наследует цвет изображения.

### Параллакс

Считается в `requestAnimationFrame`, пишется прямо в `style.transform`.
React-состояние на кадр не обновляется.

- Лента: смещение считается от положения карточки во вьюпорте, а не от
  `scrollTop`; двигается только слой изображения, текст стоит; у изображения
  есть overscan, поэтому край не обнажается.
- Film Page: бэкдроп ~0.42 от обычной скорости, постер ~0.68 (быстрее бэкдропа),
  текст — 1.0, ambient следует за бэкдропом.
- Reduce Motion не выключает глубину полностью, а оставляет минимальную.

### Ошибки

Ошибка блока не заменяет экран: нет cast — блок исчезает; нет бэкдропа — макет
ведёт постер; нет логотипа — текст; нет постера — типографский fallback с
названием и годом (без иконки ошибки и без слова SYO); нет деталей — остаётся
кэш. Полноэкранная ошибка появляется только если нет ни локальных, ни сетевых
данных: «Не получилось загрузить информацию о фильме.» и кнопка «Повторить».

---

## Ограничения версии 1.0

- **Swipe-back намеренно отсутствует.** Нет edge-zone, pointer-хендлеров назад,
  GestureCoordinator, interactive progress, drag-transform, commit/cancel,
  velocity, клонов постера и page-to-poster morph при закрытии. Выход со
  страницы фильма — только кнопкой: своей в fullscreen, Telegram BackButton вне
  fullscreen. Временный переход: 190–220 мс, сдвиг вправо на 8 px, opacity → 0,
  `scale` всегда 1, нижний экран не масштабируется, blur не меняется, haptic нет.
  Этот переход нельзя называть Apple TV-like.
- Оценка, редактор записи, AI, полный Дневник, полный Профиль и social не
  реализованы. CTA «Начать оценку» показывает подпись «Следующий этап».
- Дневник и Профиль — качественные placeholder-экраны: Дневник показывает
  реально работающий список «Посмотреть позже», Профиль — выбор темы и честный
  статус среды.
- Серверной синхронизации нет: очередь `syncQueue` копится локально и
  разбирается no-op транспортом. Точка подключения бэкенда — `SyncTransport`
  в `app/connectivity/ConnectivityController.ts`.
- Из семантических haptic-событий в v1 реально срабатывают `tabSelection`,
  `movieOpen`, `bookmarkAdd`, `bookmarkRemove`, `refreshNewContent` и
  `criticalError`. `pullThreshold` объявлен и покрыт тестом, но не вызывается:
  pull-to-refresh как жест в этой версии не реализуется.
- Аватар в шапке ленты — заглушка, профиль Telegram не читается.
- Тема System маппится на Cinema (тёмная) / Graphite (светлее); отдельной
  светлой темы нет — иерархия важнее следования системе буквально.

---

## Тесты

```bash
npm test          # 123 unit + integration, 15 файлов
npm run test:e2e  # Playwright, 87 сценариев: iPhone, Android, Reduce Motion
```

Unit покрывают: маппер TMDB, выбор логотипа, классификатор контраста,
репозиторий watchlist, нормализацию Telegram-инсетов, разрешение темы,
HapticManager (cooldown/дедупликация/отключение), ImagePipeline, параметры
временного back-перехода, разбор очереди синхронизации и правила показа
индикатора.

Integration (jsdom, поверх реального `<App/>`): старт с кэшем, открытие
Movie Picker, поиск, открытие фильма, стабильность logo/text, закладка,
back (своей кнопкой и Telegram BackButton), офлайн-фильм, блочная ошибка.

E2E (Playwright, с моками TMDB и Telegram WebApp): fullscreen и non-fullscreen,
незакрытые controls, длинное название, отсутствующий постер, чёрный логотип,
медленный логотип, отсутствие логотипа, клавиатура, viewport Android и iPhone,
Reduce Motion.

---

## Следующий этап

Оценка фильма: экран критериев, слайдеры, пересчёт, сохранение записи в
IndexedDB и Дневник поверх этой оболочки. Отдельным этапом — интерактивный
Apple TV-like swipe-back, для которого специально оставлены: единая точка
выхода (`NavigationController.goBack`), стек маршрутов, отдельный слой страницы
в `AppShell` и параметризованные переходы в `shared/motion/transitions.ts`.
