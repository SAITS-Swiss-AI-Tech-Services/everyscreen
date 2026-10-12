import type { SVGProps } from 'react';

// Small stroke icon set (24x24 grid, drawn with currentColor) so controls don't
// depend on emoji, which render differently on every platform.

const PATHS = {
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  message: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M17 14H7',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  check: 'm5 12 5 5 9-10',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  mouse: 'M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6zM12 7v4',
  play: 'M7 4v16l13-8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  code: 'm8 8-5 4 5 4M16 8l5 4-5 4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  layers: 'm12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  filter: 'M4 5h16l-6 8v6l-4-2v-4L4 5z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Icon for a capture type. */
export const mediaIcon: Record<'image' | 'video' | 'html', IconName> = { video: 'play', image: 'image', html: 'code' };
