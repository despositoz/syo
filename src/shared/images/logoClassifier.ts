/**
 * TMDB logos come in white, black, grey, coloured and semi-transparent flavours.
 * Everything sits on a dark hero, so a dark logo must be lightened — or replaced
 * by the text title (spec §18).
 *
 * The classifier is a pure function over pixel data, so it is fully unit-tested
 * without a canvas.
 */

export type LogoTone =
  | 'light'
  /** Dark, essentially greyscale — safe to invert to light. */
  | 'dark-monochrome'
  /** Dark and coloured — lighten, or fall back to a light monochrome render. */
  | 'dark-colored'
  /** Not enough visible pixels / unreadable — use the text title. */
  | 'unsafe';

export interface LogoAnalysis {
  tone: LogoTone;
  /** Median relative luminance of visible pixels, 0–1. */
  medianLuminance: number;
  meanLuminance: number;
  meanSaturation: number;
  visibleRatio: number;
}

/** Pixels below this alpha carry no ink. */
const ALPHA_FLOOR = 0.2;
/** Below this share of visible ink the sample is not trustworthy. */
const MIN_VISIBLE_RATIO = 0.002;
const MIN_VISIBLE_PIXELS = 24;
/** Above this luminance the logo already reads on a dark background. */
const LIGHT_MEDIAN = 0.5;
const LIGHT_MEAN = 0.58;
/** Below this saturation a dark logo is effectively greyscale. */
const MONOCHROME_SATURATION = 0.18;

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

export const analyzeLogoPixels = (data: ArrayLike<number>): LogoAnalysis => {
  const totalPixels = Math.floor(data.length / 4);
  const empty: LogoAnalysis = {
    tone: 'unsafe',
    medianLuminance: 0,
    meanLuminance: 0,
    meanSaturation: 0,
    visibleRatio: 0,
  };
  if (totalPixels === 0) return empty;

  const luminances: number[] = [];
  let luminanceSum = 0;
  let saturationSum = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha < ALPHA_FLOOR) continue;

    const red = (data[index] ?? 0) / 255;
    const green = (data[index + 1] ?? 0) / 255;
    const blue = (data[index + 2] ?? 0) / 255;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const chroma = max - min;
    const denominator = 1 - Math.abs(2 * lightness - 1);
    const saturation = chroma === 0 || denominator === 0 ? 0 : chroma / denominator;

    const luminance = 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
    luminances.push(luminance);
    luminanceSum += luminance;
    saturationSum += Number.isFinite(saturation) ? Math.min(saturation, 1) : 0;
  }

  const visible = luminances.length;
  const visibleRatio = visible / totalPixels;
  const minimumVisible = Math.max(MIN_VISIBLE_PIXELS, Math.ceil(totalPixels * MIN_VISIBLE_RATIO));
  if (visible < minimumVisible) return { ...empty, visibleRatio };

  luminances.sort((left, right) => left - right);
  const medianLuminance = luminances[Math.floor(visible / 2)] ?? 0;
  const meanLuminance = luminanceSum / visible;
  const meanSaturation = saturationSum / visible;

  const tone: LogoTone =
    medianLuminance >= LIGHT_MEDIAN || meanLuminance >= LIGHT_MEAN
      ? 'light'
      : meanSaturation <= MONOCHROME_SATURATION
        ? 'dark-monochrome'
        : 'dark-colored';

  return { tone, medianLuminance, meanLuminance, meanSaturation, visibleRatio };
};

/** CSS filter that makes a given tone readable on the dark hero. */
export const filterForTone = (tone: LogoTone): string => {
  switch (tone) {
    case 'light':
      return 'none';
    case 'dark-monochrome':
      // Pure inversion keeps the shape and turns black ink into warm white.
      return 'invert(1) brightness(1.08)';
    case 'dark-colored':
      // Colour is not worth an unreadable logo: desaturate, then lift.
      return 'grayscale(1) invert(1) brightness(1.05)';
    case 'unsafe':
      return 'none';
  }
};

export type CanvasFactory = (
  width: number,
  height: number,
) => { context: CanvasRenderingContext2D | null; canvas: HTMLCanvasElement } | null;

const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
};

/** Downscale target: enough ink to judge, cheap enough to read every open. */
const SAMPLE_WIDTH = 96;

/**
 * Reads a decoded logo through a canvas.
 * A tainted canvas (CORS) or a missing 2D context yields 'unsafe' → text title.
 */
export const classifyLogoImage = (
  image: HTMLImageElement,
  createCanvas: CanvasFactory = defaultCanvasFactory,
): LogoAnalysis => {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    return {
      tone: 'unsafe',
      medianLuminance: 0,
      meanLuminance: 0,
      meanSaturation: 0,
      visibleRatio: 0,
    };
  }

  const width = Math.min(SAMPLE_WIDTH, naturalWidth);
  const height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width));
  const surface = createCanvas(width, height);
  const context = surface?.context;
  if (!context) {
    return {
      tone: 'unsafe',
      medianLuminance: 0,
      meanLuminance: 0,
      meanSaturation: 0,
      visibleRatio: 0,
    };
  }

  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return analyzeLogoPixels(data);
  } catch {
    // SecurityError: the canvas is tainted. Text title is the safe answer.
    return {
      tone: 'unsafe',
      medianLuminance: 0,
      meanLuminance: 0,
      meanSaturation: 0,
      visibleRatio: 0,
    };
  }
};
