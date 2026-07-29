import type { ConversationTurn, TextRevision, WritingDraft } from '@domain/writing/writing.types';

/**
 * The saved text of an entry (spec §8).
 *
 * Rating and text live in the same entry. Editing the text never touches the
 * rating fields, and the revision list always keeps the user's original.
 */

export interface SavedConversation {
  sessionId: string;
  /** Owner-only, collapsed. Never shown in the list or to anyone else. */
  turns: ConversationTurn[];
}

export interface DiaryText {
  selectedRevisionId: string;
  revisions: TextRevision[];
  conversation: SavedConversation | null;
  spoiler: boolean;
}

/** The text the entry currently presents. */
export const selectedText = (text: DiaryText | null): string => {
  if (!text) return '';
  return text.revisions.find((revision) => revision.id === text.selectedRevisionId)?.text ?? '';
};

/** The user's first manual version — kept reachable forever (spec §2.3). */
export const originalRevision = (text: DiaryText | null): TextRevision | null =>
  text?.revisions.find((revision) => revision.kind === 'user') ?? null;

/** The most recent assistant version, if the user ever asked for one. */
export const latestAssistantRevision = (text: DiaryText | null): TextRevision | null => {
  if (!text) return null;
  for (let index = text.revisions.length - 1; index >= 0; index -= 1) {
    const revision = text.revisions[index];
    if (revision?.kind === 'assistant') return revision;
  }
  return null;
};

/**
 * Two or three lines for the diary card (spec §23.2).
 *
 * A real excerpt of what the user wrote — never a generated summary, never a
 * raw conversation answer. Words are kept whole.
 */
export const textExcerpt = (text: DiaryText | null, limit = 140): string => {
  const full = selectedText(text).replace(/\s+/g, ' ').trim();
  if (full.length <= limit) return full;
  const cut = full.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

/** Whitespace-only text counts as no text at all. */
export const hasMeaningfulText = (value: string): boolean => value.trim().length > 0;

/**
 * What a finished draft saves onto the entry.
 *
 * Returns null when there is nothing to save — an empty text is not an empty
 * opinion, it is no text. The caller commits the working text as a revision
 * first, so the selected revision is always the words on screen.
 */
export const diaryTextFromDraft = (draft: WritingDraft): DiaryText | null => {
  if (!hasMeaningfulText(draft.workingText) || !draft.selectedRevisionId) return null;

  return {
    selectedRevisionId: draft.selectedRevisionId,
    revisions: draft.revisions,
    // Raw answers stay with the entry: they are the user's own words, and the
    // owner can always see what the text was built from (spec §7.4).
    conversation: draft.conversation
      ? { sessionId: draft.conversation.sessionId, turns: draft.conversation.turns }
      : null,
    spoiler: draft.spoiler,
  };
};
