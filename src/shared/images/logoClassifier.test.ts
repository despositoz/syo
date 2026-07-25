import { describe, expect, it } from 'vitest';
import { analyzeLogoPixels, classifyLogoImage, filterForTone } from './logoClassifier';

/** Builds RGBA pixel data of one repeated colour. */
const pixels = (
  count: number,
  [red, green, blue, alpha]: [number, number, number, number],
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index += 1) {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  }
  return data;
};

const merge = (...chunks: Uint8ClampedArray[]): Uint8ClampedArray => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = new Uint8ClampedArray(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
};

describe('logo classifier', () => {
  it('classifies a white logo as light', () => {
    expect(analyzeLogoPixels(pixels(400, [255, 255, 255, 255])).tone).toBe('light');
  });

  it('classifies a black logo as dark monochrome', () => {
    expect(analyzeLogoPixels(pixels(400, [12, 12, 12, 255])).tone).toBe('dark-monochrome');
  });

  it('classifies a dark grey logo as dark monochrome', () => {
    expect(analyzeLogoPixels(pixels(400, [70, 72, 70, 255])).tone).toBe('dark-monochrome');
  });

  it('classifies a saturated dark logo as dark colored', () => {
    expect(analyzeLogoPixels(pixels(400, [120, 10, 10, 255])).tone).toBe('dark-colored');
  });

  it('ignores transparent pixels when judging the ink', () => {
    // A black logo on a huge transparent canvas is still a black logo.
    const data = merge(pixels(3600, [0, 0, 0, 0]), pixels(400, [8, 8, 8, 255]));
    expect(analyzeLogoPixels(data).tone).toBe('dark-monochrome');
  });

  it('returns unsafe when there is almost no visible ink', () => {
    const data = merge(pixels(4000, [255, 255, 255, 0]), pixels(4, [255, 255, 255, 255]));
    expect(analyzeLogoPixels(data).tone).toBe('unsafe');
  });

  it('returns unsafe for empty data', () => {
    expect(analyzeLogoPixels(new Uint8ClampedArray()).tone).toBe('unsafe');
  });

  it('never leaves a dark logo unchanged', () => {
    expect(filterForTone('light')).toBe('none');
    expect(filterForTone('dark-monochrome')).toContain('invert');
    expect(filterForTone('dark-colored')).toContain('invert');
  });
});

describe('classifyLogoImage', () => {
  const image = {
    naturalWidth: 300,
    naturalHeight: 100,
    width: 300,
    height: 100,
  } as HTMLImageElement;

  it('falls back to unsafe when the canvas is tainted (CORS)', () => {
    const analysis = classifyLogoImage(image, (width, height) => ({
      canvas: {} as HTMLCanvasElement,
      context: {
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => {
          throw new DOMException('tainted', 'SecurityError');
        },
        canvas: { width, height },
      } as unknown as CanvasRenderingContext2D,
    }));

    expect(analysis.tone).toBe('unsafe');
  });

  it('falls back to unsafe when no 2D context is available', () => {
    const analysis = classifyLogoImage(image, () => null);
    expect(analysis.tone).toBe('unsafe');
  });

  it('reads pixels through the canvas when allowed', () => {
    const analysis = classifyLogoImage(image, (width, height) => ({
      canvas: {} as HTMLCanvasElement,
      context: {
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: pixels(width * height, [250, 250, 250, 255]) }),
      } as unknown as CanvasRenderingContext2D,
    }));

    expect(analysis.tone).toBe('light');
  });
});
