import { describe, expect, it } from 'vitest';
import {
  backTargetFrom,
  canOpenResult,
  canOpenStep,
  createDraft,
  draftProgressLabel,
  firstIncompleteStep,
  flowStateOf,
  goToStep,
  hasProgress,
  nextStep,
  resumeTarget,
  setAspectRating,
  setMode,
  setQuickRating,
  type RatingFilmSummary,
} from './rating.machine';
import type { RatingDraft } from './rating.types';

const film: RatingFilmSummary = {
  filmId: 42,
  filmTitle: 'Тестовый фильм',
  posterPath: '/poster.jpg',
  backdropPath: null,
  releaseYear: '2026',
};

const deepDraft = (): RatingDraft => setMode(createDraft({ film }), 'deep');
const quickDraft = (): RatingDraft => setMode(createDraft({ film }), 'quick');

describe('draft creation', () => {
  it('starts with no mode and nothing rated', () => {
    const draft = createDraft({ film });
    expect(draft.mode).toBeNull();
    expect(draft.quickRating).toBeNull();
    expect(draft.status).toBe('active');
    expect(hasProgress(draft)).toBe(false);
    expect(flowStateOf(draft)).toBe('chooseMode');
  });

  it('carries the film through, so the flow works offline', () => {
    const draft = createDraft({ film });
    expect(draft.filmId).toBe(42);
    expect(draft.filmTitle).toBe('Тестовый фильм');
    expect(draft.posterPath).toBe('/poster.jpg');
    expect(draft.releaseYear).toBe('2026');
  });

  it('carries existing values when editing an entry', () => {
    const draft = createDraft({ film, mode: 'quick', editingEntryId: 'entry-1', quickRating: 4 });
    expect(draft.editingEntryId).toBe('entry-1');
    expect(draft.quickRating).toBe(4);
  });

  it('bumps the revision on every commit so the mirror can win', () => {
    const draft = quickDraft();
    const next = setQuickRating(draft, 3);
    expect(next.revision).toBe(draft.revision + 1);
  });
});

describe('deep steps', () => {
  it('cannot skip an unanswered step', () => {
    const draft = deepDraft();
    expect(canOpenStep(draft, 2)).toBe(false);
    expect(goToStep(draft, 2)).toBe(draft);
    // nextStep also refuses while the current step has no value.
    expect(nextStep(draft)).toBe(0);
  });

  it('advances once the current step is answered', () => {
    const draft = setAspectRating(deepDraft(), 'story', 4);
    expect(nextStep(draft)).toBe(1);
  });

  it('can return to an answered step', () => {
    let draft = setAspectRating(deepDraft(), 'story', 4);
    draft = goToStep(draft, 1);
    draft = setAspectRating(draft, 'characters', 3);
    expect(canOpenStep(draft, 0)).toBe(true);
    expect(goToStep(draft, 0).currentStep).toBe(0);
  });

  it('reaches the result only after all five', () => {
    let draft = deepDraft();
    for (const [step, id] of (['story', 'characters', 'direction', 'sound'] as const).entries()) {
      draft = setAspectRating(goToStep(draft, step), id, 4);
      expect(canOpenResult(draft)).toBe(false);
    }
    draft = setAspectRating(goToStep(draft, 4), 'aftertaste', 5);
    expect(canOpenResult(draft)).toBe(true);
    expect(nextStep(draft)).toBe('result');
  });

  it('points at the first gap', () => {
    let draft = setAspectRating(deepDraft(), 'story', 4);
    draft = setAspectRating(goToStep(draft, 1), 'characters', 4);
    expect(firstIncompleteStep(draft.aspects)).toBe(2);
  });
});

describe('quick', () => {
  it('reaches the result as soon as a star is chosen', () => {
    expect(canOpenResult(quickDraft())).toBe(false);
    const draft = setQuickRating(quickDraft(), 4);
    expect(canOpenResult(draft)).toBe(true);
    expect(nextStep(draft)).toBe('result');
  });
});

describe('back semantics', () => {
  it('mode goes back to the film page', () => {
    expect(backTargetFrom(createDraft({ film }), 'mode')).toEqual({ kind: 'film' });
  });

  it('quick goes back to the mode screen', () => {
    expect(backTargetFrom(quickDraft(), 'quick')).toEqual({ kind: 'mode' });
  });

  it('deep step 1 goes to mode, step N to the previous step', () => {
    const first = deepDraft();
    expect(backTargetFrom(first, 'deep')).toEqual({ kind: 'mode' });

    const third = { ...first, currentStep: 2 };
    expect(backTargetFrom(third, 'deep')).toEqual({ kind: 'step', step: 1 });
  });

  it('result goes back to the last rating screen', () => {
    expect(backTargetFrom(quickDraft(), 'result')).toEqual({ kind: 'quick' });
    expect(backTargetFrom(deepDraft(), 'result')).toEqual({ kind: 'step', step: 4 });
  });
});

describe('resuming', () => {
  it('returns to the step the draft was left on', () => {
    let draft = setAspectRating(deepDraft(), 'story', 4);
    draft = setAspectRating(goToStep(draft, 1), 'characters', 3);
    draft = goToStep(draft, 2);
    expect(resumeTarget(draft)).toEqual({ screen: 'deep', step: 2 });
  });

  it('opens the mode screen when no mode was chosen', () => {
    expect(resumeTarget(createDraft({ film }))).toEqual({ screen: 'mode' });
  });

  it('never opens a step the data cannot support', () => {
    // A stored step past the answers falls back to the first real gap.
    const broken: RatingDraft = { ...deepDraft(), currentStep: 4 };
    expect(resumeTarget(broken)).toEqual({ screen: 'deep', step: 0 });
  });

  it('opens the result when all five are in', () => {
    let draft = deepDraft();
    for (const [step, id] of (
      ['story', 'characters', 'direction', 'sound', 'aftertaste'] as const
    ).entries()) {
      draft = setAspectRating(goToStep(draft, step), id, 4);
    }
    expect(resumeTarget(draft)).toEqual({ screen: 'result' });
  });
});

describe('progress label', () => {
  it('describes how far a draft got', () => {
    expect(draftProgressLabel(createDraft({ film }))).toBe('Режим не выбран');
    expect(draftProgressLabel(quickDraft())).toBe('Оценка не выбрана');
    expect(draftProgressLabel(setQuickRating(quickDraft(), 4))).toBe('Осталось сохранить');
    expect(draftProgressLabel(setAspectRating(deepDraft(), 'story', 4))).toBe('1 из 5');
  });
});
