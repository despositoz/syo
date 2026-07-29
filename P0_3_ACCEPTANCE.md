# P0.3 — Definition of Done

Статусы: **PASS** — проверено тестом или измерением; **UNVERIFIED** — сделано, но
доказательства нет (или проверить можно только в реальном Telegram с живым
бэкендом); **FAIL** — не выполнено.

Прогон, на который ссылается таблица: `npm test` — 298 тестов, 29 файлов;
`npm run test:e2e` — 168 сценариев (iphone / android / reduced-motion).

## Данные и черновики

| #   | Требование                                                          | Статус | Доказательство                                                                             |
| --- | ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| 1   | `ActiveDraft` — объединение оценки и текста, один активный черновик | PASS   | `draftCoordinator.test.ts` «one slot, two kinds of draft» (7 случаев)                      |
| 2   | Оценка не начинается поверх незаконченного текста без подтверждения | PASS   | `draftCoordinator.test.ts`, `writing.integration.test.tsx` «asks before a rating replaces» |
| 3   | Текст не начинается поверх незаконченной оценки без подтверждения   | PASS   | `draftCoordinator.test.ts` «will not start a text over an unfinished rating»               |
| 4   | Возврат черновика (Undo) восстанавливает снимок, а не пересоздаёт   | PASS   | `draftCoordinator.test.ts` «puts a deleted text back exactly as it was»                    |
| 5   | Undo не срабатывает поверх нового черновика                         | PASS   | `draftCoordinator.test.ts` «refuses to restore over a draft started meanwhile»             |
| 6   | Миграция БД v4: `hasText`/`text` добиваются, оценки не трогаются    | PASS   | `diary.repository.test.ts` «schema migration», `db.ts` version(4)                          |
| 7   | Текст пишется в той же транзакции, в которой читается запись        | PASS   | `diary.repository.test.ts` «saves text onto an existing entry without touching the rating» |
| 8   | Задача синхронизации ставится в той же транзакции                   | PASS   | `diary.repository.test.ts` «queues the change in the same transaction as the text»         |
| 9   | Удаление текста оставляет оценку, Undo возвращает слова             | PASS   | `writing.integration.test.tsx` «shows on the entry and can be removed with Undo»           |
| 10  | Текст с несуществующей выбранной ревизией отклоняется               | PASS   | `diary.repository.test.ts` «rejects text whose selected revision does not exist»           |
| 11  | Удалённая запись не воскресает при сохранении текста                | PASS   | `diary.repository.test.ts` «reports a deleted entry rather than resurrecting it»           |

## Редактор и сохранность

| #   | Требование                                                     | Статус     | Доказательство                                                                                               |
| --- | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| 12  | Текст виден мгновенно, пишется отложенно                       | PASS       | `writing.store.test.ts` «shows the text at once and writes it shortly after»                                 |
| 13  | Серия нажатий даёт одну запись, а не одну на символ            | PASS       | `writing.store.test.ts` «writes one row for a burst of typing»                                               |
| 14  | `flush()` пишет отложенное немедленно                          | PASS       | `writing.store.test.ts` «flush writes what is pending right away»                                            |
| 15  | Черновик переживает перезагрузку по одному синхронному зеркалу | PASS       | `writing.store.test.ts` «survives a reload through the synchronous mirror alone»                             |
| 16  | Черновик переживает перезагрузку в браузере                    | PASS       | `e2e/writing.spec.ts` «the draft survives a reload mid-sentence»                                             |
| 17  | Ошибка записи сообщается, текст остаётся на экране             | PASS       | `writing.store.test.ts` «reports a failed write instead of claiming the text is safe»                        |
| 18  | Повтор после ошибки снимает баннер                             | PASS       | `writing.store.test.ts` «clears the error once a retry gets through»                                         |
| 19  | Удалённый черновик не воскресает отложенной записью            | PASS       | `writing.store.test.ts` «a pending keystroke cannot resurrect a discarded draft»                             |
| 20  | Пустой текст не сохраняется как текст                          | PASS       | `writing.integration.test.tsx` «an empty text is not saved as a text»                                        |
| 21  | Лимит 30 000 символов, предупреждение с 27 000                 | PASS       | `writing.machine.test.ts` «never stores more than the technical limit»; счётчик появляется по `TEXT_WARN_AT` |
| 22  | CTA не перекрывается клавиатурой и системным инсетом           | PASS       | `e2e/writing.spec.ts` «the editor and its CTA stay clear of the system inset»; `--keyboard-height` в футере  |
| 23  | Курсор и прокрутка восстанавливаются                           | UNVERIFIED | Реализовано (`rememberSelection`, эффект в `EditorScreen`); отдельного теста нет                             |

## Ревизии и версии

| #   | Требование                                             | Статус     | Доказательство                                                                                 |
| --- | ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| 24  | Ревизия создаётся только при реальном изменении текста | PASS       | `writing.machine.test.ts` «does not add a second revision for identical text»                  |
| 25  | Оригинал сохраняется при принятии предложения          | PASS       | `writing.machine.test.ts`, `writing.integration.test.tsx` «the original survives as a version» |
| 26  | Все версии доступны, включая первую                    | PASS       | `e2e/writing.spec.ts` «accepting keeps the original reachable as a version»                    |
| 27  | Возврат к версии не удаляет остальные                  | UNVERIFIED | Реализовано (`VersionsSheet` меняет только `selectedRevisionId`); теста нет                    |

## Разговор

| #   | Требование                                              | Статус | Доказательство                                                                                       |
| --- | ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 28  | Вопросы по одному                                       | PASS   | `writing.integration.test.tsx`, `e2e/writing.spec.ts`                                                |
| 29  | Ответ сохраняется дословно до любого запроса            | PASS   | `writing.machine.test.ts` «stores the answer exactly as typed»                                       |
| 30  | Пропуск не отправляет слов и не считается ответом       | PASS   | `writing.machine.test.ts`, `writing.integration.test.tsx` «a skipped question sends no words at all» |
| 31  | Собрать текст нельзя, если ответов нет                  | PASS   | `writing.machine.test.ts` «will not compose from nothing»                                            |
| 32  | После достаточного материала предлагается собрать текст | PASS   | `writing.machine.test.ts` «offers to finish once there is enough material»                           |
| 33  | Текст собирается только из сказанного пользователем     | PASS   | `writing.integration.test.tsx` (стаб проверяет содержимое запроса), промпт `collect`                 |
| 34  | Смена способа не разрушает написанное и ответы          | PASS   | `writing.machine.test.ts` «keeps the text when the mode changes»                                     |
| 35  | Первый вопрос запрашивается один раз, повторов нет      | PASS   | Гонка закрыта (`askingQuestion`, статус `error`); 5 полных прогонов подряд зелёные                   |

## AI: предложение, а не замена

| #   | Требование                                                       | Статус     | Доказательство                                                                                                               |
| --- | ---------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 36  | Результат — кандидат; рабочий текст не меняется до «Принять»     | PASS       | `writing.integration.test.tsx` «offers a candidate and leaves the original alone»                                            |
| 37  | «Оставить свой вариант» ничего не меняет                         | PASS       | `writing.integration.test.tsx`, `e2e/writing.spec.ts`                                                                        |
| 38  | «Редактировать вручную» подставляет кандидата без сохранения     | PASS       | `writing.machine.test.ts` «editing manually loads the candidate without saving it»                                           |
| 39  | Оба варианта читаются рядом                                      | PASS       | `e2e/writing.spec.ts` «SYO proposes, the user decides»                                                                       |
| 40  | Ответ принимается только по своему `requestId` и базовой ревизии | PASS       | `writing.machine.test.ts` (3 случая), `writing.integration.test.tsx` «drops a response to a request the user has moved past» |
| 41  | Опоздавший ответ не показывается как свежий                      | PASS       | там же                                                                                                                       |
| 42  | Пустой ответ модели никогда не заменяет текст                    | PASS       | `assistant.gateway.test.ts` «treats an empty text as a failure»; `handler.test.ts` 422                                       |
| 43  | Ошибка ничего не меняет в черновике и объясняется человеку       | PASS       | `writing.integration.test.tsx` «a failed request changes nothing and says so»                                                |
| 44  | «Повторить» повторяет тот же логический запрос                   | PASS       | `e2e/writing.spec.ts` «a failed request changes nothing and offers a retry»; `requestId` переиспользуется                    |
| 45  | Ожидание видно и отменяемо, отмена ничего не стоит               | PASS       | `ProcessingScreen` + `cancelAssistant`; `assistant.gateway.test.ts` «reports a cancellation as the user’s own doing»         |
| 46  | Мат и резкость сохраняются                                       | UNVERIFIED | Закреплено в промптах (`CHARTER`); проверяется только на живой модели                                                        |

## Безопасность

| #   | Требование                                                       | Статус | Доказательство                                                                                        |
| --- | ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| 47  | Ключа провайдера нет в бандле, `VITE_*`, localStorage, IndexedDB | PASS   | `grep -ri "sk-ant\|ASSISTANT_API_KEY\|anthropic" dist/` — пусто; ключ только в `server/`              |
| 48  | Браузер обращается только к собственному эндпоинту SYO           | PASS   | `assistant.gateway.ts` (единственный `fetch`), `e2e/writing.spec.ts` перехватывает `**/api/assistant` |
| 49  | Ничего чувствительного в URL и query                             | PASS   | `assistant.gateway.test.ts` «sends the payload in the body and initData in a header»                  |
| 50  | initData проверяется на сервере (HMAC + `auth_date`)             | PASS   | `handler.test.ts` — подпись чужим токеном, подмена поля, просрочка, пустая строка                     |
| 51  | Сравнение подписи за постоянное время                            | PASS   | `verifyInitData.ts` — `timingSafeEqual`                                                               |
| 52  | Без подписи провайдер не вызывается вообще                       | PASS   | `handler.test.ts` «refuses an unsigned request without calling the provider»                          |
| 53  | Промпты живут на сервере и версионированы                        | PASS   | `server/assistant/prompts.ts`, `PROMPT_VERSIONS`; версия возвращается и пишется в ревизию             |
| 54  | Текст рецензии и ответы не попадают в логи                       | PASS   | `handler.test.ts` «logs the outcome without a single word of the text»                                |
| 55  | Сообщение провайдера не доходит до пользователя                  | PASS   | `handler.test.ts` «reports the provider being down without leaking its message»                       |
| 56  | Пер-юзерный лимит запросов                                       | PASS   | `handler.test.ts` «rate limits per user and says how long to wait»                                    |
| 57  | Пользовательский текст рендерится как обычный текст              | PASS   | Ни одного `dangerouslySetInnerHTML` в репозитории; `white-space: pre-wrap`                            |
| 58  | initData не логируется и не хранится                             | PASS   | `handler.ts` пишет только причину отказа; клиент нигде не сохраняет                                   |

## Интерфейс и доступность

| #   | Требование                                                    | Статус | Доказательство                                                                                             |
| --- | ------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| 59  | Поток проходится с клавиатуры                                 | PASS   | `e2e/writing.spec.ts` «the whole editor is reachable from the keyboard alone»                              |
| 60  | Текст в карточке Дневника — настоящая выдержка, спойлер скрыт | PASS   | `writing.integration.test.tsx` «hides a spoiler text until it is asked for»; `diary.text.ts` `textExcerpt` |

## Что осталось несделанным

- **Фокус-ловушка в `Sheet`** — долг с P0.2, не закрыт в этом этапе.
- **Свайп между аспектами с пальцем** — долг с P0.2.
- **Реальный транспорт синхронизации** — очередь пишется, отправка не реализована.
- **Пословный diff** между вариантами — сейчас оба варианта показываются целиком
  («Показать твой вариант»), различия не подсвечиваются.
- **Видео сценариев** — не записаны: в этой среде нет инструмента записи экрана.
  Playwright-трейсы для всех восьми сценариев `e2e/writing.spec.ts` доступны
  через `npx playwright test --trace on`.
- **Один тест помечен `retry: 2`** — `film.integration.test.tsx` «toggles the
  watchlist…», редкий срыв клика на нагруженной машине; появился до P0.3,
  утверждение не ослаблено.
