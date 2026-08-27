/**
 * ui/xpfx.ts — the little celebration layer: XP fly-ups.
 *
 * Motion is CSS-only (`styles/game.css`); the global
 * `@media (prefers-reduced-motion: reduce)` rule disables the keyframes, and
 * because the element is removed on a timer (never on `animationend`) the
 * reduced-motion path still shows the numbers and still cleans up.
 */

const FLY_MS = 1150;

/**
 * One floating label: plain text, or text plus an extra class.
 *
 * The class exists for the superset fly-up, which sends up the tapped
 * exercise's XP in the usual green and its partner's in violet (`ss`) from the
 * same ✓ — one tap, two exercises paid.
 */
export type FlyLine = string | { text: string; cls?: string };

/** Float "+8 XP חזה!" labels up from an anchor element (usually the ✓ button). */
export function flyXp(anchor: Element, texts: readonly FlyLine[]): void {
  if (texts.length === 0 || typeof document === 'undefined') return;
  const rect = anchor.getBoundingClientRect();
  texts.forEach((line, i) => {
    const text = typeof line === 'string' ? line : line.text;
    const cls = typeof line === 'string' ? '' : (line.cls ?? '');
    const el = document.createElement('div');
    el.className = cls ? `xp-fly ${cls}` : 'xp-fly';
    el.textContent = text;
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top + rect.height / 2 - i * 20}px`;
    el.style.animationDelay = `${i * 90}ms`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), FLY_MS + i * 90);
  });
}

/** Format an XP amount the way the fly-ups and bars show it (no trailing .0). */
export function fmtXp(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
