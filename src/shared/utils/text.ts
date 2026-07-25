/** Russian plural forms: 1 фильм, 2 фильма, 5 фильмов. */
export const plural = (count: number, forms: [string, string, string]): string => {
  const absolute = Math.abs(count) % 100;
  const tail = absolute % 10;
  if (absolute > 10 && absolute < 20) return forms[2];
  if (tail > 1 && tail < 5) return forms[1];
  if (tail === 1) return forms[0];
  return forms[2];
};

export const joinMeta = (parts: Array<string | number | null | undefined>): string =>
  parts
    .map((part) => (typeof part === 'number' ? String(part) : part))
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
