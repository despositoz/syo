import { describe, expect, it } from 'vitest';
import { ImagePipeline, pickSize } from './ImagePipeline';

describe('TMDB size selection', () => {
  it('picks the smallest bucket that covers the device pixels', () => {
    expect(pickSize('poster', 84, 1)).toBe(92);
    expect(pickSize('poster', 84, 2)).toBe(185);
    expect(pickSize('poster', 116, 3)).toBe(500);
    expect(pickSize('backdrop', 390, 2)).toBe(780);
  });

  it('never exceeds the largest available bucket', () => {
    expect(pickSize('backdrop', 4000, 3)).toBe(1280);
  });
});

describe('ImagePipeline', () => {
  const pipeline = new ImagePipeline('https://img.test/t/p', () => 2);

  it('builds URLs from a TMDB path', () => {
    expect(pipeline.poster('/a.jpg', 84)).toBe('https://img.test/t/p/w185/a.jpg');
    expect(pipeline.preview('/a.jpg', 'poster')).toBe('https://img.test/t/p/w92/a.jpg');
    expect(pipeline.preview('/a.jpg', 'backdrop')).toBe('https://img.test/t/p/w300/a.jpg');
  });

  it('returns an empty string when there is no image', () => {
    expect(pipeline.poster('', 84)).toBe('');
    expect(pipeline.preview('', 'poster')).toBe('');
  });

  it('leaves absolute URLs alone', () => {
    expect(pipeline.poster('https://cdn.test/x.jpg', 84)).toBe('https://cdn.test/x.jpg');
  });

  it('tolerates a path without a leading slash', () => {
    expect(pipeline.poster('a.jpg', 84)).toBe('https://img.test/t/p/w185/a.jpg');
  });

  it('rejects an empty url instead of loading nothing', async () => {
    await expect(pipeline.load('')).rejects.toThrow();
  });
});
