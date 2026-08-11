/** Shared toast — identical timing/markup to the legacy app (2600ms). */

let toastEl: HTMLElement | null = null;
let toastTO: ReturnType<typeof setTimeout> | null = null;

export function initToast(el: HTMLElement): void {
  toastEl = el;
}

export function toast(msg: string): void {
  const t = toastEl ?? document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (toastTO !== null) clearTimeout(toastTO);
  toastTO = setTimeout(() => t.classList.remove('show'), 2600);
}
