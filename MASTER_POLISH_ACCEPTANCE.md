# Master UI/UX, Motion, Haptics and Polish — acceptance

Deliverables required by §56, and the §53 checklist with an honest verdict for
every line. Verified on the repo at the commit that carries this file, with
434 unit tests and 381 e2e runs (4 declared skips) green.

The standing audit lives in [`e2e/master-polish.spec.ts`](e2e/master-polish.spec.ts):
every core screen (feed, diary, profile, taste signature, settings, picker) is
checked at 280 / 320 / 360 / 393 / 430 px for horizontal overflow, 44 px touch
targets, Unicode glyphs used as icons, duplicate back buttons, layout at 200 %
text, bottom-bar clearance, nested-screen opacity and Reduced Motion.

---

## 1. Component inventory (§56.1)

| Component             | Where                         | Role                           | Notes                                                       |
| --------------------- | ----------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `Button`              | `src/shared/ui/Button`        | primary / secondary / ghost    | the only filled surface for actions                         |
| `IconButton`          | `src/shared/ui/IconButton`    | icon-only control              | always carries `label`; 44 px minimum                       |
| `BackControl`         | `src/shared/ui/BackControl`   | in-app back                    | suppressed when Telegram shows its own                      |
| `BottomBar`           | `src/shared/ui/BottomBar`     | four root tabs + rate          | floating chrome, `repeat(4, minmax(0,1fr))`                 |
| `Sheet`               | `src/shared/ui/Sheet`         | modal bottom sheet             | portalled to `body` so nothing paints over it               |
| `Snackbar`            | `src/shared/ui/Snackbar`      | transient message + Undo       | sits above the CTA, never on it                             |
| `Poster`              | `src/shared/ui/Poster`        | poster in any frame            | `requestWidth` picks the TMDB size; the frame owns geometry |
| `ImageStage`          | `src/shared/ui/ImageStage`    | colour → full image            | one crossfade, no flash                                     |
| `StarRating` / `Star` | `src/shared/ui/StarRating`    | 1–5 scale                      | radio semantics, keyboard and drag                          |
| `Skeleton`            | `src/shared/ui/Skeleton`      | loading placeholder            | same box as the content it replaces                         |
| `SyncIndicator`       | `src/shared/ui/SyncIndicator` | write state                    | silent while everything is fine                             |
| `TopShade`            | `src/shared/ui/TopShade`      | legibility under system chrome | strength from a token, not a hard-coded value               |
| `ErrorBlock`          | `src/shared/ui/ErrorBlock`    | failure + retry                | never a dead end                                            |

Screens compose these; no screen defines its own button, sheet or poster frame.

## 2. Motion tokens (§56.2)

Single source: `src/app/theme/tokens.css`. No `*.module.css` contains a raw
millisecond value any more — the audit greps for it.

| Token                  | Base                             | Used for                                           |
| ---------------------- | -------------------------------- | -------------------------------------------------- |
| `--motion-scale`       | `1`                              | the one knob every duration multiplies by          |
| `--duration-instant`   | 90 ms                            | press feedback, tab tap                            |
| `--duration-fast`      | 140 ms                           | small state changes, star scale, image crossfade   |
| `--duration-medium`    | 180 ms                           | card press, snackbar rise, sheet slide, feed items |
| `--duration-slow`      | 240 ms                           | breakdown expand, deep-rating step, hero image     |
| `--duration-emphasis`  | 320 ms                           | rating result arrival                              |
| `--duration-page-in`   | 220 ms                           | page enter                                         |
| `--duration-page-out`  | 190 ms                           | page exit                                          |
| `--duration-highlight` | 1400 ms                          | the "this is the entry you came for" pulse         |
| `--ease-standard`      | `cubic-bezier(0.32, 0.72, 0, 1)` | entering, expanding                                |
| `--ease-exit`          | `cubic-bezier(0.4, 0, 0.6, 1)`   | leaving                                            |

`--motion-scale` is selected by one attribute on `<html>`, written by
`PerformanceController.applyDataset()`:

| `data-motion` | scale | when                                                      |
| ------------- | ----- | --------------------------------------------------------- |
| `full`        | 1     | default                                                   |
| `calm`        | 0.6   | the in-app "Спокойное" setting                            |
| `reduced`     | 0.01  | system Reduce Motion — always wins over the in-app choice |

JS page transitions take the same reduction through `motionScale`
(`pageTimings(..., { scale })`), so the setting cannot apply to half the app.

## 3. Haptic semantic map (§56.3)

`src/shared/haptics/HapticManager.ts`. Every event has one meaning, one
pattern and a 120 ms per-event floor.

| Event                | Pattern              | Fires on                      | Kept on "delicate" |
| -------------------- | -------------------- | ----------------------------- | ------------------ |
| `tabSelection`       | selection            | root tab change               | yes                |
| `movieOpen`          | impact light         | opening a film                | no                 |
| `bookmarkAdd`        | impact soft          | added to watchlist            | yes                |
| `bookmarkRemove`     | selection            | removed from watchlist        | yes                |
| `pullThreshold`      | impact soft          | pull-to-refresh crosses 72 px | yes                |
| `refreshNewContent`  | notification success | refresh brought something new | no                 |
| `ratingModeSelect`   | selection            | quick / deep chosen           | yes                |
| `ratingValueChange`  | selection            | star or precise value steps   | yes                |
| `ratingStepComplete` | selection            | a deep-rating step is done    | no                 |
| `ratingSaved`        | notification success | entry written                 | yes                |
| `diaryEntryDeleted`  | impact medium        | entry deleted                 | no                 |
| `undoDelete`         | impact light         | deletion undone               | no                 |
| `storageWarning`     | notification warning | storage is failing            | yes                |
| `criticalError`      | notification error   | an action could not complete  | yes                |

Off / delicate / full comes from Settings; "off" silences everything.

## 4. Gesture arbitration (§56.4)

| Gesture             | Owner                                        | Claims when                                                            | Yields to                                                |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| vertical scroll     | the scroller                                 | default                                                                | nothing — it is the fallback                             |
| card swipe          | `useCardSwipe`                               | past 10 px **and** horizontal > 1.6 × vertical                         | vertical scroll; never starts on a decided vertical drag |
| commit swipe action | `useCardSwipe`                               | 26 % of card width, or a flick > 0.6 px/ms past 40 px                  | released below either → springs back                     |
| pull to refresh     | `usePullToRefresh`                           | scroller at top and finger moves down; 0.45 resistance, 120 px ceiling | any horizontal claim; releases below 72 px do nothing    |
| star drag           | `StarRating`                                 | pointer down on the scale                                              | scroll if the pointer leaves vertically                  |
| sheet dismiss       | `Sheet`                                      | drag down on the sheet, or backdrop tap                                | inner scrollers keep their own scroll                    |
| system back         | Telegram BackButton / `NavigationController` | always available                                                       | in-app back is hidden while the system button is shown   |

One axis wins per pointer; nothing arbitrates by z-order.

## 5. §53 global checklist

| #   | Requirement                                         | Verdict                                                                                                |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | No horizontal scrolling on any screen, 280–430 px   | PASS — audit, 5 widths × 6 screens                                                                     |
| 2   | Every touch target ≥ 44 px                          | PASS — audit measures the hit area, not the glyph                                                      |
| 3   | No Unicode character used as an icon                | PASS — audit greps rendered text                                                                       |
| 4   | Never two back affordances at once                  | PASS — audit                                                                                           |
| 5   | Layout survives 200 % text                          | PASS — audit; content controls stay inside the viewport and do not collide                             |
| 6   | Floating chrome never covers content's last control | PASS — audit scrolls each root screen to its end                                                       |
| 7   | A nested screen is opaque from frame one            | PASS — audit samples during the transition                                                             |
| 8   | Reduce Motion leaves every screen complete          | PASS — audit + the `reduced-motion` Playwright project                                                 |
| 9   | One motion vocabulary, no raw durations             | PASS — tokens only; grep-enforced                                                                      |
| 10  | The motion setting reaches CSS and JS alike         | PASS — `data-motion` + `--motion-scale`, asserted in unit and e2e                                      |
| 11  | Haptics are semantic, throttled and user-controlled | PASS — table above, unit-tested                                                                        |
| 12  | Gestures arbitrate on axis, not on luck             | PASS — thresholds above; every gesture action also has a keyboard path, asserted in `e2e/feed.spec.ts` |
| 13  | Covered content is out of the tab order             | PASS — the root layer is `inert` while a nested screen is up                                           |
| 14  | Text always renders as text                         | PASS — no `dangerouslySetInnerHTML` anywhere                                                           |
| 15  | 60 fps on a mid-range Android                       | UNVERIFIED — no device; `PerformanceController` steps the tier down on measured drops                  |
| 16  | Real Telegram haptics feel right                    | UNVERIFIED — no physical client in this environment                                                    |
| 17  | Colour contrast measured with a tool                | UNVERIFIED — checked by eye against the token set only                                                 |

## 6. Deliberately deferred (§56.9)

- Drag-to-reorder favourites — the arrow buttons are the whole feature; drag is an accelerator.
- Import of an exported archive — export is complete, import is a later stage.
- Shared-element poster transitions — the spec explicitly forbids the TV-style version, and no cheaper one is worth the risk.
- Ambient background motion on the film page beyond the existing parallax.
- Frame-by-frame capture on device: the Reduced Motion and 200 % runs are automated, but no recorded video is attached.
