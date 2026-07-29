import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRating } from './StarRating';
import { resolveAxis, stepValue, valueFromPosition } from './starGeometry';

/** jsdom gives every element a zero box; stub five stars at 60px intervals. */
const stubGeometry = () => {
  let index = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const left = 60 + index * 60;
    index = (index + 1) % 5;
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

const setup = (props: Partial<Parameters<typeof StarRating>[0]> = {}) => {
  const onCommit = vi.fn();
  const onHaptic = vi.fn();
  render(
    <StarRating value={null} onCommit={onCommit} onHaptic={onHaptic} label="Сюжет" {...props} />,
  );
  return {
    onCommit,
    onHaptic,
    group: screen.getByRole('radiogroup'),
    /** Tab lands on the checked radio — that is the keyboard entry point. */
    focusable: () => screen.getAllByRole('radio').find((radio) => radio.tabIndex === 0)!,
  };
};

/** PointerEvent is missing in jsdom; a typed MouseEvent stands in. */
const fire = (target: HTMLElement, type: string, clientX: number, clientY = 20): void => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(event);
  });
};

describe('StarRating accessibility', () => {
  it('is a radio group of five radios', () => {
    setup();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Сюжет');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('labels each star as "N из 5"', () => {
    setup();
    expect(screen.getByRole('radio', { name: '3 из 5' })).toBeInTheDocument();
  });

  it('checks nothing until the user chooses', () => {
    setup();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('checks exactly the chosen star', () => {
    setup({ value: 4 });
    expect(screen.getByRole('radio', { name: '4 из 5' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '3 из 5' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('StarRating keyboard', () => {
  it('steps up and down with the arrows', async () => {
    const user = userEvent.setup();
    const { onCommit, focusable } = setup({ value: 3 });

    focusable().focus();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith(4, 'keyboard');

    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(3, 'keyboard');
  });

  it('jumps to the ends: Home is 1, End is 5', async () => {
    const user = userEvent.setup();
    const { onCommit, focusable } = setup({ value: 3 });

    focusable().focus();
    await user.keyboard('{Home}');
    expect(onCommit).toHaveBeenLastCalledWith(1, 'keyboard');

    await user.keyboard('{End}');
    expect(onCommit).toHaveBeenLastCalledWith(5, 'keyboard');
  });

  it('never lands on zero — the scale starts at one', async () => {
    const user = userEvent.setup();
    const { onCommit, focusable } = setup({ value: 1 });

    focusable().focus();
    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(1, 'keyboard');
  });
});

describe('StarRating pointer', () => {
  it('commits the star under the finger on tap', () => {
    stubGeometry();
    const { group, onCommit } = setup();

    fire(group, 'pointerdown', 200);
    fire(group, 'pointerup', 200);

    expect(onCommit).toHaveBeenCalledWith(3, 'tap');
  });

  it('drags across the scale with one commit at the end', () => {
    stubGeometry();
    const { group, onCommit } = setup();

    fire(group, 'pointerdown', 80);
    for (let x = 80; x <= 320; x += 4) fire(group, 'pointermove', x);
    fire(group, 'pointerup', 320);

    // 61 pointer positions, exactly one commit.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5, 'drag');
  });

  it('restores the confirmed value when the gesture is cancelled', () => {
    stubGeometry();
    const { group, onCommit } = setup({ value: 2 });

    fire(group, 'pointerdown', 320);
    fire(group, 'pointercancel', 320);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '2 из 5' })).toHaveAttribute('aria-checked', 'true');
  });

  it('gives the gesture back when the finger goes vertical', () => {
    stubGeometry();
    const { group, onCommit, onHaptic } = setup();

    fire(group, 'pointerdown', 200);
    fire(group, 'pointermove', 202, 60);
    fire(group, 'pointermove', 203, 120);

    // A scroll must neither rate nor buzz.
    expect(onCommit).not.toHaveBeenCalled();
    expect(onHaptic).not.toHaveBeenCalled();
  });

  it('stays silent on the bare press and speaks on commit', () => {
    stubGeometry();
    const { group, onHaptic } = setup();

    fire(group, 'pointerdown', 200);
    expect(onHaptic).not.toHaveBeenCalled();

    fire(group, 'pointerup', 200);
    expect(onHaptic).toHaveBeenCalledWith(3);
  });
});

describe('star geometry', () => {
  const geometry = { centers: [80, 140, 200, 260, 320] };

  it('maps each centre to its own star', () => {
    expect(valueFromPosition(80, geometry)).toBe(1);
    expect(valueFromPosition(200, geometry)).toBe(3);
    expect(valueFromPosition(320, geometry)).toBe(5);
  });

  it('resolves a gap to the nearer star, never to a dead zone', () => {
    expect(valueFromPosition(109, geometry)).toBe(1);
    expect(valueFromPosition(111, geometry)).toBe(2);
  });

  it('clamps outside the track into 1-5, with no zero', () => {
    expect(valueFromPosition(-500, geometry)).toBe(1);
    expect(valueFromPosition(5000, geometry)).toBe(5);
  });

  it('locks the axis only after a clear horizontal move', () => {
    expect(resolveAxis(3, 2)).toBe('undecided');
    expect(resolveAxis(20, 4)).toBe('horizontal');
    expect(resolveAxis(4, 20)).toBe('vertical');
    // Diagonal-but-mostly-down stays a scroll.
    expect(resolveAxis(12, 14)).toBe('vertical');
  });

  it('steps an unrated control to the first star, never below it', () => {
    expect(stepValue(null, 1)).toBe(1);
    expect(stepValue(null, -1)).toBe(1);
    expect(stepValue(1, -1)).toBe(1);
    expect(stepValue(5, 1)).toBe(5);
  });
});

describe('StarRating keyboard, the standard radio keys', () => {
  it('Space selects the focused star', async () => {
    const user = userEvent.setup();
    const { onCommit, focusable } = setup();

    focusable().focus();
    // From nothing: the first arrow lands on 1, the second on 2.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    onCommit.mockClear();
    await user.keyboard(' ');

    // Space confirms what is focused rather than doing nothing at all.
    expect(onCommit).toHaveBeenCalledWith(2, 'keyboard');
  });

  it('Enter selects the focused star', async () => {
    const user = userEvent.setup();
    const { onCommit, focusable } = setup({ value: 4 });

    focusable().focus();
    onCommit.mockClear();
    await user.keyboard('{Enter}');

    expect(onCommit).toHaveBeenCalledWith(4, 'keyboard');
  });

  it('Space on an untouched control chooses the star that has focus', async () => {
    const user = userEvent.setup();
    const { onCommit } = setup();

    // Nothing rated yet: focus sits on the first star.
    screen.getAllByRole('radio')[0]!.focus();
    await user.keyboard(' ');

    expect(onCommit).toHaveBeenCalledWith(1, 'keyboard');
  });
});

describe('StarRating pointer hardening', () => {
  it('captures the mouse on press, so a drag outside the control keeps working', () => {
    stubGeometry();
    setup();
    const group = screen.getByRole('radiogroup');
    const capture = vi.fn();
    Object.defineProperty(group, 'setPointerCapture', { value: capture, configurable: true });

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 80 });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    act(() => {
      group.dispatchEvent(event);
    });

    expect(capture).toHaveBeenCalledWith(7);
  });

  it('losing the capture ends the drag and keeps the confirmed value', () => {
    stubGeometry();
    const { onCommit, group } = setup({ value: 2 });

    fire(group, 'pointerdown', 80);
    fire(group, 'pointermove', 260);
    onCommit.mockClear();
    fire(group, 'lostpointercapture', 260);

    // A gesture the browser took away decides nothing.
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '2 из 5' })).toHaveAttribute('aria-checked', 'true');
    expect(group).not.toHaveAttribute('data-dragging');
  });

  it('a cancelled gesture restores the confirmed value', () => {
    stubGeometry();
    const { onCommit, group } = setup({ value: 3 });

    fire(group, 'pointerdown', 80);
    fire(group, 'pointermove', 300);
    onCommit.mockClear();
    fire(group, 'pointercancel', 300);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '3 из 5' })).toHaveAttribute('aria-checked', 'true');
  });
});
