/**
 * The one star shape in the app (spec §9.2, §23.7).
 *
 * A five-point star with softened inner corners — not an emoji, not a Material
 * icon. Every surface that shows a rating uses this same path.
 */

export const STAR_PATH =
  'M12 2.4c.5 0 .95.3 1.16.76l2.2 4.72 5.06.7c.5.07.92.42 1.08.9.15.49.02 1.02-.35 1.37l-3.68 3.5.9 5.1c.09.5-.12 1-.53 1.3-.41.29-.95.32-1.4.09L12 18.44l-4.44 2.4c-.45.23-.99.2-1.4-.1-.41-.29-.62-.79-.53-1.29l.9-5.1-3.68-3.5a1.36 1.36 0 0 1-.35-1.38c.16-.47.58-.82 1.08-.89l5.06-.7 2.2-4.72c.21-.46.66-.76 1.16-.76Z';

export interface StarShapeProps {
  /** 0 = empty, 1 = full, 0.5 = half. */
  fill: number;
  className?: string;
  /** Unique per instance: the clip path for a half star needs its own id. */
  id?: string;
}

export const StarShape = ({ fill, className, id }: StarShapeProps) => {
  const clamped = Math.min(1, Math.max(0, fill));
  const clipId = id ? `star-clip-${id}` : undefined;

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} className="star-outline" />
      {clamped > 0 ? (
        <>
          {clamped < 1 && clipId ? (
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width={24 * clamped} height="24" />
              </clipPath>
            </defs>
          ) : null}
          <path
            d={STAR_PATH}
            className="star-fill"
            clipPath={clamped < 1 && clipId ? `url(#${clipId})` : undefined}
          />
        </>
      ) : null}
    </svg>
  );
};
