/**
 * Verifies that dist/index.html is a single self-contained file:
 *  - no <script src> / <link rel=stylesheet href> / <img src> pointing anywhere;
 *  - no absolute http(s) URLs other than XML namespaces (xmlns=…), which are
 *    identifiers, not network fetches, and the EXPLICIT allowlist below;
 *  - nothing that fetches or opens a socket to a literal external URL;
 *  - the app code and the CSS are actually inlined.
 * Usage: node scripts/verify-dist.mjs   (run `npm run build` first)
 *
 * ---------------------------------------------------------------------------
 * THE ALLOWLIST
 * ---------------------------------------------------------------------------
 * Bundling `@supabase/supabase-js` (cloud sync) drags a handful of absolute
 * URLs into the bundle as STRING LITERALS. None of them is fetched — they are
 * documentation links inside error messages and one unused default constant —
 * but a blanket "ignore github.com" rule would quietly bless a real regression,
 * so every allowed URL is listed individually, with the reason it is harmless.
 *
 * Rules of this list:
 *   1. an entry must be a specific pattern, never a bare domain wildcard;
 *   2. an entry must say WHY the URL cannot cause a network request;
 *   3. an entry that stops matching is REPORTED (a stale allowance is a hole);
 *   4. anything not on the list still fails the build, exactly as before.
 */
import { readFileSync, statSync } from 'node:fs';

const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
const problems = [];

/**
 * The configured Supabase project, read from the source of truth rather than
 * hardcoded here: with sync unconfigured (the default, and the `file://` build)
 * there is no such origin in the bundle at all, and this entry matches nothing.
 */
function configuredSyncOrigin() {
  try {
    const src = readFileSync('src/sync/config.ts', 'utf8');
    const url = /url:\s*'([^']*)'/.exec(src)?.[1] ?? '';
    if (!url.trim()) return null;
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

const syncOrigin = configuredSyncOrigin();

const ALLOWED = [
  syncOrigin && {
    // THE one URL the app is supposed to talk to. It is here because it is
    // configured in src/sync/config.ts — the app's own backend, reached with
    // the public anon key, guarded by row level security. Not a third party.
    name: 'configured Supabase project',
    test: (u) => u === syncOrigin || u.startsWith(syncOrigin + '/'),
  },
  {
    // supabase-js realtime: the text of an Error thrown when a self-hosted
    // Realtime server is too old. We never open a realtime channel (sync is
    // plain PostgREST reads/writes), and a string inside `new Error(...)` is
    // not a request under any circumstances.
    name: 'supabase-js realtime error-message doc link',
    test: (u) => /^https:\/\/github\.com\/supabase\/supabase-js\/blob\/[\w./-]+\.md$/.test(u),
  },
  {
    // gotrue-js's default GOTRUE_URL constant. Dead code for us: the client is
    // always constructed with an explicit project URL, so the default is never
    // read. It is also localhost, i.e. not a third-party endpoint even if it
    // somehow were.
    name: 'gotrue-js unused default URL constant',
    test: (u) => u === 'http://localhost:9999',
  },
  {
    // supabase-js prints a console.warn on Node ≤ 20 pointing at a GitHub
    // discussion. Browser-only build; a console message is not a fetch.
    name: 'supabase-js node-deprecation console.warn link',
    test: (u) => /^https:\/\/github\.com\/orgs\/supabase\/discussions\/\d+$/.test(u),
  },
].filter(Boolean);

const used = new Set();

for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)) problems.push(`external <script src> at ${m.index}`);
for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet/gi)) problems.push(`external stylesheet at ${m.index}`);
for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](?!data:)/gi)) problems.push(`external <img src> at ${m.index}`);

for (const m of html.matchAll(/https?:\/\/[^\s"'<>)\\]+/gi)) {
  const idx = m.index ?? 0;
  const before = html.slice(Math.max(0, idx - 40), idx);
  if (/xmlns(:\w+)?\s*=\s*["']?$/i.test(before)) continue; // SVG/XML namespace
  const url = m[0];
  const rule = ALLOWED.find((r) => r.test(url));
  if (rule) {
    used.add(rule.name);
    continue;
  }
  problems.push(`absolute URL: ${url}`);
}

// A rule that no longer matches anything is an allowance nobody is watching —
// most likely a dependency changed its message. Fail so the list gets pruned.
for (const rule of ALLOWED) {
  if (rule.name === 'configured Supabase project') continue; // legitimately absent while unconfigured
  if (!used.has(rule.name)) problems.push(`stale allowlist entry (matched nothing): ${rule.name}`);
}

// The allowlist above argues these literals are inert. This is the check that
// keeps that argument honest: nothing in the bundle may fetch, open a socket to
// or import a literal absolute URL.
for (const m of html.matchAll(/\b(fetch|import|importScripts)\s*\(\s*["'`]https?:\/\//gi)) {
  problems.push(`network call to a literal URL at ${m.index}`);
}
for (const m of html.matchAll(/new\s+WebSocket\s*\(\s*["'`]/gi)) {
  problems.push(`WebSocket to a literal URL at ${m.index}`);
}

for (const m of html.matchAll(/@import\s+url\(|url\(\s*["']?(?!data:)(https?:|\/\/)/gi)) {
  problems.push(`external css url() at ${m.index}`);
}

if (!/<style[^>]*>[\s\S]*--accent:#3B82F6/i.test(html)) problems.push('CSS was not inlined');
if (!/PROGRAM|היפרטרופיה/.test(html)) problems.push('app content missing');
if (!/<script[^>]*>[\s\S]{2000,}<\/script>/.test(html)) problems.push('JS was not inlined');

const kb = (statSync(file).size / 1024).toFixed(1);
if (problems.length) {
  console.error(`✗ ${file} (${kb} kB) has ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
const allowed = used.size > 0 ? `, ${used.size} allowlisted inert literal(s)` : '';
console.log(`✓ ${file} is self-contained (${kb} kB, zero external references${allowed})`);
