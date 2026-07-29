import { beforeEach, describe, expect, it } from 'vitest';
import { db, StorageError } from '@shared/storage/db';
import type { ActiveDraft } from '@domain/writing/writing.types';
import {
  IndexedDbActiveDraftRepository,
  type ActiveDraftRepository,
} from '@features/drafts/activeDraft.repository';
import { setWritingDraftRepository, TEXT_AUTOSAVE_MS, useWritingStore } from './writing.store';

const options = {
  entryId: 'entry-1',
  film: { filmId: 7, filmTitle: 'Фильм', posterPath: null, releaseYear: '2024' },
  source: 'ratingResult' as const,
};

const reset = () => {
  useWritingStore.setState({ draft: null, hydrated: true, storageError: null, dirty: false });
};

beforeEach(async () => {
  await db.ratingDrafts.clear();
  globalThis.localStorage?.clear();
  setWritingDraftRepository(new IndexedDbActiveDraftRepository());
  reset();
});

/**
 * Real timers on purpose: the fake ones also fake what fake-indexeddb runs on,
 * and a storage test that never reaches storage proves nothing.
 */
const waitForAutosave = () => new Promise((resolve) => setTimeout(resolve, TEXT_AUTOSAVE_MS + 60));

describe('typing', () => {
  it('shows the text at once and writes it shortly after', async () => {
    await useWritingStore.getState().start(options);

    useWritingStore.getState().setText('Первое предложение');
    // On screen immediately — the editor never waits for storage.
    expect(useWritingStore.getState().draft?.workingText).toBe('Первое предложение');
    expect(useWritingStore.getState().dirty).toBe(true);

    await waitForAutosave();

    expect(useWritingStore.getState().dirty).toBe(false);
    const [row] = await db.ratingDrafts.toArray();
    expect((row as { workingText?: string }).workingText).toBe('Первое предложение');
  });

  it('writes one row for a burst of typing, not one per keystroke', async () => {
    await useWritingStore.getState().start(options);

    for (const value of ['Он', 'Она', 'Они пришли']) useWritingStore.getState().setText(value);
    await waitForAutosave();

    const rows = await db.ratingDrafts.toArray();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { workingText?: string }).workingText).toBe('Они пришли');
  });

  it('flush writes what is pending right away', async () => {
    await useWritingStore.getState().start(options);
    useWritingStore.getState().setText('Не потеряй меня');

    await useWritingStore.getState().flush();

    const [row] = await db.ratingDrafts.toArray();
    expect((row as { workingText?: string }).workingText).toBe('Не потеряй меня');
    expect(useWritingStore.getState().dirty).toBe(false);
  });

  it('survives a reload through the synchronous mirror alone', async () => {
    await useWritingStore.getState().start(options);
    useWritingStore.getState().setText('Черновик после перезагрузки');
    await useWritingStore.getState().flush();

    // IndexedDB never made it, the way a killed WebView loses its last write.
    await db.ratingDrafts.clear();
    reset();
    await useWritingStore.getState().hydrate();

    expect(useWritingStore.getState().draft?.workingText).toBe('Черновик после перезагрузки');
  });
});

describe('storage failures', () => {
  /** A repository whose writes always fail, the way a full disk does. */
  class FailingRepository implements ActiveDraftRepository {
    saved: ActiveDraft | null = null;
    async getActive() {
      return this.saved;
    }
    async saveActive(): Promise<void> {
      throw new StorageError('quota', new Error('full'));
    }
    async deleteActive(): Promise<void> {}
    async flush(): Promise<void> {}
  }

  it('reports a failed write instead of claiming the text is safe', async () => {
    setWritingDraftRepository(new FailingRepository());

    await expect(useWritingStore.getState().start(options)).rejects.toBeInstanceOf(StorageError);
    expect(useWritingStore.getState().storageError).toBeInstanceOf(StorageError);
    // The words stay on screen: a storage failure must not erase them.
    expect(useWritingStore.getState().draft?.entryId).toBe('entry-1');
    expect(useWritingStore.getState().dirty).toBe(true);
  });

  it('clears the error once a retry gets through', async () => {
    const failing = new FailingRepository();
    setWritingDraftRepository(failing);
    await useWritingStore
      .getState()
      .start(options)
      .catch(() => undefined);

    setWritingDraftRepository(new IndexedDbActiveDraftRepository());
    await useWritingStore.getState().retrySave();

    expect(useWritingStore.getState().storageError).toBeNull();
    expect(await db.ratingDrafts.count()).toBe(1);
  });
});

describe('discard', () => {
  it('clears storage before memory, so nothing comes back on the next launch', async () => {
    await useWritingStore.getState().start(options);
    useWritingStore.getState().setText('Черновик');
    await useWritingStore.getState().flush();

    await useWritingStore.getState().discard();

    expect(useWritingStore.getState().draft).toBeNull();
    expect(await db.ratingDrafts.count()).toBe(0);
    await useWritingStore.getState().hydrate();
    expect(useWritingStore.getState().draft).toBeNull();
  });

  it('a pending keystroke cannot resurrect a discarded draft', async () => {
    await useWritingStore.getState().start(options);
    useWritingStore.getState().setText('Уже удалено');

    await useWritingStore.getState().discard();
    await waitForAutosave();

    expect(await db.ratingDrafts.count()).toBe(0);
  });
});
