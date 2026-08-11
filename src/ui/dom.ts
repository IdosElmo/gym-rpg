/** Tiny DOM helpers shared by the screens. */

export function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

/**
 * Escape a value before interpolating it into an innerHTML template.
 * Program copy is static, but logged weights/reps come from the user, so every
 * interpolation goes through here.
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
