import { describe, expect, it } from 'vitest';
import {
  backTarget,
  canOpenAspect,
  canOpenResult,
  createDraft,
  firstIncompleteAspect,
  goToAspect,
  goToResult,
  hasProgress,
  nextStep,
  resumeTarget,
  setAspectScore,
  setQuickScore,
  upgradeToDetailed,
} from './rating.machine';
import type { FilmSnapshot, RatingDraft } from './rating.types';

const film: FilmSnapshot = {
  filmId: 42,
  title: 'Тестовый фильм',
  updatedAt: '2026-07-26T10:00:00.000Z',
};

const detailedDraft = (): RatingDraft => createDraft({ film, mode: 'detailed' });
const quickDraft = (): RatingDraft => createDraft({ film, mode: 'quick' });

describe('draft creation', () => {
  it('starts a quick draft on the quick screen with no score', () => {
    const draft = quickDraft();
    expect(draft.mode).toBe('quick');
    expect(draft.currentScreen).toBe('quick');
    expect(draft.quickScore).toBeNull();
    expect(hasProgress(draft)).toBe(false);
  });

  it('starts a detailed draft on the first aspect with nothing rated', () => {
    const draft = detailedDraft();
    expect(draft.currentAspect).toBe('story');
    expect(draft.currentScreen).toBe('aspect');
    expect(Object.values(draft.aspects).every((value) => value === null)).toBe(true);
  });

  it('carries existing values when editing an entry', () => {
    const draft = createDraft({
      film,
      mode: 'quick',
      editingEntryId: 'entry-1',
      quickScore: 4,
    });
    expect(draft.editingEntryId).toBe('entry-1');
    expect(draft.quickScore).toBe(4);
  });

  it('bumps the revision on every commit so the mirror can win', () => {
    const draft = quickDraft();
    const next = setQuickScore(draft, 3);
    expect(next.revision).toBe(draft.revision + 1);
    expect(next.updatedAt >= draft.updatedAt).toBe(true);
  });
});

describe('aspect progression', () => {
  it('cannot skip an unrated aspect', () => {
    const draft = detailedDraft();
    expect(canOpenAspect(draft, 'directionVisual')).toBe(false);
    expect(goToAspect(draft, 'directionVisual')).toBe(draft);
    // nextStep also refuses while the current aspect has no value.
    expect(nextStep(draft).currentAspect).toBe('story');
  });

  it('advances to the next aspect once the current one is rated', () => {
    const draft = nextStep(setAspectScore(detailedDraft(), 'story', 4));
    expect(draft.currentAspect).toBe('performance');
  });

  it('treats a deliberate zero as a rated aspect', () => {
    const draft = nextStep(setAspectScore(detailedDraft(), 'story', 0));
    expect(draft.currentAspect).toBe('performance');
    expect(firstIncompleteAspect(draft.aspects)).toBe('performance');
  });

  it('can return to a completed aspect', () => {
    let draft = nextStep(setAspectScore(detailedDraft(), 'story', 4));
    draft = goToAspect(draft, 'story');
    expect(draft.currentAspect).toBe('story');
    expect(draft.aspects.story).toBe(4);
  });

  it('reaches the result only after all five', () => {
    let draft = detailedDraft();
    expect(canOpenResult(draft)).toBe(false);
    expect(goToResult(draft)).toBe(draft);

    for (const id of ['story', 'performance', 'directionVisual', 'soundMusic'] as const) {
      draft = nextStep(setAspectScore(draft, id, 4));
      expect(canOpenResult(draft)).toBe(false);
    }
    draft = nextStep(setAspectScore(draft, 'aftertaste', 5));
    expect(canOpenResult(draft)).toBe(true);
    expect(draft.currentScreen).toBe('result');
  });

  it('reaches the quick result once a score is chosen', () => {
    expect(canOpenResult(quickDraft())).toBe(false);
    const draft = nextStep(setQuickScore(quickDraft(), 0));
    expect(draft.currentScreen).toBe('result');
  });
});

describe('back semantics', () => {
  it('goes to the previous aspect, then to the mode selector', () => {
    const draft = nextStep(setAspectScore(detailedDraft(), 'story', 3));
    expect(backTarget(draft)).toEqual({ kind: 'aspect', aspectId: 'story' });
    expect(backTarget(goToAspect(draft, 'story'))).toEqual({ kind: 'mode' });
  });

  it('returns from the quick result to the quick screen', () => {
    const draft = nextStep(setQuickScore(quickDraft(), 4));
    expect(backTarget(draft)).toEqual({ kind: 'quick' });
  });

  it('returns from the detailed result to the last aspect', () => {
    let draft = detailedDraft();
    for (const id of [
      'story',
      'performance',
      'directionVisual',
      'soundMusic',
      'aftertaste',
    ] as const) {
      draft = nextStep(setAspectScore(draft, id, 4));
    }
    expect(backTarget(draft)).toEqual({ kind: 'aspect', aspectId: 'aftertaste' });
  });
});

describe('quick → detailed', () => {
  it('keeps the quick score as history and out of the formula', () => {
    const draft = upgradeToDetailed(setQuickScore(quickDraft(), 5));
    expect(draft.mode).toBe('detailed');
    expect(draft.previousQuickScore).toBe(5);
    expect(draft.quickScore).toBeNull();
    expect(Object.values(draft.aspects).every((value) => value === null)).toBe(true);
  });
});

describe('resuming', () => {
  it('returns to the aspect the draft was parked on', () => {
    let draft = nextStep(setAspectScore(detailedDraft(), 'story', 4));
    draft = nextStep(setAspectScore(draft, 'performance', 3));
    expect(resumeTarget(draft)).toEqual({ screen: 'aspect', aspectId: 'directionVisual' });
  });

  it('never opens a result that the data cannot support', () => {
    const broken: RatingDraft = { ...detailedDraft(), currentScreen: 'result' };
    expect(resumeTarget(broken)).toEqual({ screen: 'aspect', aspectId: 'story' });
  });

  it('opens the result when it is genuinely complete', () => {
    let draft = detailedDraft();
    for (const id of [
      'story',
      'performance',
      'directionVisual',
      'soundMusic',
      'aftertaste',
    ] as const) {
      draft = nextStep(setAspectScore(draft, id, 4));
    }
    expect(resumeTarget(draft)).toEqual({ screen: 'result' });
  });
});
