/**
 * ui/icons.ts — a small set of inline stroke icons for the "Pulse" redesign.
 *
 * Every icon is a 24×24 path set drawn with `currentColor`, so it takes the
 * colour of whatever it sits in (a token, never a literal) and works in both
 * themes. They are DECORATIVE: `aria-hidden`, with the meaning carried by the
 * text beside them. Inline markup, no sprite sheet and no `<use>`, so the
 * single-file build needs nothing else and an icon renders the same in a test.
 *
 * Icons that point along the reading direction (`back`, `chevron`) carry the
 * `ic-flip` class; styles/onboarding.css mirrors them in RTL.
 */

const PATHS = {
  flame:
    '<path d="M12 3c.8 3.8 5 5.4 5 10.2A5 5 0 0 1 7 13.5c0-2.4 1.3-3.6 2-5.5 1 1.2 1.8 2 2.6 2.4C12 8 12 5.6 12 3z"/>',
  dumbbell: '<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  dots: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6"/>',
  male: '<circle cx="10" cy="14" r="5.5"/><path d="M14 10l6-6M15 4h5v5"/>',
  female: '<circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V22M8.5 18.5h7"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  homeWeights: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M9.5 13v4M14.5 13v4M9.5 15h5"/>',
  building:
    '<path d="M5 21V5l7-2v18M12 7l7 2v12M3 21h18"/><path d="M8 8v.01M8 12v.01M8 16v.01M15.5 12v.01M15.5 16v.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 15c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M5 18v2M19 18v2"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.5-6.5L15 17v4M12.5 14.5l-1-4.5 3.5-2 2 3.5 2.5 1M11.5 10l-3 2-1 3.5"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2.5 7H6M14 6h2.5"/>',
  run: '<circle cx="15" cy="4.5" r="1.8"/><path d="M5 20l4.5-1.5 2-3.5M11.5 15l3-3.5-3.5-3-3.5 2.5M14.5 11.5l2.5 2 3-1M14.5 8.5l2-1"/>',
  hardhat: '<path d="M3 17.5h18M4.5 17.5v-2a7.5 7.5 0 0 1 15 0v2M10 8.3V5.5h4v2.8M12 8v6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 11a4.5 4.5 0 0 1 9 0"/><path d="M12 11l2.2-2.6"/><circle cx="12" cy="11" r=".6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  // the bottom bar (ui/nav.ts): תזונה, הרפתקה, התקדמות — אימון and פרופיל reuse dumbbell / user
  food: '<path d="M7 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M9 12v9M17 21V3c-2 0-3.5 2.5-3.5 6s1.5 4 3.5 4"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  chart: '<path d="M3 20h18M6 16v-4M11 16V7M16 16v-6M21 16V4"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Icons that point "forward/back" and so mirror in a right-to-left page. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>(['back', 'chevron']);

/** One icon as inline SVG markup. `cls` adds classes (size, colour hooks). */
export function icon(name: IconName, cls = ''): string {
  const classes = ['ic', DIRECTIONAL.has(name) ? 'ic-flip' : '', cls].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
