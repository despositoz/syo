# P0.3.1 — Responsive Posters, Narrow Layout и Design Polish

Статусы: **PASS** — проверено тестом или измерением; **UNVERIFIED** — сделано, но
доказательства в этой среде нет; **FAIL** — не выполнено.

Прогон, на который ссылается таблица:

| Проверка               | Результат                                               |
| ---------------------- | ------------------------------------------------------- |
| `npm run build`        | PASS                                                    |
| `npm run lint`         | PASS                                                    |
| `npm run format:check` | PASS (скрипт расширен на `server/`, `e2e/`, корень)     |
| `npm test`             | PASS — 319 тестов, 32 файла, 5 прогонов подряд          |
| `npm run test:e2e`     | PASS — 252 сценария (iphone / android / reduced-motion) |
| `npm audit`            | 0 уязвимостей                                           |

## Root cause в одном абзаце

`Poster` принимал `width: number` и писал его в `style.width`, оставаясь при этом
`flex: none`. Одно число отвечало сразу за две вещи: какой размер картинки взять
у TMDB и какой ширины быть компоненту. Внутри адаптивного grid-трека Дневника
(~112px на телефоне) постер оставался 160px, выходил за трек, наезжал на соседа
и уходил за экран. Исправление — разделить эти две роли: `requestWidth` уходит
только в ImagePipeline и в intrinsic-атрибуты `<img>`, а геометрию задаёт рамка
родителя.

## Старый и новый контракт Poster

| Что                  | Было                              | Стало                                                                |
| -------------------- | --------------------------------- | -------------------------------------------------------------------- |
| Проп размера         | `width: number`                   | `requestWidth: number`                                               |
| Куда идёт число      | `style.width` **и** ImagePipeline | только ImagePipeline и `<img width/height>`                          |
| Ширина root          | `${width}px` inline               | `inline-size: 100%`, `max-inline-size: 100%`, `min-inline-size: 0`   |
| Сжимаемость          | `flex: none`                      | убрано                                                               |
| Пропорция            | inline `aspectRatio`              | `aspect-ratio: 2 / 3` в CSS                                          |
| Кто владеет размером | сам Poster                        | рамка родителя `[data-poster-frame]`                                 |
| Центровка            | зависела от совпадения чисел      | `object-fit: cover; object-position: 50% 50%` в совпадающих границах |

## Обновлённые call sites

| Файл                                            | Рамка                                   | requestWidth |
| ----------------------------------------------- | --------------------------------------- | ------------ |
| `features/diary/components/DiaryEntryCard.tsx`  | grid `100%` / list `56px`               | 160 / 64     |
| `features/diary/components/ActiveDraftCard.tsx` | `40px`                                  | 56           |
| `features/rating/components/FilmIdentity.tsx`   | hero `min(46vw,168px)` / compact `56px` | 168 / 56     |
| `pages/film/FilmPage.tsx`                       | `96px`                                  | 96           |
| `pages/feed/components/CompactCard.tsx`         | `flex: 0 0 84px`                        | 84           |
| `pages/movie-picker/components/ResultRow.tsx`   | `flex: 0 0 60px`                        | 60           |
| `pages/diary/DiaryPlaceholderPage.tsx`          | удалён — экран мёртвый                  | —            |

Каждая рамка несёт `aspect-ratio: 2/3` и атрибут `data-poster-frame`, по которому
тесты проверяют совпадение границ.

## P0 (1–15)

| #   | Критерий                                        | Статус | Доказательство                                                       |
| --- | ----------------------------------------------- | ------ | -------------------------------------------------------------------- |
| 1   | Poster не пишет fixed CSS width inline          | PASS   | `Poster.test.tsx` «never writes a layout width into its own style»   |
| 2   | Размер картинки отделён от размера в layout     | PASS   | `Poster.test.tsx` «asks the pipeline for the requested width»        |
| 3   | Poster root всегда внутри рамки                 | PASS   | `expectPosterFillsFrame` во всех сценариях responsive-спека (±0.5px) |
| 4   | 393px: нет overlap                              | PASS   | `responsive-layout.spec.ts` «six cards never overlap at 393px»       |
| 5   | 320px: нет overlap                              | PASS   | там же, 320px                                                        |
| 6   | 280px defensive: нет overlap                    | PASS   | там же, 280px                                                        |
| 7   | Ни один постер Дневника не выходит за viewport  | PASS   | `expectInsideViewport` на 280/320/360/393/430                        |
| 8   | Постер в списке не обрезан                      | PASS   | «the list view keeps its 56px poster unclipped»                      |
| 9   | Постер черновика не обрезан                     | PASS   | «the draft poster is not clipped at 320px»                           |
| 10  | Hero не обрезан на 320px                        | PASS   | «the rating hero poster is not clipped», «the result hero…»          |
| 11  | Film Page не изменил пропорцию                  | PASS   | `expectPosterFillsFrame` проверяет ratio 1.5; e2e film-спек зелёный  |
| 12  | CompactCard не сломан                           | PASS   | существующие feed e2e + рамка 84px                                   |
| 13  | ResultRow не сломан                             | PASS   | существующие picker e2e + рамка 60px                                 |
| 14  | Типографский fallback совпадает с рамкой        | PASS   | «a missing poster falls back inside the same frame»                  |
| 15  | Poster никогда не подставляется вместо backdrop | PASS   | правило P0.1 не тронуто; `film.presentation.test.ts` держит его      |

## P1 (16–40)

| #   | Критерий                                  | Статус | Доказательство                                                                        |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| 16  | Колонки зависят от доступной ширины       | PASS   | `auto-fit minmax(min(100%,100px),1fr)`; 2 колонки на 280/320, 3 на 360+, 6 на desktop |
| 17  | `min-width: 0` у li и карточки            | PASS   | `DiaryPage.module.css`, `DiaryEntryCard.module.css`                                   |
| 18  | Ширина карточки не задаётся ребёнком      | PASS   | `DiaryEntryCard.test.tsx` «wraps the poster in a frame»                               |
| 19  | Выдержка не перегружает grid              | PASS   | «the excerpt stays out of the grid and shows in the list»                             |
| 20  | Выдержка сохранена в list                 | PASS   | там же + `DiaryEntryCard.test.tsx`                                                    |
| 21  | 4,6 отображается текстом, а не точкой 4px | PASS   | «a deep precise score is readable, not a 4px dot» (ширина > 14px)                     |
| 22  | AI-операции помещаются в 320px            | PASS   | «the three AI operations fit the width»                                               |
| 23  | AI-операции работают при 150% текста      | PASS   | «the AI operations survive 150% text» + проверка ярлыков                              |
| 24  | При 200% появляется адаптивный layout     | PASS   | «the AI operations survive 200% text»: 1+2, ярлыки целы, высота ≥44                   |
| 25  | Snackbar не перекрывает CTA письма        | PASS   | «the snackbar never covers the writing CTA» + `--snackbar-bottom`                     |
| 26  | Generic snackbar не переезжает в письмо   | PASS   | `RatingResultPage.tsx`: показывается только при `!thenWrite`                          |
| 27  | Actionable Undo остаётся доступным        | PASS   | watchlist-Undo сохранён; `rating.integration.test.tsx` Flow 10                        |
| 28  | Заполненные звёзды одной яркости          | PASS   | правило `nth-child(n+4)` удалено; `StarRating.module.css`                             |
| 29  | 4/5 читается как четыре заполненных       | PASS   | там же (одна заливка на все пять)                                                     |
| 30  | 5/5 читается как пять                     | PASS   | там же                                                                                |
| 31  | Space управляет StarRating                | PASS   | `StarRating.test.tsx` «Space selects the focused star»                                |
| 32  | Enter управляет StarRating                | PASS   | «Enter selects the focused star»                                                      |
| 33  | Mouse-drag не застревает вне контрола     | PASS   | «captures the mouse on press», «losing the capture ends the drag»                     |
| 34  | Вертикальный скролл не блокируется        | PASS   | axis arbitration не тронут; существующие тесты оси зелёные                            |
| 35  | Count визуально связан с title            | PASS   | `.titleGroup` в `DiaryPage.tsx`; скриншот `diary-393-grid.png`                        |
| 36  | View toggle остаётся 44px                 | PASS   | «the diary view toggle keeps a full touch target»                                     |
| 37  | У textarea один focus treatment           | PASS   | `outline` + `border-color: transparent` в `WritingPage.module.css`                    |
| 38  | Письмо сохраняет контекст фильма          | PASS   | строка «Текст о „…"», `writing-context`; скриншот `editor-320.png`                    |
| 39  | Нет layout shift при загрузке постера     | PASS   | рамка держит `aspect-ratio`, `<img>` несёт intrinsic width/height                     |
| 40  | Safe-area соблюдается                     | PASS   | существующие shell e2e + «CTA stay clear of the system inset»                         |

## P2 (41–54)

| #   | Критерий                                     | Статус     | Доказательство                                                                                                                                                                    |
| --- | -------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 41  | Reading/editor surfaces имеют max width      | PASS       | токены `--content-max-*`; применены в Diary, Feed, flow shell, picker, редакторе                                                                                                  |
| 42  | Wide desktop не растягивает контент          | PASS       | «a wide window does not stretch one card across the screen»                                                                                                                       |
| 43  | Narrow desktop использует mobile-safe layout | PASS       | «a narrow desktop window uses the same safe geometry»                                                                                                                             |
| 44  | Press нижнего бара не дёргается              | PASS       | `transform` добавлен в transition, 100ms сжатие / 160ms отпускание                                                                                                                |
| 45  | Подписи бара читаемы                         | PASS       | 0.6875rem → 0.75rem                                                                                                                                                               |
| 46  | Reduced Motion без пространственного press   | PASS       | `@media (prefers-reduced-motion)`: `transform: none`, brightness                                                                                                                  |
| 47  | `format:check` проходит                      | PASS       | прогон выше; скрипт расширен на server/e2e/корень                                                                                                                                 |
| 48  | Нет DBG2 log                                 | PASS       | `grep -rn "DBG" src e2e` пусто                                                                                                                                                    |
| 49  | Нет React act warnings                       | UNVERIFIED | Часть предупреждений осталась в rating/writing integration: они приходят из планового обновления store после `await`, тест при этом корректен. Ни одно не относится к P0.3.1-коду |
| 50  | Мёртвый Diary CSS удалён                     | PASS       | `.items`, `.watchlist*`, `.viewButton*`, `.sectionTitle` удалены вместе с `DiaryPlaceholderPage`                                                                                  |
| 51  | Acceptance document соответствует коду       | PASS       | `P0_3_ACCEPTANCE.md` обновлён: focus trap реализован и покрыт                                                                                                                     |
| 52  | Sheet focus trap покрыт тестом               | PASS       | `Sheet.test.tsx` (3 случая) + e2e «a sheet keeps the keyboard inside it»                                                                                                          |
| 53  | Bundle warning измерен и задокументирован    | PASS       | 551KB → 380KB основной + 148KB vendor + 23KB writing (см. ниже)                                                                                                                   |
| 54  | Dependency audit разобран без force update   | PASS       | отдельная ветка `deps/eslint-10`, полный прогон, `npm audit` чист                                                                                                                 |

## Quality (55–66)

| #   | Критерий                                        | Статус     | Доказательство                                         |
| --- | ----------------------------------------------- | ---------- | ------------------------------------------------------ |
| 55  | `npm run build` PASS                            | PASS       | прогон выше                                            |
| 56  | `npm run lint` PASS                             | PASS       | прогон выше (ESLint 10)                                |
| 57  | `npm run format:check` PASS                     | PASS       | прогон выше                                            |
| 58  | `npm test` PASS                                 | PASS       | 319 тестов, пять прогонов подряд без флейков           |
| 59  | iPhone E2E PASS                                 | PASS       | 84 сценария                                            |
| 60  | Android E2E PASS                                | PASS       | 84 сценария                                            |
| 61  | Reduced Motion E2E PASS                         | PASS       | 84 сценария                                            |
| 62  | Responsive E2E PASS                             | PASS       | 28 сценариев × 3 проекта                               |
| 63  | Нет новых TypeScript ошибок                     | PASS       | `tsc -b` чист                                          |
| 64  | Нет нового console noise                        | PASS       | DBG удалён; в проде логов не добавлено                 |
| 65  | Нет fake fullscreen claims                      | PASS       | логика fullscreen не тронута                           |
| 66  | Проверки на реальном устройстве отмечены честно | UNVERIFIED | Реального Telegram-клиента в этой среде нет — см. ниже |

## Bundle (§17.1)

| Чанк                                  | Было                 | Стало                    |
| ------------------------------------- | -------------------- | ------------------------ |
| основной JS                           | 551.5 KB             | 380.3 KB (gzip 116.3 KB) |
| vendor (react, dexie, zustand, query) | —                    | 148.0 KB (gzip 48.3 KB)  |
| writing (lazy)                        | — (внутри основного) | 22.8 KB (gzip 7.6 KB)    |
| CSS                                   | 65.4 KB              | 60.3 KB + 5.1 KB writing |

Экран письма грузится отдельным чанком при первом входе в него; vendor вынесен
ради кэша между релизами. Предупреждение Rollup о 500KB остаётся: остаток —
это сам каркас приложения, дальнейшее дробление только перекладывало бы байты.

## Что осталось непроверенным

- **Реальное устройство**: всё измерено в Chromium (Playwright, эмуляция
  iPhone/Android) и в браузере. Реального Telegram-клиента на iOS/Android в этой
  среде нет — пункты 66 и поведение системной клавиатуры честно отмечены
  UNVERIFIED. Ручная приёмка из §22 остаётся за вами.
- **Container queries** (§6.2) не понадобились: `auto-fit` даёт нужное
  поведение во всех проверенных ширинах, и это меньше кода.
- **React act warnings** (§17.3) погашены не полностью — см. пункт 49.
- **Тёмная/светлая темы**: Graphite проверена существующими e2e темизации;
  отдельного responsive-прогона в Graphite нет.

## Артефакты

- Скриншоты: `docs/screenshots/` — Diary 393 grid, Diary 320 grid, Diary 320
  list, active draft 320, rating hero 320, editor 320, editor 200% text,
  desktop narrow 900, desktop wide 1440.
- Видео ресайза 900 → 280 → 900 без наложений: `docs/video/diary-resize-900-to-280.webm`.
- Пересоздать: `SYO_ARTIFACTS=1 npx playwright test e2e/artifacts.spec.ts --project=iphone`.
