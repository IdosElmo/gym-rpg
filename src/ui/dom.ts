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

/**
 * `esc`, plus a direction isolate around every Latin parenthetical — the
 * built-in Hebrew names carry their English term in parentheses ("חתירה
 * חד־זרועית (Hand Row)"), and at the end of a right-to-left line the bidi
 * algorithm hands the closing parenthesis to the Hebrew side, printing
 * "Hand) … (Row". `<bdi>` keeps "(Hand Row)" whole; the text is unchanged.
 */
export function escBidi(v: unknown): string {
  return esc(v).replace(/\(([A-Za-z][^()]*)\)/g, '<bdi>($1)</bdi>');
}
