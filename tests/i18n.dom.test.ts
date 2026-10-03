/**
 * @vitest-environment jsdom
 *
 * Switching language from the settings screen: the document's lang/dir flip,
 * the shell (nav, header, footer, timer bar) speaks the new language, and
 * switching back restores the Hebrew shell exactly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { setUnits } from '../src/i18n/units.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.documentElement.setAttribute('lang', 'he');
  document.documentElement.setAttribute('dir', 'rtl');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

afterEach(() => {
  setLocale('he');
  setUnits('metric');
});

function mount(): { store: LocalStore; render: () => void } {
  const store = new LocalStore(fakeStorage());
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const timer = new RestTimer({
    bar: el('timerBar'),
    time: el('tTime'),
    prog: el('tProg'),
    title: el('tTitle'),
    plus: el('tPlus'),
    minus: el('tMinus'),
    pause: el('tPause'),
    reset: el('tReset'),
    close: el('tClose'),
  });
  const app = createApp(store, timer);
  store.update((d) => {
    d.ui.view = 'ST';
  });
  app.render();
  return { store, render: app.render };
}

function click(sel: string): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const hubLabels = (): string[] =>
  [...document.querySelectorAll('#tabs .hub .h-label')].map((e) => e.textContent ?? '');

describe('the language switch', () => {
  it('a fresh store renders the Hebrew shell, right to left', () => {
    mount();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('he');
    expect(hubLabels()).toEqual(['אימון', 'קרב', 'תזונה', 'הגדרות']);
    expect(document.querySelector('#prefsCard [data-locale="he"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('English flips the document to LTR and translates the shell', () => {
    const { store } = mount();
    const hebrewHeader = document.getElementById('header')?.innerHTML;
    click('#prefsCard [data-locale="en"]');

    expect(store.getState().ui.locale).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.getElementById('timerBar')?.getAttribute('dir')).toBe('ltr');
    expect(hubLabels()).toEqual(['Train', 'Battle', 'Nutrition', 'Settings']);
    expect(document.querySelector('#header .app-title')?.textContent).toBe('Settings');
    expect(document.querySelector('body > footer')?.textContent).toContain('offline');
    expect(document.title).toBe('Gym RPG');
    expect(document.querySelector('#main .data-card')?.textContent).toContain('My data');

    click('#prefsCard [data-locale="he"]');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.getElementById('header')?.innerHTML).toBe(hebrewHeader);
    expect(hubLabels()).toEqual(['אימון', 'קרב', 'תזונה', 'הגדרות']);
  });

  it('the theme defaults to dark, and the light switch flips <html data-theme> and back', () => {
    const { store } = mount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('#prefsCard [data-look="dark"]')?.getAttribute('aria-pressed')).toBe('true');
    click('#prefsCard [data-look="light"]');
    expect(store.getState().ui.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    click('#prefsCard [data-look="dark"]');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('the units switch is stored as a preference', () => {
    const { store } = mount();
    click('#prefsCard [data-units="imperial"]');
    expect(store.getState().ui.units).toBe('imperial');
    expect(document.querySelector('#prefsCard [data-units="imperial"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
