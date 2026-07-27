/** Inline SVG icons: no icon font, no UI kit. All decorative (aria-hidden by IconButton). */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M15 5 8 12l7 7" />
  </svg>
);

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m16 16 4 4" />
  </svg>
);

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" {...stroke} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" />
  </svg>
);

export const FeedIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M3.5 9h17M8.5 4.5v4.5M15.5 4.5v4.5" />
  </svg>
);

export const DiaryIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M6 3.5h11a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H6Z" />
    <path d="M6 3.5v17M9.5 8.5h6M9.5 12h4" />
  </svg>
);

export const RateIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M12 4.6l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.9l5-.7z" />
  </svg>
);

export const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="8.5" r="3.7" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

export const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3.6l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </svg>
);

export const OfflineIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M3 8.5a15 15 0 0 1 18 0M6.5 12a10 10 0 0 1 11 0M10 15.5a5 5 0 0 1 4 0" />
    <path d="m4 4 16 16" />
  </svg>
);

export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const GridIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <rect x="4" y="4" width="6.4" height="6.4" rx="1.6" />
    <rect x="13.6" y="4" width="6.4" height="6.4" rx="1.6" />
    <rect x="4" y="13.6" width="6.4" height="6.4" rx="1.6" />
    <rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.6" />
  </svg>
);

export const ListIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </svg>
);
