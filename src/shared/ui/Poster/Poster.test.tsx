import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Poster } from './Poster';

/**
 * The contract that P0.3.1 exists to enforce: the poster asks for pixels and
 * fills the frame it is given. It never sizes itself.
 */

const accent = { hex: '#6f2a35', rgb: '111, 42, 53' };

const root = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-poster-root]')!;

describe('poster geometry', () => {
  it('never writes a layout width into its own style', () => {
    const { container } = render(
      <Poster title="Фильм" year="2024" posterPath="/p.jpg" accent={accent} requestWidth={160} />,
    );

    const element = root(container);
    expect(element).not.toBeNull();
    // The whole bug in one assertion: a fixed width here escapes the frame.
    expect(element.style.width).toBe('');
    expect(element.style.height).toBe('');
    expect(element.getAttribute('style')).not.toMatch(/\bwidth\b/);
  });

  it('carries the accent as custom properties, and nothing else', () => {
    const { container } = render(
      <Poster title="Фильм" posterPath="/p.jpg" accent={accent} requestWidth={64} />,
    );

    const style = root(container).getAttribute('style') ?? '';
    expect(style).toContain('--poster-accent');
    expect(style).toContain('--poster-accent-rgb');
  });

  it('asks the pipeline for the requested width, not for the rendered one', () => {
    const { container, rerender } = render(
      <Poster title="Фильм" posterPath="/p.jpg" accent={accent} requestWidth={64} />,
    );
    const small = container.querySelector('img:not([aria-hidden])')?.getAttribute('src') ?? '';

    rerender(<Poster title="Фильм" posterPath="/p.jpg" accent={accent} requestWidth={342} />);
    const large = container.querySelector('img:not([aria-hidden])')?.getAttribute('src') ?? '';

    // Different hints pick different TMDB buckets.
    expect(small).not.toBe(large);
  });

  it('declares intrinsic dimensions in the 2:3 ratio so nothing shifts on load', () => {
    const { container } = render(
      <Poster title="Фильм" posterPath="/p.jpg" accent={accent} requestWidth={160} />,
    );

    const image = container.querySelector('img:not([aria-hidden])')!;
    expect(image.getAttribute('width')).toBe('160');
    expect(image.getAttribute('height')).toBe('240');
  });

  it('falls back to typography — title and year, never the word SYO', () => {
    const { container } = render(
      <Poster title="Тихий свет" year="2023" accent={accent} requestWidth={160} />,
    );

    expect(screen.getByText('Тихий свет')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(container.textContent).not.toContain('SYO');
    // The fallback lives inside the same box, so the frame keeps its shape.
    expect(root(container).style.width).toBe('');
  });
});
