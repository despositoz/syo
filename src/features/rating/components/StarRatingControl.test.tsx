import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRatingControl } from './StarRatingControl';

/**
 * jsdom gives every element a zero-sized box, so every star centre would be 0.
 * Stub the boxes to the real layout: a 44px zero anchor, then five stars with
 * centres at 80, 140, 200, 260, 320.
 */
const stubGeometry = () => {
  let starIndex = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const left = 60 + starIndex * 60;
    starIndex = (starIndex + 1) % 5;
    return {
      left,
      width: 40,
      right: left + 40,
      top: 0,
      height: 40,
      bottom: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
};

const setup = (props: Partial<Parameters<typeof StarRatingControl>[0]> = {}) => {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  const onHaptic = vi.fn();
  render(
    <StarRatingControl
      value={null}
      onCommit={onCommit}
      onPreview={onPreview}
      onHaptic={onHaptic}
      label="Сюжет"
      stateLabel=""
      {...props}
    />,
  );
  return { onCommit, onPreview, onHaptic, slider: screen.getByRole('slider') };
};

describe('StarRatingControl accessibility', () => {
  it('has no value until the user chooses one', () => {
    const { slider } = setup();
    expect(slider).not.toHaveAttribute('aria-valuenow');
    expect(slider).toHaveAttribute('aria-valuetext', 'Оценка не выбрана');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '5');
  });

  it('announces a deliberate zero as a real value, not as unrated', () => {
    const { slider } = setup({ value: 0, stateLabel: 'Рассыпался' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(slider).toHaveAttribute('aria-valuetext', '0 из 5, Рассыпался');
  });

  it('announces the value and its word', () => {
    const { slider } = setup({ value: 4, stateLabel: 'Захватил' });
    expect(slider).toHaveAttribute('aria-valuetext', '4 из 5, Захватил');
  });

  it('is reachable by keyboard', () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute('tabindex', '0');
    expect(slider).toHaveAccessibleName('Сюжет');
  });
});

describe('StarRatingControl keyboard', () => {
  it('steps with the arrow keys without auto-advancing', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { slider, onCommit } = setup({ value: 3, onConfirm });

    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith(4, 'keyboard');
    // An arrow key must never move to the next aspect on its own.
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(3, 'keyboard');
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    const { slider, onCommit } = setup({ value: 3 });

    slider.focus();
    await user.keyboard('{Home}');
    expect(onCommit).toHaveBeenLastCalledWith(0, 'keyboard');

    await user.keyboard('{End}');
    expect(onCommit).toHaveBeenLastCalledWith(5, 'keyboard');
  });

  it('steps up to one from unrated, never to a guessed middle value', async () => {
    const user = userEvent.setup();
    const { slider, onCommit } = setup({ value: null });

    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith(1, 'keyboard');
  });

  it('steps down from unrated to a deliberate zero', async () => {
    const user = userEvent.setup();
    const { slider, onCommit } = setup({ value: null });

    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(0, 'keyboard');
  });

  it('confirms with Enter', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { slider } = setup({ value: 4, onConfirm });

    slider.focus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('StarRatingControl pointer', () => {
  it('commits the star under the finger on tap', () => {
    stubGeometry();
    const { slider, onCommit } = setup();

    fire(slider, 'pointerdown', 200);
    fire(slider, 'pointerup', 200);

    expect(onCommit).toHaveBeenCalledWith(3, 'tap');
  });

  it('commits zero from the lead-in zone', () => {
    stubGeometry();
    const { slider, onCommit } = setup();

    fire(slider, 'pointerdown', 10);
    fire(slider, 'pointerup', 10);

    expect(onCommit).toHaveBeenCalledWith(0, 'tap');
  });

  it('restores the last confirmed value when the gesture is cancelled', () => {
    stubGeometry();
    const { slider, onCommit } = setup({ value: 2, stateLabel: 'Местами' });

    fire(slider, 'pointerdown', 320);
    fire(slider, 'pointercancel', 320);

    expect(onCommit).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuenow', '2');
  });

  it('does not write to the draft on every pointer position', () => {
    stubGeometry();
    const { slider, onCommit } = setup();

    fire(slider, 'pointerdown', 80);
    for (let x = 80; x <= 320; x += 4) fire(slider, 'pointermove', x);
    fire(slider, 'pointerup', 320);

    // 61 pointer positions, exactly one commit.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5, 'drag');
  });
});

describe('StarRatingControl haptics', () => {
  it('fires the maximum flourish only once per interaction', () => {
    stubGeometry();
    const { slider, onHaptic } = setup();

    fire(slider, 'pointerdown', 320);
    fire(slider, 'pointerup', 320);

    const maxima = onHaptic.mock.calls.filter(([, reachedMaximum]) => reachedMaximum === true);
    expect(maxima).toHaveLength(1);
  });

  it('stays silent on the press itself, then reports the committed zero', () => {
    stubGeometry();
    const { slider, onHaptic } = setup();

    // The axis is still undecided here — the gesture may yet turn out to be a
    // scroll, and a buzz for a value nobody chose is worse than a late one.
    fire(slider, 'pointerdown', 10);
    expect(onHaptic).not.toHaveBeenCalled();

    fire(slider, 'pointerup', 10);
    expect(onHaptic).toHaveBeenCalledWith(0, false);
  });

  it('does not buzz when the touch turns into a vertical scroll', () => {
    stubGeometry();
    const { slider, onHaptic, onCommit } = setup();

    fire(slider, 'pointerdown', 200, 20);
    fire(slider, 'pointermove', 202, 60);
    fire(slider, 'pointerup', 202, 60);

    expect(onHaptic).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

/**
 * PointerEvent is not implemented in jsdom; a typed MouseEvent stands in.
 * Dispatch inside act() so React state settles before the assertion.
 */
function fire(target: HTMLElement, type: string, clientX: number, clientY = 20): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(event);
  });
}
