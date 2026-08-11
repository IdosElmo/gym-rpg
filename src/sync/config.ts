/**
 * sync/config.ts — where the Supabase project is, and whether sync exists at all.
 *
 * THE MASTER SWITCH. `syncConfigured()` is checked before anything sync-related
 * is constructed, imported (see `main.ts`) or rendered, so with the placeholders
 * below untouched the app is byte-for-byte the offline app it has always been:
 * no client, no listeners, no account card, no network.
 *
 * The anon key is PUBLIC BY DESIGN — it is shipped inside the bundle and is
 * meant to be. It grants nothing on its own; row level security (see
 * `supabase/schema.sql`) is the actual boundary, and every policy there is
 * scoped to `auth.uid()`. Never put a service-role key here.
 */

export interface SyncConfig {
  /** e.g. `https://abcdefgh.supabase.co` — no trailing slash needed. */
  url: string;
  /** The project's `anon` / publishable key. */
  anonKey: string;
}

/**
 * Fill these in to turn cloud sync on (README → "סנכרון בענן"). Empty = off.
 *
 * They are deliberately a mutable-looking object rather than `import.meta.env`
 * values: the single-file build is often opened straight from disk and handed
 * around, so the configuration has to live in the committed source, not in a
 * build-time environment that a fork would silently lose.
 */
export const SYNC_CONFIG: SyncConfig = {
  url: 'https://omiqettlrjbcafnmomrm.supabase.co',
  anonKey: 'sb_publishable_vfsRAX65C-PMgmnlIDGJnA_hrNzoq8_',
};

/** Protocols a Supabase client can actually work over. */
function isHttpUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const proto = new URL(raw).protocol;
    return proto === 'https:' || proto === 'http:';
  } catch {
    return false;
  }
}

/**
 * The protocol the app itself is running under, or `''` outside a browser
 * (tests, SSR). `file:` is the interesting case: the single-file build opened
 * from disk has an opaque origin, so OAuth redirects and cookies cannot work
 * there — sync must stay completely dark rather than fail visibly.
 */
function pageProtocol(): string {
  const loc: Location | undefined = globalThis.location;
  return typeof loc?.protocol === 'string' ? loc.protocol : '';
}

/**
 * True only when a real project is configured AND the page is being served over
 * http(s). Anything else (placeholders, a typo'd URL, `file://`) means the whole
 * feature stays off.
 *
 * Both inputs are injectable so tests can assert every branch without touching
 * the real `location`.
 */
export function syncConfigured(cfg: SyncConfig = SYNC_CONFIG, protocol: string = pageProtocol()): boolean {
  if (!cfg.url.trim() || !cfg.anonKey.trim()) return false;
  if (!isHttpUrl(cfg.url.trim())) return false;
  // Outside a browser there is no page protocol to object to (tests construct
  // the engine directly); inside one, only http(s) qualifies.
  if (protocol !== '' && protocol !== 'https:' && protocol !== 'http:') return false;
  return true;
}
