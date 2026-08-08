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
  /** The user's own choice, weaker than the system switch (Master §48). */
  motionPreference: 'system' | 'calm' | 'expressive';
  /** How much of the designed amplitude to actually use, 0–1. */
  motionScale: number;
  /** Hero depth effects allowed at all. */
  parallaxEnabled: boolean;
  inertiaEnabled: boolean;
  ambientEnabled: boolean;
}

/**
 * How much of the designed amplitude survives.
 *
 * The system switch always wins (Master §48): Reduce Motion collapses movement
 * whatever the in-app choice says. Calm is the milder in-app step — it keeps
 * causal transitions and takes most of the depth away.
 */
const scaleFor = (
  preference: 'system' | 'calm' | 'expressive',
  reducedMotion: boolean,
  tier: PerformanceTier,
): number => {
  if (reducedMotion) return 0.15;
  if (preference === 'calm') return 0.4;
  return tier === 'minimal' ? 0.5 : 1;
};

const capabilitiesFor = (
  tier: PerformanceTier,
  reducedMotion: boolean,
  motionPreference: 'system' | 'calm' | 'expressive' = 'system',
): PerformanceCapabilities => ({
  tier,
  reducedMotion,
  motionPreference,
  motionScale: scaleFor(motionPreference, reducedMotion, tier),
  // Reduce Motion keeps a minimal hero depth rather than removing it entirely.
  parallaxEnabled: true,
  inertiaEnabled: !reducedMotion && motionPreference !== 'calm' && tier === 'full',
  ambientEnabled: tier !== 'minimal',
});

interface PerformanceState extends PerformanceCapabilities {
  setTier: (tier: PerformanceTier) => void;
  setReducedMotion: (reduced: boolean) => void;
  setMotionPreference: (preference: 'system' | 'calm' | 'expressive') => void;
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  ...capabilitiesFor('full', prefersReducedMotion()),
  setTier: (tier) => set(capabilitiesFor(tier, get().reducedMotion, get().motionPreference)),
  setReducedMotion: (reducedMotion) =>
    set(capabilitiesFor(get().tier, reducedMotion, get().motionPreference)),
  setMotionPreference: (motionPreference) =>
    set(capabilitiesFor(get().tier, get().reducedMotion, motionPreference)),
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
  private unsubscribeStore: (() => void) | null = null;
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

    // The preference can change from Settings at any time, not just on a tick.
    this.unsubscribeStore = usePerformanceStore.subscribe(() => this.applyDataset());

    this.applyDataset();
    this.measure();
  }

  destroy(): void {
    this.running = false;
    this.win.cancelAnimationFrame(this.rafId);
    this.unsubscribeMotion?.();
    this.unsubscribeMotion = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
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
    /*
     * The one place the motion choice becomes CSS. Reduce Motion always wins
     * over the in-app setting (Master §48); 'calm' only shortens.
     */
    root.dataset.motion = state.reducedMotion
      ? 'reduced'
      : state.motionPreference === 'calm'
        ? 'calm'
        : 'full';
  }
}
