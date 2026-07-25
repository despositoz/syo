import { describe, expect, it } from 'vitest';
import {
  PAGE_EXIT_SHIFT_PX,
  pageEnterKeyframes,
  pageExitKeyframes,
  pageTimings,
} from './transitions';

const asText = (frames: Keyframe[]) => JSON.stringify(frames);

describe('temporary back transition (spec §11)', () => {
  it('shifts the page 6–10 px to the right and fades out', () => {
    expect(PAGE_EXIT_SHIFT_PX).toBeGreaterThanOrEqual(6);
    expect(PAGE_EXIT_SHIFT_PX).toBeLessThanOrEqual(10);

    const frames = pageExitKeyframes();
    expect(frames[0]).toMatchObject({ opacity: 1 });
    expect(frames[1]).toMatchObject({ opacity: 0 });
    expect(String(frames[1]?.transform)).toContain(`${PAGE_EXIT_SHIFT_PX}px`);
  });

  it('never scales anything', () => {
    expect(asText(pageExitKeyframes())).not.toContain('scale');
    expect(asText(pageEnterKeyframes())).not.toContain('scale');
  });

  it('never blurs anything', () => {
    expect(asText(pageExitKeyframes())).not.toContain('blur');
    expect(asText(pageEnterKeyframes())).not.toContain('blur');
  });

  it('stays inside the 160–220 ms window', () => {
    expect(pageTimings('enter', { reducedMotion: false }).duration).toBeLessThanOrEqual(220);
    expect(pageTimings('exit', { reducedMotion: false }).duration).toBeGreaterThanOrEqual(160);
    expect(pageTimings('exit', { reducedMotion: false }).duration).toBeLessThanOrEqual(220);
  });

  it('collapses to a very short fade under Reduce Motion', () => {
    const timings = pageTimings('exit', { reducedMotion: true });
    expect(Number(timings.duration)).toBeLessThanOrEqual(100);
  });
});
