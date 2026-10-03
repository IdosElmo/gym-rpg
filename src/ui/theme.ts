/**
 * ui/theme.ts — the two looks of the app.
 *
 * DARK is the default for everyone: a navy background with a bright sky-blue
 * accent. LIGHT is a light-grey background with white cards and the same sky
 * blue — with a deeper sky for accent TEXT, because #5cc8ff on white cannot be
 * read (`--accent-ink` in styles/tokens.css).
 *
 * The theme is a device preference (`UiState.theme`), like the language: never
 * an event, kept across "delete all data" and restores. `ui/app.ts#applyPrefs`
 * puts it on <html data-theme> at the top of every render; every colour in the
 * stylesheets is a token defined for both values.
 */

export type Theme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light'] as const;

export const DEFAULT_THEME: Theme = 'dark';

/** The browser chrome colour (`<meta name="theme-color">`) of each theme — its `--bg`. */
export const THEME_CHROME: Readonly<Record<Theme, string>> = {
  dark: '#0d1b36',
  light: '#eceef2',
};

export function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light';
}
