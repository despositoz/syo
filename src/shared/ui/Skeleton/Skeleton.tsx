import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  /** 2:3 poster placeholder that reserves exactly the final box. */
  poster?: boolean;
}

/** Reserves final geometry so nothing shifts when data arrives. */
export const Skeleton = ({ width, height, radius, className, poster = false }: SkeletonProps) => (
  <div
    className={[styles.skeleton, className].filter(Boolean).join(' ')}
    aria-hidden="true"
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: poster ? undefined : typeof height === 'number' ? `${height}px` : height,
      aspectRatio: poster ? '2 / 3' : undefined,
      borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
    }}
  />
);
