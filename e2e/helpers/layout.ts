import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Layout invariants measured on real DOM boxes (P0.3.1 §12).
 *
 * `document.scrollWidth` is not enough: the body is fixed, the root clips, and
 * scroll containers hide their own overflow — a child can sit on top of its
 * neighbour while the document still reports exactly the viewport width. So
 * every check here compares actual rectangles.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;

export const boxesOf = async (locator: Locator): Promise<Box[]> => {
  const count = await locator.count();
  const boxes: Box[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();
    if (box) boxes.push(box);
  }
  return boxes;
};

/** Two rectangles share at least `tolerance` px of area. */
export const overlaps = (left: Box, other: Box, tolerance = 0.5): boolean =>
  left.x < right(other) - tolerance &&
  other.x < right(left) - tolerance &&
  left.y < bottom(other) - tolerance &&
  other.y < bottom(left) - tolerance;

/** No two elements in the set overlap. Reports the offending pair. */
export const expectNoOverlap = async (locator: Locator, label: string): Promise<void> => {
  const boxes = await boxesOf(locator);
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a]!;
      const second = boxes[b]!;
      expect(
        overlaps(first, second),
        `${label}: #${a} (${first.x}…${right(first)}) overlaps #${b} (${second.x}…${right(second)})`,
      ).toBe(false);
    }
  }
};

/** Every element stays inside the viewport's safe rectangle. */
export const expectInsideViewport = async (
  page: Page,
  locator: Locator,
  label: string,
  tolerance = 0.5,
): Promise<void> => {
  const viewport = page.viewportSize()!;
  const boxes = await boxesOf(locator);
  boxes.forEach((box, index) => {
    expect(box.x, `${label}: #${index} starts left of the viewport`).toBeGreaterThanOrEqual(
      -tolerance,
    );
    expect(right(box), `${label}: #${index} runs past the right edge`).toBeLessThanOrEqual(
      viewport.width + tolerance,
    );
  });
};

/**
 * The poster fills the frame its parent gave it — the whole point of the new
 * contract. A poster wider than its frame is clipped and off-centre; a poster
 * narrower leaves a gap the shadow and the radius disagree about.
 */
export const expectPosterFillsFrame = async (
  page: Page,
  frameSelector: string,
  label: string,
  tolerance = 0.5,
): Promise<void> => {
  const measurements = await page.evaluate(
    ({ selector }) =>
      [...document.querySelectorAll(selector)].map((frame) => {
        const poster = frame.matches('[data-poster-root]')
          ? frame
          : frame.querySelector('[data-poster-root]');
        if (!poster) return null;
        const frameBox = frame.getBoundingClientRect();
        const posterBox = poster.getBoundingClientRect();
        return {
          frame: { left: frameBox.left, right: frameBox.right, width: frameBox.width },
          poster: {
            left: posterBox.left,
            right: posterBox.right,
            width: posterBox.width,
            height: posterBox.height,
          },
        };
      }),
    { selector: frameSelector },
  );

  expect(measurements.length, `${label}: no frames found for ${frameSelector}`).toBeGreaterThan(0);

  measurements.forEach((measurement, index) => {
    expect(measurement, `${label}: #${index} has no poster inside`).not.toBeNull();
    const { frame, poster } = measurement!;
    expect(
      Math.abs(poster.left - frame.left),
      `${label}: #${index} left edge is off by ${poster.left - frame.left}px`,
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(poster.right - frame.right),
      `${label}: #${index} right edge is off by ${poster.right - frame.right}px`,
    ).toBeLessThanOrEqual(tolerance);
    // 2:3, the ratio every poster in the app keeps.
    expect(
      Math.abs(poster.height / poster.width - 1.5),
      `${label}: #${index} lost its 2/3 ratio`,
    ).toBeLessThan(0.02);
  });
};

/** Two visible elements must never sit on top of each other. */
export const expectNoIntersection = async (
  first: Locator,
  second: Locator,
  label: string,
): Promise<void> => {
  // A missing element cannot overlap anything — and asking for the box of a
  // locator that matches nothing would hang until the test times out.
  if ((await first.count()) === 0 || (await second.count()) === 0) return;
  const one = await first.boundingBox();
  const other = await second.boundingBox();
  if (!one || !other) return;
  expect(overlaps(one, other), `${label}: the two rectangles intersect`).toBe(false);
};
