/**
 * dev/window.ts — `window.gymDev`, attached only while the gate is open.
 *
 * The whole module is four lines of logic and one deliberate promise: when the
 * gate is shut — signed out, another account, `file://` — the property is not
 * there. Not a stub that refuses politely, not an object whose methods throw:
 * `typeof window.gymDev === 'undefined'`, so a curious person reading the
 * console of somebody else's phone finds nothing at all. Signing out DETACHES
 * it, which is the case a "attach once at boot" version would have got wrong.
 */

import type { DevApi } from './actions.ts';

/** The property the console API lives on. */
export const DEV_GLOBAL = 'gymDev';

/** A window that may or may not be carrying the dev API. */
export type DevHost = Record<string, unknown>;

/** Attach (or replace) the API. */
export function attachDevApi(host: DevHost, api: DevApi): void {
  host[DEV_GLOBAL] = api;
}

/** Remove it, leaving no trace that it was ever there. */
export function detachDevApi(host: DevHost): void {
  delete host[DEV_GLOBAL];
}

/** Is it attached right now? (The tests' one question, and the app's guard.) */
export function devApiAttached(host: DevHost): boolean {
  return host[DEV_GLOBAL] !== undefined;
}
