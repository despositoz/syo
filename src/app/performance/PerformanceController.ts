import { create } from 'zustand';
import { prefersReducedMotion, subscribeReducedMotion } from '@shared/motion/reducedMotion';

/**
 * Performance tiers degrade decoration, never data (spec §28).
 *
 * full     — everything: parallax with inertia, poster parallax, ambient, blur.
 * balanced — inertia off, poster parallax off.
 * minimal  — backdrop parallax only, no blur, no ambient.
 */
export type PerformanceTier = 'full' | 'balanced' | 'minimal';

export interface PerformanceCapabilities {
  tier: PerformanceTier;
  reducedMotion: boolean;
  /** Hero depth effects allowed at all. */
  parallaxEnabled: boolean;
  inertiaEnabled: boolean;
  ambientEnabled: boolean;
}

const capabilitiesFor = (
  tier: PerformanceTier,
  reducedMotion: boolean,
): PerformanceCapabilities => ({
  tier,
  reducedMotion,
  // Reduce Motion keeps a minimal hero depth rather than removing it entirely.
  parallaxEnabled: true,
  inertiaEnabled: !reducedMotion && tier === 'full',
  ambientEnabled: tier !== 'minimal',
});

interface PerformanceState extends PerformanceCapabilities {
  setTier: (tier: PerformanceTier) => void;
  setReducedMotion: (reduced: boolean) => void;
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  ...capabilitiesFor('full', prefersReducedMotion()),
  setTier: (tier) => set(capabilitiesFor(tier, get().reducedMotion)),
  setReducedMotion: (reducedMotion) => set(capabilitiesFor(get().tier, reducedMotion)),
}));

/** Frames slower than this count as dropped at 60 Hz. */
const SLOW_FRAME_MS = 24;
const SAMPLE_FRAMES = 90;

/**
 * Measures real frame pacing for a short window after start and once per
 * heavy screen, then steps the tier down if the device cannot keep up.
 * Never steps back up automatically — thrashing tiers is worse than one tier.
 */
export class PerformanceController {
  private rafId = 0;
  private frames = 0;
  private slowFrames = 0;
  private lastFrameAt = 0;
  private unsubscribeMotion: (() => void) | null = null;
  private running = false;

  constructor(private readonly win: Window = window) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    const reduced = prefersReducedMotion();
    usePerformanceStore.getState().setReducedMotion(reduced);
    this.unsubscribeMotion = subscribeReducedMotion((value) => {
      usePerformanceStore.getState().setReducedMotion(value);
      this.applyDataset();
    });

    // Low-memory / low-core devices start one tier down instead of measuring.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const cores = navigator.hardwareConcurrency ?? 8;
    if ((memory !== undefined && memory <= 2) || cores <= 4) {
      usePerformanceStore.getState().setTier('balanced');
    }

    this.applyDataset();
    this.measure();
  }

  destroy(): void {
    this.running = false;
    this.win.cancelAnimationFrame(this.rafId);
    this.unsubscribeMotion?.();
    this.unsubscribeMotion = null;
  }

  private measure(): void {
    const tick = (timestamp: number) => {
      if (this.lastFrameAt) {
        const delta = timestamp - this.lastFrameAt;
        if (delta > SLOW_FRAME_MS) this.slowFrames += 1;
        this.frames += 1;
      }
      this.lastFrameAt = timestamp;

      if (this.frames < SAMPLE_FRAMES) {
        this.rafId = this.win.requestAnimationFrame(tick);
        return;
      }

      const dropRate = this.slowFrames / this.frames;
      const store = usePerformanceStore.getState();
      if (dropRate > 0.35 && store.tier !== 'minimal') {
        store.setTier(store.tier === 'full' ? 'balanced' : 'minimal');
      } else if (dropRate > 0.18 && store.tier === 'full') {
        store.setTier('balanced');
      }
      this.applyDataset();
    };

    this.rafId = this.win.requestAnimationFrame(tick);
  }

  private applyDataset(): void {
    const state = usePerformanceStore.getState();
    const root = this.win.document.documentElement;
    root.dataset.performance = state.tier;
    root.dataset.motion = state.reducedMotion ? 'reduced' : 'full';
  }
}
