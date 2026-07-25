/** Small shared vocabulary used across pages and repositories. */

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface Disposable {
  destroy: () => void;
}

/** A block-level failure that must not replace the whole screen (spec §25). */
export interface BlockFailure {
  block: 'cast' | 'backdrop' | 'logo' | 'poster' | 'details';
  reason: string;
}
